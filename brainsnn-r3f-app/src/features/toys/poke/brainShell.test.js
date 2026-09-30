import { describe, expect, it } from '../../../test/tinyVitest.js';
import { BRAIN_REGIONS } from '../../brain3d/brainRegions.js';
import { buildBrainShell, REGION_DEPTHS, SHELL, shellDepth, surfacePointToward } from './brainShell.js';

describe('procedural brain shell', () => {
  it('shell: is deterministic, so every device and every clip gets the same brain', () => {
    const a = buildBrainShell('low');
    const b = buildBrainShell('low');
    expect(a.positions.length).toBe(b.positions.length);
    for (let index = 0; index < a.positions.length; index += 97) expect(a.positions[index]).toBe(b.positions[index]);
  });

  it('shell: has consistent buffer sizes at both detail levels', () => {
    for (const detail of ['low', 'high']) {
      const shell = buildBrainShell(detail);
      const { lat, lon } = shell.detail;
      expect(shell.vertexCount).toBe((lat + 1) * (lon + 1));
      expect(shell.positions.length).toBe(shell.vertexCount * 3);
      expect(shell.normals.length).toBe(shell.vertexCount * 3);
      expect(shell.folds.length).toBe(shell.vertexCount);
      expect(shell.indices.length).toBe(lat * lon * 6);
      for (let index = 0; index < shell.indices.length; index += 131) {
        expect(shell.indices[index]).toBeLessThan(shell.vertexCount);
      }
    }
  });

  it('shell: normals are unit length and fold weights stay in 0..1', () => {
    const shell = buildBrainShell('low');
    for (let v = 0; v < shell.vertexCount; v += 37) {
      const n = Math.hypot(shell.normals[v * 3], shell.normals[v * 3 + 1], shell.normals[v * 3 + 2]);
      expect(Math.abs(n - 1)).toBeLessThan(1e-4);
      expect(shell.folds[v]).toBeGreaterThanOrEqual(0);
      expect(shell.folds[v]).toBeLessThanOrEqual(1);
    }
  });

  it('shell: winds counter-clockwise from outside, so normals point outward', () => {
    // Inverted winding renders the inside of the jelly as its front face and
    // lights every groove backwards. Nothing else would catch that.
    const shell = buildBrainShell('low');
    const [cx, cy, cz] = SHELL.center;
    let outward = 0;
    let total = 0;
    for (let v = 0; v < shell.vertexCount; v += 11) {
      const dot = shell.normals[v * 3] * (shell.positions[v * 3] - cx)
        + shell.normals[v * 3 + 1] * (shell.positions[v * 3 + 1] - cy)
        + shell.normals[v * 3 + 2] * (shell.positions[v * 3 + 2] - cz);
      if (dot > 0) outward += 1;
      total += 1;
    }
    expect(outward / total).toBeGreaterThan(0.97);
  });

  it('shell: has real sulci, not a smooth egg', () => {
    const shell = buildBrainShell('high');
    let grooved = 0;
    for (let v = 0; v < shell.vertexCount; v += 1) if (shell.folds[v] < 0.5) grooved += 1;
    const share = grooved / shell.vertexCount;
    // Enough of the surface is sulcus to read as folded, not so much it reads as noise.
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.4);
  });

  it('shell: every region node of the existing connectome sits inside the surface', () => {
    const shell = buildBrainShell('high');
    for (const region of BRAIN_REGIONS) {
      // Nearest-direction vertex: the surface along the line from the centre through the node.
      const [cx, cy, cz] = SHELL.center;
      const [px, py, pz] = region.position;
      const toward = [px - cx, py - cy, pz - cz];
      const length = Math.hypot(...toward);
      let best = -Infinity;
      let surfaceDistance = 0;
      for (let v = 0; v < shell.vertexCount; v += 1) {
        const vx = shell.positions[v * 3] - cx;
        const vy = shell.positions[v * 3 + 1] - cy;
        const vz = shell.positions[v * 3 + 2] - cz;
        const vLength = Math.hypot(vx, vy, vz);
        const cos = (vx * toward[0] + vy * toward[1] + vz * toward[2]) / (vLength * length);
        if (cos > best) { best = cos; surfaceDistance = vLength; }
      }
      // Leave room for the node sphere itself.
      expect(length + 0.35).toBeLessThan(surfaceDistance);
      expect(REGION_DEPTHS[region.code]).toBeLessThan(0.9);
    }
  });

  it('shell: surface projection lands on the ellipsoid, in the direction asked', () => {
    for (const region of BRAIN_REGIONS) {
      const surface = surfacePointToward(region.position);
      expect(Math.abs(shellDepth(surface) - 1)).toBeLessThan(1e-9);
    }
    expect(Math.abs(shellDepth(surfacePointToward(SHELL.center)) - 1)).toBeLessThan(1e-9);
  });
});
