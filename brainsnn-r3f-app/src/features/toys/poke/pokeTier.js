// Which version of Poke the Brain a device gets.
//
// The site's other 3D brain drops phones to a 2D picture, which is right for a
// visualization and wrong for a toy whose whole point is being touched. So
// phones get the real jelly at lower detail, and only devices that genuinely
// cannot run it — no WebGL, or under 2 GB of memory — get the 2D stand-in.
// Pure so the policy is tested rather than discovered on someone's phone.

export const FORCE_2D_KEY = 'brainsnn:force-brain-2d';

/** @returns {'high'|'low'|'2d'} */
export function detectPokeTier({ webgl = true, width = 1280, deviceMemory, cores, coarsePointer = false, forced = null } = {}) {
  if (forced === '1') return '2d';
  if (!webgl) return '2d';
  if (deviceMemory != null && deviceMemory < 2) return '2d';
  if (coarsePointer || width < 768) return 'low';
  if ((deviceMemory != null && deviceMemory <= 4) || (cores != null && cores <= 4)) return 'low';
  return 'high';
}

/** Browser probe for the inputs above. Never throws. */
export function probePokeTier() {
  if (typeof window === 'undefined') return 'high';
  let forced = null;
  try {
    forced = window.localStorage?.getItem(FORCE_2D_KEY) ?? null;
  } catch {
    forced = null;
  }
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    webgl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    webgl = false;
  }
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return detectPokeTier({
    webgl,
    width: window.innerWidth,
    deviceMemory: navigator.deviceMemory,
    cores: navigator.hardwareConcurrency,
    coarsePointer,
    forced,
  });
}
