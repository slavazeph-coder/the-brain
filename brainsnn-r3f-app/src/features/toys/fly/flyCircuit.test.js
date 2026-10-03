import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from '../../../test/tinyVitest.js';
import { createFlySim, dequantize, feedingVerdict, KIND, parseFlyCircuit, SHIU } from './flyCircuit.js';

function loadCircuit() {
  const bytes = gunzipSync(readFileSync('public/fly/feeding-circuit.bin.gz'));
  return parseFlyCircuit(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

const circuit = loadCircuit();
const STEPS_PER_SECOND = Math.round(1000 / SHIU.dt);

function mn9HzFor(taste, rateHz, seed = 13) {
  const sim = createFlySim(circuit, { seed });
  sim.setTaste(taste, rateHz);
  sim.step(STEPS_PER_SECOND);
  return sim.spikes[circuit.mn9];
}

describe('fly circuit file', () => {
  it('fly: the packed slice is the validated one — 2,621 neurons, 195,759 connections', () => {
    expect(circuit.n).toBe(2621);
    expect(circuit.m).toBe(195759);
    expect(circuit.ptr[circuit.n]).toBe(circuit.m);
  });

  it('fly: it carries the taste neurons and the feeding motor neuron', () => {
    expect(circuit.sugar.length).toBe(20);
    expect(circuit.bitter.length).toBe(20);
    expect(circuit.mn9).toBeGreaterThan(-1);
    expect(circuit.kind[circuit.mn9]).toBe(KIND.mn9);
  });

  it('fly: neurons sit inside the brain outline', () => {
    const neurons = dequantize(circuit.position, circuit.bbox);
    const mesh = dequantize(circuit.meshPosition, circuit.bbox);
    const range = (values, axis) => {
      let lo = Infinity; let hi = -Infinity;
      for (let i = axis; i < values.length; i += 3) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
      return [lo, hi];
    };
    for (const axis of [0, 1]) {
      const [nLo, nHi] = range(neurons, axis);
      const [mLo, mHi] = range(mesh, axis);
      expect(nLo).toBeGreaterThan(mLo - 40);
      expect(nHi).toBeLessThan(mHi + 40);
    }
    expect(circuit.meshIndex.length).toBe(2400 * 3);
  });
});

describe('Shiu et al. model on the slice', () => {
  // The paper's headline result, and the one a broken port fakes worst: an
  // earlier build paired weights with the wrong connections and looked busy
  // everywhere except MN9.
  it('fly: sugar drives the proboscis motor neuron MN9', () => {
    const hz = mn9HzFor('sugar', 150);
    expect(hz).toBeGreaterThan(70);
    expect(hz).toBeLessThan(160);
  });

  it('fly: bitter leaves MN9 silent', () => {
    expect(mn9HzFor('bitter', 150)).toBe(0);
  });

  it('fly: more sugar, more drive', () => {
    expect(mn9HzFor('sugar', 200)).toBeGreaterThan(mn9HzFor('sugar', 50));
  });

  it('fly: no taste, no activity — the model has no spontaneous firing', () => {
    const sim = createFlySim(circuit);
    expect(sim.step(2000)).toBe(0);
    expect(sim.activeCount).toBe(0);
  });

  it('fly: a run is reproducible per seed', () => {
    expect(mn9HzFor('sugar', 100, 7)).toBe(mn9HzFor('sugar', 100, 7));
  });

  it('fly: switching taste and resetting behave', () => {
    const sim = createFlySim(circuit, { seed: 3 });
    sim.setTaste('sugar', 150);
    sim.step(5000);
    expect(sim.mn9Rate(500)).toBeGreaterThan(30);
    sim.setTaste(null);
    sim.step(5000);
    expect(sim.mn9Rate(300)).toBe(0);
    sim.reset();
    expect(sim.timeMs).toBe(0);
    expect(sim.spikes[circuit.mn9]).toBe(0);
  });

  it('fly: the verdict reads MN9', () => {
    expect(feedingVerdict(100)).toBe('eating');
    expect(feedingVerdict(12)).toBe('tempted');
    expect(feedingVerdict(0)).toBe('not-eating');
  });
});
