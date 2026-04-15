#!/bin/bash
pkill -f "vite" 2>/dev/null
sleep 1
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
cd ~/HCPH_PI_BOARD/frontend
nohup npm run dev -- --host 0.0.0.0 --port 9001 > ~/hcph_frontend.log 2>&1 &
sleep 4
cat ~/hcph_frontend.log
