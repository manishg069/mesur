import { api } from '../api.js';
import { $, $$, esc, on, load, empty, skeletonGrid, observeReveals, seg, sampleTag, monogram } from '../ui.js';
import { figureSvg, setActiveZone, teeSvg } from '../figure.js';
import { brandCard, chartTable, DEMO_NOTE } from '../components.js';
import { recommendSize } from '/shared/engine.js';
import { fromCm } from '/shared/units.js';
import { FIT_LABELS, FITS, categoryLabel } from '/shared/measurements.js';

const HERO_PROFILE = { height: 170, chest: 96, waist: 82, shoulder: 44 };
const PRESETS = [
  { id: 'a', label: '170 cm · chest 96', profile: { height: 170, chest: 96, waist: 82, shoulder: 44 } },
  { id: 'b', label: '182 cm · chest 104', profile: { height: 182, chest: 104, waist: 90, shoulder: 47 } },
  { id: 'c', label: '160 cm · chest 86', profile: { height: 160, chest: 86, waist: 70, shoulder: 39 } },
];

export async function landing({ el, state }) {
  const cta = state.user ? '/app' : '/signup';
  el.innerHTML = `
    <section class="hero"><div class="wrap hero-grid">
      <div class="stack" style="--gap:30px">
        <span class="label">Universal size profile</span>
        <h1 class="display">One profile.<br>Every brand.<br>Better fit.</h1>
        <p class="lead">Your body doesn't change when you switch brands. Your clothing size shouldn't be a guessing game either.</p>
        <div class="row wrap-row"><a class="btn btn-primary btn-lg" href="${cta}">Create your size profile</a><a class="btn btn-lg" href="/how-it-works">See how it works</a></div>
      </div>
      <div class="stack" style="--gap:0" id="hero-demo">
        <div class="hero-visual">
          <div class="figure">${figureSvg({ show: ['height', 'chest', 'waist', 'shoulder'], active: 'chest' })}</div>
          <div>
            <div class="row between" style="margin-bottom:6px"><span class="label">Size profile</span><span class="tag ok"><span class="dot"></span>Saved</span></div>
            ${[['height', 'Height', 170], ['chest', 'Chest', 96], ['waist', 'Waist', 82], ['shoulder', 'Shoulders', 44]].map(([k, l, v]) => `<div class="spec" data-spec="${k}"><span class="label">${l}</span><b>${v} <span class="small muted" style="font-weight:400">cm</span></b></div>`).join('')}
          </div>
        </div>
        <div class="flow"><div class="flow-line"></div><div class="engine-node"><span class="pulse"></span><span class="label" style="color:#fff">Size matching engine</span></div><div class="flow-line"></div></div>
        <div class="rec-cards" id="hero-recs">${Array.from({ length: 3 }, () => '<div class="skeleton" style="height:112px"></div>').join('')}</div>
        <p class="small faint" style="text-align:center;margin-top:14px">Computed live from fictional sample size charts.</p>
      </div>
    </div></section>

    <section class="band" id="problem"><div class="wrap stack" style="--gap:44px">
      <div class="stack reveal" style="--gap:18px;max-width:780px">
        <span class="label">The problem</span>
        <h2 class="h1">Your size isn't universal. Your profile should be.</h2>
        <p class="lead">Every brand grades its sizes differently. The same body can be an S in one store and an L in the next. Pick a body below and watch the label change while the person stays the same.</p>
      </div>
      <div class="reveal">${seg('preset', PRESETS.map((p) => [p.id, p.label]), 'a')}</div>
      <div class="grid cols-auto reveal" id="problem-cards">${Array.from({ length: 5 }, () => '<div class="skeleton" style="height:210px"></div>').join('')}</div>
      <p class="small faint reveal">${DEMO_NOTE}</p>
    </div></section>

    <section class="band" id="how"><div class="wrap stack" style="--gap:44px">
      <div class="stack reveal" style="--gap:18px"><span class="label">How it works</span><h2 class="h1">Measure once. Shop everywhere.</h2></div>
      <div class="steps reveal">
        <div class="step"><span class="no">01</span><h3 class="h3">Enter your measurements</h3><p class="muted">Create your body profile once. Height and chest are enough to start.</p></div>
        <div class="step"><span class="no">02</span><h3 class="h3">Our engine matches your size</h3><p class="muted">We compare your measurements against brand-specific sizing data.</p></div>
        <div class="step"><span class="no">03</span><h3 class="h3">Shop with confidence</h3><p class="muted">Get personalised recommendations on participating fashion stores.</p></div>
      </div>
    </div></section>

    <section class="band" id="demo"><div class="wrap stack" style="--gap:44px">
      <div class="stack reveal" style="--gap:18px;max-width:760px"><span class="label">Try it</span><h2 class="h1">Change the body. Watch the size follow.</h2>
        <p class="lead">This is the real engine running in your browser against a sample chart. Move the sliders or switch the fit you like.</p></div>
      <div class="product-demo reveal">
        <div class="product-shot">${teeSvg}<span class="tag" style="position:absolute;left:18px;top:18px">Simulated product page</span></div>
        <div class="product-info">
          <div class="stack" style="--gap:6px"><span class="label">Northline Supply · sample</span><h3 class="h2">Essential Cotton Tee</h3></div>
          <div class="stack" style="--gap:10px"><span class="label">Available sizes</span><div class="sizes" id="demo-sizes"></div></div>
          <div class="card light" id="demo-result" aria-live="polite"></div>
          <div class="stack" style="--gap:10px">
            ${[['chest', 'Chest', 76, 124, 96], ['waist', 'Waist', 60, 112, 82], ['shoulder', 'Shoulders', 36, 54, 44]].map(([k, l, min, max, v]) => `
              <label class="slider-row"><span class="label">${l}</span><input type="range" name="${k}" min="${min}" max="${max}" step="0.5" value="${v}" aria-label="${l} in centimetres"><output>${v} cm</output></label>`).join('')}
          </div>
          <div class="stack" style="--gap:10px"><span class="label">Preferred fit</span>${seg('fit', FITS.map((f) => [f, FIT_LABELS[f].replace(' fit', '')]), 'regular')}</div>
        </div>
      </div>
    </div></section>

    <section class="band" id="for-brands"><div class="wrap grid cols-2" style="--gap:56px;align-items:start">
      <div class="stack reveal" style="--gap:22px">
        <span class="label">For fashion brands</span>
        <h2 class="h1">Stop losing customers to sizing uncertainty.</h2>
        <p class="lead">Upload your size charts, paste one script tag, and every product page gets a "Find My Size" button backed by your own data.</p>
        <div><a class="btn btn-primary btn-lg" href="/signup?type=merchant">Integrate with your store</a></div>
      </div>
      <div class="stack reveal" style="--gap:22px">
        <div class="benefits">
          ${['Personalised size recommendations', 'A better shopping experience', 'Potentially fewer size-related returns', 'More confident customers', 'Size recommendation analytics', 'Shopper measurements stay private'].map((b, i) => `<div class="benefit"><span class="small faint num">0${i + 1}</span><span>${b}</span></div>`).join('')}
        </div>
        <div class="code" aria-label="Example embed snippet">&lt;script
  src="${esc(location.origin)}/widget.js"
  data-merchant="pk_your_public_key"
  data-product="your-product-id"&gt;
&lt;/script&gt;</div>
      </div>
    </div></section>

    <section class="cta-final"><div class="wrap stack reveal" style="--gap:30px;align-items:center">
      <h2 class="display" style="font-size:clamp(40px,7vw,88px)">Your body.<br>Your profile.<br>Your perfect size.</h2>
      <p class="lead" style="text-align:center">Two measurements to start. Under a minute.</p>
      <a class="btn btn-primary btn-lg" href="${cta}">Create your size profile</a>
    </div></section>`;

  observeReveals(el);

  // Hero: cycle the highlighted measurement.
  const order = ['chest', 'waist', 'shoulder', 'height'];
  let step = 0;
  const hero = $('#hero-demo', el);
  const tick = () => {
    const key = order[step++ % order.length];
    setActiveZone(hero, key, order);
    $$('[data-spec]', hero).forEach((n) => { n.style.opacity = n.dataset.spec === key ? '1' : '.45'; n.style.transition = 'opacity .4s'; });
  };
  tick();
  const timer = setInterval(tick, 1800);

  // Live engine demos.
  let demo = null;
  const size = (chart, profile, fit = 'regular') => recommendSize({ profile, chart, fitPreference: fit, config: { minMatchScore: demo.minMatchScore } });

  const drawProblem = (presetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    $('#problem-cards', el).innerHTML = demo.charts.filter((c) => c.slug !== 'northline-supply').map((c) => {
      const r = size(c.chart, preset.profile);
      const range = r.recommended?.comparison.find((x) => x.key === 'chest');
      return `<div class="card hover brand-size" tabindex="0">
        <div class="row between"><span class="label" style="color:#fff">${esc(c.brand)}</span>${sampleTag('Sample')}</div>
        <div class="size">${r.status === 'ok' ? esc(r.size) : '—'}</div>
        <p class="small muted">${r.status === 'ok' ? `Chest ${range.min}–${range.max} cm on this chart · ${r.matchScore}% match` : 'Outside this chart’s range'}</p>
      </div>`;
    }).join('') || empty({ title: 'No sample brands loaded', body: 'Seed the demonstration data to see this comparison.' });
  };

  const drawDemo = () => {
    const chart = (demo.charts.find((c) => c.slug === 'northline-supply') ?? demo.charts[0])?.chart;
    const box = $('#demo-result', el);
    if (!chart) { box.innerHTML = '<p class="muted">No sample chart available.</p>'; return; }
    const profile = { height: 170 };
    $$('#demo input[type=range]', el).forEach((i) => { profile[i.name] = Number(i.value); i.nextElementSibling.textContent = `${i.value} cm`; });
    const fit = $('[data-seg=fit] [aria-pressed=true]', el).dataset.value;
    const r = size(chart, profile, fit);
    $('#demo-sizes', el).innerHTML = chart.entries.map((e) => `<span class="size-chip ${r.size === e.label ? 'rec' : r.nextClosest?.label === e.label ? 'next' : ''}">${esc(e.label)}</span>`).join('');
    box.innerHTML = r.status === 'ok'
      ? `<div class="row between wrap-row"><div><span class="label">Your recommended size</span><div style="font-size:54px;font-weight:700;letter-spacing:-.06em;line-height:1">${esc(r.size)}</div></div>
           <div class="row" style="--gap:22px"><div><span class="label">Match score</span><div class="num" style="font-size:20px;font-weight:600">${r.matchScore}%</div></div><div><span class="label">Confidence</span><div style="font-size:20px;font-weight:600;text-transform:capitalize">${esc(r.confidence.level)}</div></div></div></div>
         <p class="small" style="margin-top:12px">Based on your universal size profile. ${r.fitNotes[0] ? esc(r.fitNotes[0].text) : r.confidence.reasons[0] ? esc(r.confidence.reasons[0]) : ''}</p>`
      : `<span class="label">No size recommended</span><p style="font-weight:600;margin-top:6px">${esc(r.message)}</p><p class="small muted" style="margin-top:6px">${esc(r.explanation ?? '')}</p>`;
  };

  try {
    demo = await api.get('/api/public/demo');
    const pick = ['zara', 'h-m', 'uniqlo'].map((s) => demo.charts.find((c) => c.slug === s)).filter(Boolean);
    $('#hero-recs', el).innerHTML = (pick.length ? pick : demo.charts.slice(0, 3)).map((c, i) => {
      const r = size(c.chart, HERO_PROFILE);
      return `<div class="rec-mini ${i === 0 ? 'light' : ''}"><span class="label">${esc(c.brand)}</span><span class="size">${esc(r.size ?? '—')}</span></div>`;
    }).join('') || '<p class="small muted" style="grid-column:1/-1;text-align:center">No sample brands are loaded.</p>';
    drawProblem('a');
    drawDemo();
    on(el, 'seg', '[data-seg=preset]', (e) => drawProblem(e.detail.value));
    on(el, 'seg', '[data-seg=fit]', drawDemo);
    on(el, 'input', '#demo input[type=range]', drawDemo);
  } catch (err) {
    for (const id of ['#hero-recs', '#problem-cards', '#demo-result']) $(id, el).innerHTML = `<p class="small error" style="grid-column:1/-1">Live demo unavailable: ${esc(err.message)}</p>`;
  }
  return () => clearInterval(timer);
}

export async function howItWorks({ el, state }) {
  el.innerHTML = `
    <section class="hero"><div class="wrap stack" style="--gap:26px;max-width:900px">
      <span class="label">How it works</span>
      <h1 class="h1" style="font-size:clamp(40px,6.4vw,84px)">A size chart is a range. You are a point. We find where you land.</h1>
      <p class="lead">No AI guesswork and no hidden model. The engine compares your measurements with each brand's own chart and shows its working.</p>
    </div></section>

    <section class="band"><div class="wrap grid cols-2" style="--gap:56px;align-items:center">
      <div class="card figure-card" style="position:static;max-width:380px">${figureSvg({ show: ['height', 'chest', 'waist', 'shoulder', 'hip', 'inseam'], active: 'chest' })}</div>
      <div class="stack" style="--gap:34px">
        ${[
          ['01', 'Enter your measurements', 'Height and chest create a profile. Waist and shoulders sharpen tops; waist, hips and inseam unlock trousers and jeans. Use centimetres or inches — we convert.'],
          ['02', 'Our engine matches your size', 'For each size we check whether every measurement falls inside the brand\'s range, and how far outside if not. Chest counts most for tops, waist for bottoms. Too tight is penalised harder than too loose.'],
          ['03', 'Shop with confidence', 'You get one size, a match score, the next closest size and a note on anything that may feel tight or loose. On partner stores the "Find My Size" button does this on the product page.'],
        ].map(([n, t, b]) => `<div class="stack reveal" style="--gap:10px"><span class="small faint num">${n}</span><h2 class="h2">${t}</h2><p class="muted">${b}</p></div>`).join('')}
      </div>
    </div></section>

    <section class="band"><div class="wrap stack" style="--gap:36px">
      <div class="stack reveal" style="--gap:16px;max-width:760px"><span class="label">What makes it trustworthy</span><h2 class="h1">It tells you when it doesn't know.</h2></div>
      <div class="grid cols-3">
        ${[
          ['Body is not garment', 'A T-shirt is wider than the chest inside it. Charts are marked as body or garment measurements, and garment charts are compared after subtracting the ease your preferred fit needs.'],
          ['Your fit, not ours', 'Choose slim, regular, relaxed or oversized. The engine shifts the match by the difference between the fit you want and the way the product is cut.'],
          ['No forced answers', 'If your measurements sit outside a chart, or point to sizes too far apart, you are told so instead of being handed the nearest label.'],
          ['Missing data is requested', 'Jeans need a waist measurement. If your profile lacks it, the engine asks for it rather than guessing from your chest.'],
          ['Confidence is an estimate', 'High, medium or low reflects the match score, how many measurements could be compared and how close the runner-up is. It is not a guarantee of fit.'],
          ['Private by design', 'Stores never receive your measurements. The widget shows your result inside a frame served by Mesur; brands only see anonymous size counts.'],
        ].map(([t, b]) => `<div class="card stack reveal" style="--gap:10px"><h3 class="h3">${t}</h3><p class="small muted">${b}</p></div>`).join('')}
      </div>
    </div></section>

    <section class="cta-final"><div class="wrap stack" style="--gap:26px;align-items:center">
      <h2 class="h1">Ready when you are.</h2>
      <div class="row wrap-row" style="justify-content:center"><a class="btn btn-primary btn-lg" href="${state.user ? '/app' : '/signup'}">Create your size profile</a><a class="btn btn-lg" href="/brands">Browse brands</a></div>
    </div></section>`;
  observeReveals(el);
}

export async function brands({ el, state }) {
  el.innerHTML = `
    <section class="hero" style="padding-bottom:40px"><div class="wrap stack" style="--gap:20px;max-width:820px">
      <span class="label">Brands</span><h1 class="h1">Brands with size data on Mesur.</h1>
      <p class="lead">Each brand has its own charts. Your profile is matched against them individually.</p>
      ${state.mode === 'demo' ? `<p class="notice warn">${DEMO_NOTE} Well-known names are used only to illustrate how sizing varies between brands.</p>` : ''}
    </div></section>
    <div class="wrap" id="list" style="padding-bottom:40px"></div>`;
  const list = $('#list', el);
  await load(list, () => api.get('/api/public/brands'), ({ brands: items }) => {
    list.innerHTML = items.length
      ? `<div class="grid cols-auto">${items.map((b) => brandCard(b, `/brands/${b.slug}`)).join('')}</div>`
      : empty({ title: 'No brands yet', body: 'Participating brands will appear here as soon as they publish their size charts.', mark: 'grid', action: '<a class="btn btn-sm" href="/signup?type=merchant">Add your brand</a>' });
  }, { skeletonHtml: skeletonGrid(6, 190) });
}

export async function brandDetail({ el, params, state }) {
  el.innerHTML = '<div class="wrap" id="detail" style="padding:56px 24px 0"></div>';
  const box = $('#detail', el);
  await load(box, () => api.get(`/api/public/brands/${encodeURIComponent(params.slug)}`), ({ brand, charts, products }) => {
    document.title = `${brand.name} — Mesur`;
    box.innerHTML = `
      <a class="small muted" href="/brands">← All brands</a>
      <div class="row wrap-row" style="--gap:18px;margin:22px 0 14px">${monogram(brand)}<h1 class="h1">${esc(brand.name)}</h1>${brand.isDemo ? sampleTag() : ''}</div>
      <p class="lead">${esc(brand.description ?? '')}</p>
      <p class="small muted" style="margin-top:10px">${[brand.country, brand.categories.map(categoryLabel).join(' · ')].filter(Boolean).map(esc).join(' — ')}</p>
      <div style="margin:26px 0 44px"><a class="btn btn-primary" href="${state.user?.role === 'customer' ? `/app/brands/${brand.slug}` : '/signup'}">Find my size at ${esc(brand.name)}</a></div>
      <div class="stack" style="--gap:34px">
        ${charts.length ? charts.map(chartTable).join('') : empty({ title: 'No size charts published', body: 'This brand has not added any size charts yet.', mark: 'table' })}
      </div>
      ${products.length ? `<div class="section-title"><h2 class="h3">Products</h2></div><div class="grid cols-auto">${products.map((p) => `<div class="card stack" style="--gap:6px"><b>${esc(p.name)}</b><span class="small muted">${esc(categoryLabel(p.category))} · ${esc(FIT_LABELS[p.fitType])}</span></div>`).join('')}</div>` : ''}`;
  });
  void fromCm;
}
