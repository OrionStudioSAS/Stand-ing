import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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
  assert.match(appSource, /signatureArchColorTexture/);
  assert.match(appSource, /function SignatureArchFootprint\(/);
  assert.match(appSource, /Number\(standDepth \|\| 0\) \+ signatureArchFootprintOverflow/);
  assert.match(appSource, /const signatureArchFootprintOverflow = 0\.5/);
  assert.match(appSource, /isSignatureArchItem\(item\) && <SignatureArchFootprint item=\{item\} standDepth=\{depth\}/);
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

test('Furniture fits under the Signature arch but cannot intersect its front totem', () => {
  const context = vm.createContext({
    collisionPadding: 0,
    signatureArchTotemDepth: 0.55,
    isSignatureArchItem: (item) => item.type === 'signature-arch',
    isWallItem: () => false,
    isCeilingMountedItem: () => false,
    isCountertopAccessory: () => false,
    collidesWithReserveProtectedArea: () => false,
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
