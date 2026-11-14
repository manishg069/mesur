// Presentational pieces reused across the public site, customer app and admin.
import { esc, monogram, sampleTag } from './ui.js';
import { MEASUREMENTS, MEASUREMENT_KEYS, categoryLabel, FIT_LABELS } from '/shared/measurements.js';

export const DEMO_NOTE = 'Fictional demonstration data — not sourced from or verified by the brand.';

export function brandCard(brand, href) {
  return `
    <a class="card hover stack" href="${esc(href)}" style="--gap:18px">
      <div class="row between">${monogram(brand)}${brand.isDemo ? sampleTag('Sample') : `<span class="tag ${brand.integrationStatus === 'live' ? 'ok' : ''}">${brand.integrationStatus === 'live' ? 'Live' : 'Partner'}</span>`}</div>
      <div class="stack" style="--gap:6px">
        <h3 class="h3">${esc(brand.name)}</h3>
        <p class="small muted">${brand.categories.length ? brand.categories.map(categoryLabel).map(esc).join(' · ') : 'No categories yet'}</p>
      </div>
      <p class="small faint">${brand.chartCount ?? 0} size chart${brand.chartCount === 1 ? '' : 's'} · ${brand.productCount ?? 0} product${brand.productCount === 1 ? '' : 's'}${brand.country ? ` · ${esc(brand.country)}` : ''}</p>
    </a>`;
}

/** Read-only size chart table. */
export function chartTable(chart) {
  const keys = MEASUREMENT_KEYS.filter((k) => chart.entries.some((e) => e.ranges[k]));
  const cell = (r) => (!r ? '—' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);
  return `
    <div class="stack" style="--gap:10px">
      <div class="row between wrap-row">
        <div><b>${esc(chart.name)}</b> <span class="small muted">· ${esc(categoryLabel(chart.category))} · ${esc(FIT_LABELS[chart.fitType])}</span></div>
        <div class="row" style="--gap:6px"><span class="tag">${chart.chartType === 'garment' ? 'Garment measurements' : 'Body measurements'}</span><span class="tag">${esc(chart.unit)}</span></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Size</th>${keys.map((k) => `<th>${esc(MEASUREMENTS[k].label)}</th>`).join('')}</tr></thead>
        <tbody>${chart.entries.map((e) => `<tr><td><b>${esc(e.label)}</b></td>${keys.map((k) => `<td class="num muted">${cell(e.ranges[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

export const pageHead = (label, title, actions = '', sub = '') => `
  <div class="page-head"><div class="stack" style="--gap:8px"><span class="label">${esc(label)}</span><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="row wrap-row">${actions}</div></div>`;

export const statCard = (label, value, sub = '') => `
  <div class="card stat"><span class="label">${esc(label)}</span><b>${value}</b>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
