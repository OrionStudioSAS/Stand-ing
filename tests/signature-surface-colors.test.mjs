import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = vm.createContext({});
for (const name of ['normalizeColorId', 'colorWithDefaultIncluded', 'surfaceColorOptionGroups']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}
const colors = [
  { id: 'blue', name: 'Bleu', code: '180', included: true, price: 0 },
  { id: 'red', name: 'Rouge', code: '470', included: false, price: 2 },
  { id: 'white', name: 'Blanc', code: '303', included: true, isDefault: true, price: 0 },
  { id: 'gray', name: 'Gris', code: '319', included: false, price: 2 },
];
const ids = (list) => Array.from(list, (color) => color.id);

test('Signature surfaces share one layout without changing other packs', () => {
  const options = source.slice(source.indexOf('function OptionsStepPanel('), source.indexOf('function OptionsStepPanel(') + 22000);
  assert.match(options, /<CarpetColorOptionCard\s+uniformLayout=\{isSignatureStand\}/);
  assert.match(options, /<ColorOptionCard\s+uniformLayout=\{isSignatureStand\}/);
  for (const name of ['ColorOptionCard', 'CarpetColorOptionCard']) {
    const start = source.indexOf(`function ${name}(`);
    const component = source.slice(start, source.indexOf('\n}\n', start));
    assert.match(component, /uniformLayout = false/);
    assert.match(component, /if \(uniformLayout\) \{\s+return <SurfaceColorOptionCard/);
    assert.match(component, /area=\{area\} disabled=\{disabled\} onSelect=\{onSelect\}/);
  }
});

test('Included and optional swatches preserve admin order without promoting the default', () => {
  const result = api.surfaceColorOptionGroups(colors, colors[0], '', 18);
  assert.deepEqual(ids(result.includedColors), ['blue', 'white']);
  assert.deepEqual(ids(result.optionalColors), ['red', 'gray']);
  assert.equal(result.selected.id, 'blue');
  assert.equal(result.optionTotal, 36);
  assert.equal(result.fromPrice, false);
});

test('An included scene default stays free alongside explicit included colors', () => {
  const result = api.surfaceColorOptionGroups(colors, colors[1], 'red', 18);
  assert.deepEqual(ids(result.includedColors), ['blue', 'red', 'white']);
  assert.deepEqual(ids(result.optionalColors), ['gray']);
  assert.equal(result.selected.included, true);
  assert.equal(colors[1].included, false);
});

test('Selected paid color uses its catalog price and the appropriate surface area', () => {
  const palette = colors.map((color) => color.id === 'gray' ? { ...color, price: 4 } : color);
  const floor = api.surfaceColorOptionGroups(palette, { id: 'gray', price: 99 }, '', 18);
  const wall = api.surfaceColorOptionGroups(palette, { id: 'gray' }, '', 30);
  assert.equal(floor.optionTotal, 72);
  assert.equal(wall.optionTotal, 120);
  assert.equal(floor.selected.name, 'Gris');
  assert.equal(floor.fromPrice, false);
  const included = api.surfaceColorOptionGroups(palette, colors[0], '', 18);
  assert.equal(included.optionTotal, 36);
  assert.equal(included.fromPrice, true);
});

test('Single included, all paid and empty palettes are valid', () => {
  assert.equal(api.surfaceColorOptionGroups([colors[0]], colors[0]).includedColors.length, 1);
  assert.equal(api.surfaceColorOptionGroups([colors[1]], colors[1]).includedColors.length, 0);
  const empty = api.surfaceColorOptionGroups([], null);
  assert.equal(empty.includedColors.length, 0);
  assert.equal(empty.optionalColors.length, 0);
  assert.equal(empty.optionTotal, 0);
});

test('Color ids normalize and negative or missing areas cannot produce a negative supplement', () => {
  const palette = [{ id: '12', included: true }, { id: '13', price: 2 }];
  assert.equal(api.surfaceColorOptionGroups(palette, { id: 12 }).selected.included, true);
  assert.equal(api.surfaceColorOptionGroups(palette, { id: 13 }, '', -10).optionTotal, 0);
  assert.equal(api.surfaceColorOptionGroups(palette, { id: 13 }).optionTotal, 0);
});
