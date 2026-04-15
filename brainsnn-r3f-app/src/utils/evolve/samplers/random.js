/**
 * Layer 31 — Brain Evolve : Random sampler
 *
 * Uniform random selection. BaseSampler already provides this behavior —
 * kept as an explicit export for UI parity with the other strategies.
 */

import { BaseSampler } from './base.js';

export class RandomSampler extends BaseSampler {
  // Inherits BaseSampler.sample() — uniform random without replacement.
}
