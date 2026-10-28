import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Mesh, BoxGeometry, Vector3 } from 'three';
import { prioritizeUnderArchIntersections } from '../src/scenePicking.js';

test('clicks through an arch ceiling prioritize contained objects, not its solid totem', () => {
  const arch = new Group();
  arch.userData = { standSceneItem: true, archPickBounds: { minX: -1, maxX: 1, minZ: -1.5, maxZ: 1.5 } };
  const roof = new Mesh(new BoxGeometry(2, .1, 3)); arch.add(roof);
  const furniture = new Group(); furniture.userData = { standSceneItem: true, itemId: 'table' };
  const table = new Mesh(new BoxGeometry(1, 1, 1)); furniture.add(table);
  const hits = [{ object: roof, point: new Vector3(0, 3, 0) }, { object: table, point: new Vector3(0, .8, 0) }];
  assert.equal(prioritizeUnderArchIntersections(hits)[0], hits[1]);
  assert.equal(hits[0].object, roof, 'Original intersection list is not mutated');
  const totemHits = [{ ...hits[0], point: new Vector3(0, 1, 0) }, hits[1]];
  assert.equal(prioritizeUnderArchIntersections(totemHits)[0].object, roof);
  const outside = [hits[0], { ...hits[1], point: new Vector3(3, .8, 0) }];
  assert.equal(prioritizeUnderArchIntersections(outside)[0], outside[0]);
});

test('arch picking works with moved/rotated parents and preserves normal occlusion', () => {
  const arch = new Group(); arch.position.set(4, 0, -2); arch.rotation.y = Math.PI / 2;
  arch.userData = { standSceneItem: true, archPickBounds: { minX: -.5, maxX: .5, minZ: -1.5, maxZ: 1.5 } };
  const roof = new Mesh(); arch.add(roof); arch.updateMatrixWorld(true);
  const object = new Group(); object.userData = { standSceneItem: true };
  const roofHit = { object: roof, point: arch.localToWorld(new Vector3(0, 3, 1)) };
  const objectHit = { object, point: arch.localToWorld(new Vector3(0, .5, 1)) };
  assert.equal(prioritizeUnderArchIntersections([roofHit, objectHit])[0], objectHit);
  const normalHits = [objectHit, roofHit];
  assert.equal(prioritizeUnderArchIntersections(normalHits), normalHits);
  assert.deepEqual(prioritizeUnderArchIntersections([]), []);
});
