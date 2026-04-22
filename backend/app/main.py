import os
import sqlite3
from datetime import date, datetime, timedelta, timezone
from calendar import month_name
from base64 import b64encode

import bcrypt
import jwt
import requests
from openai import AzureOpenAI
from cryptography.fernet import Fernet
from dotenv import load_dotenv

# Load .env BEFORE any app imports so DB_PATH and other settings are available
load_dotenv()

from fastapi import FastAPI, HTTPException, Query, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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
    clear_team_row,
    delete_link,
    update_item_external_fields,
    update_item_position,
    # ── board management ──
    fetch_boards,
    insert_board,
    fetch_board_by_id,
    update_board,
    archive_board,
    assign_board_owner,
    delete_board_record,
    # ── activity log ──
    log_activity,
    fetch_activity,
    # ── auth ──
    create_user,
    fetch_user_by_username,
    fetch_user_by_id,
    fetch_all_users,
    delete_user,
    update_user,
    update_user_status,
    fetch_pending_user_count,
    fetch_users_with_board_count,
    fetch_boards_by_user,
    # ── kanban ──
    fetch_kanban_columns,
    insert_kanban_column,
    update_kanban_column,
    delete_kanban_column,
    fetch_kanban_rows,
    insert_kanban_row,
    update_kanban_row,
    delete_kanban_row,
    fetch_kanban_cards,
    insert_kanban_card,
    update_kanban_card,
    delete_kanban_card,
    # ── credentials ──
    init_credentials_table,
    upsert_credential,
    fetch_credentials_by_user,
    fetch_credential,
    delete_credential,
)

# ── Encryption config (for credential storage) ──────────────────────────
_FERNET_KEY = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
if not _FERNET_KEY:
    _FERNET_KEY = Fernet.generate_key().decode()
_fernet = Fernet(_FERNET_KEY.encode() if isinstance(_FERNET_KEY, str) else _FERNET_KEY)

# ── Azure OpenAI config ─────────────────────────────────────────────────
_AOAI_ENDPOINT = os.getenv("AOAI_ENDPOINT", "")
_AOAI_KEY = os.getenv("AOAI_API_KEY", "")
_AOAI_VERSION = os.getenv("AOAI_API_VERSION", "2024-12-01-preview")
_AOAI_DEPLOYMENT = os.getenv("AOAI_DEPLOYMENT", "gpt-5.1")
_AOAI_TEMPERATURE = float(os.getenv("AOAI_TEMPERATURE", "0.1"))
_AOAI_MAX_TOKENS = int(os.getenv("AOAI_MAX_TOKENS", "1000"))

_aoai_client: AzureOpenAI | None = None
if _AOAI_ENDPOINT and _AOAI_KEY:
    _aoai_client = AzureOpenAI(
        azure_endpoint=_AOAI_ENDPOINT,
        api_key=_AOAI_KEY,
        api_version=_AOAI_VERSION,
    )

# ── Auth config ──────────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "hcph-pi-board-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 12

_bearer_scheme = HTTPBearer(auto_error=False)

ADMIN_DEFAULT_USERNAME = "admin"
ADMIN_DEFAULT_PASSWORD = "admin"


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=4)


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _create_token(user_id: int, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = _decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = fetch_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


MILESTONE_ROW_INDEX = 0
ROWS = ["Milestone"] + [f"Team#{i}" for i in range(1, 11)]
SOURCE_JIRA = "jira"
SOURCE_ADO = "ado"

# All valid credential providers and jira-type helper
_VALID_PROVIDERS = {"jira", "jira_net", "ado"}
_JIRA_PROVIDERS = {"jira", "jira_net"}

def _is_jira_provider(provider: str) -> bool:
    return provider in _JIRA_PROVIDERS


def source_tile_color(source: str) -> str:
    if source == SOURCE_ADO:
        return "#d97706"
    if source == SOURCE_JIRA:
        return "#2563eb"
    if source == "jira_net":
        return "#0891b2"
    return "#475569"


class CreateMilestoneRequest(BaseModel):
    board_id: int
    issue_key: str | None = None
    ticket_source: str = Field(SOURCE_JIRA, pattern=r"^(jira|jira_net|ado)$")
    title: str | None = None
    target_date: date
    end_date: date
    is_temp: bool = False


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
    ticket_source: str = Field(SOURCE_JIRA, pattern=r"^(jira|jira_net|ado|internal)$")
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
    link_type: str = Field(..., pattern=r"^(blocks|is blocked by|is worklog for|has worklog in|depends on|is dependant|relates to|external link)$")


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


def fetch_jira_issue(issue_key: str, user_id: int | None = None, provider: str = "jira") -> dict:
    jira_base, auth, verify = _get_jira_connection_settings(user_id, provider=provider)

    endpoint = (
        f"{jira_base}/rest/api/2/issue/{issue_key}"
        "?fields=summary,issuetype,status,assignee,description,customfield_10231"
    )

    try:
        response = requests.get(endpoint, auth=auth, timeout=15, verify=verify)
        if response.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail=(
                    "JIRA authentication failed — username or password/token is incorrect. "
                    "Please check JIRA_USERNAME and JIRA_PASSWORD in the server .env file."
                ),
            )
        if response.status_code == 403:
            denied = response.headers.get("X-Authentication-Denied-Reason", "")
            login_reason = response.headers.get("X-Seraph-LoginReason", "")
            if "CAPTCHA" in denied.upper() or "DENIED" in login_reason.upper():
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "JIRA account is locked due to repeated failed logins (CAPTCHA triggered). "
                        "Please log out and log back in at your JIRA site to clear the lockout, then retry."
                    ),
                )
        response.raise_for_status()
    except HTTPException:
        raise
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


def fetch_jira_summary(issue_key: str, user_id: int | None = None) -> str:
    issue = fetch_jira_issue(issue_key, user_id)
    issue_type = issue["issue_type"]
    if issue_type.lower() != "idea":
        raise HTTPException(status_code=400, detail="Only IDEA issue type is allowed for Milestone row")
    return issue["summary"]


def fetch_jira_projects(user_id: int | None = None) -> list[dict]:
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def create_jira_issue(summary: str, issue_type_name: str = "Task", project_key: str | None = None, extra_fields: dict | None = None, user_id: int | None = None) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _decrypt_user_credential(user_id: int, provider: str) -> dict | None:
    """Decrypt and return the stored credentials for a user+provider, or None."""
    import json as _json
    cred = fetch_credential(user_id, provider)
    if not cred or not cred.get("encrypted_data"):
        return None
    try:
        decrypted = _fernet.decrypt(cred["encrypted_data"].encode()).decode()
        return _json.loads(decrypted)
    except Exception:
        return None


def _get_jira_connection_settings(user_id: int | None = None, provider: str = "jira") -> tuple[str, tuple[str, str] | None, bool | str]:
    jira_base = ""
    username = ""
    token = ""

    # Try DB credentials first
    if user_id:
        cred = _decrypt_user_credential(user_id, provider)
        if cred:
            jira_base = (cred.get("jira_url") or "").rstrip("/")
            username = cred.get("email") or ""
            token = cred.get("password") or ""

    # Fall back to env vars if DB didn't provide values (only for "jira" provider)
    if provider == "jira":
        if not jira_base:
            jira_base = (os.getenv("JIRA_BASE_URL") or os.getenv("JIRA_URL") or "").rstrip("/")
        if not username:
            username = os.getenv("JIRA_USERNAME") or ""
        if not token:
            token = os.getenv("JIRA_API_TOKEN") or os.getenv("JIRA_PASSWORD") or ""

    verify_ssl_raw = (os.getenv("JIRA_VERIFY_SSL") or "true").strip().lower()
    verify_ssl = verify_ssl_raw not in {"0", "false", "no"}
    ca_bundle_path = os.getenv("JIRA_CA_BUNDLE_PATH")

    if not jira_base:
        raise HTTPException(status_code=500, detail="JIRA URL is not configured. Please add your Jira credentials in Configuration.")

    auth = (username, token) if username and token else None
    verify: bool | str = ca_bundle_path if ca_bundle_path else verify_ssl
    return jira_base, auth, verify


def _jira_ssl_verify() -> bool | str:
    """Return the SSL verify value based on env config."""
    verify_ssl_raw = (os.getenv("JIRA_VERIFY_SSL") or "true").strip().lower()
    verify_ssl = verify_ssl_raw not in {"0", "false", "no"}
    ca_bundle_path = os.getenv("JIRA_CA_BUNDLE_PATH")
    return ca_bundle_path if ca_bundle_path else verify_ssl


def _get_ado_connection_settings(user_id: int | None = None) -> tuple[str, str, str]:
    """Return (organization, project, pat) for Azure DevOps."""
    organization = ""
    project = ""
    pat = ""

    # Read from DB credentials
    if user_id:
        cred = _decrypt_user_credential(user_id, "ado")
        if cred:
            organization = (cred.get("ado_org") or "").strip()
            project = (cred.get("ado_project") or "").strip()
            pat = (cred.get("pat") or "").strip()

    return organization, project, pat


def _resolve_jira_worklog_link_type(user_id: int | None = None) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _create_jira_worklog_link(worklog_issue_key: str, idea_issue_key: str, user_id: int | None = None) -> None:
    link_type = _resolve_jira_worklog_link_type(user_id)
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _resolve_jira_link_type_by_token(token: str, user_id: int | None = None) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _create_jira_blocks_link(source_issue_key: str, target_issue_key: str, user_id: int | None = None) -> None:
    preferred_phrase = "is blocked by"
    fallback_phrase = "relates to"
    active_phrase = preferred_phrase

    try:
        link_type = _resolve_jira_link_type_by_token(preferred_phrase, user_id)
    except HTTPException:
        link_type = _resolve_jira_link_type_by_token(fallback_phrase, user_id)
        active_phrase = fallback_phrase

    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _create_jira_relates_link(source_issue_key: str, target_issue_key: str, user_id: int | None = None) -> None:
    link_type = _resolve_jira_link_type_by_token("relates to", user_id)
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
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


def _create_jira_generic_link(source_issue_key: str, target_issue_key: str, link_phrase: str, user_id: int | None = None) -> None:
    link_type = _resolve_jira_link_type_by_token(link_phrase, user_id)
    jira_base, auth, verify = _get_jira_connection_settings(user_id)
    endpoint = f"{jira_base}/rest/api/2/issueLink"

    inward = (link_type.get("inward") or "").strip().lower()
    outward = (link_type.get("outward") or "").strip().lower()
    phrase = link_phrase.strip().lower()

    if phrase == inward:
        payload = {
            "type": {"name": link_type["name"]},
            "inwardIssue": {"key": source_issue_key},
            "outwardIssue": {"key": target_issue_key},
        }
    elif phrase == outward:
        payload = {
            "type": {"name": link_type["name"]},
            "outwardIssue": {"key": source_issue_key},
            "inwardIssue": {"key": target_issue_key},
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
        raise HTTPException(status_code=400, detail=f"Failed to create JIRA link ({link_phrase}): {exc}") from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not reach JIRA server") from exc


def _create_jira_link_for_board_type(source_issue_key: str, target_issue_key: str, board_link_type: str, user_id: int | None = None) -> None:
    _create_jira_generic_link(source_issue_key, target_issue_key, board_link_type, user_id)


def _build_ado_work_item_web_link(work_item_key: str, user_id: int | None = None) -> tuple[str, str]:
    work_item_id = _extract_ado_work_item_id(work_item_key)
    template = (os.getenv("ADO_WEB_LINK_TEMPLATE") or "").strip()
    organization, project, _pat = _get_ado_connection_settings(user_id)

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
        raise HTTPException(status_code=500, detail="ADO organization and project must be configured in your credentials")

    url = f"{base_url}/{organization}/{project}/_workitems/edit/{work_item_id}"
    return url, f"ADO {work_item_id}"


def _create_jira_web_link(issue_key: str, url: str, title: str, user_id: int | None = None, provider: str = "jira") -> None:
    jira_base, auth, verify = _get_jira_connection_settings(user_id, provider=provider)
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
    if normalized not in _VALID_PROVIDERS and normalized != "internal":
        raise HTTPException(status_code=400, detail=f"ticket_source must be one of {sorted(_VALID_PROVIDERS | {'internal'})}")
    return normalized


def _extract_ado_work_item_id(work_item_key: str) -> int:
    digits = "".join(ch for ch in work_item_key if ch.isdigit())
    if not digits:
        raise HTTPException(status_code=400, detail="ADO work item key must contain a numeric ID")
    return int(digits)


def fetch_ado_work_item(work_item_key: str, user_id: int | None = None) -> dict:
    organization, project, pat = _get_ado_connection_settings(user_id)

    if not organization or not project or not pat:
        raise HTTPException(status_code=500, detail="Azure DevOps is not configured. Please add your ADO credentials in Configuration.")

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


def create_ado_user_story(title: str, user_id: int | None = None) -> dict:
    organization, project, pat = _get_ado_connection_settings(user_id)

    if not organization or not project or not pat:
        raise HTTPException(status_code=500, detail="Azure DevOps is not configured. Please add your ADO credentials in Configuration.")

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
    allow_origin_regex=r"^https?://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    """Ensure unhandled exceptions (500s) always include CORS headers,
    so the browser never masks the real error as a CORS failure."""
    from starlette.responses import JSONResponse
    origin = request.headers.get("origin", "")
    headers = {}
    if origin:
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
        headers["vary"] = "Origin"
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=headers,
    )


# ── Auth guard middleware ────────────────────────────────────────────────
_PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/register"}


def _auth_error_response(request: Request, status_code: int, detail: str):
    """Return a JSON error with CORS headers so browsers can read it cross-origin."""
    from starlette.responses import JSONResponse
    origin = request.headers.get("origin", "")
    headers = {}
    if origin:
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
        headers["vary"] = "Origin"
    return JSONResponse(status_code=status_code, content={"detail": detail}, headers=headers)


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    path = request.url.path
    # Allow public paths, OPTIONS (CORS preflight), and non-API routes
    if path in _PUBLIC_PATHS or request.method == "OPTIONS" or not path.startswith("/api/"):
        return await call_next(request)
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        return _auth_error_response(request, 401, "Not authenticated")
    token = auth_header.split(" ", 1)[1]
    try:
        payload = _decode_token(token)
        user = fetch_user_by_id(payload["sub"])
        if not user:
            return _auth_error_response(request, 401, "User not found")
        request.state.user = user
    except jwt.ExpiredSignatureError:
        return _auth_error_response(request, 401, "Token expired")
    except jwt.InvalidTokenError:
        return _auth_error_response(request, 401, "Invalid token")
    return await call_next(request)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    init_credentials_table()
    # Seed default admin account if it doesn't exist
    if not fetch_user_by_username(ADMIN_DEFAULT_USERNAME):
        create_user(
            username=ADMIN_DEFAULT_USERNAME,
            display_name="Administrator",
            password_hash=_hash_password(ADMIN_DEFAULT_PASSWORD),
            role="admin",
        )


def _sync_external_ticket_fields(items: list[dict], user_id: int | None = None) -> list[dict]:
    synced: list[dict] = []
    for item in items:
        source = _normalize_ticket_source(item.get("ticket_source"))
        issue_key = (item.get("issue_key") or "").strip()

        if _is_jira_provider(source) and issue_key:
            try:
                issue = fetch_jira_issue(issue_key, user_id, provider=source)
            except HTTPException:
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

        elif source == SOURCE_ADO and issue_key:
            try:
                issue = fetch_ado_work_item(issue_key, user_id)
            except HTTPException:
                synced.append(item)
                continue

            changed = any(
                [
                    item.get("jira_assignee") != issue.get("assignee"),
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
                shirt_size=None,
                status=issue.get("status"),
                description=issue.get("description"),
            )
            synced.append(updated or item)

        else:
            synced.append(item)

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
def get_board(board_id: int = Query(...), refresh_external: bool = Query(False), user: dict = Depends(get_current_user)) -> dict:
    board_meta = fetch_board_by_id(board_id)
    if not board_meta:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and board_meta.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="You do not have access to this board")

    start = date.fromisoformat(board_meta["start_date"]) if board_meta.get("start_date") else date.today().replace(day=1)
    end = date.fromisoformat(board_meta["end_date"]) if board_meta.get("end_date") else None
    months = build_planning_columns(start, end)

    items = _sync_external_ticket_fields(fetch_items(board_id), user["id"]) if refresh_external else fetch_items(board_id)
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
def get_jira_projects_endpoint(user: dict = Depends(get_current_user)) -> dict:
    return {"projects": fetch_jira_projects(user["id"])}


@app.get("/api/jira/projects/{project_key}/issue-types")
def get_jira_project_issue_types(project_key: str, user: dict = Depends(get_current_user)) -> dict:
    jira_base, auth, verify = _get_jira_connection_settings(user["id"])
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
    user: dict = Depends(get_current_user),
) -> dict:
    """Discover field by name via /rest/api/2/field, then fetch its options via multiple fallbacks."""
    jira_base, auth, verify = _get_jira_connection_settings(user["id"])
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
def commit_board(board_id: int = Query(...), user: dict = Depends(get_current_user)) -> dict:
    board_meta = fetch_board_by_id(board_id)
    if not board_meta:
        raise HTTPException(status_code=404, detail="Board not found")
    start = date.fromisoformat(board_meta["start_date"]) if board_meta.get("start_date") else date.today().replace(day=1)
    end = date.fromisoformat(board_meta["end_date"]) if board_meta.get("end_date") else None
    months = build_planning_columns(start, end)
    total_slots = len(months) * 4

    items = _sync_external_ticket_fields(fetch_items(board_id), user["id"])
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
def create_milestone(payload: CreateMilestoneRequest, user: dict = Depends(get_current_user)) -> dict:
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

    # ── Temp (unsynced) milestone: skip JIRA fetch entirely ──
    if payload.is_temp:
        temp_title = (payload.title or "").strip()
        if not temp_title:
            raise HTTPException(status_code=400, detail="Title is required for temp milestones")
        raw_issue_key = (payload.issue_key or "").strip().upper() or None
        try:
            item = insert_item(
                {
                    "issue_key": raw_issue_key,
                    "title": temp_title,
                    "item_type": "IDEA",
                    "row_index": MILESTONE_ROW_INDEX,
                    "row_label": ROWS[MILESTONE_ROW_INDEX],
                    "start_slot": start_slot,
                    "end_slot": end_slot,
                    "target_date": payload.target_date.isoformat(),
                    "end_date": payload.end_date.isoformat(),
                    "ticket_source": ticket_source,
                    "sync_status": "unsynced",
                    "color": "#6b7280",
                },
                board_id=payload.board_id,
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail=f"{raw_issue_key or temp_title} already exists on this board")
        log_activity(payload.board_id, "Added temp milestone", f"{raw_issue_key or '(no key)'}: {temp_title}")
        return item

    # ── Normal (synced) milestone flow ──
    if not _is_jira_provider(ticket_source):
        raise HTTPException(status_code=400, detail="Milestones only support JIRA IDEA tickets")

    raw_issue_key = (payload.issue_key or "").strip()
    issue_key = raw_issue_key.upper() if _is_jira_provider(ticket_source) else raw_issue_key
    if not issue_key:
        raise HTTPException(status_code=400, detail="Existing JIRA IDEA key is required for milestones")

    issue: dict | None = None

    if _is_jira_provider(ticket_source):
        issue = fetch_jira_issue(issue_key, user["id"], provider=ticket_source)
        if issue["issue_type"].lower() != "idea":
            raise HTTPException(status_code=400, detail="Only IDEA issue type is allowed for Milestone row")
    else:
        issue = fetch_ado_work_item(issue_key, user["id"])
        _ensure_ado_user_story(issue, "Milestone row")

    issue_key = issue["issue_key"]
    title = issue["summary"]

    try:
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
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"{issue_key} already exists on this board")
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
def create_task(payload: CreateTaskRequest, user: dict = Depends(get_current_user)) -> dict:
    if payload.end_slot < payload.start_slot:
        raise HTTPException(status_code=400, detail="End slot must be on or after start slot")

    ticket_source = _normalize_ticket_source(payload.ticket_source)
    raw_issue_key = (payload.issue_key or "").strip()
    issue_key = raw_issue_key.upper() if _is_jira_provider(ticket_source) else raw_issue_key
    title = payload.title.strip()
    issue: dict | None = None
    jira_created = False
    jira_created_issue_key: str | None = None
    ado_created = False
    ado_created_issue_key: str | None = None
    sync_failed = False
    sync_error_message: str | None = None

    if ticket_source == "internal":
        # Internal / manual task — no external ticket creation
        if not title:
            raise HTTPException(status_code=400, detail="Task title is required for internal tasks")
        issue_key = ""
    elif issue_key:
        if _is_jira_provider(ticket_source):
            issue = fetch_jira_issue(issue_key, user["id"], provider=ticket_source)
        else:
            issue = fetch_ado_work_item(issue_key, user["id"])
            _ensure_ado_user_story(issue, "Task row")

        issue_key = issue["issue_key"]
        title = issue["summary"]
    else:
        if not title:
            raise HTTPException(status_code=400, detail="Task title is required when issue key is not provided")
        if _is_jira_provider(ticket_source):
            issue_type_name = (payload.jira_issue_type or "Task").strip() or "Task"
            try:
                created = create_jira_issue(
                    summary=title,
                    issue_type_name=issue_type_name,
                    project_key=payload.jira_project_key,
                    extra_fields=payload.jira_extra_fields,
                    user_id=user["id"],
                )
                jira_created = True
                jira_created_issue_key = created["issue_key"]
                issue = fetch_jira_issue(created["issue_key"], user["id"], provider=ticket_source)
                issue_key = issue["issue_key"]
                title = issue["summary"]
            except Exception as exc:
                sync_failed = True
                sync_error_message = str(exc)
        else:
            try:
                created = create_ado_user_story(title=title, user_id=user["id"])
                ado_created = True
                ado_created_issue_key = created["issue_key"]
                issue = fetch_ado_work_item(created["issue_key"], user["id"])
                _ensure_ado_user_story(issue, "Task row")
                issue_key = issue["issue_key"]
                title = issue["summary"]
            except Exception as exc:
                sync_failed = True
                sync_error_message = str(exc)

    if not title:
        raise HTTPException(status_code=400, detail="Task title is required when issue key is not provided")

    system_label = "Internal" if ticket_source == "internal" else ("JIRA.net" if ticket_source == "jira_net" else ("JIRA" if ticket_source == SOURCE_JIRA else "Azure DevOps"))
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


@app.delete("/api/team-rows/{row_index}")
def delete_team_row(row_index: int, board_id: int = Query(..., gt=0)) -> dict:
    if row_index <= 0 or row_index >= len(ROWS):
        raise HTTPException(status_code=400, detail="Invalid team row index")

    result = clear_team_row(board_id=board_id, row_index=row_index)
    log_activity(board_id, "Cleared team row", f"Row {row_index}: removed team + {result['deleted_items']} item(s)")
    return {
        "status": "cleared",
        "board_id": board_id,
        "row_index": row_index,
        "deleted_items": result["deleted_items"],
    }


@app.get("/api/team-rows/{row_index}/items-count")
def get_team_row_items_count(row_index: int, board_id: int = Query(..., gt=0)) -> dict:
    if row_index <= 0 or row_index >= len(ROWS):
        raise HTTPException(status_code=400, detail="Invalid team row index")
    items = fetch_items(board_id)
    count = sum(1 for item in items if item["row_index"] == row_index)
    return {"board_id": board_id, "row_index": row_index, "items_count": count}


@app.post("/api/links")
def create_link(payload: CreateLinkRequest, user: dict = Depends(get_current_user)) -> dict:
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

    # If either item is unsynced, skip all external linking and just save locally
    source_unsynced = source_item.get("sync_status") == "unsynced"
    target_unsynced = target_item.get("sync_status") == "unsynced"
    skip_external_link = source_unsynced or target_unsynced

    idea_item = source_item if source_is_idea else (target_item if target_is_idea else None)
    worklog_item = target_item if source_is_idea else (source_item if target_is_idea else None)

    if not skip_external_link:
        # Use the user's selected link type for all JIRA-to-JIRA links (same provider)
        if (
            source_key
            and target_key
            and _is_jira_provider(source_source)
            and _is_jira_provider(target_source)
            and source_source == target_source
        ):
            _create_jira_link_for_board_type(source_key, target_key, payload.link_type, user["id"])
            jira_link_synced = True

        # Cross-JIRA-provider links (jira <-> jira_net): create web links on both sides
        if (
            source_key
            and target_key
            and _is_jira_provider(source_source)
            and _is_jira_provider(target_source)
            and source_source != target_source
        ):
            # Build URLs for each ticket on their respective JIRA instance
            source_base, _, _ = _get_jira_connection_settings(user["id"], provider=source_source)
            target_base, _, _ = _get_jira_connection_settings(user["id"], provider=target_source)
            source_url = f"{source_base}/browse/{source_key}"
            target_url = f"{target_base}/browse/{target_key}"
            # Create web link on source JIRA pointing to target
            try:
                _create_jira_web_link(source_key, target_url, target_key, user["id"], provider=source_source)
            except Exception:
                pass  # best-effort
            # Create web link on target JIRA pointing to source
            try:
                _create_jira_web_link(target_key, source_url, source_key, user["id"], provider=target_source)
            except Exception:
                pass  # best-effort
            jira_link_synced = True

        if idea_item and worklog_item:
            idea_key = (idea_item.get("issue_key") or "").strip()
            worklog_key = (worklog_item.get("issue_key") or "").strip()
            idea_source = _normalize_ticket_source(idea_item.get("ticket_source"))
            worklog_source = _normalize_ticket_source(worklog_item.get("ticket_source"))

            if idea_key and worklog_key and _is_jira_provider(idea_source) and worklog_source == SOURCE_ADO:
                ado_url, ado_title = _build_ado_work_item_web_link(worklog_key, user["id"])
                _create_jira_web_link(idea_key, ado_url, ado_title, user["id"], provider=idea_source)
                jira_link_synced = True

    try:
        created = insert_link(payload.source_item_id, payload.target_item_id, payload.link_type)
        created["jira_link_synced"] = jira_link_synced
        if skip_external_link:
            created["message"] = "Link saved locally only (one or both items are unsynced)"
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


# ── Auth endpoints ───────────────────────────────────────────────────────

@app.post("/api/auth/login")
def auth_login(payload: LoginRequest) -> dict:
    user = fetch_user_by_username(payload.username)
    if not user or not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    status = user.get("status", "approved")
    if status == "pending":
        raise HTTPException(status_code=403, detail="Your account is pending admin approval.")
    token = _create_token(user["id"], user["username"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
        },
    }


@app.post("/api/auth/register")
def auth_register(payload: RegisterRequest) -> dict:
    existing = fetch_user_by_username(payload.username)
    if existing:
        status = existing.get("status", "approved")
        if status == "pending":
            raise HTTPException(status_code=409, detail="You already have a pending registration request. Please wait for admin approval.")
        raise HTTPException(status_code=409, detail="Username already taken")
    hashed = _hash_password(payload.password)
    user = create_user(
        username=payload.username,
        display_name=payload.display_name,
        password_hash=hashed,
        role="user",
        status="pending",
    )
    return {
        "pending": True,
        "message": "Your account has been created and is pending admin approval.",
    }


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
    }


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    password: str | None = Field(None, min_length=4)
    current_password: str | None = None


@app.put("/api/auth/profile")
def update_profile(payload: ProfileUpdateRequest, user: dict = Depends(get_current_user)) -> dict:
    if payload.password:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="Current password is required to set a new password")
        if not _verify_password(payload.current_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    pw_hash = _hash_password(payload.password) if payload.password else None
    updated = update_user(user["id"], display_name=payload.display_name, password_hash=pw_hash)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return updated


# ── Admin credential management ─────────────────────────────────────────

class CredentialRequest(BaseModel):
    provider: str = Field(..., pattern=r"^(jira|jira_net|ado)$")
    label: str | None = None
    # Jira fields
    email: str | None = None
    password: str | None = None
    jira_url: str | None = None
    # Azure DevOps fields
    pat: str | None = None
    ado_org: str | None = None
    ado_project: str | None = None


@app.get("/api/admin/users/{user_id}/credentials")
def admin_list_user_credentials(user_id: int, admin: dict = Depends(require_admin)) -> dict:
    target = fetch_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    creds = fetch_credentials_by_user(user_id)
    return {"credentials": creds}


@app.put("/api/admin/users/{user_id}/credentials/{provider}")
def admin_save_user_credential(user_id: int, provider: str, body: CredentialRequest, admin: dict = Depends(require_admin)) -> dict:
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")
    target = fetch_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    import json as _json
    if _is_jira_provider(provider):
        if not body.email or not body.password:
            raise HTTPException(status_code=400, detail="Jira requires email and password")
        secret_payload = _json.dumps({"email": body.email, "password": body.password, "jira_url": body.jira_url or ""})
    else:
        if not body.pat:
            raise HTTPException(status_code=400, detail="Azure DevOps requires a PAT")
        secret_payload = _json.dumps({"pat": body.pat, "ado_org": body.ado_org or "", "ado_project": body.ado_project or ""})

    encrypted = _fernet.encrypt(secret_payload.encode()).decode()
    result = upsert_credential(user_id, provider, encrypted, body.label)
    return {"credential": result}


@app.delete("/api/admin/users/{user_id}/credentials/{provider}")
def admin_delete_user_credential(user_id: int, provider: str, admin: dict = Depends(require_admin)) -> dict:
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")
    deleted = delete_credential(user_id, provider)
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"status": "deleted", "provider": provider}


# ── Kanban endpoints ────────────────────────────────────────────────────

class KanbanColumnRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = "#3b82f6"

class KanbanRowRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = "#6b7280"

class KanbanCardRequest(BaseModel):
    column_id: int
    row_id: int | None = None
    title: str = Field(..., min_length=1, max_length=500)
    color: str = "#1f6688"
    issue_key: str | None = None
    ticket_source: str | None = Field(None, pattern="^(jira|jira_net|ado)$")
    description: str | None = None
    assignee: str | None = None
    external_status: str | None = None
    external_url: str | None = None
    external_title: str | None = None

class KanbanCardMoveRequest(BaseModel):
    column_id: int | None = None
    row_id: int | None = None
    title: str | None = None
    color: str | None = None


@app.get("/api/kanban/ticket-lookup")
def kanban_ticket_lookup(key: str = Query(..., min_length=1), source: str = Query(..., pattern="^(jira|jira_net|ado)$"), user: dict = Depends(get_current_user)) -> dict:
    """Fetch ticket info from JIRA, JIRA.net, or ADO by exact key."""
    try:
        if _is_jira_provider(source):
            ticket = fetch_jira_issue(key.strip(), user["id"], provider=source)
            jira_base, _, _ = _get_jira_connection_settings(user["id"], provider=source)
            external_url = f"{jira_base}/browse/{ticket['issue_key']}"
        else:
            ticket = fetch_ado_work_item(key.strip(), user["id"])
            org, project, _ = _get_ado_connection_settings(user["id"])
            external_url = f"https://dev.azure.com/{org}/{project}/_workitems/edit/{ticket['issue_key']}"
        return {
            "issue_key": ticket["issue_key"],
            "summary": ticket["summary"],
            "issue_type": ticket.get("issue_type"),
            "status": ticket.get("status"),
            "assignee": ticket.get("assignee"),
            "description": ticket.get("description"),
            "source": source,
            "external_url": external_url,
        }
    except HTTPException:
        raise
    except Exception as e:
        src_label = "JIRA.net" if source == "jira_net" else ("JIRA" if source == "jira" else ("Internal" if source == "internal" else "ADO"))
        raise HTTPException(status_code=404, detail=f"Could not find {src_label} ticket '{key}'. Check the key and your integration credentials.")


@app.get("/api/kanban/{board_id}")
def get_kanban_board(board_id: int) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if board.get("board_type") != "kanban":
        raise HTTPException(status_code=400, detail="Not a kanban board")
    return {
        "board": board,
        "columns": fetch_kanban_columns(board_id),
        "rows": fetch_kanban_rows(board_id),
        "cards": fetch_kanban_cards(board_id),
    }


@app.post("/api/kanban/{board_id}/columns", status_code=201)
def create_kanban_column(board_id: int, payload: KanbanColumnRequest) -> dict:
    board = fetch_board_by_id(board_id)
    if not board or board.get("board_type") != "kanban":
        raise HTTPException(status_code=404, detail="Kanban board not found")
    col = insert_kanban_column(board_id, payload.name.strip(), payload.color)
    log_activity(board_id, "Added column", payload.name.strip())
    return col


@app.put("/api/kanban/columns/{col_id}")
def edit_kanban_column(col_id: int, payload: KanbanColumnRequest) -> dict:
    col = update_kanban_column(col_id, payload.name.strip(), payload.color)
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    return col


@app.delete("/api/kanban/columns/{col_id}")
def remove_kanban_column(col_id: int) -> dict:
    if not delete_kanban_column(col_id):
        raise HTTPException(status_code=404, detail="Column not found")
    return {"status": "deleted"}


@app.post("/api/kanban/{board_id}/rows", status_code=201)
def create_kanban_row(board_id: int, payload: KanbanRowRequest) -> dict:
    board = fetch_board_by_id(board_id)
    if not board or board.get("board_type") != "kanban":
        raise HTTPException(status_code=404, detail="Kanban board not found")
    row = insert_kanban_row(board_id, payload.name.strip(), payload.color)
    log_activity(board_id, "Added row", payload.name.strip())
    return row


@app.put("/api/kanban/rows/{row_id}")
def edit_kanban_row(row_id: int, payload: KanbanRowRequest) -> dict:
    row = update_kanban_row(row_id, payload.name.strip(), payload.color)
    if not row:
        raise HTTPException(status_code=404, detail="Row not found")
    return row


@app.delete("/api/kanban/rows/{row_id}")
def remove_kanban_row(row_id: int) -> dict:
    if not delete_kanban_row(row_id):
        raise HTTPException(status_code=404, detail="Row not found")
    return {"status": "deleted"}


@app.post("/api/kanban/{board_id}/cards", status_code=201)
def create_kanban_card(board_id: int, payload: KanbanCardRequest) -> dict:
    board = fetch_board_by_id(board_id)
    if not board or board.get("board_type") != "kanban":
        raise HTTPException(status_code=404, detail="Kanban board not found")
    card = insert_kanban_card(
        board_id, payload.column_id, payload.row_id,
        payload.title.strip(), payload.color,
        issue_key=payload.issue_key.strip() if payload.issue_key else None,
        ticket_source=payload.ticket_source,
        description=payload.description,
        assignee=payload.assignee,
        external_status=payload.external_status,
        external_url=payload.external_url,
        external_title=payload.external_title,
    )
    log_activity(board_id, "Added card", payload.title.strip()[:50])
    return card


@app.put("/api/kanban/cards/{card_id}")
def edit_kanban_card(card_id: int, payload: KanbanCardMoveRequest) -> dict:
    card = update_kanban_card(card_id, title=payload.title, column_id=payload.column_id, row_id=payload.row_id, color=payload.color)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@app.delete("/api/kanban/cards/{card_id}")
def remove_kanban_card(card_id: int) -> dict:
    if not delete_kanban_card(card_id):
        raise HTTPException(status_code=404, detail="Card not found")
    return {"status": "deleted"}


@app.get("/api/admin/users")
def admin_list_users(admin: dict = Depends(require_admin)) -> list[dict]:
    users = fetch_users_with_board_count()
    # Enrich each user with their configured integration providers
    for u in users:
        creds = fetch_credentials_by_user(u["id"])
        u["integrations"] = [c["provider"] for c in creds]
    return users


class AdminCreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=4)
    role: str = Field("user", pattern=r"^(user|admin)$")


class AdminUpdateUserRequest(BaseModel):
    display_name: str | None = None
    role: str | None = Field(None, pattern=r"^(user|admin)$")
    password: str | None = Field(None, min_length=4)


@app.post("/api/admin/users", status_code=201)
def admin_create_user(payload: AdminCreateUserRequest, admin: dict = Depends(require_admin)) -> dict:
    existing = fetch_user_by_username(payload.username)
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    pw_hash = _hash_password(payload.password)
    user = create_user(payload.username, payload.display_name, pw_hash, payload.role)
    return user


@app.put("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: AdminUpdateUserRequest, admin: dict = Depends(require_admin)) -> dict:
    pw_hash = _hash_password(payload.password) if payload.password else None
    updated = update_user(
        user_id,
        display_name=payload.display_name,
        role=payload.role,
        password_hash=pw_hash,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return updated


@app.get("/api/admin/users/{user_id}/boards")
def admin_user_boards(user_id: int, admin: dict = Depends(require_admin)) -> list[dict]:
    return fetch_boards_by_user(user_id)


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, admin: dict = Depends(require_admin)) -> dict:
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    deleted = delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted", "user_id": user_id}


@app.patch("/api/admin/users/{user_id}/approve")
def admin_approve_user(user_id: int, admin: dict = Depends(require_admin)) -> dict:
    user = fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("status") != "pending":
        raise HTTPException(status_code=400, detail="User is not in pending status")
    update_user_status(user_id, "approved")
    return {"status": "approved", "user_id": user_id}


@app.patch("/api/admin/users/{user_id}/reject")
def admin_reject_user(user_id: int, admin: dict = Depends(require_admin)) -> dict:
    user = fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("status") != "pending":
        raise HTTPException(status_code=400, detail="User is not in pending status")
    delete_user(user_id)
    return {"status": "rejected", "user_id": user_id}


@app.get("/api/admin/pending-count")
def admin_pending_count(admin: dict = Depends(require_admin)) -> dict:
    return {"count": fetch_pending_user_count()}


class AssignBoardRequest(BaseModel):
    user_id: int


@app.patch("/api/admin/boards/{board_id}/assign")
def admin_assign_board(board_id: int, payload: AssignBoardRequest, admin: dict = Depends(require_admin)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    target_user = fetch_user_by_id(payload.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    updated = assign_board_owner(board_id, payload.user_id)
    return updated


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
    start_date: date | None = None
    end_date: date | None = None
    board_type: str = Field(default="pi_planning", pattern=r"^(pi_planning|kanban)$")


class UpdateBoardRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None


@app.get("/api/boards")
def list_boards(include_archived: bool = Query(False), user: dict = Depends(get_current_user)) -> dict:
    if user["role"] == "admin":
        boards = fetch_boards(include_archived=include_archived)
    else:
        boards = fetch_boards_by_user(user["id"], include_archived=include_archived)
    return {"boards": boards, "total": len(boards)}


@app.post("/api/boards", status_code=201)
def create_board_endpoint(payload: CreateBoardRequest, user: dict = Depends(get_current_user)) -> dict:
    if payload.board_type == "pi_planning":
        if not payload.start_date or not payload.end_date:
            raise HTTPException(status_code=400, detail="Start and end dates are required for PI Planning boards")
        if payload.end_date < payload.start_date:
            raise HTTPException(status_code=400, detail="End date must be on or after start date")
    board = insert_board(
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        start_date=payload.start_date.isoformat() if payload.start_date else None,
        end_date=payload.end_date.isoformat() if payload.end_date else None,
        created_by=user["id"],
        board_type=payload.board_type,
    )
    return board


@app.get("/api/boards/{board_id}")
def get_board_endpoint(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and board.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="You do not have access to this board")
    return board


@app.put("/api/boards/{board_id}")
def update_board_endpoint(board_id: int, payload: UpdateBoardRequest, user: dict = Depends(get_current_user)) -> dict:
    existing = fetch_board_by_id(board_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and existing.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the board creator or an admin can edit this board")
    board = update_board(
        board_id=board_id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
    )
    return board


@app.patch("/api/boards/{board_id}/archive")
def archive_board_endpoint(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    existing = fetch_board_by_id(board_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and existing.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the board creator or an admin can archive this board")
    board = archive_board(board_id)
    return board


@app.delete("/api/boards/{board_id}")
def delete_board_endpoint(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    existing = fetch_board_by_id(board_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and existing.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the board creator or an admin can delete this board")
    deleted = delete_board_record(board_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Board not found")
    return {"status": "deleted", "board_id": board_id}


@app.get("/api/boards/{board_id}/activity")
def get_board_activity(board_id: int, limit: int = Query(50, ge=1, le=200), user: dict = Depends(get_current_user)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and board.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="You do not have access to this board")
    events = fetch_activity(board_id, limit)
    return {"board_id": board_id, "events": events}


@app.post("/api/boards/{board_id}/clone")
def clone_board_endpoint(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    src = fetch_board_by_id(board_id)
    if not src:
        raise HTTPException(status_code=404, detail="Board not found")
    if user["role"] != "admin" and src.get("created_by") != user["id"]:
        raise HTTPException(status_code=403, detail="You do not have access to this board")
    new_board = insert_board(
        name=f"Copy of {src['name']}",
        description=src.get("description"),
        start_date=src.get("start_date"),
        end_date=src.get("end_date"),
        created_by=user["id"],
    )
    return {"board": dict(new_board)}


# ── Credential management endpoints ─────────────────────────────────────

@app.get("/api/credentials")
def list_credentials(user: dict = Depends(get_current_user)) -> dict:
    creds = fetch_credentials_by_user(user["id"])
    safe = [{k: v for k, v in c.items() if k != "encrypted_data"} for c in creds]
    return {"credentials": safe}


@app.get("/api/credentials/{provider}/details")
def get_credential_details(provider: str, user: dict = Depends(get_current_user)) -> dict:
    """Return decrypted credential fields for editing (passwords/PATs masked)."""
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")
    cred = fetch_credential(user["id"], provider)
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    import json as _json
    try:
        decrypted = _json.loads(_fernet.decrypt(cred["encrypted_data"].encode()).decode())
    except Exception:
        raise HTTPException(status_code=500, detail="Could not decrypt credential")
    if _is_jira_provider(provider):
        pw = decrypted.get("password", "")
        return {
            "provider": provider,
            "label": cred.get("label", ""),
            "email": decrypted.get("email", ""),
            "jira_url": decrypted.get("jira_url", ""),
            "password_masked": ("•" * max(0, len(pw) - 4)) + pw[-4:] if len(pw) > 4 else "•" * len(pw),
        }
    else:
        pat = decrypted.get("pat", "")
        return {
            "provider": "ado",
            "label": cred.get("label", ""),
            "ado_org": decrypted.get("ado_org", ""),
            "ado_project": decrypted.get("ado_project", ""),
            "pat_masked": ("•" * max(0, len(pat) - 4)) + pat[-4:] if len(pat) > 4 else "•" * len(pat),
        }


@app.put("/api/credentials/{provider}")
def save_credential(provider: str, body: CredentialRequest, user: dict = Depends(get_current_user)) -> dict:
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")
    if body.provider != provider:
        raise HTTPException(status_code=400, detail="Provider in URL and body must match")

    import json as _json

    # Merge with stored credential when password/PAT not provided (edit mode)
    stored_decrypted = {}
    if (_is_jira_provider(provider) and not body.password) or (provider == "ado" and not body.pat):
        stored = fetch_credential(user["id"], provider)
        if stored:
            try:
                stored_decrypted = _json.loads(_fernet.decrypt(stored["encrypted_data"].encode()).decode())
            except Exception:
                pass

    if _is_jira_provider(provider):
        email = body.email or stored_decrypted.get("email", "")
        password = body.password or stored_decrypted.get("password", "")
        jira_url = body.jira_url or stored_decrypted.get("jira_url", "")
        if not email or not password:
            raise HTTPException(status_code=400, detail="Jira requires email and password")
        secret_payload = _json.dumps({
            "email": email,
            "password": password,
            "jira_url": jira_url,
        })
    else:
        pat = body.pat or stored_decrypted.get("pat", "")
        ado_org = body.ado_org or stored_decrypted.get("ado_org", "")
        ado_project = body.ado_project or stored_decrypted.get("ado_project", "")
        if not pat:
            raise HTTPException(status_code=400, detail="Azure DevOps requires a PAT")
        secret_payload = _json.dumps({
            "pat": pat,
            "ado_org": ado_org,
            "ado_project": ado_project,
        })

    encrypted = _fernet.encrypt(secret_payload.encode()).decode()
    result = upsert_credential(user["id"], provider, encrypted, body.label)
    return {"credential": result}


@app.delete("/api/credentials/{provider}")
def remove_credential(provider: str, user: dict = Depends(get_current_user)) -> dict:
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")
    deleted = delete_credential(user["id"], provider)
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found")
    return {"status": "deleted", "provider": provider}


@app.get("/api/credentials/health")
def credentials_health(user: dict = Depends(get_current_user)) -> dict:
    """Test all stored credentials for the current user (non-blocking health check)."""
    import json as _json
    creds = fetch_credentials_by_user(user["id"])
    results = {}
    for cred in creds:
        provider = cred["provider"]
        try:
            decrypted = _json.loads(_fernet.decrypt(cred["encrypted_data"].encode()).decode())
        except Exception:
            results[provider] = {"status": "failed", "message": "Could not decrypt credentials"}
            continue
        try:
            if _is_jira_provider(provider):
                jira_url = (decrypted.get("jira_url") or ("" if provider != "jira" else os.getenv("JIRA_URL", ""))).rstrip("/")
                if not jira_url:
                    results[provider] = {"status": "failed", "message": "No Jira URL configured"}
                    continue
                resp = requests.get(
                    f"{jira_url}/rest/api/2/myself",
                    auth=(decrypted.get("email", ""), decrypted.get("password", "")),
                    verify=_jira_ssl_verify(),
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    results[provider] = {"status": "success", "message": f"Connected as {data.get('displayName', 'OK')}"}
                else:
                    results[provider] = {"status": "failed", "message": f"HTTP {resp.status_code}"}
            elif provider == "ado":
                ado_org = decrypted.get("ado_org") or ""
                if not ado_org:
                    results[provider] = {"status": "failed", "message": "No ADO organization configured"}
                    continue
                resp = requests.get(
                    f"https://dev.azure.com/{ado_org}/_apis/projects?api-version=7.0",
                    auth=("", decrypted.get("pat", "")),
                    timeout=10,
                )
                if resp.status_code == 200:
                    results[provider] = {"status": "success", "message": "Connected"}
                else:
                    results[provider] = {"status": "failed", "message": f"HTTP {resp.status_code}"}
        except requests.RequestException as exc:
            results[provider] = {"status": "failed", "message": str(exc)[:120]}
    return {"results": results}


@app.post("/api/credentials/{provider}/test")
def test_credential(provider: str, body: CredentialRequest, user: dict = Depends(get_current_user)) -> dict:
    if provider not in _VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Provider must be one of {sorted(_VALID_PROVIDERS)}")

    # Fall back to stored credentials when password/PAT not provided (edit mode)
    import json as _json
    email = body.email or ""
    password = body.password or ""
    pat = body.pat or ""
    ado_org = body.ado_org or ""
    ado_project = body.ado_project or ""
    jira_url = body.jira_url or ""

    if (_is_jira_provider(provider) and not password) or (provider == "ado" and not pat):
        stored = fetch_credential(user["id"], provider)
        if stored:
            try:
                decrypted = _json.loads(_fernet.decrypt(stored["encrypted_data"].encode()).decode())
                if _is_jira_provider(provider):
                    password = password or decrypted.get("password", "")
                    email = email or decrypted.get("email", "")
                    jira_url = jira_url or decrypted.get("jira_url", "")
                else:
                    pat = pat or decrypted.get("pat", "")
                    ado_org = ado_org or decrypted.get("ado_org", "")
                    ado_project = ado_project or decrypted.get("ado_project", "")
            except Exception:
                return {"status": "failed", "message": "Could not decrypt stored credential"}

    if _is_jira_provider(provider):
        if not email or not password:
            raise HTTPException(status_code=400, detail="Jira requires email and password")
        jira_url = (jira_url or ("" if provider != "jira" else os.getenv("JIRA_URL", ""))).rstrip("/")
        if not jira_url:
            raise HTTPException(status_code=400, detail="Jira URL is required")
        try:
            resp = requests.get(
                f"{jira_url}/rest/api/2/myself",
                auth=(email, password),
                verify=_jira_ssl_verify(),
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                return {"status": "success", "message": f"Connected as {data.get('displayName', data.get('emailAddress', 'OK'))}"}
            else:
                return {"status": "failed", "message": f"Jira returned HTTP {resp.status_code}"}
        except UnicodeEncodeError:
            return {"status": "failed", "message": "Password contains invalid characters — please re-enter it"}
        except requests.RequestException as exc:
            return {"status": "failed", "message": str(exc)}

    else:  # ado
        if not pat:
            raise HTTPException(status_code=400, detail="Azure DevOps requires a PAT")
        if not ado_org:
            raise HTTPException(status_code=400, detail="Azure DevOps organization is required")
        try:
            resp = requests.get(
                f"https://dev.azure.com/{ado_org}/_apis/projects?api-version=7.0",
                auth=("", pat),
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                count = data.get("count", len(data.get("value", [])))
                return {"status": "success", "message": f"Connected — {count} project(s) found"}
            else:
                return {"status": "failed", "message": f"Azure DevOps returned HTTP {resp.status_code}"}
        except requests.RequestException as exc:
            return {"status": "failed", "message": str(exc)}


# ══════════════════════════════════════════════════════════════════════════
# LLM Insight Generator
# ══════════════════════════════════════════════════════════════════════════

def _get_status_tone(status: str) -> str:
    """Mirror frontend getStatusTone for server-side RAG calculation."""
    v = (status or "").lower()
    if not v:
        return "unknown"
    if "done" in v or "resolved" in v or "closed" in v:
        return "done"
    if "cancel" in v:
        return "cancelled"
    if "block" in v or "hold" in v:
        return "blocked"
    if "dev" in v or "progress" in v or "active" in v or "ongoing" in v:
        return "in-progress"
    if "todo" in v or "open" in v or "backlog" in v or "new" in v:
        return "todo"
    return "unknown"


def _gather_milestone_context(milestone_id: int) -> dict | None:
    """Gather all data needed for a milestone insight prompt."""
    item = fetch_item_by_id(milestone_id)
    if not item or item.get("item_type") != "IDEA":
        return None
    board_id = item.get("board_id", 0)
    board = fetch_board_by_id(board_id)
    all_items = fetch_items(board_id)
    all_links = fetch_links(board_id)

    # Find linked task IDs
    linked_ids = set()
    for link in all_links:
        if link["source_item_id"] == milestone_id:
            linked_ids.add(link["target_item_id"])
        if link["target_item_id"] == milestone_id:
            linked_ids.add(link["source_item_id"])

    linked_tasks = [it for it in all_items if it["id"] in linked_ids and it.get("item_type") != "IDEA"]
    total = len(linked_tasks)
    cancelled = sum(1 for t in linked_tasks if _get_status_tone(t.get("jira_status")) == "cancelled")
    effective_total = total - cancelled
    done = sum(1 for t in linked_tasks if _get_status_tone(t.get("jira_status")) == "done")
    blocked = sum(1 for t in linked_tasks if _get_status_tone(t.get("jira_status")) == "blocked")
    in_progress = sum(1 for t in linked_tasks if _get_status_tone(t.get("jira_status")) == "in-progress")
    pct = round(done / effective_total * 100) if effective_total else 0

    # Timeline
    today_str = date.today().isoformat()
    board_start = board.get("start_date", "") if board else ""
    board_end = board.get("end_date", "") if board else ""
    ms_start = item.get("target_date") or board_start
    ms_end = item.get("end_date") or board_end

    return {
        "milestone": item,
        "board": board,
        "linked_tasks": linked_tasks,
        "total": total,
        "done": done,
        "blocked": blocked,
        "in_progress": in_progress,
        "pct": pct,
        "ms_start": ms_start,
        "ms_end": ms_end,
        "today": today_str,
    }


def _build_milestone_prompt(ctx: dict) -> str:
    ms = ctx["milestone"]
    tasks_text = ""
    for t in ctx["linked_tasks"]:
        tasks_text += f"  - {t.get('issue_key', 'N/A')} \"{t.get('title', '')}\" -- Status: {t.get('jira_status', 'N/A')} -- Assignee: {t.get('jira_assignee', 'Unassigned')}\n"
    if not tasks_text:
        tasks_text = "  (no linked tasks)\n"

    return (
        "You are an agile delivery advisor analyzing a PI Planning milestone.\n\n"
        f"Milestone: {ms.get('issue_key', 'N/A')} \"{ms.get('title', 'Untitled')}\"\n"
        f"Timeline: {ctx['ms_start']} to {ctx['ms_end']} (Today: {ctx['today']})\n"
        f"Progress: {ctx['pct']}% ({ctx['done']}/{ctx['total']} tasks done, {ctx['blocked']} blocked, {ctx['in_progress']} in progress)\n\n"
        f"Linked Tasks:\n{tasks_text}\n"
        "Provide a concise analysis in exactly this JSON format (no markdown, no code fences):\n"
        '{\n'
        '  "health_summary": "2-3 sentence overall health assessment",\n'
        '  "risks": ["risk 1", "risk 2", "risk 3"],\n'
        '  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]\n'
        '}\n'
        "Keep each item brief (1 sentence). Focus on actionable insights."
    )


def _build_board_prompt(board: dict, milestones_ctx: list[dict]) -> str:
    ms_summaries = ""
    for ctx in milestones_ctx:
        ms = ctx["milestone"]
        ms_summaries += f"  - {ms.get('issue_key', 'N/A')} \"{ms.get('title', '')}\" -- {ctx['pct']}% done ({ctx['done']}/{ctx['total']}), {ctx['blocked']} blocked\n"
    if not ms_summaries:
        ms_summaries = "  (no milestones)\n"

    return (
        "You are an agile delivery advisor providing a board-level PI health summary.\n\n"
        f"Board: \"{board.get('name', 'Untitled')}\"\n"
        f"Timeline: {board.get('start_date', 'N/A')} to {board.get('end_date', 'N/A')} (Today: {date.today().isoformat()})\n\n"
        f"Milestones:\n{ms_summaries}\n"
        "Provide a concise board-level analysis in exactly this JSON format (no markdown, no code fences):\n"
        '{\n'
        '  "health_summary": "2-3 sentence overall PI health assessment across all milestones",\n'
        '  "risks": ["risk 1", "risk 2", "risk 3"],\n'
        '  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]\n'
        '}\n'
        "Keep each item brief (1 sentence). Focus on cross-cutting risks and portfolio-level insights."
    )


def _call_llm(prompt: str) -> dict:
    """Send prompt to Azure OpenAI and parse the JSON response."""
    if not _aoai_client:
        raise HTTPException(status_code=503, detail="Azure OpenAI is not configured")
    import json as _json
    try:
        response = _aoai_client.chat.completions.create(
            model=_AOAI_DEPLOYMENT,
            messages=[{"role": "user", "content": prompt}],
            temperature=_AOAI_TEMPERATURE,
            max_completion_tokens=_AOAI_MAX_TOKENS,
        )
        content = response.choices[0].message.content.strip()
        # Strip markdown code fences if the model wraps them anyway
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3].strip()
        if content.startswith("json"):
            content = content[4:].strip()
        return _json.loads(content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}")


@app.post("/api/milestones/{milestone_id}/insights")
def milestone_insights(milestone_id: int, user: dict = Depends(get_current_user)) -> dict:
    ctx = _gather_milestone_context(milestone_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Milestone not found")
    prompt = _build_milestone_prompt(ctx)
    result = _call_llm(prompt)
    result["milestone_key"] = ctx["milestone"].get("issue_key", "")
    result["milestone_title"] = ctx["milestone"].get("title", "")
    result["progress"] = {"done": ctx["done"], "total": ctx["total"], "pct": ctx["pct"], "blocked": ctx["blocked"]}
    return result


@app.post("/api/boards/{board_id}/insights")
def board_insights(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    all_items = fetch_items(board_id)
    milestones = [it for it in all_items if it.get("item_type") == "IDEA"]
    if not milestones:
        raise HTTPException(status_code=400, detail="No milestones on this board")
    milestones_ctx = []
    for ms in milestones:
        ctx = _gather_milestone_context(ms["id"])
        if ctx:
            milestones_ctx.append(ctx)
    prompt = _build_board_prompt(board, milestones_ctx)
    result = _call_llm(prompt)
    result["board_name"] = board.get("name", "")
    result["milestone_count"] = len(milestones_ctx)
    return result


# ── Kanban Board AI Insights ────────────────────────────────────────────

@app.post("/api/kanban/{board_id}/insights")
def kanban_board_insights(board_id: int, user: dict = Depends(get_current_user)) -> dict:
    board = fetch_board_by_id(board_id)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    if board.get("board_type") != "kanban":
        raise HTTPException(status_code=400, detail="Not a kanban board")

    columns = fetch_kanban_columns(board_id)
    rows = fetch_kanban_rows(board_id)
    cards = fetch_kanban_cards(board_id)

    if not cards:
        raise HTTPException(status_code=400, detail="No cards on this board yet")

    # Build column distribution
    col_map = {c["id"]: c["name"] for c in columns}
    col_card_counts = {}
    for c in columns:
        col_card_counts[c["name"]] = 0
    for card in cards:
        col_name = col_map.get(card["column_id"], "Unknown")
        col_card_counts[col_name] = col_card_counts.get(col_name, 0) + 1

    # Status breakdown
    status_counts = {}
    for card in cards:
        st = card.get("external_status") or "No Status"
        status_counts[st] = status_counts.get(st, 0) + 1

    # Source breakdown
    source_counts = {"internal": 0, "jira": 0, "ado": 0}
    for card in cards:
        src = card.get("ticket_source") or "internal"
        source_counts[src] = source_counts.get(src, 0) + 1

    # Assignee workload
    assignee_counts = {}
    for card in cards:
        assignee = card.get("assignee") or "Unassigned"
        assignee_counts[assignee] = assignee_counts.get(assignee, 0) + 1

    # Cards detail
    cards_detail = ""
    for card in cards:
        col_name = col_map.get(card["column_id"], "Unknown")
        cards_detail += (
            f"  - \"{card.get('title', '')}\" | Column: {col_name} "
            f"| Status: {card.get('external_status') or 'N/A'} "
            f"| Assignee: {card.get('assignee') or 'Unassigned'} "
            f"| Source: {card.get('ticket_source') or 'internal'}"
            f"{ ' | Key: ' + card['issue_key'] if card.get('issue_key') else '' }\n"
        )

    col_dist = ", ".join(f"{k}: {v}" for k, v in col_card_counts.items())
    row_names = ", ".join(r["name"] for r in rows) if rows else "(no swimlanes)"

    prompt = (
        "You are an expert Agile Coach and Kanban practitioner. Analyze this Kanban board and provide "
        "actionable insights based on Kanban best practices (WIP limits, flow efficiency, bottlenecks, "
        "cycle time awareness, pull vs push, work distribution).\n\n"
        f"Board: \"{board.get('name', 'Untitled')}\"\n"
        f"Columns: {', '.join(c['name'] for c in columns)}\n"
        f"Swimlanes: {row_names}\n"
        f"Total Cards: {len(cards)}\n"
        f"Column Distribution: {col_dist}\n"
        f"Status Breakdown: {', '.join(f'{k}: {v}' for k, v in status_counts.items())}\n"
        f"Source Mix: Internal: {source_counts['internal']}, JIRA: {source_counts['jira']}, ADO: {source_counts['ado']}\n"
        f"Assignee Workload: {', '.join(f'{k}: {v}' for k, v in assignee_counts.items())}\n"
        f"Today: {date.today().isoformat()}\n\n"
        f"Cards:\n{cards_detail}\n"
        "Provide analysis in exactly this JSON format (no markdown, no code fences):\n"
        '{\n'
        '  "board_health": "green|amber|red",\n'
        '  "health_summary": "2-3 sentence Kanban board health assessment covering flow, WIP, and bottlenecks",\n'
        '  "wip_analysis": "1-2 sentence analysis of work-in-progress distribution across columns",\n'
        '  "bottlenecks": ["bottleneck observation 1", "bottleneck observation 2"],\n'
        '  "risks": ["risk 1", "risk 2", "risk 3"],\n'
        '  "recommendations": ["actionable recommendation 1", "actionable recommendation 2", "actionable recommendation 3"],\n'
        '  "agile_score": 1-10\n'
        '}\n'
        "Keep each item brief (1 sentence). Focus on real Kanban metrics and actionable agile improvements. "
        "agile_score is 1 (poor) to 10 (excellent) based on Kanban best practices adherence."
    )

    result = _call_llm(prompt)
    result["board_name"] = board.get("name", "")
    result["total_cards"] = len(cards)
    result["column_distribution"] = col_card_counts
    result["source_mix"] = source_counts
    result["assignee_workload"] = assignee_counts
    return result
