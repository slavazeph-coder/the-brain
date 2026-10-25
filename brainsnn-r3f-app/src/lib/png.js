// A PNG encoder, in about a hundred lines.
//
// The social card for a shared circuit has to be a real raster image: Open Graph
// scrapers will not accept SVG, and the grid only exists as pixels anyway. That
// normally means adding a canvas or image dependency to a server whose whole
// selling point is that it runs the deterministic engine with no runtime beyond
// Node.
//
// It is not needed. PNG's IDAT payload is a zlib stream, and Node ships zlib. So
// the entire format is a signature, three chunks, a CRC per chunk, and one
// filter byte per scanline — all of which is written out below rather than
// installed.
//
// Deliberately minimal: 8-bit truecolour, no alpha, no interlacing, no palette.
// That is what a social card needs and every additional mode would be untested
// code paths in a file that has no reason to grow.

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Standard PNG/zlib CRC-32, table built once on first use. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/** length | type | data | crc(type+data) */
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Encode RGBA pixels as an 8-bit truecolour PNG.
 *
 * Alpha is dropped rather than stored: the source is an opaque simulation grid,
 * and a card with an alpha channel is a third larger for nothing.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray|Uint8Array} rgba 4 bytes per pixel, row-major
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('encodePng: width and height must be positive integers');
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError('encodePng: pixel buffer is smaller than width x height');
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // deflate, the only defined compression
  ihdr[11] = 0; // adaptive filtering, the only defined method
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type. Filter 0 (None) keeps this
  // readable and costs little here: a pixel-art grid is mostly flat runs, which
  // deflate already collapses.
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = rowStart + 1 + x * 3;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    // Level 6, not 9. The source is flat runs of colour that deflate collapses
    // either way, and this runs per request on a card that is regenerated rather
    // than stored — the extra CPU buys a percent or two of size.
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Nearest-neighbour scale of an RGBA image into a fixed frame, centred, with
 * the remainder filled by `background`.
 *
 * Nearest neighbour rather than anything smoother because the source is a
 * simulation grid where one cell is one pixel: smoothing would blur a neuron
 * into its wire and make a sharp circuit look like a smudge.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} source
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {[number,number,number]} background
 * @returns {Uint8ClampedArray} frameWidth x frameHeight, RGBA
 */
export function fitInto(source, frameWidth, frameHeight, background = [3, 3, 8]) {
  const out = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  for (let i = 0; i < frameWidth * frameHeight; i += 1) {
    out[i * 4] = background[0];
    out[i * 4 + 1] = background[1];
    out[i * 4 + 2] = background[2];
    out[i * 4 + 3] = 255;
  }

  const scale = Math.min(frameWidth / source.width, frameHeight / source.height);
  const drawWidth = Math.max(1, Math.floor(source.width * scale));
  const drawHeight = Math.max(1, Math.floor(source.height * scale));
  const offsetX = ((frameWidth - drawWidth) / 2) | 0;
  const offsetY = ((frameHeight - drawHeight) / 2) | 0;

  for (let y = 0; y < drawHeight; y += 1) {
    const sourceY = Math.min(source.height - 1, (y / scale) | 0);
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = Math.min(source.width - 1, (x / scale) | 0);
      const from = (sourceY * source.width + sourceX) * 4;
      const to = ((offsetY + y) * frameWidth + (offsetX + x)) * 4;
      out[to] = source.data[from];
      out[to + 1] = source.data[from + 1];
      out[to + 2] = source.data[from + 2];
      out[to + 3] = 255;
    }
  }
  return out;
}
