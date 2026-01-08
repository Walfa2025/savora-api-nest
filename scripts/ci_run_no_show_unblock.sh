#!/usr/bin/env bash
set -euo pipefail

# CI runner: generate a high-entropy phone each run to avoid COOLDOWN collisions.
# Uses a per-run state file (digits-only) to avoid collisions in parallel jobs.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Default phone: +35569 + last-6-of-epoch-seconds + 2 random digits  => stable length, very low collision rate
TS="$(date +%s)"
TAIL="${TS: -6}"
R2="$(printf "%02d" $((RANDOM%90+10)))"
PHONE="${PHONE:-+35569${TAIL}${R2}}"

PHONE_DIGITS="$(printf "%s" "$PHONE" | tr -cd '0-9')"
STATE_FILE="${STATE_FILE:-.e2e_no_show_state.${PHONE_DIGITS}.json}"

echo "CI_PHONE=$PHONE"
echo "CI_STATE_FILE=$STATE_FILE"

exec bash scripts/e2e_no_show_unblock_ci.sh \
  --fresh-state \
  --no-cooldown-bypass \
  --phone "$PHONE" \
  --state-file "$STATE_FILE" \
  "$@"
