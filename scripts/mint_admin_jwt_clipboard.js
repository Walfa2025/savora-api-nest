// NOTE: prints NO token. Only copies to clipboard and prints status.
const fs = require("fs");
const { spawnSync } = require("child_process");
const jwt = require("jsonwebtoken");

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
  process.exit(2);
}

const r = spawnSync("sqlite3", ["dev.db", 'select id from "User" where role="ADMIN" order by updatedAt desc limit 1;'], {
  encoding: "utf8",
});
const adminId = (r.stdout || "").trim();
if (!adminId) {
  console.error("NO_ADMIN_IN_DB");
  process.exit(3);
}

const token = jwt.sign({ sub: adminId }, secret, { expiresIn: "1h" });

// Copy to clipboard (macOS)
const pb = spawnSync("pbcopy", [], { input: token, encoding: "utf8" });
if (pb.status !== 0) {
  console.error("PBCOPY_FAILED");
  process.exit(4);
}

console.log("JWT_OK_IN_CLIPBOARD");
