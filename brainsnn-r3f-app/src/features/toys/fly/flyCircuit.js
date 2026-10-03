// The fly feeding circuit: a slice of the published FlyWire fruit-fly
// connectome and the Shiu et al. (Nature 2024) leaky integrate-and-fire model
// that runs on it.
//
// The wiring is real — 2,621 neurons and 195,759 connections cut from the
// FlyWire v783 connectome by scripts/fly/build-fly-circuit.py. The activity is
// simulated: Poisson spikes injected into the taste neurons, propagated
// through the real connection weights by the published model's equations. No
// fly was recorded. The unit suite holds the model to the paper's headline
// result — sugar drives the proboscis motor neuron MN9, bitter does not — so
// a broken port can't ship looking plausible.
//
// Pure and DOM-free: it parses an ArrayBuffer and steps typed arrays, so the
// same code runs in the browser and in the bare-Node test runner.

export const KIND = Object.freeze({
  other: 0,
  sugar: 1,
  bitter: 2,
  mn9: 3,
  sensory: 4,
  ascending: 5,
  descending: 6,
  motor: 7,
  central: 8,
  optic: 9,
  visualProjection: 10,
  visualCentrifugal: 11,
  endocrine: 12,
});

// Shiu et al. 2024 model constants (model.py), as validated by the port.
export const SHIU = Object.freeze({
  dt: 0.1, // ms per step
  vRest: -52, // mV
  vThreshold: -45, // mV
  tauMembrane: 20, // ms
  tauSynapse: 5, // ms
  refractorySteps: 22, // 2.2 ms
  delaySteps: 18, // synaptic delay (ring of delaySteps + 1 slots)
  wSyn: 0.275, // mV per synapse
  poissonWeight: 250, // a Poisson input spike lands as wSyn * poissonWeight
});

const MAGIC = 'FLY1';

function align(offset) {
  return offset + (-offset % 4 + 4) % 4;
}

/** Parse the packed circuit written by build-fly-circuit.py. */
export function parseFlyCircuit(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) throw new Error('Not a fly circuit file');
  const header = new DataView(buffer, 4, 40);
  const n = header.getUint32(0, true);
  const m = header.getUint32(4, true);
  const meshVertices = header.getUint32(8, true);
  const meshTriangles = header.getUint32(12, true);
  const lo = [header.getFloat32(16, true), header.getFloat32(20, true), header.getFloat32(24, true)];
  const hi = [header.getFloat32(28, true), header.getFloat32(32, true), header.getFloat32(36, true)];
  let offset = 44;
  const take = (Type, count) => {
    const view = new Type(buffer, offset, count);
    offset = align(offset + count * Type.BYTES_PER_ELEMENT);
    return view;
  };
  const ptr = take(Uint32Array, n + 1);
  const post = take(Uint16Array, m);
  const weight = take(Int16Array, m);
  const position = take(Int16Array, n * 3);
  const kind = take(Uint8Array, n);
  const meshPosition = take(Int16Array, meshVertices * 3);
  const meshIndex = take(Uint16Array, meshTriangles * 3);
  const sugar = [];
  const bitter = [];
  let mn9 = -1;
  for (let i = 0; i < n; i += 1) {
    if (kind[i] === KIND.sugar) sugar.push(i);
    else if (kind[i] === KIND.bitter) bitter.push(i);
    else if (kind[i] === KIND.mn9) mn9 = i;
  }
  return { n, m, ptr, post, weight, position, kind, meshPosition, meshIndex, bbox: { lo, hi }, sugar, bitter, mn9 };
}

/** Quantised int16 coordinates back to micrometres in FlyWire space. */
export function dequantize(values, bbox) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const axis = i % 3;
    out[i] = bbox.lo[axis] + ((values[i] + 32767) / 65534) * (bbox.hi[axis] - bbox.lo[axis]);
  }
  return out;
}

function xorshift(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The Shiu et al. LIF model on a parsed circuit. Event-driven: only neurons
 * away from rest are updated, which is what keeps 2,621 neurons cheap.
 */
export function createFlySim(circuit, { seed = 1, params = SHIU } = {}) {
  const { n, ptr, post, mn9 } = circuit;
  const { dt, vRest, vThreshold, tauMembrane, tauSynapse, refractorySteps, delaySteps, wSyn, poissonWeight } = params;
  const decayV = Math.exp(-dt / tauMembrane);
  const decayG = Math.exp(-dt / tauSynapse);
  const gain = (tauSynapse / (tauSynapse - tauMembrane)) * (decayG - decayV);
  const weight = new Float32Array(circuit.weight.length);
  for (let e = 0; e < weight.length; e += 1) weight[e] = circuit.weight[e] * wSyn;

  let random = xorshift(seed);
  const v = new Float32Array(n);
  const g = new Float32Array(n);
  const refractory = new Int32Array(n);
  const spikes = new Int32Array(n);
  const lastSpike = new Float32Array(n);
  const inActive = new Uint8Array(n);
  const isInput = new Uint8Array(n);
  const active = new Int32Array(n);
  const nextActive = new Int32Array(n);
  let activeCount = 0;
  const ring = Array.from({ length: delaySteps + 1 }, () => []);
  let stepIndex = 0;
  let inputs = [];
  let inputProbability = 0;
  let mn9Times = [];

  function activate(i) {
    if (!inActive[i]) {
      inActive[i] = 1;
      active[activeCount] = i;
      activeCount += 1;
    }
  }

  function reset() {
    random = xorshift(seed);
    v.fill(vRest);
    g.fill(0);
    refractory.fill(0);
    spikes.fill(0);
    lastSpike.fill(-1e9);
    inActive.fill(0);
    isInput.fill(0);
    activeCount = 0;
    for (const queue of ring) queue.length = 0;
    stepIndex = 0;
    inputs = [];
    inputProbability = 0;
    mn9Times = [];
  }

  /** Feed a taste ('sugar' | 'bitter') at `rateHz` Poisson input, or null to stop. */
  function setTaste(taste, rateHz = 150) {
    for (const i of inputs) isInput[i] = 0;
    inputs = taste === 'sugar' ? circuit.sugar : taste === 'bitter' ? circuit.bitter : [];
    inputProbability = (rateHz * dt) / 1000;
    for (const i of inputs) {
      isInput[i] = 1;
      activate(i);
    }
  }

  /** Advance `count` steps of `dt` ms. Returns the number of spikes fired. */
  function step(count = 1) {
    let fired = 0;
    for (let s = 0; s < count; s += 1) {
      const now = stepIndex * dt;
      const queue = ring[stepIndex % ring.length];
      for (let q = 0; q < queue.length; q += 1) {
        const j = queue[q];
        const end = ptr[j + 1];
        for (let e = ptr[j]; e < end; e += 1) {
          const target = post[e];
          g[target] += weight[e];
          activate(target);
        }
      }
      queue.length = 0;
      for (let a = 0; a < inputs.length; a += 1) {
        if (random() < inputProbability) v[inputs[a]] += wSyn * poissonWeight;
      }
      let kept = 0;
      for (let a = 0; a < activeCount; a += 1) {
        const i = active[a];
        if (refractory[i] > 0) {
          refractory[i] -= 1;
          nextActive[kept] = i;
          kept += 1;
          continue;
        }
        const gi = g[i];
        v[i] = vRest + (v[i] - vRest) * decayV + gi * gain;
        g[i] = gi * decayG;
        if (v[i] > vThreshold) {
          v[i] = vRest;
          g[i] = 0;
          refractory[i] = isInput[i] ? 0 : refractorySteps;
          spikes[i] += 1;
          lastSpike[i] = now;
          fired += 1;
          queue.push(i);
          if (i === mn9) mn9Times.push(now);
        }
        if (!isInput[i] && refractory[i] === 0 && Math.abs(g[i]) < 1e-3 && Math.abs(v[i] - vRest) < 1e-3) {
          v[i] = vRest;
          g[i] = 0;
          inActive[i] = 0;
        } else {
          nextActive[kept] = i;
          kept += 1;
        }
      }
      active.set(nextActive.subarray(0, kept));
      activeCount = kept;
      stepIndex += 1;
    }
    return fired;
  }

  /** MN9's firing rate over the last `windowMs` of simulated time. */
  function mn9Rate(windowMs = 500) {
    const now = stepIndex * dt;
    while (mn9Times.length && mn9Times[0] < now - windowMs) mn9Times.shift();
    const span = Math.min(windowMs, now);
    return span > 0 ? (mn9Times.length * 1000) / span : 0;
  }

  reset();
  return {
    get timeMs() { return stepIndex * dt; },
    get activeCount() { return activeCount; },
    lastSpike,
    spikes,
    setTaste,
    step,
    mn9Rate,
    reset,
  };
}

/** Did the fly decide to eat? MN9 extends the proboscis. */
export function feedingVerdict(mn9Hz) {
  if (mn9Hz >= 40) return 'eating';
  if (mn9Hz > 0) return 'tempted';
  return 'not-eating';
}
