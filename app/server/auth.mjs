// The demo gate.
//
// One shared passphrase, handed out with the URL. A gate, not an account
// system: Badger has no per-user anything, so a real login would imply a
// separation that does not exist.
//
// Rejected: Google SSO (an unverified OAuth app shows Google's full-page
// warning as the first thing an evaluator sees), magic links (needs their
// email), self-signup (a user store and a reset flow — real auth code, where
// vulnerabilities live — to gate a demo where every account sees the same
// data), and nothing at all (the URL leaks, and every answer costs money).
//
// The session is a signed cookie, so there is no session store to secure.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "badger_session";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PASSPHRASE = process.env.BADGER_PASSPHRASE ?? "";

// Signing key. From the environment when set, so sessions survive a restart;
// otherwise random per boot, which simply means everyone signs in again after
// a deploy. Never falls back to a constant — a hardcoded default secret is the
// classic way a gate like this becomes decorative.
const SECRET = process.env.BADGER_SESSION_SECRET || randomBytes(32).toString("hex");

/** Is the gate switched on? Off only when no passphrase is configured. */
export const authEnabled = PASSPHRASE.length > 0;

/**
 * Compare in constant time, without leaking length through an early return.
 * Both sides are hashed first so the compared buffers are always 32 bytes.
 */
function sameSecret(a, b) {
  const ha = createHmac("sha256", SECRET).update(String(a)).digest();
  const hb = createHmac("sha256", SECRET).update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function passphraseMatches(candidate) {
  if (!authEnabled) return true;
  return sameSecret(candidate ?? "", PASSPHRASE);
}

/**
 * `<uid>.<expiry>.<hmac>` — stateless, tamper-evident, and it expires.
 *
 * The uid is an opaque random per-browser identifier minted at sign-in, and
 * is what stored history keys on. Never caller-supplied: the HMAC covers
 * `uid.expiry` undelimited, which is only safe while uid is fixed-width hex.
 */
function sign(uid, expiresAt) {
  const mac = createHmac("sha256", SECRET).update(`${uid}.${expiresAt}`).digest("hex");
  return `${uid}.${expiresAt}.${mac}`;
}

export function issueSessionCookie(uid = randomBytes(9).toString("hex")) {
  const expiresAt = Date.now() + TTL_MS;
  const value = sign(uid, expiresAt);
  return [
    `${COOKIE}=${value}`,
    "Path=/",
    "HttpOnly", // unreadable from JavaScript, so an XSS cannot exfiltrate it
    "SameSite=Lax", // not sent on cross-site POSTs
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
    // Cloud Run is HTTPS-only, so Secure is right in production. Setting it
    // unconditionally would break plain-http localhost development.
    process.env.BADGER_SECURE_COOKIE === "0" ? null : "Secure",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Read the session, or null. Verified before it is returned — an unsigned uid
 * would be attacker-chosen, which is the whole reason the cookie is signed.
 */
function readSession(req) {
  const raw = parseCookies(req.headers.cookie).get(COOKIE);
  if (!raw) return null;

  const [uid, expiresAt, mac] = raw.split(".");
  if (!uid || !expiresAt || !mac) return null;

  const expected = createHmac("sha256", SECRET).update(`${uid}.${expiresAt}`).digest("hex");
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return null; // malformed hex
  }
  if (!ok || Number(expiresAt) <= Date.now()) return null;
  return { uid };
}

/**
 * Whose browser this is — the opaque uid from the signed cookie, and what
 * every stored conversation is keyed on.
 *
 * With the gate off there is no cookie, so everything lands under one
 * well-known id — the localhost case. NOT an account: the uid is random per
 * sign-in with nothing behind it, so "your history" means "this browser's",
 * and the UI must not imply more.
 */
export function sessionUid(req) {
  return readSession(req)?.uid ?? "local";
}

/** Does this request carry a valid, unexpired session? */
export function hasValidSession(req) {
  if (!authEnabled) return true;
  return readSession(req) !== null;
}

function parseCookies(header) {
  const jar = new Map();
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}
