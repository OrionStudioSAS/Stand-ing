import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReserveDoorChoice, clampFloorContent, configureReserveChildren, contentFootprint, doorFamilyForChoice, doorFamilyFromLabel,
  findDoorHandleVariant, findFreeReserveSpot, isReservePowerSource, reserveDoorFit, RESERVE_DOOR_OFFSET, builtinWallContent,
  childFootprint, boundsOverlap,
  findMirroredDoorVariant, mirrorReserveChildren, normalizeDegrees, reserveOrientation, footprintPolygon, polygonsOverlap,
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
  // The door panel fills the opening 9 cm inside its stored line: its inner face is at 0.56 - 0.09 - 0.03.
  near(interior.maxX, 0.44, 'up to the inner face of the door panel');
  near(interior.width, 1.94, 'width');
  near(interior.depth, 1, 'depth');
  assert.deepEqual(interior.sides, { left: false, right: true, back: false, front: true }, 'Back and left sides are stand walls');
});

test('without any stored choice the walls and builtins stay as authored, the door follows the default opening', () => {
  const configured = configureReserveChildren(twoSquareMetres, {}, doorCatalog);
  assert.deepEqual(configured.filter((child) => child.id !== 'door'), twoSquareMetres.filter((child) => child.id !== 'door'));
  const door = reserveDoorChild(configured);
  const authored = reserveDoorChild(twoSquareMetres);
  assert.deepEqual([door.x, door.z, door.rotation], [authored.x, authored.z, authored.rotation], 'The door keeps its place');
  // Authored door: handle on the left. Default opening: inwards → the other hand of door.
  assert.equal(reserveDoorState(configured, {}).handle, 'left');
  assert.equal(doorFamilyFromLabel(door), 'right');
  assert.equal(reserveDoorChild(applyReserveDoorChoice(twoSquareMetres, { doorOpening: 'pull' }, doorCatalog)).type, authored.type, 'Opening outwards keeps the authored model');
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
  near(door.z - RESERVE_DOOR_OFFSET, target.line, 'its panel sits exactly in the façade line');
  const interior = reserveInterior(moved);
  near(interior.width, 1.94, 'width is preserved');
  near(interior.depth, 1, 'depth is preserved');
  assert.equal(moveReserveDoor(twoSquareMetres, 'missing-slot'), twoSquareMetres);
});

test('each opening and handle uses a catalogue door of the right hand, in place', () => {
  const door = reserveDoorChild(twoSquareMetres);
  // "Porte droite": handle right when it opens outwards, left when it opens inwards; "Porte gauche": the opposite.
  const cases = [['right', 'pull', 'right'], ['left', 'push', 'right'], ['left', 'pull', 'left'], ['right', 'push', 'left']];
  for (const [handle, opening, family] of cases) {
    assert.equal(doorFamilyForChoice(handle, opening), family, `${handle} / ${opening}`);
    const configured = configureReserveChildren(twoSquareMetres, { handleOrientation: handle, doorOpening: opening }, doorCatalog);
    const chosen = reserveDoorChild(configured);
    assert.equal(doorFamilyFromLabel(chosen), family, `${handle} / ${opening}: door hand`);
    assert.match(chosen.label, /\bTrad\b/, 'Same range of door');
    assert.deepEqual([chosen.x, chosen.z, chosen.rotation], [door.x, door.z, door.rotation], 'The door does not move');
    const state = reserveDoorState(configured, {});
    assert.equal(state.handle, handle, 'The handle shown is the one chosen');
    const fit = reserveDoorFit(configured, { handleOrientation: handle, doorOpening: opening });
    assert.equal(fit.childId, 'door');
    // Door turned to -90° on the right side: its local +z points inside the reserve.
    assert.equal(fit.outward, -1);
    assert.equal(fit.swingSign, opening === 'pull' ? -1 : 1);
    assert.equal(fit.handleSign, handle === 'right' ? -1 : 1);
    near(fit.wallZ, RESERVE_DOOR_OFFSET, 'the panel sits on the partition line, inside the stored position');
  }
  // Without a door of the right hand the model is kept (the 3D view mirrors it).
  assert.equal(reserveDoorChild(configureReserveChildren(twoSquareMetres, { handleOrientation: 'left', doorOpening: 'push' }, [])).type, door.type);
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
  near(interior.depth, 1.94, 'depth along the left wall, up to the door panel');
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
  near(interior.depth, 1.94, 'depth along the right wall, up to the door panel');
});

test('door variants are matched on their visible range, not on the asset type', () => {
  const door = reserveDoorChild(twoSquareMetres);
  assert.equal(findDoorHandleVariant(door, 'right', doorCatalog).type, 'door-gauche-droite');
  assert.equal(findMirroredDoorVariant(door, doorCatalog).type, 'door-droite-droite');
  assert.equal(findMirroredDoorVariant(door, []), null);
});

test('collisions use the real outline of rotated objects', () => {
  // Two 1 m × 10 cm boards turned at 45°, side by side: their bounding boxes overlap, their outlines do not.
  const a = footprintPolygon([1, 0.8, 0.1], 0, 0, 45);
  const b = footprintPolygon([1, 0.8, 0.1], 0.3, 0.3, 45);
  assert.equal(polygonsOverlap(a, b), false);
  assert.equal(polygonsOverlap(a, footprintPolygon([1, 0.8, 0.1], 0, 0, -45)), true, 'Crossing boards do overlap');
  assert.equal(polygonsOverlap(footprintPolygon([0.5, 1, 0.5], 0, 0, 0), footprintPolygon([0.5, 1, 0.5], 0.5, 0, 0)), false, 'Touching edges are allowed');
});

test('an object can be turned to any angle inside the reserve', () => {
  const interior = reserveInterior(twoSquareMetres);
  const context = { interior, builtins: reserveBuiltinChildren(twoSquareMetres), door: reserveDoorState(twoSquareMetres, { doorOpening: 'pull' }), contents: [] };
  const cabinet = { key: 'cabinet', mount: 'floor', size: [0.6, 0.85, 0.4], rotation: 30 };
  const placed = findFreeReserveSpot(cabinet, context);
  assert.ok(placed, 'A cabinet turned by 30° finds a place');
  assert.equal(placed.rotation, 30, 'The requested angle is kept');
  assert.deepEqual(reserveContentIssues(placed, context), []);
  const neighbour = findFreeReserveSpot({ key: 'bin', mount: 'floor', size: [0.3, 0.6, 0.3], rotation: 0 }, { ...context, contents: [placed] });
  assert.ok(neighbour);
  assert.deepEqual(reserveContentIssues(neighbour, { ...context, contents: [placed] }), []);
});

test('a hook follows its partition: when the door takes that partition, it moves to a free wall', () => {
  const hook = twoSquareMetres.find((child) => child.id === 'hook');
  for (const centre of [0, -1]) {
    const slot = reserveDoorSlots(twoSquareMetres).find((candidate) => candidate.kind !== 'door' && candidate.side === 'front' && Math.abs(candidate.center - centre) < 0.01);
    for (const doorOpening of ['push', 'pull']) {
      const configured = configureReserveChildren(twoSquareMetres, { doorSlot: slot.id, doorOpening }, doorCatalog);
      const moved = configured.find((child) => child.id === 'hook');
      const interior = reserveInterior(configured);
      const door = reserveDoorState(configured, { doorOpening });
      assert.equal(door.side, 'front', 'The door is now on the façade');
      assert.notDeepEqual([moved.x, moved.z], [hook.x, hook.z], `door at ${centre} (${doorOpening}): the hook leaves the door`);
      const content = builtinWallContent(moved, interior);
      const others = reserveBuiltinChildren(configured).filter((child) => child.id !== 'hook');
      assert.deepEqual(reserveContentIssues(content, { interior, door, builtins: others, contents: [] }), [], 'Free place, not on the door');
      assert.equal(boundsOverlap(childFootprint(moved), door.wallZone), false, 'Not fixed on the door opening');
      // Still fixed on a wall, facing the room.
      const box = childFootprint(moved);
      const onWall = Math.abs(box.minZ - interior.minZ) < 0.002 || Math.abs(box.maxZ - interior.maxZ) < 0.002
        || Math.abs(box.minX - interior.minX) < 0.002 || Math.abs(box.maxX - interior.maxX) < 0.002;
      assert.ok(onWall, 'The hook hangs on a wall');
      assert.ok([0, 90, 180, 270, -90].includes(moved.rotation), 'It faces the room');
    }
  }
  // Without a door move the hook stays exactly where it was authored.
  assert.deepEqual(configureReserveChildren(twoSquareMetres, { doorOpening: 'pull' }, doorCatalog).find((child) => child.id === 'hook'), hook);
});

test('nothing wall-mounted can be fixed on the door, whichever way it opens', () => {
  const interior = reserveInterior(twoSquareMetres);
  const builtins = reserveBuiltinChildren(twoSquareMetres);
  const shelf = { key: 'shelf', mount: 'wall', size: [0.6, 0.3, 0.25] };
  for (const doorOpening of ['push', 'pull']) {
    const door = reserveDoorState(twoSquareMetres, { doorOpening });
    const onDoor = snapWallContent(shelf, { x: interior.maxX, z: (door.hinge.z + door.latch.z) / 2 }, interior);
    assert.equal(onDoor.wall, 'right');
    assert.ok(reserveContentIssues(onDoor, { interior, builtins, door, contents: [] }).includes('door'), `${doorOpening}: not on the door`);
  }
  const pull = reserveDoorState(twoSquareMetres, { doorOpening: 'pull' });
  const onFacade = snapWallContent(shelf, { x: interior.centerX, z: interior.maxZ }, interior);
  assert.ok(!reserveContentIssues(onFacade, { interior, builtins: [], door: pull, contents: [] }).includes('door'), 'A partition away from the door is fine');
});
