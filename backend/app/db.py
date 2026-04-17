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
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = _dict_factory
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
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
                updated_at TEXT NOT NULL,
                UNIQUE(board_id, issue_key, row_index)
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
        if "created_by" not in board_cols:
            conn.execute("ALTER TABLE boards ADD COLUMN created_by INTEGER")

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

        # ── Users / Auth ──
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                status TEXT NOT NULL DEFAULT 'approved',
                created_at TEXT NOT NULL
            )
            """
        )

        # ── status column migration ──
        user_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "status" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'")

        # ── board_type migration ──
        if "board_type" not in board_cols:
            conn.execute("ALTER TABLE boards ADD COLUMN board_type TEXT NOT NULL DEFAULT 'pi_planning'")

        # ── Kanban tables ──
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kanban_columns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#3b82f6',
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (board_id) REFERENCES boards(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kanban_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#6b7280',
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (board_id) REFERENCES boards(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS kanban_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id INTEGER NOT NULL,
                column_id INTEGER NOT NULL,
                row_id INTEGER,
                title TEXT NOT NULL,
                issue_key TEXT,
                ticket_source TEXT,
                description TEXT,
                color TEXT DEFAULT '#1f6688',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (board_id) REFERENCES boards(id),
                FOREIGN KEY (column_id) REFERENCES kanban_columns(id),
                FOREIGN KEY (row_id) REFERENCES kanban_rows(id)
            )
            """
        )

        # ── kanban_cards row_id nullable migration ──
        kc_cols = conn.execute("PRAGMA table_info(kanban_cards)").fetchall()
        for col in kc_cols:
            if col["name"] == "row_id" and col["notnull"] == 1:
                conn.execute("ALTER TABLE kanban_cards RENAME TO _kanban_cards_old")
                conn.execute("""
                    CREATE TABLE kanban_cards (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        board_id INTEGER NOT NULL,
                        column_id INTEGER NOT NULL,
                        row_id INTEGER,
                        title TEXT NOT NULL,
                        issue_key TEXT,
                        ticket_source TEXT,
                        description TEXT,
                        color TEXT DEFAULT '#1f6688',
                        position INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (board_id) REFERENCES boards(id),
                        FOREIGN KEY (column_id) REFERENCES kanban_columns(id),
                        FOREIGN KEY (row_id) REFERENCES kanban_rows(id)
                    )
                """)
                conn.execute("INSERT INTO kanban_cards SELECT * FROM _kanban_cards_old")
                conn.execute("DROP TABLE _kanban_cards_old")
                break

        # ── kanban_cards source-aware columns migration ──
        kc_col_names = [c["name"] for c in conn.execute("PRAGMA table_info(kanban_cards)").fetchall()]
        if "assignee" not in kc_col_names:
            conn.execute("ALTER TABLE kanban_cards ADD COLUMN assignee TEXT")
        if "external_status" not in kc_col_names:
            conn.execute("ALTER TABLE kanban_cards ADD COLUMN external_status TEXT")
        if "external_url" not in kc_col_names:
            conn.execute("ALTER TABLE kanban_cards ADD COLUMN external_url TEXT")
        if "external_title" not in kc_col_names:
            conn.execute("ALTER TABLE kanban_cards ADD COLUMN external_title TEXT")


# ── User / Auth helpers ─────────────────────────────────────────────────

def create_user(username: str, display_name: str, password_hash: str, role: str = "user", status: str = "approved") -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, display_name, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (username, display_name, password_hash, role, status, now),
        )
        return {
            "id": cur.lastrowid,
            "username": username,
            "display_name": display_name,
            "role": role,
            "status": status,
            "created_at": now,
        }


def fetch_user_by_username(username: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def fetch_user_by_id(user_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def fetch_all_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute("SELECT id, username, display_name, role, status, created_at FROM users ORDER BY id").fetchall()


def update_user(
    user_id: int,
    *,
    display_name: str | None = None,
    role: str | None = None,
    password_hash: str | None = None,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not existing:
            return None
        new_display = display_name if display_name is not None else existing["display_name"]
        new_role = role if role is not None else existing["role"]
        new_hash = password_hash if password_hash is not None else existing["password_hash"]
        conn.execute(
            "UPDATE users SET display_name = ?, role = ?, password_hash = ? WHERE id = ?",
            (new_display, new_role, new_hash, user_id),
        )
        return {
            "id": user_id,
            "username": existing["username"],
            "display_name": new_display,
            "role": new_role,
            "status": existing["status"],
            "created_at": existing["created_at"],
        }


def delete_user(user_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cur.rowcount > 0


def update_user_status(user_id: int, status: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
        return cur.rowcount > 0


def fetch_pending_user_count() -> int:
    with get_conn() as conn:
        row = conn.execute("SELECT COUNT(*) AS cnt FROM users WHERE status = 'pending'").fetchone()
        return row["cnt"] if row else 0


def fetch_users_with_board_count() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.display_name, u.role, u.status, u.created_at,
                   COUNT(b.id) AS board_count
            FROM users u
            LEFT JOIN boards b ON b.created_by = u.id
            GROUP BY u.id
            ORDER BY u.id
            """
        ).fetchall()
        return rows


def fetch_boards_by_user(user_id: int, include_archived: bool = False) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if include_archived:
            return conn.execute(
                "SELECT * FROM boards WHERE created_by = ? ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
        return conn.execute(
            "SELECT * FROM boards WHERE created_by = ? AND is_archived = 0 ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()


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


def clear_team_row(board_id: int, row_index: int) -> dict[str, Any]:
    """Remove team assignment and delete all items (+ their links) on a row,
    then shift higher rows down to fill the gap."""
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        # Find items on this row
        items = conn.execute(
            "SELECT id, issue_key, title FROM board_items WHERE board_id = ? AND row_index = ?",
            (board_id, row_index),
        ).fetchall()
        item_ids = [r["id"] for r in items]

        # Delete links referencing those items
        if item_ids:
            placeholders = ",".join("?" * len(item_ids))
            conn.execute(
                f"DELETE FROM board_item_links WHERE source_item_id IN ({placeholders}) OR target_item_id IN ({placeholders})",
                item_ids + item_ids,
            )
            # Log transactions for each deleted item
            for item in items:
                old_state = {"id": item["id"], "issue_key": item["issue_key"], "title": item["title"]}
                conn.execute(
                    "INSERT INTO board_transactions (board_item_id, action, old_state, new_state, created_at) VALUES (?, ?, ?, ?, ?)",
                    (item["id"], "DELETE", json.dumps(old_state), None, now),
                )
            # Delete items
            conn.execute(
                f"DELETE FROM board_items WHERE id IN ({placeholders})",
                item_ids,
            )

        # Remove team assignment
        conn.execute(
            "DELETE FROM row_team_assignments WHERE board_id = ? AND row_index = ?",
            (board_id, row_index),
        )

        # ── Shift higher rows down by 1 to fill the gap ──
        max_row = 10
        for ri in range(row_index + 1, max_row + 1):
            new_ri = ri - 1
            new_label = f"Team#{new_ri}"
            # Shift items
            conn.execute(
                "UPDATE board_items SET row_index = ?, row_label = ?, updated_at = ? WHERE board_id = ? AND row_index = ?",
                (new_ri, new_label, now, board_id, ri),
            )
            # Shift team assignments: delete target slot first (to avoid PK conflict), then update
            conn.execute(
                "DELETE FROM row_team_assignments WHERE board_id = ? AND row_index = ?",
                (board_id, new_ri),
            )
            conn.execute(
                "UPDATE row_team_assignments SET row_index = ? WHERE board_id = ? AND row_index = ?",
                (new_ri, board_id, ri),
            )

        return {"deleted_items": len(item_ids), "item_ids": item_ids}


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
    created_by: int | None = None,
    board_type: str = "pi_planning",
) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO boards (name, description, start_date, end_date, created_by, board_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (name, description, start_date, end_date, created_by, board_type, now, now),
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


def assign_board_owner(board_id: int, user_id: int) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE boards SET created_by = ?, updated_at = ? WHERE id = ?",
            (user_id, now, board_id),
        )
        row = conn.execute("SELECT * FROM boards WHERE id = ?", (board_id,)).fetchone()
        return row


def delete_board_record(board_id: int) -> bool:
    with get_conn() as conn:
        # Cascade-delete all data associated with the board
        item_ids = [r["id"] for r in conn.execute("SELECT id FROM board_items WHERE board_id = ?", (board_id,)).fetchall()]
        if item_ids:
            placeholders = ",".join("?" * len(item_ids))
            conn.execute(f"DELETE FROM board_item_links WHERE source_item_id IN ({placeholders}) OR target_item_id IN ({placeholders})", item_ids + item_ids)
            conn.execute(f"DELETE FROM board_transactions WHERE board_item_id IN ({placeholders})", item_ids)
        conn.execute("DELETE FROM board_items WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM row_team_assignments WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM board_activity WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM kanban_cards WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM kanban_columns WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM kanban_rows WHERE board_id = ?", (board_id,))
        cur = conn.execute("DELETE FROM boards WHERE id = ?", (board_id,))
        return cur.rowcount > 0


# ── Kanban helpers ───────────────────────────────────────────────────────

def fetch_kanban_columns(board_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY position", (board_id,)
        ).fetchall()


def insert_kanban_column(board_id: int, name: str, color: str = "#3b82f6") -> dict[str, Any]:
    with get_conn() as conn:
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) as mp FROM kanban_columns WHERE board_id = ?", (board_id,)
        ).fetchone()["mp"]
        cur = conn.execute(
            "INSERT INTO kanban_columns (board_id, name, color, position) VALUES (?, ?, ?, ?)",
            (board_id, name, color, max_pos + 1),
        )
        return conn.execute("SELECT * FROM kanban_columns WHERE id = ?", (cur.lastrowid,)).fetchone()


def update_kanban_column(col_id: int, name: str, color: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        conn.execute("UPDATE kanban_columns SET name = ?, color = ? WHERE id = ?", (name, color, col_id))
        return conn.execute("SELECT * FROM kanban_columns WHERE id = ?", (col_id,)).fetchone()


def delete_kanban_column(col_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM kanban_cards WHERE column_id = ?", (col_id,))
        return conn.execute("DELETE FROM kanban_columns WHERE id = ?", (col_id,)).rowcount > 0


def fetch_kanban_rows(board_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM kanban_rows WHERE board_id = ? ORDER BY position", (board_id,)
        ).fetchall()


def insert_kanban_row(board_id: int, name: str, color: str = "#6b7280") -> dict[str, Any]:
    with get_conn() as conn:
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) as mp FROM kanban_rows WHERE board_id = ?", (board_id,)
        ).fetchone()["mp"]
        cur = conn.execute(
            "INSERT INTO kanban_rows (board_id, name, color, position) VALUES (?, ?, ?, ?)",
            (board_id, name, color, max_pos + 1),
        )
        return conn.execute("SELECT * FROM kanban_rows WHERE id = ?", (cur.lastrowid,)).fetchone()


def update_kanban_row(row_id: int, name: str, color: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        conn.execute("UPDATE kanban_rows SET name = ?, color = ? WHERE id = ?", (name, color, row_id))
        return conn.execute("SELECT * FROM kanban_rows WHERE id = ?", (row_id,)).fetchone()


def delete_kanban_row(row_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM kanban_cards WHERE row_id = ?", (row_id,))
        return conn.execute("DELETE FROM kanban_rows WHERE id = ?", (row_id,)).rowcount > 0


def fetch_kanban_cards(board_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM kanban_cards WHERE board_id = ? ORDER BY position", (board_id,)
        ).fetchall()


def insert_kanban_card(board_id: int, column_id: int, row_id: int | None, title: str, color: str = "#1f6688",
                       issue_key: str | None = None, ticket_source: str | None = None,
                       description: str | None = None,
                       assignee: str | None = None, external_status: str | None = None,
                       external_url: str | None = None, external_title: str | None = None) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        if row_id is not None:
            max_pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) as mp FROM kanban_cards WHERE board_id = ? AND column_id = ? AND row_id = ?",
                (board_id, column_id, row_id),
            ).fetchone()["mp"]
        else:
            max_pos = conn.execute(
                "SELECT COALESCE(MAX(position), -1) as mp FROM kanban_cards WHERE board_id = ? AND column_id = ? AND row_id IS NULL",
                (board_id, column_id),
            ).fetchone()["mp"]
        cur = conn.execute(
            "INSERT INTO kanban_cards (board_id, column_id, row_id, title, color, issue_key, ticket_source, description, assignee, external_status, external_url, external_title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (board_id, column_id, row_id, title, color, issue_key, ticket_source, description, assignee, external_status, external_url, external_title, max_pos + 1, now, now),
        )
        return conn.execute("SELECT * FROM kanban_cards WHERE id = ?", (cur.lastrowid,)).fetchone()


def update_kanban_card(card_id: int, title: str | None = None, column_id: int | None = None, row_id: int | None = None, color: str | None = None) -> dict[str, Any] | None:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        card = conn.execute("SELECT * FROM kanban_cards WHERE id = ?", (card_id,)).fetchone()
        if not card:
            return None
        conn.execute(
            "UPDATE kanban_cards SET title = ?, column_id = ?, row_id = ?, color = ?, updated_at = ? WHERE id = ?",
            (
                title if title is not None else card["title"],
                column_id if column_id is not None else card["column_id"],
                row_id if row_id is not None else card["row_id"],
                color if color is not None else card["color"],
                now,
                card_id,
            ),
        )
        return conn.execute("SELECT * FROM kanban_cards WHERE id = ?", (card_id,)).fetchone()


def delete_kanban_card(card_id: int) -> bool:
    with get_conn() as conn:
        return conn.execute("DELETE FROM kanban_cards WHERE id = ?", (card_id,)).rowcount > 0


# ── Credentials management ──────────────────────────────────────────────

def init_credentials_table() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                label TEXT,
                encrypted_data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, provider),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )


def upsert_credential(user_id: int, provider: str, encrypted_data: str, label: str | None = None) -> dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM user_credentials WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE user_credentials SET encrypted_data = ?, label = ?, updated_at = ? WHERE id = ?",
                (encrypted_data, label, now, existing["id"]),
            )
            return conn.execute("SELECT id, user_id, provider, label, created_at, updated_at FROM user_credentials WHERE id = ?", (existing["id"],)).fetchone()
        else:
            cur = conn.execute(
                "INSERT INTO user_credentials (user_id, provider, encrypted_data, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, provider, encrypted_data, label, now, now),
            )
            return conn.execute("SELECT id, user_id, provider, label, created_at, updated_at FROM user_credentials WHERE id = ?", (cur.lastrowid,)).fetchone()


def fetch_credentials_by_user(user_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM user_credentials WHERE user_id = ? ORDER BY provider",
            (user_id,),
        ).fetchall()


def fetch_credential(user_id: int, provider: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM user_credentials WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()


def delete_credential(user_id: int, provider: str) -> bool:
    with get_conn() as conn:
        return conn.execute(
            "DELETE FROM user_credentials WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).rowcount > 0
