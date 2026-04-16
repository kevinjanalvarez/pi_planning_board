#!/bin/bash
set -e
BASE="http://localhost:9000"

echo "=== 1. Login ==="
RESP=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}')
echo "Login response: $RESP"
TOKEN=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "Token obtained: ${TOKEN:0:20}..."

echo ""
echo "=== 2. GET /api/auth/me ==="
curl -sf "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "=== 3. PUT /api/auth/profile ==="
curl -sf -X PUT "$BASE/api/auth/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Administrator"}' | python3 -m json.tool

echo ""
echo "=== 4. GET /api/admin/users (check integrations field) ==="
curl -sf "$BASE/api/admin/users" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
users=json.load(sys.stdin)
for u in users:
    print(f'  #{u[\"id\"]} {u[\"username\"]}: integrations={u.get(\"integrations\",[])}')
"

echo ""
echo "=== 5. GET /api/admin/users/1/credentials ==="
curl -sf "$BASE/api/admin/users/1/credentials" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "=== 6. GET /api/credentials (self) ==="
curl -sf "$BASE/api/credentials" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

echo ""
echo "=== ALL TESTS PASSED ==="
