import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultImageFraming, framedImageRect, normalizeImageFraming } from '../src/imageFraming.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('image framing starts with contain and supports zooming out and moving', () => {
  assert.deepEqual(framedImageRect(200, 100, 400, 400, { fit: 'contain' }), { x: 0, y: 100, width: 400, height: 200 });
  assert.deepEqual(framedImageRect(200, 100, 400, 400, { fit: 'contain', imageZoom: 0.5, imageOffsetX: 10, imageOffsetY: -10 }), { x: 140, y: 110, width: 200, height: 100 });
  assert.deepEqual(normalizeImageFraming({ imageZoom: 9, imageOffsetX: -200, imageOffsetY: 200 }), { imageZoom: 3, imageOffsetX: -100, imageOffsetY: 100 });
  assert.deepEqual(normalizeImageFraming({}), defaultImageFraming);
});

test('the image editor persists framing per texture slot and the 3D material applies it', () => {
  assert.match(app, /function ImageFramingControls\(/);
  assert.match(app, /onFramingChange=\{\(slot, framing\) => updateDraftVisualOptions\(textureSlotPatch\(visualItem, slot, framing\)\)\}/);
  assert.match(app, /createCoverImageTexture\(image, targetWidth, targetHeight, \{ flipY: textureOptions\.textureSlotFlipY \?\? true, fit: 'contain', backgroundColor: '#ffffff', \.\.\.normalizeImageFraming\(value\) \}\)/);
  assert.match(app, /onPrestigeSignageFraming=\{\(item, slot, framing\) => updateItemOptions\(item, textureSlotPatch\(item, slot, framing\)\)\}/);
  assert.match(app, /if \(item\) setDraftVisualOptions\(item\.options \|\| \{\}\)/);
});
