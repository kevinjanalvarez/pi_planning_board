# PI Planning Board — LinkedIn Project Showcase

## Project Overview

**PI Planning Board** is an internal web tool I designed and built from scratch to digitize and streamline Program Increment (PI) planning ceremonies for agile delivery teams. The tool replaces static spreadsheets and physical sticky-note boards with an interactive, real-time planning surface that integrates directly with the organization's existing JIRA and Azure DevOps (ADO) ecosystems.

---

## The Problem

PI planning sessions are a cornerstone of the Scaled Agile Framework (SAFe), but managing them in practice often means wrestling with bloated Excel files, disconnected JIRA exports, or expensive third-party tools. Teams needed a purpose-built solution that:

- Reflects a live 4-month planning window with week-level granularity
- Pulls ticket data directly from JIRA and ADO — no copy-pasting
- Lets teams drag, assign, and link work items visually on a shared board
- Keeps a full audit trail of every planning decision

---

## What I Built

A full-stack web application comprised of a **React (Vite)** single-page frontend and a **FastAPI (Python)** REST backend, backed by **SQLite** for lightweight, zero-config persistence.

### Key Features

| Feature | Description |
|---|---|
| **Multi-board management** | Create, edit, archive, clone, and delete named PI boards with configurable date ranges |
| **Dynamic planning columns** | Auto-generates monthly columns (WK1–WK4) from a configurable start/end date; supports variable PI lengths |
| **Milestone row** | Dedicated row 0 reserved for JIRA IDEA-type milestones; linked to real JIRA issue keys |
| **JIRA integration** | Fetch issue metadata (summary, type, status, assignee, description, shirt size) from on-prem JIRA REST API; create new JIRA tickets from the board |
| **ADO integration** | Create and fetch Azure DevOps User Story work items from the board via ADO REST API |
| **Team rows** | Up to 10 configurable team rows with drag-to-reposition and multi-slot span support |
| **Dependency linking** | Draw `blocks`, `depends_on`, and `relates_to` links between any two work items across teams |
| **Activity log** | Append-only transaction history capturing every `CREATE` and `MOVE` event with before/after snapshots |

---

## Tech Stack

**Frontend**
- React 18 + Vite
- Custom CSS (no UI framework — full design ownership)

**Backend**
- Python 3.13
- FastAPI — async REST API with Pydantic v2 request validation
- Uvicorn ASGI server
- SQLite — embedded persistence (zero external DB dependency)
- `requests` — HTTP client for JIRA and ADO integrations

**Infrastructure / Tooling**
- Environment-based config via `.env` (`VITE_API_BASE` for frontend, `.env` for backend)
- CORS middleware (configurable origin)
- Corporate SSL/CA bundle support for on-prem JIRA
- Deployed on internal Linux server (intranet) — no SaaS, no cloud cost
- Python 3.13 via Miniconda · Node.js v24 via NVM

---

## Architecture Highlights

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

- **Stateless API** — all board state lives in SQLite; the frontend is a pure view layer
- **Pydantic models** — strict input validation on all write endpoints
- **Append-only transactions** — every board mutation is logged with full JSON diff for auditability

---

## Impact

- Reduced PI planning prep time by eliminating manual spreadsheet maintenance
- Enabled real-time collaborative planning without additional SaaS licensing costs
- Provided a full history of planning decisions for retrospective analysis and compliance

---

## Roles & Responsibilities

Built end-to-end as a solo initiative:
- Requirement gathering from delivery teams and PI planning facilitators
- Full-stack design and development (frontend UI, REST API, data model)
- JIRA and Azure DevOps REST API integration
- Internal server deployment (Linux, intranet) and user onboarding

---

*Built at Home Credit Philippines · 2025–2026*
*Stack: React · Vite · FastAPI · Python 3.13 · SQLite · JIRA REST API · Azure DevOps REST API · Linux (intranet)*
