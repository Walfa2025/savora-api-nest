#!/usr/bin/env bash
set -euo pipefail

PHONE="${1:-+31646095546}"

out="$("./scripts/me_clipboard.sh" 2>&1 || true)"
echo "$out"

if echo "$out" | grep -qE 'NO_VALID_JWT_IN_CLIPBOARD|HTTP=401'; then
  echo "REFRESHING_JWT..."
  ./scripts/impersonate_clipboard.sh "$PHONE" >/dev/null
  ./scripts/me_clipboard.sh
fi
