import test from 'node:test';
import assert from 'node:assert/strict';
import {readCaptureReport, captureReportCard, CAPTURE_REPORT_SCHEMA} from '../../brainsnn-r3f-app/public/world/capture-report.mjs';

const report = () => ({schema: CAPTURE_REPORT_SCHEMA, status: 'ok', seconds_total: 140, seconds_registered: 66, registered_share: .471,
  longest_registered: {start: 75, end: 103, registered: true, seconds: 28},
  stretches: [{start: 0, end: 29, registered: true}, {start: 29, end: 32, registered: false}, {start: 32, end: 51, registered: true}, {start: 51, end: 75, registered: false}, {start: 75, end: 103, registered: true}, {start: 103, end: 140, registered: false}],
  dropped: [{start: 51, end: 75, seconds: 24, cause: 'motion-blur', reason: '22 of 25 frames are much softer than the registered ones: the phone was moving too fast.', advice: 'Walk at half the speed through this part and pause for a second at turns.'},
            {start: 103, end: 140, seconds: 37, cause: 'no-overlap', reason: 'The frames are sharp but none joined the model.', advice: 'Film this part again, turning slowly and keeping something you already filmed in view.'}],
  verdict: '66 of 140 seconds registered. Most of the walk did not join the model; the scene comes from the 28-second stretch at 75–103 s.',
  advice: ['Hold the phone level at chest height, walk slowly, and finish where you started so the end overlaps the beginning.'],
  sharpness: {measured: true, registered_median: 363.1, blur_ratio: .5}});

test('a worker capture report becomes a bounded timeline with its dropped stretches and causes', () => {
  const r = readCaptureReport(report());
  assert.equal(r.ok, true); assert.equal(r.total, 140); assert.equal(r.registered, 66); assert.ok(Math.abs(r.share - 66 / 140) < 1e-9);
  assert.equal(r.stretches.length, 6); assert.deepEqual(r.dropped.map(d => d.cause), ['motion-blur', 'no-overlap']);
  assert.deepEqual(r.longest, {start: 75, end: 103});
});

test('anything that is not a capture report renders nothing, and a report without frames says so', () => {
  assert.equal(readCaptureReport(null), null); assert.equal(readCaptureReport({schema: 'brainsnn.reconstruction.v1'}), null);
  assert.equal(readCaptureReport({...report(), seconds_total: -1}), null); assert.equal(readCaptureReport({...report(), stretches: 'x'}), null);
  assert.equal(captureReportCard(undefined), '');
  const empty = readCaptureReport({schema: CAPTURE_REPORT_SCHEMA, status: 'no-frames', verdict: 'The reconstruction records no sampled frames, so there is no capture to report on.'});
  assert.equal(empty.ok, false); assert.match(captureReportCard({schema: CAPTURE_REPORT_SCHEMA, status: 'no-frames', verdict: 'none'}), /none/);
});

test('the card draws every stretch in proportion, marks blurred stretches amber, escapes text and never claims the room', () => {
  const html = captureReportCard({...report(), verdict: '<b>x</b> & y'});
  assert.match(html, /47% of the walk registered/);
  assert.equal((html.match(/<i class="registered"/g) || []).length, 3);
  assert.equal((html.match(/<i class="blurred"/g) || []).length, 1);
  assert.equal((html.match(/<i class="dropped"/g) || []).length, 2);
  assert.match(html, /width:20\.00%/, 'the 28 s stretch of 140 s');
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; y/); assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /0:51–1:15/); assert.match(html, /changes no geometry, scale or review flag/);
  const unmeasured = captureReportCard({...report(), sharpness: {measured: false}});
  assert.match(unmeasured, /sharpness not measured/);
});

test('oversized or malformed dropped entries are capped and skipped, not rendered', () => {
  const r = readCaptureReport({...report(), dropped: [{start: 1, end: 2, cause: 'ghost'}, ...Array.from({length: 80}, (_, i) => ({start: i, end: i + 1, cause: 'no-overlap', reason: 'r', advice: 'a'}))]});
  assert.equal(r.dropped.length, 49);
});
