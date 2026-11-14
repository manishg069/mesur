// Unit conversion. Canonical storage unit is centimetres.

export const CM_PER_INCH = 2.54;

export function cmToIn(cm) {
  return cm / CM_PER_INCH;
}
export function inToCm(inches) {
  return inches * CM_PER_INCH;
}
export function round(value, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Convert a user-entered value in `unit` to canonical cm (1 decimal). */
export function toCm(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return round(unit === 'in' ? inToCm(n) : n, 1);
}

/** Convert canonical cm to a display number in `unit`. */
export function fromCm(cm, unit) {
  if (cm === null || cm === undefined || cm === '') return null;
  const n = Number(cm);
  if (!Number.isFinite(n)) return null;
  return unit === 'in' ? round(cmToIn(n), 1) : round(n, 1);
}

/** "96 cm" / "37.8 in". Trailing ".0" is dropped. */
export function formatLength(cm, unit = 'cm') {
  const v = fromCm(cm, unit);
  if (v === null) return '—';
  return `${String(v)} ${unit}`;
}
