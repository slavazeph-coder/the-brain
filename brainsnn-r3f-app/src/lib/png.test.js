import { inflateSync } from 'node:zlib';
import { describe, expect, it } from '../test/tinyVitest.js';
import { encodePng, fitInto } from './png.js';

/** Walk the chunk list the way a decoder would. */
function chunks(png) {
  const found = [];
  let at = 8; // past the signature
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    found.push({ type, length, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

function solid(width, height, [r, g, b]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return data;
}

describe('encodePng', () => {
  it('writes the PNG signature', () => {
    const png = encodePng(2, 2, solid(2, 2, [10, 20, 30]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('emits IHDR, IDAT and IEND in order', () => {
    const types = chunks(encodePng(4, 3, solid(4, 3, [1, 2, 3]))).map((c) => c.type);
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares the dimensions and colour mode it actually wrote', () => {
    const [ihdr] = chunks(encodePng(1200, 630, solid(1200, 630, [0, 0, 0])));
    expect(ihdr.data.readUInt32BE(0)).toBe(1200);
    expect(ihdr.data.readUInt32BE(4)).toBe(630);
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(2); // truecolour, no alpha
    expect(ihdr.data[12]).toBe(0); // not interlaced
  });

  // The CRC is the part a hand-rolled encoder gets wrong, and a wrong one shows
  // up as "this image is broken" in exactly the place we cannot see: someone
  // else's timeline.
  it('writes a CRC that checks out for every chunk', () => {
    const png = encodePng(8, 8, solid(8, 8, [200, 100, 50]));
    let at = 8;
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const stored = png.readUInt32BE(at + 8 + length);
      // Recompute independently of the module: zlib exposes the same CRC-32.
      const body = png.subarray(at + 4, at + 8 + length);
      let crc = -1;
      for (let i = 0; i < body.length; i += 1) {
        crc ^= body[i];
        for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
      expect((crc ^ -1) >>> 0).toBe(stored);
      at += 12 + length;
    }
  });

  it('round-trips the pixels through the IDAT stream', () => {
    const width = 3;
    const height = 2;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      rgba[i * 4] = i * 10;
      rgba[i * 4 + 1] = i * 20;
      rgba[i * 4 + 2] = i * 30;
      rgba[i * 4 + 3] = 255;
    }
    const idat = chunks(encodePng(width, height, rgba)).find((c) => c.type === 'IDAT');
    const raw = inflateSync(idat.data);

    // filter byte + 3 bytes per pixel, per row
    expect(raw.length).toBe(height * (1 + width * 3));
    for (let y = 0; y < height; y += 1) {
      expect(raw[y * (1 + width * 3)]).toBe(0); // filter type None
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const to = y * (1 + width * 3) + 1 + x * 3;
        expect(raw[to]).toBe(i * 10);
        expect(raw[to + 1]).toBe(i * 20);
        expect(raw[to + 2]).toBe(i * 30);
      }
    }
  });

  it('refuses impossible dimensions and short buffers', () => {
    const cases = [
      () => encodePng(0, 4, solid(1, 4, [0, 0, 0])),
      () => encodePng(4, -1, solid(4, 1, [0, 0, 0])),
      () => encodePng(2.5, 4, solid(4, 4, [0, 0, 0])),
      () => encodePng(10, 10, solid(2, 2, [0, 0, 0])),
    ];
    for (const run of cases) {
      let threw = false;
      try { run(); } catch { threw = true; }
      expect(threw).toBe(true);
    }
  });
});

describe('fitInto', () => {
  const source = { width: 2, height: 2, data: solid(2, 2, [255, 0, 0]) };

  it('produces exactly the frame asked for', () => {
    expect(fitInto(source, 100, 50).length).toBe(100 * 50 * 4);
  });

  it('centres the image and fills the rest with the background', () => {
    // 2x2 into 100x50 fits to height: 50x50 drawn, 25px of background each side.
    const out = fitInto(source, 100, 50, [3, 3, 8]);
    const at = (x, y) => (y * 100 + x) * 4;
    expect([...out.subarray(at(0, 25), at(0, 25) + 3)]).toEqual([3, 3, 8]);
    expect([...out.subarray(at(50, 25), at(50, 25) + 3)]).toEqual([255, 0, 0]);
    expect([...out.subarray(at(99, 25), at(99, 25) + 3)]).toEqual([3, 3, 8]);
  });

  it('leaves every pixel opaque', () => {
    const out = fitInto(source, 40, 20);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });

  it('keeps hard edges rather than blending them', () => {
    // Two columns, red then blue. Upscaled, every pixel must still be one or the
    // other — a blurred boundary is the failure this guards.
    const data = new Uint8ClampedArray(2 * 1 * 4);
    data.set([255, 0, 0, 255], 0);
    data.set([0, 0, 255, 255], 4);
    const out = fitInto({ width: 2, height: 1, data }, 20, 10, [0, 0, 0]);
    for (let i = 0; i < out.length; i += 4) {
      const pixel = `${out[i]},${out[i + 1]},${out[i + 2]}`;
      expect(['255,0,0', '0,0,255', '0,0,0'].includes(pixel)).toBe(true);
    }
  });

  it('never scales up past the frame', () => {
    const out = fitInto({ width: 240, height: 160, data: solid(240, 160, [9, 9, 9]) }, 1200, 630);
    expect(out.length).toBe(1200 * 630 * 4);
    // Fits to height, so the top-left corner is background rather than grid.
    expect([...out.subarray(0, 3)]).toEqual([3, 3, 8]);
  });
});
