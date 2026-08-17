// The demo gate.
//
// One shared passphrase, handed out with the URL. Deliberately not an account
// system, and the README says so in as many words: authentication here is a
// gate, not the product. Badger has no per-user anything — one Composio
// connected account, a user id in an env var — so a real login would hand us
// an identity the product cannot yet use, while implying a per-user separation
// that does not exist.
//
// Rejected, and why:
//
//   Google SSO      an unverified OAuth app shows Google's full-page "this app
//                   isn't verified" warning. That is the first thing an
//                   evaluator would see, and it demonstrates nothing the task
//                   asked for.
//   Magic links     needs their email, and makes them wait on delivery.
//   Self-signup     a user store, password hashing and a reset flow — real
//                   auth code, which is where vulnerabilities live, to gate a
//                   demo where every account would see identical data.
//   Nothing at all  the URL will leak eventually, and every answer spends
//                   Vertex credits and Composio quota.
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
 * The uid is an opaque random per-browser identifier, minted at sign-in. It is
 * what makes per-user connections possible without accounts: it becomes the
 * Composio end-user id, so each visitor's connected sources are their own. No
 * email, no signup, nothing the visitor has to provide — and because it is
 * inside the signed cookie, it cannot be forged or swapped for someone else's.
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
    // Secure is set behind the tunnel, where everything is HTTPS. Setting it
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
 * Read the session, or null.
 *
 * Returns the uid so callers can scope work to this browser. Verifying before
 * returning it is the whole point: an unsigned uid would let anyone address
 * another visitor's connected accounts by editing a cookie.
 */
export function readSession(req) {
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

/** Does this request carry a valid, unexpired session? */
export function hasValidSession(req) {
  if (!authEnabled) return true;
  return readSession(req) !== null;
}

/**
 * The Composio end-user id for this request.
 *
 * With the gate off (local development) there is no cookie, so everything
 * shares one id — which is correct for one developer on one laptop and wrong
 * for anything else, hence the gate being required before the server will bind
 * to a public interface.
 */
export function userIdFor(req) {
  return readSession(req)?.uid ?? "badger-local-dev";
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
