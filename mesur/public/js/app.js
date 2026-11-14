// Application shell: session, router, layouts.
import { api } from './api.js';
import { $, $$, esc, icon, initials, toast, confirmDialog, empty } from './ui.js';
import * as publicPages from './pages/public.js';
import * as authPages from './pages/auth.js';
import * as customerPages from './pages/customer.js';
import * as merchantPages from './pages/merchant.js';
import * as adminPages from './pages/admin.js';

export const state = { user: null, merchant: null, mode: 'demo', demoAccounts: [], storefrontUrl: null, allowMerchantSignup: true };

export const homeFor = (role) => (role === 'admin' ? '/admin' : role === 'merchant' ? '/merchant' : '/app');

export async function refreshSession() {
  Object.assign(state, await api.get('/api/auth/me'));
  return state;
}

// path, page, options { layout, role, title, guestOnly }
const ROUTES = [
  ['/', publicPages.landing, { layout: 'public', title: 'One profile. Every brand. Better fit.' }],
  ['/how-it-works', publicPages.howItWorks, { layout: 'public', title: 'How it works' }],
  ['/brands', publicPages.brands, { layout: 'public', title: 'Brands' }],
  ['/brands/:slug', publicPages.brandDetail, { layout: 'public', title: 'Brand' }],
  ['/login', authPages.login, { layout: 'public', title: 'Log in', guestOnly: true }],
  ['/signup', authPages.signup, { layout: 'public', title: 'Create your size profile', guestOnly: true }],
  ['/forgot-password', authPages.forgot, { layout: 'public', title: 'Reset password' }],
  ['/reset-password', authPages.reset, { layout: 'public', title: 'Choose a new password' }],

  ['/app', customerPages.dashboard, { layout: 'shell', role: 'customer', title: 'Dashboard' }],
  ['/app/profile', customerPages.profile, { layout: 'shell', role: 'customer', title: 'Size profile' }],
  ['/app/recommendations', customerPages.recommendations, { layout: 'shell', role: 'customer', title: 'Recommendations' }],
  ['/app/brands', customerPages.brands, { layout: 'shell', role: 'customer', title: 'Brands' }],
  ['/app/brands/:slug', customerPages.brandDetail, { layout: 'shell', role: 'customer', title: 'Brand', nav: '/app/brands' }],
  ['/app/settings', customerPages.settings, { layout: 'shell', role: 'customer', title: 'Settings' }],

  ['/merchant', merchantPages.overview, { layout: 'shell', role: 'merchant', title: 'Overview' }],
  ['/merchant/products', merchantPages.products, { layout: 'shell', role: 'merchant', title: 'Products' }],
  ['/merchant/size-charts', merchantPages.sizeCharts, { layout: 'shell', role: 'merchant', title: 'Size charts' }],
  ['/merchant/integrations', merchantPages.integrations, { layout: 'shell', role: 'merchant', title: 'Integrations' }],
  ['/merchant/analytics', merchantPages.analyticsPage, { layout: 'shell', role: 'merchant', title: 'Analytics' }],
  ['/merchant/settings', merchantPages.settings, { layout: 'shell', role: 'merchant', title: 'Settings' }],

  ['/admin', adminPages.overview, { layout: 'shell', role: 'admin', title: 'Administration' }],
  ['/admin/brands', adminPages.brands, { layout: 'shell', role: 'admin', title: 'Brands' }],
  ['/admin/brands/:id', adminPages.brandDetail, { layout: 'shell', role: 'admin', title: 'Brand', nav: '/admin/brands' }],
  ['/admin/users', adminPages.users, { layout: 'shell', role: 'admin', title: 'Users' }],
  ['/admin/analytics', adminPages.analyticsPage, { layout: 'shell', role: 'admin', title: 'Analytics' }],
].map(([path, page, opts]) => {
  const keys = [];
  const regex = new RegExp(`^${path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { path, page, keys, regex, ...opts };
});

const NAV = {
  customer: [['/app', 'Dashboard', 'home'], ['/app/profile', 'Profile', 'ruler'], ['/app/recommendations', 'Sizes', 'spark'], ['/app/brands', 'Brands', 'grid'], ['/app/settings', 'Settings', 'cog']],
  merchant: [['/merchant', 'Overview', 'home'], ['/merchant/products', 'Products', 'box'], ['/merchant/size-charts', 'Size charts', 'table'], ['/merchant/integrations', 'Integrations', 'plug'], ['/merchant/analytics', 'Analytics', 'chart'], ['/merchant/settings', 'Settings', 'cog']],
  admin: [['/admin', 'Overview', 'shield'], ['/admin/brands', 'Brands', 'grid'], ['/admin/users', 'Users', 'users'], ['/admin/analytics', 'Analytics', 'chart']],
};

let leaveGuard = null;
let cleanup = null;
let currentLayout = null;

const demoBar = () => (state.mode === 'demo'
  ? '<div class="demo-bar"><b>Demonstration mode.</b> Brands, size charts and analytics shown here are fictional sample data.</div>' : '');

function publicLayout() {
  const u = state.user;
  return `
    ${demoBar()}
    <header class="nav"><div class="wrap">
      <a href="/" class="brandmark" aria-label="Mesur home"><i></i>MESUR</a>
      <nav class="nav-links" aria-label="Main"><a href="/how-it-works">How it works</a><a href="/brands">Brands</a><a href="/#for-brands">For brands</a></nav>
      <div class="row" style="--gap:8px">
        ${u ? `<a class="btn btn-primary btn-sm" href="${homeFor(u.role)}">Open ${u.role === 'customer' ? 'my profile' : 'dashboard'}</a>`
            : '<a class="btn btn-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Get started</a>'}
      </div>
    </div></header>
    <main id="view" tabindex="-1"></main>
    <footer class="footer"><div class="wrap row between wrap-row" style="--gap:20px">
      <span class="brandmark"><i></i>MESUR</span>
      <span class="row wrap-row" style="--gap:22px"><a href="/how-it-works">How it works</a><a href="/brands">Brands</a><a href="/signup?type=merchant">For brands</a><a href="/login">Log in</a></span>
      <span>Size recommendations are estimates, not a guarantee of fit.</span>
    </div></footer>`;
}

function shellLayout() {
  const u = state.user;
  const items = NAV[u.role];
  const links = (cls) => items.map(([href, label, ic]) => `<a href="${href}" data-nav="${href}">${icon(ic)}<span>${label}</span></a>`).join('');
  const roleLabel = u.role === 'merchant' ? state.merchant?.companyName ?? 'Merchant' : u.role === 'admin' ? 'Administrator' : 'Customer';
  return `
    ${demoBar()}
    <div class="topbar"><a href="${homeFor(u.role)}" class="brandmark"><i></i>MESUR</a><button class="icon-btn" data-logout aria-label="Log out">${icon('out', 18)}</button></div>
    <div class="shell">
      <aside class="side">
        <a href="${homeFor(u.role)}" class="brandmark"><i></i>MESUR</a>
        <nav class="side-nav" aria-label="${esc(u.role)} navigation">${links()}</nav>
        <div class="side-foot">
          <div class="row"><div class="avatar">${esc(initials(u.name))}</div><div class="grow"><div class="small" style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name)}</div><div class="small muted">${esc(roleLabel)}</div></div></div>
          <button class="btn btn-sm" data-logout>${icon('out', 14)} Log out</button>
        </div>
      </aside>
      <div class="main"><div class="main-inner" id="view" tabindex="-1"></div></div>
    </div>
    <nav class="tabbar" aria-label="${esc(u.role)} navigation">${links()}</nav>`;
}

export async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* session is cleared client-side regardless */ }
  await refreshSession();
  currentLayout = null;
  navigate('/', { replace: true, force: true });
  toast('You are logged out');
}

export async function navigate(to, { replace = false, force = false } = {}) {
  if (!force && leaveGuard?.()) {
    const ok = await confirmDialog({ title: 'Discard unsaved changes?', body: 'You have changes that have not been saved. Leaving this page will discard them.', confirmText: 'Discard changes', danger: true });
    if (!ok) return;
  }
  leaveGuard = null;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  await render();
}

async function render() {
  const url = new URL(location.href);
  const route = ROUTES.find((r) => r.regex.test(url.pathname));
  const app = $('#app');
  cleanup?.(); cleanup = null; leaveGuard = null;

  // Client-side guards mirror the server's. The API is the real gate.
  if (route?.role && !state.user) return navigate(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, { replace: true, force: true });
  if (route?.role && state.user.role !== route.role) return navigate(homeFor(state.user.role), { replace: true, force: true });
  if (route?.guestOnly && state.user) return navigate(homeFor(state.user.role), { replace: true, force: true });

  const layout = route?.layout ?? 'public';
  const layoutKey = `${layout}:${state.user?.id ?? 'anon'}:${state.user?.name ?? ''}:${state.merchant?.companyName ?? ''}`;
  if (layoutKey !== currentLayout) {
    app.innerHTML = layout === 'shell' ? shellLayout() : publicLayout();
    currentLayout = layoutKey;
  }
  const navKey = route?.nav ?? route?.path;
  $$('[data-nav], .nav-links a', app).forEach((a) => {
    const href = a.getAttribute('href');
    if (href === navKey || href === url.pathname) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  const view = $('#view');
  const el = document.createElement('div');
  el.className = 'page';
  view.replaceChildren(el);
  document.title = route ? `${route.title} — Mesur` : 'Page not found — Mesur';

  if (!route) {
    el.innerHTML = `<div class="wrap" style="padding:120px 24px">${empty({ title: 'Page not found', body: 'The page you are looking for does not exist or has moved.', action: '<a class="btn btn-primary btn-sm" href="/">Back to home</a>' })}</div>`;
    return;
  }
  const m = url.pathname.match(route.regex);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  try {
    cleanup = await route.page({
      el, params, query: url.searchParams, navigate, state, logout,
      refresh: async () => { await refreshSession(); currentLayout = null; },
      setLeaveGuard: (fn) => { leaveGuard = fn; },
    }) ?? null;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div style="padding:60px 0">${empty({ title: 'This page failed to load', body: err.message, mark: 'x', action: '<button class="btn btn-sm" onclick="location.reload()">Reload</button>' })}</div>`;
  }
  if (url.hash) requestAnimationFrame(() => document.getElementById(url.hash.slice(1))?.scrollIntoView());
  else window.scrollTo(0, 0);
}

// ---- global listeners -------------------------------------------------------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-logout]')) { e.preventDefault(); logout(); return; }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || /\.[a-z0-9]+($|\?)/i.test(href) || href.startsWith('/api/')) return;
  e.preventDefault();
  if (href === location.pathname + location.search + location.hash) return;
  navigate(href);
});
// Segmented controls: reflect the pressed state, then let the page react via a "seg" event.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg button');
  if (!btn) return;
  const group = btn.parentElement;
  for (const b of group.children) b.setAttribute('aria-pressed', String(b === btn));
  group.dispatchEvent(new CustomEvent('seg', { bubbles: true, detail: { name: group.dataset.seg, value: btn.dataset.value } }));
});
window.addEventListener('popstate', () => render());
window.addEventListener('beforeunload', (e) => { if (leaveGuard?.()) e.preventDefault(); });
window.addEventListener('scroll', () => $('.nav')?.classList.toggle('scrolled', scrollY > 8), { passive: true });
window.addEventListener('mesur:unauthorised', async () => {
  if (!state.user) return;
  await refreshSession();
  currentLayout = null;
  toast('Your session has ended. Please log in again.', 'bad');
  navigate('/login', { replace: true, force: true });
});

// ---- boot -------------------------------------------------------------------
try {
  await refreshSession();
  await render();
} catch (err) {
  $('#app').innerHTML = `<div class="wrap" style="padding:120px 24px">${empty({ title: 'Mesur could not start', body: err.message, mark: 'x', action: '<button class="btn btn-sm" onclick="location.reload()">Try again</button>' })}</div>`;
}
