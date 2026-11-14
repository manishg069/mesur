// Size chart list + table editor with CSV import/export.
// Used by the merchant dashboard and by admins managing any brand's charts.
import { api } from './api.js';
import { $, $$, esc, on, load, empty, skeleton, options, field, toast, toastError, confirmDialog, modal, download, icon } from './ui.js';
import { MEASUREMENTS, MEASUREMENT_KEYS, CATEGORIES, FITS, FIT_LABELS, categoryLabel, categoryGroup } from '/shared/measurements.js';
import { parseSizeChartCsv, sizeChartToCsv } from '/shared/csv.js';

const DEFAULT_KEYS = { tops: ['chest', 'waist', 'shoulder'], bottoms: ['waist', 'hip', 'inseam'], dresses: ['chest', 'waist', 'hip'] };
const TEMPLATE = 'size,chest_min,chest_max,waist_min,waist_max,shoulder_min,shoulder_max\nS,88,92,74,78,42,43\nM,93,98,79,84,44,45\nL,99,104,85,90,46,47\n';

/**
 * @param {HTMLElement} el container
 * @param {{ base: string, setLeaveGuard: Function }} opts  base = REST collection URL for the brand's charts
 */
export function chartManager(el, { base, setLeaveGuard }) {
  let charts = [];
  let draft = null; // chart being edited
  let dirty = false;
  setLeaveGuard(() => Boolean(draft) && dirty);

  const blank = () => ({
    id: null, name: '', category: 'tshirts', fitType: 'regular', unit: 'cm', chartType: 'body', scope: 'brand', isActive: true,
    keys: [...DEFAULT_KEYS.tops], rows: ['S', 'M', 'L'].map((label) => ({ label, ranges: {} })),
  });
  const fromChart = (c) => ({
    id: c.id, name: c.name, category: c.category, fitType: c.fitType, unit: c.unit, chartType: c.chartType, scope: c.scope, isActive: c.isActive,
    keys: MEASUREMENT_KEYS.filter((k) => c.entries.some((e) => e.ranges[k])),
    rows: c.entries.map((e) => ({ label: e.label, ranges: structuredClone(e.ranges) })),
  });
  const entriesOf = (d) => d.rows.map((r, i) => ({ label: r.label, sort_order: i, ranges: Object.fromEntries(d.keys.filter((k) => r.ranges[k] && ((r.ranges[k].min ?? '') !== '' || (r.ranges[k].max ?? '') !== '')).map((k) => [k, r.ranges[k]])) }));

  // ---- list ---------------------------------------------------------------
  const list = () => load(el, () => api.get(base), (data) => {
    charts = data.charts;
    draft = null; dirty = false;
    el.innerHTML = `
      <div class="row wrap-row between" style="margin-bottom:16px">
        <p class="muted small">${charts.length} chart${charts.length === 1 ? '' : 's'}. Brand charts apply to every product in their category; product charts are assigned to individual products.</p>
        <div class="row wrap-row"><button class="btn btn-sm" data-act="import-new">Import CSV</button><button class="btn btn-primary btn-sm" data-act="new">${icon('plus', 14)} New size chart</button></div>
      </div>
      ${charts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Category</th><th>Fit</th><th>Measures</th><th>Sizes</th><th>Used by</th><th></th></tr></thead>
        <tbody>${charts.map((c) => `<tr>
          <td><b>${esc(c.name)}</b> ${c.isActive ? '' : '<span class="tag">Inactive</span>'}<div class="small muted">${c.scope === 'product' ? 'Product-specific' : 'Brand chart'} · ${esc(c.unit)}</div></td>
          <td class="muted">${esc(categoryLabel(c.category))}</td>
          <td class="muted">${esc(FIT_LABELS[c.fitType].replace(' fit', ''))}</td>
          <td><span class="tag">${c.chartType === 'garment' ? 'Garment' : 'Body'}</span></td>
          <td class="muted">${esc(c.entries.map((e) => e.label).join(' · '))}</td>
          <td class="num muted">${c.productCount} product${c.productCount === 1 ? '' : 's'}</td>
          <td class="actions"><button class="btn btn-sm" data-act="edit" data-id="${esc(c.id)}">Edit</button>
            <a class="btn btn-sm" href="${esc(base)}/${esc(c.id)}/export.csv" download>Export CSV</a>
            <button class="icon-btn" data-act="delete" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}">${icon('trash')}</button></td>
        </tr>`).join('')}</tbody></table></div>`
        : empty({ title: 'No size charts yet', body: 'Create a chart in the table editor or import one from a CSV file. Recommendations need at least one chart.', mark: 'table', action: '<div class="row wrap-row" style="justify-content:center"><button class="btn btn-primary btn-sm" data-act="new">Create a size chart</button><button class="btn btn-sm" data-act="template">Download CSV template</button></div>' })}
      <input type="file" accept=".csv,text/csv" class="hide" data-file>`;
  }, { skeletonHtml: skeleton(4, 58) });

  // ---- editor -------------------------------------------------------------
  const rowsHtml = () => draft.rows.map((r, i) => `<tr>
      <td><input class="lbl" data-row="${i}" data-label value="${esc(r.label)}" aria-label="Size label, row ${i + 1}" maxlength="20" placeholder="Size"></td>
      ${draft.keys.map((k) => `<td><div class="pair">
        <input data-row="${i}" data-key="${k}" data-bound="min" inputmode="decimal" value="${esc(r.ranges[k]?.min ?? '')}" aria-label="${MEASUREMENTS[k].label} minimum, size ${esc(r.label)}" placeholder="min">–
        <input data-row="${i}" data-key="${k}" data-bound="max" inputmode="decimal" value="${esc(r.ranges[k]?.max ?? '')}" aria-label="${MEASUREMENTS[k].label} maximum, size ${esc(r.label)}" placeholder="max"></div></td>`).join('')}
      <td class="actions"><button type="button" class="icon-btn" data-act="up" data-row="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 14)}</button><button type="button" class="icon-btn" data-act="down" data-row="${i}" aria-label="Move down" ${i === draft.rows.length - 1 ? 'disabled' : ''}>${icon('down', 14)}</button><button type="button" class="icon-btn" data-act="remove" data-row="${i}" aria-label="Remove size">${icon('trash', 14)}</button></td>
    </tr>`).join('');
  const tableHtml = () => `
    <div class="table-wrap"><table class="chart-table">
      <thead><tr><th>Size</th>${draft.keys.map((k) => `<th>${esc(MEASUREMENTS[k].label)} <span class="faint">(${esc(draft.unit)})</span></th>`).join('')}<th></th></tr></thead>
      <tbody>${rowsHtml() || `<tr><td colspan="${draft.keys.length + 2}" class="muted" style="text-align:center;padding:26px">No sizes yet. Add one below.</td></tr>`}</tbody>
    </table></div>`;

  const editor = () => {
    el.innerHTML = `
      <form class="stack" id="chart-form" novalidate style="--gap:20px">
        <div class="row between wrap-row"><h2 class="h3">${draft.id ? 'Edit size chart' : 'New size chart'}</h2>
          <div class="row wrap-row"><button class="btn btn-sm" type="button" data-act="cancel">Cancel</button><button class="btn btn-primary btn-sm" type="submit">Save chart</button></div></div>
        <p class="notice bad hide" data-form-error role="alert"></p>
        <div class="card stack">
          <div class="grid cols-3">
            ${field('Chart name', `<input class="input" name="name" value="${esc(draft.name)}" maxlength="80" required placeholder="e.g. Men’s tees — regular">`)}
            ${field('Product category', `<select class="select" name="category">${options(CATEGORIES, draft.category)}</select>`)}
            ${field('Fit type', `<select class="select" name="fitType">${options(FITS.map((f) => [f, FIT_LABELS[f]]), draft.fitType)}</select>`, { hint: 'How garments on this chart are cut.' })}
            ${field('Measurement unit', `<select class="select" name="unit">${options([['cm', 'Centimetres'], ['in', 'Inches']], draft.unit)}</select>`)}
            ${field('Values describe', `<select class="select" name="chartType">${options([['body', 'Body measurements'], ['garment', 'Garment measurements']], draft.chartType)}</select>`, { hint: 'Garment values are compared after subtracting wearing ease.' })}
            ${field('Applies to', `<select class="select" name="scope">${options([['brand', 'All products in the category'], ['product', 'Specific products only']], draft.scope)}</select>`)}
          </div>
          <label class="check"><input type="checkbox" name="isActive" ${draft.isActive ? 'checked' : ''}> Active — used for recommendations</label>
        </div>
        <div class="stack" style="--gap:10px"><span class="label">Measurements in this chart</span>
          <div class="chips">${MEASUREMENT_KEYS.map((k) => `<button type="button" class="chip" data-act="key" data-key="${k}" aria-pressed="${draft.keys.includes(k)}">${esc(MEASUREMENTS[k].label)}</button>`).join('')}</div></div>
        <div id="warnings"></div>
        <div id="chart-table">${tableHtml()}</div>
        <div class="row wrap-row between">
          <button class="btn btn-sm" type="button" data-act="add">${icon('plus', 14)} Add size</button>
          <div class="row wrap-row"><button class="btn btn-sm" type="button" data-act="template">CSV template</button><button class="btn btn-sm" type="button" data-act="import">Import CSV</button><button class="btn btn-sm" type="button" data-act="export">Export CSV</button></div>
        </div>
        <p class="small faint">Enter the smallest and largest measurement each size is meant for. Leave both boxes empty where a size has no value. For garment charts a single value can go in both boxes.</p>
        <input type="file" accept=".csv,text/csv" class="hide" data-file>
      </form>`;
  };
  const redrawTable = () => { $('#chart-table', el).innerHTML = tableHtml(); };
  const open = (d, isDirty = false) => { draft = d; dirty = isDirty; editor(); window.scrollTo(0, 0); };

  const importCsv = async (file) => {
    const text = await file.text();
    const unit = draft?.unit ?? 'cm';
    const parsed = parseSizeChartCsv(text, { unit });
    if (parsed.errors.length) {
      modal({
        title: 'This CSV could not be imported',
        wide: true,
        body: `<div class="stack"><p class="muted">Fix the following and import the file again. Nothing was changed.</p>
          <div class="notice bad stack" style="--gap:6px">${parsed.errors.slice(0, 20).map((e) => `<div>${esc(e)}</div>`).join('')}${parsed.errors.length > 20 ? `<div>…and ${parsed.errors.length - 20} more.</div>` : ''}</div>
          <p class="small muted">Expected format — a header row, then one row per size:</p><div class="code">${esc(TEMPLATE)}</div></div>`,
        footer: '<button class="btn btn-primary" data-close>OK</button>',
      });
      return;
    }
    const d = draft ?? { ...blank(), name: file.name.replace(/\.csv$/i, '').slice(0, 80) };
    d.keys = parsed.measurements;
    d.rows = parsed.entries.map((e) => ({ label: e.label, ranges: e.ranges }));
    open(d, true);
    $('#warnings', el).innerHTML = parsed.warnings.length ? `<div class="notice warn stack" style="--gap:4px"><b>Imported with ${parsed.warnings.length} warning${parsed.warnings.length === 1 ? '' : 's'}</b>${parsed.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : '';
    toast(`Imported ${parsed.entries.length} sizes — review and save`);
  };

  // ---- events (bound once) -------------------------------------------------
  on(el, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    const row = Number(btn.dataset.row);
    if (act === 'new') return open(blank());
    if (act === 'template') return download('size-chart-template.csv', TEMPLATE);
    if (act === 'import' || act === 'import-new') return $('[data-file]', el).click();
    if (act === 'edit') return open(fromChart(charts.find((c) => c.id === btn.dataset.id)));
    if (act === 'delete') {
      const c = charts.find((x) => x.id === btn.dataset.id);
      if (!(await confirmDialog({ title: `Delete “${c.name}”?`, body: c.productCount ? `${c.productCount} product${c.productCount === 1 ? ' uses' : 's use'} this chart and will fall back to the brand chart for its category, if one exists.` : 'This size chart will be removed permanently.', confirmText: 'Delete chart', danger: true }))) return;
      try { await api.del(`${base}/${c.id}`); toast('Size chart deleted'); list(); } catch (err) { toastError(err); }
      return;
    }
    if (!draft) return;
    if (act === 'cancel') {
      if (dirty && !(await confirmDialog({ title: 'Discard changes?', body: 'Your edits to this size chart have not been saved.', confirmText: 'Discard', danger: true }))) return;
      return list();
    }
    if (act === 'export') {
      const entries = entriesOf(draft).filter((x) => x.label && Object.keys(x.ranges).length);
      if (!entries.length) return toast('Nothing to export yet', 'bad');
      return download(`${(draft.name || 'size-chart').replace(/[^A-Za-z0-9._-]+/g, '-')}.csv`, sizeChartToCsv(entries));
    }
    dirty = true;
    if (act === 'key') {
      const k = btn.dataset.key;
      draft.keys = draft.keys.includes(k) ? draft.keys.filter((x) => x !== k) : MEASUREMENT_KEYS.filter((x) => x === k || draft.keys.includes(x));
      btn.setAttribute('aria-pressed', String(draft.keys.includes(k)));
    }
    if (act === 'add') draft.rows.push({ label: '', ranges: {} });
    if (act === 'remove') draft.rows.splice(row, 1);
    if (act === 'up' && row > 0) [draft.rows[row - 1], draft.rows[row]] = [draft.rows[row], draft.rows[row - 1]];
    if (act === 'down' && row < draft.rows.length - 1) [draft.rows[row + 1], draft.rows[row]] = [draft.rows[row], draft.rows[row + 1]];
    redrawTable();
    if (act === 'add') $$('#chart-table input.lbl', el).at(-1)?.focus();
  });

  on(el, 'input', '#chart-table input', (e, input) => {
    const r = draft.rows[Number(input.dataset.row)];
    dirty = true;
    if (input.hasAttribute('data-label')) { r.label = input.value; return; }
    const v = input.value.trim().replace(',', '.');
    (r.ranges[input.dataset.key] ??= {})[input.dataset.bound] = v === '' ? '' : Number.isFinite(Number(v)) ? Number(v) : v;
  });
  on(el, 'input', '#chart-form [name]', (e, input) => {
    if (!draft) return;
    dirty = true;
    draft[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  });
  on(el, 'change', '#chart-form [name=unit]', () => redrawTable());
  on(el, 'change', '#chart-form [name=category]', () => {
    // Offer the usual measurements for the new category while the table is still empty.
    if (draft.rows.every((r) => Object.values(r.ranges).every((x) => (x.min ?? '') === '' && (x.max ?? '') === ''))) {
      draft.keys = [...DEFAULT_KEYS[categoryGroup(draft.category)]];
      editor();
    }
  });
  on(el, 'change', '[data-file]', async (e, input) => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 500_000) return toast('That file is too large for a size chart (max 500 KB).', 'bad');
    try { await importCsv(file); } catch (err) { toastError(err); }
  });
  on(el, 'submit', '#chart-form', async (e) => {
    e.preventDefault();
    const banner = $('[data-form-error]', el);
    banner.classList.add('hide');
    const btn = $('#chart-form [type=submit]', el);
    btn.classList.add('loading');
    try {
      if (!draft.keys.length) throw new Error('Select at least one measurement for this chart.');
      const body = { name: draft.name, category: draft.category, fitType: draft.fitType, unit: draft.unit, chartType: draft.chartType, scope: draft.scope, isActive: draft.isActive, entries: entriesOf(draft) };
      if (draft.id) await api.put(`${base}/${draft.id}`, body); else await api.post(base, body);
      toast('Size chart saved');
      list();
    } catch (err) {
      banner.textContent = err.message; banner.classList.remove('hide');
      banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
      btn.classList.remove('loading');
    }
  });

  list();
}
