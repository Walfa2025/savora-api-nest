#!/usr/bin/env bash
set -euo pipefail

# CI-friendly E2E: NO_SHOW -> blocked -> self-unblock -> unblocked
#
# Features:
# - Flags: --fresh-state, --no-cooldown-bypass, --port, --base-url, --phone, --admin-phone, --state-file
# - No token persistence (JWTs generated on the fly from JWT_SECRET + userId)
# - Deterministic asserts + non-zero exit on failure

PHONE="+355690000790"
ADMIN_PHONE="+355690000799"
STATE_FILE=".e2e_no_show_state.json"
API_BASE_URL="http://127.0.0.1"
API_PORT=""
FRESH_STATE=0
NO_COOLDOWN_BYPASS=0
PORTS=(3000 3001 8080 8000 8001)

info(){ echo "==> $*"; }
die(){ echo "ERR: $*" >&2; exit 1; }
need_cmd(){ command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --phone <E164>             Customer phone (default: $PHONE)
  --admin-phone <E164>       Admin phone (default: $ADMIN_PHONE)
  --state-file <path>        State json (default: $STATE_FILE)
  --base-url <url>           API base url (default: $API_BASE_URL)
  --port <n>                 API port (skip autodetect)
  --fresh-state              Ignore existing state; create new vendor+offer
  --no-cooldown-bypass       Fail if COOLDOWN_ACTIVE (no DB test-bypass)
  -h, --help                 Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phone) PHONE="${2:-}"; shift 2;;
    --admin-phone) ADMIN_PHONE="${2:-}"; shift 2;;
    --state-file) STATE_FILE="${2:-}"; shift 2;;
    --base-url) API_BASE_URL="${2:-}"; shift 2;;
    --port) API_PORT="${2:-}"; shift 2;;
    --fresh-state) FRESH_STATE=1; shift;;
    --no-cooldown-bypass) NO_COOLDOWN_BYPASS=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "unknown arg: $1";;
  esac
done

need_cmd node
need_cmd curl

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

api_url() {
  local port="$1"
  echo "${API_BASE_URL%/}:$port"
}

detect_port() {
  local p r base
  for p in "${PORTS[@]}"; do
    base="$(api_url "$p")"
    r="$(curl -sS -m 2 -X POST "$base/payments/mock/succeed" -H "content-type: application/json" -d '{}' 2>/dev/null || true)"
    if echo "$r" | grep -q "order_id_required"; then
      echo "$p"; return 0
    fi
  done
  return 1
}

json_get() {
  local json="$1" expr="$2"
  printf '%s' "$json" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}'); try{const v=($expr); process.stdout.write(v==null?'':String(v));}catch(e){process.stdout.write('');}})"
}

jwt_for_user() {
  local user_id="$1"
  USER_ID="$user_id" node - <<'NODE'
try { require('dotenv').config({ path: '.env' }); } catch {}
const crypto = require('crypto');

const userId = process.env.USER_ID;
const secret = process.env.JWT_SECRET;
if (!secret) { console.error("ERR: JWT_SECRET ontbreekt (zet in .env)."); process.exit(2); }

function b64url(x){
  const b = Buffer.isBuffer(x) ? x : Buffer.from(String(x));
  return b.toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function signHS256(payload, secret){
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now()/1000);
  const body = { ...payload, iat: now, exp: now + 3600 };
  const enc = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', secret).update(enc).digest();
  return `${enc}.${b64url(sig)}`;
}
process.stdout.write(signHS256({ sub: userId }, secret));
NODE
}

ensure_state() {
  local port="$1"

  if [[ $FRESH_STATE -eq 1 ]]; then
    rm -f "$STATE_FILE" || true
  fi

  if [[ -f "$STATE_FILE" ]]; then
    if node -e "const s=require('./$STATE_FILE'); process.exit(s.offerId&&s.vendorId&&s.customerUserId&&s.adminUserId?0:1)"; then
      info "Using existing state: $STATE_FILE"
      return 0
    fi
  fi

  info "Creating fresh state (vendor+offer+users) -> $STATE_FILE"
  PORT="$port" PHONE="$PHONE" ADMIN_PHONE="$ADMIN_PHONE" STATE_FILE="$STATE_FILE" node - <<'NODE'
const fs = require('fs');
try { require('dotenv').config({ path: '.env' }); } catch {}

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const PORT = Number(process.env.PORT);
const PHONE = process.env.PHONE;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const STATE_FILE = process.env.STATE_FILE;

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
  log: ['warn','error'],
});

(async () => {
  await prisma.$connect();

  const customer = await prisma.user.upsert({
    where: { phoneE164: PHONE },
    update: { role: 'CUSTOMER' },
    create: { phoneE164: PHONE, role: 'CUSTOMER' },
    select: { id: true, phoneE164: true },
  });

  const admin = await prisma.user.upsert({
    where: { phoneE164: ADMIN_PHONE },
    update: { role: 'ADMIN', name: 'CI Admin' },
    create: { phoneE164: ADMIN_PHONE, role: 'ADMIN', name: 'CI Admin' },
    select: { id: true, phoneE164: true },
  });

  const now = new Date();
  const vendor = await prisma.vendor.create({
    data: {
      ownerUserId: admin.id,
      status: 'APPROVED',
      name: `CI_VENDOR_${Date.now()}`,
      addressText: 'Tirana (ci)',
      lat: 41.3275,
      lng: 19.8187,
    },
    select: { id: true },
  });

  const offer = await prisma.offer.create({
    data: {
      vendorId: vendor.id,
      status: 'LIVE',
      title: 'CI_OFFER_NO_SHOW',
      description: 'auto',
      priceCents: 100,
      currency: 'ALL',
      qtyTotal: 50,
      qtyAvailable: 50,
      pickupStart: new Date(now.getTime() - 60 * 60 * 1000),
      pickupEnd: new Date(now.getTime() + 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const state = {
    port: PORT,
    phone: PHONE,
    adminPhone: ADMIN_PHONE,
    customerUserId: customer.id,
    adminUserId: admin.id,
    vendorId: vendor.id,
    offerId: offer.id,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`OK: state saved -> ${STATE_FILE}`);
  console.log(`PORT=${PORT}`);
  console.log(`VENDOR_ID=${vendor.id}`);
  console.log(`OFFER_ID=${offer.id}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERR:", e?.message || e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
}

ensure_strikes_to_3() {
  info "Ensuring active NO_SHOW strikes reach 3"
  STATE_FILE="$STATE_FILE" node - <<'NODE'
const fs = require('fs');
try { require('dotenv').config({ path: '.env' }); } catch {}

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE,'utf8'));
const { offerId, customerUserId } = state;

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
  log: ['warn','error'],
});

function claimCode6(){
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function waitNoShow(orderId, beforeActive, timeoutMs=120000){
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    const afterActive = await prisma.strike.count({ where: { userId: customerUserId, reason: 'NO_SHOW', isActive: true } });
    if (o?.status === 'NO_SHOW' && afterActive === beforeActive + 1) return afterActive;
    await new Promise(r => setTimeout(r, 1000));
  }
  const o2 = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  const finalActive = await prisma.strike.count({ where: { userId: customerUserId, reason: 'NO_SHOW', isActive: true } });
  throw new Error(`timeout waiting NO_SHOW. order_status=${o2?.status} active_strikes=${finalActive} (was ${beforeActive})`);
}

(async () => {
  await prisma.$connect();

  // Ensure pickupEnd is in the past so expirer can flip PAID -> NO_SHOW
  await prisma.offer.update({ where: { id: offerId }, data: { pickupEnd: new Date(Date.now() - 3*60*60*1000) } });

  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { priceCents: true } });
  if (!offer) throw new Error('offer_not_found');

  let active = await prisma.strike.count({ where: { userId: customerUserId, reason: 'NO_SHOW', isActive: true } });
  const target = 3;

  console.log(`ACTIVE_STRIKES_NOW=${active} TARGET=${target}`);

  while (active < target) {
    const before = active;
    const reservedUntil = new Date(Date.now() + 10*60*1000);
    let orderId = null;

    await prisma.$transaction(async (tx) => {
      const strikes = await tx.strike.count({ where: { userId: customerUserId, reason: 'NO_SHOW', isActive: true } });
      if (strikes >= 3) throw new Error(`blocked_strikes(${strikes})`);

      const upd = await tx.offer.updateMany({
        where: { id: offerId, status: 'LIVE', qtyAvailable: { gt: 0 } },
        data: { qtyAvailable: { decrement: 1 } },
      });
      if (upd.count !== 1) throw new Error('sold_out_or_not_live');

      for (let i = 0; i < 10; i++) {
        const code = claimCode6();
        try {
          const o = await tx.order.create({
            data: { offerId, customerUserId, status: 'RESERVED', reservedUntil, claimCode: code },
            select: { id: true },
          });
          orderId = o.id;
          break;
        } catch (e) {
          if (e?.code === 'P2002') continue;
          throw e;
        }
      }
      if (!orderId) throw new Error('claim_code_generation_failed');

      await tx.payment.upsert({
        where: { orderId },
        update: { status: 'SUCCEEDED', providerRef: 'mock_' + Date.now() },
        create: {
          orderId,
          status: 'SUCCEEDED',
          provider: 'MOCK',
          providerRef: 'mock_' + Date.now(),
          amountCents: offer.priceCents,
          currency: 'ALL',
        },
      });

      await tx.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
    });

    console.log(`CREATED_PAID_ORDER=${orderId} waiting_expirer...`);
    active = await waitNoShow(orderId, before);
    console.log(`OK NO_SHOW + strike => ACTIVE_STRIKES=${active}`);
  }

  console.log(`DONE ACTIVE_STRIKES=${active}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERR:", e?.message || e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
}

blocked_expect_present() {
  local port="$1" vendor_id="$2" min="$3" phone="$4"
  local out base
  base="$(api_url "$port")"
  out="$(curl -sS "$base/vendor/customers/blocked?vendorId=$vendor_id&minStrikes=$min&take=50")"
  PHONE="$phone" MIN="$min" node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');const items=j.items||[];const phone=process.env.PHONE;const min=Number(process.env.MIN||'0');const hit=items.find(x=>x?.customer?.phoneE164===phone);console.log('items_len=',items.length);console.log('found_phone=',!!hit);if(hit) console.log('strikes=',hit.strikes);if(!hit) process.exit(2);if((hit.strikes||0)<min) process.exit(3);});" <<<"$out"
}

blocked_expect_empty() {
  local port="$1" vendor_id="$2" min="$3"
  local out base
  base="$(api_url "$port")"
  out="$(curl -sS "$base/vendor/customers/blocked?vendorId=$vendor_id&minStrikes=$min&take=50")"
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');const items=j.items||[];console.log('items_len=',items.length);if(items.length!==0) process.exit(2);});" <<<"$out"
}

cooldown_bypass() {
  info "Cooldown active -> CI test-bypass"
  STATE_FILE="$STATE_FILE" node - <<'NODE'
const fs = require('fs');
try { require('dotenv').config({ path: '.env' }); } catch {}

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE,'utf8'));
const userId = state.customerUserId;

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
  log: ['warn','error'],
});

(async () => {
  await prisma.$connect();

  const last = await prisma.penaltyPayment.findFirst({
    where: { userId, status: 'CONFIRMED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!last) { console.log('OK: no CONFIRMED penaltyPayment found'); await prisma.$disconnect(); return; }

  const back = new Date(Date.now() - 11*24*60*60*1000);
  await prisma.penaltyPayment.update({ where: { id: last.id }, data: { createdAt: back } });
  await prisma.user.update({ where: { id: userId }, data: { lastSelfUnblockAt: null } });

  console.log(`OK: bypassed cooldown (paymentId=${last.id})`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("ERR:", e?.message || e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
}

self_unblock_flow() {
  local port="$1"
  local state vendor_id customer_id admin_id base
  state="$(cat "$STATE_FILE")"
  vendor_id="$(json_get "$state" "j.vendorId")"
  customer_id="$(json_get "$state" "j.customerUserId")"
  admin_id="$(json_get "$state" "j.adminUserId")"
  base="$(api_url "$port")"

  local customer_token admin_token init payment_id
  customer_token="$(jwt_for_user "$customer_id")"
  admin_token="$(jwt_for_user "$admin_id")"

  info "Self-unblock init/proof/confirm"
  init="$(curl -sS -X POST "$base/me/self-unblock/bank-transfer/init" \
    -H "authorization: Bearer $customer_token" -H "content-type: application/json" -d '{}')"

  if echo "$init" | grep -q '"code":"COOLDOWN_ACTIVE"'; then
    echo "$init"
    if [[ $NO_COOLDOWN_BYPASS -eq 1 ]]; then
      die "COOLDOWN_ACTIVE (bypass disabled via --no-cooldown-bypass)"
    fi
    cooldown_bypass
    init="$(curl -sS -X POST "$base/me/self-unblock/bank-transfer/init" \
      -H "authorization: Bearer $customer_token" -H "content-type: application/json" -d '{}')"
  fi

  payment_id="$(printf '%s' "$init" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');process.stdout.write(j.paymentId||'');});")"
  [[ -n "$payment_id" ]] || die "self-unblock init failed: $init"

  local proof pstatus conf cstatus ts
  proof="$(curl -sS -X POST "$base/me/self-unblock/bank-transfer/$payment_id/proof" \
    -H "authorization: Bearer $customer_token" -H "content-type: application/json" -d '{}')"
  pstatus="$(printf '%s' "$proof" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');process.stdout.write(j.status||'');});")"
  [[ "$pstatus" == "PENDING_VERIFICATION" ]] || die "proof status unexpected: $proof"

  ts="$(date +%s)"
  conf="$(curl -sS -X POST "$base/admin/self-unblock/$payment_id/confirm" \
    -H "authorization: Bearer $admin_token" -H "content-type: application/json" -d "{\"bankTxnRef\":\"CI_$ts\"}")"
  cstatus="$(printf '%s' "$conf" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}');process.stdout.write(j.status||'');});")"
  [[ "$cstatus" == "CONFIRMED" ]] || die "confirm status unexpected: $conf"

  info "Self-unblock CONFIRMED (paymentId=$payment_id)"
}

db_verify_strikes() {
  info "DB verify strikes (active=2; total>=3)"
  STATE_FILE="$STATE_FILE" node - <<'NODE'
const fs = require('fs');
try { require('dotenv').config({ path: '.env' }); } catch {}

const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE,'utf8'));
const userId = state.customerUserId;

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
  log: ['warn','error'],
});

(async () => {
  await prisma.$connect();
  const active = await prisma.strike.count({ where: { userId, reason: 'NO_SHOW', isActive: true } });
  const total = await prisma.strike.count({ where: { userId, reason: 'NO_SHOW' } });
  console.log(`DB_STRIKES active=${active} total=${total}`);
  await prisma.$disconnect();
  if (active !== 2) process.exit(2);
  if (total < 3) process.exit(3);
})().catch(async (e) => {
  console.error("ERR:", e?.message || e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
NODE
}

main() {
  info "Detecting API port..."
  local port
  if [[ -n "$API_PORT" ]]; then
    port="$API_PORT"
  else
    port="$(detect_port)" || die "API port not found (tried: ${PORTS[*]}). Is Nest running?"
  fi
  info "API = $(api_url "$port")"

  ensure_state "$port"

  local state vendor_id
  state="$(cat "$STATE_FILE")"
  vendor_id="$(json_get "$state" "j.vendorId")"
  [[ -n "$vendor_id" ]] || die "vendorId missing in state file"

  ensure_strikes_to_3

  info "Blocked check minStrikes=3 (expect phone present)"
  blocked_expect_present "$port" "$vendor_id" 3 "$PHONE"

  self_unblock_flow "$port"

  info "Blocked check minStrikes=3 (expect empty)"
  blocked_expect_empty "$port" "$vendor_id" 3

  info "Blocked check minStrikes=2 (expect phone present with strikes>=2)"
  blocked_expect_present "$port" "$vendor_id" 2 "$PHONE"

  db_verify_strikes

  echo "PASS: CI E2E NO_SHOW -> blocked -> self-unblock -> unblocked"
}

main "$@"
