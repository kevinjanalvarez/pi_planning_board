import sqlite3
conn = sqlite3.connect("board.db")

# Migrate: change UNIQUE(issue_key, row_index) to UNIQUE(board_id, issue_key, row_index)
print("Migrating board_items unique constraint...")

conn.execute("ALTER TABLE board_items RENAME TO _board_items_old")
conn.execute("""
    CREATE TABLE board_items (
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
        jira_assignee TEXT,
        jira_shirt_size TEXT,
        jira_status TEXT,
        jira_description TEXT,
        sync_status TEXT DEFAULT 'synced',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(board_id, issue_key, row_index)
    )
""")
conn.execute("""
    INSERT INTO board_items
        (id, board_id, issue_key, title, item_type, ticket_source, external_work_item_type,
         row_index, row_label, start_slot, end_slot, target_date, end_date, color,
         jira_assignee, jira_shirt_size, jira_status, jira_description, sync_status,
         created_at, updated_at)
    SELECT id, board_id, issue_key, title, item_type, ticket_source, external_work_item_type,
           row_index, row_label, start_slot, end_slot, target_date, end_date, color,
           jira_assignee, jira_shirt_size, jira_status, jira_description, sync_status,
           created_at, updated_at
    FROM _board_items_old
""")
conn.execute("DROP TABLE _board_items_old")
conn.commit()

# Verify
for r in conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='board_items'"):
    print(r[0])
print("\nMigration complete!")
conn.close()
