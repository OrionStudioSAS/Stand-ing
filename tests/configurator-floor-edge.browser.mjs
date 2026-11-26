import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const app = resolve('src/__floor-edge-app.jsx');
const entry = resolve('src/__floor-edge-entry.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const modelDir = process.env.STANDING_FLOOR_EDGE_MODELS;
const models = modelDir ? await Promise.all(['included', 'extra'].map(variant => readFile(resolve(modelDir, `${variant}.glb`)))) : [];
const harness = `
import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Box3, Vector3 } from 'three';
import { StandScene, floorDragPatch, updateSceneItemWithCollision, itemPlacementBounds, constrainItem } from '/src/__floor-edge-app.jsx';
const variant = new URLSearchParams(location.search).get('counter');
const width = variant ? 7.5 : 6, depth = variant ? 2.5 : 4, layout = variant ? 'right' : 'back';
const counter = { id: 'counter', type: 'counter', label: 'Banque accueil', x: 0, y: 0, z: 0, rotation: 0,
  dimensions: { placementBounds: { minX: -.575, maxX: .575, minZ: -.33, maxZ: .225, height: 1.01 } } };
if (variant) {
  const included = variant === 'included';
  Object.assign(counter, { included, x: -2.17, type: ${models.length ? "'asset-counter'" : "'counter'"},
    modelUrl: ${models.length ? "'/__floor-counter-' + variant + '.glb'" : "undefined"},
    dimensions: { size: [included ? 1.04 : 1.54, 1, .48] } });
}
function Camera() {
  const { camera, gl, scene } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    window.project = ([x,y,z]) => {
      const p = new Vector3(x,y,z+.25).project(camera), r = gl.domElement.getBoundingClientRect();
      return { x: r.left+(p.x+1)*r.width/2, y: r.top+(1-p.y)*r.height/2 };
    };
    window.frontBounds = () => {
      let floor, model;
      scene.traverse(node => {
        if (node.geometry?.parameters?.width === width && node.geometry?.parameters?.height === .01) floor = node;
        if (node.userData.itemId === counter.id) model = node.children.find(child => child.isGroup);
      });
      return { floor: floor && new Box3().setFromObject(floor).max.z - .25,
        model: model && new Box3().setFromObject(model).max.z - .25 };
    };
  }, [camera, gl, scene]);
  return null;
}
function Test() {
  const [items, setItems] = useState([counter]);
  const [selected, select] = useState(null), [dragging, drag] = useState(null);
  const item = items[0];
  window.pose = { x: item.x, z: item.z, front: item.z + itemPlacementBounds(item).maxZ, dragging };
  window.presetFront = constrainItem({...counter, placementRule: 'front-left'}, width, depth, layout, !!variant).z + itemPlacementBounds(counter).maxZ;
  return <><button onClick={() => setItems([{...counter, rotation: 90}])}>Tourner</button>
    <div style={{width:1000,height:720}}><Canvas camera={{position:[0,4.2,8],fov:45}}>
      <Camera/><ambientLight intensity={2}/><Suspense fallback={null}>
        <StandScene width={width} depth={depth} height={2.5} layout={layout} items={items}
          selectedId={selected} setSelectedId={select} draggingId={dragging} setDraggingId={drag}
          onDragMove={point => setItems(current => updateSceneItemWithCollision(current, item.id, floorDragPatch(point, current[0], width, depth, layout, !!variant), width, depth, layout, !!variant))}
          viewAngle={0} carpetFootprintEnabled={!!variant}/>
      </Suspense></Canvas></div></>;
}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'floor-edge-test',
  resolveId(id) { if (id === '/src/__floor-edge-app.jsx') return app; if (id === '/src/__floor-edge-entry.jsx') return entry; },
  load(id) {
    if (id === app) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { StandScene, floorDragPatch, updateSceneItemWithCollision, itemPlacementBounds, constrainItem };');
    if (id === entry) return harness;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const index = ['/__floor-counter-included.glb', '/__floor-counter-extra.glb'].indexOf(req.url);
    if (models[index]) {
      res.setHeader('Content-Type', 'model/gltf-binary');
      return res.end(models[index]);
    }
    if (req.url?.split('?')[0] !== '/__floor-edge__') return next();
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
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__floor-edge__`;
  await page.goto(url);
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
    await page.mouse.move(points[1].x, points[1].y, { steps: 4 });
    await page.waitForFunction(() => Math.abs(window.pose.z - .12) < .03, null, { timeout: 3000 }).catch(async (error) => {
      throw new Error(`${error.message}; rotation ${rotation}; pose ${JSON.stringify(await page.evaluate(() => window.pose))}; ${errors.join('; ')}`);
    });
    await page.mouse.move(points[2].x, points[2].y, { steps: 12 });
    await page.waitForFunction(() => Math.abs(window.pose.front - 2) < 1e-6, null, { timeout: 3000 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.pose.dragging, null, { timeout: 3000 });
    assert.ok(Math.abs((await page.evaluate(() => window.pose)).front - 2) < 1e-6);
  }
  for (const variant of ['included', 'extra']) {
    await page.goto(`${url}?counter=${variant}`);
    await page.waitForFunction(() => Number.isFinite(window.frontBounds?.().model));
    const [start, end] = await page.evaluate(() => [0, 1.07].map(z => window.project([-2.17, .98, z])));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForFunction(() => window.pose.dragging === 'counter', null, { timeout: 5000 });
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.pose.dragging, null, { timeout: 3000 });
    if (models.length) await page.waitForFunction(() => {
      const { model, floor } = window.frontBounds();
      return Math.abs(model - floor) < .005;
    }, null, { timeout: 4000 });
    const result = await page.evaluate(() => ({ ...window.frontBounds(), positionFront: window.pose.front, presetFront: window.presetFront }));
    assert.ok(Math.abs(result.positionFront - result.floor) < .001, `${variant}: ${JSON.stringify(result)}`);
    assert.ok(Math.abs(result.presetFront - result.floor) < .001, `${variant}: front preset uses the same edge`);
    if (models.length) assert.ok(Math.abs(result.model - result.floor) < .005, `${variant}: the visible model must be flush, not just its hitbox; ${JSON.stringify(result)}`);
  }
  assert.deepEqual(errors, []);
  console.log('Floor drag: front alignment on straight and corner stands, included/extra counters, preset parity and pointer release');
} finally { await browser?.close(); await server.close(); }
