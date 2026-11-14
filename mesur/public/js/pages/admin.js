import { api } from '../api.js';
import {
  $, esc, on, load, empty, skeleton, skeletonGrid, seg, field, options, toast, toastError, confirmDialog, modal, submitHandler,
  fmtNum, timeAgo, fmtDate, sampleTag, monogram, icon,
} from '../ui.js';
import { pageHead, statCard, DEMO_NOTE } from '../components.js';
import { chartManager } from '../chart-editor.js';
import { analyticsView } from './merchant.js';
import { CATEGORIES, categoryLabel } from '/shared/measurements.js';

const STATUS_TAG = { approved: 'ok', active: 'ok', pending: 'warn', suspended: 'bad' };
const statusTag = (s) => `<span class="tag ${STATUS_TAG[s] ?? ''}">${esc(s)}</span>`;
const eventRow = (e) => `<tr><td class="small muted">${esc(timeAgo(e.createdAt))}</td><td>${esc(e.brand)}</td><td class="muted">${esc(e.product ?? '—')}</td>
  <td>${e.size ? `<b>${esc(e.size)}</b>` : `<span class="small muted">${esc((e.status ?? '').replace(/_/g, ' '))}</span>`}</td><td class="small muted">${esc(e.source)}${e.isSample ? ` ${sampleTag('Sample')}` : ''}</td></tr>`;

// ---------------------------------------------------------------------------
export async function overview({ el }) {
  el.innerHTML = `${pageHead('Administration', 'Platform overview')}<div id="o"></div>
    <div class="section-title"><h2 class="h3">Merchants</h2></div><div id="m"></div>
    <div class="section-title"><h2 class="h3">Platform configuration</h2></div><div id="c"></div>`;
  const o = $('#o', el);
  load(o, () => api.get('/api/admin/overview'), ({ totals: t, recentEvents }) => {
    o.innerHTML = `
      ${t.sampleEvents ? `<p class="notice warn" style="margin-bottom:16px">${fmtNum(t.sampleEvents)} analytics events and ${fmtNum(t.sampleUsers)} accounts are labelled demonstration data.</p>` : ''}
      <div class="grid cols-4">
        ${statCard('Registered customers', fmtNum(t.customers), `${fmtNum(t.customersWithProfile)} with a size profile`)}
        ${statCard('Merchants', fmtNum(t.merchants), t.pendingMerchants ? `${t.pendingMerchants} awaiting approval` : 'None pending')}
        ${statCard('Products', fmtNum(t.products), `${fmtNum(t.brands)} brands · ${fmtNum(t.charts)} charts`)}
        ${statCard('Recommendation requests', fmtNum(t.recommendationRequests), 'All time')}
      </div>
      <div class="section-title"><h2 class="h3">Recent recommendation requests</h2><a class="link small" href="/admin/analytics">Analytics</a></div>
      ${recentEvents.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Brand</th><th>Product</th><th>Result</th><th>Source</th></tr></thead><tbody>${recentEvents.slice(0, 10).map(eventRow).join('')}</tbody></table></div>`
        : empty({ title: 'No requests yet', body: 'Recommendation requests from the app, widget and API appear here.' })}`;
  }, { skeletonHtml: skeletonGrid(4, 110) });

  const m = $('#m', el);
  const merchants = () => load(m, () => api.get('/api/admin/merchants'), ({ merchants: list }) => {
    m.innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Merchant</th><th>Owner</th><th>Catalogue</th><th>Joined</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((x) => `<tr>
        <td><b>${esc(x.companyName)}</b><div class="small muted">${esc(x.website ?? '')}</div></td>
        <td class="small">${esc(x.ownerName)}<div class="muted">${esc(x.ownerEmail)}</div></td>
        <td class="small muted">${x.products} products · ${x.charts} charts</td>
        <td class="small muted">${esc(fmtDate(x.createdAt))}</td>
        <td>${statusTag(x.status)}</td>
        <td class="actions">${x.status !== 'approved' ? `<button class="btn btn-sm" data-merchant="${esc(x.id)}" data-status="approved">Approve</button>` : ''}
          ${x.status !== 'suspended' ? `<button class="btn btn-sm btn-danger" data-merchant="${esc(x.id)}" data-status="suspended" data-name="${esc(x.companyName)}">Suspend</button>` : ''}
          ${x.brandId ? `<a class="btn btn-sm" href="/admin/brands/${esc(x.brandId)}">Brand</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : empty({ title: 'No merchants yet', body: 'Brands that register appear here for approval.', mark: 'users' });
  }, { skeletonHtml: skeleton(2, 58) });
  merchants();
  on(m, 'click', '[data-merchant]', async (e, b) => {
    if (b.dataset.status === 'suspended' && !(await confirmDialog({ title: `Suspend ${b.dataset.name}?`, body: 'Their dashboard is locked, their brand is hidden from shoppers and their widget stops responding until you approve them again.', confirmText: 'Suspend merchant', danger: true }))) return;
    try { await api.patch(`/api/admin/merchants/${b.dataset.merchant}`, { status: b.dataset.status }); toast(`Merchant ${b.dataset.status}`); merchants(); } catch (err) { toastError(err); }
  });

  const c = $('#c', el);
  load(c, () => api.get('/api/admin/config'), ({ config, engineDefaults }) => {
    c.innerHTML = `<div class="card pad-lg"><form class="stack" id="config" novalidate>
      <p class="notice bad hide" data-form-error role="alert"></p>
      <label class="check"><input type="checkbox" name="allow_merchant_signup" ${config.allow_merchant_signup ? 'checked' : ''}> Allow new merchants to register</label>
      <label class="check"><input type="checkbox" name="require_merchant_approval" ${config.require_merchant_approval ? 'checked' : ''}> New merchants need approval before going live</label>
      <div style="max-width:320px">${field('Minimum match score', `<input class="input" name="min_match_score" type="number" step="0.05" min="0.3" max="0.95" value="${esc(config.min_match_score)}">`, { hint: 'Below this score the engine says the measurements are outside the size range instead of recommending a size.' })}</div>
      <details><summary class="label" style="cursor:pointer">Engine weights and tolerances (read-only)</summary><div class="code" style="margin-top:12px">${esc(JSON.stringify({ weights: engineDefaults.weights, tolerances: engineDefaults.tolerances }, null, 2))}</div></details>
      <div><button class="btn btn-primary" type="submit">Save configuration</button></div>
    </form></div>`;
    submitHandler($('#config', c), async (v) => {
      await api.put('/api/admin/config', { ...v, min_match_score: Number(v.min_match_score) });
      toast('Configuration saved');
    });
  }, { skeletonHtml: skeleton(1, 200) });
}

// ---------------------------------------------------------------------------
function brandForm(brand = null) {
  return `<form class="stack" id="brand-form" novalidate>
    <p class="notice bad hide" data-form-error role="alert"></p>
    <div class="grid cols-2">
      ${field('Brand name', `<input class="input" name="name" value="${esc(brand?.name ?? '')}" required>`)}
      ${field('Website', `<input class="input" name="website" value="${esc(brand?.website ?? '')}" placeholder="https://">`, { optional: true })}
      ${field('Country', `<input class="input" name="country" value="${esc(brand?.country ?? '')}">`, { optional: true })}
      ${field('Integration status', `<select class="select" name="integrationStatus">${options([['not_integrated', 'Not integrated'], ['sandbox', 'Testing'], ['live', 'Live']], brand?.integrationStatus ?? 'not_integrated')}</select>`)}
    </div>
    ${field('Description', `<textarea class="textarea" name="description" maxlength="600">${esc(brand?.description ?? '')}</textarea>`, { optional: true })}
    <div class="field"><span class="label">Product categories</span><div class="chips">${CATEGORIES.map((c) => `<label class="chip" style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" name="categories" data-multi value="${c.id}" ${brand?.categories.includes(c.id) ? 'checked' : ''} style="accent-color:#fff">${esc(c.label)}</label>`).join('')}</div></div>
    <div class="row wrap-row" style="--gap:22px">
      <label class="check"><input type="checkbox" name="isActive" ${brand?.isActive === false ? '' : 'checked'}> Visible to shoppers</label>
      <label class="check"><input type="checkbox" name="isDemo" ${brand?.isDemo ? 'checked' : ''}> Demonstration data (shows a “Sample” label)</label>
    </div>
  </form>`;
}

export async function brands({ el, navigate }) {
  el.innerHTML = `${pageHead('Administration', 'Brands', `<button class="btn btn-primary btn-sm" data-new>${icon('plus', 14)} New brand</button>`)}<div id="b"></div>`;
  const box = $('#b', el);
  const draw = () => load(box, () => api.get('/api/admin/brands'), ({ brands: list }) => {
    box.innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Brand</th><th>Owner</th><th>Categories</th><th>Catalogue</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((b) => `<tr>
        <td><div class="row" style="--gap:12px">${monogram(b)}<div><b>${esc(b.name)}</b> ${b.isDemo ? sampleTag('Sample') : ''}<div class="small muted">${esc(b.country ?? '')}</div></div></div></td>
        <td class="small muted">${b.merchantName ? esc(b.merchantName) : 'Platform-managed'}</td>
        <td class="small muted">${esc(b.categories.map(categoryLabel).join(', ') || '—')}</td>
        <td class="small muted">${b.products} products · ${b.charts} charts</td>
        <td>${b.isActive ? '<span class="tag ok">Visible</span>' : '<span class="tag">Hidden</span>'}</td>
        <td class="actions"><a class="btn btn-sm" href="/admin/brands/${esc(b.id)}">Manage</a></td></tr>`).join('')}</tbody></table></div>`
      : empty({ title: 'No brands yet', body: 'Create a platform-managed brand or wait for merchants to register.', mark: 'grid', action: '<button class="btn btn-primary btn-sm" data-new>Create brand</button>' });
  }, { skeletonHtml: skeleton(5, 64) });
  draw();
  on(el, 'click', '[data-new]', () => {
    const m = modal({ title: 'New brand', wide: true, body: brandForm(), footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="brand-form">Create brand</button>' });
    submitHandler($('#brand-form', m.el), async (v) => {
      const { brand } = await api.post('/api/admin/brands', v);
      m.close(); toast('Brand created');
      navigate(`/admin/brands/${brand.id}`);
    });
  });
}

export async function brandDetail({ el, params, navigate, setLeaveGuard }) {
  await load(el, () => api.get(`/api/admin/brands/${encodeURIComponent(params.id)}`), ({ brand }) => {
    el.innerHTML = `
      <a class="small muted" href="/admin/brands">← All brands</a>
      <div class="page-head" style="margin-top:16px"><div class="row" style="--gap:14px">${monogram(brand)}<div><h1>${esc(brand.name)}</h1><p class="small muted">${brand.merchantId ? 'Merchant-owned brand' : 'Platform-managed brand'}</p></div></div>
        <div class="row wrap-row"><a class="btn btn-sm" href="/brands/${esc(brand.slug)}" target="_blank" rel="noopener">Public page ↗</a>${brand.merchantId ? '' : '<button class="btn btn-sm btn-danger" data-delete>Delete brand</button>'}</div></div>
      ${brand.isDemo ? `<p class="notice warn" style="margin-bottom:16px">${DEMO_NOTE}</p>` : ''}
      <div class="card pad-lg">${brandForm(brand)}<div style="margin-top:16px"><button class="btn btn-primary" type="submit" form="brand-form">Save brand</button></div></div>
      <div class="section-title"><h2 class="h3">Size charts</h2></div>
      <div id="charts"></div>`;
    submitHandler($('#brand-form', el), async (v) => {
      await api.patch(`/api/admin/brands/${brand.id}`, v);
      toast('Brand saved');
    });
    $('[data-delete]', el)?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Delete ${brand.name}?`, body: 'The brand, its size charts, products and analytics are removed permanently.', confirmText: 'Delete brand', danger: true }))) return;
      try { await api.del(`/api/admin/brands/${brand.id}`); toast('Brand deleted'); navigate('/admin/brands', { force: true }); } catch (err) { toastError(err); }
    });
    chartManager($('#charts', el), { base: `/api/admin/brands/${brand.id}/charts`, setLeaveGuard });
  }, { skeletonHtml: skeleton(3, 160) });
}

// ---------------------------------------------------------------------------
export async function users({ el, state }) {
  let role = 'customer';
  el.innerHTML = `${pageHead('Administration', 'Users', '', 'Account details only. Body measurements are private to each customer and are not shown here.')}
    <div style="margin-bottom:16px">${seg('role', [['customer', 'Customers'], ['merchant', 'Merchants'], ['admin', 'Admins'], ['', 'Everyone']], role)}</div>
    <div class="row" style="margin-bottom:14px"><input class="input" id="q" placeholder="Search by name or email" style="max-width:360px" aria-label="Search users"></div>
    <div id="u"></div>`;
  const box = $('#u', el);
  let rows = [];
  const render = () => {
    const q = $('#q', el).value.trim().toLowerCase();
    const list = rows.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    box.innerHTML = list.length ? `<div class="table-wrap"><table>
      <thead><tr><th>User</th><th>Role</th><th>Size profile</th><th>Recommendations</th><th>Joined</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((u) => `<tr>
        <td><b>${esc(u.name)}</b> ${u.isSample ? sampleTag('Sample') : ''}<div class="small muted">${esc(u.email)}</div></td>
        <td class="muted" style="text-transform:capitalize">${esc(u.role)}</td>
        <td>${u.role === 'customer' ? (u.hasProfile ? '<span class="tag ok">Created</span>' : '<span class="tag">None</span>') : '<span class="faint">—</span>'}</td>
        <td class="num muted">${u.role === 'customer' ? fmtNum(u.recommendations) : '—'}</td>
        <td class="small muted">${esc(fmtDate(u.createdAt))}</td>
        <td>${statusTag(u.status)}</td>
        <td class="actions">${u.id === state.user.id ? '<span class="small faint">You</span>' : u.status === 'active'
          ? `<button class="btn btn-sm btn-danger" data-user="${esc(u.id)}" data-status="suspended" data-name="${esc(u.name)}">Suspend</button>`
          : `<button class="btn btn-sm" data-user="${esc(u.id)}" data-status="active">Reactivate</button>`}</td></tr>`).join('')}</tbody></table></div>`
      : empty({ title: 'No users found', body: q ? 'Nobody matches that search.' : 'No accounts with this role yet.', mark: 'users' });
  };
  const draw = () => load(box, () => api.get(`/api/admin/users${role ? `?role=${role}` : ''}`), (d) => { rows = d.users; render(); }, { skeletonHtml: skeleton(5, 58) });
  draw();
  on(el, 'seg', '[data-seg=role]', (e) => { role = e.detail.value; draw(); });
  $('#q', el).addEventListener('input', render);
  on(el, 'click', '[data-user]', async (e, b) => {
    if (b.dataset.status === 'suspended' && !(await confirmDialog({ title: `Suspend ${b.dataset.name}?`, body: 'They are signed out everywhere and cannot log in until reactivated.', confirmText: 'Suspend user', danger: true }))) return;
    try { await api.patch(`/api/admin/users/${b.dataset.user}`, { status: b.dataset.status }); toast(b.dataset.status === 'active' ? 'User reactivated' : 'User suspended'); draw(); } catch (err) { toastError(err); }
  });
}

// ---------------------------------------------------------------------------
export async function analyticsPage({ el }) {
  el.innerHTML = `${pageHead('Administration', 'Platform analytics')}<div id="an"></div>
    <div class="section-title"><h2 class="h3">Recommendation log</h2></div><div id="ev"></div>`;
  analyticsView($('#an', el), '/api/admin/analytics', { brandColumn: true });
  const ev = $('#ev', el);
  load(ev, () => api.get('/api/admin/events'), ({ events }) => {
    ev.innerHTML = events.length ? `<div class="table-wrap" style="max-height:520px;overflow:auto"><table><thead><tr><th>When</th><th>Brand</th><th>Product</th><th>Result</th><th>Source</th></tr></thead><tbody>${events.map(eventRow).join('')}</tbody></table></div>`
      : empty({ title: 'No requests yet', body: 'Requests appear here as they happen.' });
  }, { skeletonHtml: skeleton(3, 48) });
}
