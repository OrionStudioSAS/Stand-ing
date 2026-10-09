import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { MeshStandardMaterial, Texture } from 'three';
import { defaultImageFraming } from '../src/imageFraming.js';
import { patchPartitionHeadVisuals } from '../src/partitionHeadVisuals.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

function visualContext() {
  const context = vm.createContext({
    isSignaturePackLabel: (label) => label === 'Signature',
    enhanceIcareChromeMaterial: (material) => material,
    textureSlotHasLogoGate: () => false,
    normalizeImageFraming: (value) => value,
    createCoverImageTexture: (image) => image,
    isWoodReceptionDeskItem: () => false,
    isElectricalWhiteItem: () => false,
    smclExhibitorTextureForMaterial: () => null,
    shouldUseExhibitorHeadTexture: () => false,
    defaultImageFraming,
    patchPartitionHeadVisuals,
  });
  const start = source.indexOf('const signaturePartitionHeadVisualSlots = [');
  const end = source.indexOf('\n];', start) + 3;
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.slot = signaturePartitionHeadVisualSlots[0];`, context);
  for (const name of [
    'normalizedItemText', 'isSignatureArchItem', 'isPartitionHeadItem', 'isSignaturePartitionHeadItem',
    'isSmclPartitionHeadItem', 'normalizeTextureSlots', 'itemTextureSlots', 'textureSlotPatch',
    'normalizeMaterialName', 'escapeRegExp', 'materialMatchesTextureSlot', 'textureSlotNeedsExactMaterialMatch',
    'signatureArchVisualMaterialMatches', 'materialTextureCanvasSize', 'applyTextureSlotMaterial',
    'materialWithTexture', 'partitionHeadMainImageMaterial', 'isPartitionHeadMainImageMaterial',
    'applyItemOptionMaterials', 'applyPartitionHeadVisualOptions',
  ]) loadFunction(name, context);
  return context;
}

const head = { label: 'Tete De Cloison - Signature', options: { partitionHeadSide: 'left' } };

test('Signature heads expose an independent built-in *28 image slot, but other heads do not', () => {
  const context = visualContext();
  assert.equal(context.itemTextureSlots(head)[0].targetName, '*28');
  assert.equal(context.itemTextureSlots({ label: 'Tete de cloison SMCL' }).length, 0);
  assert.equal(context.itemTextureSlots(null).length, 0);
  const configured = [{ id: context.slot.id, targetName: '*28' }, { id: 'other', targetName: 'Other' }];
  const slots = context.itemTextureSlots({ ...head, dimensions: { textureSlots: configured } });
  assert.equal(slots.length, 2);
  assert.equal(slots[1].id, 'other');
  assert.match(source, /const rawTextureSlots = isSignaturePartitionHeadItem\(textureSourceEntry\)\s*\? itemTextureSlots\(textureSourceEntry\)/);
  assert.match(source, /isSignatureStand && signaturePartitionHeadVisualSlots\.map\(\(slot\)/);
});

test('*28 and LED #4 use separate images without recoloring neighboring materials', () => {
  const context = visualContext();
  const topImage = new Texture();
  const ledImage = new Texture();
  const originalMap = new Texture();
  const panel = (name) => new MeshStandardMaterial({ name, map: originalMap, emissiveMap: originalMap, emissive: '#ffffff', emissiveIntensity: 0.16 });
  const item = { ...head, options: { textureSlotValues: { [context.slot.id]: { imageUrl: 'top.png' } }, headMainImageUrl: 'led.png' } };
  const textures = { textureSlotImages: { [context.slot.id]: topImage }, mainImageTexture: ledImage, textureSlotFlipY: false };
  for (const name of ['*28', '*28.001']) {
    const top = context.applyItemOptionMaterials(panel(name), item, textures);
    assert.equal(top.map, topImage);
    assert.equal(top.emissiveMap, topImage);
  }
  assert.equal(context.applyItemOptionMaterials(panel('LED_5500k#4'), item, textures).map, ledImage);
  const other = panel('*280');
  assert.equal(context.applyItemOptionMaterials(other, item, textures), other);
  assert.equal(context.applyItemOptionMaterials(panel('*28'), item, { mainImageTexture: ledImage }).map, originalMap);
  assert.equal(originalMap.version, 0);
});

test('Uploading and resetting *28 preserve the LED image, the other side and saved scene options', async () => {
  const context = visualContext();
  let visuals = {
    left: { headMainImageUrl: 'left-led.png', headMainImageName: 'left-led.png', textureSlotValues: { other: { imageUrl: 'other.png' } } },
    right: { headMainImageUrl: 'right-led.png' },
  };
  const uploads = [];
  Object.assign(context, {
    readOnly: false, initialScene: { id: 'scene' },
    setItemOptionState: () => {},
    setPartitionHeadVisuals: (update) => { visuals = update(visuals); },
    uploadSceneItemOptionImage: async (scene, target, file) => { uploads.push(target); return file.name; },
    cacheBustedUrl: (url) => url,
    preloadImage: async () => {},
    file: { name: 'top.png' },
  });
  const start = source.indexOf('  const uploadPartitionHeadVisual = async');
  const end = source.indexOf('  const updatePartitionHeadVisualOptions =', start);
  vm.runInContext(source.slice(start, end), context);
  await vm.runInContext("uploadPartitionHeadVisual('left', file, slot)", context);
  assert.equal(uploads[0].id, `partition-head-left-${context.slot.id}`);
  assert.equal(visuals.left.headMainImageUrl, 'left-led.png');
  assert.equal(visuals.right.headMainImageUrl, 'right-led.png');
  assert.equal(visuals.left.textureSlotValues.other.imageUrl, 'other.png');
  assert.equal(visuals.left.textureSlotValues[context.slot.id].imageUrl, 'top.png');
  assert.equal(visuals.left.textureSlotValues[context.slot.id].imageName, 'top.png');
  const reloaded = context.applyPartitionHeadVisualOptions(head, JSON.parse(JSON.stringify(visuals)));
  assert.equal(reloaded.options.textureSlotValues[context.slot.id].imageUrl, 'top.png');
  vm.runInContext("resetPartitionHeadVisual('left', slot)", context);
  assert.equal(visuals.left.textureSlotValues[context.slot.id].imageUrl, '');
  assert.equal(visuals.left.headMainImageUrl, 'left-led.png');
  await vm.runInContext("uploadPartitionHeadVisual('right', file)", context);
  assert.equal(uploads[1].id, 'partition-head-right');
  assert.equal(visuals.right.headMainImageUrl, 'top.png');
  context.readOnly = true;
  await vm.runInContext("uploadPartitionHeadVisual('left', file, slot)", context);
  vm.runInContext("resetPartitionHeadVisual('right')", context);
  assert.equal(uploads.length, 2);
  assert.equal(visuals.right.headMainImageUrl, 'top.png');
});
