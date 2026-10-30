import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'verify_ply_zflip.py');
const ASCIIF = path.join(__dirname, 'fixture_ascii.ply');
const BINF   = path.join(__dirname, 'fixture_binary.ply');

function runOnFixture(fixturePath, tmpDir) {
  const out = execFileSync('python3', [SCRIPT, fixturePath], {
    cwd: tmpDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const receiptFile = path.join(tmpDir, 'verify_ply_zflip_receipt.json');
  assert.ok(fs.existsSync(receiptFile), `receipt file missing in ${tmpDir}`);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  return { stdout: out, receipt };
}

describe('verify_ply_zflip node regression', () => {
  let tmp;
  before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pzflip-')); });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('ascii fixture: vcount, zflip sign inversion, y_up verdict', () => {
    const { receipt } = runOnFixture(ASCIIF, tmp);
    assert.equal(receipt.format, 'ascii');
    assert.equal(receipt.vcount, 4);
    // original z extent [0, 1]
    assert.deepEqual(receipt.original.z, [0.0, 1.0, 1.0]);
    // after zflip z becomes [-1, 0] -> extent still 1.0 but min is -1
    assert.equal(receipt.after_zflip.z[0], -1.0);
    // sign of zero is irrelevant: -0.0 === 0.0 for geometric extents
    assert.ok(receipt.after_zflip.z[1] === 0 || Object.is(receipt.after_zflip.z[1], -0));
    assert.equal(receipt.z_extent, 1.0);
    assert.equal(receipt.y_up_likely, true);
    assert.equal(receipt.z_up_likely, false);
  });

  it('binary fixture: vcount, zflip sign inversion, y_up verdict', () => {
    const { receipt } = runOnFixture(BINF, tmp);
    assert.equal(receipt.format, 'binary_little_endian');
    assert.equal(receipt.vcount, 4);
    assert.deepEqual(receipt.original.z, [0.0, 1.0, 1.0]);
    assert.equal(receipt.after_zflip.z[0], -1.0);
    // sign of zero is irrelevant: -0.0 === 0.0 for geometric extents
    assert.ok(receipt.after_zflip.z[1] === 0 || Object.is(receipt.after_zflip.z[1], -0));
    assert.equal(receipt.z_extent, 1.0);
    assert.equal(receipt.y_up_likely, true);
    assert.equal(receipt.z_up_likely, false);
  });

  it('x/y extents unchanged by zflip', () => {
    const { receipt } = runOnFixture(ASCIIF, tmp);
    assert.deepEqual(receipt.original.x, receipt.after_zflip.x);
    assert.deepEqual(receipt.original.y, receipt.after_zflip.y);
    assert.equal(receipt.y_extent, 2.0);
  });

  it('receipt file is written with valid JSON', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pzflip-r-'));
    try {
      runOnFixture(ASCIIF, tmp2);
      const rf = path.join(tmp2, 'verify_ply_zflip_receipt.json');
      const raw = fs.readFileSync(rf, 'utf8');
      const parsed = JSON.parse(raw);
      assert.equal(parsed.source, ASCIIF);
      assert.ok(typeof parsed.y_up_likely === 'boolean');
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });
});
