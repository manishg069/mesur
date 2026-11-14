// Minimal HTTP toolkit: router, JSON bodies, cookies, errors, rate limiting.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const badRequest = (message, fields) => new HttpError(400, message, fields ? { fields } : {});
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found.`);
export const forbidden = (message = 'You do not have access to this resource.') => new HttpError(403, message);

export function createRouter() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    routes.push({ method, regex, keys, handlers });
  };
  return {
    get: (p, ...h) => add('GET', p, ...h),
    post: (p, ...h) => add('POST', p, ...h),
    put: (p, ...h) => add('PUT', p, ...h),
    patch: (p, ...h) => add('PATCH', p, ...h),
    delete: (p, ...h) => add('DELETE', p, ...h),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = pathname.match(r.regex);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handlers: r.handlers, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

export async function readJson(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw badRequest('Request body must be a JSON object.');
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** Fixed-window in-memory rate limiter. Good enough for a single-node MVP. */
export function createRateLimiter() {
  const hits = new Map();
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, 60_000).unref();
  return (key, max, windowMs = 60_000) => {
    const t = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < t) { h = { count: 0, reset: t + windowMs }; hits.set(key, h); }
    h.count += 1;
    if (h.count > max) throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
  };
}

// ---- validation helpers ---------------------------------------------------

export function str(value, { field, min = 0, max = 200, required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw badRequest(`${field} is required.`, { [field]: 'Required.' });
    return null;
  }
  const s = String(value).trim();
  if (s.length < min) throw badRequest(`${field} must be at least ${min} characters.`, { [field]: `At least ${min} characters.` });
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters.`, { [field]: `At most ${max} characters.` });
  return s;
}
export function oneOf(value, allowed, { field, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, { [field]: 'Invalid value.' });
  return value;
}
export function email(value) {
  const s = str(value, { field: 'email', max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw badRequest('Enter a valid email address.', { email: 'Invalid email address.' });
  return s;
}
export function url(value, { field = 'website', required = false } = {}) {
  const s = str(value, { field, max: 300, required });
  if (s === null) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error('bad');
    return u.toString().replace(/\/$/, '');
  } catch {
    throw badRequest('Enter a valid website address.', { [field]: 'Invalid URL.' });
  }
}
/** Accept small inline images only (logo / product image uploads). */
export function image(value, { field = 'image' } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (/^https:\/\/[^\s]+$/.test(s) && s.length < 500) return s;
  if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s)) throw badRequest('Images must be PNG, JPEG, WebP or SVG.', { [field]: 'Unsupported image.' });
  if (s.length > 700_000) throw badRequest('Image is too large. Keep it under 500 KB.', { [field]: 'Too large.' });
  return s;
}
