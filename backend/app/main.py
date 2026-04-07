import os
from datetime import date
from calendar import month_name
from base64 import b64encode

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.db import (
    count_transactions_since,
    delete_item,
    fetch_item_by_id,
    fetch_last_commit_timestamp,
    fetch_items,
    fetch_links,
    fetch_team_assignments,
    init_db,
    insert_board_commit,
    insert_link,
    insert_item,
    save_team_assignment,
    delete_link,
    update_item_external_fields,
    update_item_position,
    # ── board management ──
    fetch_boards,
    insert_board,
    fetch_board_by_id,
    update_board,
    archive_board,
    delete_board_record,
    # ── activity log ──
    log_activity,
    fetch_activity,
)

load_dotenv()

MILESTONE_ROW_INDEX = 0
ROWS = ["Milestone"] + [f"Team#{i}" for i in range(1, 11)]
SOURCE_JIRA = "jira"
SOURCE_ADO = "ado"


def source_tile_color(source: str) -> str:
    if source == SOURCE_ADO:
        return "#d97706"
    if source == SOURCE_JIRA:
        return "#2563eb"
    return "#475569"


class CreateMilestoneRequest(BaseModel):
    board_id: int
    issue_key: str | None = None
    ticket_source: str = Field(SOURCE_JIRA, pattern=r"^(jira|ado)$")
    title: str | None = None
    target_date: date
    end_date: date


class MoveItemRequest(BaseModel):
    row_index: int = Field(..., ge=0, le=10)
    start_slot: int = Field(..., ge=0)
    end_slot: int = Field(..., ge=0)


class CreateTaskRequest(BaseModel):
    board_id: int
    title: str = Field("", min_length=0)
    issue_key: str | None = None
    jira_project_key: str | None = None
    jira_issue_type: str | None = None
    jira_extra_fields: dict | None = None
    ticket_source: str = Field(SOURCE_JIRA, pattern=r"^(jira|ado)$")
    row_index: int = Field(..., ge=1, le=10)
    start_slot: int = Field(..., ge=0)
    end_slot: int = Field(..., ge=0)


class TeamAssignmentRequest(BaseModel):
    board_id: int
    team_code: str | None = None


class CreateLinkRequest(BaseModel):
    board_id: int
    source_item_id: int = Field(..., gt=0)
    target_item_id: int = Field(..., gt=0)
    link_type: str = Field(..., pattern=r"^(blocks|depends_on|relates_to)$")


def build_planning_columns(start: date, end: date | None = None) -> list[dict]:
    months = []
    cursor_month = start.month
    cursor_year = start.year
    slot_cursor = 0

    if end is None:
        num_months = 4
    else:
        num_months = (end.year - start.year) * 12 + (end.month - start.month) + 1
        num_months = max(1, num_months)

    for _ in range(num_months):
        month_slots = []
        for week in range(1, 5):
            month_slots.append(
                {
                    "slot": slot_cursor,
                    "label": f"WK{week}",
                }
            )
            slot_cursor += 1

        months.append(
            {
                "name": month_name[cursor_month],
                "year": cursor_year,
                "slots": month_slots,
            }
        )

        cursor_month += 1
        if cursor_month > 12:
            cursor_month = 1
            cursor_year += 1

    return months


def find_slot_for_target_date(target: date, months: list[dict]) -> int:
    for month in months:
        if month["year"] == target.year and month_name[target.month] == month["name"]:
            week_index = min((target.day - 1) // 7, 3)
            return month["slots"][week_index]["slot"]

    raise HTTPException(status_code=400, detail="Target date must be within the 4-month planning window")


def _extract_description_text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if not isinstance(value, dict):
        return str(value)

    lines: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            text = node.get("text")
            if isinstance(text, str) and text.strip():
                lines.append(text.strip())
            for child in node.get("content", []) if isinstance(node.get("content"), list) else []:
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(value)
    if not lines:
        return None
    return "\n".join(lines)


def fetch_jira_issue(issue_key: str) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings()

    endpoint = (
        f"{jira_base}/rest/api/2/issue/{issue_key}"
        "?fields=summary,issuetype,status,assignee,description,customfield_10231"
    )

    try:
        response = requests.get(endpoint, auth=auth, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = f"Failed to fetch issue from JIRA: {exc}"
        raise HTTPException(status_code=400, detail=detail) from exc
    except requests.SSLError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "JIRA SSL verification failed. Set JIRA_VERIFY_SSL=false for internal certs "
                "or configure JIRA_CA_BUNDLE_PATH with your corporate CA bundle."
            ),
        ) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc

    data = response.json()
    fields = data.get("fields", {})
    issue_type = fields.get("issuetype", {}).get("name", "")
    summary = fields.get("summary")
    if not summary:
        raise HTTPException(status_code=400, detail="JIRA issue summary is empty")

    return {
        "issue_key": issue_key,
        "summary": summary,
        "issue_type": issue_type,
        "status": fields.get("status", {}).get("name"),
        "assignee": (fields.get("assignee") or {}).get("displayName"),
        "shirt_size": (fields.get("customfield_10231") or {}).get("value"),
        "description": _extract_description_text(fields.get("description")),
    }


def fetch_jira_summary(issue_key: str) -> str:
    issue = fetch_jira_issue(issue_key)
    issue_type = issue["issue_type"]
    if issue_type.lower() != "idea":
        raise HTTPException(status_code=400, detail="Only IDEA issue type is allowed for Milestone row")
    return issue["summary"]


def fetch_jira_projects() -> list[dict]:
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/project"

    try:
        response = requests.get(endpoint, auth=auth, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = f"Failed to fetch projects from JIRA: {exc}"
        raise HTTPException(status_code=400, detail=detail) from exc
    except requests.SSLError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "JIRA SSL verification failed. Set JIRA_VERIFY_SSL=false for internal certs "
                "or configure JIRA_CA_BUNDLE_PATH with your corporate CA bundle."
            ),
        ) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc

    projects = response.json() or []
    normalized = []
    for project in projects:
        key = (project.get("key") or "").strip()
        name = (project.get("name") or "").strip()
        if key:
            normalized.append({"key": key, "name": name or key})

    normalized.sort(key=lambda p: p["key"])
    return normalized


def create_jira_issue(summary: str, issue_type_name: str = "Task", project_key: str | None = None, extra_fields: dict | None = None) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings()
    resolved_project_key = (project_key or os.getenv("JIRA_PROJECT_KEY") or "").strip().upper()
    if not resolved_project_key:
        raise HTTPException(status_code=400, detail="JIRA project key is required")

    endpoint = f"{jira_base}/rest/api/2/issue"
    fields: dict = {
        "project": {"key": resolved_project_key},
        "summary": summary,
        "issuetype": {"name": issue_type_name},
    }
    if extra_fields:
        fields.update(extra_fields)
    payload = {"fields": fields}

    try:
        response = requests.post(endpoint, auth=auth, json=payload, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = "Failed to create issue in JIRA"
        try:
            body = response.json()
            errors = body.get("errors") or {}
            if errors:
                detail = f"{detail}: {'; '.join(str(v) for v in errors.values())}"
            elif body.get("errorMessages"):
                detail = f"{detail}: {'; '.join(body['errorMessages'])}"
        except ValueError:
            pass
        raise HTTPException(status_code=400, detail=detail) from exc
    except requests.SSLError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "JIRA SSL verification failed. Set JIRA_VERIFY_SSL=false for internal certs "
                "or configure JIRA_CA_BUNDLE_PATH with your corporate CA bundle."
            ),
        ) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc

    data = response.json()
    created_key = data.get("key")
    if not created_key:
        raise HTTPException(status_code=400, detail="JIRA issue created but key was not returned")
    return {"issue_key": created_key}


def _get_jira_connection_settings() -> tuple[str, tuple[str, str] | None, bool | str]:
    jira_base = (os.getenv("JIRA_BASE_URL") or os.getenv("JIRA_URL") or "").rstrip("/")
    username = os.getenv("JIRA_USERNAME")
    token = os.getenv("JIRA_API_TOKEN") or os.getenv("JIRA_PASSWORD")
    verify_ssl_raw = (os.getenv("JIRA_VERIFY_SSL") or "true").strip().lower()
    verify_ssl = verify_ssl_raw not in {"0", "false", "no"}
    ca_bundle_path = os.getenv("JIRA_CA_BUNDLE_PATH")

    if not jira_base:
        raise HTTPException(status_code=500, detail="JIRA_BASE_URL is not configured")

    auth = (username, token) if username and token else None
    verify: bool | str = ca_bundle_path if ca_bundle_path else verify_ssl
    return jira_base, auth, verify


def _resolve_jira_worklog_link_type() -> dict:
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issueLinkType"

    try:
        response = requests.get(endpoint, auth=auth, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch JIRA link types: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc

    data = response.json()
    link_types = data.get("issueLinkTypes", [])

    phrase = "has worklog in"
    for link_type in link_types:
        inward = (link_type.get("inward") or "").strip().lower()
        outward = (link_type.get("outward") or "").strip().lower()
        name = (link_type.get("name") or "").strip().lower()
        if phrase in {inward, outward, name}:
            return link_type

    raise HTTPException(status_code=400, detail='JIRA link type "has worklog in" is not available')


def _create_jira_worklog_link(worklog_issue_key: str, idea_issue_key: str) -> None:
    link_type = _resolve_jira_worklog_link_type()
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issueLink"

    inward = (link_type.get("inward") or "").strip().lower()
    outward = (link_type.get("outward") or "").strip().lower()
    phrase = "has worklog in"

    if inward == phrase:
        payload = {
            "type": {"name": link_type["name"]},
            "inwardIssue": {"key": worklog_issue_key},
            "outwardIssue": {"key": idea_issue_key},
        }
    elif outward == phrase:
        payload = {
            "type": {"name": link_type["name"]},
            "outwardIssue": {"key": worklog_issue_key},
            "inwardIssue": {"key": idea_issue_key},
        }
    else:
        payload = {
            "type": {"name": link_type["name"]},
            "inwardIssue": {"key": worklog_issue_key},
            "outwardIssue": {"key": idea_issue_key},
        }

    try:
        response = requests.post(endpoint, auth=auth, json=payload, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create JIRA worklog link: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc


def _resolve_jira_link_type_by_token(token: str) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issueLinkType"

    try:
        response = requests.get(endpoint, auth=auth, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch JIRA link types: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc

    token_lower = token.strip().lower()
    data = response.json()
    for link_type in data.get("issueLinkTypes", []):
        name = (link_type.get("name") or "").strip().lower()
        inward = (link_type.get("inward") or "").strip().lower()
        outward = (link_type.get("outward") or "").strip().lower()
        if token_lower in name or token_lower in inward or token_lower in outward:
            return link_type

    raise HTTPException(status_code=400, detail=f'JIRA link type containing "{token}" is not available')


def _create_jira_blocks_link(source_issue_key: str, target_issue_key: str) -> None:
    preferred_phrase = "is blocked by"
    fallback_phrase = "relates to"
    active_phrase = preferred_phrase

    try:
        link_type = _resolve_jira_link_type_by_token(preferred_phrase)
    except HTTPException:
        link_type = _resolve_jira_link_type_by_token(fallback_phrase)
        active_phrase = fallback_phrase

    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issueLink"

    inward = (link_type.get("inward") or "").strip().lower()
    outward = (link_type.get("outward") or "").strip().lower()
    phrase = active_phrase

    if phrase in outward:
        payload = {
            "type": {"name": link_type["name"]},
            "outwardIssue": {"key": source_issue_key},
            "inwardIssue": {"key": target_issue_key},
        }
    elif phrase in inward:
        payload = {
            "type": {"name": link_type["name"]},
            "inwardIssue": {"key": source_issue_key},
            "outwardIssue": {"key": target_issue_key},
        }
    else:
        payload = {
            "type": {"name": link_type["name"]},
            "outwardIssue": {"key": source_issue_key},
            "inwardIssue": {"key": target_issue_key},
        }

    try:
        response = requests.post(endpoint, auth=auth, json=payload, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create JIRA blocks link: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc


def _create_jira_relates_link(source_issue_key: str, target_issue_key: str) -> None:
    link_type = _resolve_jira_link_type_by_token("relates to")
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issueLink"

    payload = {
        "type": {"name": link_type["name"]},
        "outwardIssue": {"key": source_issue_key},
        "inwardIssue": {"key": target_issue_key},
    }

    try:
        response = requests.post(endpoint, auth=auth, json=payload, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create JIRA relates link: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc


def _create_jira_link_for_board_type(source_issue_key: str, target_issue_key: str, board_link_type: str) -> None:
    if board_link_type == "blocks":
        _create_jira_blocks_link(source_issue_key, target_issue_key)
        return
    _create_jira_relates_link(source_issue_key, target_issue_key)


def _build_ado_work_item_web_link(work_item_key: str) -> tuple[str, str]:
    work_item_id = _extract_ado_work_item_id(work_item_key)
    template = (os.getenv("ADO_WEB_LINK_TEMPLATE") or "").strip()
    organization = (os.getenv("AZURE_ORG") or "").strip()
    project = (os.getenv("AZURE_PROJECT") or "").strip()

    if template:
        url = template.format(
            work_item_id=work_item_id,
            work_item_key=work_item_key,
            org=organization,
            project=project,
        )
        return url, f"ADO {work_item_id}"

    base_url = (os.getenv("ADO_BASE_URL") or "https://dev.azure.com").rstrip("/")
    if not organization or not project:
        raise HTTPException(status_code=500, detail="AZURE_ORG and AZURE_PROJECT must be configured for ADO web links")

    url = f"{base_url}/{organization}/{project}/_workitems/edit/{work_item_id}"
    return url, f"ADO {work_item_id}"


def _create_jira_web_link(issue_key: str, url: str, title: str) -> None:
    jira_base, auth, verify = _get_jira_connection_settings()
    endpoint = f"{jira_base}/rest/api/2/issue/{issue_key}/remotelink"
    payload = {
        "object": {
            "url": url,
            "title": title,
        }
    }

    try:
        response = requests.post(endpoint, auth=auth, json=payload, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create JIRA web link: {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc


def _extract_ado_text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        compact = " ".join(value.replace("\r", " ").replace("\n", " ").split())
        if not compact:
            return None
        compact = compact.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
        while "<" in compact and ">" in compact:
            start = compact.find("<")
            end = compact.find(">", start)
            if end == -1:
                break
            compact = (compact[:start] + " " + compact[end + 1 :]).strip()
        return " ".join(compact.split()) or None
    return str(value)


def _normalize_ticket_source(value: str | None) -> str:
    normalized = (value or SOURCE_JIRA).strip().lower()
    if normalized not in {SOURCE_JIRA, SOURCE_ADO}:
        raise HTTPException(status_code=400, detail="ticket_source must be either 'jira' or 'ado'")
    return normalized


def _extract_ado_work_item_id(work_item_key: str) -> int:
    digits = "".join(ch for ch in work_item_key if ch.isdigit())
    if not digits:
        raise HTTPException(status_code=400, detail="ADO work item key must contain a numeric ID")
    return int(digits)


def fetch_ado_work_item(work_item_key: str) -> dict:
    organization = (os.getenv("AZURE_ORG") or "").strip()
    project = (os.getenv("AZURE_PROJECT") or "").strip()
    pat = (os.getenv("AZURE_PAT") or "").strip()

    if not organization or not project or not pat:
        raise HTTPException(status_code=500, detail="AZURE_ORG, AZURE_PROJECT, and AZURE_PAT must be configured")

    work_item_id = _extract_ado_work_item_id(work_item_key)
    endpoint = (
        f"https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/{work_item_id}"
        "?fields=System.Title,System.WorkItemType,System.State,System.AssignedTo,System.Description"
        "&api-version=7.1"
    )

    basic_token = b64encode(f":{pat}".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic_token}",
        "Accept": "application/json",
    }

    try:
        response = requests.get(endpoint, headers=headers, timeout=15)
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = f"Failed to fetch work item from ADO: {exc}"
        raise HTTPException(status_code=400, detail=detail) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach Azure DevOps") from exc

    data = response.json()
    fields = data.get("fields", {})
    summary = fields.get("System.Title")
    if not summary:
        raise HTTPException(status_code=400, detail="ADO work item title is empty")

    raw_assignee = fields.get("System.AssignedTo")
    assignee = None
    if isinstance(raw_assignee, dict):
        assignee = raw_assignee.get("displayName")
    elif isinstance(raw_assignee, str):
        assignee = raw_assignee

    issue_type = (fields.get("System.WorkItemType") or "").strip()
    return {
        "issue_key": f"{work_item_id}",
        "summary": summary,
        "issue_type": issue_type,
        "status": fields.get("System.State"),
        "assignee": assignee,
        "shirt_size": None,
        "description": _extract_ado_text(fields.get("System.Description")),
    }


def create_ado_user_story(title: str) -> dict:
    organization = (os.getenv("AZURE_ORG") or "").strip()
    project = (os.getenv("AZURE_PROJECT") or "").strip()
    pat = (os.getenv("AZURE_PAT") or "").strip()

    if not organization or not project or not pat:
        raise HTTPException(status_code=500, detail="AZURE_ORG, AZURE_PROJECT, and AZURE_PAT must be configured")

    endpoint = f"https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/$User%20Story?api-version=7.1"
    basic_token = b64encode(f":{pat}".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic_token}",
        "Accept": "application/json",
        "Content-Type": "application/json-patch+json",
    }

    operations = [{"op": "add", "path": "/fields/System.Title", "value": title}]
    area_path = (os.getenv("AZURE_DEFAULT_AREA_PATH") or "").strip()
    iteration_path = (os.getenv("AZURE_DEFAULT_ITERATION_PATH") or "").strip()
    if area_path:
        operations.append({"op": "add", "path": "/fields/System.AreaPath", "value": area_path})
    if iteration_path:
        operations.append({"op": "add", "path": "/fields/System.IterationPath", "value": iteration_path})

    try:
        response = requests.patch(endpoint, headers=headers, json=operations, timeout=15)
        response.raise_for_status()
    except requests.HTTPError as exc:
        detail = "Failed to create work item in ADO"
        try:
            body = response.json()
            if isinstance(body, dict):
                message = body.get("message")
                if message:
                    detail = f"{detail}: {message}"
        except ValueError:
            pass
        raise HTTPException(status_code=400, detail=detail) from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach Azure DevOps") from exc

    data = response.json()
    work_item_id = data.get("id")
    if not work_item_id:
        raise HTTPException(status_code=400, detail="ADO work item created but ID was not returned")
    return {"issue_key": f"{work_item_id}"}


def _ensure_ado_user_story(issue: dict, context: str) -> None:
    issue_type = (issue.get("issue_type") or "").strip().lower()
    if issue_type not in {"user story", "us"}:
        raise HTTPException(status_code=400, detail=f"Only US work items are allowed for {context}")


app = FastAPI(title="Program Planning Board API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def _sync_external_ticket_fields(items: list[dict]) -> list[dict]:
    synced: list[dict] = []
    for item in items:
        source = _normalize_ticket_source(item.get("ticket_source"))
        issue_key = (item.get("issue_key") or "").strip()

        if source != SOURCE_JIRA or not issue_key:
            synced.append(item)
            continue

        try:
            issue = fetch_jira_issue(issue_key)
        except HTTPException:
            # Keep cached values when JIRA is unavailable or key is invalid.
            synced.append(item)
            continue

        changed = any(
            [
                item.get("jira_assignee") != issue.get("assignee"),
                item.get("jira_shirt_size") != issue.get("shirt_size"),
                item.get("jira_status") != issue.get("status"),
                item.get("jira_description") != issue.get("description"),
            ]
        )

        if not changed:
            synced.append(item)
            continue

        updated = update_item_external_fields(
            item["id"],
            assignee=issue.get("assignee"),
            shirt_size=issue.get("shirt_size"),
            status=issue.get("status"),
            description=issue.get("description"),
        )
        synced.append(updated or item)

    return synced


def _verify_board(items: list[dict], links: list[dict], total_slots: int = 16) -> list[str]:
    issues: list[str] = []
    known_ids = {item["id"] for item in items}

    for item in items:
        start_slot = int(item.get("start_slot", 0))
        end_slot = int(item.get("end_slot", 0))
        row_index = int(item.get("row_index", -1))
        is_milestone = item.get("item_type") == "IDEA"

        if end_slot < start_slot:
            issues.append(f"Item {item['id']} has end_slot before start_slot")
        if start_slot < 0 or end_slot > total_slots - 1:
            issues.append(f"Item {item['id']} is outside planning window")
        if row_index < 0 or row_index >= len(ROWS):
            issues.append(f"Item {item['id']} has invalid row index")
        if is_milestone and row_index != MILESTONE_ROW_INDEX:
            issues.append(f"Milestone item {item['id']} is not in Milestone row")
        if not is_milestone and row_index == MILESTONE_ROW_INDEX:
            issues.append(f"Task item {item['id']} cannot be in Milestone row")

    for link in links:
        if link.get("source_item_id") not in known_ids or link.get("target_item_id") not in known_ids:
            issues.append(f"Link {link.get('id')} points to missing ticket")

    return issues


@app.get("/api/board")
def get_board(board_id: int = Query(...), refresh_external: bool = Query(False)) -> dict:
    board_meta = fetch_board_by_id(board_id)
    if not board_meta:
        raise HTTPException(status_code=404, detail="Board not found")

    start = date.fromisoformat(board_meta["start_date"]) if board_meta.get("start_date") else date.today().replace(day=1)
    end = date.fromisoformat(board_meta["end_date"]) if board_meta.get("end_date") else None
    months = build_planning_columns(start, end)

    items = _sync_external_ticket_fields(fetch_items(board_id)) if refresh_external else fetch_items(board_id)
    links = fetch_links(board_id)
    team_assignments = fetch_team_assignments(board_id)
    return {
        "months": months,
        "rows": [{"index": idx, "label": label} for idx, label in enumerate(ROWS)],
        "items": items,
        "links": links,
        "team_assignments": team_assignments,
    }


@app.get("/api/jira/projects")
def get_jira_projects() -> dict:
    return {"projects": fetch_jira_projects()}


@app.get("/api/jira/projects/{project_key}/issue-types")
def get_jira_project_issue_types(project_key: str) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings()
    key = project_key.strip().upper()
    if not key:
        raise HTTPException(status_code=400, detail="Project key is required")
    try:
        response = requests.get(f"{jira_base}/rest/api/2/project/{key}", auth=auth, timeout=15, verify=verify)
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch project from JIRA: {exc}") from exc
    except requests.SSLError as exc:
        raise HTTPException(status_code=502, detail="JIRA SSL verification failed.") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc
    data = response.json()
    raw_types = data.get("issueTypes") or []
    issue_types = [
        {"id": it.get("id", ""), "name": it.get("name", "")}
        for it in raw_types
        if it.get("name") and not it.get("subtask", False)
    ]
    return {"issue_types": issue_types}


def _fetch_options_from_context_api(jira_base: str, auth, verify, field_id: str) -> list[dict]:
    """
    Fallback: fetch custom field options via Jira's field-context API.
    Tries both REST v2 and v3 style endpoints.
    """
    field_num = field_id.replace("customfield_", "")

    # Approach 1: Jira Cloud REST v3
    for ctx_endpoint in [
        f"{jira_base}/rest/api/3/field/{field_id}/context",
        f"{jira_base}/rest/api/2/customField/{field_num}/option",
    ]:
        try:
            r = requests.get(ctx_endpoint, auth=auth, timeout=15, verify=verify)
            if not r.ok:
                continue
            payload = r.json()

            # v3 contexts response: get first context id then fetch options
            values = payload.get("values") or []
            if values and "id" in values[0]:
                context_id = values[0]["id"]
                opt_r = requests.get(
                    f"{jira_base}/rest/api/3/field/{field_id}/context/{context_id}/option",
                    auth=auth,
                    timeout=15,
                    verify=verify,
                )
                if opt_r.ok:
                    opt_data = opt_r.json()
                    opts = opt_data.get("values") or []
                    result = []
                    for o in opts:
                        label = o.get("value") or o.get("name") or ""
                        if label:
                            result.append({"id": str(o.get("id", "")), "name": label, "value": label})
                    if result:
                        return result

            # Direct options list (v2 style)
            options_list = payload.get("options") or payload.get("values") or []
            if options_list:
                result = []
                for o in options_list:
                    label = o.get("value") or o.get("name") or ""
                    if label:
                        result.append({"id": str(o.get("id", "")), "name": label, "value": label})
                if result:
                    return result
        except Exception:
            continue

    return []


@app.get("/api/jira/field-options")
def get_jira_field_options(
    project_key: str = Query(...),
    issue_type: str = Query("Task"),
    field_name: str = Query(...),
) -> dict:
    """Discover field by name via /rest/api/2/field, then fetch its options via multiple fallbacks."""
    jira_base, auth, verify = _get_jira_connection_settings()
    field_lower = field_name.strip().lower()
    key = project_key.strip().upper()
    if not key or not field_lower:
        raise HTTPException(status_code=400, detail="project_key and field_name are required")

    # ── Step 1: discover real field ID via /rest/api/2/field ──────────────────
    matched_field_id: str = field_name
    matched_field_name: str = field_name
    try:
        r = requests.get(f"{jira_base}/rest/api/2/field", auth=auth, timeout=15, verify=verify)
        if r.ok:
            all_fields_list = r.json() or []
            # Exact key or name match
            for f in all_fields_list:
                fid = (f.get("id") or "").lower()
                fname = (f.get("name") or "").lower()
                if fid == field_lower or fname == field_lower:
                    matched_field_id = f["id"]
                    matched_field_name = f.get("name", field_name)
                    break
            else:
                # Substring name match
                for f in all_fields_list:
                    fid = (f.get("id") or "").lower()
                    fname = (f.get("name") or "").lower()
                    if field_lower in fname or field_lower in fid:
                        matched_field_id = f["id"]
                        matched_field_name = f.get("name", field_name)
                        break
    except Exception:
        pass

    field_num = matched_field_id.replace("customfield_", "")
    options: list[dict] = []

    # ── Step 2: JQL search for distinct field values (most reliable for Jira Server) ──
    try:
        jql = f'project = "{key}" AND cf[{field_num}] is not EMPTY'
        r = requests.get(
            f"{jira_base}/rest/api/2/search",
            params={"jql": jql, "maxResults": 500, "fields": matched_field_id},
            auth=auth,
            timeout=20,
            verify=verify,
        )
        if r.ok:
            seen: set = set()
            for issue in (r.json().get("issues") or []):
                field_val = (issue.get("fields") or {}).get(matched_field_id)
                if isinstance(field_val, dict):
                    val = field_val.get("value") or field_val.get("name") or ""
                    oid = str(field_val.get("id", ""))
                    if val and val not in seen:
                        seen.add(val)
                        options.append({"id": oid, "name": val, "value": val})
                elif isinstance(field_val, list):
                    for item in field_val:
                        if isinstance(item, dict):
                            val = item.get("value") or item.get("name") or ""
                            oid = str(item.get("id", ""))
                            if val and val not in seen:
                                seen.add(val)
                                options.append({"id": oid, "name": val, "value": val})
    except Exception:
        pass

    return {
        "options": options,
        "required": True,
        "field_key": matched_field_id,
        "field_name_found": matched_field_name,
    }


@app.post("/api/board/commit")
def commit_board(board_id: int = Query(...)) -> dict:
    board_meta = fetch_board_by_id(board_id)
    if not board_meta:
        raise HTTPException(status_code=404, detail="Board not found")
    start = date.fromisoformat(board_meta["start_date"]) if board_meta.get("start_date") else date.today().replace(day=1)
    end = date.fromisoformat(board_meta["end_date"]) if board_meta.get("end_date") else None
    months = build_planning_columns(start, end)
    total_slots = len(months) * 4

    items = _sync_external_ticket_fields(fetch_items(board_id))
    links = fetch_links(board_id)
    verification_issues = _verify_board(items, links, total_slots)
    if verification_issues:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Board verification failed",
                "issues": verification_issues,
            },
        )

    last_commit_at = fetch_last_commit_timestamp()
    pending_changes = count_transactions_since(last_commit_at)
    summary = {
        "items": len(items),
        "links": len(links),
        "pending_changes": pending_changes,
    }
    commit_entry = insert_board_commit(verified=True, summary=summary)
    log_activity(board_id, "Board committed", f"{summary['items']} items, {summary['links']} links")

    return {
        "status": "committed",
        "verified": True,
        "summary": summary,
        "commit": commit_entry,
    }


@app.post("/api/milestones")
def create_milestone(payload: CreateMilestoneRequest) -> dict:
    board_meta = fetch_board_by_id(payload.board_id)
    if not board_meta:
        raise HTTPException(status_code=404, detail="Board not found")
    start = date.fromisoformat(board_meta["start_date"]) if board_meta.get("start_date") else date.today().replace(day=1)
    end = date.fromisoformat(board_meta["end_date"]) if board_meta.get("end_date") else None
    months = build_planning_columns(start, end)
    start_slot = find_slot_for_target_date(payload.target_date, months)
    end_slot = find_slot_for_target_date(payload.end_date, months)
    if end_slot < start_slot:
        raise HTTPException(status_code=400, detail="End date must be on or after target date")

    ticket_source = _normalize_ticket_source(payload.ticket_source)
    if ticket_source != SOURCE_JIRA:
        raise HTTPException(status_code=400, detail="Milestones only support JIRA IDEA tickets")

    raw_issue_key = (payload.issue_key or "").strip()
    issue_key = raw_issue_key.upper() if ticket_source == SOURCE_JIRA else raw_issue_key
    if not issue_key:
        raise HTTPException(status_code=400, detail="Existing JIRA IDEA key is required for milestones")

    issue: dict | None = None

    if ticket_source == SOURCE_JIRA:
        issue = fetch_jira_issue(issue_key)
        if issue["issue_type"].lower() != "idea":
            raise HTTPException(status_code=400, detail="Only IDEA issue type is allowed for Milestone row")
    else:
        issue = fetch_ado_work_item(issue_key)
        _ensure_ado_user_story(issue, "Milestone row")

    issue_key = issue["issue_key"]
    title = issue["summary"]

    item = insert_item(
        {
            "issue_key": issue_key or None,
            "title": title,
            "item_type": "IDEA",
            "row_index": MILESTONE_ROW_INDEX,
            "row_label": ROWS[MILESTONE_ROW_INDEX],
            "start_slot": start_slot,
            "end_slot": end_slot,
            "target_date": payload.target_date.isoformat(),
            "end_date": payload.end_date.isoformat(),
            "ticket_source": ticket_source,
            "external_work_item_type": issue["issue_type"] if issue else None,
            "jira_assignee": issue["assignee"] if issue else None,
            "jira_shirt_size": issue["shirt_size"] if issue else None,
            "jira_status": issue["status"] if issue else None,
            "jira_description": issue["description"] if issue else None,
            "color": source_tile_color(ticket_source),
        },
        board_id=payload.board_id,
    )
    log_activity(payload.board_id, "Added milestone", f"{issue_key}: {title}")
    return item


@app.patch("/api/items/{item_id}/move")
def move_item(item_id: int, payload: MoveItemRequest) -> dict:
    if payload.end_slot < payload.start_slot:
        raise HTTPException(status_code=400, detail="end_slot cannot be less than start_slot")

    existing_item = fetch_item_by_id(item_id)
    if not existing_item:
        raise HTTPException(status_code=404, detail="Item not found")

    is_milestone = existing_item.get("item_type") == "IDEA"
    if is_milestone and payload.row_index != MILESTONE_ROW_INDEX:
        raise HTTPException(status_code=400, detail="IDEA milestones can only stay in Milestone row")
    if not is_milestone and payload.row_index == MILESTONE_ROW_INDEX:
        raise HTTPException(status_code=400, detail="Only IDEA milestones can be in Milestone row")

    updated = update_item_position(item_id, payload.row_index, payload.start_slot, payload.end_slot)
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")
    label = existing_item.get("issue_key") or existing_item.get("title", f"item #{item_id}")
    log_activity(
        existing_item.get("board_id", 0),
        "Moved ticket",
        f"{label} → row {payload.row_index}, slots {payload.start_slot}–{payload.end_slot}",
    )
    return updated


@app.post("/api/tasks")
def create_task(payload: CreateTaskRequest) -> dict:
    if payload.end_slot < payload.start_slot:
        raise HTTPException(status_code=400, detail="End slot must be on or after start slot")

    ticket_source = _normalize_ticket_source(payload.ticket_source)
    raw_issue_key = (payload.issue_key or "").strip()
    issue_key = raw_issue_key.upper() if ticket_source == SOURCE_JIRA else raw_issue_key
    title = payload.title.strip()
    issue: dict | None = None
    jira_created = False
    jira_created_issue_key: str | None = None
    ado_created = False
    ado_created_issue_key: str | None = None
    sync_failed = False
    sync_error_message: str | None = None

    if issue_key:
        if ticket_source == SOURCE_JIRA:
            issue = fetch_jira_issue(issue_key)
        else:
            issue = fetch_ado_work_item(issue_key)
            _ensure_ado_user_story(issue, "Task row")

        issue_key = issue["issue_key"]
        title = issue["summary"]
    else:
        if not title:
            raise HTTPException(status_code=400, detail="Task title is required when issue key is not provided")
        if ticket_source == SOURCE_JIRA:
            issue_type_name = (payload.jira_issue_type or "Task").strip() or "Task"
            try:
                created = create_jira_issue(
                    summary=title,
                    issue_type_name=issue_type_name,
                    project_key=payload.jira_project_key,
                    extra_fields=payload.jira_extra_fields,
                )
                jira_created = True
                jira_created_issue_key = created["issue_key"]
                issue = fetch_jira_issue(created["issue_key"])
                issue_key = issue["issue_key"]
                title = issue["summary"]
            except Exception as exc:
                sync_failed = True
                sync_error_message = str(exc)
        else:
            try:
                created = create_ado_user_story(title=title)
                ado_created = True
                ado_created_issue_key = created["issue_key"]
                issue = fetch_ado_work_item(created["issue_key"])
                _ensure_ado_user_story(issue, "Task row")
                issue_key = issue["issue_key"]
                title = issue["summary"]
            except Exception as exc:
                sync_failed = True
                sync_error_message = str(exc)

    if not title:
        raise HTTPException(status_code=400, detail="Task title is required when issue key is not provided")

    system_label = "JIRA" if ticket_source == SOURCE_JIRA else "Azure DevOps"
    item = insert_item(
        {
            "issue_key": issue_key or None,
            "title": title,
            "item_type": "TASK",
            "row_index": payload.row_index,
            "row_label": ROWS[payload.row_index],
            "start_slot": payload.start_slot,
            "end_slot": payload.end_slot,
            "target_date": None,
            "end_date": None,
            "ticket_source": ticket_source,
            "external_work_item_type": issue["issue_type"] if issue else None,
            "jira_assignee": issue["assignee"] if issue else None,
            "jira_shirt_size": issue["shirt_size"] if issue else None,
            "jira_status": issue["status"] if issue else None,
            "jira_description": issue["description"] if issue else None,
            "color": source_tile_color(ticket_source if issue_key else "manual"),
            "sync_status": "sync_failed" if sync_failed else "synced",
        },
        board_id=payload.board_id,
    )
    item["jira_created"] = jira_created
    item["jira_created_issue_key"] = jira_created_issue_key
    item["ado_created"] = ado_created
    item["ado_created_issue_key"] = ado_created_issue_key
    item["sync_failed"] = sync_failed
    item["sync_error_message"] = sync_error_message
    item["system_label"] = system_label
    log_activity(
        payload.board_id,
        "Added task" if not sync_failed else f"Added task (sync failed — {system_label})",
        f"{issue_key or title} (row {payload.row_index})",
    )
    return item


@app.put("/api/team-assignments/{row_index}")
def set_team_assignment(row_index: int, payload: TeamAssignmentRequest) -> dict:
    if row_index <= 0 or row_index >= len(ROWS):
        raise HTTPException(status_code=400, detail="Invalid team row index")

    team_code = (payload.team_code or "").strip()
    saved = save_team_assignment(row_index=row_index, team_code=team_code or None, board_id=payload.board_id)
    if team_code:
        log_activity(payload.board_id, "Assigned team", f"{team_code} → row {row_index}")
    else:
        log_activity(payload.board_id, "Removed team", f"row {row_index} cleared")
    return {
        "board_id": payload.board_id,
        "row_index": row_index,
        "team_code": saved["team_code"] if saved else None,
    }


@app.post("/api/links")
def create_link(payload: CreateLinkRequest) -> dict:
    if payload.source_item_id == payload.target_item_id:
        raise HTTPException(status_code=400, detail="Cannot link an item to itself")

    items = fetch_items(payload.board_id)
    source_item = next((item for item in items if item["id"] == payload.source_item_id), None)
    target_item = next((item for item in items if item["id"] == payload.target_item_id), None)
    if not source_item or not target_item:
        raise HTTPException(status_code=404, detail="One or both items were not found")

    source_is_idea = source_item.get("item_type") == "IDEA"
    target_is_idea = target_item.get("item_type") == "IDEA"
    source_key = (source_item.get("issue_key") or "").strip()
    target_key = (target_item.get("issue_key") or "").strip()
    source_source = _normalize_ticket_source(source_item.get("ticket_source"))
    target_source = _normalize_ticket_source(target_item.get("ticket_source"))
    jira_link_synced = False

    idea_item = source_item if source_is_idea else (target_item if target_is_idea else None)
    worklog_item = target_item if source_is_idea else (source_item if target_is_idea else None)

    # Business rule: IDEA <-> JIRA Task links should sync to JIRA as "has worklog in".
    if idea_item and worklog_item:
        idea_key = (idea_item.get("issue_key") or "").strip()
        worklog_key = (worklog_item.get("issue_key") or "").strip()
        idea_source = _normalize_ticket_source(idea_item.get("ticket_source"))
        worklog_source = _normalize_ticket_source(worklog_item.get("ticket_source"))

        if idea_key and worklog_key and idea_source == SOURCE_JIRA and worklog_source == SOURCE_JIRA:
            _create_jira_worklog_link(worklog_key, idea_key)
            jira_link_synced = True

    if (
        not jira_link_synced
        and source_key
        and target_key
        and source_source == SOURCE_JIRA
        and target_source == SOURCE_JIRA
    ):
        _create_jira_link_for_board_type(source_key, target_key, payload.link_type)
        jira_link_synced = True

    if idea_item and worklog_item:
        idea_key = (idea_item.get("issue_key") or "").strip()
        worklog_key = (worklog_item.get("issue_key") or "").strip()
        idea_source = _normalize_ticket_source(idea_item.get("ticket_source"))
        worklog_source = _normalize_ticket_source(worklog_item.get("ticket_source"))

        if idea_key and worklog_key and idea_source == SOURCE_JIRA and worklog_source == SOURCE_ADO:
            ado_url, ado_title = _build_ado_work_item_web_link(worklog_key)
            _create_jira_web_link(idea_key, ado_url, ado_title)
            jira_link_synced = True

    try:
        created = insert_link(payload.source_item_id, payload.target_item_id, payload.link_type)
        created["jira_link_synced"] = jira_link_synced
        src_label = (source_item.get("issue_key") or source_item.get("title", "?"))[:30]
        tgt_label = (target_item.get("issue_key") or target_item.get("title", "?"))[:30]
        log_activity(payload.board_id, "Linked tickets", f"{src_label} \u2192 {tgt_label} ({payload.link_type})")
        return created
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Link already exists or is invalid") from exc


@app.delete("/api/links/{link_id}")
def remove_link(link_id: int) -> dict:
    deleted = delete_link(link_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"status": "deleted", "link_id": link_id}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.delete("/api/items/{item_id}")
def remove_item(item_id: int) -> dict:
    existing = fetch_item_by_id(item_id)
    deleted = delete_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")
    if existing:
        label = existing.get("issue_key") or existing.get("title", f"item #{item_id}")
        log_activity(existing.get("board_id", 0), "Removed ticket", label)
    return {
        "status": "deleted",
        "item_id": item_id,
        "local_only": True,
        "external_deleted": False,
    }


# ── Board management endpoints ───────────────────────────────────────────────


class CreateBoardRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    start_date: date
    end_date: date


class UpdateBoardRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


@app.get("/api/boards")
def list_boards(include_archived: bool = Query(False)) -> dict:
    boards = fetch_boards(include_archived=include_archived)
    return {"boards": boards, "total": len(boards)}


@app.post("/api/boards", status_code=201)
def create_board_endpoint(payload: CreateBoardRequest) -> dict:
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after start date")
    board = insert_board(
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        start_date=payload.start_date.isoformat(),
        end_date=payload.end_date.isoformat(),
    )
    return board


@app.get("/api/boards/{board_id}")
def get_board_endpoint(board_id: int) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@app.put("/api/boards/{board_id}")
def update_board_endpoint(board_id: int, payload: UpdateBoardRequest) -> dict:
    board = update_board(
        board_id=board_id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
    )
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@app.patch("/api/boards/{board_id}/archive")
def archive_board_endpoint(board_id: int) -> dict:
    board = archive_board(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@app.delete("/api/boards/{board_id}")
def delete_board_endpoint(board_id: int) -> dict:
    deleted = delete_board_record(board_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Board not found")
    return {"status": "deleted", "board_id": board_id}


@app.get("/api/boards/{board_id}/activity")
def get_board_activity(board_id: int, limit: int = Query(50, ge=1, le=200)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    events = fetch_activity(board_id, limit)
    return {"board_id": board_id, "events": events}


@app.post("/api/boards/{board_id}/clone")
def clone_board_endpoint(board_id: int) -> dict:
    src = fetch_board_by_id(board_id)
    if not src:
        raise HTTPException(status_code=404, detail="Board not found")
    new_board = insert_board(
        name=f"Copy of {src['name']}",
        description=src.get("description"),
        start_date=src.get("start_date"),
        end_date=src.get("end_date"),
    )
    return {"board": dict(new_board)}
