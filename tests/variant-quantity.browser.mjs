import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__variant-quantity-app.jsx');
const pageId = resolve('src/__variant-quantity-page.jsx');
const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AssetConfigOptionRows,ItemConfiguratorModal,WallCoverOptionCard,CarpetColorOptionCard,FootprintColorOptionCard,ColorOptionCard} from '/src/__variant-quantity-app.jsx';
const fountain = { type: 'fontaine-stand', label: 'Fontaine à eau', price: 100, dimensions: { size: [.5,1,.5] } };
const color = { id: 'base', name: 'Base', code: '000', hex: '#ccc', included: true };
const banners = [
  { id: 'right', label: 'Cloison droite', visibleWidth: 3.39, width: 3.385, height: 2.5 },
  { id: 'back', label: 'Cloison arrière', visibleWidth: 2.5, width: 2.5, height: 2.5 },
];
function Test() {
  const [rows,setRows] = useState([{ id: 'bottle', label: 'Bonbonne', reference: 'EAU-01', type: 'toggle', price: 0 }]);
  const [mode,setMode] = useState('admin');
  const [item,setItem] = useState(null);
  const [covers,setCovers] = useState({right:{enabled:true}});
  const group = { type: 'fontaines', label: 'Fontaines à eau', dimensions: { isVariantGroup: true, variantAssets: [fountain], configOptions: rows } };
  return <main style={{maxWidth: 470, padding: 16}}>
    {mode === 'admin' && <>
      <AssetConfigOptionRows rows={rows} onChange={(i,patch)=>setRows(current=>current.map((row,index)=>index===i?{...row,...patch}:row))}/>
      <button onClick={()=>setMode('add')}>Configurer la fontaine</button>
    </>}
    {mode === 'closed' && <button onClick={()=>setMode('edit')}>Rouvrir la fontaine</button>}
    {(mode==='add'||mode==='edit') && <ItemConfiguratorModal mode={mode} entry={group} item={mode==='edit'?item:undefined} catalog={[group,fountain]}
      salonLabel="SIAE" items={[]} width={6} depth={4}
      onConfirm={(value)=>{window.confirmed=value;setItem({...fountain,id:'fontaine',options:value.options});setMode('closed')}}/>}
    <div id="ground-options">
      <CarpetColorOptionCard uniformLayout colors={[color]} selectedColor={color}/>
      <CarpetColorOptionCard colors={[color]} selectedColor={color}/>
      <FootprintColorOptionCard colors={[color]} selectedColor={color}/>
      <ColorOptionCard title="COTON GRATTÉ" uniformLayout colors={[color]} selectedColor={color}/>
      <ColorOptionCard title="COTON GRATTÉ" colors={[color]} selectedColor={color}/>
    </div>
    <WallCoverOptionCard surfaces={banners} covers={covers} includedMl={2} unitPrice={253}
      onToggle={(id,enabled)=>setCovers(current=>({...current,[id]:{enabled}}))}/>
  </main>;
}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'variant-quantity-test',
  resolveId(id) { if (id === '/src/__variant-quantity-app.jsx') return appId; if (id === '/src/__variant-quantity-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);",
      'export { AssetConfigOptionRows, ItemConfiguratorModal, WallCoverOptionCard, CarpetColorOptionCard, FootprintColorOptionCard, ColorOptionCard };');
    if (id === pageId) return harness;
  },
  configureServer(vite) {
    vite.middlewares.use('/__variant-quantity__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__variant-quantity-page.jsx"></script>');
    });
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__variant-quantity__`);
  await page.getByRole('button', { name: 'Quantité', exact: true }).click();
  await page.getByLabel('Prix unitaire HT').fill('12.5');
  await page.getByRole('button', { name: 'Configurer la fontaine' }).click();
  const bottle = page.getByRole('group', { name: 'Bonbonne', exact: true });
  const plus = bottle.getByRole('button', { name: 'Augmenter la quantité : Bonbonne' });
  const minus = bottle.getByRole('button', { name: 'Diminuer la quantité : Bonbonne' });
  assert.equal(await minus.isDisabled(), true);
  for (let index = 0; index < 3; index += 1) await plus.click();
  assert.equal(await bottle.locator('output').innerText(), '3');
  assert.match(await page.locator('.item-config-footer-total').innerText(), /137,5/);
  await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
  const options = await page.evaluate(() => window.confirmed.options);
  assert.equal(options.extraOptions.bottle, 3);
  assert.equal(options.billableUnitPrice, 137.5);
  assert.deepEqual(options.optionReferences[0], { id: 'bottle', label: 'Bonbonne × 3', reference: 'EAU-01', price: 37.5, type: 'quantity', quantity: 3, unitPrice: 12.5, global: false });
  await page.getByRole('button', { name: 'Rouvrir la fontaine' }).click();
  assert.equal(await bottle.locator('output').innerText(), '3');
  await minus.click();
  assert.equal(await bottle.locator('output').innerText(), '2');
  await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
  assert.equal(await page.evaluate(() => window.confirmed.options.billableUnitPrice), 125);

  const rows = page.locator('.wall-cover-row');
  assert.deepEqual(await rows.locator('.wall-cover-row-main > em').allTextContents(), ['857,67 € HT', '632,5 € HT']);
  assert.match(await rows.first().innerText(), /3,39 m × 2,5 m/);
  assert.match(await page.locator('.wall-cover-head').innerText(), /351,67/);
  assert.equal(await page.locator('#ground-options .ground-section-icon').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Admin quantity type, bottle +/− and persisted pricing, per-banner prices, and icon-free material headings OK');
} finally {
  await browser?.close();
  await server.close();
}
