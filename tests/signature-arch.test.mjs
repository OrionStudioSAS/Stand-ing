import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { MeshPhongMaterial, MeshStandardMaterial, Texture } from 'three';
import { normalizeImageFraming } from '../src/imageFraming.js';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(appSource.slice(start, appSource.indexOf('\n}\n', start) + 2), context);
}

test('Signature scenes expose their dedicated arch controls and hide the generic footprint control', () => {
  assert.match(appSource, /function isSignatureScene\(/);
  assert.match(appSource, /function SignatureArchOptionCard\(/);
  assert.match(appSource, /isSignatureStand \? 'Moquette' : 'Moquette · Empreinte'/);
  assert.match(appSource, /!isSignatureStand && \(\s*<FootprintColorOptionCard/);
  assert.match(appSource, /title="Arche" subtitle="Modèle · Couleur"/);
  assert.match(stylesSource, /\.signature-arch-variants/);
});

test('Signature arch variants replace one another and keep a single scene item', () => {
  assert.match(appSource, /function signatureArchCatalogEntries\(/);
  assert.match(appSource, /Arche Totem|text\.includes\('arche'\).*text\.includes\('totem'\).*text\.includes\('plafond'\)/s);
  assert.match(appSource, /const withoutArches = current\.filter\(\(item\) => !isSignatureArchItem\(item\)\)/);
  assert.match(appSource, /signatureArchVariantType: entry\.type/);
});

test('Signature arch color targets the requested material and its attached carpet strip', () => {
  assert.match(appSource, /Laminate_D02_120cm#1/);
  assert.match(appSource, /return signatureArchPaintMaterial\(material, item\?\.options\?\.signatureArchColorHex/);
  assert.doesNotMatch(appSource, /signatureArchColorTexture/);
  assert.match(appSource, /function SignatureArchFootprint\(/);
  assert.match(appSource, /Number\(standDepth \|\| 0\) \+ signatureArchFootprintOverflow/);
  assert.match(appSource, /const signatureArchFootprintOverflow = 0\.5/);
  assert.match(appSource, /isSignatureArchItem\(item\) && <SignatureArchFootprint item=\{item\} standDepth=\{depth\}/);
  const footprintStart = appSource.indexOf('function SignatureArchFootprint(');
  const footprintEnd = appSource.indexOf('\nfunction SceneItem(', footprintStart);
  const footprint = appSource.slice(footprintStart, footprintEnd);
  assert.match(footprint, /signatureArchColorImage/);
  assert.match(footprint, /useRepeatedTexture\(imageUrl, width, depth\)/);
  assert.match(footprint, /map=\{texture \|\| null\}/);
});

function archMaterialContext() {
  const context = vm.createContext({
    enhanceIcareChromeMaterial: (material) => material,
    applyTextureSlotMaterial: (material) => material,
    isWoodReceptionDeskItem: () => false,
    isElectricalWhiteItem: () => false,
    isPartitionHeadItem: () => false,
  });
  for (const name of [
    'normalizedItemText', 'isSignatureArchItem', 'normalizeMaterialName',
    'escapeRegExp', 'materialMatchesTextureSlot', 'textureSlotNeedsExactMaterialMatch',
    'isSignatureArchColorMaterial', 'materialWithColor', 'signatureArchPaintMaterial',
    'applyItemOptionMaterials',
  ]) loadFunction(name, context);
  return context;
}

test('Signature arch paint uses a solid carpet color without grain, relief, or emission', () => {
  const context = archMaterialContext();
  const carpetTexture = new Texture();
  let disposed = false;
  carpetTexture.addEventListener('dispose', () => { disposed = true; });
  const original = new MeshStandardMaterial({
    name: 'Laminate_D02_120cm#1', color: '#ffffff', metalness: 0.8, roughness: 1,
    map: carpetTexture, bumpMap: carpetTexture, normalMap: carpetTexture,
    roughnessMap: carpetTexture, metalnessMap: carpetTexture, aoMap: carpetTexture,
    displacementMap: carpetTexture, emissiveMap: carpetTexture, alphaMap: carpetTexture,
    emissive: '#ffffff', emissiveIntensity: 0.72,
  });
  const item = { label: 'Arche Totem + Plafond Spot', options: { signatureArchColorHex: '#234567', signatureArchColorImage: 'carpet.jpg' } };
  const painted = context.applyItemOptionMaterials(original, item);
  assert.equal(painted.color.getHexString(), '234567');
  for (const key of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'displacementMap', 'emissiveMap', 'alphaMap']) {
    assert.equal(painted[key], null, key);
    assert.equal(original[key], carpetTexture, 'Shared source material remains unchanged');
  }
  assert.equal(painted.roughness, 0.55);
  assert.equal(painted.metalness, 0);
  assert.equal(painted.emissive.getHexString(), '000000');
  assert.equal(painted.emissiveIntensity, 0);
  assert.equal(original.color.getHexString(), 'ffffff');
  assert.equal(original.metalness, 0.8);
  assert.equal(disposed, false, 'The carpet still uses the same texture');
});

test('OBJ paint supports Phong materials, color changes, and material arrays without touching other arch surfaces', () => {
  const context = archMaterialContext();
  const original = new MeshPhongMaterial({ name: 'Laminate_D02_120cm#1.001', map: new Texture(), bumpMap: new Texture(), shininess: 100 });
  const visual = new MeshStandardMaterial({ name: 'LED_5500k#5', map: new Texture() });
  const other = new MeshStandardMaterial({ name: 'Laminate_D02_120cm#10', map: new Texture() });
  const item = { label: 'Arche Totem + Plafond Suspension', options: { signatureArchColorHex: '#bb2233' } };
  const [painted, preservedVisual, preservedOther] = context.applyItemOptionMaterials([original, visual, other], item);
  assert.equal(painted.color.getHexString(), 'bb2233');
  assert.equal(painted.map, null);
  assert.equal(painted.bumpMap, null);
  assert.equal(painted.shininess, 30);
  assert.equal(preservedVisual, visual);
  assert.equal(preservedOther, other);
  assert.equal(context.applyItemOptionMaterials(original, { ...item, options: { signatureArchColorHex: '#2244bb' } }).color.getHexString(), '2244bb');
  assert.equal(context.applyItemOptionMaterials(original, { label: 'Other stand' }), original);
  assert.equal(context.applyItemOptionMaterials(original, { ...item, options: {} }).color.getHexString(), 'bebebe');
});

test('Signature arch back touches the wall while its carpet strip spans the stand and 50 cm outside', () => {
  const context = vm.createContext({
    itemGroupBounds: () => ({ minZ: -0.6 }),
    wallThickness: 0.06,
    signatureArchCenterZ: 0.25,
  });
  loadFunction('signatureArchBackWallZ', context);
  loadFunction('signatureArchFootprintLocalZ', context);
  const arch = { z: context.signatureArchBackWallZ({}, 4) };
  assert.ok(Math.abs(arch.z - 0.6 - (-2 + 0.06)) < 1e-9);
  assert.ok(Math.abs(arch.z + context.signatureArchFootprintLocalZ(arch) - 0.25) < 1e-9);
  assert.ok(Math.abs(0.25 - 4.5 / 2 - (-2)) < 1e-9);
  assert.ok(Math.abs(0.25 + 4.5 / 2 - 2.5) < 1e-9);
  assert.match(appSource, /isSignatureArchItem\(dragged\)[\s\S]*updateItem\(draggingId, \{ x: dragCoordinate\(point\.x\) \}\)/);
});

test('Signature arch moves in 25 cm steps along the back wall without changing its visuals', () => {
  const arch = { id: 'arch', x: 0.13, z: 0, options: { imageUrl: 'existing-visual' } };
  let items = [arch, { id: 'chair', x: 0.18 }];
  const context = vm.createContext({
    signatureArchPlacementStep: 0.25,
    wallThickness: 0.06,
    itemGroupBounds: () => ({ minX: -0.5, maxX: 0.5, minZ: -0.6 }),
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    hasOwn: (value, key) => Object.hasOwn(value, key),
    readOnly: false,
    effectiveAdminViewer: false,
    isSignatureStand: true,
    isSignatureArchItem: (item) => item.id === 'arch',
    isTransformPatch: (patch) => ['x', 'z', 'rotation'].some((key) => Object.hasOwn(patch, key)),
    itemSystemTransformLocked: () => false,
    itemRotationLocked: () => false,
    sceneItems: items,
    automaticReserveItems: [],
    automaticPartitionHeadItems: [],
    collidesWithScene: () => false,
    width: 4,
    depth: 4,
    setItems: (update) => { items = update(items); },
  });
  loadFunction('signatureArchWallX', context);
  loadFunction('signatureArchBackWallZ', context);
  for (const [input, expected] of [[0.11, 0], [0.14, 0.25], [0.39, 0.5], [-0.14, -0.25], [-0.39, -0.5]]) {
    assert.ok(Math.abs(context.signatureArchWallX(input, arch, 4) - expected) < 1e-9);
  }
  assert.equal(context.signatureArchWallX(99, arch, 4), 1.44);
  assert.equal(context.signatureArchWallX(-99, arch, 4), -1.44);
  assert.equal(context.signatureArchWallX(0.5, arch, 0.8), arch.x);

  const start = appSource.indexOf('  const updateItem = (id, patch) => {');
  const end = appSource.indexOf('    const autoLedItem =', start);
  vm.runInContext(`${appSource.slice(start, end)}\n};`, context);
  vm.runInContext("updateItem('arch', { x: 0.39, z: 99 })", context);
  assert.equal(items[0].x, 0.5);
  assert.ok(Math.abs(items[0].z - (-2 + 0.06 + 0.6)) < 1e-9);
  assert.equal(items[0].rotation, 0);
  assert.equal(items[0].rotationLocked, true);
  assert.equal(items[1].x, 0.18);
  assert.equal(items[0].options.imageUrl, 'existing-visual');
  items[0].x = 0.13;
  vm.runInContext("updateItem('arch', { options: { imageUrl: 'new-visual' } })", context);
  assert.equal(items[0].x, 0.13, 'A visual-only edit must not move an existing arch');
  context.readOnly = true;
  vm.runInContext("updateItem('arch', { x: 1 })", context);
  assert.equal(items[0].x, 0.13);
  assert.match(appSource, /const signatureArchPlacementStep = 0\.25/);
});

test('Furniture fits under the Signature arch but cannot intersect its front totem', () => {
  const context = vm.createContext({
    collisionPadding: 0,
    signatureArchTotemDepth: 0.55,
    isSignatureArchItem: (item) => item.type === 'signature-arch',
    isWallItem: () => false,
    isCeilingMountedItem: () => false,
    isCountertopAccessory: () => false,
    collidesWithReserveProtectedArea: () => false,
    collidesWithPartitionHeads: () => false,
    itemCollisionEnabled: () => true,
    itemGroupBounds: (item) => {
      const [width, height, depth] = item.dimensions.size;
      return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2, height };
    },
  });
  context.itemPlacementBounds = context.itemGroupBounds;
  for (const name of ['rotatePoint', 'itemHardCollisionBox', 'signatureArchTotemCollisionBox', 'itemCollisionBox', 'boxesOverlap', 'collidesWithScene']) loadFunction(name, context);
  const arch = { id: 'arch', type: 'signature-arch', x: 0, z: 0, rotation: 0, dimensions: { size: [1.1, 3.64, 2.52] } };
  const chair = { id: 'chair', type: 'chair', x: 0, z: 0, rotation: 0, dimensions: { size: [0.5, 0.8, 0.5] } };
  assert.equal(context.collidesWithScene(chair, [arch]), false);
  assert.equal(context.collidesWithScene(arch, [chair]), false);
  assert.equal(context.collidesWithScene({ ...chair, z: 1.03 }, [arch]), true);
  assert.equal(context.collidesWithScene(arch, [{ ...chair, z: 1.03 }]), true);
});

test('Signature arch image slots replace only their own material, including the literal *30 name', () => {
  const context = vm.createContext({
    signatureArchVisualSlots: [
      { id: 'signature-arch-led-5', targetName: 'LED_5500k#5', kind: 'image', matchMode: 'exact' },
      { id: 'signature-arch-led-30', targetName: 'LED_5500k#30', kind: 'image', matchMode: 'exact' },
    ],
    normalizeTextureSlots: () => [],
    isSignatureArchItem: () => true,
    materialMatchesTextureSlot: (name, material, target) => name === target.toLowerCase(),
    textureSlotHasLogoGate: () => false,
    materialTextureCanvasSize: () => [100, 100],
    normalizeImageFraming,
    createCoverImageTexture: (image) => image,
    materialWithTexture: (material, map) => ({ ...material, map }),
  });
  loadFunction('itemTextureSlots', context);
  loadFunction('signatureArchVisualMaterialMatches', context);
  loadFunction('applyTextureSlotMaterial', context);
  const item = { options: { textureSlotValues: {
    'signature-arch-led-5': { imageUrl: 'first' },
    'signature-arch-led-30': { imageUrl: 'second' },
  } } };
  const images = { textureSlotImages: {
    'signature-arch-led-5': { id: 'first' },
    'signature-arch-led-30': { id: 'second' },
  } };
  assert.equal(context.applyTextureSlotMaterial({ name: 'LED_5500k#5' }, item, images, 'led_5500k#5').map.id, 'first');
  assert.equal(context.applyTextureSlotMaterial({ name: '*30' }, item, images, '*30').map.id, 'second');
  assert.equal(context.applyTextureSlotMaterial({ name: 'LED_5500k#50' }, item, images, 'led_5500k#50').map, undefined);
  assert.match(appSource, /onSignatureArchImage=\{\(item, slot, file\) => uploadItemImage\(item, file, \{ textureSlot: slot \}\)\}/);
});
