import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MeshPhongMaterial, MeshStandardMaterial, Texture } from 'three';
import { wallFabricColors } from '../src/config/colorOptions.js';
import { isReserveDoorChild, reserveDoorFit } from '../src/reserveConfigurator.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
function runtime() {
  const api = vm.createContext({ wallFabricColors, MeshStandardMaterial, isReserveDoorChild, reserveDoorFit });
  for (const name of ['normalizeTextValue', 'normalizePackLabel', 'isSignaturePackLabel', 'signatureReserveWallFabricColor', 'reserveDoorColorForPack', 'reserveChildWithFinish', 'reserveDoorFitForChild', 'isReserveSceneItem', 'isAutomaticReserveItem', 'normalizedItemText', 'normalizeMaterialName', 'isReserveDoorPaintMaterial', 'isReserveFramePaintMaterial', 'colorHex', 'wallFabricMaterialProps', 'reserveDoorFabricColor', 'reserveDoorFabricMaterial']) {
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
  assert.equal(renderChild.options.reserveFrameColorHex, '#787878');
  assert.equal(api.reserveChildWithFinish({label:'Cloison',options:{}},parent).options.reserveFrameColorHex, '#787878');
  assert.equal(api.reserveChildWithFinish({label:'Bloc étagères',options:{}},parent).options.reserveFrameColorHex, undefined);
  assert.equal(api.reserveChildWithFinish({label:'Porte documents',options:{}},parent).options.reserveFrameColorHex, undefined);
  assert.equal(child.options.reserveDoorColorHex, undefined);
  assert.equal(api.reserveChildWithFinish(child, {}), child);
});

test('door paint is limited to the requested material, not all panels or door frames', () => {
  const api = runtime();
  assert.equal(api.isReserveDoorPaintMaterial('MeshFabric_B01_18cm_3'), true);
  for (const name of ['porte_trad', 'menuiserie', 'meshfabric_b01_18cm1', 'white', 'door_leaf', 'door_paint', 'default', 'metallic_paint_silver', 'aluminum_blurry', 'poignee', 'digicode', 'color_m05', 'glass']) {
    assert.equal(api.isReserveDoorPaintMaterial(name), false, name);
  }
});

test('monolithic reserves target MeshFabric_B01_18cm_3 without painting other fabric panels', () => {
  const api = runtime();
  for (const name of ['MeshFabric_B01_18cm_3', 'meshfabric_b01_18cm_3']) {
    assert.equal(api.isReserveDoorPaintMaterial(name), true, name);
  }
  for (const name of ['MeshFabric_B01_18cm_1', 'MeshFabric_B01_18cm_30', 'MeshFabric_B01_18cm_3.001', 'MeshFabric_B01_18cm_3#1', 'MeshFabric_B01_18cm', 'Metallic_Paint_Silver']) {
    assert.equal(api.isReserveDoorPaintMaterial(name), false, name);
  }
});

test('reserve frame paint targets partition bodies but never door surrounds or skirting', () => {
  const api = runtime();
  for (const name of ['MeshFabric_B01_18cm_1', 'meshfabric_b01_18cm1', 'MeshFabric_B01_18cm_1.001']) {
    assert.equal(api.isReserveFramePaintMaterial(name), true, name);
  }
  for (const name of ['Menuiserie', 'Menuiserie.001', 'Plastic_Simple_Shiny_Black_2', 'Plastic_Simple_Shiny_Black_2.002', 'MeshFabric_B01_18cm_3', 'Porte_trad', 'Metallic_Paint_Silver']) {
    assert.equal(api.isReserveFramePaintMaterial(name), false, name);
  }
});

test('door fabric uses the reserve wall texture and PBR light response, not smooth imported paint', () => {
  const api = runtime();
  const color = wallFabricColors.find((color) => color.code === '3026');
  const texture = new Texture();
  const item = { options: { reserveDoorColorHex: color.hex } };
  assert.equal(api.reserveDoorFabricColor(item).image, color.image);
  assert.equal(api.reserveDoorFabricColor({}), null);
  for (const Original of [MeshPhongMaterial, MeshStandardMaterial]) {
    const oldMap = new Texture();
    const original = new Original({ name: 'MeshFabric_B01_18cm_3', color: '#ffffff', map: oldMap, normalMap: new Texture() });
    const door = api.reserveDoorFabricMaterial(original, item, texture);
    const wall = new MeshStandardMaterial(api.wallFabricMaterialProps(color, texture));
    for (const field of ['type', 'roughness', 'metalness', 'emissiveIntensity', 'map', 'emissiveMap', 'normalMap']) assert.equal(door[field], wall[field], field);
    assert.equal(door.color.getHexString(), wall.color.getHexString());
    assert.equal(door.emissive.getHexString(), wall.emissive.getHexString());
    assert.equal(door.name, original.name);
    assert.equal(original.map, oldMap, 'Imported materials remain unchanged');
    assert.notEqual(original.normalMap, null);
    const fallback = api.reserveDoorFabricMaterial(original, item);
    assert.equal(fallback.color.getHexString(), '787878');
    assert.equal(fallback.emissive.getHexString(), '787878');
    assert.equal(fallback.emissiveIntensity, 0.16);
  }
});

test('the door of a reserve carries how the 3D view must show it, other doors do not', () => {
  const api = runtime();
  const wall = { label: 'Cloison Trad 1000x2500mm Ht', modelSize: [1, 2.5, 0.06] };
  const door = { id: 'door', type: 'porte-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht', x: 0.56, z: -0.528, rotation: -90, modelSize: [1, 2.5, 0.25], options: {} };
  const children = [{ ...wall, id: 'w1', x: 0, z: 0, rotation: 0 }, { ...wall, id: 'w2', x: -1, z: 0, rotation: 0 }, door];
  const parent = { autoReserve: true, children, options: { reserveDoorOpening: 'pull', reserveHandleOrientation: 'right' } };
  const fit = api.reserveChildWithFinish(door, parent).options.reserveDoorFit;
  assert.equal(fit.opening, 'pull');
  assert.equal(fit.handle, 'right');
  assert.equal(fit.outward, -1, 'Turned to -90° on the right side, the model faces the inside');
  assert.equal(api.reserveChildWithFinish(children[0], parent).options?.reserveDoorFit, undefined, 'Partitions are left as they are');
  assert.equal(api.reserveChildWithFinish(door, { children, options: {} }), door, 'A door outside a reserve is left as it is');
});
