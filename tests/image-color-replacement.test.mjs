import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHexColor, recolorPixelData, recolorSvgMarkup } from '../src/imageColorReplacement.js';

test('normalizes short and long hexadecimal colors', () => {
  assert.equal(normalizeHexColor('#F0a'), '#ff00aa');
  assert.equal(normalizeHexColor('FF18ff'), '#ff18ff');
  assert.equal(normalizeHexColor('orange'), '');
});

test('replaces every matching SVG color without touching neighboring colors', () => {
  const svg = '<svg><path fill="#FF18FF"/><path stroke="#ff18ff"/><path fill="#ff18ff00"/><path fill="#112233"/></svg>';
  const result = recolorSvgMarkup(svg, '#ff18ff', '#1A2B3C');
  assert.equal(result, '<svg><path fill="#1a2b3c"/><path stroke="#1a2b3c"/><path fill="#ff18ff00"/><path fill="#112233"/></svg>');
});

test('recolors matching PNG pixels while preserving alpha and unrelated pixels', () => {
  const pixels = new Uint8ClampedArray([
    255, 24, 255, 255,
    248, 31, 250, 128,
    12, 34, 56, 255,
    255, 24, 255, 0,
  ]);
  recolorPixelData(pixels, '#ff18ff', '#336699');
  assert.deepEqual([...pixels], [
    51, 102, 153, 255,
    51, 102, 153, 128,
    12, 34, 56, 255,
    255, 24, 255, 0,
  ]);
});
