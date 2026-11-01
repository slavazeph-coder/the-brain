import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'verify_ply_zflip.py');
const ASCIIF = path.join(__dirname, 'fixture_ascii.ply');
const BINF   = path.join(__dirname, 'fixture_binary.ply');
const BEF    = path.join(__dirname, 'fixture_binary_be.ply');

function runOnFixture(fixturePath, tmpDir) {
  const out = execFileSync('python3', [SCRIPT, fixturePath], {
    cwd: tmpDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const receiptFile = path.join(tmpDir, 'verify_ply_zflip_receipt.json');
  assert.ok(fs.existsSync(receiptFile), `receipt file missing in ${tmpDir}`);
  return JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
}

describe('verify_ply_zflip endian parity', () => {
  let tmp;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pparity-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('big-endian binary fixture parses with correct format and vcount', () => {
    const receipt = runOnFixture(BEF, tmp);
    assert.equal(receipt.format, 'binary_big_endian');
    assert.equal(receipt.vcount, 4);
  });

  it('ascii, little-endian and big-endian receipts are identical for the same geometry', () => {
    // All three fixtures encode the same 4 vertices (0/2 x, 0/2 y, 0/1 z).
    const a = runOnFixture(ASCIIF, tmp);
    const b = runOnFixture(BINF, tmp);
    const c = runOnFixture(BEF, tmp);
    // Drop the host-specific source path so only geometry matters.
    const geom = r => ({ original: r.original, after_zflip: r.after_zflip,
                         y_extent: r.y_extent, z_extent: r.z_extent,
                         y_up_likely: r.y_up_likely, z_up_likely: r.z_up_likely });
    assert.deepEqual(geom(b), geom(a), 'little-endian != ascii receipt');
    assert.deepEqual(geom(c), geom(a), 'big-endian != ascii receipt');
  });

  it('big-endian fixture: zflip sign inversion and y_up verdict', () => {
    const receipt = runOnFixture(BEF, tmp);
    assert.deepEqual(receipt.original.z, [0.0, 1.0, 1.0]);
    assert.equal(receipt.after_zflip.z[0], -1.0);
    assert.ok(receipt.after_zflip.z[1] === 0 || Object.is(receipt.after_zflip.z[1], -0));
    assert.equal(receipt.z_extent, 1.0);
    assert.equal(receipt.y_extent, 2.0);
    assert.equal(receipt.y_up_likely, true);
    assert.equal(receipt.z_up_likely, false);
  });
});
