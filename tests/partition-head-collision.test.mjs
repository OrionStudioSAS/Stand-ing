import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

function collisionContext() {
  const context = vm.createContext({
    collisionPadding: 0,
    wallThickness: 0.06,
    partitionHeadWallGap: 0.02,
    signatureArchPlacementStep: 0.25,
    signatureArchTotemDepth: 0.55,
    isCeilingMountedItem: () => false,
    isCountertopAccessory: () => false,
    isPosterItem: () => false,
    isSignaturePackLabel: (label) => label === 'Signature',
    inferredAssetModelSize: () => [0.7, 0.7, 0.7],
    objectWallTransform: () => null,
    wallItemCenterY: () => 0,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    hasOwn: (object, key) => Object.hasOwn(object, key),
  });
  for (const name of [
    'normalizedItemText', 'isPartitionHeadItem', 'isAutomaticPartitionHeadItem',
    'isSmclPartitionHeadItem', 'smclPartitionHeadSide', 'isSignaturePartitionHeadItem',
    'isAutomaticReserveItem', 'isReserveSceneItem', 'isPrestigeArchItem', 'isSignatureArchItem',
    'isWallItemType', 'isWallItem', 'normalizeModelSize', 'itemDefaultSize',
    'smclPartitionHeadPlacementBounds', 'itemPlacementBoundsOverride', 'itemGroupBounds',
    'childrenBounds', 'itemGroupSize', 'rotatePoint', 'itemPlacementBounds',
    'itemHardCollisionBox', 'boxesOverlap', 'itemCollisionEnabled', 'itemCollisionBox',
    'signatureArchTotemCollisionBox', 'collidesWithReserveProtectedArea',
    'wallMountedNormalOffset', 'wallMountedItemRotation', 'screenWorldPosition',
    'partitionHeadModelBounds', 'partitionHeadPhysicalBox', 'collidesWithPartitionHeads',
    'collidesWithScene', 'signatureArchWallX', 'signatureArchBackWallZ',
    'placeSignatureArchAgainstBackWall', 'isTransformPatch',
  ]) loadFunction(name, context);
  return context;
}

const head = {
  id: 'head-right', label: 'Tete de cloison SMCL droite',
  isWallItem: true, wall: 'back', x: 1.1, rotation: 0,
  dimensions: { size: [1.4, 2.4, 0.1] },
};
const reserve = {
  id: 'reserve', label: 'Reserve de fond', x: 0.3, z: -1.5, rotation: 0,
  dimensions: { size: [0.3, 2.4, 1] },
};
const arch = {
  id: 'arch', label: 'Arche Totem + Plafond Spot', x: -0.5, z: -0.74, rotation: 0,
  dimensions: { size: [1.1, 3.6, 2.4] },
};

test('SMCL retains its 60 cm placement footprint but protects the complete head', () => {
  const context = collisionContext();
  assert.equal(context.itemGroupBounds(head).width, 0.6);
  const full = context.partitionHeadPhysicalBox(head, [], 4, 4);
  assert.ok(Math.abs(full.maxX - full.minX - 1.4) < 1e-9);
  assert.equal(context.collidesWithScene(reserve, [head], reserve.id, 4, 4), true);
  assert.equal(context.collidesWithScene({ ...reserve, x: 0.2 }, [head], reserve.id, 4, 4), false);
  assert.equal(context.collidesWithScene({ ...reserve, x: 0.25 }, [head], reserve.id, 4, 4), false, 'No arbitrary extra clearance');
});

test('Full physical head bounds apply to floor heads and both side walls', () => {
  const context = collisionContext();
  const floorHead = { ...head, isWallItem: false, z: -1.9 };
  assert.equal(context.collidesWithScene(reserve, [floorHead], reserve.id, 4, 4), true);
  for (const wall of ['left', 'right']) {
    const wallHead = { ...head, wall, x: -1 };
    const nearSide = { ...reserve, x: wall === 'left' ? -1.6 : 1.6, z: -0.35, dimensions: { size: [0.6, 2.4, 0.3] } };
    assert.equal(context.collidesWithScene(nearSide, [wallHead], reserve.id, 4, 4), true, wall);
    assert.equal(context.collidesWithScene({ ...nearSide, z: 0 }, [wallHead], reserve.id, 4, 4), false, wall);
  }
});

test('Signature heads use the full model and their rendered orientation', () => {
  const context = collisionContext();
  const signatureHead = { ...head, label: 'Tete De Cloison - Signature', dimensions: { size: [0.2, 2.4, 1.4] } };
  const box = context.partitionHeadPhysicalBox(signatureHead, [], 4, 4);
  assert.ok(Math.abs(box.maxX - box.minX - 1.4) < 1e-9);
  assert.ok(Math.abs(box.maxZ - box.minZ - 0.2) < 1e-9);
  assert.equal(context.collidesWithScene(reserve, [signatureHead], reserve.id, 4, 4), true);
});

test('Grouped reserves collide with the full head, including grouped SMCL children', () => {
  const context = collisionContext();
  const groupedHead = { ...head, isWallItem: false, z: -1.9, isGroup: true, children: [{ ...head, x: 0.2, z: 0 }] };
  const box = context.partitionHeadPhysicalBox(groupedHead);
  assert.ok(Math.abs(box.minX - 0.6) < 1e-9);
  const groupedReserve = { ...reserve, x: 0.5, isGroup: true, children: [{ id: 'panel', x: 0, z: 0, dimensions: { size: [0.3, 2.4, 1] } }] };
  assert.equal(context.collidesWithScene(groupedReserve, [groupedHead], reserve.id, 4, 4), true);
  const rotated = context.partitionHeadPhysicalBox({ ...groupedHead, rotation: 90 });
  assert.ok(Math.abs(rotated.minZ - (-1.9 - 0.9)) < 1e-9, 'Group offsets follow the rendered Y rotation');
});

test('Arch back and overhead footprint cannot encroach on heads, while furniture still fits underneath', () => {
  const context = collisionContext();
  const overlappingArch = { ...arch, x: 0 };
  assert.equal(context.collidesWithScene(overlappingArch, [head], arch.id, 4, 4), true);
  assert.equal(context.collidesWithScene({ ...overlappingArch, label: 'Arche Prestige' }, [head], arch.id, 4, 4), true);
  const chair = { id: 'chair', label: 'Chaise', x: -0.5, z: -1, dimensions: { size: [0.4, 0.8, 0.4] } };
  assert.equal(context.collidesWithScene(chair, [arch], chair.id, 4, 4), false);
  assert.equal(context.collidesWithScene(arch, [chair], arch.id, 4, 4), false);
  assert.equal(context.collidesWithScene({ ...chair, x: 0.3, z: -1.9 }, [head], chair.id, 4, 4), false, 'Ordinary furniture does not gain a new full-head restriction');
});

test('Head protection is symmetric and survives disabled normal collisions, but skips hidden and ignored heads', () => {
  const context = collisionContext();
  assert.equal(context.collidesWithPartitionHeads(head, [reserve], head.id, 4, 4), true);
  assert.equal(context.collidesWithScene({ ...arch, x: 0, collisionEnabled: false }, [{ ...head, collisionEnabled: false }], arch.id, 4, 4), true);
  assert.equal(context.collidesWithScene(reserve, [{ ...head, options: { partitionHeadHidden: true } }], reserve.id, 4, 4), false);
  assert.equal(context.collidesWithScene(reserve, [{ ...head, options: { prestigeHidden: true } }], reserve.id, 4, 4), false);
  assert.equal(context.collidesWithScene(reserve, [head], head.id, 4, 4), false);
  assert.equal(context.collidesWithPartitionHeads(reserve, [{ ...head, id: reserve.id }], null, 4, 4), false);
});

test('Signature arch dragging rejects a head overlap, preserves visuals, and keeps 25 cm back-wall movement', () => {
  const context = collisionContext();
  let items = [{ ...arch, options: { imageUrl: 'existing' } }];
  Object.assign(context, {
    sceneItems: items, automaticReserveItems: [], automaticPartitionHeadItems: [head],
    width: 4, depth: 4, readOnly: false, effectiveAdminViewer: false, isSignatureStand: true,
    itemSystemTransformLocked: () => false, itemRotationLocked: () => false,
    setItems: (update) => { items = update(items); context.sceneItems = items; },
  });
  const start = source.indexOf('  const updateItem = (id, patch) => {');
  const end = source.indexOf('    const autoLedItem =', start);
  vm.runInContext(`${source.slice(start, end)}\n};`, context);
  vm.runInContext("updateItem('arch', { x: 0.01 })", context);
  assert.equal(items[0].x, -0.5, 'An overlapping drag retains the previous valid position');
  vm.runInContext("updateItem('arch', { x: -0.26, z: 99 })", context);
  assert.equal(items[0].x, -0.25);
  assert.ok(Math.abs(items[0].z + 0.74) < 1e-9);
  assert.equal(items[0].options.imageUrl, 'existing');
  items[0].x = 0;
  vm.runInContext("updateItem('arch', { options: { imageUrl: 'new' } })", context);
  assert.equal(items[0].options.imageUrl, 'new', 'Old scenes can still edit visuals even with an existing overlap');
});

test('Signature arch variant placement finds the nearest clear back-wall position or refuses when no space fits', () => {
  const context = collisionContext();
  const clear = context.placeSignatureArchAgainstBackWall(arch, [head], 4, 4);
  assert.equal(clear.x, arch.x);
  const moved = context.placeSignatureArchAgainstBackWall({ ...arch, x: 0 }, [head], 4, 4);
  assert.equal(moved.x, -0.25);
  assert.ok(Math.abs(moved.z + 0.74) < 1e-9);
  const leftHead = { ...head, id: 'head-left', x: -1.1, label: 'Tete de cloison SMCL gauche' };
  assert.equal(context.placeSignatureArchAgainstBackWall(arch, [head, leftHead], 4, 4), null);
  assert.equal(context.placeSignatureArchAgainstBackWall(arch, [], 0.8, 4), null, 'An oversized arch is not accepted even without other objects');
  const clamped = context.placeSignatureArchAgainstBackWall({ ...arch, x: 99 }, [], 4, 4);
  assert.ok(Math.abs(clamped.x - 1.39) < 1e-9);
});

test('Manual reserve movement uses the new collision guard and retains its position on failure', () => {
  const context = collisionContext();
  Object.assign(context, {
    resolveSurfaceAttachments: (items) => items,
    releasePlacementRuleForManualEdit: (item) => item,
    constrainItem: (item) => item,
    stableCartValue: JSON.stringify,
  });
  loadFunction('isSameSceneTransform', context);
  loadFunction('updateSceneItemWithCollision', context);
  const items = [{ ...reserve, x: 0 }, head];
  assert.equal(context.updateSceneItemWithCollision(items, reserve.id, { x: 0.3 }, 4, 4, 'back'), items);
  assert.equal(context.updateSceneItemWithCollision(items, reserve.id, { x: 0.2 }, 4, 4, 'back')[0].x, 0.2);
});

test('Automatic back-wall reserves cannot be moved into a full head', () => {
  const context = collisionContext();
  const automaticReserve = { ...reserve, autoReserve: true, x: 0 };
  let overrides = {};
  Object.assign(context, {
    sceneItems: [automaticReserve, head], manualHydratedItems: [], automaticPartitionHeadItems: [head],
    automaticLedItems: [], automaticSpotItems: [], isAutomaticLedRailItem: () => false,
    width: 4, depth: 4, layout: 'back', genericCarpetFootprintEnabled: false,
    readOnly: false, effectiveAdminViewer: false, isSignatureStand: false,
    itemSystemTransformLocked: () => true, canApplyAutomaticReservePatch: () => true,
    itemRotationLocked: () => false, stableCartValue: JSON.stringify,
    automaticReserveBackWallCandidate: (item, patch) => ({ ...item, ...patch }),
    pickReserveItemOverride: (item) => ({ x: item.x, z: item.z }),
    setReserveItemOverrides: (update) => { overrides = update(overrides); },
  });
  loadFunction('isSameSceneTransform', context);
  const start = source.indexOf('  const updateItem = (id, patch) => {');
  const end = source.indexOf('    setItems((current) => {\n      const visibleCurrent', start);
  vm.runInContext(`${source.slice(start, end)}\n};`, context);
  vm.runInContext("updateItem('reserve', { x: 0.3 })", context);
  assert.deepEqual(overrides, {});
  vm.runInContext("updateItem('reserve', { x: 0.2 })", context);
  assert.equal(overrides.reserve.x, 0.2);
});

test('Changing arch variants preserves images and rejects an impossible replacement without removing the old arch', () => {
  const context = collisionContext();
  let items = [{ ...arch, options: { imageUrl: 'customer-image' } }];
  let message = '';
  let selectedId = '';
  Object.assign(context, {
    readOnly: false, isSignatureStand: true, signatureArchItem: items[0],
    signatureArchColor: {}, selectedCarpetFootprintColor: {}, signatureArchColorOptions: () => ({}),
    width: 4, depth: 4, layout: 'back', automaticReserveItems: [], automaticPartitionHeadItems: [head],
    makeItem: (type, width, depth, layout, entry) => ({ ...entry, id: 'new-arch', x: 0, z: 0 }),
    setItems: (update) => { items = update(items); },
    setSelectedId: (id) => { selectedId = id; },
    showPlacementMessage: (text) => { message = text; },
    placementErrorMessage: () => 'No space available',
    window: { setTimeout: (callback) => callback() },
    entry: { ...arch, type: 'arch-suspension', label: 'Arche Totem + Plafond Suspension' },
  });
  const start = source.indexOf('  const selectSignatureArchVariant = (entry) => {');
  const end = source.indexOf('\n  const updateSignatureArchColor =', start);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('selectSignatureArchVariant(entry)', context);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'arch-suspension');
  assert.equal(items[0].options.imageUrl, 'customer-image');
  assert.equal(selectedId, arch.id);
  const previous = items;
  context.entry = { ...context.entry, dimensions: { size: [5, 3.6, 2.4] } };
  vm.runInContext('selectSignatureArchVariant(entry)', context);
  assert.equal(items, previous);
  assert.equal(message, 'No space available');
});
