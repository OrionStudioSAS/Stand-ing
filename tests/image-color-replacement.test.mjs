import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHexColor, recolorImageUrl, recolorPixelData, recolorSvgMarkup, averageOpaquePixelColor } from '../src/imageColorReplacement.js';

test('texture swatch colors average the visible pixels, not transparent RGB values', () => {
  assert.equal(averageOpaquePixelColor([0, 80, 160, 255, 0, 100, 180, 255, 255, 0, 0, 0]), '#005aaa');
  assert.equal(averageOpaquePixelColor([255, 255, 255, 255]), '#ffffff');
  assert.equal(averageOpaquePixelColor([0, 0, 0, 255]), '#000000');
  assert.throws(() => averageOpaquePixelColor([255, 0, 0, 0]), /transparente/);
});

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

test('Illustrator shorthand paint colors match full source colors without altering SVG references', () => {
  const markup = '<svg><style>.st2{fill:#f0f;stroke:#1d1d1b}.shade{stop-color:#FF00FF}</style><defs><linearGradient id="f0f"/></defs><path fill="#f0f" stroke="#000"/><path style="fill: #F0F !important;stroke:#fff"/><path fill="url(#f0f)"/><use href="#f0f"/><path fill="#f0f0"/><path fill="#ff00ff80"/></svg>';
  const result = recolorSvgMarkup(markup, '#ff00ff', '#244998');
  assert.match(result, /\.st2\{fill:#244998;stroke:#1d1d1b\}/);
  assert.match(result, /stop-color:#244998/);
  assert.match(result, /fill="#244998" stroke="#000"/);
  assert.match(result, /fill: #244998 !important;stroke:#fff/);
  assert.match(result, /id="f0f"/);
  assert.match(result, /fill="url\(#f0f\)"/);
  assert.match(result, /href="#f0f"/);
  assert.match(result, /fill="#f0f0"/);
  assert.match(result, /fill="#ff00ff80"/);
});

test('inline SVG pictograms are recolored too, without rasterizing or adding a background', async () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ff18ff" stroke="#112233" d="M2 2H8V8H2Z"/></svg>';
  const url = `data:image/svg+xml,${encodeURIComponent(markup)}`;
  const result = await recolorImageUrl(url, '#ff18ff', '#1a2b3c');
  const colored = decodeURIComponent(result.slice(result.indexOf(',') + 1));
  assert.match(colored, /fill="#1a2b3c"/);
  assert.match(colored, /stroke="#112233"/);
  assert.doesNotMatch(colored, /<rect|<image/);
});
