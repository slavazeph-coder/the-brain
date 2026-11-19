/** Actual browser object editing on labelled authored samples, never reconstruction or physical validation. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseVisualAsset, STRIDE } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const { chromium, webkit, devices } = require('playwright');
const base = (process.env.WORLD_URL || 'http://127.0.0.1:8765/world/index.html').replace(/[^/]*$/, '');
const output = new URL('../../output/playwright/world/', import.meta.url);
await mkdir(output, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const C0 = .28209479177387814;

function fixture(gaussian = false) {
  const samples = [];
  for (const y of [.8, 1.2]) for (const x of [-.35, -.1, .1, .35]) for (const z of [-.25, .25])
    samples.push({ xyz: [x, y, z], rgb: [230, 40, 70], scales: [.09, .05, .03], quat: [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)] });
  for (const x of [-1.5, -.5, .5, 1.5]) for (const z of [-1.5, -.5, .5, 1.5])
    samples.push({ xyz: [x, 0, z], rgb: [35, 110, 200], scales: [.045, .045, .045], quat: [0, 0, 0, 1] });
  const properties = gaussian
    ? ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].map(name => `property float ${name}`)
    : ['property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue'];
  const rows = samples.map(({ xyz, rgb, scales, quat }) => gaussian
    ? [...xyz, ...rgb.map(v => (v / 255 - .5) / C0), Math.log(9), ...scales.map(Math.log), quat[3], ...quat.slice(0, 3)].join(' ')
    : [...xyz, ...rgb].join(' '));
  return Buffer.from(['ply', 'format ascii 1.0', 'comment authored browser fixture, not a physical capture', `element vertex ${samples.length}`, ...properties, 'end_header', ...rows, ''].join('\n'));
}

async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function image(canvas, page) {
  await canvas.scrollIntoViewIfNeeded(); await settled(page);
  return canvas.evaluate(el => el.toDataURL('image/png'));
}
async function visiblePixels(canvas) {
  return canvas.evaluate(el => {
    const gl = el.getContext('webgl2'), pixels = new Uint8Array(el.width * el.height * 4);
    gl.readPixels(0, 0, el.width, el.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 35 || pixels[i + 1] > 35 || pixels[i + 2] > 35) visible++;
    return { visible, error: gl.getError() };
  });
}
async function download(page, button) {
  const [result] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const bytes = await readFile(await result.path());
  return { bytes, name: result.suggestedFilename() };
}

function close(a, b, message, tolerance = 2e-5) { assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} versus ${b}`); }
function vertexLabels(bytes, gaussian) {
  const marker = Buffer.from('end_header\n'), start = bytes.indexOf(marker) + marker.length;
  assert.ok(start >= marker.length, 'Derived PLY has a complete header');
  const header = bytes.subarray(0, start).toString('ascii'), count = Number(header.match(/element vertex (\d+)/)?.[1]);
  const stride = gaussian ? 64 : 23, offset = gaussian ? 56 : 15;
  assert.equal(bytes.length, start + count * stride, 'Derived PLY has one complete binary record per declared vertex');
  return Array.from({ length: count }, (_, i) => [bytes.readUInt32LE(start + i * stride + offset), bytes.readUInt32LE(start + i * stride + offset + 4)]);
}
function verifyMovedAsset(bytes, original, gaussian, tx = 1.25, yawDegrees = 90) {
  const exported = parseVisualAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'derived.ply');
  assert.equal(exported.kind, gaussian ? 'gaussian-splat' : 'point-cloud');
  assert.equal(exported.points.length / STRIDE, 32);
  const angle = yawDegrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < 32; i++) {
    const at = i * STRIDE, edited = i < 16;
    close(exported.points[at], edited ? c * original[at] + s * original[at + 2] + tx : original[at], `x row ${i}`);
    close(exported.points[at + 1], original[at + 1], `y row ${i}`);
    close(exported.points[at + 2], edited ? -s * original[at] + c * original[at + 2] : original[at + 2], `z row ${i}`);
    if (gaussian) {
      for (let j = 3; j < 6; j++) close(exported.points[at + j], original[at + j], `covariance scale row ${i}`);
      const [x, y, z, w] = original.subarray(at + 10, at + 14), sh = Math.sin(angle / 2), ch = Math.cos(angle / 2);
      const expected = edited ? [ch * x + sh * z, ch * y + sh * w, ch * z - sh * x, ch * w - sh * y] : [x, y, z, w];
      const actual = exported.points.subarray(at + 10, at + 14);
      close(Math.abs(actual.reduce((sum, v, j) => sum + v * expected[j], 0)), 1, `Gaussian rotation row ${i}`);
      for (let j = 6; j < 10; j++) close(exported.points[at + j], original[at + j], `DC/opacity row ${i}`);
    }
  }
  const header = bytes.subarray(0, bytes.indexOf(Buffer.from('end_header'))).toString('ascii');
  assert.match(header, /authored derived retained-preview/);
  assert.match(header, /no higher-order SH/);
  assert.match(header, /property uint source_index/);
  assert.match(header, /property uint object_instance/);
  if (!gaussian) assert.doesNotMatch(header, /property float rot_0/);
  assert.deepEqual(vertexLabels(bytes, gaussian), Array.from({ length: 32 }, (_, i) => [i, i < 16 ? 1 : 0]), 'Derived rows retain their original vertex IDs and separate background/object labels');
  return exported;
}

// UI selectors and workflows are kept here, rather than testing private application state.
const field = (page, name) => page.locator(`#objectify-panel [data-objectify-${name}]`);
const action = field;
const status = page => page.locator('#objectify-panel [data-objectify-status]');

async function selectObject(page, canvas) {
  await page.evaluate(() => {
    window.objectifySelectionTrace = [];
    if (window.objectifyTraceInstalled) return;
    window.objectifyTraceInstalled = true;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'focusin', 'scroll']) document.addEventListener(type, event => {
      const rect = document.querySelector('#asset-canvas')?.getBoundingClientRect();
      window.objectifySelectionTrace.push({ type, target: event.target?.id || event.target?.tagName, x: event.clientX, y: event.clientY,
        scrollY, canvas: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        selecting: document.querySelector('[data-objectify-select]')?.getAttribute('aria-pressed') });
      if (window.objectifySelectionTrace.length > 30) window.objectifySelectionTrace.shift();
    }, true);
  });
  await field(page, 'min-y').fill('0.5'); await field(page, 'max-y').fill('1.5');
  await action(page, 'select').click();
  await canvas.scrollIntoViewIfNeeded(); await settled(page);
  const box = await canvas.boundingBox(); assert.ok(box, 'Visible selection canvas');
  // Rounded stage corners clip the canvas hit target. Keep both gesture endpoints inside its visible surface.
  const inset = 24, start = { x: box.x + inset, y: box.y + inset }, end = { x: box.x + box.width - inset, y: box.y + box.height - inset };
  assert.deepEqual(await canvas.evaluate((el, { start, end }) => [document.elementFromPoint(start.x, start.y) === el, document.elementFromPoint(end.x, end.y) === el], { start, end }), [true, true], 'Both rectangle endpoints must hit the visible canvas');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up(); await settled(page);
  const selection = await field(page, 'selection').textContent();
  if (!/^16 retained samples selected/.test(selection)) console.log('Selection diagnostics: ' + JSON.stringify(await page.evaluate(box => ({
    box, now: document.querySelector('#asset-canvas').getBoundingClientRect().toJSON(), scrollY,
    startHit: document.elementFromPoint(box.x + 24, box.y + 24)?.outerHTML.slice(0, 250),
    endHit: document.elementFromPoint(box.x + box.width - 24, box.y + box.height - 24)?.outerHTML.slice(0, 250),
    trace: window.objectifySelectionTrace,
  }), box)));
  assert.match(selection, /^16 retained samples selected/, 'The height slab must exclude all floor samples');
}

async function check(browser, mobile, gaussian) {
  const context = await browser.newContext(mobile ? { ...devices['iPhone 15'], deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [], requests = [];
  const label = `${browser.browserType().name()}-${mobile ? 'phone' : 'desktop'}-${gaussian ? 'gaussian' : 'cloud'}`;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  const bytes = fixture(gaussian), filename = `authored-objectify-${gaussian ? 'gaussian' : 'cloud'}.ply`;
  const original = parseVisualAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), filename).points;
  try {
    await page.goto(base + 'splat.html');
    await page.locator('#asset').setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes });
    await page.waitForFunction(() => document.querySelector('#viewer-status').textContent.includes('32 visible points'));
    await action(page, 'select').waitFor({ state: 'visible' });
    const canvas = page.locator('#asset-canvas'), baseline = await image(canvas, page);
    const rendered = await visiblePixels(canvas); assert.equal(rendered.error, 0); assert.ok(rendered.visible > 30, 'The authored fixture must really render');
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();
    assert.ok(await page.locator('[data-tour-export]').isEnabled());

    await selectObject(page, canvas);
    assert.ok(await page.locator('[data-tour-export]').isDisabled(), 'An uncommitted selection clears the previous camera path');
    await page.locator('#flip').click();
    await page.waitForFunction(() => !document.querySelector('[data-tour-add]').disabled);
    assert.equal(await field(page, 'selection').textContent(), 'No samples selected.');
    const flippedDocument = JSON.parse((await download(page, action(page, 'export'))).bytes);
    assert.equal(flippedDocument.source.displayTransform, 'flip-y-z');
    await page.locator('#flip').click();
    await page.waitForFunction(() => !document.querySelector('[data-tour-add]').disabled);
    assert.equal(await image(canvas, page), baseline, 'Flipping back before creating a group restores the original preview');
    assert.ok(await page.locator('[data-tour-export]').isDisabled(), 'Axis changes clear saved views');
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();

    await selectObject(page, canvas);
    assert.ok(await page.locator('[data-tour-export]').isDisabled(), 'Selection must invalidate original-source camera paths');
    await field(page, 'name').fill('Reviewed fixture chair');
    await field(page, 'reviewed').check(); await action(page, 'create').click();
    const highlightedOriginal = await image(canvas, page);
    assert.ok(await page.locator('#flip').isDisabled(), 'Axis changes require resetting existing object groups');
    await field(page, 'tx').fill('1.25'); await field(page, 'yaw').fill('90');
    await action(page, 'apply').click();
    const moved = await image(canvas, page);
    assert.notEqual(moved, highlightedOriginal, 'Actual displayed samples must move while the same object stays highlighted');
    const layout = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.content <= layout.viewport, `Object workshop must fit the ${mobile ? 'phone' : 'desktop'} viewport without horizontal scrolling: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: new URL(label + '-objectify-moved.png', output).pathname, fullPage: true });
    await action(page, 'prepare').click();
    const derived = await download(page, action(page, 'save-ply'));
    const receiptDownload = await download(page, action(page, 'save-receipt'));
    const receipt = JSON.parse(receiptDownload.bytes);
    assert.equal(receipt.source.sha256, sha(bytes));
    assert.equal(receipt.originalSourcePreserved, true);
    assert.equal(receipt.sourceGeometryChanged, true);
    assert.equal(receipt.variantArtifact.sha256, sha(derived.bytes));
    assert.equal(receipt.metricScaleVerified, false); assert.equal(receipt.collisionProxyValidated, false); assert.equal(receipt.physicalRobotValidated, false);
    assert.equal(receipt.automaticSegmentationExecuted, false); assert.equal(receipt.completeObjectVerified, false);
    assert.equal(receipt.physicalAccuracyVerified, false); assert.equal(receipt.higherOrderShPreserved, false);
    assert.equal(receipt.backgroundCompletion, 'unknown-no-inpainting');
    assert.deepEqual(receipt.objects[0].physicalProperties, { mass: null, friction: null, inertia: null });
    assert.equal(receipt.objects[0].bimClass, null);
    verifyMovedAsset(derived.bytes, original, gaussian);
    const docDownload = await download(page, action(page, 'export'));
    const document = JSON.parse(docDownload.bytes);
    assert.equal(document.source.sha256, sha(bytes)); assert.deepEqual(document.objects[0].indices, Array.from({ length: 16 }, (_, i) => i));
    assert.equal(receipt.editManifestSha256, sha(docDownload.bytes));
    assert.equal(document.source.displayTransform, 'identity');
    assert.equal(document.objects[0].name, 'Reviewed fixture chair');
    assert.equal(document.objects[0].reviewed, true);

    await action(page, 'stage').click();
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();
    const stagedPath = JSON.parse((await download(page, page.locator('[data-tour-export]'))).bytes);
    assert.equal(stagedPath.source.sha256, sha(derived.bytes), 'Camera receipt must bind the exact derived artifact');
    assert.equal(stagedPath.provenance, 'authored');
    assert.ok(await page.locator('[data-tour-provenance]').isDisabled(), 'Derived appearance provenance stays authored');
    const relabelledPath = structuredClone(stagedPath); relabelledPath.provenance = 'camera-reconstruction';
    await page.locator('[data-tour-import]').setInputFiles({ name: 'incorrect-origin-path.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(relabelledPath)) });
    await page.waitForFunction(() => /Path rejected:.*authored origin/.test(document.querySelector('[data-tour-status]').textContent));
    assert.deepEqual(JSON.parse((await download(page, page.locator('[data-tour-export]'))).bytes), stagedPath, 'An imported camera path cannot relabel authored geometry or replace the accepted path');

    await field(page, 'hidden').check(); await action(page, 'apply').click();
    assert.ok(await page.locator('[data-tour-export]').isDisabled(), 'A subsequent edit invalidates the staged camera');
    const hidden = await image(canvas, page); assert.notEqual(hidden, moved);
    await action(page, 'prepare').click();
    const hiddenAsset = await download(page, action(page, 'save-ply'));
    assert.deepEqual(vertexLabels(hiddenAsset.bytes, gaussian), Array.from({ length: 16 }, (_, i) => [i + 16, 0]), 'Hidden samples are omitted from the derived asset, exposing only the captured floor');
    await field(page, 'hidden').uncheck(); await action(page, 'apply').click();
    await action(page, 'duplicate').click();
    await action(page, 'prepare').click();
    const duplicated = await download(page, action(page, 'save-ply'));
    const duplicateAsset = parseVisualAsset(duplicated.bytes.buffer.slice(duplicated.bytes.byteOffset, duplicated.bytes.byteOffset + duplicated.bytes.byteLength), 'duplicate.ply');
    assert.equal(duplicateAsset.points.length / STRIDE, 48, 'Duplication adds the selected samples, not a proxy box');
    assert.deepEqual(vertexLabels(duplicated.bytes, gaussian).slice(32), Array.from({ length: 16 }, (_, i) => [i, 2]), 'An authored copy preserves source vertex IDs and uses its own instance label');

    await action(page, 'reset').click();
    assert.equal(await image(canvas, page), baseline, 'Reset must restore original geometry, colours and camera exactly');
    const originalHash = await page.locator('#asset').evaluate(async el => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await el.files[0].arrayBuffer())), n => n.toString(16).padStart(2, '0')).join(''));
    assert.equal(originalHash, sha(bytes), 'All edits leave the selected original file byte-for-byte intact');
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();
    assert.equal(JSON.parse((await download(page, page.locator('[data-tour-export]'))).bytes).source.sha256, sha(bytes), 'Reset restores the original camera source binding');

    await action(page, 'prepare').click();
    const emptyVariant = await download(page, action(page, 'save-ply'));
    await action(page, 'stage').click();
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();
    assert.equal(JSON.parse((await download(page, page.locator('[data-tour-export]'))).bytes).source.sha256, sha(emptyVariant.bytes), 'Even an empty edit document stages a separate authored artifact');
    await field(page, 'name').fill('Uncommitted fixture name');
    assert.equal(await image(canvas, page), baseline, 'Interacting with an empty staged document restores the original parsed appearance');
    assert.ok(await page.locator('[data-tour-provenance]').isEnabled(), 'Returning to the original source unlocks its origin control');
    assert.ok(await page.locator('[data-tour-export]').isDisabled(), 'Returning to the original source invalidates the derived path');
    await field(page, 'name').fill('');
    await page.locator('[data-tour-add]').click(); await page.locator('[data-tour-add]').click();
    assert.equal(JSON.parse((await download(page, page.locator('[data-tour-export]'))).bytes).source.sha256, sha(bytes), 'Empty-document interaction restores the original camera hash');
    await action(page, 'import').setInputFiles({ name: 'matching-objects.json', mimeType: 'application/json', buffer: docDownload.bytes });
    await page.waitForFunction(() => /Matching-source edit document reopened/.test(document.querySelector('#objectify-panel [data-objectify-status]').textContent));
    assert.equal(await image(canvas, page), moved, 'Matching-source edits reproduce the same rendered pose');

    await page.locator('#objectify-panel .objectify-variants summary').click();
    await field(page, 'seed').fill('42'); await field(page, 'count').fill('2');
    await action(page, 'generate').click(); await field(page, 'variant').selectOption('0'); await action(page, 'prepare').click();
    const seeded = await download(page, action(page, 'save-ply'));
    const seededReceipt = JSON.parse((await download(page, action(page, 'save-receipt'))).bytes);
    assert.equal(seededReceipt.variation.seed, 42); assert.equal(seededReceipt.variation.algorithm, 'mulberry32-v1');
    await field(page, 'variant').selectOption('-1');
    await action(page, 'generate').click(); await field(page, 'variant').selectOption('0'); await action(page, 'prepare').click();
    assert.deepEqual((await download(page, action(page, 'save-ply'))).bytes, seeded.bytes, 'Identical seed, baseline and ranges produce byte-identical authored exports');

    const beforeRefusal = (await download(page, action(page, 'export'))).bytes;
    const wrong = structuredClone(document); wrong.source.sha256 = 'f'.repeat(64);
    await action(page, 'import').setInputFiles({ name: 'wrong-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrong)) });
    await page.waitForFunction(() => /different source|does not match|rejected/i.test(document.querySelector('#objectify-panel [data-objectify-status]').textContent));
    assert.deepEqual((await download(page, action(page, 'export'))).bytes, beforeRefusal, 'A mismatched source must not modify the active edits');
    const wrongOrientation = structuredClone(document); wrongOrientation.source.displayTransform = 'flip-y-z';
    await action(page, 'import').setInputFiles({ name: 'wrong-orientation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wrongOrientation)) });
    await page.waitForFunction(() => /rejected:.*orientation/i.test(document.querySelector('#objectify-panel [data-objectify-status]').textContent));
    assert.deepEqual((await download(page, action(page, 'export'))).bytes, beforeRefusal, 'A mismatched orientation must not modify the active edits');

    assert.deepEqual(errors, []);
    assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).origin === new URL(base).origin), JSON.stringify(requests));
    await writeFile(new URL(label + '-objectify.png', output), Buffer.from((await image(canvas, page)).split(',')[1], 'base64'));
    console.log(`${label}: authored selection, rendered transform/hide/duplicate/reset, source/orientation refusal, deterministic variants, covariance exports and camera binding passed`);
  } catch (error) {
    const diagnostic = { label, error: String(error), status: await status(page).textContent().catch(() => null), viewer: await page.locator('#viewer-status').textContent().catch(() => null), errors };
    await writeFile(new URL(label + '-objectify-failure.json', output), JSON.stringify(diagnostic, null, 2));
    await page.screenshot({ path: new URL(label + '-objectify-failure.png', output).pathname, fullPage: true }).catch(() => {});
    throw Error(JSON.stringify(diagnostic), { cause: error });
  } finally { await context.close(); }
}

for (const name of (process.env.WORLD_BROWSERS || 'chromium,webkit').split(',')) {
  const type = { chromium, webkit }[name]; assert.ok(type, `Unknown browser ${name}`);
  const executablePath = process.env[name === 'webkit' ? 'PLAYWRIGHT_WEBKIT_PATH' : 'PLAYWRIGHT_CHROMIUM_PATH'];
  const browser = await type.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try { await check(browser, false, false); await check(browser, true, true); } finally { await browser.close(); }
}
