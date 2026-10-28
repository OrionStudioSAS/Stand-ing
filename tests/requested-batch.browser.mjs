import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const primary = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path data-primary="yes" fill="#939598" d="M0 0H200V100H0Z"/></svg>';
const electric = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path data-electric="yes" fill="#ffb300" d="M40 0L10 60H45L35 100L90 35H55L70 0Z"/></svg>';
const asset = { type: 'machine', label: 'Machine BAT', is_active: true, thumbnail_url: '/__base.svg', dimensions: { size: [1, 1, .5], category: 'Mobilier', batPictoUrl: '/__base.svg', batPictoPath: 'base.svg' } };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import * as api from'/src/__batch-app.jsx';import{createTechnicalPlanSvgPages}from'/src/technicalExport.js';window.api=api;window.exportPlan=createTechnicalPlanSvgPages;
const original=${JSON.stringify(asset)};const surfaces=[{id:'back',label:'Cloison arrière',width:4.5,visibleWidth:4.41,height:2.5}];
function Test(){const[mode,setMode]=useState('covers'),[covers,setCovers]=useState({back:{enabled:true}}),[asset,setAsset]=useState(original),[open,setOpen]=useState(true);window.asset=asset;window.covers=covers;
const items=[{id:'included',type:'chair',label:'Chaise incluse',included:true,priceMode:'included',options:{}},{id:'paid',type:'table',label:'Table supplémentaire',options:{unitPrice:85.5}}];const catalog=[{type:'chair',label:'Chaise incluse',price:100},{type:'table',label:'Table supplémentaire',price:85.5}];
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:999999,background:'white'}}>{['covers','cart','asset'].map(mode=><button key={mode} onClick={()=>{setMode(mode);setOpen(true)}}>Test {mode}</button>)}</nav>{mode==='covers'?<main style={{width:360,maxWidth:'100%',margin:'50px auto'}}><api.WallCoverOptionCard surfaces={surfaces} covers={covers} unitPrice={249} includedMl={3} onToggle={(id,enabled)=>setCovers(values=>({...values,[id]:{enabled}}))}/><api.SceneSyncTime scene={{source_payload:{monday_synced_at:'2026-10-26T12:34:00Z'}}}/></main>:mode==='cart'?<api.HeaderCartMenu items={items} catalog={catalog} pricing={{includedCounts:new Map([['chair',1]]),lines:[]}} total={85.5} salonLabel="Confort"/>:open&&<api.AssetDrawer asset={asset} assets={[asset]} scenes={[]} onClose={()=>setOpen(false)} onSave={async updated=>{window.savedAsset=structuredClone(updated);setAsset(updated);return updated;}}/>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'requested-batch-test',
  resolveId(id) { if (id === '/src/__batch-app.jsx') return `${root}src/__batch-app.jsx`; if (id === '/src/__batch-page.jsx') return `${root}src/__batch-page.jsx`; },
  load(id) {
    if (id === `${root}src/__batch-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {WallCoverOptionCard,HeaderCartMenu,AssetDrawer,SceneSyncTime,calculateScenePricing,scenePurchaseOrder};');
    if (id === `${root}src/__batch-page.jsx`) return harness;
    if (id === `${root}src/data/supabaseClient.js`) return 'export const supabase=null;';
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?batch-original';export async function uploadObjectAssetScopedImage(){return{publicUrl:'/__electric.svg',path:'electric.svg'}};`;
  },
  configureServer(vite) {
    for (const [url, svg] of [['/__base.svg', primary], ['/__electric.svg', electric]]) vite.middlewares.use(url, (_req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg); });
    vite.middlewares.use('/__batch__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__batch-page.jsx"></script>'); });
  },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__batch__`);
  const coverCard = page.locator('.wall-cover-card'); await coverCard.waitFor();
  assert.equal(await coverCard.locator(':scope > :first-child').getAttribute('class'), 'wall-cover-info-box success');
  assert.match(await coverCard.innerText(), /249 €\/m linéaire/);
  assert.match(await coverCard.locator('.wall-cover-price-summary').innerText(), /351,09/);
  assert.match(await page.locator('time').innerText(), /26\/10\/2026.*13:34/);
  await coverCard.locator('.wall-cover-toggle').click();
  assert.equal(await coverCard.locator('.wall-cover-price-summary').count(), 0);
  await coverCard.locator('.wall-cover-toggle').click();
  assert.match(await coverCard.locator('.wall-cover-price-summary').innerText(), /351,09/);
  const prices = await page.evaluate(() => ['Signature', 'Équipé', 'Confort', 'Prestige'].map(offer => {
    const result = window.api.calculateScenePricing({ catalog: [], items: [], salonLabel: offer, scene: { offer, dimensions: { width: 5, depth: 4 } }, wallCovers: { back: { enabled: true } }, wallCoverSurfaces: [{ id: 'back', width: 4.5, visibleWidth: 4.41 }] });
    const lines = result.lines.filter(line => line.type.startsWith('wall-cover'));
    return { offer, total: Math.round(lines.reduce((sum,line)=>sum+line.total,0)*100)/100, discount: lines.find(line=>line.type==='wall-cover-allowance')?.total || 0 };
  }));
  assert.deepEqual(prices.map(row => row.total), [351.09, 1115.73, 694.08, 118.08]);
  assert.deepEqual(prices.map(row => row.discount), [-747, 0, -576, -1152]);
  const order = await page.evaluate(() => window.api.scenePurchaseOrder({ offer: 'Signature', dimensions: { width: 4.41, depth: 4 }, layout: 'back', items: [], options: { wallCovers: { back: { enabled: true } } }, source_payload: { pricing: { lines: [{ type: 'wall-cover', label: 'Ancien devis incorrect', quantity: 1, unitPrice: 432, total: 432 }] } } }));
  assert.ok(Math.abs(order.total) < .005, 'A banner within the remaining accessories allowance cannot produce a negative order');
  assert.equal(order.lines.find(line => line.type === 'wall-cover').unitPrice, 249, 'Saved quotes are repriced using the current pack tariff');
  assert.equal(order.lines.find(line => line.type === 'wall-cover-allowance').total, -747, 'Banner allowance is preserved by order normalization');
  const cents = await page.evaluate(() => window.api.calculateScenePricing({ catalog: [{type:'test-centimes',label:'Objet',price:85.5}], items: [{id:'test-centimes',type:'test-centimes',options:{unitPrice:85.5}}], salonLabel:'Confort', scene:{offer:'Confort'} }).lines.find(line=>line.type==='test-centimes'));
  assert.equal(cents.unitPrice,85.5, 'Unit prices retain centimes too');
  await page.getByRole('button', { name: 'Test cart', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir le panier', exact: true }).click();
  const included = page.locator('.cart-item-card').filter({ hasText: 'Chaise incluse' });
  assert.equal(await included.locator('.cart-item-copy > b').innerText(), 'Inclus');
  assert.match(await page.locator('.cart-item-card').filter({ hasText: 'Table supplémentaire' }).innerText(), /85,5 € HT/);
  await page.getByRole('button', { name: 'Test asset', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Second picto électrique BAT', exact: true });
  await editor.getByLabel('Importer le picto électrique', { exact: true }).setInputFiles({ name: 'electric.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(electric) });
  const marker = editor.getByRole('button', { name: 'Déplacer le picto électrique', exact: true }); await marker.waitFor();
  assert.equal(await marker.evaluate(node => node.style.left), '50%');
  assert.equal(await marker.evaluate(node => node.style.top), '50%');
  await marker.focus(); await marker.press('ArrowRight');
  assert.equal(await marker.evaluate(node => node.style.left), '52%');
  const preview = await editor.locator('.bat-electrical-preview').boundingBox(); const icon = await marker.boundingBox();
  await page.mouse.move(icon.x + icon.width/2, icon.y + icon.height/2); await page.mouse.down();
  await page.mouse.move(preview.x + preview.width*.75, preview.y + preview.height*.3); await page.mouse.up();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const saved = await page.evaluate(() => window.savedAsset.dimensions);
  assert.ok(Math.abs(saved.batElectricalPictoX - .75) < .01);
  assert.ok(Math.abs(saved.batElectricalPictoY - .3) < .01);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1100});
    assert.equal(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'Electrical editor fits its column on desktop and mobile');
  }
  await page.setViewportSize({width:1440,height:1100});
  await editor.screenshot({ path: '/tmp/standing-electrical-picto-editor.png' });
  const plan = await page.evaluate(async () => {
    const asset = window.savedAsset; const entry = { type: asset.type, dimensions: asset.dimensions, modelSize: [1, 1, .5] };
    const pages = await window.exportPlan({ width: 4, depth: 3, layout: 'u', catalog: [entry], items: [{ ...entry, id: 'machine', x: 0, z: 0 }] });
    return { electric: pages[0].querySelectorAll('[data-electric]').length, primary: pages[0].querySelectorAll('[data-primary]').length, raster: pages[0].querySelectorAll('image').length };
  });
  assert.deepEqual(plan, { electric: 1, primary: 1, raster: 0 });
  const rasterPlan = await page.evaluate(async () => {
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;canvas.getContext('2d').fillRect(0,0,200,100);
    const dimensions={...window.savedAsset.dimensions,batPictoUrl:canvas.toDataURL('image/png'),batPictoPath:'base.png'};
    const entry={type:'png-picto',dimensions,modelSize:[1,1,.5]};
    const pages=await window.exportPlan({width:4,depth:3,layout:'u',catalog:[entry],items:[{...entry,id:'png-picto',x:0,z:0}]});
    return{electric:pages[0].querySelectorAll('[data-electric]').length,raster:pages[0].querySelectorAll('image').length};
  });
  assert.deepEqual(rasterPlan,{electric:1,raster:1},'Electrical overlays work with PNG primary pictograms too');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Test asset', exact: true }).click();
  assert.ok(Math.abs(Number.parseFloat(await marker.evaluate(node=>node.style.left)) - 75) < 1);
  await editor.getByLabel('Position électrique Y', { exact: true }).fill('0');
  await editor.getByRole('slider', { name: 'Taille du picto électrique', exact: true }).press('ArrowRight');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const outsideMetadata = await page.evaluate(() => window.savedAsset.dimensions);
  assert.equal(outsideMetadata.batElectricalPictoY, 0, 'The symbol may sit halfway outside the primary object');
  assert.equal(outsideMetadata.batElectricalPictoSizeMeters, .21, 'The size control saves physical meters rather than an object-relative fraction');
  const outsideBounds = await marker.boundingBox(), primaryBounds = await editor.locator('.bat-electrical-preview').boundingBox();
  assert.ok(outsideBounds.y < primaryBounds.y);
  await editor.getByRole('button', { name: 'Recentrer le picto électrique', exact: true }).click();
  assert.equal(await marker.evaluate(node=>node.style.left), '50%');
  await editor.getByRole('button', { name: 'Supprimer uniquement le picto électrique', exact: true }).click();
  await marker.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.savedAsset.dimensions.batPictoUrl), '/__base.svg');
  assert.equal(await page.evaluate(() => window.savedAsset.dimensions.batElectricalPictoUrl), '');
  assert.deepEqual(errors, []);
  console.log('Batch browser: exact pack tariffs and capped deductions, stable cover toggles, same included cart items, Paris sync timestamps, electrical upload/drag/keyboard/save/reopen/remove and vector BAT overlay OK');
} finally { await browser?.close(); await server.close(); }
