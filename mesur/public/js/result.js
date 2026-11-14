// Rendering of an engine result. Used by the app, the landing demo and the widget frame.
import { esc } from './ui.js';
import { fromCm } from '/shared/units.js';
import { FIT_LABELS, MEASUREMENTS } from '/shared/measurements.js';

const CONF = { high: ['ok', 'High'], medium: ['warn', 'Medium'], low: ['bad', 'Low'] };
const u = (cm, unit) => `${fromCm(cm, unit)}`;

export function confidenceTag(level) {
  const [cls, label] = CONF[level] ?? ['', level ?? '—'];
  return `<span class="tag ${cls}"><span class="dot"></span>${esc(label)} confidence</span>`;
}

/** The headline card: size, score, confidence, one-line explanation. */
export function resultCard(result, { unit = 'cm', caption = 'Based on your universal size profile.', showScore = true } = {}) {
  if (!result) return '';
  if (result.status === 'ok') {
    return `
    <div class="card light pad-lg" data-result="ok">
      <div class="result-hero">
        <div><div class="label">Your recommended size</div><div class="result-size" data-size>${esc(result.size)}</div></div>
        <div class="stack" style="--gap:14px">
          <div class="result-meta">
            ${showScore ? `<div><span class="label">Match score</span><b class="num">${result.matchScore}%</b></div>` : ''}
            <div><span class="label">Confidence</span><b>${esc(CONF[result.confidence.level]?.[1] ?? '')}</b></div>
            ${result.nextClosest ? `<div><span class="label">Next closest</span><b>${esc(result.nextClosest.label)} <span class="muted small num" style="font-weight:400">${result.nextClosest.matchScore}%</span></b></div>` : ''}
          </div>
          <p>${esc(result.explanation)}</p>
          <p class="small muted">${esc(caption)} ${esc(result.confidence.disclaimer)}</p>
        </div>
      </div>
    </div>`;
  }
  const title = { out_of_range: 'No size recommended', insufficient_data: 'One more measurement needed', no_chart: 'Size chart not available' }[result.status] ?? 'No recommendation';
  return `
    <div class="card pad-lg" data-result="${esc(result.status)}">
      <div class="stack" style="--gap:10px">
        <span class="label">${esc(title)}</span>
        <h3 class="h2" style="font-size:24px">${esc(result.message)}</h3>
        ${result.explanation ? `<p class="muted">${esc(result.explanation)}</p>` : ''}
        ${result.status === 'insufficient_data' ? `<div><a class="btn btn-primary btn-sm" href="/app/profile?focus=${esc(result.missing[0])}" data-add-measurement>Add ${esc(result.missing.map((k) => MEASUREMENTS[k].label.toLowerCase()).join(', '))}</a></div>` : ''}
        ${result.nearest ? `<p class="small muted">Nearest size on the chart: ${esc(result.nearest.label)} (${result.nearest.matchScore}% match${result.nearest.disqualifiedReason ? ` — ${esc(result.nearest.disqualifiedReason)}` : ''}).</p>` : ''}
      </div>
    </div>`;
}

const STATUS = {
  within: '<span class="tag ok">Within range</span>',
  tight: '<span class="tag bad">May be tight</span>',
  loose: '<span class="tag warn">May be loose</span>',
};

function comparison(size, unit) {
  if (!size?.comparison?.length) return '';
  return `
    <div class="cmp">
      <span class="head">Measurement</span><span class="head">You</span><span class="head">Size ${esc(size.label)} fits</span><span class="head"></span>
      ${size.comparison.map((c) => `
        <span>${esc(c.label)} <span class="faint small num">${c.weight}%</span></span>
        <span class="num">${u(c.body, unit)} ${unit}${c.compared !== c.body ? `<span class="faint small" title="Value compared after applying your fit preference"> → ${u(c.compared, unit)}</span>` : ''}</span>
        <span class="num muted">${u(c.min, unit)}–${u(c.max, unit)} ${unit}</span>
        <span>${STATUS[c.status]}</span>`).join('')}
    </div>`;
}

/** Full breakdown: comparison table, fit notes, preference, alternatives. */
export function resultDetails(result, { unit = 'cm' } = {}) {
  if (!result || !result.sizes) return '';
  const size = result.recommended ?? result.nearest;
  const notes = result.fitNotes ?? [];
  const reasons = result.confidence?.reasons ?? [];
  return `
    <div class="stack" style="--gap:16px">
      ${size ? `<div class="card"><div class="stack"><span class="label">Measurement comparison${result.chart ? ` · ${esc(result.chart.name)}` : ''}</span>${comparison(size, unit)}
        <p class="small faint">Percentages show how much each measurement counts for this category. Ranges are the body measurements this size is expected to fit${result.fit?.chartType === 'garment' ? ', derived from garment measurements minus ease' : ''}.</p></div></div>` : ''}
      <div class="grid cols-2">
        <div class="card"><div class="stack" style="--gap:10px"><span class="label">Fit notes</span>
          ${notes.length ? notes.map((n) => `<p class="small">${esc(n.text)}</p>`).join('') : `<p class="small muted">${result.status === 'ok' ? 'No areas of likely tightness or looseness in this size.' : 'Not available without a recommended size.'}</p>`}
          ${reasons.map((r) => `<p class="small muted">${esc(r)}</p>`).join('')}
        </div></div>
        <div class="card"><div class="stack" style="--gap:10px"><span class="label">Fit preference used</span>
          <p><b>${esc(FIT_LABELS[result.fit.requested])}</b> <span class="tag">${result.fit.applied ? 'Applied' : 'No adjustment'}</span></p>
          <p class="small muted">${esc(result.fit.note)}</p>
        </div></div>
      </div>
      <div class="card"><div class="stack" style="--gap:12px"><span class="label">All sizes</span>
        <div class="sizes">${result.sizes.map((s) => `<span class="size-chip ${s.label === result.size ? 'rec' : s.label === result.nextClosest?.label ? 'next' : ''}" title="${s.disqualifiedReason ? esc(s.disqualifiedReason) : `${s.matchScore}% match`}">${esc(s.label)}&nbsp;<span class="small num" style="opacity:.6">${s.matchScore}%</span></span>`).join('')}</div>
      </div></div>
    </div>`;
}

export const thinking = (text = 'Comparing your profile with the size chart…') => `
  <div class="thinking" role="status" aria-live="polite"><div class="bars"><i></i><i></i><i></i><i></i><i></i></div><span class="label">${esc(text)}</span></div>`;
