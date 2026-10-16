import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__cover-head-app.jsx');
const pageId = resolve('src/__cover-head-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const source = await readFile('src/App.jsx', 'utf8');
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#d52f3a"/></svg>');
const fixtures = ['Signature', 'Équipé'].map((offer) => ({
  id: 'cover-head-test', offer, salon: 'Test', project_name: 'Bâches et têtes', client_status: 'draft',
  layout: 'u', dimensions: { width: 5, depth: 4 },
  options: { ledRailsEnabled: false, wallCovers: Object.fromEntries(['back', 'left', 'right'].map((wall) => [wall, { enabled: true, previewUrl: art }])) },
  source_payload: {},
  items: ['left', 'right'].map((side, index) => ({
    id: `head-${side}`, type: `head-${side}`, isWallItem: true, rotation: 0,
    label: offer === 'Signature' ? 'Tete De Cloison - Signature' : `Tete De Cloison SIAE ${side === 'left' ? 'Gauche' : 'Droite'}`,
    wall: offer === 'Signature' ? side : 'back', x: offer === 'Signature' ? 1.3 : index === 0 ? -2.4 : 2.4,
    dimensions: { size: offer === 'Signature' ? [0.2, 2.4, 1.4] : [1.11, 2.99, 0.11] }, options: {},
  })),
}));
const probe = `
  useFrame(({ scene }) => {
    const planes = [];
    scene.traverse((node) => {
      if (node.geometry?.type === 'PlaneGeometry' && node.material?.polygonOffsetFactor === -4) {
        planes.push({ width: node.geometry.parameters.width, position: node.parent.position.toArray() });
      }
    });
    window.coverPlanes = planes;
  });
`;
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfiguratorApp, withTechnicalOptionsMarker } from '/src/__cover-head-app.jsx';
window.technicalMarker = withTechnicalOptionsMarker;
const fixtures = ${JSON.stringify(fixtures)};
localStorage.setItem('standing-config-intro:cover-head-test', 'started');
localStorage.setItem('standing-config-tutorial:cover-head-test', 'done');
function Test() {
  const [scene, setScene] = useState(fixtures[0]), [revision, setRevision] = useState(0);
  return <><div style={{ position:'fixed', left:0, bottom:0, zIndex:9999 }}>
    {fixtures.map((fixture) => <button key={fixture.offer} onClick={() => { setScene(fixture); setRevision((n) => n+1); }}>{fixture.offer}</button>)}
    <button onClick={() => { setScene(JSON.parse(JSON.stringify(window.savedScene))); setRevision((n) => n+1); }}>Reouvrir</button>
  </div><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer /></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'cover-head-clearance-test',
  resolveId(id) { if (id === '/src/__cover-head-app.jsx') return appId; if (id === '/src/__cover-head-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source
      .replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp, withTechnicalOptionsMarker };')
      .replace('  const sceneItems = useMemo(', '  window.coverSurfaces = wallCoverSurfaces;\n  const sceneItems = useMemo(')
      .replace('  const [hoveredId, setHoveredId] = useState(null);', `${probe}\n  const [hoveredId, setHoveredId] = useState(null);`);
    if (id === pageId) return harness;
    if (id === storeId) return `export * from '/src/data/sceneStore.js?cover-head-original';
      export async function listObjectBank() { return []; }
      export async function saveScene(scene) { window.savedScene = JSON.parse(JSON.stringify(scene)); return scene; }`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__cover-head-test__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__cover-head-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__cover-head-test__`);
  for (const offer of ['Signature', 'Équipé']) {
    await page.getByRole('button', { name: offer, exact: true }).click();
    const expected = offer === 'Signature' ? { back: 4.88, left: 2.54, right: 2.54 } : { back: 3.69, left: 4, right: 4 };
    await page.waitForFunction((expected) => window.coverSurfaces?.length === 3 && window.coverSurfaces.every((surface) => Math.abs(surface.width - expected[surface.id]) < 1e-8), expected).catch(async (error) => {
      console.error(JSON.stringify(await page.evaluate(() => ({ surfaces:window.coverSurfaces, planes:window.coverPlanes })), null, 2));
      throw error;
    });
    const checkGeometry = async () => {
      await page.waitForFunction(() => window.coverPlanes?.length === 3 && window.coverSurfaces.every((surface) => window.coverPlanes.some((plane) => Math.abs(plane.width - surface.width) < 1e-8 && Math.abs(plane.position[0] - surface.position[0]) < 1e-8 && Math.abs(plane.position[2] - surface.position[2]) < 1e-8)));
    };
    await checkGeometry();
    await page.getByRole('button', { name: /^Cloison/ }).click();
    await page.locator('.wall-cover-pending input').first().check();
    await page.waitForFunction((offer) => window.savedScene?.offer === offer && Object.values(window.savedScene.options.wallCovers).some((cover) => cover.visualPending), offer);
    const bat = await page.evaluate(() => {
      const marker = window.technicalMarker(window.savedScene.items, window.savedScene).find((item) => item.type === '__technical-options__');
      return marker.sourceVisualSurfaces.map(({ id, width, position }) => ({ id, width, position }));
    });
    for (const surface of bat) assert.ok(Math.abs(surface.width - expected[surface.id]) < 1e-8, 'BAT uses the same clipped width as the 3D scene');
    assert.equal(bat.length, 3);
    await page.getByRole('button', { name: 'Reouvrir', exact: true }).click();
    await checkGeometry();
  }
  assert.deepEqual(errors, []);
  console.log('Wall covers: Signature/Equipe head clearance matches rendered geometry, saved/reopened scene and BAT surfaces');
} finally { await browser?.close(); await server.close(); }
