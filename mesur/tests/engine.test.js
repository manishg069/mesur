import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { recommendSize, normaliseChart, OUT_OF_RANGE_MESSAGE, DEFAULT_CONFIG } from '../shared/engine.js';

const range = (min, max) => ({ min, max });
const entry = (label, i, ranges) => ({ label, sort_order: i, ranges });

// Brand A from the product brief.
const brandA = {
  category: 'tshirts', fit_type: 'regular', unit: 'cm', chart_type: 'body',
  entries: [
    entry('S', 0, { chest: range(88, 92), waist: range(74, 78), shoulder: range(42, 43) }),
    entry('M', 1, { chest: range(93, 98), waist: range(79, 84), shoulder: range(44, 45) }),
    entry('L', 2, { chest: range(99, 104), waist: range(85, 90), shoulder: range(46, 47) }),
  ],
};
// A brand that cuts smaller: the same body lands one size up.
const brandB = {
  ...brandA,
  entries: [
    entry('S', 0, { chest: range(82, 87), waist: range(68, 73), shoulder: range(40, 41) }),
    entry('M', 1, { chest: range(88, 93), waist: range(74, 79), shoulder: range(42, 43) }),
    entry('L', 2, { chest: range(94, 99), waist: range(80, 85), shoulder: range(44, 45) }),
    entry('XL', 3, { chest: range(100, 106), waist: range(86, 92), shoulder: range(46, 47) }),
  ],
};
const profile = { height: 170, chest: 96, waist: 82, shoulder: 44 };

describe('core matching', () => {
  test('brief example: 96/82/44 on Brand A recommends M with high confidence', () => {
    const r = recommendSize({ profile, chart: brandA });
    assert.equal(r.status, 'ok');
    assert.equal(r.size, 'M');
    assert.ok(r.matchScore >= 90, `score ${r.matchScore}`);
    assert.equal(r.confidence.level, 'high');
    assert.match(r.explanation, /chest, shoulders and waist|chest, waist and shoulders/);
    assert.ok(r.confidence.disclaimer.includes('not a guarantee'));
  });

  test('same body, different brand chart gives a different size', () => {
    assert.equal(recommendSize({ profile, chart: brandB }).size, 'L');
  });

  test('returns next closest size and a per-measurement comparison', () => {
    const r = recommendSize({ profile, chart: brandA });
    assert.ok(['S', 'L'].includes(r.nextClosest.label));
    assert.deepEqual(r.recommended.comparison.map((c) => c.key).sort(), ['chest', 'shoulder', 'waist']);
    assert.ok(r.recommended.comparison.every((c) => c.status === 'within'));
    assert.equal(r.sizes.length, 3);
  });

  test('centre of the range scores higher than the edge', () => {
    const centre = recommendSize({ profile: { chest: 95.5 }, chart: brandA });
    const edge = recommendSize({ profile: { chest: 98 }, chart: brandA });
    assert.equal(centre.matchScore, 100);
    assert.ok(edge.matchScore < centre.matchScore);
    assert.equal(edge.size, 'M');
  });

  test('between two sizes prefers the larger (tight is penalised more than loose)', () => {
    const r = recommendSize({ profile: { chest: 98.5, waist: 84.5, shoulder: 45.5 }, chart: brandA });
    assert.equal(r.size, 'L');
    assert.equal(r.nextClosest.label, 'M');
    assert.notEqual(r.confidence.level, 'high');
    assert.ok(r.confidence.reasons.some((x) => x.includes('between')));
  });

  test('weights: chest outweighs waist for tops', () => {
    // Chest says M, waist says L.
    const r = recommendSize({ profile: { chest: 95, waist: 87, shoulder: 44.5 }, chart: brandA });
    assert.equal(r.size, 'M');
    assert.ok(r.fitNotes.some((n) => n.key === 'waist' && n.type === 'tight'));
    assert.notEqual(r.confidence.level, 'high');
  });

  test('weights are configurable', () => {
    const config = { weights: { ...DEFAULT_CONFIG.weights, tops: { chest: 0.1, waist: 0.8, shoulder: 0.1 } }, criticalWeight: 0.9 };
    const r = recommendSize({ profile: { chest: 95, waist: 87, shoulder: 44.5 }, chart: brandA, config });
    assert.equal(r.size, 'L');
  });
});

describe('missing and insufficient data', () => {
  test('missing required measurement asks for it', () => {
    const r = recommendSize({ profile: { height: 170, waist: 82 }, chart: brandA });
    assert.equal(r.status, 'insufficient_data');
    assert.deepEqual(r.missing, ['chest']);
    assert.match(r.message, /chest/);
  });

  test('chest only still works but lowers confidence and lists what to add', () => {
    const r = recommendSize({ profile: { height: 170, chest: 96 }, chart: brandA });
    assert.equal(r.status, 'ok');
    assert.equal(r.size, 'M');
    assert.notEqual(r.confidence.level, 'high');
    assert.deepEqual(r.missingOptional.sort(), ['shoulder', 'waist']);
  });

  test('bottoms need a waist measurement', () => {
    const jeans = {
      category: 'jeans', fit_type: 'regular', unit: 'cm', chart_type: 'body',
      entries: [entry('30', 0, { waist: range(76, 79), hip: range(94, 97) }), entry('32', 1, { waist: range(80, 84), hip: range(98, 102) })],
    };
    assert.equal(recommendSize({ profile: { height: 170, chest: 96 }, chart: jeans }).status, 'insufficient_data');
    const ok = recommendSize({ profile: { waist: 82, hip: 100 }, chart: jeans });
    assert.equal(ok.size, '32');
  });

  test('no chart / empty chart', () => {
    assert.equal(recommendSize({ profile, chart: null }).status, 'no_chart');
    assert.equal(recommendSize({ profile, chart: { entries: [] } }).status, 'no_chart');
  });

  test('empty-string and null measurements are treated as missing, not zero', () => {
    const r = recommendSize({ profile: { chest: '', waist: null }, chart: brandA });
    assert.equal(r.status, 'insufficient_data');
  });
});

describe('out of range and poor fits', () => {
  test('far above the largest size returns the out-of-range message', () => {
    const r = recommendSize({ profile: { chest: 125, waist: 110, shoulder: 52 }, chart: brandA });
    assert.equal(r.status, 'out_of_range');
    assert.equal(r.message, OUT_OF_RANGE_MESSAGE);
    assert.equal(r.direction, 'above');
    assert.equal(r.size, undefined);
  });

  test('far below the smallest size', () => {
    const r = recommendSize({ profile: { chest: 70, waist: 58, shoulder: 36 }, chart: brandA });
    assert.equal(r.status, 'out_of_range');
    assert.equal(r.direction, 'below');
  });

  test('does not blindly return the nearest size when chest is clearly too big for it', () => {
    // 110 cm chest is 6 cm above L: the nearest size, but not a fit.
    const r = recommendSize({ profile: { chest: 110 }, chart: brandA });
    assert.equal(r.status, 'out_of_range');
    assert.equal(r.nearest.label, 'L');
    assert.equal(r.nearest.disqualified, true);
  });

  test('slightly above the largest size is still recommended, with a tightness note', () => {
    const r = recommendSize({ profile: { chest: 105.5, waist: 90, shoulder: 47 }, chart: brandA });
    assert.equal(r.status, 'ok');
    assert.equal(r.size, 'L');
    assert.ok(r.fitNotes.some((n) => n.type === 'tight' && n.key === 'chest'));
    assert.notEqual(r.confidence.level, 'high');
  });

  test('wildly conflicting measurements produce no recommendation', () => {
    const r = recommendSize({ profile: { chest: 89, waist: 104, shoulder: 49 }, chart: brandA });
    assert.equal(r.status, 'out_of_range');
  });
});

describe('fit preference and ease', () => {
  test('preference equal to the garment cut changes nothing', () => {
    const r = recommendSize({ profile, chart: brandA, fitPreference: 'regular' });
    assert.equal(r.fit.applied, false);
    assert.equal(r.size, 'M');
  });

  test('oversized preference on a regular garment sizes up', () => {
    const r = recommendSize({ profile, chart: brandB, fitPreference: 'oversized' });
    assert.equal(r.status, 'ok');
    assert.equal(r.size, 'XL');
    assert.equal(r.fit.applied, true);
    assert.ok(r.fit.adjustments.chest > 0);
  });

  test('slim preference on a regular garment never sizes up', () => {
    const order = ['S', 'M', 'L'];
    const regular = recommendSize({ profile: { chest: 99.5, waist: 85, shoulder: 46 }, chart: brandA });
    const slim = recommendSize({ profile: { chest: 99.5, waist: 85, shoulder: 46 }, chart: brandA, fitPreference: 'slim' });
    assert.equal(regular.size, 'L');
    assert.ok(order.indexOf(slim.size) <= order.indexOf(regular.size));
    assert.equal(slim.size, 'M');
  });

  test('oversized garment + oversized preference = true to size', () => {
    const product = { category: 'tshirts', fit_type: 'oversized' };
    const r = recommendSize({ profile, chart: brandA, product, fitPreference: 'oversized' });
    assert.equal(r.size, 'M');
    assert.equal(r.fit.applied, false);
  });

  test('product-specific ease overrides the default for its cut', () => {
    // A boxy tee declared with 18 cm chest ease behaves like an oversized cut.
    const product = { category: 'tshirts', fit_type: 'regular', ease: { chest: 18, waist: 20, shoulder: 4 } };
    const r = recommendSize({ profile, chart: brandA, product, fitPreference: 'regular' });
    assert.equal(r.size, 'S');
  });

  test('garment charts: body + ease is compared, not body = garment', () => {
    const garment = {
      category: 'tshirts', fit_type: 'regular', unit: 'cm', chart_type: 'garment',
      entries: [entry('S', 0, { chest: range(98, 98) }), entry('M', 1, { chest: range(104, 104) }), entry('L', 2, { chest: range(110, 110) }), entry('XL', 3, { chest: range(116, 116) })],
    };
    // 96 body + 10 regular ease = 106 → closest garment is M (104) or L (110): 106 sits in M's band.
    const regular = recommendSize({ profile: { chest: 96 }, chart: garment, fitPreference: 'regular' });
    assert.equal(regular.size, 'M');
    // A garment whose chest equals the body (96 → size "S" is 98) must not win.
    assert.notEqual(regular.size, 'S');
    const oversized = recommendSize({ profile: { chest: 96 }, chart: garment, fitPreference: 'oversized' });
    assert.equal(oversized.size, 'XL');
    // 93 cm body: regular wants ~103 cm of garment (M), slim wants ~99 cm (S).
    assert.equal(recommendSize({ profile: { chest: 93 }, chart: garment, fitPreference: 'regular' }).size, 'M');
    const slim = recommendSize({ profile: { chest: 93 }, chart: garment, fitPreference: 'slim' });
    assert.equal(slim.size, 'S');
    assert.equal(slim.fit.chartType, 'garment');
  });
});

describe('charts, units, categories', () => {
  test('inch charts are converted', () => {
    const inches = {
      ...brandA, unit: 'in',
      entries: brandA.entries.map((e) => ({ ...e, ranges: Object.fromEntries(Object.entries(e.ranges).map(([k, r]) => [k, { min: r.min / 2.54, max: r.max / 2.54 }])) })),
    };
    const r = recommendSize({ profile, chart: inches });
    assert.equal(r.size, 'M');
    assert.equal(r.matchScore, recommendSize({ profile, chart: brandA }).matchScore);
  });

  test('normaliseChart sorts by sort_order and fixes swapped min/max', () => {
    const n = normaliseChart({ unit: 'cm', entries: [entry('L', 2, { chest: range(104, 99) }), entry('S', 0, { chest: range(88, 92) })] });
    assert.deepEqual(n.entries.map((e) => e.label), ['S', 'L']);
    assert.deepEqual(n.entries[1].ranges.chest, { min: 99, max: 104 });
  });

  test('only available sizes are considered', () => {
    const product = { category: 'tshirts', fit_type: 'regular', available_sizes: ['S', 'L'] };
    const r = recommendSize({ profile, chart: brandA, product });
    assert.notEqual(r.size, 'M');
    assert.equal(r.sizes.length, 2);
  });

  test('dresses use chest, waist and hip', () => {
    const dress = {
      category: 'dresses', fit_type: 'regular', unit: 'cm', chart_type: 'body',
      entries: [
        entry('36', 0, { chest: range(82, 85), waist: range(64, 67), hip: range(90, 93) }),
        entry('38', 1, { chest: range(86, 89), waist: range(68, 71), hip: range(94, 97) }),
        entry('40', 2, { chest: range(90, 93), waist: range(72, 75), hip: range(98, 101) }),
      ],
    };
    const r = recommendSize({ profile: { chest: 88, waist: 70, hip: 96 }, chart: dress });
    assert.equal(r.size, '38');
    assert.deepEqual(r.usedMeasurements.sort(), ['chest', 'hip', 'waist']);
  });

  test('sizes with partial rows are scored on what they have', () => {
    const chart = { ...brandA, entries: [entry('S', 0, { chest: range(88, 92) }), entry('M', 1, { chest: range(93, 98), waist: range(79, 84) })] };
    assert.equal(recommendSize({ profile, chart }).size, 'M');
  });

  test('result is deterministic and does not mutate inputs', () => {
    const chart = structuredClone(brandA);
    const a = recommendSize({ profile, chart });
    const b = recommendSize({ profile, chart });
    assert.deepEqual(a, b);
    assert.deepEqual(chart, brandA);
  });
});
