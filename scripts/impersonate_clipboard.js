// Usage: node scripts/impersonate_clipboard.js +31646095546
// Requires server running + NODE_ENV=development + /admin/dev/impersonate enabled
const fs = require("fs");
const { spawnSync } = require("child_process");
const jwt = require("jsonwebtoken");

const phoneE164 = process.argv[2];
if (!phoneE164 || !/^\+\d{8,15}$/.test(phoneE164)) {
  console.error("USAGE: node scripts/impersonate_clipboard.js +316...");
  process.exit(2);
}

function readEnv(key) {
  const s = fs.readFileSync(".env", "utf8");
  const m = s.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

const secret = process.env.JWT_SECRET || readEnv("JWT_SECRET");
if (!secret) {
  console.error("JWT_SECRET_MISSING");
  process.exit(3);
}

const r = spawnSync("sqlite3", ["dev.db", 'select id from "User" where role="ADMIN" order by updatedAt desc limit 1;'], {
  encoding: "utf8",
});
const adminId = (r.stdout || "").trim();
if (!adminId) {
  console.error("NO_ADMIN_IN_DB");
  process.exit(4);
}

const adminToken = jwt.sign({ sub: adminId }, secret, { expiresIn: "10m" });

// Call local endpoint (no token printed)
const curl = spawnSync(
  "curl",
  [
    "-sS",
    "-X",
    "POST",
    "http://127.0.0.1:3000/admin/dev/impersonate",
    "-H",
    "content-type: application/json",
    "-H",
    `Authorization: Bearer ${adminToken}`,
    "-d",
    JSON.stringify({ phoneE164 }),
  ],
  { encoding: "utf8" }
);

let resp = curl.stdout || "";
let j;
try {
  j = JSON.parse(resp);
} catch {
  console.error("BAD_JSON_RESPONSE");
  process.exit(5);
}

if (!j.accessToken) {
  console.error("NO_ACCESS_TOKEN");
  console.error(resp.slice(0, 300));
  process.exit(6);
}

const pb = spawnSync("pbcopy", [], { input: j.accessToken, encoding: "utf8" });
if (pb.status !== 0) {
  console.error("PBCOPY_FAILED");
  process.exit(7);
}

console.log("JWT_OK_IN_CLIPBOARD");
console.log("USER=", JSON.stringify(j.user || null));
