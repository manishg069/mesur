import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError, forbidden, parseCookies } from './http.js';
import { now } from './db.js';

export const SESSION_COOKIE = 'mesur_session';
const SESSION_DAYS = 30;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}
export function assertPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.', { fields: { password: 'At least 8 characters.' } });
  }
  if (password.length > 200) throw new HttpError(400, 'Password is too long.', { fields: { password: 'Too long.' } });
}

export function createSession(db, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)', sha256(token), userId, expires, now());
  return token;
}
export function sessionCookie(token, env) {
  const crossSite = env.COOKIE_CROSS_SITE === '1';
  const attrs = [
    `${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly',
    `Max-Age=${token ? SESSION_DAYS * 86400 : 0}`,
    crossSite ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (crossSite || env.COOKIE_SECURE === '1') attrs.push('Secure');
  return attrs.join('; ');
}

/** Resolve the logged-in user from the session cookie, or null. */
export function userFromRequest(db, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.get(
    `SELECT p.id, p.email, p.full_name, p.role, p.status, p.preferred_unit, p.fit_preference, s.expires_at
       FROM sessions s JOIN profiles p ON p.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < now() || row.status !== 'active') return null;
  delete row.expires_at;
  return row;
}

/** Route guard: require a session with one of the given roles. */
export const requireRole = (...roles) => (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Please log in to continue.', { code: 'auth_required' });
  if (roles.length && !roles.includes(ctx.user.role)) throw forbidden();
};

export const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.full_name, role: u.role,
  preferredUnit: u.preferred_unit, fitPreference: u.fit_preference,
});

export const homeForRole = (role) => (role === 'admin' ? '/admin' : role === 'merchant' ? '/merchant' : '/app');
