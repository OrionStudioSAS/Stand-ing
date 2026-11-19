import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// A corner reserve can run along the back wall (horizontal) or along its side wall (vertical).
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature'];
const wall = { type: 'wall-fixture', label: 'Cloison 1x2.5m', is_active: true, model_url: '/__wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const doorLeft = { type: 'door-trad-gauche-poignee-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht + Poignée Gauche', is_active: true, model_url: '/__door.obj', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
const doorMirror = { type: 'door-trad-droite-poignee-droite', label: 'Porte Trad Droite 1000x2500mm Ht + Poignée Droite', is_active: true, model_url: '/__door.obj', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
const child = (id, asset, x, z, rotation) => ({ id, type: asset.type, label: asset.label, modelUrl: asset.model_url, modelSize: asset.dimensions.size, dimensions: asset.dimensions, x, z, rotation });
// Same layout as the catalogue "Réserve 2m² arrière gauche": two partitions on the aisle side, the door on the right.
const children = [child('wall1', wall, 0, 0, 0), child('wall2', wall, -1, 0, 0), child('door', doorLeft, 0.56, -0.528, -90)];
const group = { type: 'reserve-2m2-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children, groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const assets = [wall, doorLeft, doorMirror, group];
const sceneFor = (layout) => ({ id: `reserve-orientation-${layout}`, client_name: 'Test réserve', offer: 'Signature', event_name: 'Test', dimensions: { width: 5, depth: 5 }, layout, items: [], options: {},
  source_payload: { reserveRules: { 'signature-2m2': { includedType: group.type, includedLabel: group.label, options: [] }, large: { includedType: group.type, includedLabel: group.label, options: [] } } } });
const objBox = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp,sceneAllAdminItems}from'/src/__reserve-orientation-app.jsx';
window.orientationBatItems=sceneAllAdminItems;
const params=new URLSearchParams(location.search);const layout=params.get('layout')||'u';
const scenes={u:${JSON.stringify(sceneFor('u'))},back:${JSON.stringify(sceneFor('back'))}};
const saved=params.get('reload')?JSON.parse(sessionStorage.getItem('orientation-scene')||'null'):null;const scene=saved||scenes[layout];
localStorage.setItem('standing-config-intro:'+scene.id,'started');localStorage.setItem('standing-config-tutorial:'+scene.id,'done');
createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={scene} isAdminViewer={false} />);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-orientation-test',
  resolveId(id) { if (id === '/src/__reserve-orientation-app.jsx') return `${root}src/__reserve-orientation-app.jsx`; if (id === '/src/__reserve-orientation-page.jsx') return `${root}src/__reserve-orientation-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-orientation-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,sceneAllAdminItems};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.orientationItems=visibleSceneItems;window.orientationCatalog=availableCatalog;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__reserve-orientation-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-reserve-orientation';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));sessionStorage.setItem('orientation-scene',JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const objects = { '/__wall.obj': objBox(1, 2.5, 0.06), '/__door.obj': objBox(1, 2.5, 0.25) };
    if (objects[req.url]) { res.setHeader('Content-Type', 'text/plain'); return res.end(objects[req.url]); }
    if (!req.url.startsWith('/__reserve-orientation-test__')) return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reserve-orientation-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__reserve-orientation-test__`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const reserveState = () => page.evaluate(async () => {
    const geometry = await import('/src/reserveConfigurator.js');
    const reserve = window.orientationItems.find((item) => item.autoReserve);
    const interior = geometry.reserveInterior(reserve.children);
    return { orientation: reserve.options.reserveOrientation || '', width: interior.width, depth: interior.depth, sides: interior.sides,
      door: geometry.reserveDoorChild(reserve.children).type, doorSide: geometry.reserveDoorState(reserve.children, {}).side,
      minX: reserve.x + interior.minX, minZ: reserve.z + interior.minZ };
  });
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} ≠ ${expected}`);

  await page.goto(`${base}?layout=u`);
  await page.evaluate(() => sessionStorage.clear());
  await page.waitForFunction(() => window.orientationItems?.some((item) => item.autoReserve));
  let state = await reserveState();
  assert.equal(state.orientation, '');
  near(state.width, 2, 'Authored reserve runs along the back wall'); near(state.depth, 1, 'Authored depth');
  await page.getByRole('button', { name: /^Réserve/ }).first().click();
  const vertical = page.getByRole('radio', { name: 'Le long du mur gauche' });
  await vertical.click();
  await page.waitForFunction(() => window.orientationItems.find((item) => item.autoReserve)?.options?.reserveOrientation === 'vertical');
  state = await reserveState();
  near(state.width, 1, 'Vertical width'); near(state.depth, 2, 'Vertical depth along the left wall');
  assert.equal(state.sides.left, false, 'The left stand wall still closes the reserve');
  assert.equal(state.sides.back, false, 'The back stand wall still closes the reserve');
  assert.equal(state.door, doorMirror.type, 'The door is replaced by its mirrored model');
  assert.equal(state.doorSide, 'front');
  assert.ok(state.minX < -2.4, `The reserve stays against the left wall (${state.minX})`);
  assert.ok(state.minZ < -2.4, `The reserve stays against the back wall (${state.minZ})`);
  assert.equal(await vertical.getAttribute('aria-checked'), 'true');

  await page.waitForFunction(() => window.savedScene?.options?.reserveOptions?.orientation === 'vertical');
  const bat = await page.evaluate(() => window.orientationBatItems(window.savedScene, window.orientationCatalog).find((item) => item.autoReserve));
  assert.equal(bat.options.reserveOrientation, 'vertical', 'The BAT rebuilds the same vertical reserve');

  await page.goto(`${base}?layout=u&reload=1`);
  await page.waitForFunction(() => window.orientationItems?.some((item) => item.autoReserve));
  state = await reserveState();
  assert.equal(state.orientation, 'vertical', 'The orientation is kept after reloading the scene');
  near(state.depth, 2, 'Still vertical after reload');

  await page.goto(`${base}?layout=back`);
  await page.waitForFunction(() => window.orientationItems?.some((item) => item.autoReserve));
  await page.getByRole('button', { name: /^Réserve/ }).first().click();
  assert.equal(await page.getByRole('radio', { name: 'Le long du mur gauche' }).isDisabled(), true, 'No left wall: the vertical reserve cannot be chosen');
  assert.deepEqual(errors, []);
  console.log('Reserve orientation: along the back or the side wall, mirrored door, saved, reloaded and rebuilt for the BAT OK');
} finally {
  await browser?.close();
  await server.close();
}
