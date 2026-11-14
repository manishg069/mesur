/*!
 * Mesur "Find My Size" widget.
 *
 *   <script src="https://YOUR_MESUR_DOMAIN/widget.js"
 *           data-merchant="pk_..." data-product="your-product-id" async></script>
 *
 * The button is rendered next to the script tag (or inside data-target="#selector").
 * Clicking it opens a modal containing an iframe served by Mesur. The shopper's
 * session cookie and measurements stay on the Mesur origin; the storefront only
 * receives the chosen size label through postMessage, and only if the shopper
 * clicks "Select this size".
 *
 * Single-page apps: MesurWidget.mount(element, { merchant, product }).
 * Events: the host element dispatches "mesur:size-selected" with detail { size }.
 */
(function () {
  'use strict';
  if (window.MesurWidget) { window.MesurWidget._scan(); return; }

  var current = document.currentScript;
  var ORIGIN = current ? new URL(current.src).origin : '';
  var STYLE_ID = 'mesur-widget-style';

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.mesur-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 20px;' +
      'font:500 14px/1 Inter,ui-sans-serif,-apple-system,"Segoe UI",Arial,sans-serif;cursor:pointer;border:1px solid;transition:opacity .2s,transform .2s}' +
      '.mesur-btn:hover{opacity:.88}.mesur-btn:active{transform:scale(.98)}.mesur-btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}' +
      '.mesur-btn[disabled]{opacity:.45;cursor:not-allowed}' +
      '.mesur-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:mesurf .2s both}' +
      '.mesur-box{position:relative;width:100%;max-width:460px;height:min(640px,calc(100vh - 32px));border-radius:18px;overflow:hidden;background:#141414;box-shadow:0 30px 80px rgba(0,0,0,.5);animation:mesurr .3s cubic-bezier(.2,.7,.2,1) both}' +
      '.mesur-box iframe{width:100%;height:100%;border:0;display:block}' +
      '.mesur-x{all:unset;position:absolute;top:12px;right:12px;width:32px;height:32px;display:grid;place-items:center;border-radius:8px;color:#929292;cursor:pointer;z-index:1;font:20px/1 sans-serif}.mesur-x:hover{color:#fff}' +
      '@keyframes mesurf{from{opacity:0}}@keyframes mesurr{from{opacity:0;transform:translateY(12px)}}' +
      '@media (max-width:520px){.mesur-ov{padding:0;align-items:flex-end}.mesur-box{max-width:none;height:88vh;border-radius:18px 18px 0 0}}';
    document.head.appendChild(s);
  }

  var ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/></svg>';

  function qs(merchant, product) {
    return 'merchant=' + encodeURIComponent(merchant) + '&product=' + encodeURIComponent(product);
  }

  function track(merchant, product, type, size) {
    try {
      fetch(ORIGIN + '/api/widget/event', {
        method: 'POST', mode: 'cors', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: merchant, product: product, type: type, size: size || null })
      });
    } catch (e) { /* analytics must never break the store */ }
  }

  function openModal(host, opts, config) {
    var prev = document.activeElement;
    var ov = document.createElement('div');
    ov.className = 'mesur-ov';
    ov.innerHTML = '<div class="mesur-box" role="dialog" aria-modal="true" aria-label="Find my size"><button class="mesur-x" aria-label="Close">&times;</button>' +
      '<iframe title="Mesur size recommendation" src="' + ORIGIN + '/widget/frame?' + qs(opts.merchant, opts.product) + '&origin=' + encodeURIComponent(location.origin) + '"></iframe></div>';
    var overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function close() {
      ov.remove();
      document.body.style.overflow = overflow;
      window.removeEventListener('message', onMsg);
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function onMsg(e) {
      if (e.origin !== ORIGIN || !e.data || e.data.source !== 'mesur') return;
      if (e.data.type === 'close') close();
      if (e.data.type === 'size-selected' && typeof e.data.size === 'string') {
        track(opts.merchant, opts.product, 'size_selected', e.data.size);
        host.dispatchEvent(new CustomEvent('mesur:size-selected', { bubbles: true, detail: { size: e.data.size, product: opts.product } }));
        close();
      }
    }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.mesur-x').addEventListener('click', close);
    window.addEventListener('message', onMsg);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    ov.querySelector('iframe').focus();
    track(opts.merchant, opts.product, 'open');
    void config;
  }

  function mount(host, opts) {
    if (!host || !opts || !opts.merchant || !opts.product) { console.warn('[Mesur] mount() needs an element plus { merchant, product }.'); return; }
    if (host.__mesur) host.__mesur.remove();
    css();
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mesur-btn';
    btn.disabled = true;
    btn.innerHTML = ICON + '<span>Find My Size</span>';
    host.__mesur = btn;
    host.appendChild(btn);

    fetch(ORIGIN + '/api/widget/config?' + qs(opts.merchant, opts.product), { mode: 'cors' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { console.warn('[Mesur] ' + (res.body && res.body.error)); btn.remove(); return; }
        var c = res.body.config;
        var light = c.theme === 'light';
        btn.style.borderRadius = c.radius + 'px';
        btn.style.background = light ? '#111111' : c.accent;
        btn.style.borderColor = light ? '#111111' : c.accent;
        btn.style.color = light ? '#ffffff' : '#000000';
        btn.querySelector('span').textContent = c.buttonText;
        btn.disabled = false;
        btn.addEventListener('click', function () { openModal(host, opts, c); });
      })
      .catch(function () { console.warn('[Mesur] Could not reach the size service.'); btn.remove(); });
  }

  function scan() {
    var tags = document.querySelectorAll('script[data-merchant][data-product]');
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      if (tag.__mesurDone || tag.src.indexOf('/widget.js') === -1) continue;
      tag.__mesurDone = true;
      var target = tag.getAttribute('data-target');
      var host = target ? document.querySelector(target) : null;
      if (!host) { host = document.createElement('div'); host.className = 'mesur-widget'; tag.parentNode.insertBefore(host, tag); }
      mount(host, { merchant: tag.getAttribute('data-merchant'), product: tag.getAttribute('data-product') });
    }
  }

  window.MesurWidget = { mount: mount, _scan: scan, version: '1.0.0' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
