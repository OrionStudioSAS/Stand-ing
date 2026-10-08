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
    colorGroupAssets: () => [],
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

test('Signature includes both partition heads at every area, including existing scenes with old rule counts', () => {
  const context = vm.createContext({
    isSignatureScene: (scene) => scene.offer === 'Signature',
    scenePackBenefits: () => ({ mode: 'allowance' }),
    normalizePackLabel: (label) => String(label || '').toLowerCase(),
    sceneOfferLabel: (scene) => scene.offer,
  });
  const start = source.indexOf('const partitionHeadRuleBands = [');
  const end = source.indexOf('const placementRuleOptions = [', start);
  vm.runInContext(source.slice(start, end), context);
  for (const name of [
    'scenePartitionHeadRules', 'normalizePartitionHeadRules', 'normalizePartitionHeadIncludedSides',
    'activePartitionHeadRule', 'partitionHeadRuleIncludedSides', 'defaultIncludedPartitionHeadSides',
    'partitionHeadEnabledSides',
  ]) loadFunction(name, context);

  const presetRules = Object.fromEntries(['small', 'medium', 'large'].map((band, index) => [band, {
    includedCount: index,
    leftType: 'signature-head',
    rightType: 'signature-head',
  }]));
  const scene = {
    offer: 'Signature',
    source_payload: { partitionHeadRules: {}, options: { partitionHeadLeftEnabled: true, partitionHeadRightEnabled: false } },
    stand_presets: { base_config: { partitionHeadRules: presetRules } },
  };
  const rules = context.scenePartitionHeadRules(scene);
  for (const area of [9, 18, 30]) {
    const rule = context.activePartitionHeadRule(rules, area, 'u');
    assert.equal(rule.includedCount, 2);
    assert.deepEqual(Array.from(rule.includedSides), ['left', 'right']);
    assert.deepEqual(Object.values(context.partitionHeadEnabledSides(rule)), [true, true]);
    assert.equal(rule.leftType, 'signature-head');
    assert.equal(rule.rightType, 'signature-head');
  }
  assert.equal(context.scenePartitionHeadRules({ offer: 'Confort' }).small.includedCount, 0);
});

test('The same Signature head asset is assigned to opposite stand edges', () => {
  const entry = { type: 'signature-head', label: 'Tête de cloison Signature' };
  const context = vm.createContext({
    isSignaturePackLabel: (label) => String(label || '').toLowerCase() === 'signature',
    findCatalogEntry: () => entry,
    isSmclPartitionHeadItem: () => false,
    isSignaturePartitionHeadItem: () => true,
    isPartitionHeadItem: () => true,
    assetUnitPrice: () => 0,
    firstPriceValue: () => 0,
    makeItem: () => ({ placementRule: null, dimensions: {} }),
    placementRuleFromId: (id) => ({ id, locked: true }),
    constrainItem: (item) => item,
  });
  for (const name of ['partitionHeadSelectedSides', 'partitionHeadBillableSides', 'makeAutomaticPartitionHeadItems']) loadFunction(name, context);
  const items = context.makeAutomaticPartitionHeadItems({
    id: 'small', includedSides: ['left', 'right'], includedCount: 2,
    leftType: entry.type, rightType: entry.type,
  }, { left: true, right: true }, [entry], 3, 3, 'u', 'Signature');
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.placementRule.id), ['outer-left', 'outer-right']);
  assert.deepEqual(Array.from(items, (item) => item.options.partitionHeadSide), ['left', 'right']);
  assert.deepEqual(Array.from(items, (item) => item.wall), ['left', 'right']);
  assert.ok(items.every((item) => item.isWallItem));
  assert.ok(items.every((item) => !item.included && item.priceMode === 'billable'));
});

test('Signature heads attach to side-wall fronts or back-wall ends, never rear corners', () => {
  const context = vm.createContext({
    availableWalls: (layout) => layout === 'u'
      ? [{ id: 'back' }, { id: 'left' }, { id: 'right' }]
      : [{ id: 'back' }, ...(layout === 'back' ? [] : [{ id: layout }])],
    normalizePlacementRule: (rule) => rule,
    wallItemAxisRange: (_item, wall, width, depth) => wall === 'back'
      ? { min: -width / 2 + 0.1, max: width / 2 - 0.1 }
      : { min: -depth / 2 + 0.1, max: depth / 2 - 0.1 },
    smclPartitionHeadWallAxis: (_item, _wall, axis) => axis,
    wallItemCenterY: () => 0,
    wallThickness: 0.06,
  });
  loadFunction('applyWallPlacementRule', context);
  const head = (side) => ({ placementRule: { id: `outer-${side}`, locked: true } });
  for (const layout of ['u', 'left', 'right', 'back']) {
    const left = context.applyWallPlacementRule(head('left'), 4, 3, layout);
    const right = context.applyWallPlacementRule(head('right'), 4, 3, layout);
    assert.equal(left.wall, layout === 'u' || layout === 'left' ? 'left' : 'back');
    assert.equal(right.wall, layout === 'u' || layout === 'right' ? 'right' : 'back');
    assert.ok(left.wall === 'left' ? left.z > 0 : left.x < 0, layout);
    assert.ok(right.wall === 'right' ? right.z > 0 : right.x > 0, layout);
  }
});

test('Signature head follows each wall with its long model axis and correct wall gap', () => {
  const context = vm.createContext({
    isSignaturePartitionHeadItem: (item) => item.type === 'signature-head',
    isPartitionHeadItem: () => true,
    isPosterItem: () => false,
    itemGroupBounds: () => ({ minX: -0.08, maxX: 0.08, minZ: -0.25, maxZ: 0.25 }),
    itemGroupSize: () => ({ width: 0.16, height: 2.5, depth: 0.5 }),
    wallThickness: 0.06,
    partitionHeadWallGap: 0.01,
  });
  for (const name of ['wallMountedItemRotation', 'wallItemAxisBounds', 'wallItemMetrics', 'wallMountedNormalOffset']) loadFunction(name, context);
  const signature = { type: 'signature-head', modelUrl: '/head.glb' };
  const smcl = { type: 'smcl-head', modelUrl: '/smcl.glb' };
  assert.equal(context.wallMountedItemRotation({ ...signature, wall: 'back' }), -Math.PI / 2);
  assert.equal(context.wallMountedItemRotation({ ...signature, wall: 'left' }), 0);
  assert.equal(context.wallMountedItemRotation({ ...signature, wall: 'right' }), -Math.PI);
  assert.equal(context.wallMountedItemRotation({ ...smcl, wall: 'back' }), 0);
  assert.equal(context.wallMountedItemRotation({ ...smcl, wall: 'left' }), Math.PI / 2);
  assert.equal(context.wallMountedItemRotation({ ...smcl, wall: 'right' }), -Math.PI / 2);
  assert.equal(context.wallItemAxisBounds(signature, 'back').max, 0.25);
  assert.equal(context.wallItemAxisBounds(signature, 'left').max, 0.25);
  assert.equal(context.wallItemMetrics(signature).width, 0.5);
  assert.equal(context.wallMountedNormalOffset(signature), 0.15);
});

test('Signature heads use their LED material for each uploaded image, not the other materials', () => {
  const context = vm.createContext({
    normalizedItemText: (item) => `${item.label || ''}`.toLowerCase(),
    isSignaturePackLabel: (pack) => String(pack).toLowerCase() === 'signature',
    normalizeMaterialName: (name) => String(name).toLowerCase(),
    materialMatchesTextureSlot: (name, _material, target) => name === target,
  });
  for (const name of [
    'isPartitionHeadItem', 'isSignaturePartitionHeadItem', 'isSmclPartitionHeadItem',
    'partitionHeadMainImageMaterial', 'partitionHeadMainImageCoverSize', 'isPartitionHeadMainImageMaterial',
  ]) loadFunction(name, context);
  const head = { label: 'Tête de cloison Signature', dimensions: { packs: ['Signature'] } };
  assert.equal(context.partitionHeadMainImageMaterial(head), 'led_5500k#4');
  assert.deepEqual(Array.from(context.partitionHeadMainImageCoverSize(head)), [546, 2908]);
  assert.equal(context.isPartitionHeadMainImageMaterial('led_5500k#4', null, head), true);
  assert.equal(context.isPartitionHeadMainImageMaterial('led_5500k#40', null, head), false);
  assert.equal(context.isPartitionHeadMainImageMaterial('laminate_d02_120cm#2', null, head), false);
  assert.equal(context.isPartitionHeadMainImageMaterial('*28', null, head), false);
  assert.match(source, /!isSignatureStand && <div className="partition-head-choice-grid">/);
  assert.match(source, /!isSignatureStand && <button[\s\S]*className="partition-head-remove-button"/);
});

test('Signature pack editor has one left and one right head selector instead of area bands', () => {
  const start = source.indexOf('function PresetPartitionHeadRulesEditor(');
  const end = source.indexOf('\nfunction PresetAutoSpotsEditor(', start);
  const editor = source.slice(start, end);
  assert.match(editor, /if \(isSignaturePack\) \{/);
  assert.match(editor, /\['left', 'right'\]\.map/);
  assert.match(editor, /updateSignatureSide\(side, event\.target\.value\)/);
  assert.match(editor, /Object\.fromEntries\(partitionHeadRuleBands\.map/);
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

test('Signature fallback palettes remain restricted and its reserve fabric is anthracite', () => {
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

test('Signature uses every configured carpet and wall color instead of the legacy restricted palette', () => {
  const context = packContext();
  for (const name of ['normalizeColorGroupOptions', 'colorOptionsForUsage']) loadFunction(name, context);
  context.colorGroupAssets = (assets, pack, usage) => assets.filter((asset) => asset.dimensions?.packs?.includes(pack) && asset.dimensions?.colorUsages?.includes(usage));
  const assets = [
    {
      type: 'signature-rewind', label: 'Moquette SIGNATURE (Rewind)',
      dimensions: {
        packs: ['Signature'], colorUsages: ['carpet'], colorGroupPrice: 36,
        colorOptions: [
          { id: '0939', code: '0939', name: 'Gris clair', image: '/gray.jpg', isDefault: true, isFree: true },
          { id: '0809', code: '0809', name: 'Marine', image: '/blue.jpg', isFree: true },
          { id: '0713', code: '0713', name: 'Rouge', image: '/red.jpg', isFree: true },
          { id: '0400', code: '0400', name: 'Jaune', image: '/yellow.jpg' },
        ],
      },
    },
    {
      type: 'signature-cotton', label: 'Coton SIGNATURE',
      dimensions: {
        packs: ['Signature'], colorUsages: ['wallFabric'], colorGroupPrice: 11,
        colorOptions: [
          { id: '303', code: '303', name: 'Blanc', image: '/white.jpg', isFree: true },
          { id: '470', code: '470', name: 'Rouge', image: '/red-wall.jpg', isFree: true },
          { id: '319', code: '319', name: 'Gris moyen', image: '/gray-wall.jpg', isFree: true },
        ],
      },
    },
  ];
  const carpet = context.packColorPalette(assets, 'Signature', 'carpet', carpetColors);
  const walls = context.packColorPalette(assets, 'Signature', 'wallFabric', wallFabricColors);
  assert.deepEqual(Array.from(carpet, (color) => color.code), ['0939', '0809', '0713', '0400']);
  assert.equal(carpet[3].price, 36);
  assert.equal(carpet[3].included, false);
  assert.deepEqual(Array.from(walls, (color) => color.code), ['303', '470', '319']);
  assert.equal(walls[0].isDefault, true);
  assert.equal(walls[2].image, '/gray-wall.jpg');
  assert.equal(walls[2].included, true);
  loadFunction('findColorInPalette', context);
  context.normalizeColorId = (value) => String(value || '').toLowerCase();
  assert.equal(context.findColorInPalette(walls, 'signature-wall-light-gray').code, '319');
});
