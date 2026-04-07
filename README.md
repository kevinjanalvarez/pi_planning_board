# Program Planning Board

Program planning board with:
- Frontend: npm + React (Vite)
- Backend: Python + FastAPI + Uvicorn
- Persistence: SQLite (`board.db`)
- Integration: On-prem JIRA (IDEA project milestones)

## Features
- 4-month planning window that always starts from current month.
- 4 weeks per month (`WK1` to `WK4`) for a fixed 16-slot board.
- Milestone row (`row 0`) is reserved for JIRA IDEA milestones.
- Left-click any Milestone cell to create milestone input popup.
- Milestone creation requires existing IDEA issue key and target date.
- Add Task supports creating a new JIRA ticket (select JIRA project key) or a new ADO ticket (fixed type: User Story) when Source is set to New.
- JIRA summary is fetched and shown in the ticket box on board.
- SQLite stores board position data and transaction history.

## Backend Setup

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

## Frontend Setup

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

## API Endpoints
- `GET /api/board` -> board shape, rows, and items.
- `POST /api/milestones` -> create IDEA milestone from JIRA key and target date.
- `GET /api/jira/projects` -> list available JIRA project keys for new task creation.
- `PATCH /api/items/{item_id}/move` -> move existing non-milestone items.
- `GET /health` -> health check.

## Data Model

### `board_items`
- stores each board card location and metadata (`row_index`, `start_slot`, `end_slot`, `target_date`, etc.)

### `board_transactions`
- append-only change log (`CREATE`, `MOVE`) with old/new JSON state

## JIRA Notes
- Backend uses JIRA REST endpoint:
  - `/rest/api/2/issue/{issueKey}?fields=summary,issuetype`
- Only `issuetype = IDEA` is allowed for Milestone row.
- If your on-prem JIRA uses a different auth mode, adjust `fetch_jira_summary` in backend.
