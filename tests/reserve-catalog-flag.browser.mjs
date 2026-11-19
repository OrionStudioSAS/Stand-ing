import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Back-office "Disponible dans la réserve": once an asset is ticked, the reserve configurator only offers ticked assets.
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature'];
const wall = { type: 'wall-fixture', label: 'Cloison 1x2.5m', is_active: true, model_url: '/__wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const door = { type: 'door-fixture', label: 'Porte gauche', is_active: true, model_url: '/__door.obj', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
const children = [
  { id: 'wall1', type: wall.type, label: wall.label, modelUrl: wall.model_url, modelSize: wall.dimensions.size, dimensions: wall.dimensions, x: -0.5, z: 0.5, rotation: 0 },
  { id: 'wall2', type: wall.type, label: wall.label, modelUrl: wall.model_url, modelSize: wall.dimensions.size, dimensions: wall.dimensions, x: 0.5, z: 0.5, rotation: 0 },
  { id: 'door', type: door.type, label: door.label, modelUrl: door.model_url, modelSize: door.dimensions.size, dimensions: door.dimensions, x: 0.905, z: 0, rotation: -90 },
];
const group = { type: 'reserve-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children, groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const box = (type, label, size, extra = {}) => ({ type, label, is_active: true, model_url: '/__box.obj', dimensions: { size, packs, category: 'Mobilier', ...extra } });
const fridge = box('fridge-fixture', 'Frigo test', [0.5, 0.85, 0.55]);
const stool = box('stool-fixture', 'Tabouret test', [0.4, 0.75, 0.4], { reserveCatalog: true });
const shelf = box('shelf-fixture', 'Étagère murale test', [0.9, 0.3, 0.3], { mountType: 'wall', reserveCatalog: true });
const assets = [wall, door, group, fridge, stool, shelf];
const scene = { id: 'reserve-flag', client_name: 'Test réserve', offer: 'Signature', event_name: 'Test', dimensions: { width: 8, depth: 4 }, layout: 'left', items: [], options: {},
  source_payload: { reserveRules: { 'signature-2m2': { includedType: group.type, includedLabel: group.label, options: [] }, large: { includedType: group.type, includedLabel: group.label, options: [] } } } };
const objBox = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp}from'/src/__reserve-flag-app.jsx';
localStorage.setItem('standing-config-intro:reserve-flag','started');localStorage.setItem('standing-config-tutorial:reserve-flag','done');
createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer={false} />);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-flag-test',
  resolveId(id) { if (id === '/src/__reserve-flag-app.jsx') return `${root}src/__reserve-flag-app.jsx`; if (id === '/src/__reserve-flag-page.jsx') return `${root}src/__reserve-flag-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-flag-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp};')
      .replace('  const reserveContentItems = useMemo(', '  window.reserveFlagCatalog=reserveCatalog;window.reserveFlagItems=visibleSceneItems;\n  const reserveContentItems = useMemo(');
    if (id === `${root}src/__reserve-flag-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-reserve-flag';const assets=${JSON.stringify(assets)};export async function listObjectBank(){return window.noReserveFlags?assets.map((asset)=>({...asset,dimensions:{...asset.dimensions,reserveCatalog:undefined}})):assets};export async function saveScene(scene){return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const objects = { '/__wall.obj': objBox(1, 2.5, 0.06), '/__door.obj': objBox(1, 2.5, 0.25), '/__box.obj': objBox(0.4, 0.75, 0.4) };
    if (objects[req.url]) { res.setHeader('Content-Type', 'text/plain'); return res.end(objects[req.url]); }
    if (req.url !== '/__reserve-flag-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reserve-flag-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__reserve-flag-test__`;
  const errors = [];
  const open = async (noFlags) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    if (noFlags) await page.addInitScript(() => { window.noReserveFlags = true; });
    await page.goto(url);
    await page.waitForFunction(() => window.reserveFlagCatalog && window.reserveFlagItems?.some((item) => item.autoReserve));
    return page;
  };
  const labels = (page) => page.evaluate(() => window.reserveFlagCatalog.map((card) => card.label).sort());

  const automatic = await open(true);
  assert.deepEqual(await labels(automatic), ['Frigo test', 'Étagère murale test'], 'Without any ticked asset, storage-friendly shop objects are picked automatically');
  await automatic.close();

  const curated = await open(false);
  assert.deepEqual(await labels(curated), ['Tabouret test', 'Étagère murale test'], 'Ticked assets only, even one the automatic selection would refuse');
  const stoolCard = await curated.evaluate(() => window.reserveFlagCatalog.find((card) => card.type === 'stool-fixture'));
  assert.equal(stoolCard.mount, 'floor');
  assert.equal(stoolCard.category, 'storage');
  await curated.getByRole('button', { name: /^Réserve/ }).first().click();
  await curated.getByRole('button', { name: /Personnaliser la réserve/ }).click();
  await curated.waitForSelector('.rsv-modal');
  await curated.getByRole('button', { name: /Suivant/ }).click();
  await curated.getByRole('button', { name: /Suivant/ }).click();
  await curated.waitForSelector('.rsv-catalog-card');
  const shown = (await curated.locator('.rsv-catalog-card strong').allTextContents()).sort();
  assert.deepEqual(shown, ['Tabouret test', 'Étagère murale test'], 'The editor lists the ticked assets');
  await curated.getByRole('button', { name: 'Ajouter Tabouret test' }).click();
  await curated.getByRole('button', { name: /Valider la réserve/ }).click();
  await curated.waitForFunction(() => window.reserveFlagItems.some((item) => item.type === 'stool-fixture' && item.options?.reserveContent));
  assert.deepEqual(errors, []);
  console.log('Reserve catalogue: back-office tick limits the objects offered inside the reserve OK');
} finally {
  await browser?.close();
  await server.close();
}
