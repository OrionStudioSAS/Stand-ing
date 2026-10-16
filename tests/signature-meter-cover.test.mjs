import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const assets = ['Noir', 'Blanc'].map((finish) => ({ type: `cache-${finish}`, label: `Cache Compteur ${finish} 500x500x750ht`,
  modelUrl: `/${finish}.glb`, dimensions: { size: [0.53, 0.75, 0.5], packPricing: { signature: { price: 95, reference: finish } } } }));
function runtime() {
  const api = vm.createContext({
    wallThickness: 0.06,
    normalizePackLabel: (label) => String(label || '').toLowerCase(),
    makeItem: (_type, _width, _depth, _layout, entry) => ({ ...entry, id: 'temporary', x: 0, z: 0 }),
    itemGroupBounds: (item) => ({ minX: -item.dimensions.size[0] / 2, maxX: item.dimensions.size[0] / 2, minZ: -item.dimensions.size[2] / 2, centerX: 0 }),
    normalizeVariantGroupOptions: (entries) => entries.map((entry) => ({ id: entry.type, entry, price: 95 })),
    isAutomaticReserveItem: () => false,
  });
  for (const name of ['normalizedItemText', 'isSignaturePackLabel', 'isVariantGroupEntry', 'isIncludedSceneItem', 'isMeterCoverItem', 'signatureMeterCoverFinish',
    'signatureMeterCoverEntries', 'signatureMeterCoverConfiguratorEntry', 'makeAutomaticMeterCoverItems', 'itemConfigVariants',
    'itemSystemTransformLocked', 'canDeleteSceneItem']) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
  }
  return api;
}

test('Signature gets exactly one white meter cover from 9 m2 to below 15 m2, but other packs and larger stands do not', () => {
  const api = runtime();
  for (const width of [3, 4, 4.99]) {
    const items = api.makeAutomaticMeterCoverItems('Signature', '', assets, width, 3, 'back');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'cache-Blanc');
    assert.equal(items[0].included, true);
    assert.equal(items[0].priceMode, 'included');
    assert.equal(items[0].options.unitPrice, 0);
  }
  for (const pack of ['Confort', 'Prestige', 'Équipé', '']) assert.equal(api.makeAutomaticMeterCoverItems(pack, '', assets, 4, 3, 'u').length, 0);
  for (const width of [5, 6, 0, 2, 2.99]) assert.equal(api.makeAutomaticMeterCoverItems('Signature', '', assets, width, 3, 'u').length, 0);
});

test('left/right layouts place the cover in the back corner, while back/U keep it centred against the wall', () => {
  const api = runtime();
  for (const [layout, x] of [['left', -1.675], ['right', 1.675], ['back', 0], ['u', 0]]) {
    const item = api.makeAutomaticMeterCoverItems('Signature', '', assets, 4, 3, layout)[0];
    assert.ok(Math.abs(item.x - x) < 1e-9, layout);
    assert.ok(Math.abs(item.z + 1.19) < 1e-9, layout);
    assert.equal(item.rotation, 0);
    assert.equal(api.itemSystemTransformLocked(item), true);
    assert.equal(api.canDeleteSceneItem(item, false), false);
    assert.equal(api.canDeleteSceneItem(item, true), false);
  }
});

test('black/white swaps keep the same single included item, model metadata and placement', () => {
  const api = runtime();
  const before = JSON.stringify(assets);
  const white = api.makeAutomaticMeterCoverItems('Signature', '', assets, 4, 3, 'left')[0];
  const black = api.makeAutomaticMeterCoverItems('Signature', 'cache-Noir', assets, 4, 3, 'left')[0];
  for (const key of ['id', 'x', 'z', 'rotation', 'included', 'priceMode']) assert.equal(black[key], white[key]);
  assert.equal(black.modelUrl, '/Noir.glb');
  assert.equal(black.options.variantId, 'cache-Noir');
  assert.equal(black.options.variantLabel, 'Noir');
  assert.equal(black.dimensions.packPricing.signature.reference, 'Noir');
  assert.equal(black.options.unitPrice, 0);
  assert.equal(JSON.stringify(assets), before, 'Catalog data must not be rewritten to make the object free');
});

test('the existing variant modal exposes white and black at no additional cost', () => {
  const api = runtime();
  const entry = api.signatureMeterCoverConfiguratorEntry(assets);
  const variants = api.itemConfigVariants(entry, 'Signature');
  assert.deepEqual(Array.from(variants, (variant) => [variant.label, variant.price]), [['Blanc', 0], ['Noir', 0]]);
  assert.equal(variants[1].entry, assets[0]);
});

test('missing/inactive assets and existing manually placed meter covers are handled without duplicates', () => {
  const api = runtime();
  assert.equal(api.makeAutomaticMeterCoverItems('Signature', '', [], 4, 3, 'back').length, 0);
  assert.equal(api.makeAutomaticMeterCoverItems('Signature', '', assets, 4, 3, 'back', [{ ...assets[0], included: true }]).length, 0);
  assert.equal(api.makeAutomaticMeterCoverItems('Signature', '', assets, 4, 3, 'back', [assets[0]]).length, 1, 'Paid additional objects must not remove the included cover');
  const onlyBlack = assets.map((entry) => ({ ...entry, is_active: entry.type === 'cache-Noir' }));
  assert.equal(api.makeAutomaticMeterCoverItems('Signature', 'missing', onlyBlack, 4, 3, 'back')[0].type, 'cache-Noir');
});
