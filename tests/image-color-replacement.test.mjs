import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHexColor, recolorImageUrl, recolorPixelData, recolorSvgMarkup } from '../src/imageColorReplacement.js';

test('normalizes short and long hexadecimal colors', () => {
  assert.equal(normalizeHexColor('#F0a'), '#ff00aa');
  assert.equal(normalizeHexColor('ff00ff'), '#ff00ff');
  assert.equal(normalizeHexColor('orange'), '');
});

test('replaces every matching SVG color without touching neighboring colors', () => {
  const svg = '<svg><path fill="#ff00ff"/><path stroke="#ff00ff"/><path fill="#ff00ff00"/><path fill="#112233"/></svg>';
  const result = recolorSvgMarkup(svg, '#ff00ff', '#1A2B3C');
  assert.equal(result, '<svg><path fill="#1a2b3c"/><path stroke="#1a2b3c"/><path fill="#ff00ff00"/><path fill="#112233"/></svg>');
});

test('recolors matching PNG pixels while preserving alpha and unrelated pixels', () => {
  const pixels = new Uint8ClampedArray([
    255, 24, 255, 255,
    248, 31, 250, 128,
    12, 34, 56, 255,
    255, 24, 255, 0,
  ]);
  recolorPixelData(pixels, '#ff00ff', '#336699');
  assert.deepEqual([...pixels], [
    51, 102, 153, 255,
    51, 102, 153, 128,
    12, 34, 56, 255,
    255, 24, 255, 0,
  ]);
});

test('inline SVG pictograms are recolored too, without rasterizing or adding a background', async () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ff00ff" stroke="#112233" d="M2 2H8V8H2Z"/></svg>';
  const url = `data:image/svg+xml,${encodeURIComponent(markup)}`;
  const result = await recolorImageUrl(url, '#ff00ff', '#1a2b3c');
  const colored = decodeURIComponent(result.slice(result.indexOf(',') + 1));
  assert.match(colored, /fill="#1a2b3c"/);
  assert.match(colored, /stroke="#112233"/);
  assert.doesNotMatch(colored, /<rect|<image/);
});
