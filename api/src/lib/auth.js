/* Passord (PBKDF2-SHA256) og signerte økt-tokens (HMAC-SHA256) for organisasjonsportalen. */
const crypto = require("crypto");
// AUTH_SECRET bør settes i Azure. Uten den avledes en nøkkel fra STORAGE_CONNECTION.
const SECRET = process.env.AUTH_SECRET || crypto.createHash("sha256").update("meldinn-auth:" + (process.env.STORAGE_CONNECTION || "dev")).digest("hex");
const ITER = 100000, TTL = 12 * 3600e3;

function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(pw, salt, ITER, 32, "sha256");
  return `pbkdf2$${ITER}$${salt.toString("base64")}$${h.toString("base64")}`;
}
function checkPw(pw, stored) {
  const p = String(stored || "").split("$"); if (p.length !== 4) return false;
  const h = crypto.pbkdf2Sync(String(pw || ""), Buffer.from(p[2], "base64"), +p[1], 32, "sha256"), want = Buffer.from(p[3], "base64");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function sign(user) {
  const body = Buffer.from(JSON.stringify({ u: user.username, t: user.tenant, v: user.ver, exp: Date.now() + TTL })).toString("base64url");
  return body + "." + crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}
function verify(token) {
  const [body, sig] = String(token || "").split("."); if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
module.exports = { hashPw, checkPw, sign, verify };
