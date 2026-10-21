import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const names = ['Blanc craie', 'Chêne Nebraska', 'Rouge', 'Bleu nuit', 'Taupe', 'Gris', 'Rose', 'Turquoise', 'Noir', 'Orange', 'Jaune', 'Vert', 'Bordeaux', 'Sable', 'Marine', 'Carbone', 'Delft', 'Pomme', 'Violet', 'Outremer'];
const colors = names.map((name, index) => ({ id: `finish-${index}`, name, code: `C${index}`, hex: `hsl(${index * 18},60%,50%)`,
  image: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="hsl(${index * 18},60%,50%)"/></svg>`)}` }));
const palette = { type: 'counter-palette', label: 'Mélaminé', is_active: true, dimensions: { isColorGroup: true, packs: ['Confort', 'Signature', 'Prestige'], colorUsages: ['counter'], colorGroupPrice: 79, colorOptions: colors } };
const counter = { type: 'counter-1m', label: 'Comptoir accueil bois 1m + Signa', model_url: '/__counter.obj', is_active: true, dimensions: { size: [1, 1, 0.5], packs: ['Équipé'], category: 'Mobilier' } };
const group = { type: 'counter-variants', label: 'Comptoir accueil', is_active: true, dimensions: { isVariantGroup: true, packs: ['Équipé'], variantAssetTypes: [counter.type],
  configOptions: [{ id: 'finish', label: 'Couleurs', type: 'color', colorGroupType: palette.type, price: 0 }] } };
const assets = [counter, group, palette];
const item = { id: 'included-counter', type: counter.type, label: counter.label, modelUrl: counter.model_url, modelSize: counter.dimensions.size, dimensions: counter.dimensions,
  x: 0, z: 0, rotation: 0, included: true, priceMode: 'included', options: { variantGroupType: group.type, binary2ColorId: `${palette.type}:finish-3` } };
const scene = { id: 'counter-colors-browser', offer: 'Équipé', client_status: 'draft', event_name: 'Test', dimensions: { width: 6, depth: 4 }, layout: 'back', items: [item], options: {}, source_payload: {} };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp,ItemConfiguratorModal,assetToCatalogEntry}from'/src/__counter-colors-app.jsx';
const original=${JSON.stringify(scene)},assets=${JSON.stringify(assets)},group=${JSON.stringify(group)};
function Test(){const[scene,setScene]=useState(original),[revision,setRevision]=useState(0),[modal,setModal]=useState(null);return <>
  <div style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}>
    <button onClick={()=>{setScene(window.savedScene);setRevision(value=>value+1)}}>Reouvrir comptoir test</button>
    <button onClick={()=>setModal((window.savedScene||original).items[0])}>Fiche comptoir test</button>
  </div><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer/>
  {modal&&<ItemConfiguratorModal mode="edit" scene={scene} item={modal} entry={assetToCatalogEntry(group,assets)} catalog={assets} salonLabel="Équipé" items={[modal]} width={6} depth={4} uploadState={{}} onClose={()=>setModal(null)} onConfirm={({options})=>{window.counterConfirmed=options;setModal(null)}}/>}
</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const obj = 'o BINARY2\nv -0.5 0 -0.25\nv 0.5 0 -0.25\nv 0.5 1 -0.25\nv -0.5 1 -0.25\nv -0.5 0 0.25\nv 0.5 0 0.25\nv 0.5 1 0.25\nv -0.5 1 0.25\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'counter-asset-colors-test',
  resolveId(id) { if (id === '/src/__counter-colors-app.jsx') return `${root}src/__counter-colors-app.jsx`; if (id === '/src/__counter-colors-page.jsx') return `${root}src/__counter-colors-page.jsx`; },
  load(id) {
    if (id === `${root}src/__counter-colors-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,ItemConfiguratorModal,assetToCatalogEntry};');
    if (id === `${root}src/__counter-colors-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-counter-colors';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__counter.obj') { res.setHeader('Content-Type', 'text/plain'); return res.end(obj); }
    if (req.url !== '/__counter-colors-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__counter-colors-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('standing-config-intro:counter-colors-browser', 'started'));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__counter-colors-test__`);
  await page.getByRole('button', { name: /^Comptoir accueil/ }).click();
  const finishes = page.locator('.counter-option-panel .counter-finish-card button');
  await finishes.first().waitFor();
  assert.equal(await finishes.count(), 20);
  assert.equal(await page.locator('.counter-option-panel .counter-finish-swatches.included button').count(), 20, 'Included colors use the compact swatch grid shared with SMCL');
  assert.ok(await page.locator('.counter-option-panel .counter-finish-swatches.included').evaluate(element=>element.getBoundingClientRect().height<180), 'The twenty colors fit in a compact palette');
  assert.equal(await finishes.nth(3).evaluate((button) => button.classList.contains('active')), true, 'Legacy group-prefixed IDs stay selected');
  assert.equal(await page.locator('.counter-option-panel .counter-finish-swatches.optional').count(), 0, 'The asset option makes every color free, overriding the group price');
  await finishes.nth(1).click();
  await page.waitForFunction(() => window.savedScene?.items[0]?.options?.binary2ColorId === 'finish-1');
  const saved = await page.evaluate(() => window.savedScene.items[0].options);
  assert.equal(saved.binary2ColorImage, colors[1].image);
  assert.equal(saved.binary2ColorPrice, 0);
  assert.equal(saved.variantColorSelections.finish.id, 'finish-1');
  await page.getByRole('button', { name: 'Reouvrir comptoir test' }).click();
  await page.getByRole('button', { name: /^Comptoir accueil/ }).click();
  assert.equal(await finishes.count(), 20);
  assert.equal(await finishes.nth(1).evaluate((button) => button.classList.contains('active')), true);
  await page.getByRole('button', { name: 'Fiche comptoir test' }).click();
  const modal = page.locator('.item-config-modal');
  await modal.waitFor();
  assert.match(await modal.innerText(), /20 coloris/);
  const modalColors = modal.locator('.variant-color-options-panel .counter-finish-swatches button');
  assert.equal(await modalColors.count(), 20);
  assert.equal(await modalColors.nth(1).evaluate((button) => button.classList.contains('active')), true);
  await modalColors.nth(0).click();
  await modal.locator('footer button').last().click();
  await page.waitForFunction(() => window.counterConfirmed);
  const confirmed = await page.evaluate(() => window.counterConfirmed);
  assert.equal(confirmed.variantColorSelections.finish.id, 'finish-0');
  assert.equal(confirmed.binary2ColorId, 'finish-0');
  assert.equal(confirmed.binary2ColorImage, colors[0].image);
  assert.equal(confirmed.binary2ColorPrice, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await finishes.count(), 20);
  assert.deepEqual(errors, []);
  console.log('Equipe counter: all 20 asset-linked colors, original order, free option override, wood/white textures, step 2 -> autosave/reopen -> item modal, legacy IDs and mobile OK');
} finally { await browser?.close(); await server.close(); }
