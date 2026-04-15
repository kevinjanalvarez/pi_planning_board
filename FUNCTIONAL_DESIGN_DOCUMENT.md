# Functional Design Document
## PI Planning Board — Home Credit Philippines

---

| Field | Detail |
|---|---|
| **Document Title** | PI Planning Board — Functional Design Document |
| **Author** | Kevin Jan Alvarez |
| **Organization** | Home Credit Philippines — IT Architecture |
| **Version** | 1.1 |
| **Status** | Final Draft |
| **Date** | April 10, 2026 |
| **Reviewed By** | *(pending)* |

---

## Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2025-Q3 | K. Alvarez | Initial draft — core board, JIRA integration |
| 0.2 | 2025-Q4 | K. Alvarez | Added ADO integration, multi-board, dependency linking |
| 1.0 | 2026-04 | K. Alvarez | Full document — all modules, sequence diagrams, data model |
| 1.1 | 2026-04 | K. Alvarez | Updated for server deployment: Python 3.13, VITE_API_BASE env var, allowedHosts, port assignments, start/stop runbook |

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [System Context and Architecture](#2-system-context-and-architecture)
3. [Design Principles](#3-design-principles)
4. [Data Model](#4-data-model)
5. [Functional Modules](#5-functional-modules)
   - 5.1 Board Management
   - 5.2 Planning Grid (Columns and Rows)
   - 5.3 Milestone Management
   - 5.4 Task Management
   - 5.5 Dependency Linking
   - 5.6 Team Row Assignments
   - 5.7 Board Commit and Verification
   - 5.8 Activity Log
   - 5.9 External Sync (JIRA / ADO)
6. [Sequence Diagrams](#6-sequence-diagrams)
7. [API Reference](#7-api-reference)
8. [Security Considerations](#8-security-considerations)
9. [Error Handling Strategy](#9-error-handling-strategy)
10. [Technology Decisions and Trade-offs](#10-technology-decisions-and-trade-offs)
11. [Glossary](#11-glossary)

---

## 1. Purpose and Scope

### 1.1 Background

Program Increment (PI) Planning is a cornerstone event of the Scaled Agile Framework (SAFe). At Home Credit Philippines, PI planning was previously managed through a combination of Excel spreadsheets, JIRA exports, and physical sticky-note boards distributed across multiple teams. This approach caused:

- Duplicate data entry between JIRA and planning sheets
- Lack of a shared single source of truth across teams and scrum masters
- No audit trail when planning decisions changed mid-PI
- Manual reconnection of board state with JIRA/ADO tickets after each update

### 1.2 Purpose

This document describes the complete functional design of the **PI Planning Board** — an internal full-stack web application that:

- Provides a shared, interactive planning surface covering a configurable multi-month window
- Integrates directly with on-premises JIRA (via REST API v2) and Azure DevOps (via REST API v7.1)
- Stores board state in a local SQLite database with full change audit trail
- Supports multiple concurrent PI boards (past and present)

### 1.3 Scope

| In Scope | Out of Scope |
|---|---|
| Board lifecycle (create, edit, archive, clone, delete) | Real-time multi-user concurrent editing (WebSockets) |
| Milestone and task placement on a planning grid | JIRA and ADO write-back for field updates |
| Dependency linking between work items | SSO / LDAP authentication |
| External ticket fetch from JIRA and ADO | Email notifications |
| Team row labeling | Mobile-native app |
| Board commit verification | SaaS cloud deployment |

---

## 2. System Context and Architecture

### 2.1 High-Level Context

```
┌──────────────────────────────────────────────────────────┐
│                      User (Browser)                       │
│              React 18 SPA — Vite build tool               │
└──────────────────┬───────────────────────────────────────┘
                   │ HTTP/JSON REST  (port 5173 → 8000)
                   │
┌──────────────────▼───────────────────────────────────────┐
│               FastAPI Backend  (port 8000)                │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  API Layer  │  │ Domain Logic │  │  DB Layer (db.py)│  │
│  │  (main.py)  │  │  (main.py)   │  │                 │  │
│  └─────────────┘  └──────────────┘  └────────┬────────┘  │
│                                               │           │
│                                       ┌───────▼────────┐  │
│                                       │   SQLite DB    │  │
│                                       │   (board.db)   │  │
│                                       └────────────────┘  │
└─────┬──────────────────────────┬─────────────────────────┘
      │                          │
      │ JIRA REST API v2          │ ADO REST API v7.1
      │ (on-premises)             │ (dev.azure.com)
      ▼                          ▼
┌─────────────┐          ┌──────────────────┐
│ JIRA Server │          │ Azure DevOps Org  │
└─────────────┘          └──────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| **React SPA** | Renders planning board grid, handles user interactions, calls REST API |
| **FastAPI (main.py)** | Route handling, request validation, domain logic, external API calls |
| **Database layer (db.py)** | All SQLite access — inserts, updates, queries, schema migrations |
| **SQLite (board.db)** | Persistent storage of board state, items, transactions, activity log |
| **JIRA REST API** | Issue lookup, issue creation, dependency link creation |
| **ADO REST API** | Work item lookup, User Story creation |

### 2.3 Deployment Model

The application is designed for **on-premises / intranet deployment**:

- Backend runs as a single-process Uvicorn ASGI server
- Frontend is served by Vite dev server (port-bound, `allowedHosts` configured for the target hostname)
- No external network access required except for the JIRA/ADO integrations
- SQLite eliminates any external database dependency

#### Production Server (automation-npvx00321.ph.infra)

| Service | Port | Runtime |
|---|---|---|
| Backend (FastAPI/Uvicorn) | **9000** | Python 3.13 via Miniconda |
| Frontend (Vite/React) | **9001** | Node.js v24 via NVM |

**Start commands:**
```bash
# Backend
cd ~/HCPH_PI_BOARD/backend
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 9000 > ~/hcph_backend.log 2>&1 &

# Frontend
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/HCPH_PI_BOARD/frontend
nohup npm run dev -- --host 0.0.0.0 --port 9001 > ~/hcph_frontend.log 2>&1 &
```

**Stop commands:**
```bash
pkill -f "uvicorn app.main"
pkill -f "vite"
```

---

## 3. Design Principles

### 3.1 Separation of Concerns (SoC)

The codebase enforces a clear two-file separation:

- `db.py` — owns **all** database interactions. No SQL exists in `main.py`.
- `main.py` — owns HTTP routing, request parsing, domain rules, and external API calls.

This makes the data layer independently testable and swappable (e.g., replacing SQLite with PostgreSQL would only require changes to `db.py`).

### 3.2 Fail-Safe Degradation

External integrations (JIRA, ADO) are treated as best-effort:

- If JIRA is unreachable during a board load, cached values in SQLite are served without error.
- If ticket creation in JIRA/ADO fails, the item is still persisted locally with `sync_status = "sync_failed"` and a temporary key (`TEMP-0001`), allowing planning to continue unblocked.
- Sync failures are surface-communicated to the frontend for visibility.

### 3.3 Append-Only Audit Trail

Every mutating operation (CREATE, MOVE, DELETE, SYNC_EXTERNAL) writes a row to `board_transactions` with a full JSON snapshot of the before and after state. This ensures:

- Full planning history is recoverable
- No data is silently overwritten
- Board commits can validate that no untracked changes exist

### 3.4 Stateless API Design

The API is fully stateless. All board state lives in SQLite. The frontend holds no authoritative state between sessions — it always fetches from the server and treats the server as the source of truth.

### 3.5 Strict Input Validation at the Boundary

All API inputs are validated by Pydantic v2 models with field-level constraints:

- Row indices enforced: `ge=0, le=10`
- Slot indices enforced: `ge=0`
- Enum-style fields (e.g., `ticket_source`, `link_type`) enforced by regex patterns
- Board names require `min_length=1, max_length=255`

Validation happens **once**, at the API boundary. Internal functions trust validated inputs.

### 3.6 Single Responsibility for External Connections

JIRA and ADO connection parameters are resolved in one place:

- `_get_jira_connection_settings()` — centralizes JIRA base URL, auth tuple, SSL verify setting
- ADO credentials are read once per call from environment variables

This avoids scattered `os.getenv()` calls and ensures consistent SSL behavior (corporate CA bundles, self-signed cert bypass via `JIRA_VERIFY_SSL=false`).

### 3.9 Configurable Frontend API Base URL

The frontend resolves the backend URL at build/run time via the `VITE_API_BASE` environment variable:

```js
const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";
```

- Local development uses the default (`http://0.0.0.0:8000`) with no configuration needed.
- Server deployments set `VITE_API_BASE` in `frontend/.env` (e.g., `http://automation-npvx00321.ph.infra:9000`).
- This eliminates hardcoded hostnames in source code and makes the frontend deployable to any environment without code changes.

### 3.10 Vite allowedHosts

`vite.config.js` explicitly lists trusted hostnames via `server.allowedHosts`:

```js
server: {
  allowedHosts: ["automation-npvx00321.ph.infra"],
}
```

This is a Vite security control that prevents DNS rebinding attacks — requests from unlisted hostnames are rejected with a 403.

### 3.7 Zero-Downtime Schema Migrations

`init_db()` uses `PRAGMA table_info()` to detect missing columns and applies `ALTER TABLE ... ADD COLUMN` if needed. This pattern allows the application to safely upgrade an existing production database without data loss and without requiring a migration tool.

### 3.8 Color-Coded Visual Identity

Board tiles are colored deterministically by ticket source:

| Source | Color | Hex |
|---|---|---|
| JIRA | Blue | `#2563eb` |
| ADO | Amber | `#d97706` |
| Manual / unknown | Slate | `#475569` |

This provides instant visual differentiation without the user needing to read source labels.

---

## 4. Data Model

### 4.1 Entity Relationship Overview

```
boards
  │
  ├── board_items  (many)
  │      │
  │      ├── board_transactions  (many, per item mutation)
  │      │
  │      └── board_item_links  (many-to-many via source/target)
  │
  ├── row_team_assignments  (one per row per board)
  │
  ├── board_commits  (one per verified commit)
  │
  └── board_activity  (append-only event log)
```

### 4.2 Table Definitions

#### `boards`

Stores the top-level PI board metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT NOT NULL | Display name, max 255 chars |
| `description` | TEXT | Optional |
| `start_date` | TEXT | ISO date (YYYY-MM-DD), start of planning window |
| `end_date` | TEXT | ISO date, end of planning window |
| `is_archived` | INTEGER | 0 = active, 1 = archived |
| `created_at` | TEXT | UTC ISO datetime |
| `updated_at` | TEXT | UTC ISO datetime |

#### `board_items`

Every ticket (milestone or task) placed on a board.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `board_id` | INTEGER | FK → boards.id |
| `issue_key` | TEXT | JIRA key or ADO work item ID (nullable for manual items) |
| `title` | TEXT NOT NULL | Fetched from JIRA/ADO summary or user-provided |
| `item_type` | TEXT | `IDEA` (milestone) or `TASK` |
| `ticket_source` | TEXT | `jira` or `ado` |
| `external_work_item_type` | TEXT | e.g., `User Story`, `Task`, `IDEA` |
| `row_index` | INTEGER | 0 = Milestone row, 1-10 = Team rows |
| `row_label` | TEXT | Human-readable row name at time of creation |
| `start_slot` | INTEGER | 0-based slot index in planning grid |
| `end_slot` | INTEGER | Inclusive end slot |
| `target_date` | TEXT | Milestone target date (ISO) |
| `end_date` | TEXT | Milestone end date (ISO) |
| `jira_assignee` | TEXT | Cached from last JIRA sync |
| `jira_shirt_size` | TEXT | Cached from JIRA custom field `customfield_10231` |
| `jira_status` | TEXT | Cached JIRA status name |
| `jira_description` | TEXT | Extracted plain text from JIRA description |
| `color` | TEXT | CSS hex color |
| `sync_status` | TEXT | `synced` or `sync_failed` |
| `created_at` | TEXT | UTC ISO datetime |
| `updated_at` | TEXT | UTC ISO datetime |

#### `board_transactions`

Append-only change log per item mutation. Never updated or deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `board_item_id` | INTEGER | FK → board_items.id |
| `action` | TEXT | `CREATE`, `MOVE`, `DELETE`, `SYNC_EXTERNAL` |
| `old_state` | TEXT | JSON snapshot before change (null for CREATE) |
| `new_state` | TEXT | JSON snapshot after change (null for DELETE) |
| `created_at` | TEXT | UTC ISO datetime |

#### `board_item_links`

Directed dependency links between items.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `source_item_id` | INTEGER | FK → board_items.id |
| `target_item_id` | INTEGER | FK → board_items.id |
| `link_type` | TEXT | `blocks`, `depends_on`, `relates_to` |
| `created_at` | TEXT | UTC ISO datetime |
| **UNIQUE** | | `(source_item_id, target_item_id, link_type)` prevents duplicate links |

#### `row_team_assignments`

Maps a row index to a team code per board.

| Column | Type | Notes |
|---|---|---|
| `board_id` | INTEGER PK (composite) | FK → boards.id |
| `row_index` | INTEGER PK (composite) | 1–10 |
| `team_code` | TEXT NOT NULL | Code from the team registry |
| `updated_at` | TEXT | UTC ISO datetime |

#### `board_commits`

Immutable record of each board verification/commit event.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `verified` | INTEGER | 1 = passed verification, 0 = failed |
| `summary` | TEXT | JSON with item count, link count, pending changes |
| `created_at` | TEXT | UTC ISO datetime |

#### `board_activity`

Human-readable event log for the activity feed UI.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `board_id` | INTEGER | FK → boards.id |
| `action` | TEXT | Short action label (e.g., "Added milestone") |
| `detail` | TEXT | Contextual detail (e.g., "IDEA-123: Release X") |
| `created_at` | TEXT | UTC ISO datetime |

---

## 5. Functional Modules

---

### 5.1 Board Management

#### Purpose
Manage the lifecycle of PI boards. Each board has a name, optional description, and a fixed date range that defines its planning window.

#### Functional Behaviors

| Action | Trigger | Behavior |
|---|---|---|
| Create | User submits Create Board form | Validates start ≤ end date; inserts into `boards` |
| List | Dashboard page load | Returns all non-archived boards; optional `include_archived` flag |
| View | User opens a board | Fetches board metadata by ID |
| Edit | User edits board name/description/dates | Updates `boards.name`, `description`, `updated_at` |
| Archive | User archives a board | Sets `is_archived = 1` — board is hidden but not deleted |
| Delete | User deletes a board | Hard deletes the `boards` record (does not cascade items) |
| Clone | User clones a board | Creates new board with `"Copy of <name>"` and same dates; items are not copied |

#### Input / Output

**POST /api/boards**

| Input Field | Type | Validation |
|---|---|---|
| `name` | string | Required, 1–255 chars |
| `description` | string | Optional |
| `start_date` | date (ISO) | Required |
| `end_date` | date (ISO) | Required; must be ≥ start_date |

Output: full `boards` row as JSON, HTTP 201.

**PATCH /api/boards/{board_id}/archive**

Input: board_id in URL path.
Output: updated `boards` row with `is_archived = 1`.

#### Design Decision: Soft Archive vs. Hard Delete
Archive was chosen over immediate hard delete to prevent accidental data loss during PI reviews. A hard delete option exists separately but requires explicit user action.

---

### 5.2 Planning Grid (Columns and Rows)

#### Purpose
Generate the visual time-based grid for a board based on its date range.

#### Column Generation (`build_planning_columns`)

The function:
1. Reads `start_date` and `end_date` from the board record.
2. Calculates `num_months = (end_year - start_year) * 12 + (end_month - start_month) + 1`.
3. For each month, emits 4 weekly slots (`WK1`–`WK4`) with a sequential zero-based `slot` index.

**Example output for a 3-month board:**

```json
[
  { "name": "April", "year": 2026, "slots": [
    {"slot": 0, "label": "WK1"}, {"slot": 1, "label": "WK2"},
    {"slot": 2, "label": "WK3"}, {"slot": 3, "label": "WK4"}
  ]},
  { "name": "May", "year": 2026, "slots": [
    {"slot": 4, "label": "WK1"}, ...
  ]},
  ...
]
```

#### Row Structure

The board always has **11 rows**:

| Row Index | Label | Purpose |
|---|---|---|
| 0 | Milestone | JIRA IDEA milestones only |
| 1–10 | Team#1 – Team#10 | Team task rows; can be labeled via team assignment |

#### Slot-to-Date Mapping (`find_slot_for_target_date`)

Converts a calendar date to a slot index:
1. Matches the date's year and month against the month list.
2. Computes `week_index = min((day - 1) // 7, 3)` to map days to WK1–WK4.
3. Returns the slot number for that week.

Raises HTTP 400 if the date falls outside the board's planning window.

---

### 5.3 Milestone Management

#### Purpose
Place JIRA IDEA-type milestones on row 0 of the planning grid, linked to real JIRA issue keys.

#### Business Rules
- Only tickets with JIRA `issuetype = IDEA` are accepted.
- Milestones may only be placed in row 0 (enforced in both create and move paths).
- The `end_date` must be on or after `target_date`.
- A milestone's visual span = end_date slot − target_date slot.

#### Input / Output

**POST /api/milestones**

| Input Field | Type | Validation |
|---|---|---|
| `board_id` | int | Required; board must exist |
| `issue_key` | string | Required; JIRA key (e.g., `IDEA-42`) |
| `ticket_source` | string | Must be `"jira"` |
| `target_date` | date | Required; must be within board window |
| `end_date` | date | Required; must be ≥ target_date |

**Processing Steps:**
1. Fetch the board to validate date window.
2. Convert `target_date` and `end_date` to slot indices.
3. Call `fetch_jira_issue(issue_key)` — validates issue type = IDEA and retrieves metadata.
4. Insert item into `board_items` with `item_type = "IDEA"`, `row_index = 0`.
5. Log activity.

**Output:** Full `board_items` row as JSON.

---

### 5.4 Task Management

#### Purpose
Place JIRA or ADO work items (or new tickets created on-the-fly) on team rows 1–10.

#### Business Rules
- Tasks cannot be placed on row 0 (Milestone row).
- ADO tasks must be of work item type `User Story`.
- If `issue_key` is provided → fetch from external source, use fetched summary as title.
- If `issue_key` is blank + `title` is provided + source is JIRA → create a new JIRA issue, then fetch it back.
- If `issue_key` is blank + `title` is provided + source is ADO → create a new ADO User Story, then fetch it back.
- If the external ticket creation fails, the item is still saved locally with `sync_status = "sync_failed"` and a `TEMP-XXXX` display key.

#### Input / Output

**POST /api/tasks**

| Input Field | Type | Validation |
|---|---|---|
| `board_id` | int | Required |
| `title` | string | Required if no issue_key |
| `issue_key` | string | Optional; if provided, title is overridden by fetched summary |
| `ticket_source` | string | `"jira"` or `"ado"` |
| `jira_project_key` | string | Required for new JIRA ticket creation |
| `jira_issue_type` | string | Optional; defaults to `"Task"` |
| `jira_extra_fields` | object | Optional; passed through to JIRA issue create payload |
| `row_index` | int | 1–10 |
| `start_slot` | int | ≥ 0 |
| `end_slot` | int | ≥ start_slot |

**Output:** Full `board_items` row plus:

```json
{
  "jira_created": true,
  "jira_created_issue_key": "PROJ-123",
  "ado_created": false,
  "sync_failed": false,
  "sync_error_message": null,
  "system_label": "JIRA"
}
```

#### Move Item

**PATCH /api/items/{item_id}/move**

| Input Field | Type | Validation |
|---|---|---|
| `row_index` | int | 0–10; milestones enforced to row 0 |
| `start_slot` | int | ≥ 0 |
| `end_slot` | int | ≥ start_slot |

Writes a `MOVE` transaction to `board_transactions` with before/after state.

#### Delete Item

**DELETE /api/items/{item_id}**

- Writes a `DELETE` transaction before removing from `board_items`.
- Cascades deletion of all `board_item_links` referencing this item.
- Does **not** delete the ticket from JIRA or ADO (`"local_only": true` in response).

---

### 5.5 Dependency Linking

#### Purpose
Model planning dependencies between work items on the board. Links are also synced back to JIRA where applicable.

#### Link Types

| Type | Meaning |
|---|---|
| `blocks` | Source item blocks target item |
| `depends_on` | Source item depends on target item |
| `relates_to` | General relationship (no blocking semantics) |

#### JIRA Sync Behavior for Links

When a link is created between two items, the backend applies this logic:

```
IF source is IDEA milestone AND target is JIRA task:
    → Create "has worklog in" link in JIRA (worklog → IDEA)

ELSE IF source is IDEA milestone AND target is ADO:
    → Create a Remote Web Link on the JIRA IDEA pointing to the ADO work item URL

ELSE IF both items are JIRA tickets:
    → Create a JIRA issue link (type resolved dynamically from JIRA's /issueLinkType API)
      blocks → "is blocked by" (fallback: "relates to")
      relates_to → "relates to"
```

#### Link Type Resolution

JIRA link type names vary between on-prem instances. The backend resolves them dynamically:

1. Calls `GET /rest/api/2/issueLinkType` to retrieve all available types.
2. Performs case-insensitive substring matching against `name`, `inward`, and `outward` fields.
3. If the preferred type is not found, falls back to `"relates to"`.

This avoids hardcoding type names that differ per JIRA instance.

#### Input / Output

**POST /api/links**

| Input Field | Type | Validation |
|---|---|---|
| `board_id` | int | Required |
| `source_item_id` | int | > 0; must exist on the board |
| `target_item_id` | int | > 0; must exist; cannot equal source |
| `link_type` | string | `blocks`, `depends_on`, or `relates_to` |

Output: `board_item_links` row + `"jira_link_synced": true/false`.

**UNIQUE constraint** on `(source_item_id, target_item_id, link_type)` prevents duplicate links at the database level.

---

### 5.6 Team Row Assignments

#### Purpose
Allow scrum masters to label each team row with a team name for visibility on the board.

#### Behavior
- Each board × row combination maps to one team code (UPSERT pattern).
- Setting `team_code` to null/empty clears the assignment.
- Team codes are drawn from a predefined registry in the frontend (`App.jsx`) covering both technical teams (e.g., DWH, DXP, AI) and business teams grouped by domain (Products, Risk, Finance, Legal, CRM, etc.).

#### Input / Output

**PUT /api/team-assignments/{row_index}**

| Input Field | Type | Validation |
|---|---|---|
| `board_id` | int | Required |
| `team_code` | string | Optional; null removes the assignment |

Uses SQLite `INSERT ... ON CONFLICT DO UPDATE` (UPSERT) to handle both create and update in one operation, avoiding race conditions.

---

### 5.7 Board Commit and Verification

#### Purpose
Allow a planning facilitator to formally "commit" a board state — validating its integrity and creating an immutable snapshot record.

#### Verification Rules (`_verify_board`)

| Rule | Description |
|---|---|
| Slot ordering | `end_slot >= start_slot` for every item |
| Window bounds | All slots fall within `[0, total_slots - 1]` |
| Row bounds | Row index in `[0, len(ROWS) - 1]` |
| Milestone row enforcement | Items with `item_type = "IDEA"` must be in row 0 |
| Task row enforcement | Non-IDEA items must not be in row 0 |
| Link integrity | All link source/target IDs must refer to existing items on the board |

If any rule fails, the commit is rejected with a `400` response listing all issues.

#### Commit Record

On success, the commit:
1. Runs `_sync_external_ticket_fields` to refresh all JIRA metadata.
2. Calls `_verify_board` — fails fast if issues found.
3. Counts all `board_transactions` since the last commit to record `pending_changes`.
4. Inserts a `board_commits` row with `verified = 1`.
5. Logs activity.

#### Input / Output

**POST /api/board/commit?board_id={id}**

Output on success:
```json
{
  "status": "committed",
  "verified": true,
  "summary": {
    "items": 24,
    "links": 7,
    "pending_changes": 12
  },
  "commit": { "id": 3, "verified": true, "created_at": "2026-04-10T..." }
}
```

---

### 5.8 Activity Log

#### Purpose
Provide a human-readable, chronological feed of all planning actions on a board for transparency and retrospectives.

#### Design
- `log_activity(board_id, action, detail)` is called after every mutating operation in `main.py`.
- Stored in `board_activity` — never updated, only appended.
- Distinct from `board_transactions` (which stores full JSON state diffs for audit).
- The activity log holds natural-language labels for UI display; transactions hold machine-readable state for recovery.

#### Input / Output

**GET /api/boards/{board_id}/activity?limit=50**

Output:
```json
{
  "board_id": 1,
  "events": [
    { "id": 42, "action": "Linked tickets", "detail": "IDEA-10 → PROJ-55 (blocks)", "created_at": "..." },
    { "id": 41, "action": "Added task", "detail": "PROJ-55 (row 3)", "created_at": "..." }
  ]
}
```

---

### 5.9 External Sync (JIRA / ADO)

#### Purpose
Keep board item metadata (status, assignee, shirt size, description) consistent with external systems without requiring manual refresh.

#### On-Demand Sync (`GET /api/board?refresh_external=true`)

When `refresh_external=true` is passed:
1. For each item with `ticket_source = "jira"`, calls `fetch_jira_issue(issue_key)`.
2. Compares fetched values against cached SQLite values.
3. If any field changed, calls `update_item_external_fields()` — which writes an `SYNC_EXTERNAL` transaction.
4. If JIRA is unreachable or returns an error, the item is silently passed through with its cached values (fail-safe degradation).

#### JIRA Description Extraction (`_extract_description_text`)

JIRA descriptions can be:
- A plain string (older JIRA Server instances)
- An Atlassian Document Format (ADF) JSON tree (newer instances)

The function handles both: it recursively walks the ADF tree collecting `text` leaf nodes when the value is a dict, and strips it to a plain string concatenation. This avoids exposing raw ADF JSON to the UI.

#### ADO HTML Stripping (`_extract_ado_text`)

ADO `System.Description` fields return HTML-formatted strings. The function strips HTML tags using a simple character-scan loop (no external parser dependency) and collapses whitespace to a clean readable string.

---

## 6. Sequence Diagrams

### 6.1 Load Board

```
Browser              FastAPI             SQLite         JIRA
   │                    │                   │              │
   │─GET /api/board?────▶│                   │              │
   │  board_id=1         │                   │              │
   │                    │─fetch_board_by_id─▶│              │
   │                    │◀───────────────────│              │
   │                    │─fetch_items────────▶│              │
   │                    │◀───────────────────│              │
   │                    │─fetch_links────────▶│              │
   │                    │◀───────────────────│              │
   │                    │─fetch_team_assignments▶│          │
   │                    │◀───────────────────│              │
   │                    │─build_planning_columns()          │
   │                    │  (in-memory)                      │
   │◀───────────────────│                                   │
   │  {months, rows,     │                                   │
   │   items, links}     │                                   │
```

*(When `refresh_external=true` is passed, JIRA is called per item between `fetch_items` and the response.)*

---

### 6.2 Create Milestone (Existing JIRA IDEA)

```
Browser              FastAPI             JIRA            SQLite
   │                    │                   │              │
   │─POST /api/────────▶│                   │              │
   │  milestones         │                   │              │
   │  {board_id,         │                   │              │
   │   issue_key,        │─fetch_board_by_id─────────────▶│
   │   target_date,      │◀──────────────────────────────│
   │   end_date}         │                   │              │
   │                    │─find_slot_for_target_date()      │
   │                    │  (in-memory)                     │
   │                    │─GET /rest/api/2/──▶│              │
   │                    │  issue/{key}       │              │
   │                    │◀──────────────────│              │
   │                    │─validate issuetype = "IDEA"      │
   │                    │─insert_item()──────────────────▶│
   │                    │◀──────────────────────────────│
   │                    │  (also writes board_transactions │
   │                    │   CREATE row)                    │
   │                    │─log_activity()─────────────────▶│
   │◀───────────────────│                                   │
   │  board_items row    │                                   │
```

---

### 6.3 Create Task (New JIRA Ticket)

```
Browser              FastAPI             JIRA            SQLite
   │                    │                   │              │
   │─POST /api/tasks───▶│                   │              │
   │  {board_id,         │─fetch_board_by_id─────────────▶│
   │   title,            │◀──────────────────────────────│
   │   ticket_source,    │                   │              │
   │   jira_project_key, │─POST /rest/api/2/▶│              │
   │   row_index,        │  issue            │              │
   │   start_slot,       │◀──────────────────│              │
   │   end_slot}         │  {key: "PROJ-99"} │              │
   │                    │─GET /rest/api/2/──▶│              │
   │                    │  issue/PROJ-99     │              │
   │                    │◀──────────────────│              │
   │                    │  {summary, status, │              │
   │                    │   assignee, ...}   │              │
   │                    │─insert_item()──────────────────▶│
   │                    │◀──────────────────────────────│
   │◀───────────────────│                                   │
   │  board_items row +  │                                   │
   │  {jira_created:true}│                                   │
```

---

### 6.4 Move Item (Drag and Drop)

```
Browser              FastAPI            SQLite
   │                    │                  │
   │─PATCH /api/items/──▶│                  │
   │  {item_id}/move     │                  │
   │  {row_index,        │─fetch_item_by_id─▶│
   │   start_slot,       │◀─────────────────│
   │   end_slot}         │                  │
   │                    │─validate business rules         │
   │                    │  (IDEA stays in row 0,          │
   │                    │   TASK not in row 0)            │
   │                    │─update_item_position()──────────▶│
   │                    │  UPDATE board_items              │
   │                    │  INSERT board_transactions       │
   │                    │  (MOVE, old_state, new_state)    │
   │                    │◀────────────────────────────────│
   │                    │─log_activity()──────────────────▶│
   │◀───────────────────│                                   │
   │  updated item row   │                                   │
```

---

### 6.5 Create Dependency Link (JIRA ↔ JIRA)

```
Browser              FastAPI             JIRA            SQLite
   │                    │                   │              │
   │─POST /api/links───▶│                   │              │
   │  {board_id,         │─fetch_items()──────────────────▶│
   │   source_item_id,   │◀──────────────────────────────│
   │   target_item_id,   │                   │              │
   │   link_type}        │─resolve link type:               │
   │                    │  GET /api/2/──────▶│              │
   │                    │  issueLinkType     │              │
   │                    │◀──────────────────│              │
   │                    │─POST /api/2/──────▶│              │
   │                    │  issueLink         │              │
   │                    │◀──────────────────│              │
   │                    │─insert_link()──────────────────▶│
   │                    │◀──────────────────────────────│
   │                    │─log_activity()─────────────────▶│
   │◀───────────────────│                                   │
   │  {link row,         │                                   │
   │   jira_link_synced: │                                   │
   │   true}             │                                   │
```

---

### 6.6 Board Commit and Verification

```
Browser              FastAPI            SQLite
   │                    │                  │
   │─POST /api/board/───▶│                  │
   │  commit?board_id=1  │─fetch_board_by_id▶│
   │                    │◀─────────────────│
   │                    │─fetch_items()────▶│
   │                    │◀─────────────────│
   │                    │─_sync_external_  │
   │                    │  ticket_fields() │ (calls JIRA per item)
   │                    │─fetch_links()────▶│
   │                    │◀─────────────────│
   │                    │─_verify_board()  │ (in-memory)
   │                    │  ┌─ if issues:   │
   │                    │  │  HTTP 400     │
   │                    │  └─ else:        │
   │                    │─count_transactions_since()───────▶│
   │                    │◀─────────────────────────────────│
   │                    │─insert_board_commit()────────────▶│
   │                    │◀─────────────────────────────────│
   │                    │─log_activity()───────────────────▶│
   │◀───────────────────│                                   │
   │  {status: committed,│                                   │
   │   verified: true,   │                                   │
   │   summary: {...}}   │                                   │
```

---

## 7. API Reference

### Board Management

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/boards` | List all boards (query: `include_archived`) |
| POST | `/api/boards` | Create a board |
| GET | `/api/boards/{id}` | Get a single board |
| PUT | `/api/boards/{id}` | Update board name/description/dates |
| PATCH | `/api/boards/{id}/archive` | Archive a board |
| DELETE | `/api/boards/{id}` | Hard delete a board |
| POST | `/api/boards/{id}/clone` | Clone a board (metadata only) |
| GET | `/api/boards/{id}/activity` | Get activity log (query: `limit`) |

### Planning Surface

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/board` | Full board payload (query: `board_id`, `refresh_external`) |
| POST | `/api/board/commit` | Verify and commit board state |
| POST | `/api/milestones` | Add JIRA IDEA milestone to board |
| POST | `/api/tasks` | Add JIRA or ADO task to board |
| PATCH | `/api/items/{id}/move` | Move an item to a new row/slot |
| DELETE | `/api/items/{id}` | Remove an item from the board |
| POST | `/api/links` | Create a dependency link |
| DELETE | `/api/links/{id}` | Remove a dependency link |
| PUT | `/api/team-assignments/{row_index}` | Assign a team to a row |

### JIRA Utilities

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/jira/projects` | List all JIRA project keys |
| GET | `/api/jira/projects/{key}/issue-types` | List issue types for a project |
| GET | `/api/jira/field-options` | Discover custom field options (query: `project_key`, `field_name`, `issue_type`) |

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Backend liveness check |

---

## 8. Security Considerations

### 8.1 Credential Management
- JIRA credentials (`username`, `api_token`) and ADO PAT (`AZURE_PAT`) are loaded exclusively from environment variables via `python-dotenv`.
- No credentials are hardcoded in source code or committed to version control (`.env` is `.gitignore`d).
- Credentials are never echoed in API responses or error messages.

### 8.2 SSL/TLS for On-Prem JIRA
- TLS verification is enabled by default (`JIRA_VERIFY_SSL=true`).
- For corporate internal CA certificates, `JIRA_CA_BUNDLE_PATH` can point to the CA bundle file — this is passed directly to `requests` as the `verify` parameter, avoiding global SSL bypass.
- Only when absolutely required for development, `JIRA_VERIFY_SSL=false` disables verification; this should never be used in production.

### 8.3 CORS Policy
- The backend explicitly lists allowed origins via `CORS_ORIGIN` environment variable (default: `http://localhost:5173`).
- `allow_credentials=True` is set — this must only be combined with specific (non-wildcard) origins.

### 8.4 Input Validation
- All API inputs are validated by Pydantic v2 before any business logic or database access.
- Integer range constraints (`ge`, `le`) and regex pattern constraints (`pattern`) are enforced at the framework level.
- JQL queries sent to JIRA are constructed with parameterized f-strings based on validated project keys (which are forced to uppercase alphanumeric).

### 8.5 No Direct SQL Injection Surface
- All SQLite queries in `db.py` use parameterized statements (`conn.execute("... WHERE id = ?", (item_id,))`).
- No string interpolation is used in SQL.

### 8.6 ADO PAT Encoding
- The ADO Personal Access Token is Base64-encoded as per the ADO REST API spec (`Basic :<PAT>` → Base64), not stored in plain text in HTTP headers at construction time. The encoding uses Python's standard library `base64.b64encode`.

---

## 9. Error Handling Strategy

### 9.1 HTTP Error Codes Used

| Code | When Used |
|---|---|
| 400 | Invalid input, JIRA/ADO rule violations, board verification failures |
| 404 | Board, item, or link not found |
| 502 | External service (JIRA/ADO) unreachable (network error) |
| 500 | Missing required environment variable (e.g., `JIRA_BASE_URL` not set) |

### 9.2 External API Error Propagation

JIRA and ADO errors are caught and re-raised as `HTTPException` with meaningful messages:

```
requests.HTTPError   → HTTP 400 with JIRA/ADO error body extracted
requests.SSLError    → HTTP 502 with guidance on CA bundle or JIRA_VERIFY_SSL flag
requests.RequestException → HTTP 502 "Could not reach JIRA/ADO server"
```

### 9.3 Partial Failure Tolerance

For task creation: if the external ticket creation fails, the local board item is still inserted with:
- `sync_status = "sync_failed"`
- `issue_key = null`
- Frontend renders a `TEMP-XXXX` key to indicate the item is unlinked

This allows a planning session to continue even if JIRA or ADO is temporarily unavailable.

---

## 10. Technology Decisions and Trade-offs

### 10.1 SQLite vs. PostgreSQL / MySQL

**Chosen:** SQLite

| Factor | Rationale |
|---|---|
| Zero-config deployment | No database server installation needed on-prem |
| Intranet / single-node use case | Concurrent write load is low; single user or small team |
| Schema migration flexibility | `PRAGMA table_info` + `ALTER TABLE` pattern avoids Alembic/Flyway dependency |
| Portability | The entire board state is one `.db` file, easily backed up |

**Trade-off:** SQLite does not support true concurrent multi-user writes. If this tool is ever scaled to real-time multi-user scenarios, a migration to PostgreSQL would be necessary — and is facilitated by the clean separation of `db.py`.

### 10.2 FastAPI vs. Django / Flask

**Chosen:** FastAPI

| Factor | Rationale |
|---|---|
| Pydantic v2 validation | Automatic, type-safe request validation with zero boilerplate |
| Async-ready | Uvicorn ASGI allows future async DB or WebSocket additions |
| Auto-generated docs | `/docs` (Swagger) and `/redoc` available out of the box — valuable for onboarding |
| Lightweight | No ORM or template engine overhead for a pure API |

### 10.3 React + Vite vs. Next.js / Angular

**Chosen:** React 18 + Vite

| Factor | Rationale |
|---|---|
| No SSR needed | Board data is fully client-side interactive; SSR adds complexity without benefit |
| Vite build speed | Fast HMR in development; production build in seconds |
| No UI framework | Full design control without fighting a component library's grid system |
| Minimal dependencies | Only React, Vite, and custom CSS — reduces supply chain risk |

### 10.4 Custom CSS vs. Tailwind / MUI

**Chosen:** Custom CSS

| Factor | Rationale |
|---|---|
| Grid layout precision | CSS Grid was used directly for the planning matrix — pixel-precise slot spanning requires fine-grained control |
| No class-name bloat | The planning board has highly specific layout rules that are cleaner in dedicated CSS |
| Load time | No framework CSS to purge or bundle |

### 10.5 Append-Only Transactions vs. Mutable State

**Chosen:** Append-only `board_transactions` table

| Factor | Rationale |
|---|---|
| Auditability | Complete history is always available — every planning decision is recoverable |
| Compliance alignment | Immutable records align with audit requirements in financial services |
| No data loss | Even deleted items are traceable via the DELETE transaction record |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **PI** | Program Increment — a planning cycle (typically 8–12 weeks) in the SAFe framework |
| **Milestone** | A JIRA IDEA-type item placed on row 0 representing a PI-level deliverable |
| **Task** | A JIRA or ADO work item placed on a team row (rows 1–10) |
| **Slot** | A single week cell on the planning grid (WK1–WK4 per month) |
| **Board** | A named planning surface covering a specific date range |
| **Commit** | The act of formally verifying and snapshotting a board's state |
| **IDEA** | A JIRA issue type used at Home Credit Philippines for PI-level milestones |
| **ADO** | Azure DevOps — Microsoft's work tracking platform |
| **PAT** | Personal Access Token — used to authenticate to Azure DevOps REST API |
| **ADF** | Atlassian Document Format — JSON tree format for JIRA rich-text fields |
| **SoC** | Separation of Concerns — design principle of isolating distinct responsibilities |
| **UPSERT** | INSERT ... ON CONFLICT DO UPDATE — atomic create-or-update database operation |
| **sync_failed** | Status flag indicating an item exists locally but was not successfully linked to JIRA or ADO |
| **Shirt Size** | JIRA custom field (`customfield_10231`) representing story size estimate |

---

*Document prepared for internal review and interview reference.*
*PI Planning Board — Home Credit Philippines · 2025–2026*
*Author: Kevin Jan Alvarez · IT Architecture*
