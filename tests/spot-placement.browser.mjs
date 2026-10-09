import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { railFixture, reserveFixture } from './helpers/spotPlacementFixture.mjs';

const virtualApp = resolve('src/__spot-test-app.jsx');
const virtualPage = resolve('src/__spot-test-page.jsx');
const fixture = { ...railFixture, type: 'rail', label: 'Rail LED 3 spots', x: -1.7,
  dimensions: { ...railFixture.dimensions, size: [0.95, 0.15, 0.3] } };
const reserve = reserveFixture();
const harness = `
import React, { useEffect, useMemo, useState, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { StandScene, wallDragPatch, resolveSpotWallAttachments, screenWorldPosition } from '/src/__spot-test-app.jsx';
const rail = ${JSON.stringify(fixture)}, reserve = ${JSON.stringify(reserve)};
function Camera() {
  const { camera, gl } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1.2, -0.5); camera.updateMatrixWorld();
    window.project = (position) => {
      const point = new Vector3(position[0], position[1], position[2] + 0.25).project(camera), rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + (point.x+1)*rect.width/2, y: rect.top + (1-point.y)*rect.height/2 };
    };
  }, [camera, gl]);
  return null;
}
function TestScene() {
  const [mode, setMode] = useState('exhibitor');
  const [items, setItems] = useState([rail, reserve]);
  const [selectedId, setSelectedId] = useState(null), [draggingId, setDraggingId] = useState(null);
  const resolved = useMemo(() => resolveSpotWallAttachments(items, 7, 4, 'u'), [items]);
  useEffect(() => {
    window.rail = resolved[0]; window.position = screenWorldPosition(resolved[0], 7, 4, resolved); window.dragging = draggingId;
  }, [resolved, draggingId]);
  const move = (point) => {
    const patch = wallDragPatch(point, resolved[0], resolved, 7, 4, 'u');
    setItems((current) => [{ ...current[0], ...patch }, current[1]]);
    window.moves = (window.moves || 0) + 1;
  };
  return <><button onClick={() => { setMode('pack'); setItems([rail, reserve]); }}>Pack</button><p>{mode}</p>
    <div style={{ width: 1000, height: 720 }}><Canvas camera={{ position: [0, 4.2, 8], fov: 45 }}>
      <Camera /><ambientLight intensity={2} /><Suspense fallback={null}>
      <StandScene width={7} depth={4} height={2.5} layout="u" items={resolved}
        selectedId={selectedId} setSelectedId={setSelectedId} draggingId={draggingId} setDraggingId={setDraggingId}
        onDragMove={move} viewAngle={0} carpetFootprintEnabled={false} canEditLockedItems />
      </Suspense></Canvas></div></>;
}
createRoot(document.getElementById('root')).render(<TestScene />);
`;
const source = await readFile('src/App.jsx', 'utf8');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'spot-placement-test',
  resolveId(id) {
    if (id === '/src/__spot-test-app.jsx') return virtualApp;
    if (id === '/src/__spot-test-page.jsx') return virtualPage;
  },
  load(id) {
    if (id === virtualApp) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { StandScene, wallDragPatch, resolveSpotWallAttachments, screenWorldPosition };');
    if (id === virtualPage) return harness;
  },
  configureServer(vite) {
    vite.middlewares.use('/__spot-test__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__spot-test-page.jsx"></script>');
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__spot-test__`);
  await page.waitForFunction(() => window.project && window.position);
  // Let Suspense fonts and the scene's hit boxes settle before grabbing the rail.
  await page.waitForTimeout(1500);
  for (const mode of ['exhibitor', 'pack']) {
    if (mode === 'pack') { await page.getByRole('button', { name: 'Pack', exact: true }).click(); await page.waitForTimeout(200); }
    const start = await page.evaluate(() => window.project(window.position));
    const front = await page.evaluate(() => window.project([1.4, 2.43, -0.7]));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForFunction(() => window.dragging === 'spot', { timeout: 5000 });
    await page.mouse.move(front.x, front.y, { steps: 16 });
    await page.mouse.up();
    await page.waitForFunction(() => window.rail.wall.startsWith('object-wall:reserve:'));
    const result = await page.evaluate(() => ({ rail: window.rail, position: window.position, moves: window.moves }));
    assert.equal(result.rail.wallSide, 1);
    assert.ok(result.position[2] >= reserve.bounds.maxZ + 0.15 - 0.002);
    assert.ok(result.moves > 0);
    assert.equal(result.rail.wallSurface.orientation, 'x');
    // The front must not capture pointer rays aimed at the adjacent exterior side.
    const sideGrab = await page.evaluate(() => window.project(window.position));
    const side = await page.evaluate(() => window.project([0.35, 2.43, -1.35]));
    await page.mouse.move(sideGrab.x, sideGrab.y); await page.mouse.down();
    await page.waitForFunction(() => window.dragging === 'spot');
    await page.mouse.move(side.x, side.y, { steps: 16 }); await page.mouse.up();
    await page.waitForFunction(() => window.rail.wallSurface?.orientation === 'z');
    assert.equal(await page.evaluate(() => window.rail.wallSide), -1);
    // Move back into an exposed part of the stand wall in the same real canvas.
    const grab = await page.evaluate(() => window.project(window.position));
    const back = await page.evaluate(() => window.project([-1.4, 2.43, -1.79]));
    await page.mouse.move(grab.x, grab.y); await page.mouse.down();
    await page.waitForFunction(() => window.dragging === 'spot');
    await page.mouse.move(back.x, back.y, { steps: 16 }); await page.mouse.up();
    await page.waitForFunction(() => window.rail.wall === 'back');
    const returned = await page.evaluate(() => window.rail);
    assert.ok(returned.x + 0.475 < reserve.bounds.minX);
    assert.equal(returned.wallSurface, null);
  }
  assert.deepEqual(errors, []);
  console.log('Spots browser: real StandScene pointer capture, native -> reserve front -> reserve side -> native drag, scene/pack contexts OK');
} finally {
  await browser?.close();
  await server.close();
}
