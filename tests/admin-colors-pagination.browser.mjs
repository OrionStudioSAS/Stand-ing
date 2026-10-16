import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appPath = new URL('../src/__admin-colors-test-app.jsx', import.meta.url).pathname;
const pagePath = new URL('../src/__admin-colors-test-page.jsx', import.meta.url).pathname;
const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const group = { type: 'color-group-test', label: 'ZZ Couleurs', is_active: true, dimensions: { isColorGroup: true, category: 'Groupes de couleurs', packs: ['Équipé'], colorUsages: ['carpet'], colorGroupPrice: 12, colorGroupReference: '', colorOptions: [
  { id: 'red', code: 'R1', name: 'Rouge', hex: '#bb2222', isDefault: true },
  { id: 'blue', code: 'B1', name: 'Bleu', hex: '#2222bb', isFree: true },
] } };
const assets = [...Array.from({ length: 56 }, (_, i) => ({ type: `asset-${i}`, label: `Asset ${String(i + 1).padStart(2, '0')}`, is_active: true, dimensions: { packs: ['Équipé'], category: 'Mobilier' } })), group];
const harness = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AdminObjectsView,PresetColorSelect} from '/src/__admin-colors-test-app.jsx';
function Test(){const[assets,setAssets]=useState(${JSON.stringify(assets)});const[selected,setSelected]=useState(null);const[category,setCategory]=useState('Tout');const[color,setColor]=useState('old-group:red');return <>
<div style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}><button onClick={()=>setSelected(assets.find(a=>a.type==='color-group-test'))}>Ouvrir couleurs test</button><PresetColorSelect label="Couleur test" colors={[{id:'new-group:red',code:'R1',name:'Rouge',hex:'#bb2222'},{id:'new-group:blue',code:'B1',name:'Bleu',hex:'#2222bb'}]} value={color} onChange={setColor}/></div>
<AdminObjectsView assets={assets} scenes={[]} salons={[]} search="" category={category} uploadState={{}} onCategoryChange={setCategory} onSelectAsset={setSelected} onCloseAsset={()=>setSelected(null)} selectedAsset={selected} onSaveAsset={async a=>{window.savedAsset=a;setAssets(v=>v.map(x=>x.type===a.type?a:x));return a;}} />
</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'admin-colors-test',
  resolveId(id) { if (id === '/src/__admin-colors-test-app.jsx') return appPath; if (id === '/src/__admin-colors-test-page.jsx') return pagePath; },
  load(id) { if (id === appPath) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {AdminObjectsView,PresetColorSelect};'); if (id === pagePath) return harness; },
  configureServer(vite) { vite.middlewares.use('/__admin-colors-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html');res.end('<div id="root"></div><script type="module" src="/src/__admin-colors-test-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__admin-colors-test__`);
  await page.getByLabel("Nombre d'assets par page").waitFor();
  assert.equal(await page.locator('.asset-card').count(), 20);
  await page.getByRole('button', { name: 'Suivant', exact: true }).click();
  assert.match(await page.locator('.asset-library-pagination').innerText(), /21–40/);
  await page.getByLabel("Nombre d'assets par page").selectOption('50');
  assert.equal(await page.locator('.asset-card').count(), 50);
  assert.match(await page.locator('.asset-library-pagination').innerText(), /1–50/);
  await page.getByLabel("Nombre d'assets par page").selectOption('all');
  assert.equal(await page.locator('.asset-card').count(), 57);
  assert.equal(await page.getByLabel('Couleur test').inputValue(), 'new-group:red');
  assert.equal(await page.locator('.preset-color-select i').evaluate((el) => el.style.getPropertyValue('--swatch-color')), '#bb2222');
  await page.getByLabel('Couleur test').selectOption('new-group:blue');
  assert.equal(await page.locator('.preset-color-select i').evaluate((el) => el.style.getPropertyValue('--swatch-color')), '#2222bb');
  await page.getByRole('button', { name: 'Ouvrir couleurs test' }).click();
  await page.getByLabel('Nom de la couleur 1', { exact: true }).fill('Rouge renommé');
  await page.getByLabel('Référence de la couleur 1', { exact: true }).fill('REF-NEW');
  await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  const saved = await page.evaluate(() => window.savedAsset);
  assert.equal(saved.dimensions.colorOptions[0].id, 'red');
  assert.equal(saved.dimensions.colorOptions[0].name, 'Rouge renommé');
  assert.equal(saved.dimensions.colorOptions[0].code, 'REF-NEW');
  assert.equal(saved.dimensions.colorOptions[0].isDefault, true);
  assert.equal(saved.dimensions.colorOptions[1].isFree, true);
  await page.screenshot({ path: '/tmp/standing-admin-colors-edit.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Admin: 20/50/all pagination, reset, legacy pack color ID resolution, editable color names/references with stable IDs and free flags OK');
} finally { await browser?.close(); await server.close(); }
