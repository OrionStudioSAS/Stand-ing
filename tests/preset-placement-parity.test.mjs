import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { wallFabricColors } from '../src/config/colorOptions.js';
import { closestSpotWallTarget, spotTargetPatch, spotWallTargets } from '../src/spotPlacement.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
function loadFunction(name, context, code = source) {
  const start = code.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(code.slice(start, code.indexOf('\n}\n', start) + 2), context);
}
const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

test('Equipe reserve fabric matches Signature anthracite even when a saved default is white', () => {
  const context = vm.createContext({ wallFabricColors, normalizePackLabel: normalized,
    findColorInPalette: (palette, id) => palette.find((color) => color.id === id) });
  for (const name of ['signatureReserveWallFabricColor', 'reserveWallFabricColorForPack', 'isSignaturePackLabel']) loadFunction(name, context);
  const white = wallFabricColors.find((color) => color.code === '303');
  for (const pack of ['Équipé', 'EQUIPE', 'Signature']) {
    const color = context.reserveWallFabricColorForPack(pack, [white], white.id, white);
    assert.equal(color.code, '3026');
    assert.equal(color.hex, '#787878');
    assert.match(color.image, /3026.*Anthracite/);
  }
  assert.equal(context.reserveWallFabricColorForPack('Confort', [white], white.id, white), white);
});

test('SIAE head upload labels do not claim to be luminous; other heads keep their labels', () => {
  const context = vm.createContext({ normalizePackLabel: normalized });
  for (const name of ['normalizedItemText', 'partitionHeadVisualLabel']) loadFunction(name, context);
  for (const [side, label] of [['left', 'gauche'], ['right', 'droite']]) {
    assert.equal(context.partitionHeadVisualLabel(side, 'Équipé'), `VISUEL tête de cloison ${label}`);
    assert.equal(context.partitionHeadVisualLabel(side, 'SIAE 2027', { label: 'Tête De Cloison SIAE' }), `VISUEL tête de cloison ${label}`);
    assert.match(context.partitionHeadVisualLabel(side, 'Signature'), /VISUEL LUMINEUX/);
    assert.match(context.partitionHeadVisualLabel(side, 'Confort'), /VISUEL LUMINEUX/);
  }
});

function surfaceContext() {
  const context = vm.createContext({
    closestSpotWallTarget, spotTargetPatch, spotWallTargets,
    objectWallAxisPadding: 0.1, objectWallSnapThreshold: 0.3,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    isTelevisionItem: () => false,
    isLedRailEntry: (item) => Boolean(item.autoLedRail), isAutomaticSpotItem: () => false,
    wallItemMetrics: () => ({ width: 1 }), itemGroupSize: () => ({ depth: 0.1 }),
    availableWalls: () => [{ id: 'back' }], wallAxisLimits: () => ({ min: -3.5, max: 3.5 }),
    standFloorBounds: () => ({ minX: -3.5, maxX: 3.5, minZ: -1.44, maxZ: 1.5 }),
    wallMountedNormalOffset: (_item, object) => object ? 0.08 : 0.11,
    wallFromDrag: () => 'back',
    snapWallAxis: (value) => Math.round(value * 100) / 100,
    isWallItem: (item) => Boolean(item.isWallItem),
    itemCollisionEnabled: () => true,
    isReserveSceneItem: (item) => Boolean(item.autoReserve),
    itemDefaultSize: (item) => item.dimensions.size,
    itemHardCollisionBox: (item) => ({ minX: item.x - 1, maxX: item.x + 1, minZ: item.z - 0.5, maxZ: item.z + 0.5 }),
  });
  for (const name of [
    'rotatePoint', 'wallSurfaceCandidate', 'isObjectWallSurfaceCandidate',
    'objectWallSurfaces', 'groupObjectWallSurfaces', 'mergeObjectWallSurfaces',
    'isProtectedBoundarySurface', 'protectedObjectOutsideSide', 'safeObjectWallSide',
    'serializeObjectWallSurface', 'objectWallFromDrag', 'wallDragPatch', 'isSpotWallItem', 'spotPlacementTargetsForItem',
    'pickLedRailOverride', 'applyLedRailOverride',
  ]) loadFunction(name, context);
  return context;
}

test('Viscom posters and LED rails snap to the outside of automatic reserve walls', () => {
  const context = surfaceContext();
  const reserve = { id: 'auto-reserve-medium', autoReserve: true, isGroup: true, x: 1, z: -1, children: [
    { id: 'front', label: 'Cloison réserve', x: 0, z: 0.5, dimensions: { size: [2, 2.5, 0.06] } },
  ] };
  for (const item of [
    { id: 'viscom', label: 'Affiche Viscom', isWallItem: true },
    { id: 'auto-spot-rail-back-1', label: 'Rail LED 3 spots', isWallItem: true, autoLedRail: true },
  ]) {
    const patch = context.wallDragPatch({ x: 1, z: -0.4 }, item, [item, reserve], 7, 3, 'u');
    assert.match(patch.wall, /^object-wall:auto-reserve-medium:/);
    assert.equal(patch.wallSide, 1);
    assert.equal(patch.wallSurface.normalAxis, -0.5);
    assert.equal(patch.wallSurface.length, 2);
    assert.equal(patch.wallSurface.protectedBounds.maxZ, -0.5);
    if (item.autoLedRail) {
      context.constrainItem = (entry) => entry;
      const placed = { ...item, ...patch };
      const override = context.pickLedRailOverride(placed);
      const reloaded = context.applyLedRailOverride(item, { [item.id]: override }, 7, 3, 'u');
      assert.equal(reloaded.wall, patch.wall);
      assert.equal(reloaded.wallSide, 1);
      assert.equal(reloaded.wallSurface.normalAxis, -0.5);
      assert.equal(reloaded.collisionEnabled, false);
    }
  }
});

test('Automatic rails ignore Viscom posters, retaining reserve blockers in every scene context', () => {
  const contexts = [];
  const rail = { type: 'rail', label: 'Rail LED 3 spots' };
  const context = vm.createContext({
    autoSpotsRuleEntries: () => [rail], makeLedRailPlan: () => [rail, rail], ledSpotCountForArea: () => 6,
    availableWalls: () => [{ id: 'back' }], wallLength: () => 7,
    makeItem: (type) => ({ type, dimensions: {} }), ledRailCenterY: () => 2.5,
    wallItemAxisRange: () => ({ min: -3, max: 3 }),
    isReserveSceneItem: (item) => Boolean(item.autoReserve),
    wallBlockers: (_dummy, items) => {
      contexts.push(items);
      return items.map((item) => ({ min: item.x - 0.5, max: item.x + 0.5 }));
    },
    freeWallIntervals: (range, blockers) => [{ min: range.min, max: blockers.length ? blockers[0].min : range.max }],
    distributeInFreeIntervals: (count, intervals) => Array.from({ length: count }, (_, i) => intervals[0].min + (i + 1) * (intervals[0].max - intervals[0].min) / (count + 1)),
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)), snapWallAxis: (v) => v, constrainItem: (item) => item,
  });
  loadFunction('makeAutomaticSpotItems', context);
  const reserve = { id: 'reserve', autoReserve: true, x: 2 };
  const poster = { id: 'viscom', x: -1, isWallItem: true };
  const make = (items) => Array.from(context.makeAutomaticSpotItems({}, [rail], 7, 3, 'u', items), (item) => ({ id: item.id, x: item.x, wall: item.wall }));
  const realScene = make([reserve]);
  assert.deepEqual(make([reserve, poster]), realScene);
  assert.deepEqual(make([reserve, { ...poster, x: 1 }]), realScene);
  assert.ok(contexts.every((items) => items.length === 1 && items[0].id === 'reserve'));
  assert.notDeepEqual(make([{ ...reserve, x: 1 }]), realScene, 'A real change to the reserve still affects unmodified rails');
});

test('Shared manual edits include automatic reserve/head blockers without duplicating or saving generated objects', () => {
  let collisionContext;
  const context = vm.createContext({
    isAutomaticLedRailItem: (item) => Boolean(item.autoLedRail),
    updateSceneItemWithCollision: (items, id, patch) => {
      collisionContext = items;
      return items.map((item) => item.id === id ? { ...item, ...patch } : item);
    },
  });
  loadFunction('updateManualSceneItemWithCollision', context);
  const manual = [{ id: 'viscom', x: 0 }, { id: 'chair', x: 0 }];
  const preview = [...manual, { id: 'reserve', autoReserve: true }, { id: 'head', autoPartitionHead: true }, { id: 'rail', autoLedRail: true }];
  const edited = context.updateManualSceneItemWithCollision(manual, 'viscom', { x: 1 }, preview, 7, 3, 'u');
  assert.deepEqual(Array.from(collisionContext, (item) => item.id), ['viscom', 'chair', 'reserve', 'head']);
  assert.deepEqual(Array.from(edited, (item) => item.id), ['viscom', 'chair']);
  assert.equal(edited[0].x, 1);
  const editor = source.slice(source.indexOf('function PresetSceneEditor('), source.indexOf('function PresetCameraFraming('));
  assert.match(editor, /wallDragPatch\(point, dragged, previewItems/);
  assert.match(editor, /updateManualSceneItemWithCollision\(current, id, patch, previewItems/);
  assert.match(editor, /const selected = previewItems\.find/);
});

test('Pack rail/reserve positions are inherited only when a client has not saved its own overrides', () => {
  const context = vm.createContext({ scenePackBenefits: () => ({ mode: 'included' }) });
  loadFunction('applyPresetDefaultColorOptions', context, storeSource);
  const defaults = { ledRailOverrides: { rail: { wall: 'object-wall:reserve', x: 0.5 } }, reserveItemOverrides: { reserve: { x: 1 } } };
  const preset = { base_config: { options: defaults } };
  const inherited = context.applyPresetDefaultColorOptions({ stand_presets: preset, source_payload: { options: { language: 'fr' } } });
  assert.equal(inherited.options.ledRailOverrides.rail.wall, 'object-wall:reserve');
  assert.equal(inherited.options.reserveItemOverrides.reserve.x, 1);
  assert.equal(inherited.options.language, 'fr');
  const clientOptions = { ledRailOverrides: {}, reserveItemOverrides: { reserve: { x: -1 } } };
  const client = context.applyPresetDefaultColorOptions({ stand_presets: preset, source_payload: { options: clientOptions } });
  assert.equal(Object.keys(client.options.ledRailOverrides).length, 0, 'An explicit client reset must not be overwritten');
  assert.equal(client.options.reserveItemOverrides.reserve.x, -1);
});
