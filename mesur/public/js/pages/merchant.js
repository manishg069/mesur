import { api } from '../api.js';
import {
  $, esc, on, load, empty, skeleton, skeletonGrid, options, field, seg, toast, toastError, confirmDialog, modal, submitHandler,
  fmtNum, dailyBars, hBars, copyText, imageToDataUrl, icon, sampleTag, monogram,
} from '../ui.js';
import { pageHead, statCard } from '../components.js';
import { chartManager } from '../chart-editor.js';
import { accountSections, bindAccount } from './account.js';
import { CATEGORIES, FITS, FIT_LABELS, categoryLabel, MEASUREMENTS } from '/shared/measurements.js';

const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);
const sampleNotice = (n) => (n ? `<p class="notice warn" style="margin-bottom:18px">${fmtNum(n)} of these events are clearly labelled sample data generated for the demonstration. Real widget traffic is added on top as it happens.</p>` : '');

function statusBanner(status) {
  if (status === 'pending') return '<p class="notice warn" style="margin-bottom:18px">Your merchant account is awaiting approval. You can set up products and charts now; the widget and your brand page go live once an administrator approves the account.</p>';
  return '';
}

// ---------------------------------------------------------------------------
export async function overview({ el }) {
  await load(el, () => api.get('/api/merchant/overview'), (d) => {
    const s = d.stats;
    el.innerHTML = `
      ${pageHead('Merchant', d.brand.name, '<a class="btn btn-sm" href="/merchant/integrations">Install widget</a><a class="btn btn-primary btn-sm" href="/merchant/products">Add product</a>')}
      ${statusBanner(d.merchant.status)}
      ${sampleNotice(d.sampleEvents)}
      <div class="grid cols-4">
        ${statCard('Total products', fmtNum(s.products), `${fmtNum(s.activeProducts)} active`)}
        ${statCard('Active size charts', fmtNum(s.activeCharts))}
        ${statCard('Recommendation requests', fmtNum(s.recommendations), 'Last 30 days')}
        ${statCard('Widget impressions', fmtNum(s.impressions), 'Last 30 days')}
      </div>
      <div class="grid cols-4" style="margin-top:16px">
        ${statCard('Recommendation rate', pct(s.conversionRate), 'Impressions that led to a recommendation')}
        ${statCard('Size selected', fmtNum(s.sizeSelected), 'Shoppers who picked the suggested size')}
        ${statCard('Outside size range', fmtNum(s.outOfRange), 'Shoppers your charts could not fit')}
        <div class="card stat"><span class="label">Size-related returns</span><b class="faint">—</b><span class="small muted">Shown once you supply return data. Not estimated.</span></div>
      </div>
      <div class="card pad-lg" style="margin-top:16px"><div class="row between" style="margin-bottom:18px"><span class="label">Activity · 30 days</span><a class="link small" href="/merchant/analytics">Full analytics</a></div>
        ${s.impressions || s.recommendations ? dailyBars(d.series) : empty({ title: 'No widget activity yet', body: 'Impressions and recommendations appear here once the widget is installed on a product page.', mark: 'chart' })}</div>
      <div class="section-title"><h2 class="h3">Setup</h2></div>
      <div class="grid cols-3">
        ${[
          [s.activeCharts > 0, 'Add a size chart', 'Recommendations are only as good as your charts.', '/merchant/size-charts'],
          [s.products > 0 && !s.productsWithoutChart, s.productsWithoutChart ? `${s.productsWithoutChart} product${s.productsWithoutChart === 1 ? ' has' : 's have'} no chart` : 'Add products', 'Each product needs a chart, either assigned or by category.', '/merchant/products'],
          [s.impressions > 0, 'Install the widget', 'Paste one script tag on your product pages.', '/merchant/integrations'],
        ].map(([done, title, body, href]) => `<a class="card hover stack" href="${href}" style="--gap:10px"><span class="tag ${done ? 'ok' : ''}">${done ? `${icon('check', 12)} Done` : 'To do'}</span><b>${esc(title)}</b><span class="small muted">${esc(body)}</span></a>`).join('')}
      </div>`;
  }, { skeletonHtml: skeletonGrid(8, 110) });
}

// ---------------------------------------------------------------------------
export async function products({ el }) {
  let data = null;
  let filter = 'all';
  el.innerHTML = `${pageHead('Merchant', 'Products', `<button class="btn btn-primary btn-sm" data-new>${icon('plus', 14)} Add product</button>`)}<div id="list"></div>`;
  const listEl = $('#list', el);

  const chartFor = (p) => data.charts.find((c) => c.id === p.sizeChartId) ?? data.charts.find((c) => c.scope === 'brand' && c.category === p.category && c.isActive);
  const render = () => {
    const items = data.products.filter((p) => filter === 'all' || (filter === 'active' ? p.isActive : !p.isActive));
    listEl.innerHTML = !data.products.length
      ? empty({ title: 'No products yet', body: 'Add the products that should show a “Find My Size” button. Each product gets an identifier you use in the widget snippet.', mark: 'box', action: '<button class="btn btn-primary btn-sm" data-new>Add your first product</button>' })
      : `<div class="row between wrap-row" style="margin-bottom:14px">${seg('filter', [['all', `All ${data.products.length}`], ['active', 'Active'], ['inactive', 'Inactive']], filter)}</div>
        ${items.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th>Identifier</th><th>Category</th><th>Size chart</th><th>Status</th><th></th></tr></thead>
          <tbody>${items.map((p) => { const c = chartFor(p); return `<tr>
            <td><div class="row" style="--gap:12px">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover">` : `<div class="logo-mono" style="width:40px;height:40px">${icon('hanger')}</div>`}<div><b>${esc(p.name)}</b><div class="small muted">${esc(FIT_LABELS[p.fitType])}${p.availableSizes.length ? ` · ${esc(p.availableSizes.join(' '))}` : ''}</div></div></div></td>
            <td class="mono muted">${esc(p.externalId)}</td>
            <td class="muted">${esc(categoryLabel(p.category))}</td>
            <td>${c ? `<span class="small">${esc(c.name)}</span><div class="small faint">${p.sizeChartId ? 'Assigned' : 'By category'}</div>` : '<span class="tag warn">No chart</span>'}</td>
            <td><label class="check"><input type="checkbox" data-toggle="${esc(p.id)}" ${p.isActive ? 'checked' : ''} aria-label="Active"> <span class="small">${p.isActive ? 'Active' : 'Inactive'}</span></label></td>
            <td class="actions"><button class="btn btn-sm" data-edit="${esc(p.id)}">Edit</button><button class="icon-btn" data-delete="${esc(p.id)}" aria-label="Delete ${esc(p.name)}">${icon('trash')}</button></td></tr>`; }).join('')}</tbody></table></div>`
          : empty({ title: `No ${filter} products`, body: 'Change the filter to see the rest.' })}`;
  };
  const refresh = () => load(listEl, () => api.get('/api/merchant/products'), (d) => { data = d; render(); }, { skeletonHtml: skeleton(4, 64) });

  const openForm = (p = null) => {
    let image = p?.imageUrl ?? null;
    const sizesFor = (chartId, category) => (data.charts.find((c) => c.id === chartId) ?? data.charts.find((c) => c.scope === 'brand' && c.category === category && c.isActive))?.sizes ?? [];
    const m = modal({
      title: p ? 'Edit product' : 'Add product',
      wide: true,
      body: `<form class="stack" id="product-form" novalidate>
        <p class="notice bad hide" data-form-error role="alert"></p>
        <div class="grid cols-2">
          ${field('Product name', `<input class="input" name="name" value="${esc(p?.name ?? '')}" maxlength="120" required>`)}
          ${field('Product identifier', `<input class="input mono" name="externalId" value="${esc(p?.externalId ?? '')}" maxlength="80" required placeholder="essential-cotton-tee">`, { hint: 'Your SKU or handle. Used as <span class="mono">data-product</span> in the widget.' })}
          ${field('Category', `<select class="select" name="category">${options(CATEGORIES, p?.category ?? 'tshirts')}</select>`)}
          ${field('Fit type', `<select class="select" name="fitType">${options(FITS.map((f) => [f, FIT_LABELS[f]]), p?.fitType ?? 'regular')}</select>`, { hint: 'How this product is cut. Used with the shopper’s fit preference.' })}
          ${field('Size chart', `<select class="select" name="sizeChartId"><option value="">Use the brand chart for this category</option>${options(data.charts.map((c) => [c.id, `${c.name} · ${categoryLabel(c.category)}`]), p?.sizeChartId)}</select>`)}
          ${field('Product image', `<div class="row" style="--gap:12px"><div id="img-preview">${image ? `<img src="${esc(image)}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover">` : ''}</div><input type="file" accept="image/png,image/jpeg,image/webp" id="img-file" class="input" style="padding-top:10px"></div>`, { optional: true })}
        </div>
        <div class="field"><span class="label"><span>Available sizes</span><span class="faint">None selected = every size on the chart</span></span><div class="chips" id="sizes"></div></div>
        ${field('Description', `<textarea class="textarea" name="description" maxlength="1000">${esc(p?.description ?? '')}</textarea>`, { optional: true })}
        <details><summary class="label" style="cursor:pointer">Advanced — designed ease (cm)</summary>
          <p class="small muted" style="margin:10px 0">How much larger the garment is than the body it is cut for. Leave empty to use the platform default for this fit type.</p>
          <div class="grid cols-3">${['chest', 'waist', 'hip'].map((k) => field(MEASUREMENTS[k].label, `<input class="input" name="ease_${k}" inputmode="decimal" value="${esc(p?.ease?.[k] ?? '')}">`, { optional: true })).join('')}</div>
        </details>
        <label class="check"><input type="checkbox" name="isActive" ${p?.isActive === false ? '' : 'checked'}> Active — show the widget for this product</label>
      </form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="product-form">${p ? 'Save product' : 'Add product'}</button>`,
    });
    const form = $('#product-form', m.el);
    let selected = new Set(p?.availableSizes ?? []);
    const drawSizes = () => {
      const sizes = sizesFor(form.elements.sizeChartId.value, form.elements.category.value);
      selected = new Set([...selected].filter((s) => sizes.includes(s)));
      $('#sizes', m.el).innerHTML = sizes.length ? sizes.map((s) => `<button type="button" class="chip" data-size="${esc(s)}" aria-pressed="${selected.has(s)}">${esc(s)}</button>`).join('')
        : '<span class="small warn" style="color:var(--warn)">No size chart covers this category yet. Recommendations will be unavailable until you add one.</span>';
    };
    drawSizes();
    on(m.el, 'change', '[name=sizeChartId], [name=category]', drawSizes);
    on(m.el, 'click', '[data-size]', (e, b) => { const s = b.dataset.size; if (selected.has(s)) selected.delete(s); else selected.add(s); b.setAttribute('aria-pressed', String(selected.has(s))); });
    $('#img-file', m.el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { image = await imageToDataUrl(file); $('#img-preview', m.el).innerHTML = `<img src="${image}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover">`; }
      catch (err) { e.target.value = ''; toastError(err); }
    });
    submitHandler(form, async (v) => {
      const order = sizesFor(v.sizeChartId, v.category);
      const body = {
        name: v.name, externalId: v.externalId, category: v.category, fitType: v.fitType, sizeChartId: v.sizeChartId || null,
        description: v.description, isActive: v.isActive, imageUrl: image,
        availableSizes: order.filter((s) => selected.has(s)),
        ease: { chest: v.ease_chest, waist: v.ease_waist, hip: v.ease_hip },
      };
      if (p) await api.patch(`/api/merchant/products/${p.id}`, body); else await api.post('/api/merchant/products', body);
      m.close();
      toast(p ? 'Product saved' : 'Product added');
      refresh();
    });
  };

  on(el, 'click', '[data-new]', () => (data ? openForm() : null));
  on(el, 'click', '[data-edit]', (e, b) => openForm(data.products.find((p) => p.id === b.dataset.edit)));
  on(el, 'seg', '[data-seg=filter]', (e) => { filter = e.detail.value; render(); });
  on(el, 'change', '[data-toggle]', async (e, input) => {
    try { await api.patch(`/api/merchant/products/${input.dataset.toggle}`, { isActive: input.checked }); toast(input.checked ? 'Product activated' : 'Product deactivated'); refresh(); }
    catch (err) { input.checked = !input.checked; toastError(err); }
  });
  on(el, 'click', '[data-delete]', async (e, b) => {
    const p = data.products.find((x) => x.id === b.dataset.delete);
    if (!(await confirmDialog({ title: `Delete “${p.name}”?`, body: 'The widget will stop working for this product identifier. Anonymous analytics already collected are kept.', confirmText: 'Delete product', danger: true }))) return;
    try { await api.del(`/api/merchant/products/${p.id}`); toast('Product deleted'); refresh(); } catch (err) { toastError(err); }
  });
  refresh();
}

// ---------------------------------------------------------------------------
export async function sizeCharts({ el, setLeaveGuard }) {
  el.innerHTML = `${pageHead('Merchant', 'Size charts', '', 'Build charts in the table editor or import a CSV. Values are the measurements each size is designed to fit.')}<div id="charts"></div>`;
  chartManager($('#charts', el), { base: '/api/merchant/charts', setLeaveGuard });
}

// ---------------------------------------------------------------------------
export async function integrations({ el }) {
  let d = null;
  let product = '';
  let productList = [];
  el.innerHTML = `${pageHead('Merchant', 'Integrations', '', 'Add the “Find My Size” button to your store. Shoppers see their recommendation in a secure frame; their measurements never reach your site.')}<div id="body"></div>`;
  const body = $('#body', el);

  const snippet = () => `<script\n  src="${d.appUrl}/widget.js"\n  data-merchant="${d.publicKey}"\n  data-product="${product || 'YOUR_PRODUCT_ID'}"\n  async>\n</script>`;
  const apiExample = () => `curl -X POST ${d.appUrl}/api/v1/recommendations \\\n  -H "Authorization: Bearer ${d.hasSecretKey ? `sk_…${d.secretLast4}` : 'sk_your_secret_key'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"product_id": "${product || 'YOUR_PRODUCT_ID'}", "measurements": {"chest": 96, "waist": 82}, "unit": "cm", "fit_preference": "regular"}'`;
  const preview = () => {
    const c = d.config;
    const light = c.theme === 'light';
    return `<div style="background:${light ? '#f4f4f2' : '#0d0d0d'};border:1px solid var(--border);border-radius:14px;padding:30px;display:grid;place-items:center;min-height:140px">
      <button type="button" style="font:500 14px/1 var(--font);height:44px;padding:0 20px;border-radius:${c.radius}px;cursor:default;border:1px solid ${light ? '#111' : c.accent};background:${light ? '#111' : c.accent};color:${light ? '#fff' : '#000'};display:inline-flex;align-items:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/></svg>${esc(c.buttonText)}</button></div>`;
  };

  const render = () => {
    body.innerHTML = `
      ${statusBanner(d.merchantStatus)}
      <div class="stack" style="--gap:16px">
        <div class="card pad-lg stack">
          <div class="row between wrap-row"><h2 class="h3">1. Public key</h2><span class="tag">Safe to publish</span></div>
          <p class="small muted">Identifies your store to the widget. It cannot read data or change settings.</p>
          <div class="keybox"><span>${esc(d.publicKey)}</span><button class="icon-btn" data-copy="${esc(d.publicKey)}" aria-label="Copy public key">${icon('copy')}</button></div>
          <div><button class="btn btn-sm" data-rotate-public>Regenerate public key</button></div>
        </div>

        <div class="card pad-lg stack">
          <h2 class="h3">2. Embed snippet</h2>
          <div class="grid cols-2" style="align-items:end">
            ${field('Product', `<select class="select" id="product">${productList.length ? options([['', 'Choose a product'], ...productList.map((p) => [p.externalId, `${p.name} — ${p.externalId}`])], product) : '<option value="">Add a product first</option>'}</select>`)}
            <p class="small muted">Place the snippet where the button should appear on each product page, replacing <span class="mono">data-product</span> with that page’s identifier.</p>
          </div>
          <div class="code" id="snippet">${esc(snippet())}</div>
          <div class="row wrap-row"><button class="btn btn-primary btn-sm" data-copy-snippet>${icon('copy', 14)} Copy snippet</button>
            ${d.storefrontUrl ? `<a class="btn btn-sm" href="${esc(d.storefrontUrl)}" target="_blank" rel="noopener">Open demo storefront ↗</a>` : ''}</div>
          <details><summary class="label" style="cursor:pointer">Shopify, WooCommerce and custom stores</summary>
            <div class="stack small muted" style="--gap:8px;margin-top:12px">
              <p><b style="color:#fff">Shopify:</b> add a Custom Liquid block to the product template and use <span class="mono">data-product="{{ product.handle }}"</span>. Create Mesur products with the same handles.</p>
              <p><b style="color:#fff">WooCommerce:</b> add the snippet to the single-product template (or a hooks plugin on <span class="mono">woocommerce_single_product_summary</span>) with <span class="mono">data-product="&lt;?php echo esc_attr( $product-&gt;get_sku() ); ?&gt;"</span>.</p>
              <p><b style="color:#fff">Custom / headless:</b> render the snippet server-side, or call <span class="mono">MesurWidget.mount(element, { merchant, product })</span> after the script loads for single-page apps.</p>
            </div></details>
        </div>

        <div class="card pad-lg stack">
          <h2 class="h3">3. Widget appearance</h2>
          <div class="grid cols-2" style="align-items:start">
            <form class="stack" id="appearance" novalidate>
              <p class="notice bad hide" data-form-error role="alert"></p>
              ${field('Button text', `<input class="input" name="buttonText" maxlength="30" value="${esc(d.config.buttonText)}">`)}
              <div class="grid cols-2">
                ${field('Theme', `<select class="select" name="theme">${options([['dark', 'Dark'], ['light', 'Light']], d.config.theme)}</select>`)}
                ${field('Corner radius', `<input class="input" name="radius" type="number" min="0" max="24" value="${esc(d.config.radius)}">`)}
              </div>
              ${field('Accent colour (dark theme)', `<input class="input mono" name="accent" value="${esc(d.config.accent)}" pattern="#[0-9a-fA-F]{6}">`)}
              <label class="check"><input type="checkbox" name="showScore" ${d.config.showScore ? 'checked' : ''}> Show match score to shoppers</label>
              ${field('Allowed origins', `<textarea class="textarea mono" name="allowedOrigins" placeholder="https://shop.example.com">${esc(d.allowedOrigins.join('\n'))}</textarea>`, { hint: 'One per line. Leave empty to allow any website while testing.' })}
              ${field('Integration status', `<select class="select" name="integrationStatus">${options([['not_integrated', 'Not integrated'], ['sandbox', 'Testing'], ['live', 'Live']], d.integrationStatus)}</select>`)}
              <div><button class="btn btn-primary" type="submit">Save widget settings</button></div>
            </form>
            <div class="stack"><span class="label">Preview</span><div id="preview">${preview()}</div></div>
          </div>
        </div>

        <div class="card pad-lg stack">
          <div class="row between wrap-row"><h2 class="h3">4. Secret API key</h2><span class="tag warn">Server-side only</span></div>
          <p class="small muted">For calling the recommendation API from your own backend. Never put it in storefront code. We store only a hash, so the key is shown once.</p>
          <div id="secret">${d.hasSecretKey ? `<div class="keybox"><span>sk_••••••••••••••••••••${esc(d.secretLast4)}</span></div>` : '<p class="small faint">No secret key generated yet.</p>'}</div>
          <div><button class="btn btn-sm" data-secret>${d.hasSecretKey ? 'Regenerate secret key' : 'Generate secret key'}</button></div>
          <div class="code">${esc(apiExample())}</div>
        </div>
      </div>`;
  };

  await load(body, async () => {
    const [integration, prods] = await Promise.all([api.get('/api/merchant/integration'), api.get('/api/merchant/products')]);
    return { integration, prods };
  }, ({ integration, prods }) => {
    d = integration;
    productList = prods.products.filter((p) => p.isActive);
    product = productList[0]?.externalId ?? '';
    render();
  }, { skeletonHtml: skeleton(4, 160) });

  on(el, 'change', '#product', (e, s) => { product = s.value; $('#snippet', el).textContent = snippet(); });
  on(el, 'click', '[data-copy]', (e, b) => copyText(b.dataset.copy, 'Key copied'));
  on(el, 'click', '[data-copy-snippet]', () => copyText(snippet(), 'Snippet copied'));
  on(el, 'input', '#appearance', () => {
    const f = $('#appearance', el);
    const accent = /^#[0-9a-fA-F]{6}$/.test(f.elements.accent.value) ? f.elements.accent.value : d.config.accent;
    const radius = Math.min(24, Math.max(0, Number(f.elements.radius.value) || 0));
    const saved = d.config;
    d.config = { ...saved, buttonText: f.elements.buttonText.value || saved.buttonText, theme: f.elements.theme.value, radius, accent };
    $('#preview', el).innerHTML = preview();
    d.config = saved;
  });
  on(el, 'submit', '#appearance', async (e, form) => {
    e.preventDefault();
    const banner = $('[data-form-error]', form);
    banner.classList.add('hide');
    const btn = $('[type=submit]', form);
    btn.classList.add('loading');
    try {
      const f = form.elements;
      d = await api.patch('/api/merchant/integration', {
        config: { buttonText: f.buttonText.value, theme: f.theme.value, radius: Number(f.radius.value), accent: f.accent.value, showScore: f.showScore.checked },
        allowedOrigins: f.allowedOrigins.value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
        integrationStatus: f.integrationStatus.value,
      });
      toast('Widget settings saved');
      render();
    } catch (err) { banner.textContent = err.message; banner.classList.remove('hide'); btn.classList.remove('loading'); }
  });
  on(el, 'click', '[data-rotate-public]', async () => {
    if (!(await confirmDialog({ title: 'Regenerate the public key?', body: 'Every snippet already on your store stops working until you replace it with the new key.', confirmText: 'Regenerate', danger: true }))) return;
    try { d = await api.post('/api/merchant/integration/public-key'); toast('New public key created'); render(); } catch (err) { toastError(err); }
  });
  on(el, 'click', '[data-secret]', async () => {
    if (d.hasSecretKey && !(await confirmDialog({ title: 'Regenerate the secret key?', body: 'The current secret key stops working immediately. Update your servers with the new key.', confirmText: 'Regenerate', danger: true }))) return;
    try {
      d = await api.post('/api/merchant/integration/secret-key');
      const key = d.secretKey;
      render();
      $('#secret', el).innerHTML = `<div class="notice warn" style="margin-bottom:10px">Copy this key now. It will not be shown again.</div><div class="keybox"><span>${esc(key)}</span><button class="icon-btn" data-copy="${esc(key)}" aria-label="Copy secret key">${icon('copy')}</button></div>`;
    } catch (err) { toastError(err); }
  });
}

// ---------------------------------------------------------------------------
export function analyticsView(el, url, { brandColumn = false } = {}) {
  let days = 30;
  el.innerHTML = `<div class="row" style="margin-bottom:18px">${seg('days', [['7', '7 days'], ['30', '30 days'], ['90', '90 days']], '30')}</div><div id="a"></div>`;
  const box = $('#a', el);
  const draw = () => load(box, () => api.get(`${url}?days=${days}`), (a) => {
    const t = a.totals;
    box.innerHTML = `
      ${sampleNotice(a.sampleEvents)}
      <div class="grid cols-4">
        ${statCard('Widget impressions', fmtNum(t.impressions))}
        ${statCard('Recommendation requests', fmtNum(t.recommendations))}
        ${statCard('Recommendation rate', pct(t.conversionRate), 'Widget impressions → recommendation')}
        ${statCard('Size selected', fmtNum(t.sizeSelected))}
      </div>
      <div class="card pad-lg" style="margin-top:16px"><span class="label">Daily activity</span><div style="margin-top:18px">${t.impressions || t.recommendations ? dailyBars(a.series) : empty({ title: 'No activity in this period', body: 'Data appears as shoppers use the widget or the app.', mark: 'chart' })}</div></div>
      <div class="grid cols-2" style="margin-top:16px;align-items:start">
        <div class="card pad-lg stack"><span class="label">Most recommended sizes</span>${a.sizeDistribution.length ? hBars(a.sizeDistribution) : '<p class="small muted">No recommendations yet.</p>'}</div>
        <div class="card pad-lg stack"><span class="label">Recommendation outcomes</span>
          ${hBars([{ size: 'Fitted', count: t.recommendations - t.outOfRange - t.insufficient }, { size: 'Out of range', count: t.outOfRange }, { size: 'Missing data', count: t.insufficient }].map((r) => ({ ...r, count: Math.max(0, r.count) })))}
          <p class="small faint">“Out of range” means a shopper’s measurements were outside every size on your chart — a signal for extended sizing.</p></div>
      </div>
      ${brandColumn && a.brands ? `<div class="section-title"><h2 class="h3">By brand</h2></div>${a.brands.length ? `<div class="table-wrap"><table><thead><tr><th>Brand</th><th>Impressions</th><th>Recommendations</th></tr></thead><tbody>${a.brands.map((b) => `<tr><td>${esc(b.name)}</td><td class="num muted">${fmtNum(b.impressions)}</td><td class="num muted">${fmtNum(b.recommendations)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No activity.</p>'}` : ''}
      <div class="section-title"><h2 class="h3">Product activity</h2></div>
      ${a.products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th>${brandColumn ? '<th>Brand</th>' : ''}<th>Impressions</th><th>Recommendations</th><th>Size selected</th><th>Rate</th></tr></thead>
        <tbody>${a.products.map((p) => `<tr><td>${esc(p.name)}</td>${brandColumn ? `<td class="muted">${esc(p.brand)}</td>` : ''}<td class="num muted">${fmtNum(p.impressions)}</td><td class="num muted">${fmtNum(p.recommendations)}</td><td class="num muted">${fmtNum(p.sizeSelected)}</td><td class="num muted">${p.impressions ? `${Math.round((p.recommendations / p.impressions) * 1000) / 10}%` : '—'}</td></tr>`).join('')}</tbody></table></div>`
        : empty({ title: 'No product activity', body: 'Per-product numbers appear once the widget is used.', mark: 'box' })}
      <p class="small faint" style="margin-top:16px">Analytics are anonymous. They never include shopper identities or measurements.</p>`;
  }, { skeletonHtml: skeletonGrid(4, 110) });
  on(el, 'seg', '[data-seg=days]', (e) => { days = Number(e.detail.value); draw(); });
  draw();
}

export async function analyticsPage({ el }) {
  el.innerHTML = `${pageHead('Merchant', 'Analytics')}<div id="an"></div>`;
  analyticsView($('#an', el), '/api/merchant/analytics');
}

// ---------------------------------------------------------------------------
export async function settings({ el, state, refresh, navigate }) {
  const deleteWarning = 'Deleting your merchant account removes your brand, products, size charts, API keys and analytics. Installed widgets stop working.';
  await load(el, () => api.get('/api/merchant/overview'), ({ brand, merchant }) => {
    let logo = brand.logoUrl;
    el.innerHTML = `
      ${pageHead('Merchant', 'Settings')}
      <div class="stack" style="--gap:16px;max-width:800px">
        <div class="card pad-lg"><form class="stack" id="brand-form" novalidate>
          <div class="row between"><h2 class="h3">Brand profile</h2><span class="tag ${merchant.status === 'approved' ? 'ok' : 'warn'}">${esc(merchant.status)}</span></div>
          <p class="notice bad hide" data-form-error role="alert"></p>
          <div class="row" style="--gap:14px"><div id="logo">${monogram(brand)}</div>
            <label class="btn btn-sm" style="position:relative">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" id="logo-file" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
            ${brand.logoUrl ? '<button class="btn btn-sm" type="button" id="logo-clear">Remove</button>' : ''}</div>
          <div class="grid cols-2">
            ${field('Brand name', `<input class="input" name="name" value="${esc(brand.name)}" required>`)}
            ${field('Website', `<input class="input" name="website" value="${esc(brand.website ?? '')}" placeholder="https://">`, { optional: true })}
            ${field('Country', `<input class="input" name="country" value="${esc(brand.country ?? '')}">`, { optional: true })}
          </div>
          ${field('Description', `<textarea class="textarea" name="description" maxlength="600">${esc(brand.description ?? '')}</textarea>`, { optional: true, hint: 'Shown on your public brand page.' })}
          <div class="field"><span class="label">Product categories</span><div class="chips">${CATEGORIES.map((c) => `<label class="chip" style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" name="categories" data-multi value="${c.id}" ${brand.categories.includes(c.id) ? 'checked' : ''} style="accent-color:#fff">${esc(c.label)}</label>`).join('')}</div>
            <span class="hint">Updated automatically when you add products.</span></div>
          <div><button class="btn btn-primary" type="submit">Save brand</button></div>
        </form></div>
        ${accountSections({ user: state.user, deleteWarning })}
      </div>`;
    $('#logo-file', el).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { logo = await imageToDataUrl(f, 240); $('#logo', el).innerHTML = monogram({ ...brand, logoUrl: logo }); } catch (err) { toastError(err); }
    });
    $('#logo-clear', el)?.addEventListener('click', () => { logo = null; $('#logo', el).innerHTML = monogram({ ...brand, logoUrl: null }); });
    submitHandler($('#brand-form', el), async (v) => {
      await api.patch('/api/merchant/brand', { ...v, logoUrl: logo });
      await refresh();
      toast('Brand saved');
      navigate('/merchant/settings', { replace: true, force: true });
    });
    bindAccount(el, { refresh, navigate, deleteWarning });
  }, { skeletonHtml: skeleton(3, 200) });
  void sampleTag;
}
