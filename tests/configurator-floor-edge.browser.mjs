import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const app = resolve('src/__floor-edge-app.jsx');
const entry = resolve('src/__floor-edge-entry.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const harness = `
import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { StandScene, floorDragPatch, updateSceneItemWithCollision, itemPlacementBounds } from '/src/__floor-edge-app.jsx';
const counter = { id: 'counter', type: 'counter', label: 'Banque accueil', x: 0, y: 0, z: 0, rotation: 0,
  dimensions: { placementBounds: { minX: -.575, maxX: .575, minZ: -.33, maxZ: .225, height: 1.01 } } };
function Camera() {
  const { camera, gl } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    window.project = ([x,y,z]) => {
      const p = new Vector3(x,y,z+.25).project(camera), r = gl.domElement.getBoundingClientRect();
      return { x: r.left+(p.x+1)*r.width/2, y: r.top+(1-p.y)*r.height/2 };
    };
  }, [camera, gl]);
  return null;
}
function Test() {
  const [items, setItems] = useState([counter]);
  const [selected, select] = useState(null), [dragging, drag] = useState(null);
  const item = items[0];
  window.pose = { x: item.x, z: item.z, front: item.z + itemPlacementBounds(item).maxZ, dragging };
  return <><button onClick={() => setItems([{...counter, rotation: 90}])}>Tourner</button>
    <div style={{width:1000,height:720}}><Canvas camera={{position:[0,4.2,8],fov:45}}>
      <Camera/><ambientLight intensity={2}/><Suspense fallback={null}>
        <StandScene width={6} depth={4} height={2.5} layout="back" items={items}
          selectedId={selected} setSelectedId={select} draggingId={dragging} setDraggingId={drag}
          onDragMove={point => setItems(current => updateSceneItemWithCollision(current, item.id, floorDragPatch(point, current[0], 6, 4, 'back', false), 6, 4, 'back', false))}
          viewAngle={0} carpetFootprintEnabled={false}/>
      </Suspense></Canvas></div></>;
}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'floor-edge-test',
  resolveId(id) { if (id === '/src/__floor-edge-app.jsx') return app; if (id === '/src/__floor-edge-entry.jsx') return entry; },
  load(id) {
    if (id === app) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { StandScene, floorDragPatch, updateSceneItemWithCollision, itemPlacementBounds };');
    if (id === entry) return harness;
  },
  configureServer(vite) { vite.middlewares.use('/__floor-edge__', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<div id="root"></div><script type="module" src="/src/__floor-edge-entry.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__floor-edge__`);
  await page.waitForFunction(() => window.project && window.pose);
  await page.waitForTimeout(1500);
  for (const [rotation, initialGrab, movement] of [[0, [0, 1.01, -.08], 1.775], [90, [-.08, 1.01, 0], 1.425]]) {
    if (rotation) await page.getByRole('button', { name: 'Tourner' }).click();
    const points = await page.evaluate(({ initialGrab, movement }) => [0, .12, movement].map((dz) => window.project([initialGrab[0], initialGrab[1], initialGrab[2] + dz])), { initialGrab, movement });
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.waitForFunction(() => window.pose.dragging === 'counter', null, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message}; grab ${JSON.stringify(points[0])}; ${errors.join('; ')}`);
    });
    await page.mouse.move(points[1].x, points[1].y);
    await page.waitForFunction(() => Math.abs(window.pose.z - .12) < .02, null, { timeout: 3000 });
    await page.mouse.move(points[2].x, points[2].y, { steps: 12 });
    await page.waitForFunction(() => Math.abs(window.pose.front - 2) < 1e-6, null, { timeout: 3000 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.pose.dragging, null, { timeout: 3000 });
    assert.ok(Math.abs((await page.evaluate(() => window.pose)).front - 2) < 1e-6);
  }
  assert.deepEqual(errors, []);
  console.log('Floor drag: no jump on grab, flush front alignment for both rotations, pointer released');
} finally { await browser?.close(); await server.close(); }
