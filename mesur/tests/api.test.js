// End-to-end API tests against a real server with an in-memory database.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';

let app;
let base;

/** Tiny cookie-jar HTTP client. */
function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p, h) => call('GET', p, null, h), post: (p, b, h) => call('POST', p, b ?? {}, h), put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b), del: (p, b) => call('DELETE', p, b ?? {}),
    login: (email, password) => call('POST', '/api/auth/login', { email, password }),
  };
}

before(async () => {
  app = createApp({ DATABASE_PATH: ':memory:', APP_MODE: 'demo', DISABLE_RATE_LIMIT: true, PORT: 0 });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

const chartBody = (name = 'Test tees') => ({
  name, category: 'tshirts', fitType: 'regular', unit: 'cm', chartType: 'body',
  entries: [
    { label: 'S', ranges: { chest: { min: 88, max: 92 }, waist: { min: 74, max: 78 } } },
    { label: 'M', ranges: { chest: { min: 93, max: 98 }, waist: { min: 79, max: 84 } } },
    { label: 'L', ranges: { chest: { min: 99, max: 104 }, waist: { min: 85, max: 90 } } },
  ],
});

describe('authentication', () => {
  test('signup → session → logout → login', async () => {
    const c = client();
    const up = await c.post('/api/auth/signup', { name: 'Test User', email: 'Test@Example.com', password: 'longenough1' });
    assert.equal(up.status, 201);
    assert.equal(up.json.user.role, 'customer');
    assert.equal(up.json.user.email, 'test@example.com');
    assert.match(up.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await c.get('/api/auth/me')).json.user.email, 'test@example.com');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).json.user, null);
    assert.equal((await c.login('test@example.com', 'wrong-password')).status, 401);
    assert.equal((await c.login('test@example.com', 'longenough1')).status, 200);
  });

  test('validation: duplicate email, weak password, bad email', async () => {
    const c = client();
    assert.equal((await c.post('/api/auth/signup', { name: 'Dup', email: 'customer@mesur.demo', password: 'longenough1' })).status, 400);
    const weak = await c.post('/api/auth/signup', { name: 'Weak', email: 'weak@example.com', password: 'short' });
    assert.equal(weak.status, 400);
    assert.ok(weak.json.fields.password);
    assert.equal((await c.post('/api/auth/signup', { name: 'Bad', email: 'nope', password: 'longenough1' })).status, 400);
  });

  test('role cannot be escalated at signup', async () => {
    const r = await client().post('/api/auth/signup', { name: 'Evil', email: 'evil@example.com', password: 'longenough1', role: 'admin' });
    assert.equal(r.status, 400);
  });

  test('password reset flow invalidates the token after use', async () => {
    const c = client();
    await c.post('/api/auth/signup', { name: 'Reset Me', email: 'reset@example.com', password: 'original-pass' });
    const forgot = await client().post('/api/auth/forgot', { email: 'reset@example.com' });
    const token = new URL(forgot.json.demoResetUrl).searchParams.get('token');
    assert.equal((await client().post('/api/auth/reset', { token, password: 'brand-new-pass' })).status, 200);
    assert.equal((await client().post('/api/auth/reset', { token, password: 'another-pass-1' })).status, 400);
    assert.equal((await client().login('reset@example.com', 'original-pass')).status, 401);
    assert.equal((await client().login('reset@example.com', 'brand-new-pass')).status, 200);
    // Old session was revoked.
    assert.equal((await c.get('/api/auth/me')).json.user, null);
    // Unknown emails get the same response and no link.
    const unknown = await client().post('/api/auth/forgot', { email: 'nobody@example.com' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.json.demoResetUrl, undefined);
  });

  test('cross-site writes are rejected', async () => {
    const r = await client().post('/api/auth/login', { email: 'customer@mesur.demo', password: 'demo-customer-1' }, { Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
  });
});

describe('role-based access', () => {
  test('unauthenticated API calls get 401', async () => {
    const c = client();
    for (const p of ['/api/me/measurements', '/api/merchant/overview', '/api/admin/overview']) assert.equal((await c.get(p)).status, 401, p);
  });
  test('customers cannot reach merchant or admin APIs', async () => {
    const c = client();
    await c.login('customer@mesur.demo', 'demo-customer-1');
    for (const p of ['/api/merchant/overview', '/api/merchant/products', '/api/admin/overview', '/api/admin/users', '/api/admin/config']) {
      assert.equal((await c.get(p)).status, 403, p);
    }
  });
  test('merchants cannot reach admin or customer-profile APIs', async () => {
    const c = client();
    await c.login('merchant@mesur.demo', 'demo-merchant-1');
    assert.equal((await c.get('/api/admin/users')).status, 403);
    assert.equal((await c.get('/api/me/measurements')).status, 403);
    assert.equal((await c.get('/api/merchant/overview')).status, 200);
  });
  test('page routes redirect by role', async () => {
    const anon = client();
    const r1 = await anon.get('/app/profile');
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get('location'), '/login?next=%2Fapp%2Fprofile');
    const c = client();
    await c.login('customer@mesur.demo', 'demo-customer-1');
    assert.equal((await c.get('/app')).status, 200);
    assert.equal((await c.get('/admin')).headers.get('location'), '/app');
    assert.equal((await c.get('/merchant/products')).headers.get('location'), '/app');
  });
  test('merchant analytics never contain customer identifiers', async () => {
    const c = client();
    await c.login('merchant@mesur.demo', 'demo-merchant-1');
    const text = (await c.get('/api/merchant/analytics')).text + (await c.get('/api/merchant/overview')).text;
    assert.ok(!text.includes('customer@mesur.demo'));
    assert.ok(!/user_id|userId|chest_cm/.test(text));
  });
});

describe('measurement profile', () => {
  test('save, persist across sessions, edit, delete', async () => {
    const c = client();
    await c.post('/api/auth/signup', { name: 'Measure Me', email: 'measure@example.com', password: 'longenough1' });
    assert.equal((await c.get('/api/me/measurements')).json.measurements, null);

    const bad = await c.put('/api/me/measurements', { measurements: { height: 20, chest: 96 } });
    assert.equal(bad.status, 400);
    assert.ok(bad.json.fields.height);
    const missing = await c.put('/api/me/measurements', { measurements: { height: 170 } });
    assert.match(missing.json.fields.chest, /required/);

    const ok = await c.put('/api/me/measurements', { measurements: { height: 170, chest: 96 }, preferredUnit: 'in', fitPreference: 'relaxed' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.measurements.chest, 96);
    assert.equal(ok.json.completion, 36);
    assert.equal(ok.json.readiness.find((r) => r.group === 'bottoms').ready, false);

    const again = client();
    const login = await again.login('measure@example.com', 'longenough1');
    assert.equal(login.json.user.preferredUnit, 'in');
    assert.equal(login.json.user.fitPreference, 'relaxed');
    assert.equal((await again.get('/api/me/measurements')).json.measurements.height, 170);

    const edit = await again.put('/api/me/measurements', { measurements: { height: 171, chest: 97, waist: 83, shoulder: 44 } });
    assert.equal(edit.json.measurements.waist, 83);
    assert.equal((await again.del('/api/me/measurements')).json.measurements, null);
  });
});

describe('recommendations', () => {
  test('brand recommendations come from each brand chart and differ between brands', async () => {
    const c = client();
    await c.login('customer@mesur.demo', 'demo-customer-1');
    const r = await c.get('/api/me/recommendations/brands?category=tshirts&fit=regular');
    const bySlug = Object.fromEntries(r.json.results.map((x) => [x.brand.slug, x.result?.size]));
    assert.equal(bySlug.zara, 'M');
    assert.equal(bySlug['h-m'], 'L');
    assert.equal(bySlug.adidas, 'S');
    assert.ok(r.json.results.every((x) => !x.result || x.result.confidence || x.result.message));
  });

  test('product recommendation is stored in history; garment chart product works', async () => {
    const c = client();
    await c.login('customer@mesur.demo', 'demo-customer-1');
    const brand = (await c.get('/api/public/brands/northline-supply')).json;
    const tee = brand.products.find((p) => p.externalId === 'essential-cotton-tee');
    const boxy = brand.products.find((p) => p.externalId === 'boxy-heavyweight-tee');
    const before = (await c.get('/api/me/recommendations/history')).json.history.length;
    const rec = await c.post('/api/me/recommendations', { productId: tee.id });
    assert.equal(rec.json.result.size, 'M');
    assert.equal(rec.json.result.chart.source, 'brand');
    assert.equal((await c.get('/api/me/recommendations/history')).json.history.length, before + 1);
    const regular = await c.post('/api/me/recommendations', { productId: boxy.id, fitPreference: 'regular' });
    const oversized = await c.post('/api/me/recommendations', { productId: boxy.id, fitPreference: 'oversized' });
    assert.equal(regular.json.result.chart.source, 'product');
    assert.equal(regular.json.result.fit.chartType, 'garment');
    assert.equal(regular.json.result.size, 'S');
    assert.equal(oversized.json.result.size, 'M');
  });

  test('missing measurements are requested, not guessed', async () => {
    const c = client();
    await c.post('/api/auth/signup', { name: 'Minimal', email: 'minimal@example.com', password: 'longenough1' });
    const brand = (await c.get('/api/public/brands/northline-supply')).json;
    const jean = brand.products.find((p) => p.category === 'jeans');
    assert.equal((await c.post('/api/me/recommendations', { productId: jean.id })).status, 400); // no profile yet
    await c.put('/api/me/measurements', { measurements: { height: 170, chest: 96 } });
    const r = await c.post('/api/me/recommendations', { productId: jean.id });
    assert.equal(r.json.result.status, 'insufficient_data');
    assert.deepEqual(r.json.result.missing, ['waist']);
  });

  test('out-of-range profile gets the out-of-range message', async () => {
    const c = client();
    await c.post('/api/auth/signup', { name: 'Tall', email: 'tall@example.com', password: 'longenough1' });
    await c.put('/api/me/measurements', { measurements: { height: 205, chest: 150, waist: 140, shoulder: 60 } });
    const r = await c.get('/api/me/recommendations/brands?category=tshirts');
    assert.ok(r.json.results.every((x) => x.result.status === 'out_of_range'));
    assert.equal(r.json.results[0].result.message, 'Your measurements fall outside the available size range.');
  });
});

describe('merchant: products, charts, isolation', () => {
  let a;
  let b;
  before(async () => {
    a = client(); b = client();
    const sa = await a.post('/api/auth/signup', { role: 'merchant', name: 'Owner A', email: 'a@brand-a.com', password: 'longenough1', companyName: 'Brand A', website: 'brand-a.com' });
    assert.equal(sa.status, 201);
    assert.equal(sa.json.merchant.status, 'approved');
    await b.post('/api/auth/signup', { role: 'merchant', name: 'Owner B', email: 'b@brand-b.com', password: 'longenough1', companyName: 'Brand B' });
  });

  test('chart create / edit / validation / CSV export / delete', async () => {
    const created = await a.post('/api/merchant/charts', chartBody());
    assert.equal(created.status, 201);
    const id = created.json.chart.id;
    assert.equal(created.json.chart.entries.length, 3);
    assert.equal((await a.post('/api/merchant/charts', chartBody())).status, 400); // duplicate name

    const body = chartBody();
    body.entries.push({ label: 'XL', ranges: { chest: { min: 105, max: 110 }, waist: { min: 91, max: 96 } } });
    const updated = await a.put(`/api/merchant/charts/${id}`, body);
    assert.deepEqual(updated.json.chart.entries.map((e) => e.label), ['S', 'M', 'L', 'XL']);

    const invalid = chartBody('Broken');
    invalid.entries[1].ranges.chest = { min: 98, max: 93 };
    const bad = await a.post('/api/merchant/charts', invalid);
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /Size 2 \(M\).*greater than its maximum/);

    const csv = await a.get(`/api/merchant/charts/${id}/export.csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /^size,chest_min,chest_max,waist_min,waist_max\nS,88,92,74,78\n/);

    assert.equal((await b.get(`/api/merchant/charts/${id}`)).status, 404);
    assert.equal((await b.put(`/api/merchant/charts/${id}`, chartBody('Hijack'))).status, 404);
    assert.equal((await b.del(`/api/merchant/charts/${id}`)).status, 404);
  });

  test('product create / edit / deactivate / delete with tenant isolation', async () => {
    const chart = (await a.get('/api/merchant/charts')).json.charts[0];
    const created = await a.post('/api/merchant/products', { name: 'Core Tee', externalId: 'core-tee', category: 'tshirts', fitType: 'regular', sizeChartId: chart.id, availableSizes: ['S', 'M', 'L', 'ZZ'] });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.product.availableSizes, ['S', 'M', 'L']); // unknown size dropped
    const id = created.json.product.id;
    assert.equal((await a.post('/api/merchant/products', { name: 'Dup', externalId: 'core-tee', category: 'tshirts' })).status, 400);
    assert.equal((await a.post('/api/merchant/products', { name: 'Bad id', externalId: 'has spaces', category: 'tshirts' })).status, 400);

    const foreignChart = (await b.post('/api/merchant/charts', chartBody('B chart'))).json.chart;
    assert.equal((await a.patch(`/api/merchant/products/${id}`, { sizeChartId: foreignChart.id })).status, 400);

    assert.equal((await a.patch(`/api/merchant/products/${id}`, { name: 'Core Tee v2', isActive: false })).json.product.isActive, false);
    assert.equal((await b.patch(`/api/merchant/products/${id}`, { name: 'Hijacked' })).status, 404);
    assert.equal((await b.del(`/api/merchant/products/${id}`)).status, 404);
    assert.equal((await b.get('/api/merchant/products')).json.products.length, 0);
    assert.equal((await a.patch(`/api/merchant/products/${id}`, { isActive: true })).json.product.name, 'Core Tee v2');
  });

  test('API keys: secret shown once, v1 endpoint authenticates with it', async () => {
    const before = (await a.get('/api/merchant/integration')).json;
    assert.match(before.publicKey, /^pk_/);
    assert.equal(before.hasSecretKey, false);
    const gen = (await a.post('/api/merchant/integration/secret-key')).json;
    assert.match(gen.secretKey, /^sk_/);
    const after = (await a.get('/api/merchant/integration')).json;
    assert.equal(after.secretKey, undefined);
    assert.equal(after.secretLast4, gen.secretKey.slice(-4));

    const call = (key, body) => fetch(`${base}/api/v1/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    const ok = await call(gen.secretKey, { product_id: 'core-tee', measurements: { chest: 37.8, waist: 32.3 }, unit: 'in' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.size, 'M');
    assert.equal((await call('sk_wrong', { product_id: 'core-tee', measurements: { chest: 96 } })).status, 401);
    assert.equal((await call(gen.secretKey, { product_id: 'core-tee', measurements: { chest: 900 } })).status, 400);

    const regenerated = (await a.post('/api/merchant/integration/secret-key')).json;
    assert.equal((await call(gen.secretKey, { product_id: 'core-tee', measurements: { chest: 96 } })).status, 401); // old key revoked
    assert.equal((await call(regenerated.secretKey, { product_id: 'core-tee', measurements: { chest: 96 } })).status, 200);
  });

  test('widget configuration validation', async () => {
    const r = await a.patch('/api/merchant/integration', { config: { buttonText: 'What is my size?', theme: 'light', radius: 6 }, allowedOrigins: ['https://shop.brand-a.com/path'] });
    assert.equal(r.json.config.buttonText, 'What is my size?');
    assert.deepEqual(r.json.allowedOrigins, ['https://shop.brand-a.com']);
    assert.equal((await a.patch('/api/merchant/integration', { config: { accent: 'red' } })).status, 400);
    assert.equal((await a.patch('/api/merchant/integration', { allowedOrigins: ['not a url'] })).status, 400);
  });
});

describe('widget', () => {
  const q = 'merchant=pk_demo_northline&product=essential-cotton-tee';
  test('config is public, CORS-enabled and counts an impression', async () => {
    const count = () => app.db.get("SELECT COUNT(*) AS n FROM recommendation_events WHERE type = 'impression' AND is_sample = 0").n;
    const before = count();
    const r = await client().get(`/api/widget/config?${q}`, { Origin: 'https://some-shop.example' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.json.config.buttonText, 'Find My Size');
    assert.equal(r.json.product.name, 'Essential Cotton Tee');
    assert.equal(count(), before + 1);
  });
  test('unknown keys and products fail clearly', async () => {
    assert.equal((await client().get('/api/widget/config?merchant=pk_nope&product=x')).json.code, 'unknown_merchant');
    assert.equal((await client().get('/api/widget/config?merchant=pk_demo_northline&product=nope')).json.code, 'unknown_product');
  });
  test('recommend: anonymous → auth_required, customer → result, merchant → not_customer', async () => {
    assert.equal((await client().get(`/api/widget/recommend?${q}`)).json.state, 'auth_required');
    const c = client();
    await c.login('customer@mesur.demo', 'demo-customer-1');
    const r = (await c.get(`/api/widget/recommend?${q}`)).json;
    assert.equal(r.state, 'ready');
    assert.equal(r.result.size, 'M');
    assert.ok(r.result.matchScore > 85);
    const m = client();
    await m.login('merchant@mesur.demo', 'demo-merchant-1');
    assert.equal((await m.get(`/api/widget/recommend?${q}`)).json.state, 'not_customer');
    const fresh = client();
    await fresh.post('/api/auth/signup', { name: 'No Profile', email: 'noprofile@example.com', password: 'longenough1' });
    assert.equal((await fresh.get(`/api/widget/recommend?${q}`)).json.state, 'no_profile');
  });
  test('events endpoint and allowed-origin enforcement', async () => {
    const ok = await client().post('/api/widget/event', { merchant: 'pk_demo_northline', product: 'essential-cotton-tee', type: 'size_selected', size: 'M' }, { Origin: 'https://some-shop.example' });
    assert.equal(ok.status, 200);
    assert.equal((await client().post('/api/widget/event', { merchant: 'pk_demo_northline', product: 'essential-cotton-tee', type: 'recommendation' })).status, 400);
    const m = client();
    await m.login('merchant@mesur.demo', 'demo-merchant-1');
    await m.patch('/api/merchant/integration', { allowedOrigins: ['https://northline.example'] });
    assert.equal((await client().get(`/api/widget/config?${q}`, { Origin: 'https://other.example' })).json.code, 'origin_not_allowed');
    assert.equal((await client().get(`/api/widget/config?${q}`, { Origin: 'https://northline.example' })).status, 200);
    await m.patch('/api/merchant/integration', { allowedOrigins: [] });
  });
  test('widget script and frame are served; frame may be embedded, app may not', async () => {
    const js = await client().get('/widget.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('access-control-allow-origin'), '*');
    assert.equal((await client().get(`/widget/frame?${q}`)).headers.get('content-security-policy'), 'frame-ancestors *');
    assert.equal((await client().get('/')).headers.get('content-security-policy'), "frame-ancestors 'none'");
  });
});

describe('admin', () => {
  let admin;
  before(async () => { admin = client(); await admin.login('admin@mesur.demo', 'demo-admin-1'); });

  test('overview and user list expose no measurements', async () => {
    const o = (await admin.get('/api/admin/overview')).json;
    assert.ok(o.totals.customers >= 4 && o.totals.merchants >= 1 && o.totals.brands >= 6);
    const users = await admin.get('/api/admin/users?role=customer');
    assert.ok(users.json.users.every((u) => u.role === 'customer'));
    assert.ok(!/chest|waist|password/.test(users.text));
  });

  test('suspending a merchant disables their dashboard and widget; approving restores', async () => {
    const list = (await admin.get('/api/admin/merchants')).json.merchants;
    const northline = list.find((m) => m.companyName === 'Northline Supply');
    await admin.patch(`/api/admin/merchants/${northline.id}`, { status: 'suspended' });
    const m = client();
    await m.login('merchant@mesur.demo', 'demo-merchant-1');
    assert.equal((await m.get('/api/merchant/overview')).json.code, 'merchant_suspended');
    assert.equal((await client().get('/api/widget/config?merchant=pk_demo_northline&product=essential-cotton-tee')).json.code, 'merchant_inactive');
    assert.equal((await client().get('/api/public/brands/northline-supply')).status, 404);
    await admin.patch(`/api/admin/merchants/${northline.id}`, { status: 'approved' });
    assert.equal((await m.get('/api/merchant/overview')).status, 200);
  });

  test('brand and chart management', async () => {
    const created = await admin.post('/api/admin/brands', { name: 'Atelier Demo', country: 'France', website: 'atelier.example.com', categories: ['shirts'] });
    assert.equal(created.status, 201);
    const id = created.json.brand.id;
    assert.equal(created.json.brand.slug, 'atelier-demo');
    const chart = await admin.post(`/api/admin/brands/${id}/charts`, { ...chartBody('Shirts'), category: 'shirts' });
    assert.equal(chart.status, 201);
    assert.equal((await admin.get(`/api/admin/brands/${id}/charts`)).json.charts.length, 1);
    assert.equal((await admin.patch(`/api/admin/brands/${id}`, { isActive: false })).json.brand.isActive, false);
    assert.equal((await client().get('/api/public/brands/atelier-demo')).status, 404);
    assert.equal((await admin.del(`/api/admin/brands/${id}`)).status, 200);
    assert.equal((await admin.get(`/api/admin/brands/${id}`)).status, 404);
  });

  test('suspending a user ends their sessions', async () => {
    const c = client();
    const up = await c.post('/api/auth/signup', { name: 'To Suspend', email: 'suspend@example.com', password: 'longenough1' });
    await admin.patch(`/api/admin/users/${up.json.user.id}`, { status: 'suspended' });
    assert.equal((await c.get('/api/me/measurements')).status, 401);
    assert.equal((await client().login('suspend@example.com', 'longenough1')).status, 403);
    const self = (await admin.get('/api/auth/me')).json.user.id;
    assert.equal((await admin.patch(`/api/admin/users/${self}`, { status: 'suspended' })).status, 400);
  });

  test('platform configuration drives the engine and merchant approval', async () => {
    assert.equal((await admin.put('/api/admin/config', { min_match_score: 5 })).status, 400);
    const cfg = await admin.put('/api/admin/config', { require_merchant_approval: true, min_match_score: 0.9 });
    assert.equal(cfg.json.config.min_match_score, 0.9);
    const m = client();
    const up = await m.post('/api/auth/signup', { role: 'merchant', name: 'Pending', email: 'pending@brand-p.com', password: 'longenough1', companyName: 'Pending Brand' });
    assert.equal(up.json.merchant.status, 'pending');
    assert.equal((await client().get('/api/public/brands/pending-brand')).status, 404);
    // With a 0.9 threshold a chest-only edge match is no longer recommended.
    const c = client();
    await c.post('/api/auth/signup', { name: 'Strict', email: 'strict@example.com', password: 'longenough1' });
    await c.put('/api/me/measurements', { measurements: { height: 170, chest: 99.5, waist: 82, shoulder: 43 } });
    const strict = (await c.get('/api/me/recommendations/brands')).json.results.find((x) => x.brand.slug === 'zara');
    assert.equal(strict.result.status, 'out_of_range');
    await admin.put('/api/admin/config', { require_merchant_approval: false, min_match_score: 0.6 });
    const relaxed = (await c.get('/api/me/recommendations/brands')).json.results.find((x) => x.brand.slug === 'zara');
    assert.equal(relaxed.result.status, 'ok');
  });
});
