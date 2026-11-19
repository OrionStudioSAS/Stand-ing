import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampFloorContent, configureReserveChildren, contentFootprint, findDoorHandleVariant, findFreeReserveSpot, isReservePowerSource,
  findMirroredDoorVariant, mirrorReserveChildren, normalizeDegrees, reserveOrientation,
  moveReserveDoor, refitReserveContents, reserveBuiltinChildren, reserveCatalogCategory, reserveContentIssues, reserveDoorChild,
  reserveDoorSlots, reserveDoorState, reserveEntryNeedsPower, reserveInterior, reserveLocalToWorld, reservePlacementAllowed,
  reservePlacementFromEntry, reserveWorldToLocal, snapWallContent,
} from '../src/reserveConfigurator.js';

// Geometry copied from the catalogue group "Réserve 2m² arrière gauche" (object_bank).
const wall = { label: 'Cloison Trad 1000x2500mm Ht', modelSize: [1, 2.5, 0.06], dimensions: { size: [1, 2.5, 0.06] } };
const twoSquareMetres = [
  { ...wall, id: 'wall-1', type: 'asset-cloison', x: 0, z: 0, rotation: 0 },
  { id: 'door', type: 'asset-porte-trad-gauche-poignee-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht + PoignéE Gauche', x: 0.56, z: -0.528, rotation: -90, modelSize: [1, 2.5, 0.25], dimensions: { size: [1, 2.5, 0.25] } },
  { ...wall, id: 'wall-2', type: 'asset-cloison', x: -1, z: 0, rotation: 0 },
  { id: 'hook', type: 'asset-patere', label: 'Patère', x: -0.473, z: -0.073, rotation: 180, modelSize: [0.46, 0.06, 0.07], dimensions: { size: [0.46, 0.06, 0.07], mountType: 'wall' } },
  { id: 'shelves', type: 'asset-bloc-3-etageres', label: 'Bloc 3 Étagères ', x: -1.323, z: -0.518, rotation: 90, modelSize: [0.95, 1.8, 0.33], dimensions: { size: [0.95, 1.8, 0.33] } },
];
const doorCatalog = [
  // Plain door whose asset type still says "trad": it must not replace a "Trad" door.
  { type: 'asset-porte-trad-gauche-poignee-droite-plain', label: 'Porte gauche poignée droite', dimensions: { size: [1, 2.5, 0.25] } },
  { type: 'door-droite-droite', label: 'Porte Trad Droite 1000x2500mm Ht + PoignéE Droite', dimensions: { size: [1, 2.5, 0.24] } },
  { type: 'door-gauche-droite', label: 'Porte Trad Gauche 1000x2500mm Ht + PoignéE Droite', dimensions: { size: [1, 2.5, 0.25] } },
  { type: 'door-gauche-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht + PoignéE Gauche', dimensions: { size: [1, 2.5, 0.25] } },
  { type: 'door-droite-gauche', label: 'Porte Trad Droite 1000x2500mm Ht + PoignéE Gauche', dimensions: { size: [1, 2.5, 0.25] } },
];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.011, `${message}: ${actual} ≠ ${expected}`);

test('the interior of a catalogue reserve is measured from its partitions and door', () => {
  const interior = reserveInterior(twoSquareMetres);
  near(interior.width, 2, 'width');
  near(interior.depth, 1, 'depth');
  assert.deepEqual(interior.sides, { left: false, right: true, back: false, front: true }, 'Back and left sides are stand walls');
});

test('without any stored choice the authored reserve is returned untouched', () => {
  assert.equal(configureReserveChildren(twoSquareMetres, {}, doorCatalog), twoSquareMetres);
});

test('the door can be swapped with any 1 m partition module and keeps a single door', () => {
  const slots = reserveDoorSlots(twoSquareMetres);
  assert.equal(slots.filter((slot) => slot.kind === 'door').length, 1);
  assert.equal(slots.find((slot) => slot.kind === 'door').side, 'right');
  const target = slots.find((slot) => slot.kind !== 'door' && slot.side === 'front');
  const moved = moveReserveDoor(twoSquareMetres, target.id);
  const door = reserveDoorChild(moved);
  assert.equal(moved.length, twoSquareMetres.length);
  assert.equal(reserveDoorSlots(moved).find((slot) => slot.kind === 'door').side, 'front');
  near(door.x, target.center, 'door centred on the former partition');
  const interior = reserveInterior(moved);
  near(interior.width, 2, 'width is preserved');
  near(interior.depth, 1, 'depth is preserved');
  assert.equal(moveReserveDoor(twoSquareMetres, 'missing-slot'), twoSquareMetres);
});

test('handle changes reuse the matching catalogue door model', () => {
  const door = reserveDoorChild(twoSquareMetres);
  assert.equal(findDoorHandleVariant(door, 'left', doorCatalog), null, 'Already a left handle');
  assert.equal(findDoorHandleVariant(door, 'right', doorCatalog).type, 'door-gauche-droite', 'Same door family, other handle');
  const configured = configureReserveChildren(twoSquareMetres, { handleOrientation: 'right' }, doorCatalog);
  assert.equal(reserveDoorChild(configured).type, 'door-gauche-droite');
  assert.equal(reserveDoorChild(configured).x, door.x, 'Swapping the handle does not move the door');
});

test('an inward opening reserves a clear zone inside the reserve, an outward one does not', () => {
  const interior = reserveInterior(twoSquareMetres);
  const push = reserveDoorState(twoSquareMetres, { doorOpening: 'push' });
  const pull = reserveDoorState(twoSquareMetres, { doorOpening: 'pull' });
  assert.equal(push.zoneInside, true);
  assert.equal(pull.zoneInside, false);
  assert.ok(push.zone.maxX <= interior.maxX + 0.05 && push.zone.minX >= interior.minX, 'Inward swing stays inside');
  assert.ok(pull.zone.minX >= interior.maxX - 0.05, 'Outward swing is outside the right wall');
  assert.equal(push.handle, 'left');
});

test('contents are checked against walls, the door swing and other objects', () => {
  const interior = reserveInterior(twoSquareMetres);
  const builtins = reserveBuiltinChildren(twoSquareMetres);
  const door = reserveDoorState(twoSquareMetres, {});
  const context = { interior, builtins, door, contents: [] };
  const fridge = { key: 'fridge', mount: 'floor', size: [0.5, 0.85, 0.55], rotation: 0 };
  const inDoorway = clampFloorContent(fridge, { x: door.zone.minX + 0.3, z: door.zone.minZ + 0.3 }, interior);
  assert.ok(reserveContentIssues(inDoorway, context).includes('door'));
  const onShelves = clampFloorContent(fridge, { x: interior.minX, z: interior.centerZ }, interior);
  assert.ok(reserveContentIssues(onShelves, context).includes('overlap'));
  const free = findFreeReserveSpot(fridge, context);
  assert.ok(free, 'A fridge fits next to the shelves');
  assert.deepEqual(reserveContentIssues(free, context), []);
  const box = contentFootprint(free, interior);
  assert.ok(box.minX >= interior.minX - 0.001 && box.maxX <= interior.maxX + 0.001);
});

test('wall-mounted contents snap to the closest wall and face the room', () => {
  const interior = reserveInterior(twoSquareMetres);
  const shelf = { key: 'shelf', mount: 'wall', size: [0.9, 0.3, 0.32] };
  const back = snapWallContent(shelf, { x: interior.centerX, z: interior.minZ + 0.1 }, interior);
  assert.equal(back.wall, 'back');
  const left = snapWallContent(shelf, { x: interior.minX + 0.05, z: interior.centerZ }, interior);
  assert.equal(left.wall, 'left');
  assert.notEqual(back.rotation, left.rotation);
  near(contentFootprint(back, interior).minZ, interior.minZ, 'flush with the back wall');
});

test('a smaller reserve keeps what still fits and reports the rest', () => {
  const interior = reserveInterior(twoSquareMetres);
  const builtins = reserveBuiltinChildren(twoSquareMetres);
  const context = { interior, builtins, door: reserveDoorState(twoSquareMetres, {}), contents: [] };
  const first = findFreeReserveSpot({ key: 'a', mount: 'floor', size: [0.5, 0.85, 0.5], rotation: 0 }, context);
  const second = findFreeReserveSpot({ key: 'b', mount: 'floor', size: [0.5, 0.85, 0.5], rotation: 0 }, { ...context, contents: [first] });
  assert.ok(first && second);
  const tiny = { ...interior, maxX: interior.minX + 0.9, maxZ: interior.minZ + 0.6, width: 0.9, depth: 0.6, centerX: interior.minX + 0.45, centerZ: interior.minZ + 0.3 };
  const { kept, removed } = refitReserveContents([first, second], { interior: tiny, builtins: [], door: null });
  assert.equal(kept.length + removed.length, 2);
  assert.ok(removed.length >= 1, 'Two 50 cm items cannot share a 90 × 60 cm reserve');
});

test('reserve coordinates convert between local and stand space', () => {
  const reserve = { x: -0.94, z: -1.41, rotation: 90 };
  const local = { x: 0.4, z: -0.25 };
  const back = reserveWorldToLocal(reserve, reserveLocalToWorld(reserve, local));
  near(back.x, local.x, 'x');
  near(back.z, local.z, 'z');
});

test('placement keywords follow the stand layout', () => {
  assert.equal(reservePlacementFromEntry({ dimensions: { placementRule: { id: 'back-left' } } }), 'left');
  assert.equal(reservePlacementFromEntry({ label: 'Réserve 2m² centre arrière' }), 'center');
  assert.equal(reservePlacementAllowed('left', 'back'), false, 'A back-only stand has no left wall');
  assert.equal(reservePlacementAllowed('left', 'u'), true);
  assert.equal(reservePlacementAllowed('right', 'right'), true);
  assert.equal(reservePlacementAllowed('center', 'back'), true);
});

test('only storage-friendly shop objects are offered inside the reserve', () => {
  assert.equal(reserveCatalogCategory({ label: 'Frigo 140 L' }), 'appliance');
  assert.equal(reserveCatalogCategory({ label: 'Étagère Blanche droite', groupLabel: 'Étagère murale' }), 'wall');
  assert.equal(reserveCatalogCategory({ label: 'Meuble Bois', groupLabel: 'Meuble de rangement' }), 'storage');
  assert.equal(reserveCatalogCategory({ label: 'Triplette' }), 'electric');
  assert.equal(reserveCatalogCategory({ label: 'Comptoir accueil' }), '');
  assert.equal(reserveCatalogCategory({ label: 'Chaise haute' }), '');
  assert.equal(reserveEntryNeedsPower({ label: 'Machine à café' }), true);
  assert.equal(reserveEntryNeedsPower({ label: 'Corbeille Noir' }), false);
  assert.equal(isReservePowerSource({ label: 'Alimentation électrique' }), true);
});

test('a corner reserve turns along its side wall, closed by the same stand walls', () => {
  assert.equal(reserveOrientation(twoSquareMetres), 'horizontal');
  const vertical = mirrorReserveChildren(twoSquareMetres, 'left', doorCatalog);
  const interior = reserveInterior(vertical);
  assert.equal(reserveOrientation(vertical), 'vertical');
  near(interior.width, 1, 'width along the back wall');
  near(interior.depth, 2, 'depth along the left wall');
  assert.equal(interior.sides.left, false, 'Left side stays the stand wall');
  assert.equal(interior.sides.back, false, 'Back side stays the stand wall');
  assert.equal(vertical.length, twoSquareMetres.length);
  assert.deepEqual(reserveBuiltinChildren(vertical).map((child) => child.id), reserveBuiltinChildren(twoSquareMetres).map((child) => child.id), 'Included shelves and hook follow the reserve');
  assert.equal(reserveDoorChild(vertical).type, 'door-droite-droite', 'Mirrored door model keeps hinge and handle consistent');
  assert.equal(reserveDoorState(vertical, {}).side, 'front', 'The door now faces the aisle');
});

test('a right-hand corner reserve turns along the right wall', () => {
  const rightCorner = twoSquareMetres.map((child) => ({ ...child, x: -child.x, rotation: normalizeDegrees(-child.rotation) }));
  assert.equal(reserveInterior(rightCorner).sides.right, false);
  const vertical = mirrorReserveChildren(rightCorner, 'right', doorCatalog);
  const interior = reserveInterior(vertical);
  assert.equal(reserveOrientation(vertical), 'vertical');
  assert.equal(interior.sides.right, false, 'Right side stays the stand wall');
  assert.equal(interior.sides.back, false, 'Back side stays the stand wall');
  near(interior.depth, 2, 'depth along the right wall');
});

test('door variants are matched on their visible range, not on the asset type', () => {
  const door = reserveDoorChild(twoSquareMetres);
  assert.equal(findDoorHandleVariant(door, 'right', doorCatalog).type, 'door-gauche-droite');
  assert.equal(findMirroredDoorVariant(door, doorCatalog).type, 'door-droite-droite');
  assert.equal(findMirroredDoorVariant(door, []), null);
});
