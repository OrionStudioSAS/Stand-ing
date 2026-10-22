import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#bfc0c3"/></svg>');
const colors = [{ id: 'wood', name: 'Bois', code: '0450', hex: '#bfc0c3', image: art, included: true, isDefault: true }, ...['#bfc0c3', '#edcc1d', '#b39a6b', '#891d27', '#286c39', '#8c8c8c', '#151515', '#662b66', '#626262', '#31312f', '#141e34', '#dac9a7', '#3d85ac', '#205441', '#71675a'].map((hex, index) => ({ id: `finish-${index}`, name: `Couleur ${index + 1}`, code: `C${index}`, hex }))];
const packs = ['Confort', 'Prestige', 'Équipé', 'Signature', 'Autre pack'];
const counters = [1, 1.5, 2].map((width, index) => ({ type: `counter-${index}`, label: `Comptoir accueil ${width}m`, is_active: true, dimensions: { size: [width, 1, 0.5], price: [0, 731, 963][index], packs, reference: `REF-${index}`, category: 'Mobilier' } }));
const palette = { type: 'counter-palette', label: 'Couleurs comptoir', is_active: true, dimensions: { isColorGroup: true, packs, colorUsages: ['counter'], colorGroupPrice: 79, colorOptions: colors } };
const group = { type: 'counter-variants', label: 'Comptoir accueil', is_active: true, dimensions: { isVariantGroup: true, packs, variantAssetTypes: counters.map((entry) => entry.type), configOptions: [{ id: 'finish', label: 'Couleur', type: 'color', colorGroupType: palette.type, price: 79 }] } };
const assets = [...counters, group, palette];
const original = { ...counters[0], id: 'included-counter', included: true, priceMode: 'included', modelSize: counters[0].dimensions.size, options: { variantGroupType: group.type, binary2ColorId: 'wood' } };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ItemConfiguratorModal,CounterOptionCard,assetToCatalogEntry}from'/src/__counter-design-app.jsx';
const original=${JSON.stringify(original)},baseAssets=${JSON.stringify(assets)},art=${JSON.stringify(art)};
function Test(){const[item,setItem]=useState(original),[open,setOpen]=useState(true),[pack,setPack]=useState('Confort'),[mode,setMode]=useState('edit'),[revision,setRevision]=useState(0),[upload,setUpload]=useState({}),[scenario,setScenario]=useState('normal');
const assets=baseAssets.map(asset=>asset.type==='counter-variants'&&scenario==='free'?{...asset,dimensions:{...asset.dimensions,configOptions:asset.dimensions.configOptions.map(option=>({...option,price:0}))}}:asset.type==='counter-palette'&&scenario==='paid'?{...asset,dimensions:{...asset.dimensions,colorOptions:asset.dimensions.colorOptions.map(color=>({...color,included:false,isDefault:false,isFree:false}))}}:asset);
const entry=assetToCatalogEntry(assets.find(asset=>asset.type==='counter-variants'),assets),catalog=assets.filter(asset=>!asset.dimensions.isColorGroup).map(asset=>assetToCatalogEntry(asset,assets));
const patch=(_item,options)=>setItem(value=>({...value,options:{...value.options,...options}}));window.testCounterItem=item;
const reopen=(nextPack=pack,nextMode='edit',nextScenario=scenario)=>{setOpen(true);setPack(nextPack);setMode(nextMode);setScenario(nextScenario);setRevision(value=>value+1);setUpload({});setItem(original)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}>{${JSON.stringify(packs)}.map(pack=><button key={pack} onClick={()=>reopen(pack)}>Pack test {pack}</button>)}<button onClick={()=>{setOpen(true);setRevision(value=>value+1)}}>Reouvrir test</button><button onClick={()=>reopen(pack,'add')}>Ajouter test</button><button onClick={()=>reopen(pack,'edit','free')}>Tout inclus test</button><button onClick={()=>reopen(pack,'edit','paid')}>Tout payant test</button><button onClick={()=>setUpload({uploading:true})}>Upload test</button><button onClick={()=>setUpload({error:'Erreur de fichier test'})}>Erreur test</button></nav>
<CounterOptionCard items={[original]} colors={[]} catalog={catalog} salonLabel={pack}/>
{open&&<ItemConfiguratorModal key={revision} mode={mode} scene={{id:'counter-design',offer:pack}} entry={entry} item={mode==='edit'?item:null} items={mode==='edit'?[item]:[]} catalog={assets} salonLabel={pack} width={6} depth={4} uploadState={upload}
onUpdateItemOptions={patch} onImageChange={(_item,file,keys)=>{window.lastUpload={name:file.name,keys};patch(_item,{[keys.urlKey]:art,[keys.nameKey]:file.name,...keys.extraPatch})}}
onClose={()=>setOpen(false)} onConfirm={result=>{window.counterConfirmed=result;setItem({...result.entry,id:original.id,included:mode==='edit',options:result.options});setOpen(false)}}/>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'counter-popup-design-test',
  resolveId(id) { if (id === '/src/__counter-design-app.jsx') return `${root}src/__counter-design-app.jsx`; if (id === '/src/__counter-design-page.jsx') return `${root}src/__counter-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__counter-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ItemConfiguratorModal,CounterOptionCard,assetToCatalogEntry};');
    if (id === `${root}src/__counter-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?counter-popup-original';export async function uploadSceneItemOptionImage(){return ${JSON.stringify(art)}};`;
  },
  configureServer(vite) { vite.middlewares.use('/__counter-design-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__counter-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 368, height: 950 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__counter-design-test__`);
  const modal = page.locator('.counter-variant-modal');
  await modal.locator('.counter-size-grid button').last().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const layout = await modal.evaluate((element) => {
    const root = element.getBoundingClientRect();
    const rect = (target) => { const b = target.getBoundingClientRect(); return { x: b.x - root.x, y: b.y - root.y, width: b.width, height: b.height }; };
    return { width: root.width, header: rect(element.querySelector(':scope > header')), sizes: [...element.querySelectorAll('.counter-size-grid button')].map(rect), finish: rect(element.querySelector('.counter-finish-card')), swatches: [...element.querySelectorAll('.counter-finish-swatches.optional button')].map(rect), logo: rect(element.querySelector('.counter-logo-card')), upload: rect(element.querySelector('.visual-upload-dropzone')), footer: rect(element.querySelector('footer')) };
  });
  await modal.screenshot({ path: '/tmp/standing-counter-popup-reference.png' });
  console.log('Popup reference geometry:', JSON.stringify(layout));
  assert.equal(layout.width, 320); assert.equal(layout.header.height, 60);
  assert.ok(layout.sizes.every((size) => size.width === 64 && size.height === 64));
  assert.equal(layout.finish.width, 284); assert.equal(layout.swatches.length, 15);
  assert.equal(layout.swatches.filter((swatch) => swatch.y === layout.swatches[0].y).length, 8);
  assert.equal(layout.logo.width, 284); assert.equal(layout.upload.width, 260); assert.equal(layout.upload.height, 90);
  assert.ok(layout.finish.y < layout.logo.y, 'Finish precedes logo, including asset-linked color options');
  assert.equal(await page.locator('.counter-option-panel:not(.reference-counter-panel)').count(), 1, 'Step 2 keeps its original design');
  const sizes = modal.locator('.counter-size-grid button');
  assert.deepEqual(await sizes.locator('em').allTextContents(), ['Inclus', '731 €', '963 €'], 'Popup uses catalog prices, not step-2 fixed supplements');
  await sizes.nth(1).click();
  await modal.locator('.counter-finish-swatches.optional button').nth(2).click();
  assert.match(await modal.locator('.counter-finish-head > span').innerText(), /Couleur 3/);
  const pending = modal.getByRole('checkbox', { name: 'Je fournirai le visuel plus tard', exact: true });
  await pending.check();
  assert.equal((await page.evaluate(() => window.testCounterItem.options)).binary3VisualPending, true);
  await modal.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>') });
  assert.equal((await page.evaluate(() => window.lastUpload)).name, 'logo.svg');
  await page.setViewportSize({ width: 368, height: 1700 });
  await modal.locator('.image-framing-controls summary').click();
  await modal.locator('.image-framing-controls input[type=range]').fill('145');
  await modal.locator('.image-framing-controls input[type=range]').press('ArrowRight');
  assert.equal((await page.evaluate(() => window.testCounterItem.options)).binary3ImageFraming.imageZoom, 1.5);
  await modal.locator('.item-image-reset').click();
  assert.equal(await modal.locator('.image-framing-controls').count(), 0);
  await pending.check();
  await modal.getByRole('checkbox', { name: 'Activer le logo', exact: true }).uncheck();
  assert.equal(await modal.locator('.visual-upload-dropzone').count(), 0);
  assert.equal((await page.evaluate(() => window.testCounterItem.options)).binary3VisualPending, false);
  await modal.getByRole('checkbox', { name: 'Activer le logo', exact: true }).check();
  await modal.getByRole('button', { name: 'Appliquer', exact: true }).click();
  let confirmed = await page.evaluate(() => window.counterConfirmed);
  assert.equal(confirmed.entry.type, 'counter-1');
  assert.equal(confirmed.options.variantColorSelections.finish.id, 'finish-2');
  assert.equal(confirmed.options.binary2ColorId, 'finish-2');
  assert.equal(confirmed.options.unitPrice, 810);
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  assert.equal(await sizes.nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await modal.locator('.counter-finish-swatches.optional button').nth(2).getAttribute('aria-pressed'), 'true');
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok((await modal.boundingBox()).width <= width - 32);
  }
  for (const pack of packs) {
    await page.getByRole('button', { name: `Pack test ${pack}`, exact: true }).click();
    await modal.locator('.counter-size-grid button').last().waitFor();
    assert.equal(await modal.locator('.reference-counter-panel').count(), 1, `${pack} uses the group popup design`);
    await modal.getByRole('button', { name: 'Fermer', exact: true }).click();
    assert.equal(await modal.count(), 0);
  }
  await page.getByRole('button', { name: 'Tout inclus test' }).click();
  assert.equal(await modal.locator('.counter-finish-swatches.included button').count(), 16);
  assert.equal(await modal.locator('.counter-finish-swatches.optional button').count(), 0);
  await page.getByRole('button', { name: 'Tout payant test' }).click();
  assert.equal(await modal.locator('.counter-finish-included-list').count(), 0);
  assert.equal(await modal.locator('.counter-finish-swatches.optional button').count(), 16);
  await page.getByRole('button', { name: 'Ajouter test' }).click();
  await sizes.nth(2).click();
  await modal.locator('.item-config-quantity button').last().click();
  await modal.getByRole('checkbox', { name: 'Activer le logo', exact: true }).uncheck();
  await modal.getByRole('button', { name: 'Appliquer', exact: true }).click();
  confirmed = await page.evaluate(() => window.counterConfirmed);
  assert.equal(confirmed.quantity, 2); assert.equal(confirmed.entry.type, 'counter-2');
  assert.equal(confirmed.options.unitPrice, 1042);
  await page.getByRole('button', { name: 'Pack test Confort', exact: true }).click();
  await page.getByRole('button', { name: 'Upload test' }).click();
  assert.equal(await modal.locator('.item-config-apply').isDisabled(), true);
  assert.equal(await modal.locator('input[type=file]').isDisabled(), true);
  await page.getByRole('button', { name: 'Erreur test' }).click();
  assert.match(await modal.locator('.counter-error').innerText(), /Erreur de fichier test/);
  assert.deepEqual(errors, []);
  console.log('Counter variant popup: all packs, reference layout, original step-2 UI, actual catalog/color/logo prices, edit/add/quantity, uploads/framing/reset, free/paid palettes, errors and reopen OK');
} finally { await browser?.close(); await server.close(); }
