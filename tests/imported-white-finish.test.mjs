import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DoubleSide, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, Texture, Vector2 } from 'three';
import { studioWhiteFinishMaterial } from '../src/importedWhiteFinish.js';

test('white OBJ finishes receive the studio environment through PBR without fake emission', () => {
  const map = new Texture(), normalMap = new Texture();
  const material = new MeshPhongMaterial({ name: 'Laminate_D02_120cm_2', color: '#ffffff', map, normalMap, normalScale: new Vector2(.3, .4), side: DoubleSide, shininess: 30 });
  const result = studioWhiteFinishMaterial(material, { label: 'PODIUM BLANC 50x50x100cm HT' });
  assert.ok(result.isMeshStandardMaterial);
  assert.equal(result.metalness, 0);
  assert.equal(result.envMap, null, 'The studio supplies the shared environment');
  assert.equal(result.map, map);
  assert.equal(result.normalMap, normalMap);
  assert.notEqual(result.normalScale, material.normalScale);
  assert.deepEqual(result.normalScale.toArray(), [.3, .4]);
  assert.equal(result.side, DoubleSide);
  assert.equal(result.name, material.name);
  assert.equal(result.emissive.getHexString(), '000000');
  assert.equal(result.color.getHexString(), 'ffffff');
  assert.ok(result.roughness >= .5);
  assert.ok(material.isMeshPhongMaterial, 'The shared original stays unchanged');
  assert.equal(material.shininess, 30);
});

test('colored parts, black finishes, glass and already-PBR/unlit materials are preserved', () => {
  for (const material of [
    new MeshPhongMaterial({ name: 'Black plastic', color: '#222222' }),
    new MeshPhongMaterial({ name: 'Color accent', color: '#1267bd' }),
    new MeshPhongMaterial({ name: 'Glass', color: '#ffffff' }),
    new MeshPhongMaterial({ name: 'Translucent white', color: '#ffffff', opacity: .5, transparent: true }),
    new MeshStandardMaterial({ name: 'White PBR', color: '#ffffff' }),
    new MeshBasicMaterial({ name: 'White luminous panel', color: '#ffffff' }),
  ]) assert.equal(studioWhiteFinishMaterial(material, { label: 'Comptoir blanc' }), material);
  const blackPodium = new MeshPhongMaterial({ name: 'Laminate', color: '#ffffff', map: new Texture() });
  assert.equal(studioWhiteFinishMaterial(blackPodium, { label: 'Podium noir' }), blackPodium);
  const whitePlastic = new MeshPhongMaterial({ name: 'Plastic_Metalic_White', color: '#ffffff' });
  assert.ok(studioWhiteFinishMaterial(whitePlastic, { label: 'Furniture' }).isMeshStandardMaterial);
});

test('plastic and painted finishes are not reclassified and tinted as bare aluminium', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('function isAluminiumMaterial(');
  const api = vm.createContext({});
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
  for (const name of ['Plastic_Metalic_White', 'Plastic_Metalic_Black', 'Metal_Painted_White', 'Laminate', 'Fabric_metallic']) {
    assert.equal(api.isAluminiumMaterial({ name }), false, name);
  }
  for (const name of ['Aluminum_Brushed_5cm', 'Aluminium_Anodized_Clear', 'Metal', 'Brushed steel']) {
    assert.equal(api.isAluminiumMaterial({ name }), true, name);
  }
});

test('electrical white overrides also upgrade legacy grey Phong finishes to studio PBR', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const api = vm.createContext({ studioWhiteFinishMaterial });
  for (const name of ['materialWithColor', 'brightenElectricalMaterial']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
  }
  for (const original of [
    new MeshPhongMaterial({ name: 'Metal_Painted_Red_5cm', color: '#d8d8d8' }),
    new MeshPhongMaterial({ name: 'Alu_tridi', color: '#808080', map: new Texture() }),
    new MeshStandardMaterial({ name: 'Socket', color: '#ffffff', metalness: .5 }),
  ]) {
    const color = original.color.getHexString(), map = original.map;
    const result = api.brightenElectricalMaterial(original);
    assert.ok(result.isMeshStandardMaterial);
    assert.equal(result.color.getHexString(), 'ffffff');
    assert.equal(result.metalness, 0);
    assert.equal(result.emissive.getHexString(), 'ffffff');
    assert.equal(result.emissiveIntensity, .22);
    assert.equal(result.map, null);
    assert.equal(original.color.getHexString(), color, 'Shared source colors remain unchanged');
    assert.equal(original.map, map, 'Shared source textures remain unchanged');
  }
});
