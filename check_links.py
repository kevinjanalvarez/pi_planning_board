import sqlite3
con = sqlite3.connect("backend/board.db")
con.row_factory = sqlite3.Row

links = con.execute("SELECT * FROM board_item_links").fetchall()
print(f"Total links: {len(links)}")
for l in links[:10]:
    print(dict(l))

ideas = con.execute("SELECT id, issue_key, title, item_type, jira_status FROM board_items WHERE item_type='IDEA'").fetchall()
print(f"\nTotal IDEA milestones: {len(ideas)}")
for i in ideas:
    print(dict(i))

idea_ids = {i["id"] for i in ideas}
for l in links:
    if l["source_item_id"] in idea_ids or l["target_item_id"] in idea_ids:
        print(f"IDEA link: id={l['id']} src={l['source_item_id']} tgt={l['target_item_id']} type={l['link_type']}")

# Check tasks and their statuses
tasks = con.execute("SELECT id, issue_key, item_type, jira_status, ticket_source FROM board_items WHERE item_type='TASK'").fetchall()
print(f"\nTotal TASK items: {len(tasks)}")
for t in tasks[:10]:
    print(dict(t))
