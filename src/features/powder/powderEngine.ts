import { createRng } from '../../lib/rng.js';
import { Material } from './materials.ts';
import { MIN_WEIGHT } from './neuroLayer.ts';

export const DEFAULT_WIDTH = 240;
export const DEFAULT_HEIGHT = 160;
export const MATERIAL_MASK = 0x1f;
const SCRATCH_SHIFT = 5;

export interface PowderEngineOptions {
  width?: number;
  height?: number;
  seed?: string;
}

export class PowderEngine {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly cells: Uint8Array;
  readonly voltage: Float32Array;
  readonly weight: Float32Array;
  readonly timer: Uint8Array;
  private readonly rng: () => number;

  constructor(options: PowderEngineOptions = {}) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.size = this.width * this.height;
    this.cells = new Uint8Array(this.size);
    this.voltage = new Float32Array(this.size);
    this.weight = new Float32Array(this.size);
    this.timer = new Uint8Array(this.size);
    this.rng = createRng(options.seed ?? 'powder');
  }

  clear(): void {
    this.cells.fill(0);
    this.voltage.fill(0);
    this.weight.fill(0);
    this.timer.fill(0);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  getCell(x: number, y: number): Material {
    if (!this.inBounds(x, y)) return Material.WALL;
    return (this.cells[this.index(x, y)] & MATERIAL_MASK) as Material;
  }

  setCell(x: number, y: number, material: Material): void {
    if (!this.inBounds(x, y)) return;
    const at = this.index(x, y);
    this.cells[at] = material & MATERIAL_MASK;
    this.voltage[at] = 0;
    this.timer[at] = 0;
    this.weight[at] = material === Material.SYNAPSE ? MIN_WEIGHT : 0;
  }

  countOf(material: Material): number {
    let count = 0;
    const target = material & MATERIAL_MASK;
    for (let at = 0; at < this.size; at += 1) {
      if ((this.cells[at] & MATERIAL_MASK) === target) count += 1;
    }
    return count;
  }

  getScratch(at: number): number {
    return (this.cells[at] >> SCRATCH_SHIFT) & 0x07;
  }

  setScratch(at: number, value: number): void {
    const material = this.cells[at] & MATERIAL_MASK;
    this.cells[at] = material | ((value & 0x07) << SCRATCH_SHIFT);
  }

  paintBrush(cx: number, cy: number, radius: number, material: Material): number {
    let count = 0;
    const r = Math.max(0, Math.floor(radius));
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        this.setCell(x, y, material);
        count += 1;
      }
    }
    return count;
  }

  sparkAt(cx: number, cy: number, radius: number, threshold: number): number {
    let count = 0;
    const r = Math.max(0, Math.floor(radius));
    const charge = threshold * 2;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        const at = this.index(x, y);
        const kind = (this.cells[at] & MATERIAL_MASK) as Material;
        if (kind !== Material.NEURO && kind !== Material.INHIB) continue;
        if (this.timer[at] > 0) continue;
        this.voltage[at] = charge;
        count += 1;
      }
    }
    return count;
  }

  private swap(a: number, b: number): void {
    const c = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = c;

    const v = this.voltage[a];
    this.voltage[a] = this.voltage[b];
    this.voltage[b] = v;

    const w = this.weight[a];
    this.weight[a] = this.weight[b];
    this.weight[b] = w;

    const t = this.timer[a];
    this.timer[a] = this.timer[b];
    this.timer[b] = t;
  }

  tick(): void {
    const { width, height, cells } = this;
    for (let y = height - 2; y >= 0; y -= 1) {
      const leftToRight = this.rng() < 0.5;
      for (let i = 0; i < width; i += 1) {
        const x = leftToRight ? i : width - 1 - i;
        const at = y * width + x;
        const kind = (cells[at] & MATERIAL_MASK) as Material;
        if (kind !== Material.SAND && kind !== Material.WATER && kind !== Material.DOPAMINE) {
          continue;
        }
        const below = (y + 1) * width + x;
        const belowKind = (cells[below] & MATERIAL_MASK) as Material;
        if (belowKind === Material.AIR || (kind === Material.SAND && (belowKind === Material.WATER || belowKind === Material.DOPAMINE))) {
          this.swap(at, below);
          continue;
        }

        const dir = this.rng() < 0.5 ? -1 : 1;
        for (const dx of [dir, -dir]) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const diag = (y + 1) * width + nx;
          if ((cells[diag] & MATERIAL_MASK) === Material.AIR) {
            this.swap(at, diag);
            break;
          }
          if (kind === Material.WATER || kind === Material.DOPAMINE) {
            const side = y * width + nx;
            if ((cells[side] & MATERIAL_MASK) === Material.AIR) {
              this.swap(at, side);
              break;
            }
          }
        }
      }
    }
  }
}
