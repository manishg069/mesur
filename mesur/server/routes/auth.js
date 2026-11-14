import { HttpError, badRequest, str, email as emailField, url, oneOf } from '../http.js';
import {
  hashPassword, verifyPassword, assertPasswordPolicy, createSession, sessionCookie, publicUser,
  requireRole, randomToken, sha256, SESSION_COOKIE,
} from '../auth.js';
import { parseCookies } from '../http.js';
import { now } from '../db.js';
import { FITS } from '../../shared/measurements.js';
import { getConfig, createBrandForMerchant } from '../services.js';

export function authRoutes(router, { db, env, limit, demoAccounts }) {
  const merchantFor = (userId) => db.get('SELECT id, company_name, status FROM merchants WHERE owner_id = ?', userId);
  const me = (user) => ({
    user: publicUser(user),
    merchant: user?.role === 'merchant' ? (({ id, company_name, status }) => ({ id, companyName: company_name, status }))(merchantFor(user.id)) : null,
  });
  const fresh = (id) => db.get('SELECT * FROM profiles WHERE id = ?', id);

  router.get('/api/auth/me', (ctx) => {
    const config = getConfig(db);
    return {
      ...me(ctx.user),
      mode: env.APP_MODE,
      allowMerchantSignup: config.allow_merchant_signup,
      // Demo credentials are only ever sent in demonstration mode.
      demoAccounts: env.APP_MODE === 'demo' ? demoAccounts : [],
      storefrontUrl: env.STOREFRONT_URL || null,
    };
  });

  router.post('/api/auth/signup', (ctx) => {
    limit(`signup:${ctx.ip}`, 10);
    const b = ctx.body;
    const role = oneOf(b.role, ['customer', 'merchant'], { field: 'role', fallback: 'customer' });
    const name = str(b.name, { field: 'name', min: 2, max: 80 });
    const email = emailField(b.email);
    assertPasswordPolicy(b.password);
    const config = getConfig(db);
    let companyName = null;
    let website = null;
    if (role === 'merchant') {
      if (!config.allow_merchant_signup) throw new HttpError(403, 'Merchant registration is currently closed.');
      companyName = str(b.companyName, { field: 'companyName', min: 2, max: 80 });
      website = url(b.website, { field: 'website' });
    }
    if (db.get('SELECT id FROM profiles WHERE email = ?', email)) {
      throw badRequest('An account with this email already exists. Log in instead.', { email: 'Already registered.' });
    }
    const user = db.tx(() => {
      const u = db.insert('profiles', { email, password_hash: hashPassword(b.password), full_name: name, role });
      if (role === 'merchant') {
        const merchant = db.insert('merchants', {
          owner_id: u.id, company_name: companyName, contact_email: email, website,
          status: config.require_merchant_approval ? 'pending' : 'approved',
        });
        createBrandForMerchant(db, merchant, companyName, website);
      }
      return u;
    });
    ctx.setHeader('Set-Cookie', sessionCookie(createSession(db, user.id), env));
    ctx.status = 201;
    return me(fresh(user.id));
  });

  router.post('/api/auth/login', (ctx) => {
    limit(`login:${ctx.ip}`, 15);
    const email = emailField(ctx.body.email);
    const password = String(ctx.body.password ?? '');
    const user = db.get('SELECT * FROM profiles WHERE email = ?', email);
    // Same message for unknown email and wrong password.
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
    if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended. Contact support.');
    ctx.setHeader('Set-Cookie', sessionCookie(createSession(db, user.id), env));
    return me(user);
  });

  router.post('/api/auth/logout', (ctx) => {
    const token = parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    ctx.setHeader('Set-Cookie', sessionCookie('', env));
    return { ok: true };
  });

  router.post('/api/auth/forgot', (ctx) => {
    limit(`forgot:${ctx.ip}`, 5);
    const email = emailField(ctx.body.email);
    const user = db.get("SELECT id FROM profiles WHERE email = ? AND status = 'active'", email);
    const response = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
    if (!user) return response;
    const token = randomToken();
    db.run('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)',
      sha256(token), user.id, new Date(Date.now() + 3600e3).toISOString(), now());
    const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
    // No email provider is wired into this MVP. The link is logged on the
    // server, and in demonstration mode it is also returned to the browser.
    console.log(`[password-reset] ${email} → ${resetUrl}`);
    if (env.APP_MODE === 'demo') response.demoResetUrl = resetUrl;
    return response;
  });

  router.post('/api/auth/reset', (ctx) => {
    limit(`reset:${ctx.ip}`, 10);
    const token = str(ctx.body.token, { field: 'token', max: 200 });
    assertPasswordPolicy(ctx.body.password);
    const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(token));
    if (!row || row.used_at || row.expires_at < now()) throw badRequest('This reset link is invalid or has expired. Request a new one.');
    db.tx(() => {
      db.update('profiles', row.user_id, { password_hash: hashPassword(ctx.body.password) });
      db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
      db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    });
    return { ok: true };
  });

  // ---- account settings (any role) ---------------------------------------

  router.patch('/api/account', requireRole(), (ctx) => {
    const b = ctx.body;
    const patch = {};
    if ('name' in b) patch.full_name = str(b.name, { field: 'name', min: 2, max: 80 });
    if ('email' in b) {
      patch.email = emailField(b.email);
      if (db.get('SELECT id FROM profiles WHERE email = ? AND id <> ?', patch.email, ctx.user.id)) throw badRequest('That email is already in use.', { email: 'Already in use.' });
    }
    if ('preferredUnit' in b) patch.preferred_unit = oneOf(b.preferredUnit, ['cm', 'in'], { field: 'preferredUnit' });
    if ('fitPreference' in b) patch.fit_preference = oneOf(b.fitPreference, FITS, { field: 'fitPreference' });
    if (Object.keys(patch).length) db.update('profiles', ctx.user.id, patch);
    return me(fresh(ctx.user.id));
  });

  router.post('/api/account/password', requireRole(), (ctx) => {
    limit(`pw:${ctx.user.id}`, 10);
    const row = fresh(ctx.user.id);
    if (!verifyPassword(String(ctx.body.currentPassword ?? ''), row.password_hash)) throw badRequest('Current password is incorrect.', { currentPassword: 'Incorrect password.' });
    assertPasswordPolicy(ctx.body.newPassword);
    db.update('profiles', row.id, { password_hash: hashPassword(ctx.body.newPassword) });
    // Sign out every other session.
    const current = sha256(parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE] ?? '');
    db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', row.id, current);
    return { ok: true };
  });

  router.delete('/api/account', requireRole('customer', 'merchant'), (ctx) => {
    const row = fresh(ctx.user.id);
    if (!verifyPassword(String(ctx.body.password ?? ''), row.password_hash)) throw badRequest('Password is incorrect.', { password: 'Incorrect password.' });
    db.run('DELETE FROM profiles WHERE id = ?', row.id); // cascades to measurements, merchant, brand, products…
    ctx.setHeader('Set-Cookie', sessionCookie('', env));
    return { ok: true };
  });
}
