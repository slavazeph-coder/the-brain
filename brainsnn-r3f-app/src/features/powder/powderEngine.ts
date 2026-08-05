// The Neuro Powder Lab simulation.
//
// A 240x160 cellular automaton in typed arrays. No React, no DOM, no canvas —
// this class is pure state plus a `tick()`, which is what makes it testable in
// bare Node and portable to Rust/WASM later without touching the rules.
//
// PERFORMANCE SHAPE
//
// 38,400 cells is a main-thread workload if, and only if, the inner loop stays
// free of allocation and property lookup. So:
//   - one packed Uint32Array for the automaton, flat lookup tables for material
//     properties (see materials.ts), and no object per particle
//   - the "already moved this frame" bit is compared against a frame-parity
//     flag rather than cleared, which removes a 38,400-cell wipe every frame
//   - rows are scanned bottom-up, alternating left-to-right and right-to-left,
//     which is the standard fix for the directional drift that otherwise makes
//     sand visibly lean one way
import {
  Material,
  DENSITY,
  IS_CORRODIBLE,
  IS_FLAMMABLE,
  IS_GAS,
  IS_LIQUID,
  IS_POWDER,
  IS_STATIC,
} from './materials.ts';
import { createRng } from '../../lib/rng.js';

export const DEFAULT_WIDTH = 240;
export const DEFAULT_HEIGHT = 160;

// --- Cell word layout -------------------------------------------------------
// bits 0-4    material id (0-31)
// bits 5-12   temperature (0-255)
// bit  13     moved-this-frame parity
// bits 14-23  scratch: fire fuel / dopamine lifetime / plant age
export const MATERIAL_MASK = 0x1f;
export const TEMP_SHIFT = 5;
export const TEMP_MASK = 0xff;
export const MOVED_BIT = 1 << 13;
export const SCRATCH_SHIFT = 14;
export const SCRATCH_MASK = 0x3ff;

export const BOIL_TEMPERATURE = 100;
export const FIRE_FUEL = 60;
export const DOPAMINE_LIFETIME = 500;
export const LAVA_COOL_TEMPERATURE = 40;

export interface PowderOptions {
  width?: number;
  height?: number;
  seed?: string;
}

export class PowderEngine {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** Packed automaton state. See the bit layout above. */
  readonly cells: Uint32Array;
  /** Membrane potential; meaningful for NEURO and INHIB cells. */
  readonly voltage: Float32Array;
  /** Synaptic weight 0.1-1.0; meaningful for SYNAPSE cells. */
  readonly weight: Float32Array;
  /** Countdown timers: refractory for neurons, spike duration for synapses. */
  readonly timer: Uint8Array;

  private rng: () => number;
  private seed: string;
  /** Flipped every tick; a cell whose MOVED bit matches has already moved. */
  private parity = 0;
  private tickCount = 0;

  constructor({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, seed = 'powder-01' }: PowderOptions = {}) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cells = new Uint32Array(this.size);
    this.voltage = new Float32Array(this.size);
    this.weight = new Float32Array(this.size);
    this.timer = new Uint8Array(this.size);
    this.seed = seed;
    this.rng = createRng(seed);
  }

  // --- Cell access ----------------------------------------------------------

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getCell(x: number, y: number): Material {
    if (!this.inBounds(x, y)) return Material.WALL; // out of bounds reads as solid
    return (this.cells[this.index(x, y)] & MATERIAL_MASK) as Material;
  }

  setCell(x: number, y: number, material: Material): void {
    if (!this.inBounds(x, y)) return;
    const at = this.index(x, y);
    this.cells[at] = material & MATERIAL_MASK;
    this.voltage[at] = 0;
    this.timer[at] = 0;
    // A fresh synapse starts weak so learning has somewhere to go.
    this.weight[at] = material === Material.SYNAPSE ? 0.1 : 0;
    if (material === Material.FIRE) this.setScratch(at, FIRE_FUEL);
    if (material === Material.DOPAMINE) this.setScratch(at, DOPAMINE_LIFETIME > SCRATCH_MASK ? SCRATCH_MASK : DOPAMINE_LIFETIME);
    if (material === Material.LAVA) this.setTemperature(at, 255);
  }

  getTemperature(at: number): number {
    return (this.cells[at] >>> TEMP_SHIFT) & TEMP_MASK;
  }

  setTemperature(at: number, value: number): void {
    const clamped = value < 0 ? 0 : value > TEMP_MASK ? TEMP_MASK : value | 0;
    this.cells[at] = (this.cells[at] & ~(TEMP_MASK << TEMP_SHIFT)) | (clamped << TEMP_SHIFT);
  }

  getScratch(at: number): number {
    return (this.cells[at] >>> SCRATCH_SHIFT) & SCRATCH_MASK;
  }

  setScratch(at: number, value: number): void {
    const clamped = value < 0 ? 0 : value > SCRATCH_MASK ? SCRATCH_MASK : value | 0;
    this.cells[at] = (this.cells[at] & ~(SCRATCH_MASK << SCRATCH_SHIFT)) | (clamped << SCRATCH_SHIFT);
  }

  private materialAt(at: number): Material {
    return (this.cells[at] & MATERIAL_MASK) as Material;
  }

  private hasMoved(at: number): boolean {
    return ((this.cells[at] & MOVED_BIT) !== 0) === (this.parity === 1);
  }

  private markMoved(at: number): void {
    if (this.parity === 1) this.cells[at] |= MOVED_BIT;
    else this.cells[at] &= ~MOVED_BIT;
  }

  /** Swap two cells wholesale — packed word and all side channels. */
  private swap(a: number, b: number): void {
    const cell = this.cells[a]; this.cells[a] = this.cells[b]; this.cells[b] = cell;
    const v = this.voltage[a]; this.voltage[a] = this.voltage[b]; this.voltage[b] = v;
    const w = this.weight[a]; this.weight[a] = this.weight[b]; this.weight[b] = w;
    const t = this.timer[a]; this.timer[a] = this.timer[b]; this.timer[b] = t;
    this.markMoved(b);
  }

  // --- Authoring ------------------------------------------------------------

  clear(): void {
    this.cells.fill(0);
    this.voltage.fill(0);
    this.weight.fill(0);
    this.timer.fill(0);
    this.tickCount = 0;
    this.parity = 0;
    this.rng = createRng(this.seed);
  }

  /** Circular brush. Radius 0 paints a single cell. */
  brushDraw(cx: number, cy: number, radius: number, material: Material): void {
    const r = Math.max(0, radius | 0);
    const rSquared = r * r;
    for (let oy = -r; oy <= r; oy += 1) {
      for (let ox = -r; ox <= r; ox += 1) {
        if (r > 0 && ox * ox + oy * oy > rSquared) continue;
        const x = cx + ox;
        const y = cy + oy;
        if (this.inBounds(x, y)) this.setCell(x, y, material);
      }
    }
  }

  /**
   * Paint along a line between two points.
   *
   * Without this, a fast drag samples the pointer every ~16 ms and leaves a
   * dotted trail — every other canvas lab in this repo has that bug, and in a
   * drawing tool it is the difference between feeling solid and feeling broken.
   * Bresenham, so the interpolation costs no division per step.
   */
  brushStroke(x0: number, y0: number, x1: number, y1: number, radius: number, material: Material): void {
    let x = x0 | 0;
    let y = y0 | 0;
    const targetX = x1 | 0;
    const targetY = y1 | 0;
    const dx = Math.abs(targetX - x);
    const dy = -Math.abs(targetY - y);
    const stepX = x < targetX ? 1 : -1;
    const stepY = y < targetY ? 1 : -1;
    let error = dx + dy;

    // Bounded so a wild pointer jump cannot spin here.
    const limit = this.width + this.height;
    for (let guard = 0; guard <= limit; guard += 1) {
      this.brushDraw(x, y, radius, material);
      if (x === targetX && y === targetY) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x += stepX; }
      if (doubled <= dx) { error += dx; y += stepY; }
    }
  }

  countNonEmpty(): number {
    let count = 0;
    for (let at = 0; at < this.size; at += 1) {
      if ((this.cells[at] & MATERIAL_MASK) !== Material.AIR) count += 1;
    }
    return count;
  }

  countOf(material: Material): number {
    let count = 0;
    for (let at = 0; at < this.size; at += 1) {
      if ((this.cells[at] & MATERIAL_MASK) === material) count += 1;
    }
    return count;
  }

  get ticks(): number {
    return this.tickCount;
  }

  // --- The loop -------------------------------------------------------------

  tick(): void {
    this.parity ^= 1;
    this.tickCount += 1;

    // Bottom-up so a falling column resolves in one pass rather than smearing.
    for (let y = this.height - 1; y >= 0; y -= 1) {
      // Alternating scan direction per row and per tick. A fixed direction
      // makes powder drift steadily toward whichever side is scanned last.
      const leftToRight = ((y + this.tickCount) & 1) === 0;
      if (leftToRight) {
        for (let x = 0; x < this.width; x += 1) this.stepCell(x, y);
      } else {
        for (let x = this.width - 1; x >= 0; x -= 1) this.stepCell(x, y);
      }
    }
  }

  private stepCell(x: number, y: number): void {
    const at = this.index(x, y);
    const material = this.materialAt(at);
    if (material === Material.AIR || material === Material.WALL) return;
    if (this.hasMoved(at)) return;

    switch (material) {
      case Material.FIRE: this.stepFire(x, y, at); return;
      case Material.PLANT: this.stepPlant(x, y, at); return;
      case Material.ACID: this.stepAcid(x, y, at); return;
      case Material.LAVA: this.stepLava(x, y, at); return;
      case Material.WATER: this.stepWater(x, y, at); return;
      case Material.DOPAMINE: this.stepDopamine(x, y, at); return;
      default: break;
    }

    if (IS_POWDER[material]) this.stepPowder(x, y, at, material);
    else if (IS_LIQUID[material]) this.stepLiquid(x, y, at, material);
    else if (IS_GAS[material]) this.stepGas(x, y, at, material);
  }

  /** True if the mover can displace whatever is at (x, y). */
  private canDisplace(x: number, y: number, moverDensity: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const target = this.materialAt(this.index(x, y));
    if (target === Material.WALL) return false;
    if (IS_STATIC[target]) return false;
    return DENSITY[target] < moverDensity;
  }

  private stepPowder(x: number, y: number, at: number, material: Material): void {
    const density = DENSITY[material];
    if (this.canDisplace(x, y + 1, density)) {
      this.swap(at, this.index(x, y + 1));
      return;
    }
    // 45-degree avalanche. Try both diagonals in a seeded order so a pile does
    // not systematically lean.
    const first = this.rng() < 0.5 ? -1 : 1;
    for (const dx of [first, -first]) {
      if (this.canDisplace(x + dx, y + 1, density)) {
        this.swap(at, this.index(x + dx, y + 1));
        return;
      }
    }
  }

  private stepLiquid(x: number, y: number, at: number, material: Material): void {
    const density = DENSITY[material];
    if (this.canDisplace(x, y + 1, density)) {
      this.swap(at, this.index(x, y + 1));
      return;
    }
    const first = this.rng() < 0.5 ? -1 : 1;
    for (const dx of [first, -first]) {
      if (this.canDisplace(x + dx, y + 1, density)) {
        this.swap(at, this.index(x + dx, y + 1));
        return;
      }
    }
    // Sideways spread is what makes a liquid level rather than pile.
    for (const dx of [first, -first]) {
      if (this.canDisplace(x + dx, y, density)) {
        this.swap(at, this.index(x + dx, y));
        return;
      }
    }
  }

  private stepGas(x: number, y: number, at: number, material: Material): void {
    const density = DENSITY[material];
    // Gases rise: the same rules inverted, since "lower density floats".
    if (this.canDisplaceUp(x, y - 1, density)) {
      this.swap(at, this.index(x, y - 1));
      return;
    }
    const first = this.rng() < 0.5 ? -1 : 1;
    for (const dx of [first, -first]) {
      if (this.canDisplaceUp(x + dx, y - 1, density)) {
        this.swap(at, this.index(x + dx, y - 1));
        return;
      }
    }
    for (const dx of [first, -first]) {
      if (this.canDisplaceUp(x + dx, y, density)) {
        this.swap(at, this.index(x + dx, y));
        return;
      }
    }
  }

  private canDisplaceUp(x: number, y: number, moverDensity: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const target = this.materialAt(this.index(x, y));
    if (target === Material.WALL) return false;
    if (IS_STATIC[target]) return false;
    return DENSITY[target] > moverDensity;
  }

  private stepWater(x: number, y: number, at: number): void {
    if (this.getTemperature(at) >= BOIL_TEMPERATURE) {
      this.setCell(x, y, Material.STEAM);
      return;
    }
    this.stepLiquid(x, y, at, Material.WATER);
  }

  private stepDopamine(x: number, y: number, at: number): void {
    const life = this.getScratch(at);
    if (life <= 1) {
      this.setCell(x, y, Material.AIR);
      return;
    }
    this.setScratch(at, life - 1);
    this.stepLiquid(x, y, at, Material.DOPAMINE);
  }

  private stepFire(x: number, y: number, at: number): void {
    const fuel = this.getScratch(at);
    if (fuel <= 1) {
      // Burnt out. Leave smoke rather than a hole so a fire reads as an event.
      this.setCell(x, y, this.rng() < 0.5 ? Material.GAS : Material.AIR);
      return;
    }
    this.setScratch(at, fuel - 1);

    // Heat and ignite the four neighbours.
    let touchingFuel = false;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const nAt = this.index(nx, ny);
      const neighbour = this.materialAt(nAt);
      this.setTemperature(nAt, Math.min(255, this.getTemperature(nAt) + 30));
      if (IS_FLAMMABLE[neighbour]) {
        touchingFuel = true;
        if (this.rng() < 0.34) this.setCell(nx, ny, Material.FIRE);
      }
    }

    // Fire only rises when it has nothing to eat. Letting it rise regardless
    // meant a flame lit above an oil pool floated away on its first tick and
    // the pool never caught — the fuel falls, the flame climbs, and they
    // separate immediately. Burning in place is both truer and far better to
    // play with, because a fire now spreads through whatever it is standing on.
    if (!touchingFuel) this.stepGas(x, y, at, Material.FIRE);
  }

  private stepPlant(x: number, y: number, at: number): void {
    // Grows into an adjacent air cell when it can reach water.
    let nearWater = false;
    for (const [dx, dy] of NEIGHBOURS) {
      if (this.getCell(x + dx, y + dy) === Material.WATER) { nearWater = true; break; }
    }
    if (!nearWater || this.rng() > 0.06) return;
    const [dx, dy] = NEIGHBOURS[(this.rng() * NEIGHBOURS.length) | 0];
    if (this.getCell(x + dx, y + dy) === Material.AIR) {
      this.setCell(x + dx, y + dy, Material.PLANT);
    }
    void at;
  }

  private stepAcid(x: number, y: number, at: number): void {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const neighbour = this.getCell(nx, ny);
      if (IS_CORRODIBLE[neighbour] && this.rng() < 0.22) {
        this.setCell(nx, ny, Material.AIR);
        // Acid is consumed by what it eats, or it would dissolve the world.
        this.setCell(x, y, Material.AIR);
        return;
      }
    }
    this.stepLiquid(x, y, at, Material.ACID);
  }

  private stepLava(x: number, y: number, at: number): void {
    const temperature = this.getTemperature(at);
    if (temperature <= LAVA_COOL_TEMPERATURE) {
      this.setCell(x, y, Material.ROCK);
      return;
    }
    this.setTemperature(at, temperature - 1);

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const nAt = this.index(nx, ny);
      const neighbour = this.materialAt(nAt);
      if (neighbour === Material.SAND) { this.setCell(nx, ny, Material.GLASS); continue; }
      if (neighbour === Material.WATER) {
        // Quenched: the lava solidifies and the water flashes off.
        this.setCell(nx, ny, Material.STEAM);
        this.setCell(x, y, Material.ROCK);
        return;
      }
      if (IS_FLAMMABLE[neighbour]) { this.setCell(nx, ny, Material.FIRE); continue; }
      this.setTemperature(nAt, Math.min(255, this.getTemperature(nAt) + 40));
    }
    this.stepLiquid(x, y, at, Material.LAVA);
  }
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, -1], [0, 1], [-1, 0], [1, 0],
]);
