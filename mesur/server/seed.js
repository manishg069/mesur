// Demonstration data. Everything created here is fictional and flagged as such
// (brands.is_demo, *.is_sample). Size charts for the well-known brand names are
// NOT real: they are invented to show how sizing differs between brands.
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { openDatabase, uuid } from './db.js';
import { hashPassword } from './auth.js';
import { recommendForProduct, newPublicKey, DEFAULT_WIDGET_CONFIG } from './services.js';
import { loadEnv } from './env.js';

export const DEMO_ACCOUNTS = [
  { role: 'customer', email: 'customer@mesur.demo', password: 'demo-customer-1', name: 'Alex Morgan' },
  { role: 'merchant', email: 'merchant@mesur.demo', password: 'demo-merchant-1', name: 'Sam Rivera' },
  { role: 'admin', email: 'admin@mesur.demo', password: 'demo-admin-1', name: 'Platform Admin' },
];

const TOP_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const r = (min, max) => ({ min, max });

/** Evenly graded body chart for tops. */
function tops({ chest, step, shoulder, labels = TOP_LABELS, drop = 14 }) {
  return labels.map((label, i) => {
    const c = chest + i * step;
    const s = shoulder + i * 2;
    return { label, ranges: { chest: r(c, c + step - 1), waist: r(c - drop, c - drop + step - 1), shoulder: r(s, s + 1) } };
  });
}
function bottoms({ waist, hipOffset = 16, labels = ['28', '30', '32', '34', '36', '38'], inseam = [76, 84] }) {
  return labels.map((label, i) => {
    const w = waist + i * 5;
    return { label, ranges: { waist: r(w, w + 4), hip: r(w + hipOffset, w + hipOffset + 4), inseam: r(inseam[0], inseam[1]) } };
  });
}
function dresses({ chest, labels = ['34', '36', '38', '40', '42', '44'] }) {
  return labels.map((label, i) => {
    const c = chest + i * 4;
    return { label, ranges: { chest: r(c, c + 3), waist: r(c - 20, c - 17), hip: r(c + 6, c + 9) } };
  });
}

const NOTE = 'Fictional demonstration data. Not sourced from, verified by or endorsed by the brand.';
const SAMPLE_BRANDS = [
  {
    name: 'Zara', country: 'Spain', website: 'https://www.zara.com',
    tee: [
      { label: 'XS', ranges: { chest: r(83, 87), waist: r(69, 73), shoulder: r(40, 41) } },
      { label: 'S', ranges: { chest: r(88, 92), waist: r(74, 78), shoulder: r(42, 43) } },
      { label: 'M', ranges: { chest: r(93, 98), waist: r(79, 84), shoulder: r(44, 45) } },
      { label: 'L', ranges: { chest: r(99, 104), waist: r(85, 90), shoulder: r(46, 47) } },
      { label: 'XL', ranges: { chest: r(105, 111), waist: r(91, 97), shoulder: r(48, 49) } },
      { label: 'XXL', ranges: { chest: r(112, 118), waist: r(98, 104), shoulder: r(50, 51) } },
    ],
    hoodie: { chest: 84, step: 6, shoulder: 41 }, jeans: { waist: 70 }, dress: { chest: 80 },
  },
  { name: 'H&M', country: 'Sweden', website: 'https://www.hm.com', tee: tops({ chest: 76, step: 6, shoulder: 38 }), hoodie: { chest: 78, step: 6, shoulder: 39 }, jeans: { waist: 68 }, dress: { chest: 78 } },
  { name: 'Uniqlo', country: 'Japan', website: 'https://www.uniqlo.com', tee: tops({ chest: 79, step: 6, shoulder: 40 }), hoodie: { chest: 82, step: 6, shoulder: 41 }, jeans: { waist: 71 } },
  { name: 'Nike', country: 'United States', website: 'https://www.nike.com', tee: tops({ chest: 81, step: 7, shoulder: 39.5 }), hoodie: { chest: 80, step: 7, shoulder: 40 }, jeans: null },
  { name: 'Adidas', country: 'Germany', website: 'https://www.adidas.com', tee: tops({ chest: 84, step: 7, shoulder: 41 }), hoodie: { chest: 86, step: 7, shoulder: 42 }, jeans: null },
];

/** Small deterministic PRNG so the sample analytics look the same on every seed. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isSeeded(db) {
  return db.get('SELECT COUNT(*) AS n FROM profiles').n > 0;
}

export function seedDemo(db) {
  const rand = mulberry32(20261114);
  const ago = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString();

  db.tx(() => {
    const addChart = (brandId, meta, entries) => {
      const chart = db.insert('size_charts', { brand_id: brandId, fit_type: 'regular', unit: 'cm', chart_type: 'body', scope: 'brand', is_active: 1, ...meta });
      entries.forEach((e, i) => db.insert('size_chart_entries', { chart_id: chart.id, label: e.label, sort_order: i, ranges: JSON.stringify(e.ranges) }));
      return chart;
    };
    const addProduct = (brandId, p) => db.insert('products', {
      brand_id: brandId, fit_type: 'regular', available_sizes: '[]', is_active: 1, description: null, size_chart_id: null, ease: null, image_url: null, ...p,
    });

    // ---- accounts ----
    const users = {};
    for (const a of DEMO_ACCOUNTS) {
      users[a.role] = db.insert('profiles', { email: a.email, password_hash: hashPassword(a.password), full_name: a.name, role: a.role, is_sample: 1 });
    }
    db.insert('customer_measurements', {
      user_id: users.customer.id, height_cm: 170, chest_cm: 96, waist_cm: 82, shoulder_cm: 44,
      hip_cm: 98, arm_cm: null, inseam_cm: 78, thigh_cm: null, neck_cm: null,
    });
    const extras = [
      ['Priya Nair', 'priya@sample.mesur.demo', { height_cm: 162, chest_cm: 88, waist_cm: 70, shoulder_cm: 38, hip_cm: 96 }],
      ['Jonas Weber', 'jonas@sample.mesur.demo', { height_cm: 186, chest_cm: 108, waist_cm: 94, shoulder_cm: 48 }],
      ['Mina Park', 'mina@sample.mesur.demo', null],
    ];
    for (const [name, mail, m] of extras) {
      const u = db.insert('profiles', { email: mail, password_hash: hashPassword(uuid()), full_name: name, role: 'customer', is_sample: 1, created_at: ago(Math.floor(rand() * 20) + 1) });
      if (m) db.insert('customer_measurements', { user_id: u.id, waist_cm: null, shoulder_cm: null, hip_cm: null, arm_cm: null, inseam_cm: null, thigh_cm: null, neck_cm: null, ...m });
    }

    // ---- platform-managed sample brands ----
    const sampleProducts = [];
    for (const b of SAMPLE_BRANDS) {
      const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const brand = db.insert('brands', {
        merchant_id: null, name: b.name, slug, website: b.website, country: b.country, logo_url: null,
        description: `Sample brand. ${NOTE}`,
        categories: JSON.stringify(['tshirts', 'hoodies', ...(b.jeans ? ['jeans'] : []), ...(b.dress ? ['dresses'] : [])]),
        integration_status: 'not_integrated', is_active: 1, is_demo: 1,
      });
      addChart(brand.id, { name: 'T-shirts — sample chart', category: 'tshirts' }, b.tee);
      addChart(brand.id, { name: 'Hoodies — sample chart', category: 'hoodies', fit_type: 'relaxed' }, tops(b.hoodie));
      if (b.jeans) addChart(brand.id, { name: 'Jeans — sample chart', category: 'jeans' }, bottoms(b.jeans));
      if (b.dress) addChart(brand.id, { name: 'Dresses — sample chart', category: 'dresses' }, dresses(b.dress));
      sampleProducts.push(addProduct(brand.id, { external_id: 'sample-tee', name: 'Sample Crew Tee', category: 'tshirts' }));
      addProduct(brand.id, { external_id: 'sample-hoodie', name: 'Sample Pullover Hoodie', category: 'hoodies', fit_type: 'relaxed' });
      if (b.jeans) addProduct(brand.id, { external_id: 'sample-jean', name: 'Sample Straight Jean', category: 'jeans' });
    }

    // ---- demo merchant: Northline Supply (fictional) ----
    const merchant = db.insert('merchants', { owner_id: users.merchant.id, company_name: 'Northline Supply', contact_email: users.merchant.email, website: 'https://northline.example', status: 'approved' });
    const northline = db.insert('brands', {
      merchant_id: merchant.id, name: 'Northline Supply', slug: 'northline-supply', website: 'https://northline.example', country: 'Demo',
      description: 'Fictional demo merchant used by the bundled storefront. Everyday essentials in considered fabrics.',
      categories: JSON.stringify(['tshirts', 'hoodies', 'sweatshirts', 'jeans', 'shorts']), integration_status: 'sandbox', is_active: 1, is_demo: 1, logo_url: null,
    });
    db.insert('widget_integrations', {
      merchant_id: merchant.id, public_key: 'pk_demo_northline', allowed_origins: '[]', config: JSON.stringify(DEFAULT_WIDGET_CONFIG),
    });
    addChart(northline.id, { name: 'Tops — regular', category: 'tshirts' }, tops({ chest: 82, step: 6, shoulder: 40 }));
    addChart(northline.id, { name: 'Sweatshirts — regular', category: 'sweatshirts' }, tops({ chest: 82, step: 6, shoulder: 40 }));
    addChart(northline.id, { name: 'Hoodies — relaxed', category: 'hoodies', fit_type: 'relaxed' }, tops({ chest: 82, step: 6, shoulder: 40 }));
    addChart(northline.id, { name: 'Denim', category: 'jeans' }, bottoms({ waist: 71 }));
    addChart(northline.id, { name: 'Shorts', category: 'shorts' }, bottoms({ waist: 71, inseam: [60, 110] }).map((e) => ({ label: e.label, ranges: { waist: e.ranges.waist, hip: e.ranges.hip } })));
    // Product-specific *garment* chart in inches: finished chest and shoulder width.
    const boxy = addChart(northline.id, { name: 'Boxy Heavyweight Tee — garment (in)', category: 'tshirts', fit_type: 'oversized', unit: 'in', chart_type: 'garment', scope: 'product' },
      ['S', 'M', 'L', 'XL'].map((label, i) => ({ label, ranges: { chest: r(43 + i * 2.5, 43 + i * 2.5), shoulder: r(19 + i * 0.75, 19 + i * 0.75) } })));

    const products = [
      addProduct(northline.id, { external_id: 'essential-cotton-tee', name: 'Essential Cotton Tee', category: 'tshirts', description: 'Midweight organic cotton jersey with a clean crew neck.' }),
      addProduct(northline.id, { external_id: 'boxy-heavyweight-tee', name: 'Boxy Heavyweight Tee', category: 'tshirts', fit_type: 'oversized', size_chart_id: boxy.id, description: 'Dropped shoulder, 280 gsm. Sized from its own garment chart.' }),
      addProduct(northline.id, { external_id: 'merino-crew', name: 'Merino Crew Sweatshirt', category: 'sweatshirts', available_sizes: JSON.stringify(['S', 'M', 'L', 'XL']), description: 'Fine merino blend with ribbed trims.' }),
      addProduct(northline.id, { external_id: 'everyday-hoodie', name: 'Everyday Hoodie', category: 'hoodies', fit_type: 'relaxed', description: 'Brushed-back fleece with a relaxed body.' }),
      addProduct(northline.id, { external_id: 'straight-leg-jean', name: 'Straight Leg Jean', category: 'jeans', description: 'Rigid 13 oz denim, straight through the leg.' }),
      addProduct(northline.id, { external_id: 'chino-short', name: 'Chino Short', category: 'shorts', description: 'Garment-dyed cotton twill.' }),
    ];
    addProduct(northline.id, { external_id: 'archive-overshirt', name: 'Archive Overshirt', category: 'jackets', is_active: 0, description: 'Inactive example without a size chart.' });

    // ---- sample analytics events for the demo merchant ----
    const sizes = ['S', 'M', 'M', 'M', 'L', 'L', 'XL', 'XS'];
    const waistSizes = ['30', '32', '32', '34', '34', '36'];
    for (let day = 29; day >= 0; day--) {
      products.forEach((p, pi) => {
        const impressions = Math.floor(6 + rand() * (22 - pi * 2));
        for (let i = 0; i < impressions; i++) {
          const at = ago(day, rand() * 23);
          db.insert('recommendation_events', { brand_id: northline.id, product_id: p.id, type: 'impression', status: null, size_label: null, source: 'widget', is_sample: 1, created_at: at });
          if (rand() < 0.42) db.insert('recommendation_events', { brand_id: northline.id, product_id: p.id, type: 'open', status: null, size_label: null, source: 'widget', is_sample: 1, created_at: at });
          if (rand() < 0.3) {
            const roll = rand();
            const status = roll < 0.9 ? 'ok' : roll < 0.96 ? 'insufficient_data' : 'out_of_range';
            const pool = ['jeans', 'shorts'].includes(p.category) ? waistSizes : sizes;
            const size = status === 'ok' ? pool[Math.floor(rand() * pool.length)] : null;
            db.insert('recommendation_events', { brand_id: northline.id, product_id: p.id, type: 'recommendation', status, size_label: size, source: 'widget', is_sample: 1, created_at: at });
            if (size && rand() < 0.6) db.insert('recommendation_events', { brand_id: northline.id, product_id: p.id, type: 'size_selected', status: null, size_label: size, source: 'widget', is_sample: 1, created_at: at });
          }
        }
      });
    }

    // ---- sample history for the demo customer, produced by the real engine ----
    const profile = { height: 170, chest: 96, waist: 82, shoulder: 44, hip: 98, inseam: 78 };
    [products[0], sampleProducts[1], products[4], sampleProducts[0], products[1]].forEach((product, i) => {
      const result = recommendForProduct(db, { profile, product, fitPreference: 'regular' });
      db.insert('recommendations', {
        user_id: users.customer.id, brand_id: product.brand_id, product_id: product.id, product_name: product.name, category: product.category,
        status: result.status, size_label: result.size ?? null, match_score: result.matchScore ?? null, confidence: result.confidence?.level ?? null,
        fit_preference: 'regular', source: i % 2 ? 'app' : 'widget', is_sample: 1, created_at: ago(i + 1, i * 3),
      });
    });
  });
}

/** Production bootstrap: create the first admin from environment variables. */
export function ensureAdmin(db, env) {
  if (db.get("SELECT id FROM profiles WHERE role = 'admin'")) return;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn('[setup] No admin account exists. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create one.');
    return;
  }
  db.insert('profiles', { email: env.ADMIN_EMAIL.toLowerCase(), password_hash: hashPassword(env.ADMIN_PASSWORD), full_name: 'Administrator', role: 'admin' });
  console.log(`[setup] Created admin account ${env.ADMIN_EMAIL}`);
}

// CLI: `npm run seed` / `npm run reset`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv();
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(env.DATABASE_PATH + suffix, { force: true });
    console.log(`Removed ${env.DATABASE_PATH}`);
  }
  const db = openDatabase(env.DATABASE_PATH);
  if (isSeeded(db)) console.log('Database already has data. Run "npm run reset" to start again.');
  else { seedDemo(db); console.log('Seeded demonstration data.'); }
  db.close();
}
