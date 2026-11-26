import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as placement from '../src/spotPlacement.js';
import { railFixture, reserveFixture, spotFixtureSource } from './helpers/spotPlacementFixture.mjs';

const api = vm.createContext({ ...placement });
vm.runInContext(spotFixtureSource, api);
const width = 7, depth = 4;
const targetsFor = (reserve, rail = railFixture, layout = 'u') => Array.from(api.spotPlacementTargetsForItem(rail, [rail, reserve], width, depth, layout));
const ray = (x, z = 8, dx = 0, dz = -1) => ({ origin: { x, y: 2.3, z }, direction: { x: dx, y: 0, z: dz } });

function assertSafe(target, axis, reserve) {
  const alongX = target.orientation === 'x';
  const x = alongX ? axis : target.normalAxis;
  const z = alongX ? target.normalAxis : axis;
  const dx = alongX ? 0.45 : 0.15, dz = alongX ? 0.15 : 0.45;
  assert.ok(x - dx >= -3.44 - 0.001 && x + dx <= 3.44 + 0.001);
  assert.ok(z - dz >= -1.94 - 0.001 && z + dz <= 2 + 0.001);
  const b = reserve.bounds;
  assert.ok(!(x + dx > b.minX + 0.001 && x - dx < b.maxX - 0.001 && z + dz > b.minZ + 0.001 && z - dz < b.maxZ - 0.001), 'Entire rail stays outside reserve');
}

test('native back-wall gaps exclude reserve interiors and leave clearance for the full LED rail', () => {
  const reserve = reserveFixture();
  const targets = targetsFor(reserve);
  const back = targets.find((target) => target.wall === 'back');
  assert.equal(back.intervals.length, 2);
  assert.ok(back.intervals[0].max <= reserve.bounds.minX - 0.45);
  assert.ok(back.intervals[1].min >= reserve.bounds.maxX + 0.45);
  for (const target of targets) for (const interval of target.intervals) for (const axis of [interval.min, interval.max]) assertSafe(target, axis, reserve);
});

test('reserve rear wall cannot mount a rail behind the stand; front and side faces stay available', () => {
  const targets = targetsFor(reserveFixture());
  const surfaces = targets.filter((target) => target.wallSurface);
  assert.equal(surfaces.length, 3);
  assert.ok(surfaces.every((target) => target.orientation !== 'x' || target.normalAxis > -1));
  assert.ok(surfaces.find((target) => target.orientation === 'z' && target.wallSide === -1));
  assert.ok(surfaces.find((target) => target.orientation === 'z' && target.wallSide === 1));
});

test('left/right corner reserves exclude faces sandwiched against the scene side wall', () => {
  for (const reserve of [reserveFixture(-3.44, -1.44), reserveFixture(1.44, 3.44)]) {
    const targets = targetsFor(reserve);
    assert.equal(targets.filter((target) => target.wallSurface).length, 2);
    for (const target of targets) for (const interval of target.intervals) for (const axis of [interval.min, interval.max]) assertSafe(target, axis, reserve);
  }
});

test('rays select the exterior reserve front/side, not the invisible back wall through the reserve', () => {
  const reserve = reserveFixture();
  const items = [railFixture, reserve];
  for (const pointerRay of [ray(1.5), ray(-5, -1.4, 1, 0), ray(6, -1.4, -1, 0)]) {
    const point = api.wallDragPointFromRay(pointerRay, railFixture, items, width, depth, [0, 0, 0], 'u');
    assert.ok(point?.spotWallTarget.wall.startsWith('object-wall:reserve:'));
    const patch = api.wallDragPatch(point, railFixture, items, width, depth, 'u');
    const target = targetsFor(reserve).find((target) => target.wall === patch.wall && target.wallSide === patch.wallSide);
    assertSafe(target, patch.x, reserve);
  }
});

test('native scene walls are only selectable from their interior side', () => {
  const targets = targetsFor(reserveFixture());
  for (const [wall, outsideRay] of [['back', ray(0, -5, 0, 1)], ['left', ray(-5, 0, 1, 0)], ['right', ray(5, 0, -1, 0)]]) {
    const hit = placement.spotWallTargetFromRay(outsideRay, targets);
    assert.notEqual(hit?.target.wall, wall, 'Outside faces of stand walls are not targets');
  }
  assert.equal(placement.spotWallTargetFromRay(ray(0), targets).target.wall, 'back');
});

test('the reserve front does not extend virtually past its corner and steal side-wall drags', () => {
  const targets = targetsFor(reserveFixture());
  const sideRay = ray(0, 8, 0.35, -9.35);
  const hit = placement.spotWallTargetFromRay(sideRay, targets, { axisPadding: 0.45 });
  assert.equal(hit.target.orientation, 'z');
  assert.equal(hit.target.wallSide, -1);
  assert.ok(hit.target.wallSurface);
});

test('ray projection respects scene pivot and retains the targeted face after pointer offset', () => {
  const reserve = reserveFixture();
  const pointerRay = ray(2.25, 8.25);
  const point = api.wallDragPointFromRay(pointerRay, railFixture, [railFixture, reserve], width, depth, [0.75, 0, 0.25], 'u');
  const offset = api.applyDragPointerOffset(point, { x: 0.2 });
  assert.equal(offset.spotWallTarget, point.spotWallTarget);
  const patch = api.wallDragPatch(offset, railFixture, [railFixture, reserve], width, depth, 'u');
  assert.equal(patch.x, 1.7);
  assert.equal(patch.wall, point.spotWallTarget.wall);
});

test('legacy interior/backside overrides repair on loading in both scene and pack previews', () => {
  const reserve = reserveFixture();
  const rear = api.objectWallSurfaces([reserve]).find((surface) => surface.orientation === 'x' && surface.normalAxis < -1.5);
  for (const rail of [
    { ...railFixture, x: 1.5 },
    { ...railFixture, wall: rear.id, wallSide: -1, wallSurface: rear, x: 1.5 },
  ]) {
    const fixed = api.resolveSpotWallAttachments([rail, reserve], width, depth, 'u')[0];
    const target = targetsFor(reserve).find((candidate) => candidate.wall === fixed.wall && candidate.wallSide === (fixed.wallSide ?? undefined));
    assert.ok(target);
    assertSafe(target, fixed.x, reserve);
    const twice = api.resolveSpotWallAttachments([fixed, reserve], width, depth, 'u')[0];
    assert.deepEqual(api.pickLedRailOverride(twice), api.pickLedRailOverride(fixed));
    assert.equal(fixed.id, rail.id);
    assert.equal(fixed.collisionEnabled, false);
  }
});

test('moving a reserve updates the stored wall surface and keeps valid rail placements stable', () => {
  const reserve = reserveFixture();
  const target = targetsFor(reserve).find((target) => target.wallSurface && target.orientation === 'x');
  const rail = { ...railFixture, ...placement.spotTargetPatch(target, 1.5) };
  const moved = reserveFixture(0.6, 2.6);
  const fixed = api.resolveSpotWallAttachments([rail, moved], width, depth, 'u')[0];
  assert.equal(fixed.wall, rail.wall);
  assert.equal(fixed.wallSurface.centerAxis, 1.6);
  assert.equal(fixed.x, rail.x);
  const poster = { id: 'poster', type: 'poster', wall: 'back', x: 1.5 };
  assert.equal(api.resolveSpotWallAttachments([poster, reserve], width, depth, 'u')[0], poster);
});

test('impossible/narrow mounting surfaces do not accept a rail or cause a drag jump', () => {
  assert.equal(placement.closestSpotWallTarget({ x: 0, z: 0 }, []), null);
  const reserve = reserveFixture();
  const patch = api.wallDragPatch({ x: 20, z: 20 }, railFixture, [railFixture, reserve], width, depth, 'u');
  assert.deepEqual({ ...patch }, {});
  const longRail = { ...railFixture, dimensions: { size: [2.5, 0.1, 0.3] } };
  assert.equal(targetsFor(reserve, longRail).filter((target) => target.wallSurface).length, 0);
});

test('exhibitor, pack preview and BAT reconstruction share the same placement validation', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /const sceneItems = useMemo\(\(\) => resolveSpotWallAttachments/);
  assert.match(app, /return resolveSpotWallAttachments\(applyElectricalClearance\(resolveSurfaceAttachments\(\[\.\.\.presetItems, \.\.\.automaticReserves/);
  assert.match(app, /return resolveTechnicalWallSurfaces\(resolveSpotWallAttachments\(/);
  assert.match(app, /onDragPointer=\{dragFromPointer\}/);
});

const archFixture = (minX, maxX) => ({ id: 'arch', label: 'Arche Signature 3m', x: (minX + maxX) / 2, z: -0.2,
  bounds: { minX, maxX, minZ: -1.97, maxZ: 1.5 }, dimensions: { size: [maxX - minX, 3.64, 3.5] } });
const railAt = (id, x, wall = 'back') => ({ ...railFixture, id, x, wall });
const backRails = (items) => Array.from(api.resolveSpotWallAttachments(items, width, depth, 'u')).filter((item) => item.autoSpot);

test('an arch placed over a rail pushes it to the closest free place', () => {
  const arch = archFixture(-0.6, 0.6);
  const [rail] = backRails([railAt('spot', 0), arch]);
  assert.equal(rail.wall, 'back');
  assert.ok(Math.abs(rail.x) >= 0.6 + 0.45 - 0.001, `rail ${rail.x} must clear the arch`);
  const back = Array.from(api.spotPlacementTargetsForItem(railFixture, [railFixture, arch], width, depth, 'u')).find((target) => target.wall === 'back');
  assert.ok(back.intervals.every(({ min, max }) => max <= -1.05 + 0.001 || min >= 1.05 - 0.001));
});

test('a relocated rail does not land on another rail', () => {
  const arch = archFixture(-0.6, 0.6);
  const rails = backRails([railAt('kept', 1.5), railAt('moved', 0.3), arch]);
  const kept = rails.find((rail) => rail.id === 'kept');
  const moved = rails.find((rail) => rail.id === 'moved');
  assert.equal(kept.x, 1.5, 'A rail already in a free place stays put');
  assert.ok(!(moved.wall === 'back' && Math.abs(moved.x - kept.x) < 0.9 - 0.01), `moved ${moved.wall}@${moved.x} overlaps kept rail`);
  assert.ok(!(moved.wall === 'back' && Math.abs(moved.x) < 1.05 - 0.001));
});

test('wall-mounted partition heads block their wall range', () => {
  const head = { id: 'head', label: 'Tête de cloison gauche', isWallItem: true, wall: 'left', x: 1.4, dimensions: { size: [1.2, 3, 0.11] } };
  const rail = railAt('spot', 1.5, 'left');
  const [placed] = backRails([rail, head]);
  assert.ok(placed.wall !== 'left' || placed.x + 0.45 <= 0.8 + 0.02 + 0.001, `rail ${placed.wall}@${placed.x} overlaps the head`);
});

test('a rail can hang above the reserve door, on the same continuous front as its partition', () => {
  // Real reserve front: a 2.5 m partition and a 1 m door whose 25 cm model sits in front of the line.
  const reserve = reserveFixture(-1, 2.5);
  const frontZ = reserve.children[0].z;
  reserve.children[0] = { id: 'front', label: 'Cloison avant', x: 0.5, z: frontZ, dimensions: { size: [2.5, 2.5, 0.06] } };
  reserve.children.push({ id: 'door', label: 'Porte gauche poignée droite', x: -1.25, z: frontZ + 0.1, dimensions: { size: [1, 2.5, 0.25] } });
  const fronts = Array.from(api.spotPlacementTargetsForItem(railFixture, [railFixture, reserve], width, depth, 'u'))
    .filter((target) => target.wallSurface && target.orientation === 'x');
  assert.equal(fronts.length, 1, 'Door and partition form one front surface');
  const doorCenter = 0.75 - 1.25;
  assert.ok(fronts[0].intervals.some(({ min, max }) => doorCenter >= min && doorCenter <= max), 'A rail centred over the door is allowed');
  const [rail] = backRails([{ ...railFixture, wall: fronts[0].wall, wallSide: 1, x: doorCenter }, reserve]);
  assert.equal(rail.wall, fronts[0].wall);
  assert.ok(Math.abs(rail.x - doorCenter) < 0.06, 'The rail stays above the door');
  const otherFronts = Array.from(api.objectWallSurfaces([reserve])).filter((surface) => surface.orientation === 'x' && surface.normalAxis > -1.5);
  assert.ok(otherFronts.every((surface) => doorCenter < surface.centerAxis - surface.length / 2 || doorCenter > surface.centerAxis + surface.length / 2),
    'Posters, screens and wall covers still do not see the door as a wall');
});

test('a door filling a whole reserve face carries a rail on its partition panel, not in front of its leaf', () => {
  // Real 1 m² reserves: the front is only a 1 m door. Its 25 cm model draws the outline (leaf and
  // handle outside); the 6 cm partition panel sits 3.3 cm from its inner face.
  const reserve = reserveFixture(-0.5, 0.5, -1.94, -0.88);
  const outline = -0.88;
  reserve.children[0] = { id: 'door', label: 'Porte Trad Droite 1000x2500mm Ht', x: 0, z: outline - 0.125 - reserve.z, dimensions: { size: [1, 2.5, 0.25] } };
  const rail = { ...railFixture, dimensions: { size: [0.8, 0.15, 0.3] } };
  const door = Array.from(api.spotPlacementTargetsForItem(rail, [rail, reserve], width, depth, 'u'))
    .find((target) => target.wallSurface && target.orientation === 'x');
  assert.ok(door, 'The door face is a rail target');
  assert.ok(Math.abs(door.wallSurface.normalAxis - (outline - 0.25 + 0.033)) < 0.001, `door panel plane ${door.wallSurface.normalAxis}`);
  assert.ok(door.intervals.some(({ min, max }) => min <= 0 && max >= 0));
  const point = api.wallDragPointFromRay(ray(0.3), rail, [rail, reserve], width, depth, [0, 0, 0], 'u');
  assert.equal(point?.spotWallTarget.wall, door.wall, 'Pointing at the door drags the rail onto it');
});

test('rail slots detect overlap only on the same wall face', () => {
  assert.equal(api.spotSlotsOverlap({ wall: 'back', wallSide: null, min: 0, max: 1 }, { wall: 'back', wallSide: null, min: 0.5, max: 1.5 }), true);
  assert.equal(api.spotSlotsOverlap({ wall: 'back', wallSide: null, min: 0, max: 1 }, { wall: 'left', wallSide: null, min: 0.5, max: 1.5 }), false);
  assert.equal(api.spotSlotsOverlap({ wall: 'back', wallSide: null, min: 0, max: 1 }, { wall: 'back', wallSide: null, min: 1, max: 2 }), false);
});
