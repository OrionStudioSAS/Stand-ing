import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="70"><rect width="120" height="70" fill="#246699"/><text x="40" y="42" fill="white">TV</text></svg>');
const woodTexture = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#bfc0c3"/></svg>');
const packs = ['Confort', 'Prestige', 'Équipé', 'Signature', 'Autre pack'];
const description = 'Fichiers à fournir 2 semaines avant l’ouverture du salon. Envoyez vos fichiers vidéo à notre équipe pour vérifier leur compatibilité.\nFormats acceptés selon les informations du catalogue.';
const colors = [{ id: 'wood', name: 'Bois', code: '0450', hex: '#bfc0c3', image: woodTexture, included: true, isDefault: true }, ...['#bfc0c3', '#edcc1d', '#b39a6b', '#891d27', '#286c39', '#8c8c8c', '#151515', '#662b66', '#626262', '#31312f', '#141e34', '#dac9a7', '#3d85ac', '#205441'].map((hex, index) => ({ id: `finish-${index}`, name: `Couleur ${index + 1}`, code: `C${index}`, hex }))];
const palette = { type: 'bar-colors', label: 'Couleurs Bar', dimensions: { isColorGroup: true, packs, colorUsages: ['counter'], colorGroupPrice: 79, colorOptions: colors } };
const tvAssets = [32, 43, 55, 65].map((size, index) => ({ type: `tv-${size}`, label: `TV ${size}"`, thumbnail_url: art, dimensions: { packs, size: [size / 32, 0.6, 0.1], isTelevision: true, price: [637, 731, 963, 1197][index], reference: `TV-REF-${size}` } }));
const barSlots = [{ id: 'finish', label: 'Couleur', kind: 'color', colorUsage: 'counter', targetName: 'Laminate' }, { id: 'logo', label: 'Logo', kind: 'image', targetName: '_2' }];
const barAssets = [1, 1.5, 2].map((size, index) => ({ type: `bar-${size}m`, label: `Bar ${size}m`, thumbnail_url: art, dimensions: { packs, size: [size, 1, 0.5], price: [73, 91, 109][index], reference: `BAR-REF-${index}`, textureSlots: barSlots } }));
const tvGroup = { type: 'tv-variants', label: 'TV', thumbnail_url: art, dimensions: { packs, isVariantGroup: true, description, variantAssetTypes: tvAssets.map((asset) => asset.type), configOptions: [
  { id: 'technician', label: 'Permanence technicien 1/2 j', price: 340 },
  { id: 'video', label: 'Vérification et intégration des fichiers vidéo', detail: 'Fichiers à fournir 2 semaines avant l’ouverture du salon', price: 55 },
  { id: 'stand', label: 'Sur pied', price: 0 },
] } };
const barGroup = { type: 'bar-variants', label: 'Bar', thumbnail_url: art, dimensions: { packs, isVariantGroup: true, variantAssetTypes: barAssets.map((asset) => asset.type), configOptions: [
  { id: 'finish-choice', label: 'Couleur', type: 'color', colorGroupType: palette.type, textureSlotId: 'finish', price: 79 },
  { id: 'logo', label: 'Logo', type: 'toggle', price: 999, defaultChecked: true },
] } };
const assets = [...tvAssets, ...barAssets, palette, tvGroup, barGroup];
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import * as api from '/src/__tv-bar-app.jsx';
const assets=${JSON.stringify(assets)},art=${JSON.stringify(art)};window.api=api;
function makeItem(kind){const type=kind==='tv'?'tv-32':'bar-2m',asset=assets.find(asset=>asset.type===type);return {...asset,id:kind+'-item',modelSize:asset.dimensions.size,options:{variantId:type,variantGroupType:kind+'-variants',variantColorSelections:kind==='bar'?{'finish-choice':{id:'wood'}}:{}}}}
function Test(){const[kind,setKind]=useState('tv'),[pack,setPack]=useState('Confort'),[mode,setMode]=useState('edit'),[item,setItem]=useState(()=>makeItem('tv')),[open,setOpen]=useState(true),[revision,setRevision]=useState(0),[upload,setUpload]=useState({}),[expanded,setExpanded]=useState(false);
const liveAssets=expanded?assets.map(asset=>asset.type==='bar-colors'?{...asset,dimensions:{...asset.dimensions,colorOptions:[...asset.dimensions.colorOptions,...Array.from({length:5},(_,index)=>({id:'more-'+index,name:'Supplément '+index,code:'EX'+index,hex:'#123456'}))]}}:asset):assets;
const entry=api.assetToCatalogEntry(liveAssets.find(asset=>asset.type===kind+'-variants'),liveAssets),patch=(_item,options)=>setItem(value=>({...value,options:{...value.options,...options}}));window.testItem=item;
const start=(nextKind=kind,nextPack=pack,nextMode='edit')=>{setKind(nextKind);setPack(nextPack);setMode(nextMode);setItem(makeItem(nextKind));setOpen(true);setRevision(value=>value+1);setUpload({});setExpanded(false)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}><button onClick={()=>start('tv')}>TV test</button><button onClick={()=>start('bar')}>Bar test</button>{${JSON.stringify(packs)}.map(pack=><button key={pack} onClick={()=>start(kind,pack)}>Pack test {pack}</button>)}<button onClick={()=>{setOpen(true);setRevision(value=>value+1)}}>Reouvrir test</button><button onClick={()=>start(kind,pack,'add')}>Ajouter test</button><button onClick={()=>setUpload({uploading:true})}>Upload test</button><button onClick={()=>setExpanded(true)}>Palette 20 test</button></nav>
{open&&<api.ItemConfiguratorModal key={revision} mode={mode} scene={{id:'tv-bar-design',offer:pack}} entry={entry} item={mode==='edit'?item:null} items={mode==='edit'?[item]:[]} catalog={liveAssets} salonLabel={pack} width={6} depth={4} uploadState={upload}
onUpdateItemOptions={patch} onImageChange={(_item,file,keys)=>{window.lastUpload={name:file.name,keys};patch(_item,api.textureSlotPatch(item,keys.textureSlot,{imageUrl:art,imageName:file.name,visualPending:false}))}}
onClose={()=>setOpen(false)} onConfirm={result=>{window.confirmed=result;setItem({...result.entry,id:kind+'-item',options:result.options});setOpen(false)}}/>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'tv-bar-popup-design-test',
  resolveId(id) { if (id === '/src/__tv-bar-app.jsx') return `${root}src/__tv-bar-app.jsx`; if (id === '/src/__tv-bar-page.jsx') return `${root}src/__tv-bar-page.jsx`; },
  load(id) {
    if (id === `${root}src/__tv-bar-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ItemConfiguratorModal,assetToCatalogEntry,textureSlotPatch,isTelevisionVariantGroupEntry};');
    if (id === `${root}src/__tv-bar-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?tv-bar-original';export async function uploadSceneItemOptionImage(){return ${JSON.stringify(art)}};`;
  },
  configureServer(vite) { vite.middlewares.use('/__tv-bar-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__tv-bar-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 436, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__tv-bar-test__`);
  const tv = page.locator('.tv-variant-modal'), bar = page.locator('.bar-variant-modal');
  await tv.locator('.tv-size-picker button').last().waitFor(); await page.evaluate(() => document.fonts.ready);
  const geometry = async (modal) => modal.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const rect = (target) => { const b = target.getBoundingClientRect(); return { x: b.x - bounds.x, y: b.y - bounds.y, width: b.width, height: b.height }; };
    return { width: bounds.width, height: bounds.height, header: rect(element.querySelector(':scope > header')), sizes: [...element.querySelectorAll('.variant-size-picker button')].map(rect), options: [...element.querySelectorAll('.config-toggle-option')].map(rect), swatches: [...element.querySelectorAll('.counter-finish-swatches button')].map(rect), logo: element.querySelector('.counter-logo-card') ? rect(element.querySelector('.counter-logo-card')) : null, footer: rect(element.querySelector('footer')) };
  });
  const tvGeometry = await geometry(tv); console.log('TV geometry:', JSON.stringify(tvGeometry));
  await tv.screenshot({ path: '/tmp/standing-tv-popup-reference.png' });
  assert.equal(tvGeometry.width, 380); assert.equal(tvGeometry.height, 627); assert.equal(tvGeometry.header.height, 69);
  assert.deepEqual(tvGeometry.options.map((option) => option.height), [73, 94, 73]);
  assert.equal(tvGeometry.sizes.length, 4); assert.ok(tvGeometry.sizes.every((size) => size.height === 64));
  assert.equal(await tv.locator('h2').innerText(), 'TV');
  assert.match(await tv.locator('header small').innerText(), /4 tailles.*3 options/);
  assert.deepEqual(await tv.locator('.tv-size-picker em').allTextContents(), ['637 €', '731 €', '963 €', '1197 €']);
  const details = tv.locator('.product-description-disclosure');
  await details.locator('summary').click(); assert.equal(await details.locator('p').innerText(), description);
  await details.locator('summary').click(); assert.equal(await details.getAttribute('open'), null);
  const option = (name) => tv.getByRole('button', { name: new RegExp(name) });
  await option('Permanence technicien').click(); await option('Vérification').click(); await option('Sur pied').click();
  await tv.locator('.tv-size-picker button').nth(1).click();
  assert.match(await tv.locator('.item-config-footer-total > strong').innerText(), /1.?126 €/);
  await tv.getByRole('button', { name: 'Appliquer', exact: true }).click();
  let saved = await page.evaluate(() => window.confirmed);
  assert.equal(saved.entry.type, 'tv-43'); assert.equal(saved.options.extraOptions.stand, true);
  assert.equal(saved.options.globalExtraOptions.technician, true);
  assert.equal(saved.options.optionReferences.find((ref) => ref.id === 'technician').global, true);
  assert.equal(saved.options.unitPrice, 1126);
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  assert.equal(await option('Sur pied').getAttribute('aria-pressed'), 'true');
  assert.equal(await tv.locator('.tv-size-picker button').nth(1).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Ajouter test', exact: true }).click();
  await tv.locator('.tv-size-picker button').nth(2).click();
  await option('Permanence technicien').click(); await option('Vérification').click();
  await tv.locator('.item-config-quantity button').last().click();
  assert.match(await tv.locator('.item-config-footer-total > strong').innerText(), /2.?376 €/, 'Shared technician fee is not charged twice');
  await tv.getByRole('button', { name: 'Appliquer', exact: true }).click();
  assert.equal((await page.evaluate(() => window.confirmed)).quantity, 2);
  await page.getByRole('button', { name: 'Bar test', exact: true }).click();
  const barGeometry = await geometry(bar); console.log('Bar geometry:', JSON.stringify(barGeometry));
  await bar.screenshot({ path: '/tmp/standing-bar-popup-reference.png' });
  assert.equal(barGeometry.width, 320); assert.equal(barGeometry.height, 586); assert.equal(barGeometry.header.height, 67);
  assert.equal(barGeometry.swatches.length, 15, 'All configured colors, including the free native finish, remain available');
  assert.ok(barGeometry.sizes.every((size) => size.height === 30));
  assert.ok(barGeometry.swatches.every((swatch) => swatch.width === 26));
  assert.equal(barGeometry.logo.width, 284); assert.equal(barGeometry.logo.height, 195);
  assert.match(await bar.locator('header small').first().innerText(), /15 coloris.*3 tailles.*1 option/);
  assert.match(await bar.locator('.counter-logo-card > em').innerText(), /410 €/, 'Existing size-dependent bar logo fee stays unchanged');
  assert.match(await bar.locator('.item-config-footer-total > strong').innerText(), /519 €/);
  await bar.locator('.counter-finish-swatches button').nth(3).click();
  assert.match(await bar.locator('.item-config-footer-total > strong').innerText(), /598 €/);
  await bar.getByRole('checkbox', { name: 'Je fournirai le visuel plus tard', exact: true }).check();
  await bar.locator('input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>') });
  await page.setViewportSize({ width: 436, height: 1700 });
  await bar.locator('.image-framing-controls summary').click();
  await bar.locator('.image-framing-controls input[type=range]').fill('145');
  await bar.locator('.image-framing-controls input[type=range]').press('ArrowRight');
  assert.equal((await page.evaluate(() => window.testItem.options.textureSlotValues.logo)).imageZoom, 1.5);
  assert.equal((await page.evaluate(() => window.testItem.options.textureSlotValues.logo)).visualPending, false);
  await bar.getByRole('button', { name: 'Appliquer', exact: true }).click();
  saved = await page.evaluate(() => window.confirmed);
  assert.equal(saved.entry.type, 'bar-2m'); assert.equal(saved.options.unitPrice, 598);
  assert.equal(saved.options.variantColorSelections['finish-choice'].id, 'finish-2');
  assert.equal(saved.options.textureSlotValues.finish.colorId, 'finish-2');
  assert.equal(saved.options.textureSlotValues.logo.imageZoom, 1.5);
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  await bar.getByRole('checkbox', { name: 'Activer le logo', exact: true }).uncheck();
  assert.equal(await bar.locator('.visual-upload-dropzone').count(), 0);
  assert.equal((await page.evaluate(() => window.testItem.options.textureSlotValues.logo)).imageUrl, '');
  assert.match(await bar.locator('.item-config-footer-total > strong').innerText(), /188 €/);
  await bar.getByRole('checkbox', { name: 'Activer le logo', exact: true }).check();
  await bar.locator('.bar-size-picker button').first().click();
  assert.match(await bar.locator('.counter-logo-card > em').innerText(), /297 €/);
  await page.getByRole('button', { name: 'Palette 20 test', exact: true }).click();
  assert.equal(await bar.locator('.counter-finish-swatches button').count(), 20);
  await bar.locator('.counter-finish-swatches button').last().click();
  assert.equal(await bar.locator('.counter-finish-swatches button').last().getAttribute('aria-pressed'), 'true');
  assert.match(await bar.locator('.counter-finish-head > span').innerText(), /Supplément 4/);
  for (const kind of ['TV', 'Bar']) {
    await page.getByRole('button', { name: `${kind} test`, exact: true }).click();
    const modal = kind === 'TV' ? tv : bar;
    for (const pack of packs) {
      await page.getByRole('button', { name: `Pack test ${pack}`, exact: true }).click();
      assert.equal(await modal.count(), 1, `${kind} design is not restricted by pack`);
    }
    for (const width of [320, 390, 480]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok((await modal.boundingBox()).width <= width - 32);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await modal.getByRole('button', { name: 'Fermer', exact: true }).click(); assert.equal(await modal.count(), 0);
  }
  assert.equal(await page.evaluate(() => window.api.isTelevisionVariantGroupEntry({ type: 'podium', dimensions: { isVariantGroup: true } }, [{ label: 'Podium 50 cm', entry: {} }])), false);
  assert.equal(await page.evaluate(() => window.api.isTelevisionVariantGroupEntry({ type: 'arche-tv', label: 'Arche avec TV', dimensions: { isVariantGroup: true } }, [{ label: 'Arche 5 m', entry: {} }])), false, 'A group mentioning a TV is not necessarily a television group');
  assert.deepEqual(errors, []);
  console.log('TV/bar popups: reference geometry, all packs/mobile, full description, catalog prices, shared TV extras/quantity, color order, bar logo pricing/uploads/framing, texture/reference persistence and reopening OK');
} finally { await browser?.close(); await server.close(); }
