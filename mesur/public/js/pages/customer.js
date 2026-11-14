import { api } from '../api.js';
import {
  $, $$, esc, on, load, empty, skeleton, skeletonGrid, seg, options, toast, toastError, confirmDialog, modal, timeAgo, monogram, sampleTag, icon, fmtNum,
} from '../ui.js';
import { figureSvg, setActiveZone } from '../figure.js';
import { brandCard, chartTable, pageHead, statCard, DEMO_NOTE } from '../components.js';
import { resultCard, resultDetails, confidenceTag, thinking } from '../result.js';
import { accountSections, bindAccount } from './account.js';
import {
  MEASUREMENTS, MEASUREMENT_KEYS, CATEGORIES, FITS, FIT_LABELS, categoryLabel, validateMeasurement, profileCompletion, categoryReadiness,
} from '/shared/measurements.js';
import { toCm, fromCm, formatLength } from '/shared/units.js';

const GROUP_LABEL = { tops: 'Tops', bottoms: 'Trousers & jeans', dresses: 'Dresses' };
const CORE = ['height', 'chest', 'waist', 'shoulder'];
const EXTRA = ['hip', 'arm', 'inseam', 'thigh', 'neck'];
const fitOptions = FITS.map((f) => [f, FIT_LABELS[f].replace(' fit', '')]);
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

function readinessList(readiness) {
  return readiness.map((r) => `
    <div class="row between" style="padding:10px 0;border-bottom:1px solid var(--border)">
      <span>${GROUP_LABEL[r.group]}</span>
      ${r.ready
        ? `<span class="row" style="--gap:8px">${r.missingHelpful.length ? `<span class="small muted">add ${r.missingHelpful.map((k) => MEASUREMENTS[k].label.toLowerCase()).join(', ')} to refine</span>` : ''}<span class="tag ok">Ready</span></span>`
        : `<a class="tag warn" href="/app/profile?focus=${r.missingRequired[0]}">Needs ${r.missingRequired.map((k) => MEASUREMENTS[k].label.toLowerCase()).join(', ')}</a>`}
    </div>`).join('');
}

function brandResultCard(item) {
  const r = item.result;
  const body = !r
    ? `<div class="size faint" style="font-size:34px">—</div><p class="small muted">${item.chart ? 'Create your profile to see a size.' : 'No chart for this category.'}</p>`
    : r.status === 'ok'
      ? `<div class="size">${esc(r.size)}</div><div class="row wrap-row" style="--gap:8px"><span class="small num muted">${r.matchScore}% match</span>${confidenceTag(r.confidence.level)}</div>`
      : `<div class="size faint" style="font-size:34px">—</div><p class="small muted">${r.status === 'insufficient_data' ? `Needs ${r.missing.map((k) => MEASUREMENTS[k].label.toLowerCase()).join(', ')}` : r.status === 'out_of_range' ? 'Outside this size range' : 'No chart available'}</p>`;
  return `
    <button class="card hover brand-size" data-brand="${esc(item.brand.slug)}" style="text-align:left;font:inherit;color:inherit" ${item.result ? '' : 'disabled'}>
      <div class="row between"><span class="label" style="color:#fff">${esc(item.brand.name)}</span>${item.brand.isDemo ? sampleTag('Sample') : ''}</div>
      <div class="stack" style="--gap:8px"><span class="label">Recommended size</span>${body}</div>
    </button>`;
}

function openResult(item, unit) {
  modal({
    title: `${item.brand.name} · ${item.chart?.name ?? ''}`,
    wide: true,
    body: `<div class="stack">${resultCard(item.result, { unit })}${resultDetails(item.result, { unit })}${item.brand.isDemo ? `<p class="small faint">${DEMO_NOTE}</p>` : ''}</div>`,
  });
}

function historyTable(history) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>Product</th><th>Brand</th><th>Size</th><th>Match</th><th>Fit</th><th>When</th></tr></thead>
    <tbody>${history.map((h) => `<tr>
      <td>${h.productId ? `<a class="link" href="/app/recommendations?brand=${esc(h.brandSlug)}&product=${esc(h.productId)}">${esc(h.productName)}</a>` : esc(h.productName ?? '—')} ${h.isSample ? sampleTag('Sample') : ''}</td>
      <td class="muted">${esc(h.brandName)}</td>
      <td><b>${h.size ? esc(h.size) : '<span class="faint">—</span>'}</b></td>
      <td class="num muted">${h.matchScore !== null ? `${h.matchScore}%` : esc(h.status.replace(/_/g, ' '))}</td>
      <td class="muted">${esc(FIT_LABELS[h.fitPreference]?.replace(' fit', '') ?? '')}</td>
      <td class="muted small">${esc(timeAgo(h.createdAt))} · ${h.source === 'widget' ? 'store widget' : 'app'}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
export async function dashboard({ el, state }) {
  const user = state.user;
  const unit = user.preferredUnit;
  await load(el, async () => {
    const [profile, recs, history, stats] = await Promise.all([
      api.get('/api/me/measurements'), api.get('/api/me/recommendations/brands?category=tshirts'),
      api.get('/api/me/recommendations/history'), api.get('/api/me/stats'),
    ]);
    return { profile, recs, history: history.history, stats };
  }, ({ profile, recs, history, stats }) => {
    const m = profile.measurements;
    el.innerHTML = `
      ${pageHead('Dashboard', `${greeting()}, ${user.name.split(' ')[0]}.`, '', m ? 'Your universal size profile is ready.' : 'Let’s set up your universal size profile.')}
      ${!m ? `<div class="card light pad-lg row between wrap-row" style="--gap:20px">
          <div class="stack" style="--gap:6px"><h2 class="h2">Two measurements to start.</h2><p class="muted">Height and chest unlock recommendations for tops at every brand.</p></div>
          <a class="btn btn-lg" style="background:#000;color:#fff;border-color:#000" href="/app/profile">Create my profile</a></div>` : ''}

      <div class="grid cols-2" style="align-items:stretch;margin-top:${m ? 0 : 16}px">
        <div class="card pad-lg stack" style="--gap:18px">
          <div class="row between"><span class="label">Body profile</span><a class="btn btn-sm" href="/app/profile">${m ? 'Edit profile' : 'Create profile'}</a></div>
          <div class="grid cols-2 keep" style="--gap:18px">
            ${CORE.map((k) => `<div class="stat"><span class="label">${MEASUREMENTS[k].label}</span><b style="font-size:28px">${m?.[k] != null ? esc(formatLength(m[k], unit)) : '<span class="faint">—</span>'}</b></div>`).join('')}
          </div>
          ${m ? `<p class="small faint">Updated ${esc(timeAgo(m.updatedAt))} · preferred fit: ${esc(FIT_LABELS[user.fitPreference].toLowerCase())}</p>` : ''}
        </div>
        <div class="card pad-lg stack" style="--gap:14px">
          <div class="row between"><span class="label">Profile completeness</span><b class="num">${profile.completion}%</b></div>
          <div class="progress" role="progressbar" aria-valuenow="${profile.completion}" aria-valuemin="0" aria-valuemax="100"><i style="width:${profile.completion}%"></i></div>
          <div>${readinessList(profile.readiness)}</div>
        </div>
      </div>

      <div class="section-title"><h2 class="h3">Your size by brand <span class="small muted" style="font-weight:400">· T-shirts</span></h2><a class="link small" href="/app/recommendations">All categories</a></div>
      ${recs.results.length ? `<div class="grid cols-auto" id="brand-recs">${recs.results.map(brandResultCard).join('')}</div>`
        : empty({ title: 'No brands available yet', body: 'Recommendations appear here once brands publish their size charts.', mark: 'grid' })}

      <div class="section-title"><h2 class="h3">Recent recommendations</h2>${stats.total ? `<span class="small muted">${fmtNum(stats.total)} received${stats.sampleCount ? ` · ${stats.sampleCount} sample` : ''}</span>` : ''}</div>
      ${history.length ? historyTable(history.slice(0, 6))
        : empty({ title: 'Nothing viewed yet', body: 'Products you check in the app or through a store’s “Find My Size” button are listed here.', action: '<a class="btn btn-sm" href="/app/recommendations">Find a product size</a>' })}

      <div class="grid cols-2" style="margin-top:38px;align-items:start">
        <div class="stack" style="--gap:14px"><h2 class="h3">Quick actions</h2>
          <div class="grid cols-2" style="--gap:10px">
            ${[['/app/profile', 'Update measurements', 'ruler'], ['/app/brands', 'Explore brands', 'grid'], ['/app/recommendations', 'View recommendations', 'spark'], ['/app/settings', 'Manage account', 'cog']]
              .map(([href, label, ic]) => `<a class="card hover row" style="--gap:12px;padding:16px" href="${href}">${icon(ic)}<span class="small">${label}</span></a>`).join('')}
          </div></div>
        <div class="stack" style="--gap:14px"><h2 class="h3">Most recommended brands</h2>
          ${stats.topBrands.length ? `<div class="card">${stats.topBrands.map((b) => `<div class="row between" style="padding:8px 0"><span>${esc(b.name)}</span><span class="num muted">${b.count}</span></div>`).join('')}</div>`
            : '<p class="small muted">Appears after your first product recommendation.</p>'}
        </div>
      </div>`;
    on(el, 'click', '[data-brand]', (e, btn) => {
      const item = recs.results.find((x) => x.brand.slug === btn.dataset.brand);
      if (item?.result) openResult(item, unit);
    });
  }, { skeletonHtml: `${skeleton(1, 90)}<div style="height:16px"></div>${skeletonGrid(4, 170)}` });
}

// ---------------------------------------------------------------------------
export async function profile({ el, state, query, refresh, navigate }) {
  let user = state.user;
  const draftKey = `mesur:profile-draft:${user.id}`;
  let saved = null;
  let unit = user.preferredUnit;
  let fit = user.fitPreference;
  let values = {}; // display-unit strings keyed by measurement
  let restored = false;

  const fromSaved = () => Object.fromEntries(MEASUREMENT_KEYS.map((k) => [k, saved?.[k] != null ? String(fromCm(saved[k], unit)) : '']));
  const asCm = () => Object.fromEntries(MEASUREMENT_KEYS.map((k) => [k, toCm(values[k], unit)]));
  const dirty = () => {
    const base = fromSaved();
    return fit !== user.fitPreference || unit !== user.preferredUnit || MEASUREMENT_KEYS.some((k) => String(values[k] ?? '').trim() !== base[k]);
  };
  const storeDraft = () => {
    try { if (dirty()) sessionStorage.setItem(draftKey, JSON.stringify({ unit, fit, values })); else sessionStorage.removeItem(draftKey); } catch { /* storage unavailable */ }
  };

  const card = (k) => {
    const def = MEASUREMENTS[k];
    return `
      <div class="m-card" data-card="${k}">
        <label for="m-${k}" class="stack" style="--gap:2px;cursor:pointer"><span style="font-weight:500">${def.label}</span><span class="label">${def.required ? 'Required' : 'Optional'}</span></label>
        <div class="m-input"><input id="m-${k}" name="${k}" inputmode="decimal" autocomplete="off" placeholder="—" value="${esc(values[k] ?? '')}" aria-describedby="h-${k}"><span class="label" data-unit>${unit}</span></div>
        <div class="m-help" id="h-${k}"><span data-help>${esc(def.help)}</span></div>
      </div>`;
  };

  const draw = () => {
    el.innerHTML = `
      ${pageHead('Size profile', saved ? 'Your universal size profile' : 'Let’s create your universal size profile.', '', 'Enter your measurements once. Get personalised size recommendations across brands.')}
      ${restored ? '<p class="notice" style="margin-bottom:16px">We restored the changes you had not saved yet.</p>' : ''}
      <div class="profile-grid">
        <div class="card figure-card">
          <div class="row between"><span class="label" id="zone-label">Select a field</span><span class="label num" id="completion-label"></span></div>
          ${figureSvg({ show: CORE })}
          <div class="progress"><i id="completion-bar" style="width:0%"></i></div>
        </div>
        <form class="stack" id="profile-form" novalidate style="--gap:22px">
          <div class="row between wrap-row">
            <div class="stack" style="--gap:8px"><span class="label">Units</span>${seg('unit', [['cm', 'Centimetres'], ['in', 'Inches']], unit)}</div>
            <div class="stack" style="--gap:8px"><span class="label">Preferred fit</span>${seg('fit', fitOptions, fit)}</div>
          </div>
          <div class="stack" style="--gap:10px"><span class="label">Core measurements</span>${CORE.map(card).join('')}</div>
          <details ${EXTRA.some((k) => values[k]) || EXTRA.includes(query.get('focus')) ? 'open' : ''}>
            <summary class="row between" style="cursor:pointer;padding:6px 0"><span class="label">Additional measurements — for trousers, jeans, dresses and shirts</span><span class="small muted">Show / hide</span></summary>
            <div class="stack" style="--gap:10px;margin-top:12px">${EXTRA.map(card).join('')}</div>
          </details>
          <div class="card stack" style="--gap:4px"><span class="label" style="margin-bottom:6px">What your profile covers</span><div id="readiness"></div></div>
          <div class="row wrap-row between">
            <div class="row wrap-row"><button class="btn btn-primary btn-lg" type="submit">${saved ? 'Save changes' : 'Save profile'}</button>
              ${saved ? '<button class="btn btn-lg" type="button" id="revert">Discard changes</button>' : ''}</div>
            ${saved ? '<button class="btn btn-danger" type="button" id="delete-profile">Delete profile</button>' : ''}
          </div>
          <p class="small faint">Measure over light clothing with the tape snug, not tight. Your measurements are private: brands never receive them.</p>
        </form>
      </div>`;
    updateMeta();
    const focus = query.get('focus');
    if (focus && MEASUREMENTS[focus]) requestAnimationFrame(() => $(`#m-${focus}`, el)?.focus());
  };

  const updateMeta = () => {
    const cm = asCm();
    const pct = profileCompletion(cm);
    $('#completion-label', el).textContent = `${pct}% complete`;
    $('#completion-bar', el).style.width = `${pct}%`;
    $('#readiness', el).innerHTML = readinessList(categoryReadiness(cm)).replace(/<a class="tag warn" href="[^"]*">/g, '<span class="tag warn">').replace(/<\/a>/g, '</span>');
    const revert = $('#revert', el);
    if (revert) revert.disabled = !dirty();
  };

  const validate = () => {
    const cm = asCm();
    let firstBad = null;
    for (const k of MEASUREMENT_KEYS) {
      const raw = String(values[k] ?? '').trim();
      let error = raw !== '' && cm[k] === null ? `${MEASUREMENTS[k].label} must be a number.` : validateMeasurement(k, cm[k]);
      if (error && unit === 'in' && cm[k] !== null) {
        const d = MEASUREMENTS[k];
        error = `${d.label} should be between ${fromCm(d.min, 'in')} and ${fromCm(d.max, 'in')} in.`;
      }
      const cardEl = $(`[data-card=${k}]`, el);
      cardEl.classList.toggle('has-error', Boolean(error));
      $('[data-help]', cardEl).innerHTML = error ? `<span class="error">${esc(error)}</span>` : esc(MEASUREMENTS[k].help);
      $('input', cardEl).setAttribute('aria-invalid', String(Boolean(error)));
      if (error && !firstBad) firstBad = cardEl;
    }
    if (firstBad) {
      const details = firstBad.closest('details');
      if (details) details.open = true;
      $('input', firstBad).focus();
    }
    return firstBad ? null : cm;
  };

  await load(el, () => api.get('/api/me/measurements'), (data) => {
    saved = data.measurements;
    values = fromSaved();
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
      if (draft?.values) { ({ unit, fit, values } = { unit: draft.unit ?? unit, fit: draft.fit ?? fit, values: draft.values }); restored = true; }
    } catch { /* ignore a corrupt draft */ }
    draw();
  }, { skeletonHtml: `<div class="profile-grid"><div class="skeleton" style="height:480px"></div>${skeleton(5, 78)}</div>` });

  on(el, 'focusin', '.m-card input', (e, input) => {
    setActiveZone(el, input.name, CORE);
    $('#zone-label', el).textContent = MEASUREMENTS[input.name].label;
  });
  on(el, 'input', '.m-card input', (e, input) => {
    values[input.name] = input.value.replace(',', '.');
    storeDraft();
    updateMeta();
  });
  on(el, 'seg', '[data-seg=unit]', (e) => {
    const next = e.detail.value;
    if (next === unit) return;
    // Convert what is on screen, so nothing typed is lost.
    for (const k of MEASUREMENT_KEYS) {
      const cm = toCm(values[k], unit);
      values[k] = cm === null ? (values[k] ?? '') : String(fromCm(cm, next));
    }
    unit = next;
    $$('.m-card', el).forEach((c) => { $('input', c).value = values[$('input', c).name] ?? ''; $('[data-unit]', c).textContent = unit; });
    storeDraft(); updateMeta();
  });
  on(el, 'seg', '[data-seg=fit]', (e) => { fit = e.detail.value; storeDraft(); updateMeta(); });

  on(el, 'submit', '#profile-form', async (e) => {
    e.preventDefault();
    const cm = validate();
    if (!cm) { toast('Check the highlighted measurements', 'bad'); return; }
    const btn = $('#profile-form [type=submit]', el);
    btn.classList.add('loading');
    try {
      const first = !saved;
      const res = await api.put('/api/me/measurements', { measurements: cm, preferredUnit: unit, fitPreference: fit });
      saved = res.measurements;
      sessionStorage.removeItem(draftKey);
      await refresh();
      user = state.user;
      toast(first ? 'Profile created' : 'Profile saved');
      if (first) return navigate('/app', { force: true });
      restored = false; values = fromSaved(); draw();
    } catch (err) {
      if (err.fields) for (const [k, msg] of Object.entries(err.fields)) { const c = $(`[data-card=${k}]`, el); if (c) { c.classList.add('has-error'); $('[data-help]', c).innerHTML = `<span class="error">${esc(msg)}</span>`; } }
      toastError(err);
    } finally { btn.classList.remove('loading'); }
  });
  on(el, 'click', '#revert', () => {
    sessionStorage.removeItem(draftKey);
    unit = user.preferredUnit; fit = user.fitPreference; values = fromSaved(); restored = false;
    draw();
  });
  on(el, 'click', '#delete-profile', async () => {
    if (!(await confirmDialog({ title: 'Delete your size profile?', body: 'All of your saved measurements will be removed and recommendations will stop until you create a new profile. Your account stays active.', confirmText: 'Delete profile', danger: true }))) return;
    try {
      await api.del('/api/me/measurements');
      sessionStorage.removeItem(draftKey);
      saved = null; values = fromSaved(); restored = false;
      toast('Profile deleted');
      draw();
    } catch (err) { toastError(err); }
  });
}

// ---------------------------------------------------------------------------
export async function recommendations({ el, state, query }) {
  const user = state.user;
  const unit = user.preferredUnit;
  let category = 'tshirts';
  let fit = user.fitPreference;
  let brandResults = [];
  let catalogue = [];

  el.innerHTML = `
    ${pageHead('Recommendations', 'Your size, brand by brand', '', 'Every result is calculated from your saved profile and that brand’s own size chart.')}
    <div id="no-profile"></div>
    <div class="row wrap-row between" style="--gap:14px;margin-bottom:16px">
      <label class="field" style="min-width:200px"><span class="label">Category</span><select class="select" id="category">${options(CATEGORIES, category)}</select></label>
      <div class="stack" style="--gap:7px"><span class="label">Fit preference</span>${seg('fit', fitOptions, fit)}</div>
    </div>
    <div id="brand-grid"></div>

    <div class="section-title"><h2 class="h3">Check a specific product</h2></div>
    <div class="card pad-lg stack">
      <div class="grid cols-3" style="align-items:end">
        <label class="field"><span class="label">Brand</span><select class="select" id="p-brand"><option value="">Loading…</option></select></label>
        <label class="field"><span class="label">Product</span><select class="select" id="p-product" disabled><option value="">Choose a brand first</option></select></label>
        <button class="btn btn-primary" id="p-go" disabled style="height:44px">Find my size</button>
      </div>
      <div id="p-result"></div>
    </div>

    <div class="section-title"><h2 class="h3">History</h2><button class="btn btn-sm hide" id="clear-history">Clear history</button></div>
    <div id="history"></div>`;

  const grid = $('#brand-grid', el);
  const loadBrands = () => load(grid, () => api.get(`/api/me/recommendations/brands?category=${category}&fit=${fit}`), (data) => {
    brandResults = data.results;
    $('#no-profile', el).innerHTML = data.hasProfile ? '' : `<div class="card light row between wrap-row" style="margin-bottom:18px"><p><b>No size profile yet.</b> Add your height and chest to see recommendations.</p><a class="btn btn-sm" style="background:#000;color:#fff;border-color:#000" href="/app/profile">Create profile</a></div>`;
    const withChart = data.results.filter((r) => r.chart);
    grid.innerHTML = !data.results.length
      ? empty({ title: 'No brands available yet', body: 'Recommendations appear here once brands publish their size charts.', mark: 'grid' })
      : !withChart.length
        ? empty({ title: `No ${categoryLabel(category).toLowerCase()} charts yet`, body: 'None of the brands has published a size chart for this category. Try another category.', mark: 'table' })
        : `<div class="grid cols-auto">${withChart.map(brandResultCard).join('')}</div>`;
  }, { skeletonHtml: skeletonGrid(5, 170) });

  const historyBox = $('#history', el);
  const loadHistory = () => load(historyBox, () => api.get('/api/me/recommendations/history'), ({ history }) => {
    $('#clear-history', el).classList.toggle('hide', !history.length);
    historyBox.innerHTML = history.length ? historyTable(history)
      : empty({ title: 'No history yet', body: 'Product recommendations you request are saved here so you can find them again.' });
  }, { skeletonHtml: skeleton(2, 52) });

  const brandSel = $('#p-brand', el);
  const productSel = $('#p-product', el);
  const go = $('#p-go', el);
  const fillProducts = async (slug, preselect) => {
    productSel.disabled = true; go.disabled = true;
    if (!slug) { productSel.innerHTML = '<option value="">Choose a brand first</option>'; return; }
    productSel.innerHTML = '<option value="">Loading…</option>';
    try {
      const { products } = await api.get(`/api/public/brands/${encodeURIComponent(slug)}`);
      productSel.innerHTML = products.length
        ? `<option value="">Choose a product</option>${products.map((p) => `<option value="${esc(p.id)}" ${p.id === preselect ? 'selected' : ''}>${esc(p.name)} · ${esc(categoryLabel(p.category))}</option>`).join('')}`
        : '<option value="">This brand has no products yet</option>';
      productSel.disabled = !products.length;
      go.disabled = !productSel.value;
    } catch (err) { productSel.innerHTML = '<option value="">Could not load products</option>'; toastError(err); }
  };
  const run = async () => {
    const box = $('#p-result', el);
    box.innerHTML = thinking();
    go.disabled = true;
    try {
      const [res] = await Promise.all([api.post('/api/me/recommendations', { productId: productSel.value, fitPreference: fit }), new Promise((r) => setTimeout(r, 650))]);
      box.innerHTML = `<div class="stack" style="margin-top:6px">
        <div class="row wrap-row" style="--gap:10px">${monogram(res.brand)}<div><b>${esc(res.product.name)}</b><div class="small muted">${esc(res.brand.name)} · ${esc(categoryLabel(res.product.category))} · cut: ${esc(FIT_LABELS[res.product.fitType].toLowerCase())}${res.result.chart ? ` · ${res.result.chart.source === 'product' ? 'product-specific chart' : 'brand chart'}` : ''}</div></div></div>
        ${resultCard(res.result, { unit })}${resultDetails(res.result, { unit })}
        ${res.brand.isDemo ? `<p class="small faint">${DEMO_NOTE}</p>` : ''}</div>`;
      loadHistory();
    } catch (err) {
      box.innerHTML = err.code === 'no_profile'
        ? empty({ title: 'Create your size profile first', body: 'We need at least your height and chest to recommend a size.', action: '<a class="btn btn-primary btn-sm" href="/app/profile">Create profile</a>' })
        : `<p class="notice bad" role="alert">${esc(err.message)}</p>`;
    } finally { go.disabled = !productSel.value; }
  };

  $('#category', el).addEventListener('change', (e) => { category = e.target.value; loadBrands(); });
  on(el, 'seg', '[data-seg=fit]', (e) => { fit = e.detail.value; loadBrands(); if (productSel.value && $('#p-result', el).children.length) run(); });
  on(el, 'click', '[data-brand]', (e, btn) => { const item = brandResults.find((x) => x.brand.slug === btn.dataset.brand); if (item?.result) openResult(item, unit); });
  brandSel.addEventListener('change', () => { $('#p-result', el).innerHTML = ''; fillProducts(brandSel.value); });
  productSel.addEventListener('change', () => { go.disabled = !productSel.value; });
  go.addEventListener('click', run);
  $('#clear-history', el).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Clear recommendation history?', body: 'This removes the list of products you have checked. Your size profile is not affected.', confirmText: 'Clear history', danger: true }))) return;
    try { await api.del('/api/me/recommendations/history'); toast('History cleared'); loadHistory(); } catch (err) { toastError(err); }
  });

  loadBrands();
  loadHistory();
  try {
    catalogue = (await api.get('/api/public/brands')).brands.filter((b) => b.productCount > 0);
    brandSel.innerHTML = catalogue.length ? `<option value="">Choose a brand</option>${options(catalogue.map((b) => [b.slug, b.name]), query.get('brand'))}` : '<option value="">No brands with products yet</option>';
    if (query.get('brand') && catalogue.some((b) => b.slug === query.get('brand'))) {
      await fillProducts(query.get('brand'), query.get('product'));
      if (productSel.value) { await run(); $('#p-result', el).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  } catch (err) { brandSel.innerHTML = '<option value="">Could not load brands</option>'; toastError(err); }
}

// ---------------------------------------------------------------------------
export async function brands({ el, state }) {
  el.innerHTML = `${pageHead('Brands', 'Explore supported brands', '', 'Open a brand to see its size charts and check individual products.')}
    ${state.mode === 'demo' ? `<p class="notice warn" style="margin-bottom:18px">${DEMO_NOTE}</p>` : ''}<div id="list"></div>`;
  const list = $('#list', el);
  await load(list, () => api.get('/api/public/brands'), ({ brands: items }) => {
    list.innerHTML = items.length ? `<div class="grid cols-auto">${items.map((b) => brandCard(b, `/app/brands/${b.slug}`)).join('')}</div>`
      : empty({ title: 'No brands available', body: 'There are no participating brands yet. Check back soon.', mark: 'grid' });
  }, { skeletonHtml: skeletonGrid(6, 190) });
}

export async function brandDetail({ el, params }) {
  await load(el, () => api.get(`/api/public/brands/${encodeURIComponent(params.slug)}`), ({ brand, charts, products }) => {
    document.title = `${brand.name} — Mesur`;
    el.innerHTML = `
      <a class="small muted" href="/app/brands">← All brands</a>
      <div class="row wrap-row" style="--gap:16px;margin:18px 0 10px">${monogram(brand)}<h1 class="h1" style="font-size:40px">${esc(brand.name)}</h1>${brand.isDemo ? sampleTag() : ''}</div>
      <p class="muted" style="max-width:70ch">${esc(brand.description ?? '')}</p>
      <div class="section-title"><h2 class="h3">Products</h2></div>
      ${products.length ? `<div class="grid cols-auto">${products.map((p) => `
        <div class="card stack" style="--gap:14px">
          ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" style="border-radius:10px;aspect-ratio:4/3;object-fit:cover;width:100%">` : ''}
          <div class="stack" style="--gap:4px"><b>${esc(p.name)}</b><span class="small muted">${esc(categoryLabel(p.category))} · ${esc(FIT_LABELS[p.fitType])}</span></div>
          <a class="btn btn-sm" href="/app/recommendations?brand=${esc(brand.slug)}&product=${esc(p.id)}">Find my size</a>
        </div>`).join('')}</div>` : empty({ title: 'No products listed', body: 'This brand has size charts but has not added individual products yet.', mark: 'box' })}
      <div class="section-title"><h2 class="h3">Size charts</h2></div>
      <div class="stack" style="--gap:30px">${charts.length ? charts.map(chartTable).join('') : empty({ title: 'No size charts published', body: 'This brand has not added size charts yet.', mark: 'table' })}</div>
      ${brand.isDemo ? `<p class="small faint" style="margin-top:20px">${DEMO_NOTE}</p>` : ''}`;
  });
}

// ---------------------------------------------------------------------------
export async function settings({ el, state, refresh, navigate }) {
  const user = state.user;
  const deleteWarning = 'Deleting your account removes your size profile, your recommendation history and your login.';
  el.innerHTML = `
    ${pageHead('Settings', 'Account settings')}
    <div class="stack" style="--gap:16px;max-width:760px">
      <div class="card pad-lg stack">
        <h2 class="h3">Preferences</h2>
        <div class="row wrap-row" style="--gap:28px">
          <div class="stack" style="--gap:8px"><span class="label">Measurement unit</span>${seg('unit', [['cm', 'Centimetres'], ['in', 'Inches']], user.preferredUnit)}</div>
          <div class="stack" style="--gap:8px"><span class="label">Default fit preference</span>${seg('fit', fitOptions, user.fitPreference)}</div>
        </div>
        <p class="small muted">Changes are saved immediately and apply everywhere, including store widgets.</p>
      </div>
      ${accountSections({ user, deleteWarning })}
    </div>`;
  const savePref = async (patch) => {
    try { await api.patch('/api/account', patch); await refresh(); toast('Preference saved'); } catch (err) { toastError(err); }
  };
  on(el, 'seg', '[data-seg=unit]', (e) => savePref({ preferredUnit: e.detail.value }));
  on(el, 'seg', '[data-seg=fit]', (e) => savePref({ fitPreference: e.detail.value }));
  bindAccount(el, { refresh, navigate, deleteWarning });
}
