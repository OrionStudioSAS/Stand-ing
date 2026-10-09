import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePartitionHeadVisuals, partitionHeadUsesDifferentVisuals, patchPartitionHeadVisuals, withPartitionHeadVisualMode } from '../src/partitionHeadVisuals.js';

const image = (name) => ({ headMainImageUrl: `${name}.png`, headMainImageName: `${name}.png`, visualPending: false });
const reload = (visuals) => normalizePartitionHeadVisuals(JSON.parse(JSON.stringify(visuals)));

test('one upload is shared by default, without sharing side-specific settings', () => {
  const initial = { left: { rotation: 0 }, right: { rotation: 180 } };
  const changed = patchPartitionHeadVisuals(normalizePartitionHeadVisuals(initial), 'left', { ...image('common'), rotation: 90 });
  assert.equal(changed.differentVisuals, false);
  assert.equal(changed.left.headMainImageUrl, 'common.png');
  assert.equal(changed.right.headMainImageUrl, 'common.png');
  assert.equal(changed.left.rotation, 90);
  assert.equal(changed.right.rotation, 180);
  assert.deepEqual(initial, { left: { rotation: 0 }, right: { rotation: 180 } });
  assert.deepEqual(reload(changed), changed);
});

test('legacy scenes retain different artwork, while a single existing artwork becomes shared', () => {
  for (const side of ['left', 'right']) {
    const shared = normalizePartitionHeadVisuals({ [side]: image('existing') });
    assert.equal(shared.differentVisuals, false);
    assert.equal(shared.left.headMainImageUrl, shared.right.headMainImageUrl);
  }
  const legacy = { left: image('left'), right: image('right') };
  const kept = normalizePartitionHeadVisuals(legacy);
  assert.equal(kept.differentVisuals, true);
  assert.equal(kept.left.headMainImageUrl, 'left.png');
  assert.equal(kept.right.headMainImageUrl, 'right.png');
  assert.deepEqual(reload(kept), kept);
});

test('different-artwork checkbox enables independent uploads and survives save/reopen', () => {
  const shared = patchPartitionHeadVisuals({}, 'right', image('common'));
  const split = withPartitionHeadVisualMode(shared, true);
  const changed = patchPartitionHeadVisuals(split, 'right', image('right'));
  assert.equal(changed.left.headMainImageUrl, 'common.png');
  assert.equal(changed.right.headMainImageUrl, 'right.png');
  assert.equal(partitionHeadUsesDifferentVisuals(reload(changed)), true);
  const joined = withPartitionHeadVisualMode(changed, false);
  assert.equal(joined.left.headMainImageUrl, 'common.png');
  assert.equal(joined.right.headMainImageUrl, 'common.png');
  assert.equal(partitionHeadUsesDifferentVisuals(reload(joined)), false);
});

test('pending and reset apply to both linked heads, but only one independent head', () => {
  const shared = patchPartitionHeadVisuals({}, 'left', image('common'));
  const pending = patchPartitionHeadVisuals(shared, 'right', { visualPending: true });
  assert.equal(pending.left.visualPending, true);
  assert.equal(pending.right.visualPending, true);
  const empty = { headMainImageUrl: '', headMainImageName: '', visualPending: false };
  const reset = patchPartitionHeadVisuals(pending, 'right', empty);
  assert.deepEqual(reset.left, empty);
  assert.deepEqual(reset.right, empty);
  const separateReset = patchPartitionHeadVisuals(withPartitionHeadVisualMode(shared, true), 'left', empty);
  assert.equal(separateReset.left.headMainImageUrl, '');
  assert.equal(separateReset.right.headMainImageUrl, 'common.png');
});

test('Signature top artwork and framing are shared without replacing LED images or colour slots', () => {
  const visuals = normalizePartitionHeadVisuals({
    left: { ...image('common'), textureSlotValues: { paint: { colorHex: '#ffffff' } } },
    right: { ...image('common'), textureSlotValues: { paint: { colorHex: '#000000' } } },
  });
  const top = { imageUrl: 'top.png', imageName: 'top.png', imageZoom: 0.8, imageOffsetX: 15 };
  const changed = patchPartitionHeadVisuals(visuals, 'left', { textureSlotValues: { top, paint: { colorHex: '#ff0000' } } });
  assert.deepEqual(changed.left.textureSlotValues.top, top);
  assert.deepEqual(changed.right.textureSlotValues.top, top);
  assert.equal(changed.left.textureSlotValues.paint.colorHex, '#ff0000');
  assert.equal(changed.right.textureSlotValues.paint.colorHex, '#000000');
  assert.equal(changed.right.headMainImageUrl, 'common.png');
  const split = withPartitionHeadVisualMode(changed, true);
  const separate = patchPartitionHeadVisuals(split, 'right', { textureSlotValues: { top: { imageUrl: 'other.png' } } });
  assert.equal(separate.left.textureSlotValues.top.imageUrl, 'top.png');
  assert.equal(separate.right.textureSlotValues.top.imageUrl, 'other.png');
});

test('legacy Signature heads with different top images open in independent mode', () => {
  const visuals = {
    left: { textureSlotValues: { top: { imageUrl: 'a.png' } } },
    right: { textureSlotValues: { top: { imageUrl: 'b.png' } } },
  };
  assert.equal(normalizePartitionHeadVisuals(visuals).differentVisuals, true);
  assert.equal(patchPartitionHeadVisuals(visuals, 'invalid', image('new')), visuals);
});
