import { badRequest, notFound, oneOf, str } from '../http.js';
import { requireRole } from '../auth.js';
import { brandOut, productOut, getConfig, setConfig, uniqueSlug } from '../services.js';
import { analytics, chartHandlers, brandPatch } from './merchant.js';
import { DEFAULT_CONFIG } from '../../shared/engine.js';

export function adminRoutes(router, { db }) {
  const admin = requireRole('admin');
  const n = (sql, ...p) => db.get(sql, ...p).n;

  router.get('/api/admin/overview', admin, () => ({
    totals: {
      customers: n("SELECT COUNT(*) AS n FROM profiles WHERE role = 'customer'"),
      customersWithProfile: n('SELECT COUNT(*) AS n FROM customer_measurements'),
      merchants: n('SELECT COUNT(*) AS n FROM merchants'),
      pendingMerchants: n("SELECT COUNT(*) AS n FROM merchants WHERE status = 'pending'"),
      brands: n('SELECT COUNT(*) AS n FROM brands'),
      products: n('SELECT COUNT(*) AS n FROM products'),
      charts: n('SELECT COUNT(*) AS n FROM size_charts'),
      recommendationRequests: n("SELECT COUNT(*) AS n FROM recommendation_events WHERE type = 'recommendation'"),
      sampleEvents: n('SELECT COUNT(*) AS n FROM recommendation_events WHERE is_sample = 1'),
      sampleUsers: n('SELECT COUNT(*) AS n FROM profiles WHERE is_sample = 1'),
    },
    recentEvents: recentEvents(25),
  }));

  // Customers: account data only. Body measurements are never listed here.
  router.get('/api/admin/users', admin, (ctx) => {
    const role = ctx.query.get('role');
    const rows = db.all(
      `SELECT p.id, p.email, p.full_name, p.role, p.status, p.is_sample, p.created_at,
              (SELECT COUNT(*) FROM customer_measurements m WHERE m.user_id = p.id) AS has_profile,
              (SELECT COUNT(*) FROM recommendations r WHERE r.user_id = p.id) AS recommendations
         FROM profiles p ${['customer', 'merchant', 'admin'].includes(role) ? 'WHERE p.role = ?' : ''} ORDER BY p.created_at DESC LIMIT 500`,
      ...(['customer', 'merchant', 'admin'].includes(role) ? [role] : []),
    );
    return {
      users: rows.map((u) => ({
        id: u.id, email: u.email, name: u.full_name, role: u.role, status: u.status, isSample: Boolean(u.is_sample),
        hasProfile: Boolean(u.has_profile), recommendations: u.recommendations, createdAt: u.created_at,
      })),
    };
  });

  router.patch('/api/admin/users/:id', admin, (ctx) => {
    const user = db.get('SELECT id, role FROM profiles WHERE id = ?', ctx.params.id);
    if (!user) throw notFound('User');
    if (user.id === ctx.user.id) throw badRequest('You cannot change the status of your own account.');
    const status = oneOf(ctx.body.status, ['active', 'suspended'], { field: 'status' });
    db.update('profiles', user.id, { status });
    if (status === 'suspended') db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    return { ok: true };
  });

  // ---- merchants ----------------------------------------------------------

  router.get('/api/admin/merchants', admin, () => ({
    merchants: db.all(
      `SELECT m.*, p.email AS owner_email, p.full_name AS owner_name, b.id AS brand_id, b.name AS brand_name, b.slug AS brand_slug,
              (SELECT COUNT(*) FROM products x WHERE x.brand_id = b.id) AS products,
              (SELECT COUNT(*) FROM size_charts x WHERE x.brand_id = b.id) AS charts
         FROM merchants m JOIN profiles p ON p.id = m.owner_id LEFT JOIN brands b ON b.merchant_id = m.id ORDER BY m.created_at DESC`,
    ).map((m) => ({
      id: m.id, companyName: m.company_name, contactEmail: m.contact_email, website: m.website, status: m.status,
      ownerName: m.owner_name, ownerEmail: m.owner_email, brandId: m.brand_id, brandName: m.brand_name, brandSlug: m.brand_slug,
      products: m.products, charts: m.charts, createdAt: m.created_at,
    })),
  }));

  router.patch('/api/admin/merchants/:id', admin, (ctx) => {
    const m = db.get('SELECT id FROM merchants WHERE id = ?', ctx.params.id);
    if (!m) throw notFound('Merchant');
    db.update('merchants', m.id, { status: oneOf(ctx.body.status, ['pending', 'approved', 'suspended'], { field: 'status' }) });
    return { ok: true };
  });

  // ---- brands -------------------------------------------------------------

  const brand = (ctx) => {
    const b = db.get('SELECT * FROM brands WHERE id = ?', ctx.params.brandId);
    if (!b) throw notFound('Brand');
    return b;
  };

  router.get('/api/admin/brands', admin, () => ({
    brands: db.all('SELECT * FROM brands ORDER BY created_at').map((b) => ({
      ...brandOut(b),
      products: n('SELECT COUNT(*) AS n FROM products WHERE brand_id = ?', b.id),
      charts: n('SELECT COUNT(*) AS n FROM size_charts WHERE brand_id = ?', b.id),
      merchantName: b.merchant_id ? db.get('SELECT company_name FROM merchants WHERE id = ?', b.merchant_id)?.company_name : null,
    })),
  }));
  router.get('/api/admin/brands/:brandId', admin, (ctx) => ({ brand: brandOut(brand(ctx)) }));
  router.post('/api/admin/brands', admin, (ctx) => {
    const name = str(ctx.body.name, { field: 'name', min: 2, max: 80 });
    const patch = brandPatch(db, null, ctx.body);
    const row = db.insert('brands', {
      merchant_id: null, categories: '[]', integration_status: 'not_integrated', is_active: 1,
      is_demo: ctx.body.isDemo ? 1 : 0, ...patch, name, slug: uniqueSlug(db, name),
    });
    ctx.status = 201;
    return { brand: brandOut(row) };
  });
  router.patch('/api/admin/brands/:brandId', admin, (ctx) => {
    const b = brand(ctx);
    const patch = brandPatch(db, b, ctx.body);
    if ('isActive' in ctx.body) patch.is_active = ctx.body.isActive ? 1 : 0;
    if ('isDemo' in ctx.body) patch.is_demo = ctx.body.isDemo ? 1 : 0;
    if ('integrationStatus' in ctx.body) patch.integration_status = oneOf(ctx.body.integrationStatus, ['not_integrated', 'sandbox', 'live'], { field: 'integrationStatus' });
    if (Object.keys(patch).length) db.update('brands', b.id, patch);
    return { brand: brandOut(db.get('SELECT * FROM brands WHERE id = ?', b.id)) };
  });
  router.delete('/api/admin/brands/:brandId', admin, (ctx) => {
    const b = brand(ctx);
    if (b.merchant_id) throw badRequest('This brand belongs to a merchant. Suspend the merchant instead of deleting the brand.');
    db.run('DELETE FROM brands WHERE id = ?', b.id);
    return { ok: true };
  });

  const charts = chartHandlers(db, (ctx) => brand(ctx).id);
  router.get('/api/admin/brands/:brandId/charts', admin, charts.list);
  router.post('/api/admin/brands/:brandId/charts', admin, charts.create);
  router.get('/api/admin/brands/:brandId/charts/:chartId', admin, charts.get);
  router.put('/api/admin/brands/:brandId/charts/:chartId', admin, charts.update);
  router.delete('/api/admin/brands/:brandId/charts/:chartId', admin, charts.remove);
  router.get('/api/admin/brands/:brandId/charts/:chartId/export.csv', admin, charts.exportCsv);

  router.get('/api/admin/products', admin, () => ({
    products: db.all('SELECT p.*, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id ORDER BY b.name, p.name LIMIT 1000')
      .map((p) => ({ ...productOut(p), brandName: p.brand_name })),
  }));

  // ---- monitoring, analytics, configuration ------------------------------

  function recentEvents(limit) {
    return db.all(
      `SELECT e.id, e.type, e.status, e.size_label, e.source, e.is_sample, e.created_at, b.name AS brand, p.name AS product
         FROM recommendation_events e JOIN brands b ON b.id = e.brand_id LEFT JOIN products p ON p.id = e.product_id
        WHERE e.type = 'recommendation' ORDER BY e.created_at DESC LIMIT ?`, limit,
    ).map((e) => ({ id: e.id, status: e.status, size: e.size_label, source: e.source, isSample: Boolean(e.is_sample), createdAt: e.created_at, brand: e.brand, product: e.product }));
  }
  router.get('/api/admin/events', admin, () => ({ events: recentEvents(200) }));

  router.get('/api/admin/analytics', admin, (ctx) => {
    const days = [7, 30, 90].includes(Number(ctx.query.get('days'))) ? Number(ctx.query.get('days')) : 30;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    return {
      ...analytics(db, null, days),
      brands: db.all(
        `SELECT b.name, SUM(e.type = 'impression') AS impressions, SUM(e.type = 'recommendation') AS recommendations
           FROM recommendation_events e JOIN brands b ON b.id = e.brand_id WHERE e.created_at >= ? GROUP BY b.id ORDER BY recommendations DESC`, since),
      signups: db.all("SELECT role, COUNT(*) AS count FROM profiles WHERE created_at >= ? GROUP BY role", since),
    };
  });

  router.get('/api/admin/config', admin, () => ({ config: getConfig(db), engineDefaults: { weights: DEFAULT_CONFIG.weights, tolerances: DEFAULT_CONFIG.tolerances, ease: DEFAULT_CONFIG.ease } }));
  router.put('/api/admin/config', admin, (ctx) => ({ config: setConfig(db, ctx.body) }));
}
