import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function runtime() {
  const api = vm.createContext({
    Layers: null, wallThickness: 0.06,
    isCeilingMountedItem: () => false, itemPlacementBoundsOverride: () => null,
    itemDefaultSize: (item) => item.dimensions.size, effectivePlacementRule: () => null,
    computeGroupSize: () => [2, 2.5, 1],
    findCatalogEntry: (entries, type) => entries.find((entry) => entry.type === type),
    isTelevisionItem: () => false, isLedRailEntry: () => false, hasOwn: Object.hasOwn,
    isLockedPlacementRule: () => false,
  });
  for (const name of ['rotatePoint', 'childrenBounds', 'itemGroupBounds', 'assetToCatalogEntry', 'hydrateSceneItemFromCatalog']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
  }
  return api;
}

test('current door depth flags reach cached group and saved scene children, even when standalone doors are not assigned to the pack', () => {
  const api = runtime();
  const door = { type: 'door', dimensions: { size: [1, 2.5, 0.25], depthLocked6cm: true } };
  const group = { type: 'reserve', dimensions: { isGroup: true, groupSize: [2.2, 2.5, 1], children: [{ ...door, id: 'door-child', dimensions: { ...door.dimensions, depthLocked6cm: false } }] } };
  const entry = api.assetToCatalogEntry(group, [door, group]);
  assert.equal(entry.children[0].dimensions.depthLocked6cm, true);
  const saved = { type: 'reserve', isGroup: true, children: group.dimensions.children };
  assert.equal(api.hydrateSceneItemFromCatalog(saved, [entry]).children[0].dimensions.depthLocked6cm, true);
  assert.equal(saved.children[0].dimensions.depthLocked6cm, false, 'Existing saved data is not mutated');
});

test('six-centimetre rear door geometry rotates like the rendered Three.js model instead of adding the handle/door-opening depth to banner deductions', () => {
  const api = runtime();
  const wall = { type: 'wall', x: -0.5, z: 0.5, rotation: 0, dimensions: { size: [1, 2.5, 0.06] } };
  const front = { ...wall, x: 0.5 };
  const door = { type: 'door', x: 0.875, z: 0, rotation: -90, dimensions: { size: [1, 2.5, 0.25], depthLocked6cm: true } };
  const bounds = api.childrenBounds([wall, front, door]);
  assert.ok(Math.abs(bounds.minX + 1) < 1e-9);
  assert.ok(Math.abs(bounds.maxX - 1) < 1e-9);
  assert.equal(bounds.width, 2);
  const mirrored = api.childrenBounds([wall, front, { ...door, x: -0.875, rotation: 90 }]);
  assert.ok(Math.abs(mirrored.minX + 1) < 1e-9);
  assert.ok(Math.abs(mirrored.maxX - 1) < 1e-9);
});
