// Demo storefront for the fictional merchant "Northline Supply".
// A separate origin (default http://localhost:4100) that embeds the Mesur widget
// exactly as a real store would: one <script> tag per product page.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(here, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.STOREFRONT_PORT) || 4100;
const MESUR = (process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/$/, '');
const KEY = process.env.STOREFRONT_MERCHANT_KEY || 'pk_demo_northline';

const PRODUCTS = [
  { id: 'essential-cotton-tee', name: 'Essential Cotton Tee', price: 38, category: 'T-shirt', note: 'Midweight organic cotton jersey with a clean crew neck. Regular fit.', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], tone: '#e9e6df' },
  { id: 'boxy-heavyweight-tee', name: 'Boxy Heavyweight Tee', price: 48, category: 'T-shirt', note: '280 gsm, dropped shoulder. Oversized cut, sized from a garment chart.', sizes: ['S', 'M', 'L', 'XL'], tone: '#2b2b2b' },
  { id: 'merino-crew', name: 'Merino Crew Sweatshirt', price: 120, category: 'Sweatshirt', note: 'Fine merino blend with ribbed trims.', sizes: ['S', 'M', 'L', 'XL'], tone: '#56606b' },
  { id: 'everyday-hoodie', name: 'Everyday Hoodie', price: 98, category: 'Hoodie', note: 'Brushed-back fleece with a relaxed body.', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], tone: '#8a8170' },
  { id: 'straight-leg-jean', name: 'Straight Leg Jean', price: 135, category: 'Jeans', note: 'Rigid 13 oz denim, straight through the leg.', sizes: ['28', '30', '32', '34', '36', '38'], tone: '#2f3b52' },
  { id: 'chino-short', name: 'Chino Short', price: 68, category: 'Shorts', note: 'Garment-dyed cotton twill.', sizes: ['28', '30', '32', '34', '36', '38'], tone: '#b9a983' },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const art = (p, big = false) => {
  const tee = '<path d="M110 40q40 26 80 0l62 30l-26 54l-30-12v148H104V112l-30 12l-26-54z"/>';
  const pants = '<path d="M105 30h90l12 240h-44l-13-170l-13 170H93z"/>';
  const shape = /Jeans|Shorts/.test(p.category) ? (p.category === 'Shorts' ? '<path d="M100 60h100l14 120h-50l-14-70l-14 70H86z"/>' : pants) : tee;
  return `<svg viewBox="0 0 300 300" style="width:${big ? '62%' : '58%'}" aria-hidden="true"><g fill="${p.tone}" stroke="#00000022" stroke-width="1.2">${shape}</g></svg>`;
};

const layout = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Northline Supply (demo store)</title>
<style>
  *{box-sizing:border-box}body{margin:0;font:15px/1.55 Georgia,"Times New Roman",serif;background:#faf9f6;color:#1b1b1b}
  a{color:inherit;text-decoration:none}.bar{background:#1b1b1b;color:#faf9f6;font:12px/1 system-ui,sans-serif;text-align:center;padding:9px 12px;letter-spacing:.02em}
  header{display:flex;justify-content:space-between;align-items:center;padding:22px 32px;border-bottom:1px solid #e5e2da}
  .logo{font:600 19px/1 Georgia,serif;letter-spacing:.06em}.nav{font:13px system-ui,sans-serif;color:#666;display:flex;gap:22px}
  main{max-width:1180px;margin:0 auto;padding:40px 32px 80px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:28px}
  .tile{display:flex;flex-direction:column;gap:10px}.ph{aspect-ratio:4/5;background:#efece5;display:grid;place-items:center;border-radius:4px}
  .tile .n{font-size:16px}.tile .p{font:13px system-ui,sans-serif;color:#666}
  .pdp{display:grid;grid-template-columns:1.1fr 1fr;gap:56px;align-items:start}
  .pdp .ph{aspect-ratio:1}.info{display:flex;flex-direction:column;gap:20px;position:sticky;top:24px}
  h1{font-weight:400;font-size:34px;margin:0;letter-spacing:-.01em}.price{font:18px system-ui,sans-serif}
  .k{font:11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#888}
  .sizes{display:flex;flex-wrap:wrap;gap:8px}.sz{font:14px system-ui,sans-serif;min-width:52px;height:44px;border:1px solid #cfcac0;background:#fff;border-radius:4px;cursor:pointer}
  .sz[aria-pressed=true]{background:#1b1b1b;color:#fff;border-color:#1b1b1b}
  .add{font:500 15px system-ui,sans-serif;height:52px;border:0;background:#1b1b1b;color:#fff;border-radius:4px;cursor:pointer}
  .add:disabled{opacity:.4;cursor:not-allowed}.msg{font:13px system-ui,sans-serif;color:#2f6b47;min-height:18px}
  .note{font:13px system-ui,sans-serif;color:#666;border-top:1px solid #e5e2da;padding-top:16px}
  .crumb{font:13px system-ui,sans-serif;color:#888;margin-bottom:22px;display:block}
  @media(max-width:820px){.pdp{grid-template-columns:1fr;gap:26px}header{padding:18px}main{padding:26px 18px 60px}.nav{display:none}}
</style></head><body>
<div class="bar">Demonstration store for a fictional brand. The “Find My Size” button is the Mesur widget, loaded from ${esc(MESUR)}.</div>
<header><a class="logo" href="/">NORTHLINE</a><nav class="nav"><a href="/">Shop all</a><a href="${esc(MESUR)}/app" target="_blank" rel="noopener">My Mesur profile ↗</a></nav></header>
<main>${body}</main></body></html>`;

function home() {
  return layout('Shop', `<h1 style="margin-bottom:8px">Everyday essentials</h1><p style="color:#666;margin:0 0 34px;font-family:system-ui,sans-serif;font-size:14px">Open any product to try the size widget.</p>
    <div class="grid">${PRODUCTS.map((p) => `<a class="tile" href="/products/${p.id}"><div class="ph">${art(p)}</div><span class="n">${esc(p.name)}</span><span class="p">${esc(p.category)} · $${p.price}</span></a>`).join('')}</div>`);
}

function product(p) {
  return layout(p.name, `<a class="crumb" href="/">← Shop all</a>
  <div class="pdp">
    <div class="ph">${art(p, true)}</div>
    <div class="info">
      <div style="display:flex;flex-direction:column;gap:8px"><span class="k">${esc(p.category)}</span><h1>${esc(p.name)}</h1><span class="price">$${p.price}</span></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><span class="k">Size</span>
          <!-- Mesur widget: this is the entire integration. -->
          <script src="${esc(MESUR)}/widget.js" data-merchant="${esc(KEY)}" data-product="${esc(p.id)}" async></script>
        </div>
        <div class="sizes" id="sizes">${p.sizes.map((s) => `<button class="sz" type="button" data-size="${esc(s)}" aria-pressed="false">${esc(s)}</button>`).join('')}</div>
      </div>
      <button class="add" id="add" disabled>Select a size</button>
      <div class="msg" id="msg" role="status"></div>
      <p class="note">${esc(p.note)}</p>
    </div>
  </div>
  <script>
    const add = document.getElementById('add'), msg = document.getElementById('msg');
    function pick(size, fromWidget) {
      document.querySelectorAll('.sz').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
      add.disabled = false; add.textContent = 'Add ' + size + ' to bag';
      msg.textContent = fromWidget ? 'Size ' + size + ' selected from your Mesur recommendation.' : '';
    }
    document.getElementById('sizes').addEventListener('click', (e) => { const b = e.target.closest('.sz'); if (b) pick(b.dataset.size, false); });
    // The widget announces the shopper's chosen size; the store decides what to do with it.
    document.addEventListener('mesur:size-selected', (e) => pick(e.detail.size, true));
    add.addEventListener('click', () => { msg.textContent = 'Demo store — nothing was added to a real bag.'; });
  </script>`);
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (status, html) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
  if (path === '/') return send(200, home());
  const m = path.match(/^\/products\/([a-z0-9-]+)\/?$/);
  const p = m && PRODUCTS.find((x) => x.id === m[1]);
  if (p) return send(200, product(p));
  send(404, layout('Not found', '<p>Page not found. <a href="/" style="text-decoration:underline">Back to shop</a></p>'));
}).listen(PORT, () => console.log(`Demo storefront at http://localhost:${PORT}  (widget from ${MESUR}, key ${KEY})`));

void readFileSync;
