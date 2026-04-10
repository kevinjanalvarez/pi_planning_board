# PI Planning Board

**PI Planning Board** is an internal web tool designed and built from scratch to digitize and streamline Program Increment (PI) planning ceremonies for agile delivery teams. It replaces static spreadsheets and physical sticky-note boards with an interactive planning surface that integrates directly with JIRA and Azure DevOps (ADO).

---

## The Problem

PI planning sessions are a cornerstone of the Scaled Agile Framework (SAFe), but managing them in practice often means wrestling with bloated Excel files, disconnected JIRA exports, or expensive third-party tools. Teams needed a purpose-built solution that:

- Reflects a live planning window with week-level granularity
- Pulls ticket data directly from JIRA and ADO — no copy-pasting
- Lets teams drag, assign, and link work items visually on a shared board
- Keeps a full audit trail of every planning decision

---

## Tech Stack

- **Frontend:** React 18 + Vite · Custom CSS
- **Backend:** Python 3.11 · FastAPI · Uvicorn · SQLite
- **Integrations:** On-prem JIRA REST API · Azure DevOps REST API

---

## Key Features

| Feature | Description |
|---|---|
| **Multi-board management** | Create, edit, archive, clone, and delete named PI boards with configurable date ranges |
| **Dynamic planning columns** | Auto-generates monthly columns (WK1–WK4) from a configurable start/end date |
| **Milestone row** | Dedicated row reserved for JIRA IDEA-type milestones linked to real JIRA issue keys |
| **JIRA integration** | Fetch issue metadata and create new JIRA tickets directly from the board |
| **ADO integration** | Create and fetch Azure DevOps User Story work items from the board |
| **Team rows** | Up to 10 configurable team rows with drag-to-reposition and multi-slot span support |
| **Dependency linking** | Draw `blocks`, `depends_on`, and `relates_to` links between work items across teams |
| **Activity log** | Append-only transaction history capturing every `CREATE` and `MOVE` event |

---

## Architecture

```
Browser (React SPA)
       │  REST (JSON)
       ▼
FastAPI Backend  ──── JIRA REST API (on-prem)
       │         └─── Azure DevOps REST API
       ▼
    SQLite
  board_items | board_transactions | links | team_assignments | activity_log
```

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
- `JIRA_BASE_URL`
- `JIRA_USERNAME`
- `JIRA_API_TOKEN`
- `JIRA_PROJECT_KEY` (required for creating new JIRA tasks from Add Task)
- `AZURE_ORG` (required for creating/fetching ADO work items)
- `AZURE_PROJECT` (required for creating/fetching ADO work items)
- `AZURE_PAT` (required for creating/fetching ADO work items)
- optional `AZURE_DEFAULT_AREA_PATH`, `AZURE_DEFAULT_ITERATION_PATH` (used during new ADO ticket creation)
- optional `CORS_ORIGIN`, `DB_PATH`

5. Run backend:

```powershell
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

1. Go to frontend folder:

```powershell
cd frontend
npm install
```

2. Run frontend dev server:

```powershell
npm run dev
```

Frontend URL: `http://localhost:5173`

### API Endpoints
- `GET /api/board` -> board shape, rows, and items.
- `POST /api/milestones` -> create IDEA milestone from JIRA key and target date.
- `GET /api/jira/projects` -> list available JIRA project keys for new task creation.
- `PATCH /api/items/{item_id}/move` -> move existing non-milestone items.
- `GET /health` -> health check.

### Data Model

### `board_items`
- stores each board card location and metadata (`row_index`, `start_slot`, `end_slot`, `target_date`, etc.)

### `board_transactions`
- append-only change log (`CREATE`, `MOVE`) with old/new JSON state

### JIRA Notes
- Backend uses JIRA REST endpoint:
  - `/rest/api/2/issue/{issueKey}?fields=summary,issuetype`
- Only `issuetype = IDEA` is allowed for Milestone row.
- If your on-prem JIRA uses a different auth mode, adjust `fetch_jira_summary` in backend.
