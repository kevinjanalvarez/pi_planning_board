import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from collections.abc import Iterator
from typing import Any

DB_PATH = os.getenv("DB_PATH", "board.db")


def _dict_factory(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = _dict_factory
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id INTEGER NOT NULL DEFAULT 0,
                issue_key TEXT,
                title TEXT NOT NULL,
                item_type TEXT NOT NULL,
                ticket_source TEXT,
                external_work_item_type TEXT,
                row_index INTEGER NOT NULL,
                row_label TEXT NOT NULL,
                start_slot INTEGER NOT NULL,
                end_slot INTEGER NOT NULL,
                target_date TEXT,
                end_date TEXT,
                color TEXT DEFAULT '#1f6688',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(board_items)").fetchall()}
        if "end_date" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN end_date TEXT")
        if "jira_assignee" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN jira_assignee TEXT")
        if "jira_shirt_size" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN jira_shirt_size TEXT")
        if "jira_status" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN jira_status TEXT")
        if "jira_description" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN jira_description TEXT")
        if "ticket_source" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN ticket_source TEXT")
        if "external_work_item_type" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN external_work_item_type TEXT")
        if "sync_status" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN sync_status TEXT DEFAULT 'synced'")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_item_id INTEGER,
                action TEXT NOT NULL,
                old_state TEXT,
                new_state TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(board_item_id) REFERENCES board_items(id)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS row_team_assignments (
                board_id INTEGER NOT NULL DEFAULT 0,
                row_index INTEGER NOT NULL,
                team_code TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (board_id, row_index)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_item_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_item_id INTEGER NOT NULL,
                target_item_id INTEGER NOT NULL,
                link_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(source_item_id, target_item_id, link_type),
                FOREIGN KEY(source_item_id) REFERENCES board_items(id),
                FOREIGN KEY(target_item_id) REFERENCES board_items(id)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_commits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                verified INTEGER NOT NULL,
                summary TEXT,
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS boards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                start_date TEXT,
                end_date TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                is_archived INTEGER NOT NULL DEFAULT 0
            )
            """
        )

        # ── Migrations for existing databases ──────────────────────────────
        # board_id on board_items
        if "board_id" not in columns:
            conn.execute("ALTER TABLE board_items ADD COLUMN board_id INTEGER NOT NULL DEFAULT 0")
            first_board = conn.execute("SELECT id FROM boards ORDER BY id LIMIT 1").fetchone()
            if first_board:
                conn.execute("UPDATE board_items SET board_id = ?", (first_board["id"],))

        # start_date / end_date on boards
        board_cols = {r["name"] for r in conn.execute("PRAGMA table_info(boards)").fetchall()}
        if "start_date" not in board_cols:
            conn.execute("ALTER TABLE boards ADD COLUMN start_date TEXT")
        if "end_date" not in board_cols:
            conn.execute("ALTER TABLE boards ADD COLUMN end_date TEXT")

        # Recreate row_team_assignments with composite PK (board_id, row_index)
        rta_cols = {r["name"] for r in conn.execute("PRAGMA table_info(row_team_assignments)").fetchall()}
        if "board_id" not in rta_cols:
            conn.execute("ALTER TABLE row_team_assignments RENAME TO _rta_old")
            conn.execute(
                """
                CREATE TABLE row_team_assignments (
                    board_id INTEGER NOT NULL DEFAULT 0,
                    row_index INTEGER NOT NULL,
                    team_code TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (board_id, row_index)
                )
                """
            )
            first_board = conn.execute("SELECT id FROM boards ORDER BY id LIMIT 1").fetchone()
            migrate_bid = first_board["id"] if first_board else 0
            conn.execute(
                "INSERT INTO row_team_assignments SELECT ?, row_index, team_code, updated_at FROM _rta_old",
                (migrate_bid,),
            )
            conn.execute("DROP TABLE _rta_old")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                detail TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def log_activity(board_id: int, action: str, detail: str | None = None) -> None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO board_activity (board_id, action, detail, created_at) VALUES (?, ?, ?, ?)",
            (board_id, action, detail, now),
        )


def fetch_activity(board_id: int, limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM board_activity WHERE board_id = ? ORDER BY created_at DESC LIMIT ?",
            (board_id, limit),
        ).fetchall()
        return rows


def fetch_items(board_id: int = 0) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, board_id, issue_key, title, item_type, row_index, row_label,
                     start_slot, end_slot, target_date, end_date,
                     ticket_source, external_work_item_type,
                     jira_assignee, jira_shirt_size, jira_status, jira_description,
                     color, sync_status, created_at, updated_at
            FROM board_items
            WHERE board_id = ?
            ORDER BY row_index, start_slot, id
            """,
            (board_id,),
        ).fetchall()
        return rows


def fetch_item_by_id(item_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()


def insert_item(item: dict[str, Any], board_id: int = 0) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO board_items
            (board_id, issue_key, title, item_type, ticket_source, external_work_item_type, row_index, row_label, start_slot, end_slot, target_date, end_date, jira_assignee, jira_shirt_size, jira_status, jira_description, color, sync_status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                board_id,
                item.get("issue_key"),
                item["title"],
                item["item_type"],
                item.get("ticket_source"),
                item.get("external_work_item_type"),
                item["row_index"],
                item["row_label"],
                item["start_slot"],
                item["end_slot"],
                item.get("target_date"),
                item.get("end_date"),
                item.get("jira_assignee"),
                item.get("jira_shirt_size"),
                item.get("jira_status"),
                item.get("jira_description"),
                item.get("color", "#1f6688"),
                item.get("sync_status", "synced"),
                now,
                now,
            ),
        )
        item_id = cur.lastrowid
        state = {
            "issue_key": item.get("issue_key"),
            "title": item["title"],
            "item_type": item["item_type"],
            "ticket_source": item.get("ticket_source"),
            "external_work_item_type": item.get("external_work_item_type"),
            "row_index": item["row_index"],
            "row_label": item["row_label"],
            "start_slot": item["start_slot"],
            "end_slot": item["end_slot"],
            "target_date": item.get("target_date"),
            "end_date": item.get("end_date"),
            "jira_assignee": item.get("jira_assignee"),
            "jira_shirt_size": item.get("jira_shirt_size"),
            "jira_status": item.get("jira_status"),
            "jira_description": item.get("jira_description"),
            "color": item.get("color", "#1f6688"),
            "sync_status": item.get("sync_status", "synced"),
        }
        conn.execute(
            """
            INSERT INTO board_transactions (board_item_id, action, old_state, new_state, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, "CREATE", None, json.dumps(state), now),
        )
        return {
            "id": item_id,
            "board_id": board_id,
            **state,
            "created_at": now,
            "updated_at": now,
        }


def update_item_position(item_id: int, row_index: int, start_slot: int, end_slot: int) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            return None

        old_state = {
            "row_index": existing["row_index"],
            "start_slot": existing["start_slot"],
            "end_slot": existing["end_slot"],
        }
        new_state = {
            "row_index": row_index,
            "start_slot": start_slot,
            "end_slot": end_slot,
        }

        conn.execute(
            """
            UPDATE board_items
            SET row_index = ?, start_slot = ?, end_slot = ?, updated_at = ?
            WHERE id = ?
            """,
            (row_index, start_slot, end_slot, now, item_id),
        )

        conn.execute(
            """
            INSERT INTO board_transactions (board_item_id, action, old_state, new_state, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, "MOVE", json.dumps(old_state), json.dumps(new_state), now),
        )

        updated = conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
        return updated


def update_item_external_fields(
    item_id: int,
    *,
    assignee: str | None,
    shirt_size: str | None,
    status: str | None,
    description: str | None,
) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            return None

        old_state = {
            "jira_assignee": existing.get("jira_assignee"),
            "jira_shirt_size": existing.get("jira_shirt_size"),
            "jira_status": existing.get("jira_status"),
            "jira_description": existing.get("jira_description"),
        }
        new_state = {
            "jira_assignee": assignee,
            "jira_shirt_size": shirt_size,
            "jira_status": status,
            "jira_description": description,
        }

        conn.execute(
            """
            UPDATE board_items
            SET jira_assignee = ?, jira_shirt_size = ?, jira_status = ?, jira_description = ?, updated_at = ?
            WHERE id = ?
            """,
            (assignee, shirt_size, status, description, now, item_id),
        )

        conn.execute(
            """
            INSERT INTO board_transactions (board_item_id, action, old_state, new_state, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, "SYNC_EXTERNAL", json.dumps(old_state), json.dumps(new_state), now),
        )

        updated = conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
        return updated


def delete_item(item_id: int) -> bool:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM board_items WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            return False

        old_state = {
            "id": existing["id"],
            "issue_key": existing.get("issue_key"),
            "title": existing["title"],
            "item_type": existing["item_type"],
            "ticket_source": existing.get("ticket_source"),
            "external_work_item_type": existing.get("external_work_item_type"),
            "row_index": existing["row_index"],
            "row_label": existing["row_label"],
            "start_slot": existing["start_slot"],
            "end_slot": existing["end_slot"],
            "target_date": existing.get("target_date"),
            "end_date": existing.get("end_date"),
            "jira_assignee": existing.get("jira_assignee"),
            "jira_shirt_size": existing.get("jira_shirt_size"),
            "jira_status": existing.get("jira_status"),
            "jira_description": existing.get("jira_description"),
            "color": existing.get("color"),
        }

        conn.execute(
            """
            INSERT INTO board_transactions (board_item_id, action, old_state, new_state, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item_id, "DELETE", json.dumps(old_state), None, now),
        )
        conn.execute("DELETE FROM board_item_links WHERE source_item_id = ? OR target_item_id = ?", (item_id, item_id))
        conn.execute("DELETE FROM board_items WHERE id = ?", (item_id,))
        return True


def fetch_team_assignments(board_id: int = 0) -> dict[int, str]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT row_index, team_code
            FROM row_team_assignments
            WHERE board_id = ?
            ORDER BY row_index
            """,
            (board_id,),
        ).fetchall()
        return {int(row["row_index"]): row["team_code"] for row in rows}


def save_team_assignment(row_index: int, team_code: str | None, board_id: int = 0) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        if team_code:
            conn.execute(
                """
                INSERT INTO row_team_assignments (board_id, row_index, team_code, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(board_id, row_index)
                DO UPDATE SET team_code = excluded.team_code, updated_at = excluded.updated_at
                """,
                (board_id, row_index, team_code, now),
            )
            return {
                "board_id": board_id,
                "row_index": row_index,
                "team_code": team_code,
                "updated_at": now,
            }

        conn.execute(
            "DELETE FROM row_team_assignments WHERE board_id = ? AND row_index = ?",
            (board_id, row_index),
        )
        return None


def fetch_links(board_id: int = 0) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT l.id, l.source_item_id, l.target_item_id, l.link_type, l.created_at
            FROM board_item_links l
            JOIN board_items bi ON l.source_item_id = bi.id
            WHERE bi.board_id = ?
            ORDER BY l.id
            """,
            (board_id,),
        ).fetchall()
        return rows


def insert_link(source_item_id: int, target_item_id: int, link_type: str) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO board_item_links (source_item_id, target_item_id, link_type, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (source_item_id, target_item_id, link_type, now),
        )
        return {
            "id": cur.lastrowid,
            "source_item_id": source_item_id,
            "target_item_id": target_item_id,
            "link_type": link_type,
            "created_at": now,
        }


def delete_link(link_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM board_item_links WHERE id = ?", (link_id,))
        return cur.rowcount > 0


def fetch_last_commit_timestamp() -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT created_at FROM board_commits ORDER BY id DESC LIMIT 1").fetchone()
        return row["created_at"] if row else None


def count_transactions_since(since_iso: str | None) -> int:
    with get_conn() as conn:
        if since_iso:
            row = conn.execute(
                "SELECT COUNT(*) AS total FROM board_transactions WHERE created_at > ?",
                (since_iso,),
            ).fetchone()
        else:
            row = conn.execute("SELECT COUNT(*) AS total FROM board_transactions").fetchone()
        return int(row["total"] if row else 0)


def insert_board_commit(verified: bool, summary: dict[str, Any]) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO board_commits (verified, summary, created_at)
            VALUES (?, ?, ?)
            """,
            (1 if verified else 0, json.dumps(summary), now),
        )
        return {
            "id": cur.lastrowid,
            "verified": verified,
            "summary": summary,
            "created_at": now,
        }


# ── Board management ──────────────────────────────────────────────────

def fetch_boards(include_archived: bool = False) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if include_archived:
            rows = conn.execute("SELECT * FROM boards ORDER BY created_at DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM boards WHERE is_archived = 0 ORDER BY created_at DESC"
            ).fetchall()
        return rows


def insert_board(
    name: str,
    description: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO boards (name, description, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (name, description, start_date, end_date, now, now),
        )
        row = conn.execute("SELECT * FROM boards WHERE id = ?", (cur.lastrowid,)).fetchone()
        return row


def fetch_board_by_id(board_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()
        return row


def update_board(board_id: int, name: str, description: str | None) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE boards SET name = ?, description = ?, updated_at = ? WHERE id = ?",
            (name, description, now, board_id),
        )
        row = conn.execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()
        return row


def archive_board(board_id: int) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE boards SET is_archived = 1, updated_at = ? WHERE id = ?",
            (now, board_id),
        )
        row = conn.execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()
        return row


def delete_board_record(board_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM boards WHERE id = ?", (board_id,))
        return cur.rowcount > 0
