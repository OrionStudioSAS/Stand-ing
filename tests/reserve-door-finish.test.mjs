import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MeshStandardMaterial, Texture } from 'three';
import { wallFabricColors } from '../src/config/colorOptions.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
function runtime() {
  const api = vm.createContext({ wallFabricColors });
  for (const name of ['normalizeTextValue', 'normalizePackLabel', 'isSignaturePackLabel', 'signatureReserveWallFabricColor', 'reserveDoorColorForPack', 'reserveChildWithFinish', 'normalizedItemText', 'normalizeMaterialName', 'isReserveDoorPaintMaterial', 'materialWithColor', 'signatureArchPaintMaterial']) {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(app.slice(start, app.indexOf('\n}\n', start) + 2), api);
  }
  return api;
}

test('Signature and Equipe reserve doors use the same anthracite as their walls, including legacy Business', () => {
  const api = runtime();
  const color = wallFabricColors.find((color) => color.code === '3026').hex;
  for (const label of ['Signature', 'Équipé', 'Equipé', 'EQUIPE', 'Business']) assert.equal(api.reserveDoorColorForPack(label), color);
  for (const label of ['Confort', 'Prestige', '']) assert.equal(api.reserveDoorColorForPack(label), '');
});

test('reserve groups inherit door finish without mutating the catalog or losing child visual options', () => {
  const api = runtime();
  const child = { type: 'porte-gauche', label: 'Porte poussant gauche', options: { ref: '123' } };
  const parent = { options: { reserveDoorColorHex: '#787878' } };
  const renderChild = api.reserveChildWithFinish(child, parent);
  assert.equal(renderChild.options.reserveDoorColorHex, '#787878');
  assert.equal(renderChild.options.ref, '123');
  assert.equal(child.options.reserveDoorColorHex, undefined);
  assert.equal(api.reserveChildWithFinish(child, {}), child);
});

test('only painted door panels/frames are recoloured; handles, locks, glass and unrelated furniture stay intact', () => {
  const api = runtime();
  const door = { label: 'Porte Poussant Gauche (1)', type: 'porte-reserve' };
  for (const name of ['porte_trad', 'menuiserie', 'meshfabric_b01_18cm1', 'white', 'door_leaf']) assert.equal(api.isReserveDoorPaintMaterial(door, name), true, name);
  for (const name of ['metallic_paint_silver', 'aluminum_blurry', 'poignee', 'digicode', 'color_m05', 'glass']) assert.equal(api.isReserveDoorPaintMaterial(door, name), false, name);
  assert.equal(api.isReserveDoorPaintMaterial({ type: 'porte_reserve_droite' }, 'white'), true);
  assert.equal(api.isReserveDoorPaintMaterial({ label: 'Porte Document' }, 'white'), false);
  assert.equal(api.isReserveDoorPaintMaterial({ label: 'Machine a cafe' }, 'white'), false);
  assert.equal(api.isReserveDoorPaintMaterial({ label: 'Reserve monobloc' }, 'porte_trad'), true);
  const original = new MeshStandardMaterial({ color: '#ffffff', map: new Texture(), normalMap: new Texture(), roughness: 0.9 });
  const painted = api.signatureArchPaintMaterial(original, '#787878');
  assert.equal(painted.color.getHexString(), '787878');
  assert.equal(painted.map, null);
  assert.equal(painted.normalMap, null);
  assert.notEqual(original.map, null);
  assert.equal(original.color.getHexString(), 'ffffff');
});

test('monolithic reserves target MeshFabric_B01_18cm_3 without painting other fabric panels', () => {
  const api = runtime();
  const reserve = { label: 'Réserve 2 m² arrière droite', type: 'asset-reserve' };
  for (const name of ['MeshFabric_B01_18cm_3', 'meshfabric_b01_18cm_3', 'MeshFabric_B01_18cm_3.001']) {
    assert.equal(api.isReserveDoorPaintMaterial(reserve, name), true, name);
  }
  for (const name of ['MeshFabric_B01_18cm_1', 'MeshFabric_B01_18cm_30', 'MeshFabric_B01_18cm', 'Metallic_Paint_Silver']) {
    assert.equal(api.isReserveDoorPaintMaterial(reserve, name), false, name);
  }
});
