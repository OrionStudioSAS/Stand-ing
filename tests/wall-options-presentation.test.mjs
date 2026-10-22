import assert from 'node:assert/strict';
import test from 'node:test';
import { wallOptionsMapGeometry, wallCoverPrintSize } from '../src/wallOptionsPresentation.js';

const surfaces = [
  { id: 'back-left', width: 2.48, height: 2.5, position: [-1.25, 1.25, -2], rotation: 0 },
  { id: 'back-right', width: 2.4, height: 2.5, position: [1.25, 1.25, -2], rotation: 0 },
  { id: 'reserve-exterior', width: 1.96, visibleWidth: 2, height: 2.5, position: [1.5, 1.25, -1], rotation: 0 },
];

test('the isometric map preserves eligible surface identities, coordinates and stable numbering', () => {
  const before = structuredClone(surfaces);
  const map = wallOptionsMapGeometry(surfaces, 5, 4);
  assert.equal(map.floor.length, 4);
  assert.equal(map.planes.length, surfaces.length);
  for (const plane of map.planes) {
    assert.equal(plane.id, surfaces[plane.number - 1].id);
    assert.equal(plane.points.length, 4);
    for (const [x, y] of [...plane.points, plane.center]) { assert.ok(Number.isFinite(x) && x >= 0 && x <= 320); assert.ok(Number.isFinite(y) && y >= 0 && y <= 208); }
  }
  assert.deepEqual(surfaces, before, 'The view never alters wall, reserve or door placement');
  assert.ok(map.planes.every((plane) => surfaces.some((surface) => surface.id === plane.id)), 'No additional or forbidden faces are invented');
});

test('the map adapts to empty, narrow, deep and incomplete layouts without invalid SVG coordinates', () => {
  for (const [width, depth] of [[2, 8], [12, 2], [5, 4], [0, 0], [Infinity, undefined]]) {
    for (const list of [[], surfaces, surfaces.slice(0, 1)]) {
      const map = wallOptionsMapGeometry(list, width, depth);
      assert.ok([...map.floor, ...map.planes.flatMap((plane) => [...plane.points, plane.center])].flat().every(Number.isFinite));
    }
  }
  assert.notDeepEqual(wallOptionsMapGeometry(surfaces, 5, 4).floor, wallOptionsMapGeometry(surfaces, 10, 2).floor);
});

test('print dimensions use the real banner plane, not rounded commercial billing metres', () => {
  assert.deepEqual(wallCoverPrintSize({ width: 2.48, visibleWidth: 2, height: 2.5 }), { widthMm: 2480, heightMm: 2500 });
  assert.deepEqual(wallCoverPrintSize({ width: 1.96, visibleWidth: 2, height: 2.5 }), { widthMm: 1960, heightMm: 2500 });
  assert.deepEqual(wallCoverPrintSize({}), { widthMm: 0, heightMm: 0 });
});
