import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const pageId = resolve('src/__ground-test.jsx');
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import PresentationGround from '/src/PresentationGround.jsx';

function Probe() {
  const { gl, scene, camera } = useThree();
  React.useEffect(() => {
    window.groundView = (position, target = [0, 0.7, 0]) => {
      camera.position.set(...position);
      camera.lookAt(...target);
      camera.updateMatrixWorld();
      gl.render(scene, camera);
    };
    window.groundPixels = (points) => {
      gl.render(scene, camera);
      const context = gl.getContext();
      return points.map(([x, z]) => {
        const projected = new Vector3(x, -0.035, z).project(camera);
        const pixel = new Uint8Array(4);
        context.readPixels(
          Math.floor((projected.x + 1) * context.drawingBufferWidth / 2),
          Math.floor((projected.y + 1) * context.drawingBufferHeight / 2),
          1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel
        );
        return [...pixel];
      });
    };
    window.groundInfo = () => ({
      textures: gl.info.memory.textures,
      programsReady: gl.info.programs.every((program) => program.diagnostics?.runnable !== false),
    });
    window.visibleGroundSamples = () => {
      gl.render(scene, camera);
      const context = gl.getContext();
      const pixels = new Uint8Array(context.drawingBufferWidth * context.drawingBufferHeight * 4);
      context.readPixels(0, 0, context.drawingBufferWidth, context.drawingBufferHeight, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let count = 0;
      for (let i = 0; i < pixels.length; i += 32) {
        if (pixels[i] >= 45 && pixels[i] <= 65 && Math.abs(pixels[i] - pixels[i + 1]) <= 1 && Math.abs(pixels[i] - pixels[i + 2]) <= 2) count += 1;
      }
      return count;
    };
    window.groundView([4.5, 4.2, 5.7]);
  }, [gl, scene, camera]);
  return null;
}

function StandFixture() {
  return <group>
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[5, 3]} /><meshStandardMaterial color="#a8a6a2" />
    </mesh>
    <mesh position={[0, 1.25, -1.5]}><boxGeometry args={[5, 2.5, 0.05]} /><meshStandardMaterial color="#eeeeea" /></mesh>
    <mesh position={[-2.5, 1.25, 0]}><boxGeometry args={[0.05, 2.5, 3]} /><meshStandardMaterial color="#ddddda" /></mesh>
    <mesh position={[1, 0.5, 0.6]}><boxGeometry args={[1.2, 1, 0.5]} /><meshStandardMaterial color="#eeeae5" /></mesh>
  </group>;
}

createRoot(document.getElementById('root')).render(
  <Canvas camera={{ position: [4.5, 4.2, 5.7], fov: 48 }} dpr={[1, 1.5]} flat gl={{ preserveDrawingBuffer: true }}>
    <color attach="background" args={['#050506']} />
    <ambientLight intensity={1.42} /><directionalLight position={[3, 7, 4]} intensity={0.72} />
    <PresentationGround />
    {location.search.includes('stand') && <StandFixture />}
    <Probe />
  </Canvas>
);
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'presentation-ground-browser-test',
  resolveId(id) { if (id === '/src/__ground-test.jsx') return pageId; },
  load(id) { if (id === pageId) return harness; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.url.startsWith('/__ground-test__')) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/src/__ground-test.jsx"></script></body></html>');
    });
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__ground-test__`;
  await page.goto(url);
  await page.waitForFunction(() => window.groundInfo?.().programsReady && window.groundPixels);
  await page.evaluate(() => window.groundView([0, 32, 0.001], [0, 0, 0]));
  const colours = await page.evaluate(() => window.groundPixels([[0, 0], [7, 0], [10, 0], [14, 0], [19, 0], [20, 0]]));
  assert.ok(colours[0][0] > 50 && colours[0][0] < 65, 'Charcoal floor keeps its original brightness');
  assert.ok(colours[1][0] > 50, 'No premature fade around the stand');
  assert.ok(colours[2][0] > colours[3][0] && colours[3][0] > colours[4][0], 'Ground fades smoothly towards black');
  assert.deepEqual(colours[5], [5, 5, 6, 255], 'Plane edge is invisible against the backdrop');
  assert.equal((await page.evaluate(() => window.groundInfo())).textures, 0, 'No large ground texture allocated');

  const screenshots = process.env.GROUND_SCREENSHOTS;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  await page.goto(url + '?stand');
  await page.waitForFunction(() => window.groundView);
  for (const [name, position] of [
    ['default', [4.5, 4.2, 5.7]], ['close', [2.8, 1.8, 3.6]],
    ['grazing', [7, 2.5, 9]], ['distant', [12, 9, 15]],
  ]) {
    await page.evaluate((position) => window.groundView(position), position);
    assert.equal((await page.evaluate(() => window.groundInfo())).programsReady, true);
    assert.ok(await page.evaluate(() => window.visibleGroundSamples()) > 100, name + ': floor remains visible');
    if (screenshots) await page.screenshot({ path: resolve(screenshots, name + '.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.groundView([6, 6, 10]));
  assert.ok(await page.evaluate(() => window.visibleGroundSamples()) > 100, 'mobile: floor remains visible');
  if (screenshots) await page.screenshot({ path: resolve(screenshots, 'mobile.png') });
  assert.deepEqual(errors, [], 'No browser or shader compilation errors');
  console.log('Presentation ground browser: charcoal colour, smooth black fade, no texture allocation, close/grazing/distant/mobile rendering OK');
} finally {
  await browser?.close();
  await server.close();
}
