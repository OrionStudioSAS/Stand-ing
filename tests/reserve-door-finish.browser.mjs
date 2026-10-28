import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__reserve-door-app.jsx');
const pageId = resolve('src/__reserve-door-page.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const materialNames = ['MeshFabric_B01_18cm_3', 'MeshFabric_B01_18cm_1', 'Metallic_Paint_Silver', 'Porte_trad', 'Menuiserie', 'Plastic_Simple_Shiny_Black_2', 'door_paint'];
const model = {
  id: 'reserve', type: 'reserve-model', label: 'Réserve 2 m²', x: -1, z: 0, rotation: 0,
  modelUrl: '/__reserve-door.obj', materialUrl: '/__reserve-door.mtl',
  dimensions: { size: [1, 2, 1], sizeSource: 'manual' }, options: {},
};
const items = [model, {
  id: 'reserve-group', type: 'reserve-group', label: 'Réserve assemblée', x: 1, z: 0, rotation: 0,
  isGroup: true, groupSize: [1, 2, 1],
  children: [{ ...model, id: 'door', type: 'porte-reserve', label: 'Porte réserve poussant gauche', x: 0, z: 0 }],
}];
items.push(...items.map((item) => item.isGroup
  ? { ...item, id: `${item.id}-glb`, z: 1, children: item.children.map((child) => ({ ...child, modelUrl: '/__reserve-door.glb', materialUrl: '' })) }
  : { ...item, id: `${item.id}-glb`, z: 1, modelUrl: '/__reserve-door.glb', materialUrl: '' }));
const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 2, 0, -0.5, 0, 0, 0.5, 2, 0, -0.5, 2, 0]);
const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
const normals = new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat());
const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uv.buffer), Buffer.from(normals.buffer)]);
const gltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: materialNames.map((_, i) => i) }],
  nodes: materialNames.map((name, mesh) => ({ name, mesh })),
  buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: uv.byteLength }, { buffer: 0, byteOffset: positions.byteLength + uv.byteLength, byteLength: normals.byteLength }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 2, 0] }, { bufferView: 1, componentType: 5126, count: 6, type: 'VEC2' }, { bufferView: 2, componentType: 5126, count: 6, type: 'VEC3' }],
  materials: materialNames.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } })),
  meshes: materialNames.map((_, material) => ({ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 }, material }] })),
});
const harness = `
import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { StandScene, WallFabricSurface, Model3D, reserveDoorColorForPack } from '/src/__reserve-door-app.jsx';
import { wallFabricColors } from '/src/config/colorOptions.js';
const items = ${JSON.stringify(items)};
const fabric = wallFabricColors.find((color) => color.code === '3026');
const describe = (material) => ({ type: material.type, hex: material.color.getHexString(), textured: Boolean(material.map),
  emissive: material.emissive?.getHexString(), emissiveIntensity: material.emissiveIntensity,
  roughness: material.roughness, metalness: material.metalness,
  emissiveUsesTexture: material.emissiveMap === material.map,
  repeat: material.map?.repeat.toArray(),
  texel: material.map?.image?.getContext ? Array.from(material.map.image.getContext('2d').getImageData(0, 0, 1, 1).data) : null });
function Probe() {
  useFrame(({ scene }) => {
    const result = [];
    scene.traverse((node) => {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (${JSON.stringify(materialNames)}.includes(material?.name)) {
          result.push({ name: material.name, ...describe(material), flipY: material.map?.flipY });
        }
        if (material && node.parent?.parent?.name === 'wall-fabric-reference') window.wallFabricReference = describe(material);
      }
    });
    window.materials = result;
  });
  return null;
}
function Test() {
  const [pack, setPack] = useState('Signature');
  const [comparison, setComparison] = useState(false);
  const reference = (x = 0) => <group name="wall-fabric-reference"><WallFabricSurface surface={{ width: 1, position: [x,0,0], rotation: 0 }} color={fabric} /></group>;
  if (comparison) return <div style={{ width: 1000, height: 650 }}><Canvas orthographic camera={{ position: [0, 1.25, 5], zoom: 130 }} gl={{ preserveDrawingBuffer: true }}>
    <ambientLight intensity={2} /><directionalLight position={[0,1,4]} intensity={2} /><Probe /><Suspense fallback={null}>
      <group position={[-0.6,0,0]}><Model3D item={{ ...items[0], modelUrl:'/__reserve-door-only.glb', materialUrl:'', options:{ reserveDoorColorHex:reserveDoorColorForPack(pack) } }} /></group>
      {reference(0.6)}
    </Suspense></Canvas></div>;
  return <><button onClick={() => setComparison(true)}>Comparer porte et cloison</button>{['Signature', 'Équipé', 'Confort'].map((name) => <button key={name} onClick={() => setPack(name)}>{name}</button>)}
    <div style={{ width: 1000, height: 650 }}><Canvas camera={{ position: [0, 4, 8] }}>
      <ambientLight intensity={2} /><Probe /><Suspense fallback={null}>
        <StandScene width={6} depth={4} height={2.5} layout="u" items={items}
          selectedId={null} draggingId={null} viewAngle={0} interactive={false}
          reserveWallFabricColor={fabric}
          carpetFootprintEnabled={false} reserveDoorColorHex={reserveDoorColorForPack(pack)} />
        {reference()}
      </Suspense></Canvas></div></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const obj = `mtllib __reserve-door.mtl
v -0.5 0 0
v 0.5 0 0
v 0.5 2 0
v -0.5 2 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
o DoorPanel
usemtl MeshFabric_B01_18cm_3
f 1/1 2/2 3/3 4/4
o OtherPanel
usemtl MeshFabric_B01_18cm_1
f 1 4 3 2
o Handle
usemtl Metallic_Paint_Silver
f 1 2 3
o DoorFrame
usemtl Porte_trad
f 1 2 3
o WoodFrame
usemtl Menuiserie
f 1 2 3
o Skirting
usemtl Plastic_Simple_Shiny_Black_2
f 1 2 3
o OtherPaint
usemtl door_paint
f 1 2 3
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'reserve-door-test',
  resolveId(id) {
    if (id === '/src/__reserve-door-app.jsx') return appId;
    if (id === '/src/__reserve-door-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { StandScene, WallFabricSurface, Model3D, reserveDoorColorForPack };');
    if (id === pageId) return harness;
  },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/__reserve-door-test__') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__reserve-door-page.jsx"></script>');
      } else if (req.url === '/__reserve-door.obj') {
        res.setHeader('Content-Type', 'text/plain'); res.end(obj);
      } else if (req.url === '/__reserve-door.mtl') {
        res.setHeader('Content-Type', 'text/plain');
        res.end(materialNames.map((name) => `newmtl ${name}\nKd 1 1 1\n`).join(''));
      } else if (req.url === '/__reserve-door.glb') {
        res.setHeader('Content-Type', 'model/gltf+json'); res.end(gltf);
      } else if (req.url === '/__reserve-door-only.glb') {
        const single = JSON.parse(gltf);
        single.scenes[0].nodes = [0];
        res.setHeader('Content-Type', 'model/gltf+json'); res.end(JSON.stringify(single));
      } else next();
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-door-test__`);
  let unchangedMaterials;
  for (const pack of ['Confort', 'Signature', 'Équipé', 'Confort', 'Signature']) {
    await page.getByRole('button', { name: pack, exact: true }).click();
    const enabled = pack !== 'Confort';
    await page.waitForFunction((textured) => {
      const doors = window.materials?.filter((material) => material.name === 'MeshFabric_B01_18cm_3');
      return doors?.length === 4 && doors.every((material) => material.hex === 'ffffff' && material.textured === textured)
        && window.wallFabricReference?.textured;
    }, enabled);
    const materials = await page.evaluate(() => window.materials);
    assert.equal(materials.length, 28);
    const panels = materials.filter((material) => material.name === 'MeshFabric_B01_18cm_1');
    assert.equal(panels.length, 4);
    assert.ok(panels.every((material) => material.hex === (enabled ? '787878' : 'ffffff') && !material.textured), 'Reserve partition bodies still use anthracite only on Signature and Equipe');
    const trims = materials.filter((material) => ['Menuiserie', 'Plastic_Simple_Shiny_Black_2'].includes(material.name));
    assert.equal(trims.length, 8);
    assert.ok(trims.every((material) => material.hex === 'ffffff' && !material.textured), 'Door surrounds and skirting stay white even when the reserve has an anthracite frame override');
    const otherMaterials = materials.filter((material) => !['MeshFabric_B01_18cm_3', 'MeshFabric_B01_18cm_1'].includes(material.name));
    unchangedMaterials ??= otherMaterials;
    assert.deepEqual(otherMaterials, unchangedMaterials, 'Hardware and other materials keep their original finish');
    if (enabled) {
      const wall = await page.evaluate(() => window.wallFabricReference);
      const doors = materials.filter((material) => material.name === 'MeshFabric_B01_18cm_3');
      for (const { name, flipY, ...door } of doors) assert.deepEqual(door, wall, 'Door fabric and reserve wall have identical texture and light response');
      assert.deepEqual(doors.map((material) => material.flipY).sort(), [false, false, true, true]);
    }
  }
  await page.getByRole('button', { name: 'Comparer porte et cloison' }).click();
  await page.waitForFunction(() => window.materials?.length === 1 && window.materials[0].textured && window.wallFabricReference?.textured);
  const tones = await page.locator('canvas').evaluate((canvas) => {
    const sample = document.createElement('canvas'); sample.width = canvas.width; sample.height = canvas.height;
    const context = sample.getContext('2d'); context.drawImage(canvas, 0, 0);
    const average = (x) => {
      const data = context.getImageData(x, canvas.height / 2 - 180, 60, 100).data;
      const sum = [0,0,0];
      for (let i=0; i<data.length; i+=4) {
        if (data[i+3] !== 255) throw new Error('Comparison sample must stay inside the opaque fabric panel');
        for(let channel=0; channel<3; channel++) sum[channel] += data[i+channel];
      }
      return sum.map((value) => value / (data.length / 4));
    };
    return { door:average(canvas.width / 2 - 108), wall:average(canvas.width / 2 + 48) };
  });
  await page.screenshot({ path: '/tmp/standing-reserve-fabric-match.png' });
  for(let channel=0; channel<3; channel++) {
    assert.ok(tones.door[channel] < 190, 'Door fabric is visibly anthracite, not white');
    assert.ok(Math.abs(tones.door[channel] - tones.wall[channel]) < 5, `Rendered door/wall tones match: ${JSON.stringify(tones)}`);
  }
  assert.deepEqual(errors, []);
  console.log('Reserve doors: OBJ/MTL + glTF monolithic/grouped models match wall fabric texture and PBR response; other materials and Confort unchanged');
} finally {
  await browser?.close();
  await server.close();
}
