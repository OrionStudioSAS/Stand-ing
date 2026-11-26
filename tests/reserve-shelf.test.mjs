import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyReserveBuiltins, fitsUnderReserveShelf, isReservePowerSource, isWallBuiltin, mirrorReserveChildren, relocateBlockedWallBuiltins,
  reserveContentIssues, reserveInterior,
} from '../src/reserveConfigurator.js';
import { buildPowerStrip, buildShelf, SHELF } from '../scripts/generate-reserve-shelf-models.mjs';
import { Box3 } from 'three';

// Reserve shelving + power strip: two catalogue objects grouped in the reserve, the strip on the top shelf.
const wall = { label: 'Cloison Trad 1000x2500mm Ht', modelSize: [1, 2.5, 0.06], dimensions: { size: [1, 2.5, 0.06] } };
const shelf = { id: 'asset-shelf-child-5', type: 'obj-etagere-reserve-frigo', label: 'Étagère réserve (frigo dessous)', modelSize: [0.7, 2, 0.65],
  dimensions: { size: [0.7, 2, 0.65], reserveShelf: true, topSurfaceY: 2 }, x: 0, y: 0, z: -1.149, rotation: 0 };
// Catalogue "Bloc 3 Étagères" (95 × 180 × 32.5 cm), open below its bottom shelf: 86 cm wide, 92 cm high.
const bloc = { id: 'bloc', type: 'asset-bloc-3-etageres-1-muwrjruf', label: 'Bloc 3 Étagères', modelSize: [0.95, 1.8, 0.33],
  dimensions: { size: [0.95, 1.8, 0.33], reserveShelf: true, topSurfaceY: 1.8, freeUnder: { width: 0.86, height: 0.92 } } };
const strip = { id: 'asset-strip-child-6', type: 'obj-multiprise-6-prises', label: 'Multiprise 6 prises', modelSize: [0.47, 0.055, 0.065],
  dimensions: { size: [0.47, 0.055, 0.065], mountType: 'shelf' }, x: 0, y: 2, z: -1.349, rotation: 0 };
// "Réserve 2m2 centre arrière" (object_bank), Bloc 3 Étagères + Triplette replaced by the shelf + strip.
const children = [
  { ...wall, id: 'w1', x: 0.53, z: -1, rotation: 90 }, { ...wall, id: 'w2', x: -0.53, z: 0, rotation: 90 },
  { ...wall, id: 'w3', x: -0.53, z: -1, rotation: 90 }, { ...wall, id: 'w4', x: 0.53, z: 0, rotation: 90 },
  { id: 'door', label: 'Porte Trad Gauche 1000x2500mm Ht + Poignée Droite', modelSize: [1, 2.5, 0.25], x: 0, z: 0.56, rotation: 0 },
  shelf, strip,
];

test('the strip is a shelf object: not wall-mounted, never moved to a partition, still a power source', () => {
  assert.equal(isWallBuiltin(strip), false);
  assert.equal(isReservePowerSource(strip), true);
  assert.deepEqual(relocateBlockedWallBuiltins(children, { doorOpening: 'push' }).find((c) => c.id === strip.id), strip);
});

test('the strip follows its shelf when the shelf moves or turns, and leaves with it', () => {
  const moved = applyReserveBuiltins(children, { [shelf.id]: { x: 0.1, z: -1.0, rotation: 90 } }).find((c) => c.id === strip.id);
  // 20 cm behind the shelf centre in the shelf frame: after a quarter turn, 20 cm towards -x.
  assert.ok(Math.abs(moved.x - (0.1 - 0.2)) < 1e-6 && Math.abs(moved.z - -1.0) < 1e-6, JSON.stringify(moved));
  assert.equal(moved.rotation, 90);
  assert.equal(moved.y, 2);
  // Moving the strip alone is ignored; removing the shelf removes the strip.
  assert.deepEqual(applyReserveBuiltins(children, { [strip.id]: { x: 0.4 } }).find((c) => c.id === strip.id), strip);
  assert.equal(applyReserveBuiltins(children, { [shelf.id]: { removed: true } }).some((c) => c.id === strip.id), false);
});

test('the strip takes no floor room of its own and mirrors with its shelf', () => {
  const interior = reserveInterior(children);
  const content = { key: 'c', mount: 'floor', size: [0.3, 0.5, 0.3], u: 0.2 - interior.minX, v: -0.3 - interior.minZ };
  assert.deepEqual(reserveContentIssues(content, { interior, builtins: [strip] }), []);
  const mirrored = mirrorReserveChildren(children, 'left');
  const [s, p] = [shelf.id, strip.id].map((id) => mirrored.find((c) => c.id === id));
  assert.equal(p.rotation, s.rotation);
});

test('the shelf leaves a 240 L fridge bay (≥ 60 cm wide, ≥ 146 cm high, ≥ 60 cm deep) and the strip lies on top', () => {
  const object = buildShelf();
  object.updateMatrixWorld(true);
  let lowestAbove = Infinity;
  let halfWidth = Infinity;
  object.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const box = new Box3().setFromObject(mesh);
    if (box.min.y > 1) lowestAbove = Math.min(lowestAbove, box.min.y);
    else if (box.max.y > 0.02) halfWidth = Math.min(halfWidth, Math.abs(box.min.x), Math.abs(box.max.x));
  });
  assert.ok(lowestAbove >= 1.5 - 1e-6, `free height ${lowestAbove}`);
  assert.ok(2 * halfWidth >= 0.64 - 1e-6, `free width ${2 * halfWidth}`);
  assert.ok(SHELF.depth >= 0.625);
  const top = new Box3().setFromObject(object).max.y;
  assert.ok(Math.abs(top - SHELF.height) < 1e-6);
  const powerStrip = buildPowerStrip();
  powerStrip.updateMatrixWorld(true);
  assert.ok(Math.abs(new Box3().setFromObject(powerStrip).min.y) < 1e-6);
});

test('the 140 L fridge fits under "Bloc 3 Étagères", the 220 L does not, nor a fridge across an upright', () => {
  // Same back corner as the catalogue "Réserve 1m2 arrière droite": shelf along the right wall (rotation 90).
  const reserve = [{ ...wall, id: 'w', x: 0, z: 0.5, rotation: 0 }, { ...wall, id: 'w2', x: 0, z: -0.5, rotation: 0 }, { ...bloc, x: 0.3, z: 0, rotation: 90 }];
  const interior = { minX: -0.5, maxX: 0.47, minZ: -0.47, maxZ: 0.47, width: 0.97, depth: 0.94 };
  const at = (size, x, z, rotation) => ({ key: 'f', mount: 'floor', size, rotation, u: x - interior.minX, v: z - interior.minZ });
  const shelf = reserve[2];
  const fridge140 = at([0.63, 0.86, 0.56], 0.47 - 0.28, 0, 90); // back against the right wall, under the shelf
  assert.equal(fitsUnderReserveShelf(fridge140, shelf, interior), true);
  assert.deepEqual(reserveContentIssues(fridge140, { interior, builtins: [shelf] }), []);
  assert.equal(fitsUnderReserveShelf(at([0.63, 1.1, 0.56], 0.19, 0, 90), shelf, interior), false);
  assert.deepEqual(reserveContentIssues(at([0.63, 1.1, 0.56], 0.19, 0, 90), { interior, builtins: [shelf] }), ['overlap']);
  assert.equal(fitsUnderReserveShelf(at([0.63, 0.86, 0.56], 0.19, 0.2, 90), shelf, interior), false);
});
