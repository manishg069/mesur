// Small DOM toolkit shared by every page.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener. */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target.closest?.(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

// ---- icons (1.5px stroke, 24 box) ------------------------------------------
const paths = {
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  ruler: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
  spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 01-10 0zM12 17v4"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 010 5.6M17.5 14.3c2 .8 3.5 2.9 3.5 5.7"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  out: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  hanger: '<path d="M12 8a2 2 0 112-2c0 1.5-2 1.6-2 3.5L21 16v2H3v-2l9-6.5"/>',
};
export const icon = (name, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;

// ---- feedback ---------------------------------------------------------------
export function toast(message, kind = 'ok') {
  let host = $('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = `toast ${kind === 'bad' ? 'bad' : ''}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, kind === 'bad' ? 5200 : 2600);
}
export const toastError = (err) => toast(err?.message || 'Something went wrong.', 'bad');

/** Modal dialog with focus trap and Escape to close. Returns { el, close }. */
export function modal({ title, body, footer = '', wide = false, onClose }) {
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2 class="h3">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  const close = (value) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    previous?.focus?.();
    onClose?.(value);
  };
  const focusables = () => $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', overlay).filter((n) => !n.disabled && n.offsetParent !== null);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  on(overlay, 'click', '[data-close]', () => close());
  document.body.append(overlay);
  (focusables().find((n) => n.matches('input, select, textarea')) ?? focusables()[1] ?? focusables()[0])?.focus();
  return { el: overlay, close };
}

/** Promise<boolean> confirmation for destructive actions. */
export function confirmDialog({ title, body, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title,
      body: `<p class="muted">${esc(body)}</p>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-yes]', m.el).addEventListener('click', () => { answered = true; m.close(); resolve(true); });
    $('[data-yes]', m.el).focus();
  });
}

// ---- forms ------------------------------------------------------------------
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { (out[el.name] ??= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type !== 'file') out[el.name] = el.value;
  }
  return out;
}
/** Show server-side field errors next to inputs; returns true if any were placed. */
export function showFieldErrors(form, fields) {
  $$('.error[data-for]', form).forEach((n) => n.remove());
  $$('.invalid', form).forEach((n) => n.classList.remove('invalid'));
  let first = null;
  for (const [name, message] of Object.entries(fields ?? {})) {
    const input = form.elements[name];
    if (!input || !input.classList) continue;
    input.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'error'; p.dataset.for = name; p.textContent = message;
    input.closest('.field')?.append(p);
    first ??= input;
  }
  first?.focus();
  return Boolean(first);
}
/** Wrap an async submit handler with loading state and error display. */
export function submitHandler(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]') ?? document.querySelector(`[form="${form.id}"]`);
    const banner = $('[data-form-error]', form);
    if (banner) banner.classList.add('hide');
    showFieldErrors(form, {});
    btn?.classList.add('loading');
    try { await handler(formValues(form)); }
    catch (err) {
      const placed = showFieldErrors(form, err.fields);
      if (banner && !placed) { banner.textContent = err.message; banner.classList.remove('hide'); }
      else if (!placed) toastError(err);
    } finally { btn?.classList.remove('loading'); }
  });
}
export const field = (label, control, { hint = '', optional = false } = {}) => `
  <label class="field"><span class="label"><span>${esc(label)}</span>${optional ? '<span class="faint">Optional</span>' : ''}</span>${control}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
export const options = (list, selected) => list.map((o) => {
  const [value, label] = Array.isArray(o) ? o : [o.id ?? o, o.label ?? o];
  return `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
}).join('');
export const seg = (name, list, selected) => `<div class="seg" role="group" data-seg="${esc(name)}">${list.map(([v, l]) => `<button type="button" data-value="${esc(v)}" aria-pressed="${String(v) === String(selected)}">${esc(l)}</button>`).join('')}</div>`;

// ---- states -----------------------------------------------------------------
export const skeleton = (rows = 3, height = 72) => `<div class="stack" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => `<div class="skeleton" style="height:${height}px"></div>`).join('')}</div>`;
export const skeletonGrid = (n = 4, height = 120) => `<div class="grid cols-auto" aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => `<div class="skeleton" style="height:${height}px"></div>`).join('')}</div>`;
export const empty = ({ title, body = '', action = '', mark = 'spark' }) => `
  <div class="empty"><div class="mark">${icon(mark, 18)}</div><h3 class="h3">${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ''}${action}</div>`;
export const errorState = (err, retry = true) => `
  <div class="empty" role="alert"><div class="mark">${icon('x', 18)}</div><h3 class="h3">Could not load this</h3><p>${esc(err?.message ?? 'Unknown error')}</p>${retry ? '<button class="btn btn-sm" data-retry>Try again</button>' : ''}</div>`;
export const sampleTag = (text = 'Sample data') => `<span class="tag warn" title="Fictional demonstration data">${esc(text)}</span>`;

/** Load data into a container with skeleton + error + retry handling. */
export async function load(el, fetcher, render, { skeletonHtml = skeleton() } = {}) {
  el.innerHTML = skeletonHtml;
  try {
    const data = await fetcher();
    el.innerHTML = '';
    await render(data);
  } catch (err) {
    console.error(err);
    el.innerHTML = errorState(err);
    $('[data-retry]', el)?.addEventListener('click', () => load(el, fetcher, render, { skeletonHtml }));
  }
}

// ---- formatting -------------------------------------------------------------
export const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en'));
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}
export const initials = (name) => String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const monogram = (brand) => `<div class="logo-mono" aria-hidden="true">${brand.logoUrl ? `<img src="${esc(brand.logoUrl)}" alt="">` : esc(String(brand.name).replace(/[^A-Za-z0-9&]/g, '').slice(0, 2).toUpperCase())}</div>`;

// ---- charts -----------------------------------------------------------------
/** Daily bars: grey = impressions, white = recommendations. */
export function dailyBars(series) {
  const max = Math.max(1, ...series.map((d) => Math.max(d.impressions, d.recommendations)));
  return `
    <div class="bars-chart" role="img" aria-label="Daily widget impressions and recommendation requests">
      ${series.map((d) => `<div class="col"><span class="tip">${esc(d.date.slice(5))} · ${d.impressions} views · ${d.recommendations} recs</span><i style="height:${(d.impressions / max) * 100}%"></i><i class="b" style="height:${(d.recommendations / max) * 100}%"></i></div>`).join('')}
    </div>
    <div class="row between" style="margin-top:12px"><span class="small faint">${esc(series[0]?.date ?? '')}</span>
      <span class="legend"><span><i></i>Widget impressions</span><span><i class="b"></i>Recommendation requests</span></span>
      <span class="small faint">${esc(series.at(-1)?.date ?? '')}</span></div>`;
}
export function hBars(rows, labelKey = 'size', valueKey = 'count') {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return `<div class="stack" style="--gap:10px">${rows.map((r) => `<div class="hbar"><b>${esc(r[labelKey])}</b><div class="track"><i style="width:${(r[valueKey] / max) * 100}%"></i></div><span class="num muted" style="text-align:right">${fmtNum(r[valueKey])}</span></div>`).join('')}</div>`;
}

// ---- misc -------------------------------------------------------------------
export function download(filename, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export async function copyText(text, message = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(message);
}
/** Read an image file and downscale it to a small data URL for upload. */
export function imageToDataUrl(file, maxSide = 480) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Choose a PNG, JPEG or WebP image.'));
    if (file.size > 8_000_000) return reject(new Error('Image is larger than 8 MB.'));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}
/** Reveal-on-scroll for elements with .reveal inside root. */
export function observeReveals(root) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal', root).forEach((n) => io.observe(n));
}
