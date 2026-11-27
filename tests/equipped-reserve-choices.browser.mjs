import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const audit = JSON.parse(await readFile('tests/fixtures/signature-reserve-door-audit.json', 'utf8'));
const two = audit.groups.find(a => a.type === 'group-reserve-2m2-arriere-droite-mqrsqnfd');
const three = audit.groups.find(a => a.type === 'group-nouveau-groupe-mqruijl9');
const one = audit.groups.find(a => a.label === 'Réserve 1m2 arrière droite');
const palette = (usage, legacyPrice, paidLabel) => ({
  type: usage, label: usage, is_active: true,
  dimensions: {
    isColorGroup: true, packs: ['Équipé'], colorUsages: [usage], colorGroupPrice: legacyPrice,
    colorOptions: [
      { id: 'free', name: 'Base', hex: '#dddddd', isDefault: true },
      { id: 'paid', name: paidLabel, hex: '#334499' },
    ],
  },
});
const assets = [
  ...[one, two, three].map(a => ({ ...a, is_active: true, dimensions: { ...a.dimensions, packs: ['Équipé'] } })),
  palette('carpet', 36, 'Bleu option'), palette('wallFabric', 2.14, 'Coton option'),
];
const scene = {
  id: 'equipped-reserve-test', project_name: 'NOM STAND (test)', offer: 'SIAE',
  dimensions: { width: 5, depth: 5 }, layout: 'u', items: [], client_status: 'draft',
  options: { ledRailsEnabled: false },
  source_payload: { reserveRules: { medium: { includedType: two.type, options: [] }, large: { includedType: three.type, options: [] } } },
};
const appId = resolve('src/__equipped-reserves-app.jsx');
const pageId = resolve('src/__equipped-reserves-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const harness = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {ConfiguratorApp,sceneAllAdminItems,assetToCatalogEntry} from '/src/__equipped-reserves-app.jsx';
  const assets=${JSON.stringify(assets)};
  window.reconstruct=()=>sceneAllAdminItems(window.savedScene,assets.map(a=>assetToCatalogEntry(a,assets)).filter(Boolean));
  localStorage.setItem('standing-config-intro:equipped-reserve-test','started');
  localStorage.setItem('standing-config-tutorial:equipped-reserve-test','done');
  const scene=${JSON.stringify(scene)};
  const size=new URLSearchParams(location.search).get('size');
  if(size==='24') scene.dimensions={width:6,depth:4};
  if(size==='31') scene.dimensions={width:6.2,depth:5};
  createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={scene} isAdminViewer/>);
`;
const store = `
  export * from '/src/data/sceneStore.js?siae-original';
  export async function listObjectBank(){return ${JSON.stringify(assets)};}
  export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}
  export async function uploadSceneItemOptionImage(_scene,target,file){
    window.viscomUpload={id:target.id,name:file.name};
    return new Promise(resolve=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.readAsDataURL(file); });
  }
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'equipped-reserve-choices',
  resolveId(id) { if (id === '/src/__equipped-reserves-app.jsx') return appId; if (id === '/src/__equipped-reserves-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source
      .replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,sceneAllAdminItems,assetToCatalogEntry};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.probe={automaticReserveItems,siaeViscom,scenePricing};\n  const estimatedTotal = scenePricing.total;');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) {
    vite.middlewares.use('/__equipped-reserves__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script type="module" src="/src/__equipped-reserves-page.jsx"></script>');
    });
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__equipped-reserves__`;
  const openScene = async (size, type) => {
    await page.goto(`${base}?size=${size}`);
    await page.waitForFunction(type => window.probe?.automaticReserveItems[0]?.type === type, type);
    await page.getByRole('button', { name: /Configuration/ }).first().click();
  };
  await openScene(24, one.type);
  assert.equal(await page.getByRole('button', { name: 'Visuel Viscom', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  assert.match(await page.locator('.reserve-choice-card.active').innerText(), /Réserve\s+1 m²/);
  await page.getByRole('button', { name: 'Sol', exact: true }).click();
  const sol = page.locator('[data-option="moquette"]');
  await sol.getByRole('button', { name: /Bleu option/ }).first().click();
  await sol.getByRole('button', { name: /Moquette épaisse.*528/ }).click();
  await page.locator('[data-option="coton"] > button').click();
  await page.locator('[data-option="coton"]').getByRole('button', { name: /Coton option/ }).click();
  const materialLines = await page.evaluate(() => window.probe.scenePricing.lines
    .filter(line => line.type.startsWith('color-'))
    .map(line => [line.type, line.quantity, line.unitPrice, line.total]));
  assert.deepEqual(materialLines, [
    ['color-carpet', 24, 10, 240], ['color-wallFabric', 35, 10, 350], ['color-option-carpet-__carpet-thick__', 24, 22, 528],
  ]);

  await openScene(25, two.type);
  const viscom = page.locator('[data-option="viscom"]');
  await viscom.getByRole('button', { name: 'Visuel Viscom', exact: true }).click();
  await viscom.getByText('1000 × 1000 mm · PNG, JPG ou PDF', { exact: true }).waitFor();
  assert.match(await page.evaluate(() => window.probe.siaeViscom.wall), /^object-wall:auto-reserve-large:/);
  await viscom.locator('input[type=file]').setInputFiles({
    name: 'viscom.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  });
  await viscom.getByRole('img', { name: 'Visuel Viscom' }).waitFor();
  await page.waitForFunction(() => window.savedScene?.options?.siaeViscomVisual?.posterImageName === 'viscom.png');
  const rebuilt = await page.evaluate(() => window.reconstruct().find(item => item.autoSiaeViscom));
  assert.match(rebuilt.wall, /^object-wall:auto-reserve-large:/);
  assert.equal(rebuilt.options.posterImageName, 'viscom.png');
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  await page.locator('.reserve-choice-card').filter({ hasText: /3 m²/ }).click();
  await page.waitForFunction(type => window.savedScene?.options.reserveOptionType === type, three.type);
  assert.equal(await page.evaluate(() => window.reconstruct().find(item => item.autoReserve).type), three.type);

  await openScene(31, three.type);
  assert.equal(await page.getByRole('button', { name: 'Visuel Viscom', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('SIAE: 6 x 4 m pricing, 1/2/3 m² reserves, Viscom threshold, upload and BAT reconstruction OK');
} finally {
  await browser?.close();
  await server.close();
}
