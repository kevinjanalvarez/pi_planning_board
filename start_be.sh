#!/bin/bash
pkill -f "uvicorn app.main" 2>/dev/null
sleep 1
cd ~/HCPH_PI_BOARD/backend
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 9000 --workers 4 > ~/hcph_backend.log 2>&1 &
echo $! > ~/hcph_backend.pid
sleep 3
cat ~/hcph_backend.log
