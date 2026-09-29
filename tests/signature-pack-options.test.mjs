import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { carpetColors, wallFabricColors } from '../src/config/colorOptions.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

function packContext() {
  const context = vm.createContext({
    carpetColors,
    wallFabricColors,
    colorOptionsForUsage: (_assets, _pack, _usage, fallback) => fallback,
    normalizePackLabel: (label) => String(label || '').toLowerCase(),
    normalizeTextValue: (label) => String(label || '').toLowerCase(),
  });
  const bandsStart = source.indexOf('const reserveRuleBands = [');
  const bandsEnd = source.indexOf('const partitionHeadRuleBands = [', bandsStart);
  vm.runInContext(`${source.slice(bandsStart, bandsEnd)}\nglobalThis.bands = { regular: reserveRuleBands, signature: signatureReserveRuleBands };`, context);
  for (const name of [
    'isSignaturePackLabel', 'packColorPalette', 'signatureReserveWallFabricColor',
    'reserveRuleBandsForPack', 'normalizeComplementaryOptions', 'normalizeReserveRules',
    'activeReserveRule',
  ]) loadFunction(name, context);
  return context;
}

test('Signature reserve bands cover 14, 15, 23, 24, 35 and 36 square metres without changing other packs', () => {
  const context = packContext();
  const bands = context.reserveRuleBandsForPack('Signature');
  const rules = context.normalizeReserveRules({
    'signature-none': { includedType: 'wrong' },
    'signature-1m2': { includedType: 'reserve-1m2' },
    'signature-2m2': { includedType: 'reserve-2m2' },
    'signature-3m2': { includedType: 'reserve-3m2' },
  }, { bands });
  const at = (area) => context.activeReserveRule(rules, area, bands);
  assert.equal(at(14).includedType, '');
  assert.equal(at(14.5).includedType, '');
  assert.equal(at(15).includedType, 'reserve-1m2');
  assert.equal(at(23).includedType, 'reserve-1m2');
  assert.equal(at(24).includedType, 'reserve-2m2');
  assert.equal(at(35).includedType, 'reserve-2m2');
  assert.equal(at(36).includedType, 'reserve-3m2');
  assert.equal(context.reserveRuleBandsForPack('Confort').length, 3);
});

test('Existing Signature 2 and 3 square metre reserve choices survive the new bands', () => {
  const context = packContext();
  const rules = context.normalizeReserveRules({
    medium: { includedType: 'old-2m2' },
    large: { includedType: 'old-3m2' },
  }, { bands: context.bands.signature });
  assert.equal(rules['signature-2m2'].includedType, 'old-2m2');
  assert.equal(rules['signature-3m2'].includedType, 'old-3m2');
  assert.equal(rules['signature-1m2'].includedType, '');
});

test('Signature palettes are restricted and its reserve fabric is anthracite', () => {
  const context = packContext();
  const carpet = context.packColorPalette([], 'Signature', 'carpet', carpetColors);
  const footprint = context.packColorPalette([], 'Signature', 'footprint', carpetColors);
  const fabric = context.packColorPalette([], 'Signature', 'wallFabric', wallFabricColors);
  assert.deepEqual(Array.from(carpet, (color) => color.name), ['Gris clair', 'Bleu marine', 'Rouge']);
  assert.deepEqual(Array.from(footprint, (color) => color.name), ['Gris clair', 'Bleu marine', 'Rouge']);
  assert.deepEqual(Array.from(fabric, (color) => color.name), ['Blanc', 'Rouge', 'Gris clair', 'Bleu']);
  assert.equal(fabric[2].hex, '#c8c8c8');
  assert.equal(context.signatureReserveWallFabricColor().code, '3026');
  assert.equal(context.packColorPalette([], 'Confort', 'carpet', carpetColors).length, carpetColors.length);
});

test('Signature keeps the actual Rewind carpet textures and pricing for codes 0939, 0809 and 0713', () => {
  const context = packContext();
  const rewindColors = [
    { id: 'rewind:0809', code: '0809', name: 'Marine', image: '/marine.jpg', price: 12 },
    { id: 'rewind:0939', code: '0939', name: 'Gris Clair', image: '/gris.jpg', price: 0 },
    { id: 'rewind:0713', code: '0713', name: 'Rouge', image: '/rouge.jpg', price: 0 },
    { id: 'rewind:0400', code: '0400', name: 'Jaune', image: '/jaune.jpg', price: 0 },
  ];
  context.colorOptionsForUsage = () => rewindColors;
  const colors = context.packColorPalette([], 'Signature', 'carpet', carpetColors);
  assert.deepEqual(Array.from(colors, (color) => color.code), ['0939', '0809', '0713']);
  assert.deepEqual(Array.from(colors, (color) => color.image), ['/gris.jpg', '/marine.jpg', '/rouge.jpg']);
  assert.equal(colors[1].price, 12);
});
