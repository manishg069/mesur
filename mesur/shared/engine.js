// Size recommendation engine.
//
// Pure, dependency-free and isomorphic: the same module runs on the server
// (API + widget endpoint), in the browser (landing-page demo) and in tests.
//
// Method: transparent weighted range matching.
//   1. Every size in a chart is turned into a set of *body* ranges in cm.
//      - "body" charts already describe the body a size is cut for.
//      - "garment" charts describe the finished garment, so the wearer's body
//        range is garment measurement minus the ease the wearer wants.
//   2. The wearer's measurements are compared against each range. Inside the
//      range scores highest; outside the range the score falls off linearly
//      with the distance, measured in per-measurement tolerances. Being too
//      tight is penalised harder than being too loose.
//   3. Per-measurement scores are combined with category weights
//      (chest matters most for tops, waist for bottoms, ...).
//   4. Sizes that are badly tight on an important measurement are disqualified,
//      and if nothing scores above the minimum the engine says so instead of
//      returning the nearest size.
//   5. Confidence reflects score, how much of the chart could be compared, and
//      how clearly the winner beats the runner-up. It is an estimate.

import { MEASUREMENTS, FITS, categoryGroup } from './measurements.js';
import { CM_PER_INCH } from './units.js';

export const OUT_OF_RANGE_MESSAGE = 'Your measurements fall outside the available size range.';

export const DEFAULT_CONFIG = {
  // Below this match score no size is recommended.
  minMatchScore: 0.6,
  // Score given at the very edge of a range (centre of range = 1).
  inRangeEdgeScore: 0.92,
  // Out-of-range score reaches 0 at this many tolerances outside the range.
  falloffTolerances: 2.5,
  // Tight deviations count this much more than loose ones.
  tightPenalty: 1.4,
  // A size is disqualified if a heavily weighted measurement is tight by more
  // than this many tolerances.
  criticalTightTolerances: 1,
  criticalWeight: 0.25,
  // Winner/runner-up gap below which the wearer is "between sizes".
  closeMargin: 0.04,
  confidence: { high: 0.85, medium: 0.7, highCoverage: 0.7, mediumCoverage: 0.4 },
  // How far outside a range (cm) still counts as an acceptable fit.
  tolerances: { chest: 4, waist: 4, hip: 4, shoulder: 2, neck: 1.5, thigh: 3, arm: 3, inseam: 4, height: 8 },
  // Half-width (as a share of tolerance) of the body band around a single
  // garment measurement.
  garmentBand: 0.6,
  // Relative importance of each measurement per garment group.
  weights: {
    tops: { chest: 0.45, shoulder: 0.25, waist: 0.15, arm: 0.05, neck: 0.05, height: 0.05 },
    bottoms: { waist: 0.45, hip: 0.3, inseam: 0.1, thigh: 0.1, height: 0.05 },
    dresses: { chest: 0.35, waist: 0.3, hip: 0.3, shoulder: 0.05 },
  },
  required: { tops: ['chest'], bottoms: ['waist'], dresses: ['chest', 'waist'] },
  // Recommended ease in cm: garment measurement minus body measurement.
  // Measurements not listed (lengths) carry no ease.
  ease: {
    tops: {
      chest: { slim: 6, regular: 10, relaxed: 14, oversized: 18 },
      waist: { slim: 6, regular: 10, relaxed: 15, oversized: 20 },
      shoulder: { slim: 0, regular: 1, relaxed: 2, oversized: 4 },
      neck: { slim: 1, regular: 1.5, relaxed: 2, oversized: 2.5 },
    },
    bottoms: {
      waist: { slim: 0, regular: 1, relaxed: 2.5, oversized: 4 },
      hip: { slim: 3, regular: 5, relaxed: 8, oversized: 12 },
      thigh: { slim: 3, regular: 5, relaxed: 8, oversized: 12 },
    },
    dresses: {
      chest: { slim: 4, regular: 7, relaxed: 11, oversized: 16 },
      waist: { slim: 4, regular: 8, relaxed: 13, oversized: 20 },
      hip: { slim: 4, regular: 7, relaxed: 11, oversized: 16 },
      shoulder: { slim: 0, regular: 1, relaxed: 2, oversized: 4 },
    },
  },
};

/** Shallow-merge a partial config over the defaults (one level deep). */
export function resolveConfig(overrides) {
  if (!overrides) return DEFAULT_CONFIG;
  const out = { ...DEFAULT_CONFIG };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...DEFAULT_CONFIG[k], ...v } : v;
  }
  return out;
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r1 = (v) => Math.round(v * 10) / 10;

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
const mLabel = (key) => (MEASUREMENTS[key]?.label ?? key).toLowerCase();

/** Chart ranges converted to cm, sorted by size order. */
export function normaliseChart(chart) {
  const factor = chart.unit === 'in' ? CM_PER_INCH : 1;
  const entries = [...(chart.entries ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((e) => {
      const ranges = {};
      for (const [key, range] of Object.entries(e.ranges ?? {})) {
        if (!MEASUREMENTS[key] || !range) continue;
        let min = num(range.min);
        let max = num(range.max);
        if (min === null && max === null) continue;
        if (min === null) min = max;
        if (max === null) max = min;
        if (min > max) [min, max] = [max, min];
        ranges[key] = { min: min * factor, max: max * factor };
      }
      return { label: String(e.label), sort_order: e.sort_order ?? 0, ranges };
    });
  return { ...chart, entries };
}

/** Ease (cm) a wearer wants for a measurement, or null if the measurement carries no ease. */
function easeFor(config, group, key, fit) {
  const table = config.ease[group]?.[key];
  return table ? table[fit] ?? table.regular : null;
}

function scoreAgainstRange(value, min, max, tolerance, config) {
  if (value >= min && value <= max) {
    const half = (max - min) / 2;
    const pos = half > 0 ? Math.abs(value - (min + half)) / half : 0;
    return { status: 'within', delta: 0, tolerances: 0, score: 1 - (1 - config.inRangeEdgeScore) * pos };
  }
  const tight = value > max;
  const delta = tight ? value - max : min - value;
  const tolerances = delta / tolerance;
  const effective = tight ? tolerances * config.tightPenalty : tolerances;
  const score = Math.max(0, config.inRangeEdgeScore * (1 - effective / config.falloffTolerances));
  return { status: tight ? 'tight' : 'loose', delta, tolerances, score };
}

/**
 * Recommend a size.
 *
 * @param {object} input
 * @param {object} input.profile  body measurements in cm, e.g. { height, chest, waist, shoulder }
 * @param {object} input.chart    { category, fit_type, unit: 'cm'|'in', chart_type: 'body'|'garment',
 *                                  entries: [{ label, sort_order, ranges: { chest: {min,max}, ... } }] }
 * @param {object} [input.product] { category, fit_type, available_sizes: string[], ease: { chest: number } }
 * @param {string} [input.fitPreference] slim | regular | relaxed | oversized
 * @param {object} [input.config] partial override of DEFAULT_CONFIG
 * @returns {object} result with `status`: ok | insufficient_data | out_of_range | no_chart
 */
export function recommendSize({ profile, chart, product = null, fitPreference = 'regular', config: overrides } = {}) {
  const config = resolveConfig(overrides);
  const preference = FITS.includes(fitPreference) ? fitPreference : 'regular';

  if (!chart || !Array.isArray(chart.entries) || chart.entries.length === 0) {
    return { status: 'no_chart', message: 'No size chart is available for this product yet.' };
  }

  const category = product?.category ?? chart.category ?? 'other';
  const group = categoryGroup(category);
  const garmentFit = FITS.includes(product?.fit_type) ? product.fit_type : FITS.includes(chart.fit_type) ? chart.fit_type : 'regular';
  const chartType = chart.chart_type === 'garment' ? 'garment' : 'body';
  const weights = config.weights[group];
  const norm = normaliseChart(chart);

  const available = Array.isArray(product?.available_sizes) && product.available_sizes.length
    ? new Set(product.available_sizes.map(String))
    : null;
  const entries = norm.entries.filter((e) => !available || available.has(e.label));
  if (entries.length === 0) {
    return { status: 'no_chart', message: 'None of the sizes in the chart are currently available for this product.' };
  }

  const body = {};
  for (const key of Object.keys(MEASUREMENTS)) body[key] = num(profile?.[key]);

  // Measurements the chart can be compared on.
  const chartKeys = Object.keys(weights).filter((k) => weights[k] > 0 && entries.some((e) => e.ranges[k]));
  const usedKeys = chartKeys.filter((k) => body[k] !== null);
  const missingRequired = config.required[group].filter((k) => entries.some((e) => e.ranges[k]) && body[k] === null);
  const missingOptional = chartKeys.filter((k) => body[k] === null && !missingRequired.includes(k));

  if (chartKeys.length === 0) {
    return { status: 'no_chart', message: 'This size chart has no measurements the engine can compare for this category.' };
  }
  if (missingRequired.length || usedKeys.length === 0) {
    const missing = missingRequired.length ? missingRequired : chartKeys;
    return {
      status: 'insufficient_data',
      missing,
      message: `Add your ${joinList(missing.map(mLabel))} measurement${missing.length > 1 ? 's' : ''} to get a recommendation for this product.`,
    };
  }

  // Fit preference. For body charts the wearer's measurement is shifted by the
  // difference between the ease they want and the ease the garment is cut with.
  // For garment charts the wanted ease is subtracted from the garment directly.
  const adjustments = {};
  const designEase = (key) => {
    const override = num(product?.ease?.[key]);
    return override !== null ? override : easeFor(config, group, key, garmentFit);
  };
  const wantedEase = (key) => easeFor(config, group, key, preference);

  const evaluate = (entry) => {
    const parts = [];
    let weightSum = 0;
    for (const key of usedKeys) {
      const range = entry.ranges[key];
      if (!range) continue;
      const tolerance = config.tolerances[key] ?? 4;
      let { min, max } = range;
      let effective = body[key];
      const wanted = wantedEase(key);
      if (chartType === 'garment') {
        if (wanted !== null) {
          const band = tolerance * config.garmentBand;
          min = min - wanted - band;
          max = max - wanted + band;
        } else {
          // Lengths: the garment should match the body within half a tolerance.
          min -= tolerance / 2;
          max += tolerance / 2;
        }
      } else if (wanted !== null) {
        const shift = wanted - designEase(key);
        effective = body[key] + shift;
        if (shift !== 0) adjustments[key] = r1(shift);
      }
      const s = scoreAgainstRange(effective, min, max, tolerance, config);
      weightSum += weights[key];
      parts.push({
        key, label: MEASUREMENTS[key].label, body: r1(body[key]), compared: r1(effective),
        min: r1(min), max: r1(max), status: s.status, delta: r1(s.delta), tolerances: s.tolerances,
        score: s.score, weight: weights[key],
      });
    }
    if (parts.length === 0) return { label: entry.label, sort_order: entry.sort_order, score: 0, parts, comparable: false };
    let score = 0;
    for (const p of parts) {
      p.weight = p.weight / weightSum;
      score += p.weight * p.score;
    }
    const critical = parts.find((p) => p.status === 'tight' && p.weight >= config.criticalWeight && p.tolerances > config.criticalTightTolerances);
    return {
      label: entry.label, sort_order: entry.sort_order, score, parts, comparable: true,
      disqualified: Boolean(critical),
      disqualifiedReason: critical ? `${critical.label} is ${critical.delta} cm above this size's range.` : null,
    };
  };

  const evaluated = entries.map(evaluate).filter((e) => e.comparable);
  const ranked = [...evaluated].sort((a, b) => b.score - a.score || countTight(a) - countTight(b) || b.sort_order - a.sort_order);
  const eligible = ranked.filter((e) => !e.disqualified);
  const best = eligible[0];

  const fit = {
    requested: preference,
    garmentFit,
    chartType,
    applied: chartType === 'garment' ? usedKeys.some((k) => wantedEase(k) !== null) : Object.keys(adjustments).length > 0,
    adjustments: chartType === 'garment' ? {} : adjustments,
    note: fitNote(preference, garmentFit, chartType, adjustments),
  };
  const publicSize = (e) => ({
    label: e.label,
    matchScore: Math.round(e.score * 100),
    disqualified: Boolean(e.disqualified),
    disqualifiedReason: e.disqualifiedReason ?? null,
    comparison: e.parts.map(({ tolerances, score, ...p }) => ({ ...p, weight: Math.round(p.weight * 100), score: Math.round(score * 100) })),
  });
  const base = {
    category, group, fit, usedMeasurements: usedKeys, missingOptional,
    sizes: evaluated.sort((a, b) => a.sort_order - b.sort_order).map(publicSize),
  };

  if (!best || best.score < config.minMatchScore) {
    const primary = usedKeys[0];
    const nearest = ranked[0];
    const p = nearest?.parts.find((x) => x.key === primary) ?? nearest?.parts[0];
    const direction = !p || p.status === 'within' ? 'mixed' : p.status === 'tight' ? 'above' : 'below';
    return {
      ...base,
      status: 'out_of_range',
      message: OUT_OF_RANGE_MESSAGE,
      direction,
      nearest: nearest ? publicSize(nearest) : null,
      explanation: direction === 'above'
        ? `Your ${mLabel(p.key)} is larger than the largest size this chart covers well, so we are not recommending a size.`
        : direction === 'below'
          ? `Your ${mLabel(p.key)} is smaller than the smallest size this chart covers well, so we are not recommending a size.`
          : 'Your measurements point to different sizes that are too far apart for any single size to fit well.',
    };
  }

  const runnerUp = eligible[1] ?? null;
  const margin = runnerUp ? best.score - runnerUp.score : 1;

  // Coverage: share of the chart's comparable weight the profile could fill.
  const totalWeight = chartKeys.reduce((s, k) => s + weights[k], 0);
  const coverage = usedKeys.reduce((s, k) => s + weights[k], 0) / totalWeight;
  const tightParts = best.parts.filter((p) => p.status === 'tight');
  const looseParts = best.parts.filter((p) => p.status === 'loose');

  const reasons = [];
  let level = 'low';
  const c = config.confidence;
  if (best.score >= c.high && coverage >= c.highCoverage) level = 'high';
  else if (best.score >= c.medium && coverage >= c.mediumCoverage) level = 'medium';
  if (level === 'high' && (margin < config.closeMargin || tightParts.length)) level = 'medium';
  if (margin < config.closeMargin && runnerUp) reasons.push(`You are between ${best.label} and ${runnerUp.label}.`);
  if (missingOptional.length) reasons.push(`Adding your ${joinList(missingOptional.map(mLabel))} would make this estimate more reliable.`);
  if (tightParts.length) reasons.push(`${joinList(tightParts.map((p) => p.label))} sit${tightParts.length === 1 ? 's' : ''} above this size's range.`);
  if (best.score < c.medium) reasons.push('No size matches all of your measurements closely.');

  const fitNotes = [
    ...tightParts.map((p) => ({ key: p.key, type: 'tight', text: `${p.label} may feel tight — ${p.delta} cm above this size's range.` })),
    ...looseParts.map((p) => ({ key: p.key, type: 'loose', text: `${p.label} may feel loose — ${p.delta} cm below this size's range.` })),
  ];

  let explanation = `Based on your ${joinList(usedKeys.map(mLabel))} measurement${usedKeys.length > 1 ? 's' : ''}, ${best.label} is the closest match for this product.`;
  if (fit.applied && preference !== garmentFit) explanation += ` Adjusted for your ${preference} fit preference.`;

  return {
    ...base,
    status: 'ok',
    recommended: publicSize(best),
    size: best.label,
    matchScore: Math.round(best.score * 100),
    confidence: {
      level,
      coverage: Math.round(coverage * 100),
      margin: Math.round(margin * 100),
      reasons,
      disclaimer: 'Confidence is an estimate based on the size chart, not a guarantee of fit.',
    },
    nextClosest: runnerUp ? publicSize(runnerUp) : null,
    alternatives: eligible.slice(1, 3).map(publicSize),
    fitNotes,
    explanation,
  };
}

function countTight(e) {
  return e.parts.filter((p) => p.status === 'tight').length;
}

function fitNote(preference, garmentFit, chartType, adjustments) {
  if (chartType === 'garment') {
    return `Garment measurements were compared with your body plus the ease of a ${preference} fit.`;
  }
  if (Object.keys(adjustments).length === 0) {
    return preference === garmentFit
      ? `This product is cut as a ${garmentFit} fit, matching your preference, so no adjustment was needed.`
      : 'No ease information applies to the measurements in this chart, so the preference did not change the result.';
  }
  const dir = Object.values(adjustments)[0] > 0 ? 'roomier' : 'closer';
  return `This product is cut as a ${garmentFit} fit. You prefer ${preference}, so sizes were matched for a ${dir} fit.`;
}
