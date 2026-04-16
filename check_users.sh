#!/bin/bash
cd ~/HCPH_PI_BOARD
source backend/.venv/bin/activate
python3 -c "
import sqlite3, glob

# Find all .db files
dbs = glob.glob('**/*.db', recursive=True)
print('DB files found:', dbs)

for db in dbs:
    c = sqlite3.connect(db)
    tables = c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
    print(f'\n{db} tables: {[t[0] for t in tables]}')
    if any('users' in t[0] for t in tables):
        rows = c.execute('SELECT id, username, display_name, role FROM users').fetchall()
        for r in rows:
            print(f'  {r}')
    c.close()
"
