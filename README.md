# PI Planning Board

**PI Planning Board** is an internal web tool designed and built from scratch to digitize and streamline Program Increment (PI) planning ceremonies and Kanban workflows for agile delivery teams at Home Credit Philippines. It replaces static spreadsheets and physical sticky-note boards with an interactive planning surface that integrates directly with JIRA and Azure DevOps (ADO).

---

## The Problem

PI planning sessions are a cornerstone of the Scaled Agile Framework (SAFe), but managing them in practice often means wrestling with bloated Excel files, disconnected JIRA exports, or expensive third-party tools. Teams needed a purpose-built solution that:

- Reflects a live planning window with week-level granularity
- Pulls ticket data directly from JIRA and ADO — no copy-pasting
- Lets teams drag, assign, and link work items visually on a shared board
- Keeps a full audit trail of every planning decision
- Supports both PI Planning and Kanban board types
- Provides a Gantt chart view with timeline visibility

---

## Tech Stack

- **Frontend:** React 18 + Vite · Custom CSS · html2canvas (PNG export)
- **Backend:** Python 3.13 · FastAPI · Uvicorn · SQLite
- **Auth:** JWT (HS256, 12h expiry) · bcrypt password hashing · Fernet credential encryption
- **Integrations:** On-prem JIRA REST API · Azure DevOps REST API

---

## Key Features

| Feature | Description |
|---|---|
| **User authentication** | JWT-based login/register with role-based access (user/admin) |
| **Dashboard** | Multi-board hub — create, edit, archive, clone, delete, and assign PI Planning or Kanban boards |
| **PI Planning board** | Interactive planning surface with monthly columns (WK1–WK4), milestone row, up to 10 team rows, drag-to-reposition, and multi-slot span |
| **Gantt chart** | Timeline view with status-based bar coloring, today line, milestone RAG health (diamond + progress bar colored by risk), and PNG export via html2canvas |
| **Kanban board** | Custom columns, swimlane rows, card creation (manual or from JIRA/ADO), drag-and-drop movement |
| **Milestone RAG health** | Auto-calculated Red/Amber/Green status for milestones based on timeline progress, blocked tasks, and overdue state. PI board shows "AT RISK" / "WARNING" badge; Gantt colors the diamond, title, and progress bar |
| **Dependency linking** | Draw `blocks`, `depends_on`, and `relates_to` links between work items across teams |
| **JIRA integration** | Fetch issue metadata, create new JIRA tickets, lookup by key, per-user credential storage |
| **ADO integration** | Create and fetch Azure DevOps work items, status/assignee sync from ADO, per-user PAT storage |
| **Admin panel** | User CRUD, role assignment, board assignment, credential management per user |
| **User profile** | Update display name, change password, manage personal JIRA/ADO integrations with connection testing |
| **Activity log** | Append-only transaction history capturing every board event |

---

## Architecture

```
Browser (React SPA)
       │  REST (JSON) + JWT Bearer Auth
       ▼
FastAPI Backend  ──── JIRA REST API (on-prem)
       │         └─── Azure DevOps REST API
       ▼
    SQLite (Fernet-encrypted credentials)
  users | boards | board_items | board_transactions | links
  kanban_columns | kanban_rows | kanban_cards | credentials
```

---

## Pages

| Page | Description |
|---|---|
| **Login / Register** | JWT authentication with session-based token storage |
| **Dashboard** | Board listing with create, clone, archive, delete, and user assignment |
| **PI Planning Board** | Full planning surface with milestones, team rows, dependency links, and Gantt chart toggle |
| **Gantt Chart** | Timeline visualization with status-colored bars, today marker, milestone diamonds, and PNG export |
| **Kanban Board** | Column/row-based card board with JIRA/ADO ticket lookup |
| **Admin Users** | User management with credential tabs for JIRA/ADO per user |
| **User Profile** | Profile settings (name, password) and integrations (JIRA/ADO credentials with test) |
| **Configuration** | Admin credential configuration for JIRA and ADO |

---

## Developer Setup

### Backend Setup

1. Go to backend folder:

```powershell
cd backend
```

2. Create virtual environment and install packages:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

3. Create env file:

```powershell
copy .env.example .env
```

4. Update `backend/.env` values:

**Required:**
- `JWT_SECRET` — secret key for signing JWT tokens
- `CREDENTIAL_ENCRYPTION_KEY` — Fernet key for encrypting stored credentials

**JIRA (optional, for JIRA integration):**
- `JIRA_BASE_URL`
- `JIRA_USERNAME`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY`

**Azure DevOps (optional, for ADO integration):**
- `AZURE_ORG`, `AZURE_PROJECT`, `AZURE_PAT`
- `AZURE_DEFAULT_AREA_PATH`, `AZURE_DEFAULT_ITERATION_PATH`

**Other (optional):**
- `CORS_ORIGIN` — frontend origin for CORS (default: `http://localhost:5173`)
- `DB_PATH` — SQLite database path (default: `board.db`)

5. Run backend:

```powershell
uvicorn app.main:app --reload --port 8000
```

A default admin account (`admin` / `admin`) is created on first startup.

### Frontend Setup

1. Go to frontend folder:

```powershell
cd frontend
npm install
```

2. (Optional) Set backend URL — create `frontend/.env`:

```
VITE_API_BASE=http://localhost:8000
```

Defaults to `http://0.0.0.0:8000` if not set.

3. Run frontend dev server:

```powershell
npm run dev
```

Frontend URL: `http://localhost:5173`

---

## Server Deployment (Linux)

Deployed on `automation-npvx00321.ph.infra` using ports in the **9000 range**.

| Service | Port | URL |
|---|---|---|
| Backend (FastAPI) | 9000 | `http://automation-npvx00321.ph.infra:9000` |
| Frontend (Vite) | 9001 | `http://automation-npvx00321.ph.infra:9001` |

### Prerequisites (one-time)

- Python 3.13 via Miniconda: `~/miniconda3/bin/python`
- Node.js v24 via NVM

### Start

Use the provided start scripts:

```bash
bash ~/HCPH_PI_BOARD/start_be.sh   # kills existing, starts backend on :9000 (4 workers)
bash ~/HCPH_PI_BOARD/start_fe.sh   # kills existing, starts frontend on :9001
```

Or manually:

**Backend:**
```bash
cd ~/HCPH_PI_BOARD/backend
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 9000 --workers 4 > ~/hcph_backend.log 2>&1 &
```

**Frontend:**
```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/HCPH_PI_BOARD/frontend
nohup npm run dev -- --host 0.0.0.0 --port 9001 > ~/hcph_frontend.log 2>&1 &
```

### Stop

```bash
pkill -f "uvicorn app.main"
pkill -f "vite"
```

### Check status

```bash
ss -tlnp | grep -E '9000|9001'
cat ~/hcph_backend.log
cat ~/hcph_frontend.log
```

---

## API Endpoints

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with username/password → JWT token |
| POST | `/api/auth/register` | Register new user |
| GET | `/api/auth/me` | Get current user details |
| PUT | `/api/auth/profile` | Update profile (display name, password) |

### Board Management
| Method | Path | Description |
|---|---|---|
| GET | `/api/boards` | List all boards (supports `include_archived`) |
| POST | `/api/boards` | Create board (`pi_planning` or `kanban` type) |
| GET | `/api/boards/{board_id}` | Get board details |
| PUT | `/api/boards/{board_id}` | Update board |
| PATCH | `/api/boards/{board_id}/archive` | Archive board |
| DELETE | `/api/boards/{board_id}` | Delete board |
| POST | `/api/boards/{board_id}/clone` | Clone board |
| GET | `/api/boards/{board_id}/activity` | Get activity log |

### PI Planning Board
| Method | Path | Description |
|---|---|---|
| GET | `/api/board` | Full board state (query: `board_id`, `refresh_external`) |
| POST | `/api/board/commit` | Commit board changes |
| POST | `/api/milestones` | Create milestone (JIRA IDEA or temp) |
| POST | `/api/tasks` | Create task (link existing or create new JIRA/ADO) |
| PATCH | `/api/items/{item_id}/move` | Move item to different row/slots |
| DELETE | `/api/items/{item_id}` | Delete item |
| POST | `/api/links` | Create dependency link |
| DELETE | `/api/links/{link_id}` | Delete dependency link |
| PUT | `/api/team-assignments/{row_index}` | Assign team to row |
| DELETE | `/api/team-rows/{row_index}` | Clear team row |
| GET | `/api/team-rows/{row_index}/items-count` | Item count in row |

### Kanban Board
| Method | Path | Description |
|---|---|---|
| GET | `/api/kanban/{board_id}` | Get kanban board state |
| POST | `/api/kanban/{board_id}/columns` | Create column |
| PUT | `/api/kanban/columns/{col_id}` | Edit column |
| DELETE | `/api/kanban/columns/{col_id}` | Delete column |
| POST | `/api/kanban/{board_id}/rows` | Create row |
| PUT | `/api/kanban/rows/{row_id}` | Edit row |
| DELETE | `/api/kanban/rows/{row_id}` | Delete row |
| POST | `/api/kanban/{board_id}/cards` | Create card |
| PUT | `/api/kanban/cards/{card_id}` | Edit/move card |
| DELETE | `/api/kanban/cards/{card_id}` | Delete card |
| GET | `/api/kanban/ticket-lookup` | Lookup JIRA/ADO ticket by key |

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/{user_id}` | Update user |
| DELETE | `/api/admin/users/{user_id}` | Delete user |
| GET | `/api/admin/users/{user_id}/boards` | User's boards |
| GET | `/api/admin/users/{user_id}/credentials` | User's credentials |
| PUT | `/api/admin/users/{user_id}/credentials/{provider}` | Save credential (admin) |
| DELETE | `/api/admin/users/{user_id}/credentials/{provider}` | Delete credential (admin) |
| PATCH | `/api/admin/boards/{board_id}/assign` | Assign board to user |

### Credentials & Integrations
| Method | Path | Description |
|---|---|---|
| GET | `/api/credentials` | List current user's credentials |
| PUT | `/api/credentials/{provider}` | Save/update credential (jira or ado) |
| DELETE | `/api/credentials/{provider}` | Delete credential |
| POST | `/api/credentials/{provider}/test` | Test credential connection |
| GET | `/api/jira/projects` | List JIRA projects |
| GET | `/api/jira/projects/{project_key}/issue-types` | Issue types for project |
| GET | `/api/jira/field-options` | Custom field options |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |

---

## Data Model (SQLite)

| Table | Purpose |
|---|---|
| `users` | User accounts with bcrypt password hashes and roles (user/admin) |
| `boards` | Board metadata — name, dates, type (pi_planning/kanban), archive flag |
| `board_items` | PI board cards — issue key, title, row/slot position, JIRA metadata, sync status |
| `board_transactions` | Append-only change log (CREATE, MOVE) with old/new JSON state |
| `row_team_assignments` | Team-to-row mapping per board |
| `board_item_links` | Dependency links between items (blocks, depends_on, relates_to) |
| `board_commits` | Verified commit snapshots with JSON summaries |
| `board_activity` | Board-level activity log |
| `kanban_columns` | Kanban column definitions with color and position |
| `kanban_rows` | Kanban swimlane rows |
| `kanban_cards` | Kanban cards with column/row placement and optional JIRA/ADO link |
| `credentials` | Fernet-encrypted JIRA/ADO credentials per user |

---

## JIRA Notes

- Backend uses JIRA REST endpoint: `/rest/api/2/issue/{issueKey}?fields=summary,issuetype`
- Only `issuetype = IDEA` is allowed for the Milestone row
- Per-user JIRA credentials are stored encrypted; admin can also manage credentials on behalf of users
- If your on-prem JIRA uses a different auth mode, adjust `fetch_jira_summary` in backend

---

## Status Color Mapping

Standardized across PI board and Gantt chart for both JIRA and ADO statuses:

| Status Tone | Matched Keywords | Color | Hex |
|---|---|---|---|
| **Done** | done, resolved, closed | Green | `#15803d` |
| **In Progress** | development, dev, progress, active, ongoing | Orange | `#ea7a12` |
| **Blocked** | block, hold | Red | `#dc2626` |
| **To Do** | todo, open, backlog, new | Slate | `#64748b` |
| **Design** | design | Gold | `#d4a017` |
| **Ready** | ready | Gold | `#d4a017` |
| **Icebox** | icebox, refill | Red | `#dc2626` |
| **Unknown** | (no match / empty) | Gray | `#94a3b8` |

### Milestone RAG Health

Applied only to IDEA milestones. Evaluated in order — first match wins:

| RAG | Condition | PI Board | Gantt |
|---|---|---|---|
| 🟢 Green | 100% done, or no red/amber triggers | No badge (clean tile) | Green diamond, green text |
| 🟡 Amber | >75% timeline with <50% done, or timeline-progress gap >10% | "WARNING" badge (top-right) | Amber diamond + "WARNING" label |
| 🔴 Red | Overdue, any blocked tasks, or timeline-progress gap >25% | "AT RISK" badge (top-right) | Red diamond + "AT RISK" label |
