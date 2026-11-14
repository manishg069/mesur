import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toCm, fromCm, formatLength, cmToIn, inToCm } from '../shared/units.js';
import { parseSizeChartCsv, sizeChartToCsv, parseCsv } from '../shared/csv.js';
import { validateMeasurement, profileCompletion, categoryReadiness } from '../shared/measurements.js';

describe('units', () => {
  test('cm ↔ in conversion', () => {
    assert.equal(toCm(37.8, 'in'), 96);
    assert.equal(fromCm(96, 'in'), 37.8);
    assert.equal(toCm(96, 'cm'), 96);
    assert.equal(fromCm(170, 'in'), 66.9);
    assert.ok(Math.abs(inToCm(cmToIn(82)) - 82) < 1e-9);
  });
  test('round trip through inches stays within 0.2 cm', () => {
    for (const cm of [60, 82, 96.5, 170, 229.9]) {
      assert.ok(Math.abs(toCm(fromCm(cm, 'in'), 'in') - cm) <= 0.2, String(cm));
    }
  });
  test('empty and invalid input', () => {
    assert.equal(toCm('', 'cm'), null);
    assert.equal(toCm('abc', 'in'), null);
    assert.equal(fromCm(null, 'in'), null);
    assert.equal(formatLength(null), '—');
    assert.equal(formatLength(96, 'cm'), '96 cm');
  });
});

describe('measurement validation', () => {
  test('rejects unrealistic values', () => {
    assert.match(validateMeasurement('height', 20), /between/);
    assert.match(validateMeasurement('chest', 400), /between/);
    assert.match(validateMeasurement('chest', 'x'), /number/);
    assert.equal(validateMeasurement('chest', 96), null);
  });
  test('required vs optional', () => {
    assert.match(validateMeasurement('height', null), /required/);
    assert.equal(validateMeasurement('hip', null), null);
  });
  test('completion and readiness', () => {
    assert.equal(profileCompletion({}), 0);
    assert.equal(profileCompletion({ height: 170, chest: 96 }), 36);
    const full = { height: 1, chest: 1, waist: 1, shoulder: 1, hip: 1, arm: 1, inseam: 1, thigh: 1, neck: 1 };
    assert.equal(profileCompletion(full), 100);
    const r = categoryReadiness({ height: 170, chest: 96 });
    assert.equal(r.find((x) => x.group === 'tops').ready, true);
    assert.equal(r.find((x) => x.group === 'bottoms').ready, false);
    assert.deepEqual(r.find((x) => x.group === 'dresses').missingRequired, ['waist']);
  });
});

describe('size chart CSV', () => {
  const good = 'Size,Chest Min,Chest Max,Waist Min,Waist Max,Shoulder Min,Shoulder Max\nS,88,92,74,78,42,43\nM,93,98,79,84,44,45\nL,99,104,85,90,46,47\n';

  test('parses the brief format', () => {
    const r = parseSizeChartCsv(good);
    assert.deepEqual(r.errors, []);
    assert.equal(r.entries.length, 3);
    assert.deepEqual(r.entries[1], { label: 'M', sort_order: 1, ranges: { chest: { min: 93, max: 98 }, waist: { min: 79, max: 84 }, shoulder: { min: 44, max: 45 } } });
  });
  test('export → import round trip', () => {
    const first = parseSizeChartCsv(good).entries;
    const again = parseSizeChartCsv(sizeChartToCsv(first)).entries;
    assert.deepEqual(again, first);
  });
  test('quoted fields, CRLF, BOM, semicolons', () => {
    assert.deepEqual(parseCsv('﻿a,"b,1"\r\n"c ""x""",d\r\n'), [['a', 'b,1'], ['c "x"', 'd']]);
    const r = parseSizeChartCsv('size;chest_min;chest_max\r\nM;93;98\r\n');
    assert.equal(r.entries[0].ranges.chest.max, 98);
  });
  test('single-value columns for garment charts', () => {
    const r = parseSizeChartCsv('size,chest\nM,104\n');
    assert.deepEqual(r.entries[0].ranges.chest, { min: 104, max: 104 });
  });
  test('helpful errors', () => {
    assert.match(parseSizeChartCsv('').errors[0], /empty/);
    assert.match(parseSizeChartCsv('chest_min,chest_max\n1,2').errors.join(' '), /"size" column/);
    assert.match(parseSizeChartCsv('size,bicep_min\nM,30').errors.join(' '), /Unknown column "bicep_min"/);
    assert.match(parseSizeChartCsv('size,chest_min\nM,93').errors.join(' '), /matching "chest_max"/);
    assert.match(parseSizeChartCsv('size,chest_min,chest_max\nM,98,93').errors.join(' '), /greater than its maximum/);
    assert.match(parseSizeChartCsv('size,chest_min,chest_max\nM,abc,93').errors.join(' '), /Row 2 \(M\).*not a positive number/);
    assert.match(parseSizeChartCsv('size,chest_min,chest_max\nM,93,98\nM,99,104').errors.join(' '), /more than once/);
    assert.match(parseSizeChartCsv('size,chest_min,chest_max\nM,930,980').errors.join(' '), /unrealistic/);
    assert.match(parseSizeChartCsv('size,chest_min,chest_max\n').errors.join(' '), /no size rows/);
  });
  test('invalid files return no entries at all', () => {
    const r = parseSizeChartCsv('size,chest_min,chest_max\nS,88,92\nM,abc,98');
    assert.equal(r.entries.length, 0);
  });
  test('warnings for gaps and non-monotonic sizes', () => {
    const r = parseSizeChartCsv('size,chest_min,chest_max,waist_min,waist_max\nM,93,98,79,84\nS,88,92,,\n');
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => w.includes('no value for waist')));
    assert.ok(r.warnings.some((w) => w.includes('row order')));
  });
  test('inch charts use inch plausibility', () => {
    assert.deepEqual(parseSizeChartCsv('size,chest_min,chest_max\nM,36.5,38.5', { unit: 'in' }).errors, []);
  });
});
