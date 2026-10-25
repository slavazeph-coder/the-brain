// Turning the grid into pixels.
//
// One ImageData allocated once, written straight into, and putImageData'd once
// per frame. The canvas backing store is the simulation resolution (240x160)
// and CSS scales it up with image-rendering: pixelated, so there is no
// devicePixelRatio maths and no per-cell fillRect -- 38,400 fillRects a frame
// is the thing that makes a grid this size unaffordable.
import { COLOR_RGB, Material } from './materials.ts';
import { MATERIAL_MASK, type PowderEngine } from './powderEngine.ts';
import { MAX_WEIGHT, MIN_WEIGHT, SYNAPSE_REFRACTORY, type NeuroLayer } from './neuroLayer.ts';

/** A firing neuron flashes white so a spike is unmissable. */
const FIRING_RGB = [255, 255, 255] as const;
/** A conducting synapse glows toward this. */
const SPIKE_RGB = [180, 255, 255] as const;

export interface RenderOptions {
  /** Draw the membrane potential as a brightness ramp on idle neurons. */
  showCharge?: boolean;
  /** Draw synapse weight as brightness, so a learned circuit looks learned. */
  showWeight?: boolean;
}

/**
 * Write the whole grid into `image`. Pure apart from the pixel buffer it fills,
 * so it can be exercised without a canvas.
 */
export function renderGrid(
  engine: PowderEngine,
  layer: NeuroLayer | null,
  image: { data: Uint8ClampedArray },
  { showCharge = true, showWeight = true }: RenderOptions = {},
): void {
  const { cells, voltage, weight, timer, size } = engine;
  const data = image.data;

  for (let at = 0; at < size; at += 1) {
    const material = cells[at] & MATERIAL_MASK;
    const offset = at * 4;

    let r = COLOR_RGB[material * 3];
    let g = COLOR_RGB[material * 3 + 1];
    let b = COLOR_RGB[material * 3 + 2];

    if (material === Material.NEURO || material === Material.INHIB) {
      if (layer && layer.isFiring(at)) {
        r = FIRING_RGB[0]; g = FIRING_RGB[1]; b = FIRING_RGB[2];
      } else if (showCharge) {
        // Charge reads as the cell brightening toward its firing colour. The
        // threshold is not known here, so this uses a fixed soft ramp: enough
        // to see a neuron filling up, not enough to be mistaken for a spike.
        const charge = voltage[at];
        if (charge > 0) {
          const lift = charge > 1 ? 1 : charge;
          r = r + (255 - r) * lift * 0.5;
          g = g + (255 - g) * lift * 0.5;
          b = b + (255 - b) * lift * 0.5;
        }
      }
    } else if (material === Material.SYNAPSE) {
      if (timer[at] > SYNAPSE_REFRACTORY) {
        // Head: actively carrying a spike.
        r = SPIKE_RGB[0]; g = SPIKE_RGB[1]; b = SPIKE_RGB[2];
      } else if (showWeight) {
        // Weight as brightness, so a circuit that has learned looks different
        // from one that has not. Floor at 45% so a weak wire is still visible.
        const strength = (weight[at] - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT);
        const scale = 0.45 + (strength > 1 ? 1 : strength < 0 ? 0 : strength) * 0.55;
        r *= scale; g *= scale; b *= scale;
      }
    }

    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
}

/**
 * Scale the simulation-resolution canvas up for a PNG export.
 * toBlob on the live canvas would save a 240x160 thumbnail; this redraws it at
 * `scale` with smoothing off so the pixels stay square.
 */
export function upscaleCanvas(
  source: HTMLCanvasElement,
  scale: number,
): HTMLCanvasElement {
  const target = document.createElement('canvas');
  target.width = source.width * scale;
  target.height = source.height * scale;
  const context = target.getContext('2d');
  if (context) {
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, target.width, target.height);
  }
  return target;
}
