// Public integration surface: the embeddable widget and the server-to-server API.
//
//   GET  /api/widget/config      public (CORS) – widget bootstrap, counts an impression
//   POST /api/widget/event       public (CORS) – anonymous open / size_selected events
//   GET  /api/widget/recommend   first-party – called from the widget iframe with the
//                                shopper's session cookie; returns their recommendation
//   POST /api/v1/recommendations secret key – for merchants' own backends
//
// The storefront only ever holds the *public* key. Shopper measurements never
// leave this origin: the widget shows the result inside an iframe served here.

import { HttpError, badRequest, notFound, oneOf } from '../http.js';
import { sha256 } from '../auth.js';
import { parseJson } from '../db.js';
import { FITS, MEASUREMENT_KEYS } from '../../shared/measurements.js';
import { toCm } from '../../shared/units.js';
import {
  brandOut, measurementsFor, recommendForProduct, recordRecommendation, logEvent, chartForProduct,
  validateMeasurements, DEFAULT_WIDGET_CONFIG,
} from '../services.js';

export function widgetRoutes(router, { db, limit }) {
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

  /** Resolve integration → merchant → brand → product from public identifiers. */
  function resolve(publicKey, externalId, { origin } = {}) {
    const integration = db.get('SELECT * FROM widget_integrations WHERE public_key = ?', String(publicKey ?? ''));
    if (!integration) throw new HttpError(404, 'Unknown merchant key.', { code: 'unknown_merchant' });
    const merchant = db.get('SELECT * FROM merchants WHERE id = ?', integration.merchant_id);
    if (merchant.status !== 'approved') throw new HttpError(403, 'This merchant integration is not active.', { code: 'merchant_inactive' });
    const allowed = parseJson(integration.allowed_origins, []);
    if (origin !== undefined && allowed.length && !allowed.includes(origin)) {
      throw new HttpError(403, 'This website is not on the merchant\'s list of allowed origins.', { code: 'origin_not_allowed' });
    }
    const brand = db.get('SELECT * FROM brands WHERE merchant_id = ?', merchant.id);
    const product = db.get('SELECT * FROM products WHERE brand_id = ? AND external_id = ? AND is_active = 1', brand.id, String(externalId ?? ''));
    if (!product) throw new HttpError(404, 'Unknown or inactive product identifier.', { code: 'unknown_product' });
    return { integration, merchant, brand, product };
  }
  const originOf = (req) => {
    if (req.headers.origin) return req.headers.origin;
    try { return req.headers.referer ? new URL(req.headers.referer).origin : null; } catch { return null; }
  };

  router.get('/api/widget/config', (ctx) => {
    limit(`wcfg:${ctx.ip}`, 240);
    for (const [k, v] of Object.entries(CORS)) ctx.setHeader(k, v);
    const { integration, brand, product } = resolve(ctx.query.get('merchant'), ctx.query.get('product'), { origin: originOf(ctx.req) });
    const { chart } = chartForProduct(db, product);
    logEvent(db, { brandId: brand.id, productId: product.id, type: 'impression', source: 'widget' });
    return {
      brand: { name: brand.name },
      product: { name: product.name, externalId: product.external_id, hasChart: Boolean(chart) },
      config: { ...DEFAULT_WIDGET_CONFIG, ...parseJson(integration.config, {}) },
    };
  });

  router.post('/api/widget/event', (ctx) => {
    limit(`wevt:${ctx.ip}`, 120);
    for (const [k, v] of Object.entries(CORS)) ctx.setHeader(k, v);
    const type = oneOf(ctx.body.type, ['open', 'size_selected'], { field: 'type' });
    const { brand, product } = resolve(ctx.body.merchant, ctx.body.product, { origin: originOf(ctx.req) });
    const size = type === 'size_selected' ? String(ctx.body.size ?? '').slice(0, 20) || null : null;
    logEvent(db, { brandId: brand.id, productId: product.id, type, size, source: 'widget' });
    return { ok: true };
  });

  // Called from /widget/frame (same origin as this API), so the session cookie applies.
  router.get('/api/widget/recommend', (ctx) => {
    limit(`wrec:${ctx.ip}`, 60);
    const { brand, product, integration } = resolve(ctx.query.get('merchant'), ctx.query.get('product'));
    const base = {
      brand: { name: brand.name }, product: { name: product.name },
      config: { ...DEFAULT_WIDGET_CONFIG, ...parseJson(integration.config, {}) },
    };
    if (!ctx.user) return { ...base, state: 'auth_required' };
    if (ctx.user.role !== 'customer') return { ...base, state: 'not_customer', role: ctx.user.role };
    const profile = measurementsFor(db, ctx.user.id);
    if (!profile) return { ...base, state: 'no_profile', user: { name: ctx.user.full_name } };
    const fit = oneOf(ctx.query.get('fit') || ctx.user.fit_preference, FITS, { field: 'fit' });
    const result = recommendForProduct(db, { profile, product, fitPreference: fit });
    recordRecommendation(db, { userId: ctx.user.id, brand, product, result, fitPreference: fit, source: 'widget' });
    return { ...base, state: 'ready', user: { name: ctx.user.full_name, preferredUnit: ctx.user.preferred_unit }, fitPreference: fit, result };
  });

  // ---- server-to-server API ----------------------------------------------
  // Authorization: Bearer sk_...   Body: { product_id, measurements, unit?, fit_preference? }

  router.post('/api/v1/recommendations', (ctx) => {
    limit(`v1:${ctx.ip}`, 120);
    const header = ctx.req.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!key.startsWith('sk_')) throw new HttpError(401, 'Provide your secret API key as "Authorization: Bearer sk_…".', { code: 'missing_api_key' });
    const integration = db.get('SELECT * FROM widget_integrations WHERE secret_key_hash = ?', sha256(key));
    if (!integration) throw new HttpError(401, 'Invalid API key.', { code: 'invalid_api_key' });
    const merchant = db.get('SELECT * FROM merchants WHERE id = ?', integration.merchant_id);
    if (merchant.status !== 'approved') throw new HttpError(403, 'This merchant account is not active.', { code: 'merchant_inactive' });
    const brand = db.get('SELECT * FROM brands WHERE merchant_id = ?', merchant.id);
    const product = db.get('SELECT * FROM products WHERE brand_id = ? AND external_id = ?', brand.id, String(ctx.body.product_id ?? ''));
    if (!product) throw notFound('Product');

    const unit = oneOf(ctx.body.unit, ['cm', 'in'], { field: 'unit', fallback: 'cm' });
    const input = ctx.body.measurements;
    if (!input || typeof input !== 'object') throw badRequest('"measurements" must be an object such as { "chest": 96, "waist": 82 }.');
    // The API accepts partial profiles: only validate what was sent.
    const profile = {};
    for (const k of MEASUREMENT_KEYS) profile[k] = input[k] === undefined || input[k] === null ? null : toCm(input[k], unit);
    const sent = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null));
    try { validateMeasurements({ height: 170, chest: 96, ...sent }); } catch (err) { throw badRequest(err.message, err.extra?.fields); }

    const fit = oneOf(ctx.body.fit_preference, FITS, { field: 'fit_preference', fallback: 'regular' });
    const result = recommendForProduct(db, { profile, product, fitPreference: fit });
    logEvent(db, { brandId: brand.id, productId: product.id, type: 'recommendation', status: result.status, size: result.size ?? null, source: 'api' });
    return { product_id: product.external_id, brand: brandOut(brand).name, fit_preference: fit, result };
  });
}
