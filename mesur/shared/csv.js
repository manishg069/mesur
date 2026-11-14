// CSV import/export for size charts.
//
// Format: first column "size", then pairs of "<measurement>_min" and
// "<measurement>_max" (e.g. chest_min, chest_max). Headers are case-insensitive
// and "Chest Min" / "Shoulders Max" are accepted. A bare "<measurement>" column
// is treated as a single value (min = max), which suits garment charts.

import { MEASUREMENTS, MEASUREMENT_KEYS } from './measurements.js';
import { cmToIn } from './units.js';

const ALIASES = { shoulders: 'shoulder', hips: 'hip', arm_length: 'arm', sleeve: 'arm', inseam_length: 'inseam', thighs: 'thigh', bust: 'chest' };

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseHeader(raw) {
  const h = raw.trim().toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[\s-]+/g, '_');
  if (h === 'size' || h === 'label' || h === 'size_label') return { type: 'size' };
  const m = h.match(/^(.*?)_(min|max)$/);
  const name = m ? m[1] : h;
  const key = ALIASES[name] ?? name;
  if (!MEASUREMENT_KEYS.includes(key)) return { type: 'unknown', raw };
  return { type: 'measurement', key, bound: m ? m[2] : 'both' };
}

/**
 * Parse and validate a size chart CSV.
 * @returns {{ entries: Array, errors: string[], warnings: string[], measurements: string[] }}
 */
export function parseSizeChartCsv(text, { unit = 'cm' } = {}) {
  const errors = [];
  const warnings = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { entries: [], errors: ['The file is empty.'], warnings, measurements: [] };

  const headers = rows[0].map(parseHeader);
  const sizeCol = headers.findIndex((h) => h.type === 'size');
  if (sizeCol === -1) errors.push('Missing a "size" column. The first row must be a header such as: size,chest_min,chest_max');
  headers.forEach((h, i) => {
    if (h.type === 'unknown' && rows[0][i].trim() !== '') {
      errors.push(`Unknown column "${rows[0][i].trim()}". Allowed measurements: ${MEASUREMENT_KEYS.join(', ')}.`);
    }
  });
  const measurements = [...new Set(headers.filter((h) => h.type === 'measurement').map((h) => h.key))];
  if (measurements.length === 0) errors.push('No measurement columns found. Add at least one pair such as chest_min and chest_max.');
  for (const key of measurements) {
    const bounds = headers.filter((h) => h.key === key).map((h) => h.bound);
    if (!bounds.includes('both') && !(bounds.includes('min') && bounds.includes('max'))) {
      errors.push(`Column "${key}_${bounds[0]}" needs a matching "${key}_${bounds[0] === 'min' ? 'max' : 'min'}" column.`);
    }
  }
  if (rows.length === 1) errors.push('The file has a header but no size rows.');
  if (rows.length > 61) errors.push('A size chart can have at most 60 sizes.');
  if (errors.length) return { entries: [], errors, warnings, measurements };

  const entries = [];
  const seen = new Set();
  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    const label = (row[sizeCol] ?? '').trim();
    if (!label) { errors.push(`Row ${line}: size label is empty.`); return; }
    if (label.length > 20) { errors.push(`Row ${line}: size label "${label}" is longer than 20 characters.`); return; }
    if (seen.has(label.toLowerCase())) { errors.push(`Row ${line}: size "${label}" appears more than once.`); return; }
    seen.add(label.toLowerCase());

    const ranges = {};
    headers.forEach((h, i) => {
      if (h.type !== 'measurement') return;
      const cell = (row[i] ?? '').trim().replace(',', '.');
      if (cell === '') return;
      const value = Number(cell);
      if (!Number.isFinite(value) || value <= 0) {
        errors.push(`Row ${line} (${label}): "${row[i].trim()}" in ${rows[0][i].trim()} is not a positive number.`);
        return;
      }
      ranges[h.key] ??= {};
      if (h.bound === 'both') { ranges[h.key].min = value; ranges[h.key].max = value; }
      else ranges[h.key][h.bound] = value;
    });

    for (const [key, range] of Object.entries(ranges)) {
      const def = MEASUREMENTS[key];
      if (range.min === undefined || range.max === undefined) {
        errors.push(`Row ${line} (${label}): ${def.label} needs both a minimum and a maximum.`);
        continue;
      }
      if (range.min > range.max) {
        errors.push(`Row ${line} (${label}): ${def.label} minimum (${range.min}) is greater than its maximum (${range.max}).`);
        continue;
      }
      // Plausibility window is generous: garment charts exceed body limits.
      const lo = unit === 'in' ? cmToIn(def.min * 0.6) : def.min * 0.6;
      const hi = unit === 'in' ? cmToIn(def.max * 1.3) : def.max * 1.3;
      if (range.min < lo || range.max > hi) {
        errors.push(`Row ${line} (${label}): ${def.label} ${range.min}–${range.max} ${unit} looks unrealistic. Check the unit of the chart.`);
      }
    }
    if (Object.keys(ranges).length === 0) { errors.push(`Row ${line} (${label}): no measurements given.`); return; }
    const missing = measurements.filter((k) => !ranges[k]);
    if (missing.length) warnings.push(`Row ${line} (${label}): no value for ${missing.join(', ')}.`);
    entries.push({ label, sort_order: entries.length, ranges });
  });

  // Sizes should grow monotonically; a chart that shrinks is almost always a typo.
  for (const key of measurements) {
    let prev = null;
    for (const e of entries) {
      const r = e.ranges[key];
      if (!r) continue;
      if (prev && r.min < prev.min) {
        warnings.push(`${MEASUREMENTS[key].label}: size ${e.label} starts below the previous size. Check the row order.`);
        break;
      }
      prev = r;
    }
  }
  return { entries: errors.length ? [] : entries, errors, warnings, measurements };
}

const quote = (v) => (/[",\n\r;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Serialise chart entries to the same format `parseSizeChartCsv` reads. */
export function sizeChartToCsv(entries) {
  const keys = MEASUREMENT_KEYS.filter((k) => entries.some((e) => e.ranges?.[k]));
  const header = ['size', ...keys.flatMap((k) => [`${k}_min`, `${k}_max`])];
  const lines = [...entries]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((e) => [e.label, ...keys.flatMap((k) => [e.ranges?.[k]?.min ?? '', e.ranges?.[k]?.max ?? ''])].map(quote).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}
