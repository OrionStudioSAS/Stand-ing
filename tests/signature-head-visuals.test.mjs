import { isSignatureLedArch } from '../src/signatureArchVariants.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Texture } from 'three';
import { defaultImageFraming } from '../src/imageFraming.js';
import { patchPartitionHeadVisuals } from '../src/partitionHeadVisuals.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

function visualContext() {
  const context = vm.createContext({ isSignatureLedArch,
    isSignaturePackLabel: (label) => label === 'Signature',
    enhanceIcareChromeMaterial: (material) => material,
    textureSlotHasLogoGate: () => false,
    normalizeImageFraming: (value) => value,
    createCoverImageTexture: (image) => image,
    isWoodReceptionDeskItem: () => false,
    isElectricalWhiteItem: () => false,
    smclExhibitorTextureForMaterial: () => null,
    shouldUseExhibitorHeadTexture: () => false,
    isTextureResource: () => false,
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
    'partitionHeadMainImageUrl', 'partitionHeadMainImageTextureOptions', 'partitionHeadMainImageCoverSize', 'collectSceneTextureUrls',
    'fitSignatureHeadStandardImage',
    'applyItemOptionMaterials', 'applyPartitionHeadVisualOptions',
  ]) loadFunction(name, context);
  return context;
}

const head = { label: 'Tete De Cloison - Signature', options: { partitionHeadSide: 'left' } };

test('new and existing Signature heads use SIGNA-32 only as their standard lower visual', () => {
  const api = visualContext();
  const standard = '/images/signature/partition-head-standard-signa-32.png';
  for (const item of [head, { ...head, options: {} }, { ...head, options: { visualPending: true } },
    { label: 'Tête de cloison gauche', dimensions: { packs: ['Signature'] } }]) {
    const saved = JSON.stringify(item);
    assert.equal(api.partitionHeadMainImageUrl(item), standard);
    const options = api.partitionHeadMainImageTextureOptions(item, false);
    assert.equal(options.flipY, false);
    assert.equal(options.fit, 'cover');
    assert.equal(options.coverSize.join(','), '460,2130');
    assert.equal(options.imageZoom, undefined, 'Standard artwork ignores stale framing from a removed upload');
    assert.equal(JSON.stringify(item), saved, 'A standard visual must not become a saved customer upload or clear its pending state');
  }
  for (const label of ['Tête de cloison SMCL', 'Tête de cloison SIAE', 'Arche Signature']) {
    assert.equal(api.partitionHeadMainImageUrl({ label }), '', label);
  }
  const custom = { ...head, options: { headMainImageUrl: 'client.png', headMainImageFraming: { imageZoom: 1.4 } } };
  assert.equal(api.partitionHeadMainImageUrl(custom), 'client.png');
  assert.equal(api.partitionHeadMainImageTextureOptions(custom).imageZoom, 1.4);
  assert.equal(api.partitionHeadMainImageTextureOptions(custom).coverSize.join(','), '546,2908', 'Custom uploads retain their existing UV framing');
  assert.equal(api.partitionHeadMainImageUrl({ ...custom, options: { ...custom.options, headMainImageUrl: '' } }), standard, 'Resetting a custom visual restores the new standard');
  const urls = Array.from(api.collectSceneTextureUrls([{ children: [head, head, custom, { label: 'Enseigne haute', options: { headMainImageUrl: 'sign.png' } }] }]));
  assert.deepEqual(urls, [standard, 'client.png', 'sign.png'], 'Preloading includes the standard, customer uploads and existing non-head signage');
  const png = readFileSync(new URL('../public/images/signature/partition-head-standard-signa-32.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 174);
  assert.equal(png.readUInt32BE(20), 805);
});

test('the standard Signature visual fills its actual UV panel instead of cropping its top under the name plate', () => {
  const api = visualContext();
  const geometry = new BufferGeometry();
  geometry.setAttribute('uv', new Float32BufferAttribute([
    -23, .1345192194, -22, .1345192194, -22, 1.0005626678, -23, 1.0005626678,
    -100, -100, 100, -100, 100, 100,
  ], 2));
  geometry.setIndex([0, 1, 2, 2, 3, 0, 4, 5, 6]);
  geometry.addGroup(0, 6, 0);
  geometry.addGroup(6, 3, 1);
  const texture = new Texture();
  const panel = new MeshStandardMaterial({ name: 'LED_5500k#4', map: texture, emissiveMap: texture });
  const other = new MeshStandardMaterial({ name: 'LED_5500k#40', map: texture });
  const mesh = { geometry, material: [panel, other] };
  api.fitSignatureHeadStandardImage(mesh, head, texture);
  assert.notEqual(panel.map, texture);
  assert.equal(panel.emissiveMap, panel.map);
  assert.equal(other.map, texture, 'Do not change adjacent materials or include their UV bounds');
  assert.equal(texture.repeat.y, 1, 'Cached/shared textures stay unchanged');
  for (const [vertex, expected] of [[0, [0, 0]], [2, [1, 1]]]) {
    const mapped = [geometry.attributes.uv.getX(vertex) * panel.map.repeat.x + panel.map.offset.x,
      geometry.attributes.uv.getY(vertex) * panel.map.repeat.y + panel.map.offset.y];
    assert.ok(mapped.every((value, axis) => Math.abs(value - expected[axis]) < .00001));
  }
  const custom = new MeshStandardMaterial({ name: 'LED_5500k#4', map: texture });
  api.fitSignatureHeadStandardImage({ geometry, material: custom }, { ...head, options: { headMainImageUrl: 'client.png' } }, texture);
  assert.equal(custom.map, texture, 'Existing customer image framing stays unchanged');
});

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
