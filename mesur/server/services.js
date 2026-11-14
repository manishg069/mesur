// Domain services shared by the route modules.
import { recommendSize } from '../shared/engine.js';
import { MEASUREMENT_KEYS, MEASUREMENTS, CATEGORY_IDS, FITS, validateMeasurement } from '../shared/measurements.js';
import { cmToIn } from '../shared/units.js';
import { parseJson, uuid, now } from './db.js';
import { badRequest, notFound, str, oneOf, image } from './http.js';
import { randomToken } from './auth.js';

// ---- platform configuration ----------------------------------------------

export const CONFIG_DEFAULTS = {
  allow_merchant_signup: true,
  require_merchant_approval: false,
  min_match_score: 0.6,
};
export function getConfig(db) {
  const out = { ...CONFIG_DEFAULTS };
  for (const row of db.all('SELECT key, value FROM platform_config')) {
    if (row.key in out) out[row.key] = parseJson(row.value, out[row.key]);
  }
  return out;
}
export function setConfig(db, patch) {
  const clean = {};
  if ('allow_merchant_signup' in patch) clean.allow_merchant_signup = Boolean(patch.allow_merchant_signup);
  if ('require_merchant_approval' in patch) clean.require_merchant_approval = Boolean(patch.require_merchant_approval);
  if ('min_match_score' in patch) {
    const n = Number(patch.min_match_score);
    if (!Number.isFinite(n) || n < 0.3 || n > 0.95) throw badRequest('Minimum match score must be between 0.30 and 0.95.', { min_match_score: 'Between 0.30 and 0.95.' });
    clean.min_match_score = Math.round(n * 100) / 100;
  }
  for (const [key, value] of Object.entries(clean)) {
    db.run('INSERT INTO platform_config (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), now());
  }
  return getConfig(db);
}
export const engineConfig = (db) => ({ minMatchScore: getConfig(db).min_match_score });

// ---- serialisers ----------------------------------------------------------

export const brandOut = (b) => b && ({
  id: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url, description: b.description, website: b.website,
  country: b.country, categories: parseJson(b.categories, []), integrationStatus: b.integration_status,
  isActive: Boolean(b.is_active), isDemo: Boolean(b.is_demo), merchantId: b.merchant_id, createdAt: b.created_at,
});
export const productOut = (p) => p && ({
  id: p.id, brandId: p.brand_id, externalId: p.external_id, name: p.name, description: p.description,
  category: p.category, fitType: p.fit_type, sizeChartId: p.size_chart_id,
  availableSizes: parseJson(p.available_sizes, []), ease: parseJson(p.ease, null),
  imageUrl: p.image_url, isActive: Boolean(p.is_active), createdAt: p.created_at, updatedAt: p.updated_at,
});
export const chartOut = (c, entries) => c && ({
  id: c.id, brandId: c.brand_id, name: c.name, category: c.category, fitType: c.fit_type, unit: c.unit,
  chartType: c.chart_type, scope: c.scope, isActive: Boolean(c.is_active), updatedAt: c.updated_at,
  ...(entries ? { entries } : {}),
});

// ---- measurements ---------------------------------------------------------

export function measurementsFor(db, userId) {
  const row = db.get('SELECT * FROM customer_measurements WHERE user_id = ?', userId);
  if (!row) return null;
  const out = { updatedAt: row.updated_at };
  for (const key of MEASUREMENT_KEYS) out[key] = row[`${key}_cm`];
  return out;
}

/** Validate a { key: cm } object. Returns clean values or throws with per-field errors. */
export function validateMeasurements(input) {
  const fields = {};
  const clean = {};
  for (const key of MEASUREMENT_KEYS) {
    const raw = input?.[key];
    const value = raw === '' || raw === undefined ? null : raw;
    const error = validateMeasurement(key, value);
    if (error) fields[key] = error;
    clean[key] = value === null ? null : Math.round(Number(value) * 10) / 10;
  }
  if (Object.keys(fields).length) throw badRequest(Object.values(fields)[0], fields);
  return clean;
}

// ---- size charts ----------------------------------------------------------

export function loadEntries(db, chartId) {
  return db.all('SELECT id, label, sort_order, ranges FROM size_chart_entries WHERE chart_id = ? ORDER BY sort_order, label', chartId)
    .map((e) => ({ id: e.id, label: e.label, sort_order: e.sort_order, ranges: parseJson(e.ranges, {}) }));
}
export function loadChart(db, chartId) {
  const c = chartId ? db.get('SELECT * FROM size_charts WHERE id = ?', chartId) : null;
  return c ? { ...c, entries: loadEntries(db, c.id) } : null;
}
/** Brand-level chart for a category, preferring a matching fit type. */
export function brandChart(db, brandId, category, fitType = 'regular') {
  const c = db.get(
    `SELECT * FROM size_charts WHERE brand_id = ? AND category = ? AND scope = 'brand' AND is_active = 1
      ORDER BY (fit_type = ?) DESC, (fit_type = 'regular') DESC, created_at LIMIT 1`,
    brandId, category, fitType,
  );
  return c ? { ...c, entries: loadEntries(db, c.id) } : null;
}
/** Product-specific chart when assigned, otherwise the brand chart for the category. */
export function chartForProduct(db, product) {
  if (product.size_chart_id) {
    const chart = loadChart(db, product.size_chart_id);
    if (chart && chart.is_active) return { chart, source: chart.scope === 'product' ? 'product' : 'assigned' };
  }
  const chart = brandChart(db, product.brand_id, product.category, product.fit_type);
  return { chart, source: chart ? 'brand' : null };
}

export function validateChartPayload(body) {
  const meta = {
    name: str(body.name, { field: 'name', max: 80 }),
    category: oneOf(body.category, CATEGORY_IDS, { field: 'category' }),
    fit_type: oneOf(body.fitType, FITS, { field: 'fitType', fallback: 'regular' }),
    unit: oneOf(body.unit, ['cm', 'in'], { field: 'unit', fallback: 'cm' }),
    chart_type: oneOf(body.chartType, ['body', 'garment'], { field: 'chartType', fallback: 'body' }),
    scope: oneOf(body.scope, ['brand', 'product'], { field: 'scope', fallback: 'brand' }),
    is_active: body.isActive === false ? 0 : 1,
  };
  if (!Array.isArray(body.entries) || body.entries.length === 0) throw badRequest('Add at least one size to the chart.', { entries: 'At least one size is required.' });
  if (body.entries.length > 60) throw badRequest('A size chart can have at most 60 sizes.');
  const seen = new Set();
  const entries = body.entries.map((e, i) => {
    const label = String(e?.label ?? '').trim();
    const where = `Size ${i + 1}${label ? ` (${label})` : ''}`;
    if (!label) throw badRequest(`${where}: the size label is empty.`);
    if (label.length > 20) throw badRequest(`${where}: the size label is longer than 20 characters.`);
    if (seen.has(label.toLowerCase())) throw badRequest(`Size "${label}" appears more than once.`);
    seen.add(label.toLowerCase());
    const ranges = {};
    for (const [key, r] of Object.entries(e.ranges ?? {})) {
      if (!MEASUREMENT_KEYS.includes(key)) throw badRequest(`${where}: unknown measurement "${key}".`);
      const blank = (v) => v === '' || v === null || v === undefined;
      if (!r || (blank(r.min) && blank(r.max))) continue;
      const def = MEASUREMENTS[key];
      const min = Number(blank(r.min) ? r.max : r.min);
      const max = Number(blank(r.max) ? r.min : r.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) throw badRequest(`${where}: ${def.label} must be positive numbers.`);
      if (min > max) throw badRequest(`${where}: ${def.label} minimum (${min}) is greater than its maximum (${max}).`);
      const lo = meta.unit === 'in' ? cmToIn(def.min * 0.6) : def.min * 0.6;
      const hi = meta.unit === 'in' ? cmToIn(def.max * 1.3) : def.max * 1.3;
      if (min < lo || max > hi) throw badRequest(`${where}: ${def.label} ${min}–${max} ${meta.unit} looks unrealistic. Check the chart unit.`);
      ranges[key] = { min, max };
    }
    if (Object.keys(ranges).length === 0) throw badRequest(`${where}: enter at least one measurement.`);
    return { label, sort_order: i, ranges };
  });
  return { meta, entries };
}

export function saveChart(db, brandId, body, chartId = null) {
  const { meta, entries } = validateChartPayload(body);
  const clash = db.get('SELECT id FROM size_charts WHERE brand_id = ? AND name = ? AND id IS NOT ?', brandId, meta.name, chartId);
  if (clash) throw badRequest(`A size chart named "${meta.name}" already exists.`, { name: 'Name already in use.' });
  return db.tx(() => {
    let id = chartId;
    if (id) {
      db.update('size_charts', id, meta);
      db.run('DELETE FROM size_chart_entries WHERE chart_id = ?', id);
    } else {
      id = db.insert('size_charts', { brand_id: brandId, ...meta }).id;
    }
    for (const e of entries) db.insert('size_chart_entries', { chart_id: id, label: e.label, sort_order: e.sort_order, ranges: JSON.stringify(e.ranges) });
    return chartOut(db.get('SELECT * FROM size_charts WHERE id = ?', id), loadEntries(db, id));
  });
}

export function listCharts(db, brandId) {
  return db.all('SELECT * FROM size_charts WHERE brand_id = ? ORDER BY category, name', brandId).map((c) => {
    const entries = loadEntries(db, c.id);
    const usedBy = db.get('SELECT COUNT(*) AS n FROM products WHERE size_chart_id = ?', c.id).n;
    return { ...chartOut(c, entries), productCount: usedBy };
  });
}

// ---- products -------------------------------------------------------------

export function validateProductPayload(db, brandId, body, existing = null) {
  const pick = (key, fallback) => (key in body ? body[key] : fallback);
  const out = {
    name: str(pick('name', existing?.name), { field: 'name', max: 120 }),
    external_id: str(pick('externalId', existing?.external_id), { field: 'externalId', max: 80 }),
    description: str(pick('description', existing?.description), { field: 'description', max: 1000, required: false }),
    category: oneOf(pick('category', existing?.category), CATEGORY_IDS, { field: 'category' }),
    fit_type: oneOf(pick('fitType', existing?.fit_type), FITS, { field: 'fitType', fallback: 'regular' }),
    image_url: 'imageUrl' in body ? image(body.imageUrl, { field: 'imageUrl' }) : existing?.image_url ?? null,
    is_active: 'isActive' in body ? (body.isActive ? 1 : 0) : existing?.is_active ?? 1,
  };
  if (!/^[A-Za-z0-9._-]+$/.test(out.external_id)) throw badRequest('Product identifier may only contain letters, numbers, dots, dashes and underscores.', { externalId: 'Letters, numbers, . - _ only.' });
  const clash = db.get('SELECT id FROM products WHERE brand_id = ? AND external_id = ? AND id IS NOT ?', brandId, out.external_id, existing?.id ?? null);
  if (clash) throw badRequest(`Product identifier "${out.external_id}" is already used by another product.`, { externalId: 'Already in use.' });

  const chartId = pick('sizeChartId', existing?.size_chart_id) || null;
  let chartLabels = null;
  if (chartId) {
    const chart = db.get('SELECT id FROM size_charts WHERE id = ? AND brand_id = ?', chartId, brandId);
    if (!chart) throw badRequest('The selected size chart does not belong to this brand.', { sizeChartId: 'Invalid size chart.' });
    chartLabels = loadEntries(db, chartId).map((e) => e.label);
  }
  out.size_chart_id = chartId;

  const sizes = pick('availableSizes', existing ? parseJson(existing.available_sizes, []) : []);
  if (!Array.isArray(sizes) || sizes.some((s) => typeof s !== 'string' || s.length > 20) || sizes.length > 60) throw badRequest('Available sizes must be a list of size labels.', { availableSizes: 'Invalid list.' });
  const cleanSizes = [...new Set(sizes.map((s) => s.trim()).filter(Boolean))];
  out.available_sizes = JSON.stringify(chartLabels ? cleanSizes.filter((s) => chartLabels.includes(s)) : cleanSizes);

  const ease = pick('ease', existing ? parseJson(existing.ease, null) : null);
  if (ease && typeof ease === 'object') {
    const clean = {};
    for (const [key, v] of Object.entries(ease)) {
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!MEASUREMENT_KEYS.includes(key) || !Number.isFinite(n) || n < -5 || n > 60) throw badRequest('Ease values must be between -5 and 60 cm.', { ease: 'Invalid ease.' });
      clean[key] = n;
    }
    out.ease = Object.keys(clean).length ? JSON.stringify(clean) : null;
  } else out.ease = null;
  return out;
}

// ---- recommendations ------------------------------------------------------

export function logEvent(db, { brandId, productId = null, type, status = null, size = null, source }) {
  db.insert('recommendation_events', { brand_id: brandId, product_id: productId, type, status, size_label: size, source });
}

/** Run the engine for a product row. Pure with respect to the database. */
export function recommendForProduct(db, { profile, product, fitPreference }) {
  const { chart, source } = chartForProduct(db, product);
  const result = recommendSize({
    profile,
    chart,
    product: {
      category: product.category, fit_type: product.fit_type,
      available_sizes: parseJson(product.available_sizes, []), ease: parseJson(product.ease, null),
    },
    fitPreference,
    config: engineConfig(db),
  });
  result.chart = chart ? { id: chart.id, name: chart.name, source, unit: chart.unit, chartType: chart.chart_type } : null;
  return result;
}

/** Store a customer's recommendation and the anonymous analytics event. */
export function recordRecommendation(db, { userId, brand, product, result, fitPreference, source }) {
  db.insert('recommendations', {
    user_id: userId, brand_id: brand.id, product_id: product.id, product_name: product.name, category: product.category,
    status: result.status, size_label: result.size ?? null, match_score: result.matchScore ?? null,
    confidence: result.confidence?.level ?? null, fit_preference: fitPreference, source,
  });
  logEvent(db, { brandId: brand.id, productId: product.id, type: 'recommendation', status: result.status, size: result.size ?? null, source });
}

// ---- misc -----------------------------------------------------------------

export function uniqueSlug(db, name, ignoreId = null) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'brand';
  let slug = base;
  for (let i = 2; db.get('SELECT id FROM brands WHERE slug = ? AND id IS NOT ?', slug, ignoreId); i++) slug = `${base}-${i}`;
  return slug;
}

export const newPublicKey = () => `pk_${randomToken(18)}`;
export const newSecretKey = () => `sk_${randomToken(30)}`;

export const DEFAULT_WIDGET_CONFIG = { buttonText: 'Find My Size', theme: 'dark', radius: 12, accent: '#ffffff', showScore: true };
export function validateWidgetConfig(input, current = DEFAULT_WIDGET_CONFIG) {
  const out = { ...DEFAULT_WIDGET_CONFIG, ...current };
  if ('buttonText' in input) out.buttonText = str(input.buttonText, { field: 'buttonText', max: 30 });
  if ('theme' in input) out.theme = oneOf(input.theme, ['dark', 'light'], { field: 'theme' });
  if ('radius' in input) {
    const r = Number(input.radius);
    if (!Number.isFinite(r) || r < 0 || r > 24) throw badRequest('Corner radius must be between 0 and 24.', { radius: '0–24.' });
    out.radius = Math.round(r);
  }
  if ('accent' in input) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(input.accent))) throw badRequest('Accent colour must be a hex value such as #ffffff.', { accent: 'Invalid colour.' });
    out.accent = String(input.accent).toLowerCase();
  }
  if ('showScore' in input) out.showScore = Boolean(input.showScore);
  return out;
}

export function createBrandForMerchant(db, merchant, name, website) {
  const brand = db.insert('brands', {
    merchant_id: merchant.id, name, slug: uniqueSlug(db, name), website: website ?? null,
    categories: '[]', integration_status: 'not_integrated', is_active: 1, is_demo: 0,
  });
  db.insert('widget_integrations', { merchant_id: merchant.id, public_key: newPublicKey(), allowed_origins: '[]', config: JSON.stringify(DEFAULT_WIDGET_CONFIG) });
  return brand;
}

export { uuid, notFound };
