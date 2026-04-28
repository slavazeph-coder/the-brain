import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSweep,
  rowsToCsv,
  sweepSummary,
  SWEEP_CSV_COLUMNS,
} from './quantumSweep.js';

test('phase sweep produces `steps` rows spanning 0..pi', () => {
  const rows = runSweep({ kind: 'phase', shots: 1024, steps: 5, noise: 0 });
  assert.equal(rows.length, 5);
  assert.ok(Math.abs(rows[0].parameter - 0) < 1e-9);
  assert.ok(Math.abs(rows[rows.length - 1].parameter - Math.PI) < 1e-9);
});

test('phase sweep matches cos^2(theta/2) at theta=0 and theta=pi (noise=0)', () => {
  const rows = runSweep({ kind: 'phase', shots: 4096, steps: 5, noise: 0 });
  const first = rows[0];
  const last = rows[rows.length - 1];
  assert.ok(first.error < 0.05, `theta=0 error too high: ${first.error}`);
  assert.ok(last.error < 0.05, `theta=pi error too high: ${last.error}`);
});

test('noise sweep increasing degrades coherence monotonically', () => {
  const rows = runSweep({ kind: 'noise', shots: 1024, steps: 6, theta: 0 });
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      rows[i].coherence <= rows[i - 1].coherence,
      `coherence not monotone: rows[${i - 1}]=${rows[i - 1].coherence} rows[${i}]=${rows[i].coherence}`,
    );
  }
});

test('depth sweep produces integer parameters in non-decreasing order', () => {
  const rows = runSweep({ kind: 'depth', shots: 1024, steps: 5, noise: 0.1, maxDepth: 12 });
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].parameter >= rows[i - 1].parameter);
    assert.ok(Number.isInteger(rows[i].parameter));
  }
});

test('rowsToCsv emits the expected header and one line per row', () => {
  const rows = runSweep({ kind: 'phase', shots: 256, steps: 3, noise: 0 });
  const csv = rowsToCsv(rows);
  const lines = csv.split('\n');
  assert.equal(lines[0], SWEEP_CSV_COLUMNS.join(','));
  assert.equal(lines.length, rows.length + 1);
});

test('CSV cells with commas are properly escaped', () => {
  // forge a row with a comma in a string field
  const rows = [{
    kind: 'phase',
    parameter: 0.5,
    parameterLabel: 'theta=0.5,foo',
    shots: 256,
    noise: 0,
    p0: 0.5,
    p1: 0.5,
    counts0: 128,
    counts1: 128,
    expectedP0: 0.5,
    error: 0,
    coherence: 100,
  }];
  const csv = rowsToCsv(rows);
  assert.ok(csv.includes('"theta=0.5,foo"'),
    `expected quoted comma; got: ${csv}`);
});

test('sweepSummary computes max / avg / range', () => {
  const rows = runSweep({ kind: 'phase', shots: 1024, steps: 7, noise: 0 });
  const s = sweepSummary(rows);
  assert.equal(s.n, 7);
  assert.ok(s.rangeP0 > 0.5, `expected wide P(0) range across phase sweep, got ${s.rangeP0}`);
  assert.ok(s.maxError >= 0);
});

test('sweepSummary returns null on empty input', () => {
  assert.equal(sweepSummary([]), null);
});

test('unknown sweep kind throws', () => {
  assert.throws(() => runSweep({ kind: 'mystery', steps: 3 }));
});
