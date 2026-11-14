import { badRequest, notFound, oneOf } from '../http.js';
import { requireRole } from '../auth.js';
import { parseJson } from '../db.js';
import { recommendSize } from '../../shared/engine.js';
import { FITS, CATEGORY_IDS, MEASUREMENT_KEYS, profileCompletion, categoryReadiness } from '../../shared/measurements.js';
import {
  brandOut, productOut, chartOut, measurementsFor, validateMeasurements, brandChart, loadEntries,
  recommendForProduct, recordRecommendation, engineConfig,
} from '../services.js';

/** Brands visible to shoppers: active, and merchant-owned ones must be approved. */
const VISIBLE_BRANDS = `
  SELECT b.* FROM brands b LEFT JOIN merchants m ON m.id = b.merchant_id
   WHERE b.is_active = 1 AND (b.merchant_id IS NULL OR m.status = 'approved')`;

export function customerRoutes(router, { db }) {
  const customer = requireRole('customer');

  // ---- public catalogue ---------------------------------------------------

  router.get('/api/public/brands', () => ({
    brands: db.all(`${VISIBLE_BRANDS} ORDER BY b.is_demo DESC, b.name`).map((b) => ({
      ...brandOut(b),
      productCount: db.get('SELECT COUNT(*) AS n FROM products WHERE brand_id = ? AND is_active = 1', b.id).n,
      chartCount: db.get('SELECT COUNT(*) AS n FROM size_charts WHERE brand_id = ? AND is_active = 1', b.id).n,
    })),
  }));

  router.get('/api/public/brands/:slug', (ctx) => {
    const b = db.get(`${VISIBLE_BRANDS} AND b.slug = ?`, ctx.params.slug);
    if (!b) throw notFound('Brand');
    return {
      brand: brandOut(b),
      charts: db.all('SELECT * FROM size_charts WHERE brand_id = ? AND is_active = 1 ORDER BY category, name', b.id).map((c) => chartOut(c, loadEntries(db, c.id))),
      products: db.all('SELECT * FROM products WHERE brand_id = ? AND is_active = 1 ORDER BY name', b.id).map(productOut),
    };
  });

  // Fictional charts used by the interactive demos on the public site. The
  // browser runs the same engine module against them.
  router.get('/api/public/demo', () => {
    const brands = db.all(`${VISIBLE_BRANDS} AND b.is_demo = 1 ORDER BY b.created_at`);
    const charts = brands.map((b) => {
      const chart = brandChart(db, b.id, 'tshirts');
      return chart ? { brand: b.name, slug: b.slug, chart: { category: chart.category, fit_type: chart.fit_type, unit: chart.unit, chart_type: chart.chart_type, entries: chart.entries } } : null;
    }).filter(Boolean);
    return { charts, minMatchScore: engineConfig(db).minMatchScore };
  });

  // ---- measurement profile ------------------------------------------------

  const profilePayload = (userId) => {
    const m = measurementsFor(db, userId);
    return { measurements: m, completion: profileCompletion(m ?? {}), readiness: categoryReadiness(m ?? {}) };
  };

  router.get('/api/me/measurements', customer, (ctx) => profilePayload(ctx.user.id));

  router.put('/api/me/measurements', customer, (ctx) => {
    const clean = validateMeasurements(ctx.body.measurements);
    const patch = {};
    if ('preferredUnit' in ctx.body) patch.preferred_unit = oneOf(ctx.body.preferredUnit, ['cm', 'in'], { field: 'preferredUnit' });
    if ('fitPreference' in ctx.body) patch.fit_preference = oneOf(ctx.body.fitPreference, FITS, { field: 'fitPreference' });
    const row = Object.fromEntries(MEASUREMENT_KEYS.map((k) => [`${k}_cm`, clean[k]]));
    db.tx(() => {
      const existing = db.get('SELECT id FROM customer_measurements WHERE user_id = ?', ctx.user.id);
      if (existing) db.update('customer_measurements', existing.id, row);
      else db.insert('customer_measurements', { user_id: ctx.user.id, ...row });
      if (Object.keys(patch).length) db.update('profiles', ctx.user.id, patch);
    });
    return profilePayload(ctx.user.id);
  });

  router.delete('/api/me/measurements', customer, (ctx) => {
    db.run('DELETE FROM customer_measurements WHERE user_id = ?', ctx.user.id);
    return profilePayload(ctx.user.id);
  });

  // ---- recommendations ----------------------------------------------------

  const requireProfile = (userId) => {
    const m = measurementsFor(db, userId);
    if (!m) throw badRequest('Create your size profile first.', { code: 'no_profile' });
    return m;
  };

  // One recommendation per brand for a category, from each brand's own chart.
  router.get('/api/me/recommendations/brands', customer, (ctx) => {
    const category = oneOf(ctx.query.get('category') || 'tshirts', CATEGORY_IDS, { field: 'category' });
    const fit = oneOf(ctx.query.get('fit') || ctx.user.fit_preference, FITS, { field: 'fit' });
    const profile = measurementsFor(db, ctx.user.id);
    const brands = db.all(`${VISIBLE_BRANDS} ORDER BY b.is_demo DESC, b.name`);
    return {
      category, fitPreference: fit, hasProfile: Boolean(profile),
      results: brands.map((b) => {
        const chart = brandChart(db, b.id, category, 'regular');
        if (!chart) return { brand: brandOut(b), result: null };
        const result = profile ? recommendSize({ profile, chart, fitPreference: fit, config: engineConfig(db) }) : null;
        return { brand: brandOut(b), chart: { id: chart.id, name: chart.name }, result };
      }),
    };
  });

  // Product-specific recommendation; stored in the customer's history.
  router.post('/api/me/recommendations', customer, (ctx) => {
    const profile = requireProfile(ctx.user.id);
    const fit = oneOf(ctx.body.fitPreference || ctx.user.fit_preference, FITS, { field: 'fitPreference' });
    const product = db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', String(ctx.body.productId ?? ''));
    const brand = product && db.get(`${VISIBLE_BRANDS} AND b.id = ?`, product.brand_id);
    if (!product || !brand) throw notFound('Product');
    const result = recommendForProduct(db, { profile, product, fitPreference: fit });
    recordRecommendation(db, { userId: ctx.user.id, brand, product, result, fitPreference: fit, source: 'app' });
    return { result, product: productOut(product), brand: brandOut(brand) };
  });

  router.get('/api/me/recommendations/history', customer, (ctx) => ({
    history: db.all(
      `SELECT r.id, r.product_id, r.product_name, r.category, r.status, r.size_label, r.match_score, r.confidence,
              r.fit_preference, r.source, r.is_sample, r.created_at, b.name AS brand_name, b.slug AS brand_slug
         FROM recommendations r JOIN brands b ON b.id = r.brand_id
        WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 50`, ctx.user.id,
    ).map((r) => ({
      id: r.id, productId: r.product_id, productName: r.product_name, category: r.category, status: r.status, size: r.size_label,
      matchScore: r.match_score, confidence: r.confidence, fitPreference: r.fit_preference, source: r.source,
      isSample: Boolean(r.is_sample), createdAt: r.created_at, brandName: r.brand_name, brandSlug: r.brand_slug,
    })),
  }));

  router.delete('/api/me/recommendations/history', customer, (ctx) => {
    db.run('DELETE FROM recommendations WHERE user_id = ?', ctx.user.id);
    return { ok: true };
  });

  router.get('/api/me/stats', customer, (ctx) => ({
    total: db.get('SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ?', ctx.user.id).n,
    sampleCount: db.get('SELECT COUNT(*) AS n FROM recommendations WHERE user_id = ? AND is_sample = 1', ctx.user.id).n,
    topBrands: db.all(
      `SELECT b.name, COUNT(*) AS count FROM recommendations r JOIN brands b ON b.id = r.brand_id
        WHERE r.user_id = ? GROUP BY b.id ORDER BY count DESC, b.name LIMIT 5`, ctx.user.id,
    ),
  }));

  void parseJson;
}
