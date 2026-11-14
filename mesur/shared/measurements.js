// Shared domain definitions. Used by the server, the browser app and the widget.
// All canonical values are stored in centimetres.

export const MEASUREMENTS = {
  height: {
    label: 'Height', min: 120, max: 230, required: true,
    help: 'Stand straight against a wall without shoes. Measure from the floor to the top of your head.',
  },
  chest: {
    label: 'Chest', min: 60, max: 170, required: true,
    help: 'Wrap the tape around the fullest part of your chest, under the arms, keeping it level and relaxed.',
  },
  waist: {
    label: 'Waist', min: 45, max: 170, required: false,
    help: 'Measure around your natural waistline, the narrowest part of your torso, usually just above the navel.',
  },
  shoulder: {
    label: 'Shoulders', min: 28, max: 65, required: false,
    help: 'Measure straight across your back from the edge of one shoulder bone to the other.',
  },
  hip: {
    label: 'Hips', min: 55, max: 180, required: false,
    help: 'Stand with feet together and measure around the fullest part of your hips and seat.',
  },
  arm: {
    label: 'Arm length', min: 40, max: 95, required: false,
    help: 'With your arm slightly bent, measure from the shoulder bone, over the elbow, down to the wrist.',
  },
  inseam: {
    label: 'Inseam', min: 50, max: 110, required: false,
    help: 'Measure along the inside of your leg from the crotch to the ankle bone.',
  },
  thigh: {
    label: 'Thigh', min: 30, max: 100, required: false,
    help: 'Measure around the fullest part of one thigh, just below the seat.',
  },
  neck: {
    label: 'Neck', min: 25, max: 60, required: false,
    help: 'Measure around the base of your neck where a collar would sit, with one finger of slack.',
  },
};

export const MEASUREMENT_KEYS = Object.keys(MEASUREMENTS);
export const REQUIRED_KEYS = MEASUREMENT_KEYS.filter((k) => MEASUREMENTS[k].required);

export const FITS = ['slim', 'regular', 'relaxed', 'oversized'];
export const FIT_LABELS = { slim: 'Slim fit', regular: 'Regular fit', relaxed: 'Relaxed fit', oversized: 'Oversized fit' };

export const CATEGORIES = [
  { id: 'tshirts', label: 'T-shirts', group: 'tops' },
  { id: 'shirts', label: 'Shirts', group: 'tops' },
  { id: 'hoodies', label: 'Hoodies', group: 'tops' },
  { id: 'sweatshirts', label: 'Sweatshirts', group: 'tops' },
  { id: 'jackets', label: 'Jackets', group: 'tops' },
  { id: 'trousers', label: 'Trousers', group: 'bottoms' },
  { id: 'jeans', label: 'Jeans', group: 'bottoms' },
  { id: 'shorts', label: 'Shorts', group: 'bottoms' },
  { id: 'dresses', label: 'Dresses', group: 'dresses' },
  { id: 'other', label: 'Other', group: 'tops' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
export function categoryGroup(id) {
  return CATEGORIES.find((c) => c.id === id)?.group ?? 'tops';
}

// Which measurements each garment group needs before a recommendation is possible,
// and which extra ones sharpen it.
export const GROUP_REQUIREMENTS = {
  tops: { required: ['chest'], helpful: ['shoulder', 'waist'] },
  bottoms: { required: ['waist'], helpful: ['hip', 'inseam'] },
  dresses: { required: ['chest', 'waist'], helpful: ['hip'] },
};

/** Validate one measurement value in cm. Returns an error string or null. */
export function validateMeasurement(key, valueCm) {
  const def = MEASUREMENTS[key];
  if (!def) return 'Unknown measurement.';
  if (valueCm === null || valueCm === undefined || valueCm === '') {
    return def.required ? `${def.label} is required.` : null;
  }
  const n = Number(valueCm);
  if (!Number.isFinite(n)) return `${def.label} must be a number.`;
  if (n < def.min || n > def.max) {
    return `${def.label} should be between ${def.min} and ${def.max} cm.`;
  }
  return null;
}

/** Share of the profile that is filled in, required fields weighted double. */
export function profileCompletion(profile) {
  let total = 0;
  let done = 0;
  for (const key of MEASUREMENT_KEYS) {
    const w = MEASUREMENTS[key].required ? 2 : 1;
    total += w;
    if (profile && Number.isFinite(Number(profile[key])) && profile[key] !== null && profile[key] !== '') done += w;
  }
  return Math.round((done / total) * 100);
}

/** For each garment group: is the profile sufficient, and what is missing. */
export function categoryReadiness(profile) {
  const has = (k) => profile && profile[k] !== null && profile[k] !== undefined && profile[k] !== '';
  return Object.entries(GROUP_REQUIREMENTS).map(([group, req]) => ({
    group,
    ready: req.required.every(has),
    missingRequired: req.required.filter((k) => !has(k)),
    missingHelpful: req.helpful.filter((k) => !has(k)),
  }));
}
