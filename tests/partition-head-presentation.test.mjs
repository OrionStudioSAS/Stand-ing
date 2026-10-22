import assert from 'node:assert/strict';
import test from 'node:test';
import { headArtwork, headArtworkIsCustom, headArtworkStatus, headFormat } from '../src/partitionHeadPresentation.js';
import { normalizePartitionHeadVisuals, patchPartitionHeadVisuals, withPartitionHeadVisualMode } from '../src/partitionHeadVisuals.js';

test('the presentation distinguishes standard, missing, pending and uploaded visuals without claiming format validation', () => {
  assert.equal(headArtworkIsCustom(headArtwork({})), false);
  assert.equal(headArtworkIsCustom(headArtwork({ headMainVisualMode: 'custom' })), true);
  assert.equal(headArtworkStatus(headArtwork({}), false), 'standard');
  assert.equal(headArtworkStatus(headArtwork({ headMainImageName: 'image.pdf' })), 'missing');
  assert.equal(headArtworkStatus(headArtwork({ headMainImageUrl: 'art.svg' })), 'ready');
  assert.equal(headArtworkStatus(headArtwork({ headMainImageUrl: 'art.svg', visualPending: true })), 'pending');
  assert.equal(headArtworkIsCustom(headArtwork({ textureSlotValues: { top: { visualEnabled: false, imageUrl: 'old.png' } } }, 'top')), false);
  assert.equal(headArtworkIsCustom(headArtwork({ textureSlotValues: { top: { visualEnabled: true } } }, 'top')), true);
});

test('an empty custom-artwork choice survives shared/independent changes and save/reopen', () => {
  const custom = patchPartitionHeadVisuals({}, 'left', { headMainVisualMode: 'custom' });
  assert.equal(custom.right.headMainVisualMode, 'custom');
  const restored = normalizePartitionHeadVisuals(JSON.parse(JSON.stringify(custom)));
  assert.equal(restored.left.headMainVisualMode, 'custom');
  assert.equal(restored.right.headMainVisualMode, 'custom');
  const independent = patchPartitionHeadVisuals(withPartitionHeadVisualMode(restored, true), 'right', { headMainVisualMode: 'standard' });
  assert.equal(independent.left.headMainVisualMode, 'custom');
  assert.equal(independent.right.headMainVisualMode, 'standard');
  const shared = withPartitionHeadVisualMode(independent, false);
  assert.equal(shared.left.headMainVisualMode, 'custom');
  assert.equal(shared.right.headMainVisualMode, 'custom');
});

test('print-size labels keep the dimensions of each existing model rather than the illustrative mockup', () => {
  assert.equal(headFormat([500, 350]), '500 × 350 mm');
  assert.equal(headFormat([546, 2908]), '546 × 2908 mm');
  assert.equal(headFormat([474, 296]), '474 × 296 mm');
  assert.equal(headFormat([947, 593]), '947 × 593 mm');
  assert.equal(headFormat([]), '');
});
