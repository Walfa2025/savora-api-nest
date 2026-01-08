#!/usr/bin/env bash
set -euo pipefail

PHONE="${1:-}"
if [ -z "$PHONE" ] || ! echo "$PHONE" | grep -qE '^\+\d{8,15}$'; then
  echo "USAGE: $0 +31646095546"
  exit 2
fi

JWT_SECRET="$(node - <<'NODE'
const fs=require("fs");
const s=fs.readFileSync(".env","utf8");
const m=s.match(/^JWT_SECRET=(.*)$/m);
if(!m) process.exit(2);
let v=m[1].trim();
if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
process.stdout.write(v);
NODE
)"
[ -n "$JWT_SECRET" ] || { echo "JWT_SECRET_MISSING"; exit 3; }

ADMIN_ID="$(sqlite3 dev.db 'select id from "User" where role="ADMIN" order by updatedAt desc limit 1;' | tr -d '\r\n')"
[ -n "$ADMIN_ID" ] || { echo "NO_ADMIN_IN_DB"; exit 4; }

ADMIN_TOKEN="$(JWT_SECRET="$JWT_SECRET" ADMIN_ID="$ADMIN_ID" node - <<'NODE'
const jwt=require("jsonwebtoken");
process.stdout.write(jwt.sign({sub: process.env.ADMIN_ID}, process.env.JWT_SECRET, {expiresIn:"10m"}));
NODE
)"

RESP="$(curl -sS -X POST http://127.0.0.1:3000/admin/dev/impersonate \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"phoneE164\":\"$PHONE\"}")"

USER_TOKEN="$(printf '%s' "$RESP" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.accessToken||"");')"
[ -n "$USER_TOKEN" ] || { echo "NO_USER_TOKEN_RETURNED"; exit 5; }

printf "%s" "$USER_TOKEN" | pbcopy
echo "JWT_REFRESHED_IN_CLIPBOARD phone=$PHONE"
