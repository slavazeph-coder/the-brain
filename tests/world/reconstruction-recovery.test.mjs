import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructionRecovery } from '../../brainsnn-r3f-app/public/world/reconstruction-recovery.mjs';

test('real partial registration example remains unscaled and prompts recapture', () => {
  const x = reconstructionRecovery({ schema: 'brainsnn.reconstruction.v1', capture: { images: 140, registered_images: 52, models_found: 3 } });
  assert.equal(x.label, 'Partial reconstruction');
  assert.equal(x.registered, 52);
  assert.equal(x.total, 140);
  assert.equal(x.fraction, 52/140);
  assert.match(x.summary, /37%/);
  assert.match(x.actions.join(' '), /disconnected/);
  assert.match(x.note, /not spatial coverage/);
});

test('all registered frames still do not establish physical accuracy', () => {
  const x = reconstructionRecovery({ schema: 'brainsnn.reconstruction.v1', capture: { images: 10, registered_images: 10, models_found: 1 } });
  assert.equal(x.label, 'Registration needs review');
  assert.match(x.summary, /does not prove/);
});

test('folded geometry blocks misleading recommendations', () => {
  const x = reconstructionRecovery({ schema: 'brainsnn.reconstruction.v1', capture: { images: 20, registered_images: 19, consistency: { status: 'folded' } } });
  assert.equal(x.folded, true);
  assert.match(x.summary, /Do not use/);
});

test('unknown or invalid counts do not invent rates', () => {
  assert.equal(reconstructionRecovery(null), null);
  const x = reconstructionRecovery({ schema: 'brainsnn.reconstruction.v1', capture: { images: 20, registered_images: 29 } });
  assert.equal(x.fraction, null);
  assert.equal(x.registered, null);
  assert.match(x.summary, /unavailable/);
});
