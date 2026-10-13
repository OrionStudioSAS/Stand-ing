import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__reserve-door-app.jsx');
const pageId = resolve('src/__reserve-door-page.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const model = {
  id: 'reserve', type: 'reserve-model', label: 'Réserve 2 m²', x: -1, z: 0, rotation: 0,
  modelUrl: '/__reserve-door.obj', materialUrl: '/__reserve-door.mtl',
  dimensions: { size: [1, 2, 1], sizeSource: 'manual' }, options: {},
};
const items = [model, {
  id: 'reserve-group', type: 'reserve-group', label: 'Réserve assemblée', x: 1, z: 0, rotation: 0,
  isGroup: true, groupSize: [1, 2, 1],
  children: [{ ...model, id: 'panel', type: 'panel', label: 'Module', x: 0, z: 0 }],
}];
const harness = `
import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { StandScene, reserveDoorColorForPack } from '/src/__reserve-door-app.jsx';
const items = ${JSON.stringify(items)};
function Probe() {
  useFrame(({ scene }) => {
    const result = [];
    scene.traverse((node) => {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (['MeshFabric_B01_18cm_3', 'MeshFabric_B01_18cm_1', 'Metallic_Paint_Silver'].includes(material?.name)) {
          result.push({ name: material.name, hex: material.color.getHexString(), textured: Boolean(material.map) });
        }
      }
    });
    window.materials = result;
  });
  return null;
}
function Test() {
  const [pack, setPack] = useState('Signature');
  return <>{['Signature', 'Équipé', 'Confort'].map((name) => <button key={name} onClick={() => setPack(name)}>{name}</button>)}
    <div style={{ width: 1000, height: 650 }}><Canvas camera={{ position: [0, 4, 8] }}>
      <ambientLight intensity={2} /><Probe /><Suspense fallback={null}>
        <StandScene width={6} depth={4} height={2.5} layout="u" items={items}
          selectedId={null} draggingId={null} viewAngle={0} interactive={false}
          carpetFootprintEnabled={false} reserveDoorColorHex={reserveDoorColorForPack(pack)} />
      </Suspense></Canvas></div></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const obj = `mtllib __reserve-door.mtl
v -0.5 0 0
v 0.5 0 0
v 0.5 2 0
v -0.5 2 0
o DoorPanel
usemtl MeshFabric_B01_18cm_3
f 1 2 3 4
o OtherPanel
usemtl MeshFabric_B01_18cm_1
f 1 4 3 2
o Handle
usemtl Metallic_Paint_Silver
f 1 2 3
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'reserve-door-test',
  resolveId(id) {
    if (id === '/src/__reserve-door-app.jsx') return appId;
    if (id === '/src/__reserve-door-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { StandScene, reserveDoorColorForPack };');
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
        res.end('newmtl MeshFabric_B01_18cm_3\nKd 1 1 1\nnewmtl MeshFabric_B01_18cm_1\nKd 1 1 1\nnewmtl Metallic_Paint_Silver\nKd 1 1 1\n');
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
    const expected = pack === 'Confort' ? 'ffffff' : '787878';
    await page.waitForFunction((hex) => {
      const doors = window.materials?.filter((material) => material.name === 'MeshFabric_B01_18cm_3');
      return doors?.length === 2 && doors.every((material) => material.hex === hex);
    }, expected);
    const materials = await page.evaluate(() => window.materials);
    assert.equal(materials.length, 6);
    const otherMaterials = materials.filter((material) => material.name !== 'MeshFabric_B01_18cm_3');
    unchangedMaterials ??= otherMaterials;
    assert.deepEqual(otherMaterials, unchangedMaterials, 'Walls and hardware keep their original finish');
    assert.ok(materials.every((material) => !material.textured));
  }
  assert.deepEqual(errors, []);
  console.log('Reserve doors: actual OBJ/MTL material on monolithic + grouped reserves, Signature/Equipe/Confort isolation OK');
} finally {
  await browser?.close();
  await server.close();
}
