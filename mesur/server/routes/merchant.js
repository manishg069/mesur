import { HttpError, badRequest, notFound, forbidden, str, url, image, oneOf } from '../http.js';
import { requireRole, sha256 } from '../auth.js';
import { parseJson } from '../db.js';
import { CATEGORY_IDS } from '../../shared/measurements.js';
import { sizeChartToCsv } from '../../shared/csv.js';
import {
  brandOut, productOut, chartOut, loadEntries, listCharts, saveChart, validateProductPayload,
  uniqueSlug, newPublicKey, newSecretKey, validateWidgetConfig, DEFAULT_WIDGET_CONFIG,
} from '../services.js';

/** Aggregated, anonymous analytics for one brand (or the whole platform when brandId is null). */
export function analytics(db, brandId, days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const where = brandId ? 'e.brand_id = ? AND e.created_at >= ?' : 'e.created_at >= ?';
  const args = brandId ? [brandId, since] : [since];
  const count = (extra, ...more) => db.get(`SELECT COUNT(*) AS n FROM recommendation_events e WHERE ${where} ${extra}`, ...args, ...more).n;

  const impressions = count("AND e.type = 'impression'");
  const widgetRecs = count("AND e.type = 'recommendation' AND e.source = 'widget'");
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    byDay.set(d, { date: d, impressions: 0, recommendations: 0 });
  }
  for (const r of db.all(`SELECT substr(e.created_at, 1, 10) AS d, e.type, COUNT(*) AS n FROM recommendation_events e WHERE ${where} GROUP BY d, e.type`, ...args)) {
    const day = byDay.get(r.d);
    if (!day) continue;
    if (r.type === 'impression') day.impressions = r.n;
    if (r.type === 'recommendation') day.recommendations = r.n;
  }
  return {
    days,
    totals: {
      impressions,
      opens: count("AND e.type = 'open'"),
      recommendations: count("AND e.type = 'recommendation'"),
      sizeSelected: count("AND e.type = 'size_selected'"),
      outOfRange: count("AND e.type = 'recommendation' AND e.status = 'out_of_range'"),
      insufficient: count("AND e.type = 'recommendation' AND e.status = 'insufficient_data'"),
      // Share of widget impressions that led to a recommendation.
      conversionRate: impressions > 0 ? Math.round((widgetRecs / impressions) * 1000) / 10 : null,
    },
    sampleEvents: count('AND e.is_sample = 1'),
    series: [...byDay.values()],
    sizeDistribution: db.all(
      `SELECT e.size_label AS size, COUNT(*) AS count FROM recommendation_events e
        WHERE ${where} AND e.type = 'recommendation' AND e.size_label IS NOT NULL GROUP BY e.size_label ORDER BY count DESC`, ...args),
    bySource: db.all(`SELECT e.source, COUNT(*) AS count FROM recommendation_events e WHERE ${where} AND e.type = 'recommendation' GROUP BY e.source`, ...args),
    products: db.all(
      `SELECT p.id, p.name, b.name AS brand,
              SUM(e.type = 'impression') AS impressions,
              SUM(e.type = 'recommendation') AS recommendations,
              SUM(e.type = 'size_selected') AS sizeSelected
         FROM recommendation_events e JOIN products p ON p.id = e.product_id JOIN brands b ON b.id = p.brand_id
        WHERE ${where} GROUP BY p.id ORDER BY recommendations DESC, impressions DESC LIMIT 20`, ...args),
  };
}

/** Chart CRUD handlers bound to a brand resolver; reused by merchant and admin routes. */
export function chartHandlers(db, brandIdOf) {
  const owned = (ctx) => {
    const chart = db.get('SELECT * FROM size_charts WHERE id = ? AND brand_id = ?', ctx.params.chartId, brandIdOf(ctx));
    if (!chart) throw notFound('Size chart');
    return chart;
  };
  return {
    list: (ctx) => ({ charts: listCharts(db, brandIdOf(ctx)) }),
    create: (ctx) => { ctx.status = 201; return { chart: saveChart(db, brandIdOf(ctx), ctx.body) }; },
    get: (ctx) => { const c = owned(ctx); return { chart: chartOut(c, loadEntries(db, c.id)) }; },
    update: (ctx) => ({ chart: saveChart(db, brandIdOf(ctx), ctx.body, owned(ctx).id) }),
    remove: (ctx) => { db.run('DELETE FROM size_charts WHERE id = ?', owned(ctx).id); return { ok: true }; },
    exportCsv: (ctx) => {
      const c = owned(ctx);
      ctx.raw(200, sizeChartToCsv(loadEntries(db, c.id)), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${c.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.csv"`,
      });
    },
  };
}

export function brandPatch(db, brand, b) {
  const patch = {};
  if ('name' in b) { patch.name = str(b.name, { field: 'name', min: 2, max: 80 }); patch.slug = uniqueSlug(db, patch.name, brand?.id ?? null); }
  if ('description' in b) patch.description = str(b.description, { field: 'description', max: 600, required: false });
  if ('website' in b) patch.website = url(b.website);
  if ('country' in b) patch.country = str(b.country, { field: 'country', max: 60, required: false });
  if ('logoUrl' in b) patch.logo_url = image(b.logoUrl, { field: 'logoUrl' });
  if ('categories' in b) {
    if (!Array.isArray(b.categories) || b.categories.some((c) => !CATEGORY_IDS.includes(c))) throw badRequest('Invalid product categories.', { categories: 'Invalid.' });
    patch.categories = JSON.stringify([...new Set(b.categories)]);
  }
  return patch;
}

export function merchantRoutes(router, { db, env }) {
  // Resolve the merchant + brand for the session; suspended merchants are locked out.
  const merchant = (ctx) => {
    requireRole('merchant')(ctx);
    const m = db.get('SELECT * FROM merchants WHERE owner_id = ?', ctx.user.id);
    if (!m) throw forbidden('No merchant account is linked to this login.');
    if (m.status === 'suspended') throw new HttpError(403, 'This merchant account is suspended. Contact the platform team.', { code: 'merchant_suspended' });
    ctx.merchant = m;
    ctx.brand = db.get('SELECT * FROM brands WHERE merchant_id = ?', m.id);
  };
  const brandId = (ctx) => ctx.brand.id;

  router.get('/api/merchant/overview', merchant, (ctx) => {
    const a = analytics(db, ctx.brand.id, 30);
    return {
      merchant: { id: ctx.merchant.id, companyName: ctx.merchant.company_name, status: ctx.merchant.status, contactEmail: ctx.merchant.contact_email, website: ctx.merchant.website },
      brand: brandOut(ctx.brand),
      stats: {
        products: db.get('SELECT COUNT(*) AS n FROM products WHERE brand_id = ?', ctx.brand.id).n,
        activeProducts: db.get('SELECT COUNT(*) AS n FROM products WHERE brand_id = ? AND is_active = 1', ctx.brand.id).n,
        activeCharts: db.get('SELECT COUNT(*) AS n FROM size_charts WHERE brand_id = ? AND is_active = 1', ctx.brand.id).n,
        productsWithoutChart: db.get(
          `SELECT COUNT(*) AS n FROM products p WHERE p.brand_id = ? AND p.is_active = 1 AND p.size_chart_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM size_charts c WHERE c.brand_id = p.brand_id AND c.category = p.category AND c.scope = 'brand' AND c.is_active = 1)`, ctx.brand.id).n,
        ...a.totals,
      },
      sampleEvents: a.sampleEvents,
      series: a.series,
      // Return insights need merchant-supplied return data, which this MVP does not ingest.
      returnInsights: null,
    };
  });

  router.patch('/api/merchant/brand', merchant, (ctx) => {
    const patch = brandPatch(db, ctx.brand, ctx.body);
    if (Object.keys(patch).length) db.update('brands', ctx.brand.id, patch);
    if (patch.name) db.update('merchants', ctx.merchant.id, { company_name: patch.name });
    return { brand: brandOut(db.get('SELECT * FROM brands WHERE id = ?', ctx.brand.id)) };
  });

  // ---- products -----------------------------------------------------------

  const ownedProduct = (ctx) => {
    const p = db.get('SELECT * FROM products WHERE id = ? AND brand_id = ?', ctx.params.id, ctx.brand.id);
    if (!p) throw notFound('Product');
    return p;
  };
  const syncCategories = (ctx) => {
    const cats = db.all('SELECT DISTINCT category FROM products WHERE brand_id = ?', ctx.brand.id).map((r) => r.category);
    db.update('brands', ctx.brand.id, { categories: JSON.stringify(cats) });
  };

  router.get('/api/merchant/products', merchant, (ctx) => ({
    products: db.all('SELECT * FROM products WHERE brand_id = ? ORDER BY created_at DESC', ctx.brand.id).map(productOut),
    charts: listCharts(db, ctx.brand.id).map(({ id, name, category, fitType, scope, isActive, entries }) => ({ id, name, category, fitType, scope, isActive, sizes: entries.map((e) => e.label) })),
  }));
  router.post('/api/merchant/products', merchant, (ctx) => {
    const row = db.insert('products', { brand_id: ctx.brand.id, ...validateProductPayload(db, ctx.brand.id, ctx.body) });
    syncCategories(ctx);
    ctx.status = 201;
    return { product: productOut(row) };
  });
  router.patch('/api/merchant/products/:id', merchant, (ctx) => {
    const existing = ownedProduct(ctx);
    db.update('products', existing.id, validateProductPayload(db, ctx.brand.id, ctx.body, existing));
    syncCategories(ctx);
    return { product: productOut(db.get('SELECT * FROM products WHERE id = ?', existing.id)) };
  });
  router.delete('/api/merchant/products/:id', merchant, (ctx) => {
    db.run('DELETE FROM products WHERE id = ?', ownedProduct(ctx).id);
    syncCategories(ctx);
    return { ok: true };
  });

  // ---- size charts --------------------------------------------------------

  const charts = chartHandlers(db, brandId);
  router.get('/api/merchant/charts', merchant, charts.list);
  router.post('/api/merchant/charts', merchant, charts.create);
  router.get('/api/merchant/charts/:chartId', merchant, charts.get);
  router.put('/api/merchant/charts/:chartId', merchant, charts.update);
  router.delete('/api/merchant/charts/:chartId', merchant, charts.remove);
  router.get('/api/merchant/charts/:chartId/export.csv', merchant, charts.exportCsv);

  // ---- integration --------------------------------------------------------

  const integration = (ctx) => db.get('SELECT * FROM widget_integrations WHERE merchant_id = ?', ctx.merchant.id);
  const integrationOut = (ctx, extra = {}) => {
    const i = integration(ctx);
    return {
      publicKey: i.public_key,
      hasSecretKey: Boolean(i.secret_key_hash),
      secretLast4: i.secret_last4,
      allowedOrigins: parseJson(i.allowed_origins, []),
      config: { ...DEFAULT_WIDGET_CONFIG, ...parseJson(i.config, {}) },
      appUrl: env.APP_URL,
      storefrontUrl: env.STOREFRONT_URL || null,
      merchantStatus: ctx.merchant.status,
      integrationStatus: ctx.brand.integration_status,
      ...extra,
    };
  };

  router.get('/api/merchant/integration', merchant, (ctx) => integrationOut(ctx));

  router.patch('/api/merchant/integration', merchant, (ctx) => {
    const i = integration(ctx);
    const patch = {};
    if ('config' in ctx.body) patch.config = JSON.stringify(validateWidgetConfig(ctx.body.config ?? {}, parseJson(i.config, {})));
    if ('allowedOrigins' in ctx.body) {
      const list = ctx.body.allowedOrigins;
      if (!Array.isArray(list) || list.length > 20) throw badRequest('Allowed origins must be a list of up to 20 origins.');
      patch.allowed_origins = JSON.stringify([...new Set(list.map((o) => {
        try { const u = new URL(String(o).trim()); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); return u.origin; }
        catch { throw badRequest(`"${o}" is not a valid origin. Use the form https://shop.example.com`, { allowedOrigins: 'Invalid origin.' }); }
      }))]);
    }
    if ('integrationStatus' in ctx.body) {
      db.update('brands', ctx.brand.id, { integration_status: oneOf(ctx.body.integrationStatus, ['not_integrated', 'sandbox', 'live'], { field: 'integrationStatus' }) });
      ctx.brand = db.get('SELECT * FROM brands WHERE id = ?', ctx.brand.id);
    }
    if (Object.keys(patch).length) db.update('widget_integrations', i.id, patch);
    return integrationOut(ctx);
  });

  // The secret key is returned exactly once; only its hash is stored.
  router.post('/api/merchant/integration/secret-key', merchant, (ctx) => {
    const key = newSecretKey();
    db.update('widget_integrations', integration(ctx).id, { secret_key_hash: sha256(key), secret_last4: key.slice(-4) });
    return integrationOut(ctx, { secretKey: key });
  });
  router.post('/api/merchant/integration/public-key', merchant, (ctx) => {
    db.update('widget_integrations', integration(ctx).id, { public_key: newPublicKey() });
    return integrationOut(ctx);
  });

  // ---- analytics ----------------------------------------------------------

  router.get('/api/merchant/analytics', merchant, (ctx) => {
    const days = [7, 30, 90].includes(Number(ctx.query.get('days'))) ? Number(ctx.query.get('days')) : 30;
    return analytics(db, ctx.brand.id, days);
  });
}
