import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Reserve catalogue works like the shop (one product card, variants chosen in the product window),
// objects turn to any angle, and the BAT keeps stored objects inside a reserve that changed size.
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature'];
const wall = { type: 'wall-fixture', label: 'Cloison 1x2.5m', is_active: true, model_url: '/__wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const door = { type: 'door-trad-gauche-poignee-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht + Poignée Gauche', is_active: true, model_url: '/__door.obj', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
// Supplied with the reserve, admin-only and outside the stand's pack: its shop thumbnail must still show.
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const bloc = { type: 'bloc-fixture', label: 'Bloc test', is_active: true, model_url: '/__box.obj', thumbnail_url: pixel, dimensions: { size: [0.3, 1.8, 0.3], packs: ['Autre'], adminOnly: true, category: 'Mobilier' } };
const child = (id, asset, x, z, rotation) => ({ id, type: asset.type, label: asset.label, modelUrl: asset.model_url, modelSize: asset.dimensions.size, dimensions: asset.dimensions, x, z, rotation });
// Same layout as the catalogue "Réserve 2m² arrière gauche"; the 1 m² keeps one partition and the door.
const reserve2 = { type: 'reserve-2m2-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children: [child('wall1', wall, 0, 0, 0), child('wall2', wall, -1, 0, 0), child('door', door, 0.56, -0.528, -90), child('bloc', bloc, -0.8, 0.3, 0)], groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const reserve1 = { type: 'reserve-1m2-fixture', label: 'Réserve 1m2 arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children: [child('wall1', wall, -0.5, 0.03, 180), child('door', door, 0.06, -0.5, -90)], groupSize: [1, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const fridgeA = { type: 'fridge-a-fixture', label: 'Frigo A', is_active: true, model_url: '/__box.obj', dimensions: { size: [0.5, 0.85, 0.55], packs, category: 'Mobilier', price: 80 } };
const fridgeB = { type: 'fridge-b-fixture', label: 'Frigo B', is_active: true, model_url: '/__box.obj', dimensions: { size: [0.6, 1.4, 0.6], packs, category: 'Mobilier', price: 120 } };
const fridges = { type: 'fridge-group-fixture', label: 'Frigo test', is_active: true, dimensions: { isVariantGroup: true, packs, category: 'Mobilier', variantAssetTypes: [fridgeA.type, fridgeB.type], configOptions: [] } };
const assets = [wall, door, reserve2, reserve1, fridgeA, fridgeB, fridges, bloc];
const rules = (includedType) => ({ 'signature-2m2': { includedType, includedLabel: 'Réserve', options: [] }, large: { includedType, includedLabel: 'Réserve', options: [] } });
const scene = { id: 'reserve-variants', client_name: 'Test réserve', offer: 'Signature', event_name: 'Test', dimensions: { width: 5, depth: 5 }, layout: 'u', items: [], options: {}, source_payload: { reserveRules: rules(reserve2.type) } };
const objBox = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp,sceneAllAdminItems}from'/src/__reserve-variants-app.jsx';
window.variantsBatItems=sceneAllAdminItems;
localStorage.setItem('standing-config-intro:reserve-variants','started');localStorage.setItem('standing-config-tutorial:reserve-variants','done');
createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer={false} />);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-variants-test',
  resolveId(id) { if (id === '/src/__reserve-variants-app.jsx') return `${root}src/__reserve-variants-app.jsx`; if (id === '/src/__reserve-variants-page.jsx') return `${root}src/__reserve-variants-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-variants-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,sceneAllAdminItems};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.variantsItems=visibleSceneItems;window.variantsCatalog=availableCatalog;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__reserve-variants-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-reserve-variants';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const objects = { '/__wall.obj': objBox(1, 2.5, 0.06), '/__door.obj': objBox(1, 2.5, 0.25), '/__box.obj': objBox(0.5, 0.85, 0.55) };
    if (objects[req.url]) { res.setHeader('Content-Type', 'text/plain'); return res.end(objects[req.url]); }
    if (req.url !== '/__reserve-variants-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reserve-variants-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-variants-test__`);
  await page.waitForFunction(() => window.variantsItems?.some((item) => item.autoReserve));
  await page.getByRole('button', { name: /^Réserve/ }).first().click();
  await page.getByRole('button', { name: /Personnaliser la réserve/ }).click();
  const editor = page.locator('.rsv-modal');
  await editor.waitFor();
  await page.getByRole('button', { name: /Suivant : la porte/ }).click();
  await page.getByRole('button', { name: /Suivant : l’aménagement/ }).click();

  // One card for the product, as in the shop.
  const card = page.locator('.rsv-catalog-card').filter({ hasText: 'Frigo test' });
  assert.equal(await card.count(), 1, 'Both fridges are offered through a single product card');
  assert.match(await card.innerText(), /2 variantes disponibles/);
  assert.match(await card.innerText(), /À partir de 80/);

  // Click → shop product window above the editor → pick the variant → "Appliquer".
  await card.getByRole('button', { name: 'Choisir Frigo test' }).click();
  const productWindow = page.locator('.rsv-config-layer .item-config-modal');
  await productWindow.waitFor();
  const zOrder = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.rsv-config-layer .item-config-overlay')).zIndex) > Number(getComputedStyle(document.querySelector('.rsv-overlay')).zIndex));
  assert.ok(zOrder, 'The product window shows above the reserve editor');
  await productWindow.locator('.config-choice-section button').filter({ hasText: 'Frigo B' }).click();
  await productWindow.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await productWindow.waitFor({ state: 'detached' });
  await editor.getByText('Frigo test · Frigo B ajouté à la réserve').waitFor();
  await editor.getByRole('button', { name: /Dans la réserve/ }).click();
  await editor.locator('.rsv-content-list').getByText('Frigo test · Frigo B').waitFor();
  const blocThumb = await editor.locator('.rsv-content-list li.builtin').filter({ hasText: 'Bloc test' }).locator('.rsv-content-thumb img').getAttribute('src');
  assert.equal(blocThumb, pixel, 'Items supplied with the reserve show their catalogue visual');
  await editor.locator('.rsv-content-list').getByText('Frigo test · Frigo B').click();

  // Free rotation from the selected object card.
  const angle = editor.getByRole('textbox', { name: 'Angle en degrés' });
  await angle.fill('30');
  await angle.press('Enter');
  await page.waitForFunction(() => document.querySelector('[role="slider"][aria-label="Orientation de l’objet"]')?.getAttribute('aria-valuenow') === '30');
  await editor.getByRole('button', { name: 'Tourner de 15° vers la droite' }).click();
  await page.waitForFunction(() => document.querySelector('[role="slider"][aria-label="Orientation de l’objet"]')?.getAttribute('aria-valuenow') === '45');

  await page.getByRole('button', { name: /Valider la réserve/ }).click();
  await editor.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.savedScene?.items?.some((item) => item.options?.reserveContent));
  const saved = await page.evaluate(() => window.savedScene.items.find((item) => item.options?.reserveContent));
  assert.equal(saved.type, fridgeB.type, 'The chosen variant is the one stored in the reserve');
  assert.equal(saved.options.variantGroupType, fridges.type);
  assert.equal(saved.options.reserveContent.rotation, 45, 'Any angle is kept, not only 0° or 90°');
  const shown = await page.evaluate(() => window.variantsItems.find((item) => item.options?.reserveContent));
  assert.equal(shown.rotation, 45, 'The 3D view turns the object by the same angle');

  // BAT: the pack rule now gives a 1 m² reserve; the stored fridge must stay inside it.
  const bat = await page.evaluate(async ({ savedScene, smaller }) => {
    const geometry = await import('/src/reserveConfigurator.js');
    const sceneForBat = { ...savedScene, source_payload: { ...savedScene.source_payload, reserveRules: smaller } };
    const items = window.variantsBatItems(sceneForBat, window.variantsCatalog);
    const reserve = items.find((item) => item.autoReserve);
    const content = items.find((item) => item.options?.reserveContent);
    const interior = geometry.reserveInterior(reserve.children);
    const local = geometry.reserveWorldToLocal(reserve, { x: content.x, z: content.z });
    const footprint = geometry.footprintBounds([0.6, 1.4, 0.6], local.x, local.z, content.rotation - reserve.rotation);
    return { reserveType: reserve.type, inside: geometry.boundsInside(footprint, interior, 0.01) };
  }, { savedScene: saved && await page.evaluate(() => window.savedScene), smaller: rules(reserve1.type) });
  assert.equal(bat.reserveType, reserve1.type);
  assert.ok(bat.inside, 'On the BAT the fridge is moved inside the smaller reserve instead of sticking out');
  assert.deepEqual(errors, []);
  console.log('Reserve catalogue variants, free rotation and BAT refit OK');
} finally {
  await browser?.close();
  await server.close();
}
