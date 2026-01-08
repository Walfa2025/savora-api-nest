#!/usr/bin/env bash
set -euo pipefail

RAW="$(pbpaste || true)"
TOKEN="$(printf "%s" "$RAW" | tr -d '\r\n' | grep -oE 'eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+' | head -n1 || true)"

if [ -z "${TOKEN:-}" ]; then
  echo "NO_VALID_JWT_IN_CLIPBOARD"
  exit 1
fi

DOTS="$(printf "%s" "$TOKEN" | tr -cd '.' | wc -c | tr -d ' ')"
echo "JWT_OK len=${#TOKEN} dots=${DOTS}"

curl -sS -w "\nHTTP=%{http_code}\n" \
  http://127.0.0.1:3000/auth/me \
  -H "Authorization: Bearer $TOKEN"
