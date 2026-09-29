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

function placementContext() {
  const context = vm.createContext({
    collisionPadding: 0,
    isWallItem: () => false,
    isCeilingMountedItem: () => false,
    isWallTopSnapItem: () => false,
    collidesWithReserveProtectedArea: () => false,
    itemCollisionEnabled: () => true,
    isSignatureArchItem: () => false,
    hasOwn: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
    stableCartValue: JSON.stringify,
    releasePlacementRuleForManualEdit: (item) => item,
    constrainItem: (item) => ({ ...item, y: context.floorItemBaseY(item) }),
    itemGroupBounds: (item) => {
      const [width, height, depth] = item.dimensions.size;
      return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2, height };
    },
    itemPlacementBounds: (item) => context.itemGroupBounds(item),
  });
  for (const name of [
    'normalizedItemText', 'rotatePoint', 'isCountertopAccessory', 'canSupportCountertopAccessory',
    'accessoryFitsSurface', 'detachCountertopAccessory', 'floorItemBaseY',
    'placeCountertopAccessory', 'resolveSurfaceAttachments', 'itemHardCollisionBox',
    'itemCollisionBox', 'boxesOverlap', 'collidesWithScene', 'isSameSceneTransform',
    'updateSceneItemWithCollision',
  ]) loadFunction(name, context);
  return context;
}

const table = {
  id: 'chronos', label: 'Table Chronos', x: 0, z: 0, rotation: 0,
  dimensions: { size: [1.2, 0.74, 0.8] },
};
const machine = {
  id: 'coffee', label: 'Machine à café Nespresso', x: 0, z: 1.5, rotation: 0,
  dimensions: { size: [0.25, 0.32, 0.22] },
};

test('Nespresso can sit on a Chronos table, not on unrelated furniture', () => {
  const context = placementContext();
  const onTable = context.placeCountertopAccessory({ ...machine, x: 0.2, z: 0 }, [table]);
  assert.equal(onTable.surfaceHostId, 'chronos');
  assert.equal(onTable.y, 0.74);
  assert.equal(onTable.surfaceOffsetX, 0.2);
  assert.equal(context.collidesWithScene(onTable, [table], machine.id), false);
  assert.equal(context.collidesWithScene(onTable, [{ ...table, id: 'chair', label: 'Chaise' }], machine.id), true);
  assert.equal(context.placeCountertopAccessory({ ...machine, x: 0, z: 0 }, [{ ...table, label: 'Chaise Chronos' }]).surfaceHostId, null);
  assert.equal(context.placeCountertopAccessory({ ...machine, x: 0.55, z: 0 }, [table]).surfaceHostId, null);
});

test('A hosted machine follows table movement and rotation, then returns to the floor', () => {
  const context = placementContext();
  let items = [table, machine];
  items = context.updateSceneItemWithCollision(items, machine.id, { x: 0.2, z: 0 }, 4, 3, 'u');
  assert.equal(items[1].surfaceHostId, table.id);
  assert.equal(items[1].y, 0.74);

  items = context.updateSceneItemWithCollision(items, table.id, { x: 1, rotation: 90 }, 4, 3, 'u');
  assert.ok(Math.abs(items[1].x - 1) < 1e-9);
  assert.ok(Math.abs(items[1].z - 0.2) < 1e-9);
  assert.equal(items[1].y, 0.74);

  items = context.updateSceneItemWithCollision(items, machine.id, { x: -1, z: 1 }, 4, 3, 'u');
  assert.equal(items[1].surfaceHostId, null);
  assert.equal(items[1].y, 0);
  assert.equal(context.resolveSurfaceAttachments([items[1]])[0].y, 0);
});

test('Removing a supporting table drops its machine back to the floor', () => {
  const context = placementContext();
  const attached = context.placeCountertopAccessory({ ...machine, x: 0, z: 0 }, [table]);
  const detached = context.resolveSurfaceAttachments([attached])[0];
  assert.equal(detached.surfaceHostId, null);
  assert.equal(detached.y, 0);
});
