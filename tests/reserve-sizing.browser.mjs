import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const wall = { type: 'wall-fixture', label: 'Cloison 1x2.5m', is_active: true, model_url: '/__reserve-wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const door = { type: 'door-fixture', label: 'Porte gauche', is_active: true, model_url: '/__reserve-door.obj', dimensions: { size: [1, 2.5, 0.25], depthLocked6cm: true, packs: [] } };
const shelf = { type: 'shelf-fixture', label: 'Étagère incluse', is_active: true, model_url: '/__reserve-shelf.obj', dimensions: { size: [0.3, 1, 0.3], packs: [] } };
const children = [
  { id: 'wall1', type: wall.type, label: wall.label, modelUrl: wall.model_url, modelSize: wall.dimensions.size, dimensions: wall.dimensions, x: -0.5, z: 0.5, rotation: 0 },
  { id: 'wall2', type: wall.type, label: wall.label, modelUrl: wall.model_url, modelSize: wall.dimensions.size, dimensions: wall.dimensions, x: 0.5, z: 0.5, rotation: 0 },
  { id: 'door', type: door.type, label: door.label, modelUrl: door.model_url, modelSize: door.dimensions.size, dimensions: { ...door.dimensions, depthLocked6cm: false }, x: 0.905, z: 0, rotation: -90 },
  { id: 'shelf', type: shelf.type, label: shelf.label, modelUrl: shelf.model_url, modelSize: shelf.dimensions.size, dimensions: shelf.dimensions, x: -0.5, z: 0, rotation: 0 },
];
const group = { type: 'reserve-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children, groupSize: [2, 2.5, 1], packs: ['Signature', 'Équipé'], placementRule: { id: 'back-left', locked: true } } };
const assets = [wall, door, shelf, group];
const rule = { includedType: group.type, includedLabel: group.label, options: [] };
const scene = { id: 'reserve-browser', client_name: 'Test réserve', offer: 'Signature', event_name: 'Test', dimensions: { width: 8, depth: 4 }, layout: 'left', items: [], options: {}, source_payload: { reserveRules: { 'signature-2m2': rule, large: rule } } };
const harness = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp}from'/src/__reserve-sizing-app.jsx';
const original=${JSON.stringify(scene)};function Test(){const[scene,setScene]=useState(original);const[key,setKey]=useState(0);return <><div style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}><button onClick={()=>{setScene(window.savedScene);setKey(v=>v+1)}}>Reouvrir réserve</button><button onClick={()=>{setScene({...original,offer:'Équipé'});setKey(v=>v+1)}}>Pack Équipé test</button></div><ConfiguratorApp key={key} initialScene={scene} isAdminViewer /></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const box = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-sizing-test',
  resolveId(id) { if (id === '/src/__reserve-sizing-app.jsx') return `${root}src/__reserve-sizing-app.jsx`; if (id === '/src/__reserve-sizing-page.jsx') return `${root}src/__reserve-sizing-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-sizing-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp};').replace('  const estimatedTotal = scenePricing.total;', '  window.reserveTestItems=visibleSceneItems;window.reserveTestPricing=scenePricing;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__reserve-sizing-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-reserve-test';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const objects = { '/__reserve-wall.obj': box(1, 2.5, 0.06), '/__reserve-door.obj': box(1, 2.5, 0.25), '/__reserve-shelf.obj': box(0.3, 1, 0.3) };
    if (objects[req.url]) { res.setHeader('Content-Type', 'text/plain'); return res.end(objects[req.url]); }
    if (req.url !== '/__reserve-sizing-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reserve-sizing-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('standing-config-intro:reserve-browser', 'started'));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-sizing-test__`);
  await page.waitForFunction(() => window.reserveTestItems?.some((item) => item.autoReserve));
  await page.getByRole('button', { name: /^Réserve/ }).click();
  const pick = (area) => page.locator('.reserve-choice-card').filter({ has: page.locator('.reserve-choice-copy strong b').filter({ hasText: new RegExp(`^${area} m²$`) }) });
  await pick(3).click();
  await page.waitForFunction(() => window.reserveTestItems.find((item) => item.autoReserve)?.type === 'reserve-sized-left-3m2');
  let current = await page.evaluate(() => ({ reserve: window.reserveTestItems.find((item) => item.autoReserve), pricing: window.reserveTestPricing }));
  assert.equal(current.reserve.options.unitPrice, 222); assert.equal(current.pricing.grossTotal, 222);
  assert.ok(current.reserve.children.some((item) => item.type === 'shelf-fixture'));
  assert.ok(current.reserve.children.find((item) => item.type === 'door-fixture').dimensions.depthLocked6cm);
  await page.waitForFunction(() => window.savedScene?.options?.reserveOptionType === 'reserve-sized-left-3m2');
  await page.screenshot({ path: '/tmp/standing-reserve-size-3m2.png' });
  await page.getByRole('button', { name: 'Reouvrir réserve' }).click();
  await page.waitForFunction(() => window.reserveTestItems.find((item) => item.autoReserve)?.type === 'reserve-sized-left-3m2');
  await page.getByRole('button', { name: /^Réserve/ }).click();
  await pick(1).click();
  await page.waitForFunction(() => window.reserveTestItems.find((item) => item.autoReserve)?.type === 'reserve-sized-left-1m2');
  assert.equal(await page.evaluate(() => window.reserveTestItems.find((item) => item.autoReserve).options.unitPrice), 0);
  await page.getByRole('button', { name: 'Pack Équipé test' }).click();
  await page.getByRole('button', { name: /^Réserve/ }).click();
  await pick(3).click();
  await page.waitForFunction(() => window.reserveTestItems.find((item) => item.autoReserve)?.type === 'reserve-sized-left-3m2');
  assert.equal(await page.evaluate(() => window.reserveTestItems.find((item) => item.autoReserve).options.unitPrice), 222);
  assert.deepEqual(errors, []);
  console.log('Reserve sizing: Signature/Equipe 2->3m2 costs 222 EUR, 2->1m2 free, included accessories/door flag retained, save/reopen OK');
} finally { await browser?.close(); await server.close(); }
