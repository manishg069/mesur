import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, parseJson } from './db.js';
import { loadEnv, ROOT } from './env.js';
import { createRouter, readJson, sendJson, HttpError, createRateLimiter } from './http.js';
import { userFromRequest, homeForRole } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customer.js';
import { merchantRoutes } from './routes/merchant.js';
import { adminRoutes } from './routes/admin.js';
import { widgetRoutes } from './routes/widget.js';
import { seedDemo, isSeeded, ensureAdmin, DEMO_ACCOUNTS } from './seed.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = resolve(ROOT, 'public');
const SHARED = resolve(ROOT, 'shared');

// Server-side page guards. The API enforces access independently; these
// redirects simply stop the wrong shell from ever being shown.
const PAGE_ROLES = [['/app', 'customer'], ['/merchant', 'merchant'], ['/admin', 'admin']];

export function createApp(overrides = {}) {
  const env = loadEnv(overrides);
  const db = openDatabase(env.DATABASE_PATH);
  if (env.APP_MODE === 'demo') { if (!isSeeded(db)) seedDemo(db); }
  else ensureAdmin(db, env);

  const limit = env.DISABLE_RATE_LIMIT ? () => {} : createRateLimiter();
  const router = createRouter();
  const deps = { db, env, limit, demoAccounts: DEMO_ACCOUNTS.map(({ role, email, password }) => ({ role, email, password })) };
  authRoutes(router, deps);
  customerRoutes(router, deps);
  merchantRoutes(router, deps);
  adminRoutes(router, deps);
  widgetRoutes(router, deps);

  const appOrigin = new URL(env.APP_URL).origin;

  async function serveFile(res, base, relative, headers = {}) {
    const file = resolve(base, `.${sep}${relative}`);
    if (!file.startsWith(base + sep)) return false;
    try {
      if (!(await stat(file)).isFile()) return false;
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(body);
      return true;
    } catch { return false; }
  }

  async function handleApi(req, res, url) {
    const path = url.pathname;
    const isPublicCors = path.startsWith('/api/widget/config') || path.startsWith('/api/widget/event');
    if (req.method === 'OPTIONS' && isPublicCors) {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const match = router.match(req.method, path);
    if (!match) throw new HttpError(404, 'Unknown API endpoint.');
    if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed.');

    // CSRF defence for cookie-authenticated writes: the browser must be on our origin.
    const mutating = !['GET', 'HEAD'].includes(req.method);
    if (mutating && !isPublicCors && !path.startsWith('/api/v1/')) {
      const origin = req.headers.origin;
      if (origin && origin !== appOrigin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
      if (!(req.headers['content-type'] ?? '').includes('application/json') && Number(req.headers['content-length'] ?? 0) > 0) throw new HttpError(415, 'Send JSON with Content-Type: application/json.');
    }

    const headers = {};
    let rawSent = false;
    const ctx = {
      req, res, url, query: url.searchParams, params: match.params,
      body: mutating ? await readJson(req) : {},
      user: userFromRequest(db, req),
      ip: req.socket.remoteAddress ?? 'unknown',
      status: 200,
      setHeader: (k, v) => { headers[k] = v; },
      raw: (status, body, h) => { rawSent = true; res.writeHead(status, { ...headers, ...h }); res.end(body); },
    };
    try {
      let result;
      for (const handler of match.handlers) result = await handler(ctx);
      if (!rawSent) sendJson(res, ctx.status, result ?? { ok: true }, headers);
    } catch (err) {
      err.headers = headers; // keep CORS headers on error responses
      throw err;
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://internal');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) return await handleApi(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');

      // The widget script may be loaded from any storefront.
      if (path === '/widget.js') {
        if (await serveFile(res, PUBLIC, 'widget.js', { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' })) return;
      }
      // The widget frame is the only page that may be embedded by other sites.
      if (path === '/widget/frame') {
        const integration = db.get('SELECT allowed_origins FROM widget_integrations WHERE public_key = ?', url.searchParams.get('merchant') ?? '');
        const allowed = parseJson(integration?.allowed_origins, []);
        const ancestors = allowed.length ? `'self' ${allowed.join(' ')}` : '*';
        if (await serveFile(res, PUBLIC, 'widget-frame.html', { 'Content-Security-Policy': `frame-ancestors ${ancestors}` })) return;
      }
      if (path.startsWith('/shared/') && (await serveFile(res, SHARED, path.slice(8)))) return;
      if (extname(path) && (await serveFile(res, PUBLIC, path.slice(1)))) return;
      if (extname(path)) throw new HttpError(404, 'Not found.');

      for (const [prefix, role] of PAGE_ROLES) {
        if (path === prefix || path.startsWith(`${prefix}/`)) {
          const user = userFromRequest(db, req);
          const to = !user ? `/login?next=${encodeURIComponent(path)}` : user.role !== role ? homeForRole(user.role) : null;
          if (to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); return res.end(); }
        }
      }
      await serveFile(res, PUBLIC, 'index.html', { 'Content-Security-Policy': "frame-ancestors 'none'", 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        if (path.startsWith('/api/')) return sendJson(res, err.status, { error: err.message, ...err.extra }, err.headers ?? {});
        res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(err.message);
      }
      console.error(`[error] ${req.method} ${path}`, err);
      sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' }, err.headers ?? {});
    }
  });

  return { server, db, env, close: () => new Promise((done) => { server.close(() => { db.close(); done(); }); server.closeAllConnections?.(); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, env } = createApp();
  server.listen(env.PORT, () => {
    console.log(`Mesur running at ${env.APP_URL}  (${env.APP_MODE} mode)`);
    if (env.APP_MODE === 'demo') {
      console.log('Demonstration mode: fictional sample data is loaded. Demo logins:');
      for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(9)} ${a.email}  /  ${a.password}`);
      console.log(`Demo storefront: run "npm run storefront" → ${env.STOREFRONT_URL}`);
    }
  });
}
