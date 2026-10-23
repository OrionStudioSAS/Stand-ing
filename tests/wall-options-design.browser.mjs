import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="248" height="250"><defs><linearGradient id="g"><stop stop-color="#3268a4"/><stop offset=".5" stop-color="#4fbac4"/><stop offset="1" stop-color="#e7b666"/></linearGradient></defs><path fill="url(#g)" d="M0 0H248V250H0Z"/></svg>');
const hexes = ['#f4f4f2', '#ba2334', '#243d88', '#bfc0c3', '#e5d7b5', '#927f6c', '#a89b8b', '#f5d72c', '#ed8a22', '#e73379', '#762c36', '#682e7e', '#a5d533', '#38a56f', '#225d48', '#4dbbc4', '#36779e', '#1b275c', '#858585', '#393c3d', '#151515'];
const colors = hexes.map((hex, index) => ({ id: `fabric-${index}`, name: index === 17 ? 'Nuit' : `Coton ${index}`, code: index === 17 ? '187' : `F${index}`, hex, included: index < 4, isFree: index < 4, isDefault: index === 0, price: index < 4 ? 0 : 11 }));
const surfaces = [
  { id: 'back-left', label: 'Cloison arrière gauche', kind: 'wall', sourceWall: 'back', wall: 'back', width: 2.48, height: 2.5, position: [-1.25, 1.25, -1.75], rotation: 0 },
  { id: 'back-right', label: 'Cloison arrière droite', kind: 'wall', sourceWall: 'back', wall: 'back', width: 2.4, height: 2.5, position: [1.25, 1.25, -1.75], rotation: 0 },
  { id: 'left', label: 'Cloison gauche', kind: 'wall', wall: 'left', width: 3.39, height: 2.5, position: [-2.5, 1.25, 0], rotation: Math.PI / 2 },
  { id: 'right', label: 'Cloison droite', kind: 'wall', wall: 'right', width: 3.39, height: 2.5, position: [2.5, 1.25, 0], rotation: -Math.PI / 2 },
  { id: 'reserve-front', label: 'Cloison réserve extérieure 1', kind: 'reserve', sourceWall: 'reserve', wall: 'reserve', width: 2, height: 2.5, position: [1.5, 1.25, -.75], rotation: 0 },
  { id: 'reserve-side', label: 'Cloison réserve extérieure 2', kind: 'reserve', sourceWall: 'reserve', wall: 'reserve', width: 1, height: 2.5, position: [.5, 1.25, -1.25], rotation: Math.PI / 2 },
];
const packs = ['Confort', 'Prestige', 'Équipé', 'Signature', 'SIAE', 'Autre'];
const reserve = { type: 'reserve-fixture', label: 'Réserve', is_active: true, dimensions: { isGroup: true, isReserve: true, groupSize: [2, 2.5, 1], packs, children: [
  { id: 'front', type: 'cloison-front', label: 'Cloison avant', x: 0, z: .47, dimensions: { size: [2, 2.5, .06] }, modelSize: [2, 2.5, .06] },
  { id: 'side', type: 'cloison-side', label: 'Cloison latérale', x: -.97, z: 0, rotation: 90, dimensions: { size: [1, 2.5, .06] }, modelSize: [1, 2.5, .06] },
  { id: 'door', type: 'porte-reserve', label: 'Porte réserve', x: .97, z: 0, rotation: 90, dimensions: { size: [1, 2.5, .3] }, modelSize: [1, 2.5, .3] },
] } };
const assets = [reserve, { type: 'fabric-palette', label: 'Coton gratté', is_active: true, dimensions: { isColorGroup: true, packs, colorUsages: ['wallFabric'], colorOptions: colors } }];
const scene = { id: 'wall-options', offer: 'Confort', event_name: 'SMCL 2026', dimensions: { width: 5, depth: 4 }, layout: 'u', items: [], options: { ledRailsEnabled: false, wallFabricColorId: 'fabric-17' }, source_payload: {} };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import * as api from'/src/__wall-options-app.jsx';window.api=api;
const surfaces=${JSON.stringify(surfaces)},colors=${JSON.stringify(colors)},art=${JSON.stringify(art)},assets=${JSON.stringify(assets)},original=${JSON.stringify(scene)};window.assets=assets;
function Test(){const[mode,setMode]=useState('card'),[revision,setRevision]=useState(0),[covers,setCovers]=useState({}),[previews,setPreviews]=useState({}),[color,setColor]=useState(colors[17]),[disabled,setDisabled]=useState(false),[open,setOpen]=useState(true),[scene,setScene]=useState(original),[layout,setLayout]=useState('u');window.wallModel={covers,previews,color};
const toggle=(id,enabled,sourceWall)=>setCovers(value=>({...value,...(!enabled&&sourceWall&&value[sourceWall]?.enabled?{[sourceWall]:{...value[sourceWall],enabled:false}}:{}),[id]:{...value[id],enabled}}));
const reset=()=>{setCovers({});setPreviews({});setColor(colors[17]);setRevision(v=>v+1);setDisabled(false);setOpen(true);setMode('card')};
const actualScene=(pack=scene.offer)=>{const entry=api.assetToCatalogEntry(assets[0],assets);setScene({...original,offer:pack,layout,items:[{...entry,id:'manual-reserve',x:1.4,z:-1.45,rotation:0,options:{}}]});setMode('scene');setRevision(v=>v+1)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:99999,background:'white'}}><button onClick={reset}>Reset carte</button><button onClick={()=>{reset();setCovers({'back-left':{enabled:true,previewUrl:art,previewName:'visuel-fond-gauche.pdf'},'back-right':{enabled:true,visualPending:true}});setPreviews({'back-left':{url:art,name:'visuel-fond-gauche.pdf'}});setRevision(v=>v+1)}}>Deux actives</button><button onClick={()=>setDisabled(v=>!v)}>Lecture seule</button><button onClick={()=>setPreviews(value=>({...value,'back-right':{url:art,name:'erreur.png',uploadError:true}}))}>Erreur import</button><button onClick={()=>actualScene()}>Scène complète</button><button onClick={()=>{setScene(window.savedScene);setRevision(v=>v+1)}}>Reouvrir scène</button>{${JSON.stringify(packs)}.map(pack=><button key={pack} onClick={()=>actualScene(pack)}>Pack {pack}</button>)}{['left','back','right','u'].map(value=><button key={value} onClick={()=>{setScene(current=>({...current,layout:value}));setLayout(value);setRevision(v=>v+1)}}>Implantation {value}</button>)}</nav>
{mode==='scene'?<api.ConfiguratorApp key={revision} initialScene={scene} isAdminViewer forceReadOnly={disabled}/>:<main style={{width:360,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><api.OptionAccordion className="wall-section-accordion" title="Cloisons" subtitle={api.wallSectionSubtitle(surfaces,covers,color,(key,vars)=>key==='wall_section_active_count'?vars.count+' bâches imprimées':key==='wall_section_wall_count'?vars.count+' cloisons':key==='wall_section_fabric'?'Coton gratté':'Bâches')} icon={<api.ConfiguratorOptionIcon src="/icons/cloison.svg"/>} open={open} onToggle={()=>setOpen(value=>!value)}>
<api.WallOptionsPanel key={revision} standWidth={5} standDepth={3.5} surfaces={surfaces} colors={colors} selectedColor={color} area={18.82} covers={covers} previews={previews} includedMl={3} disabled={disabled} onSelectColor={id=>setColor(colors.find(color=>color.id===id))} onToggle={toggle} onApply={()=>setOpen(false)}
onPreview={(id,file)=>{window.lastWallUpload={id,name:file.name};setPreviews(value=>({...value,[id]:{url:art,name:file.name}}));setCovers(value=>({...value,[id]:{...value[id],enabled:true,visualPending:false,previewUrl:art,previewName:file.name}}))}}
onPreviewReset={id=>{setPreviews(value=>({...value,[id]:null}));setCovers(value=>({...value,[id]:{...value[id],previewUrl:'',previewName:''}}))}}
onPending={(id,visualPending)=>setCovers(value=>({...value,[id]:{...value[id],visualPending}}))}
onFramingChange={(id,framing)=>{setPreviews(value=>({...value,[id]:{...value[id],...framing}}));setCovers(value=>({...value,[id]:{...value[id],...framing}}))}}/>
</api.OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'wall-options-design-test',
  resolveId(id) { if (id === '/src/__wall-options-app.jsx') return `${root}src/__wall-options-app.jsx`; if (id === '/src/__wall-options-page.jsx') return `${root}src/__wall-options-page.jsx`; },
  load(id) {
    if (id === `${root}src/__wall-options-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,WallOptionsPanel,OptionAccordion,ConfiguratorOptionIcon,wallSectionSubtitle,assetToCatalogEntry,sceneAllAdminItems};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.wallPricing=scenePricing;window.actualWallSurfaces=wallCoverSurfaces;window.wallSceneItems=visibleSceneItems;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__wall-options-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?wall-options-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}export async function uploadSceneItemOptionImage(){return ${JSON.stringify(art)}};`;
  },
  configureServer(vite) { vite.middlewares.use('/__wall-options__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__wall-options-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 1800 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:wall-options', 'started'); localStorage.setItem('standing-config-tutorial:wall-options', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__wall-options__`);
  const card = page.locator('.wall-section-accordion');
  const tab = (name) => card.getByRole('tab', { name: new RegExp(name) });
  const rows = card.locator('.wall-options-cover');
  await card.locator('.wall-fabric-swatches button').last().waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await card.locator('.wall-map-number').count(), 6);
  assert.equal(await card.locator('.wall-fabric-swatches button').count(), 21);
  assert.deepEqual(await card.locator('.wall-fabric-swatches button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label'))), colors.map(color=>`${color.name} (${color.code})`));
  assert.equal(await card.locator('.wall-options-footer').count(), 0);
  assert.doesNotMatch(await card.innerText(), /Suppléments HT/);
  assert.match(await card.locator('.wall-fabric-palette-group').last().innerText(), /207 €/);
  const geometry = await card.evaluate(element=>({width:element.offsetWidth,header:element.querySelector(':scope > button').offsetHeight,swatches:[...element.querySelectorAll('.wall-fabric-swatches button')].map(button=>button.offsetWidth)}));
  assert.equal(geometry.width, 360); assert.equal(geometry.header, 62); assert.ok(geometry.swatches.every(width=>width===26));
  await card.screenshot({ path: '/tmp/standing-cloisons-fabric.png' });
  await card.getByRole('button', { name: 'Coton 1 (F1)', exact: true }).click();
  assert.equal(await page.evaluate(() => window.wallModel.color.id), 'fabric-1');
  assert.equal(await card.locator('.wall-options-footer').count(), 0);
  await tab('Bâches').click(); assert.equal(await rows.count(), 6); assert.equal(await rows.locator('input[type=file]').count(), 0, 'Inactive banners remain compact');
  await tab('Coton gratté').click(); await tab('Coton gratté').press('ArrowRight'); assert.equal(await tab('Bâches').getAttribute('aria-selected'), 'true');
  await rows.first().getByRole('switch').check();
  assert.match(await rows.first().innerText(), /2480 × 2500 mm/); assert.match(await rows.first().locator('.wall-options-cover-heading').innerText(), /Inclus/);
  await rows.first().getByRole('checkbox', { name: 'Je fournirai le visuel plus tard', exact: true }).check();
  await rows.first().locator('input[type=file]').setInputFiles({ name: 'fond.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="248" height="250"/>') });
  assert.equal((await page.evaluate(()=>window.wallModel.covers['back-left'])).visualPending, false);
  assert.match(await rows.first().innerText(), /Visuel importé/); assert.doesNotMatch(await rows.first().innerText(), /Format conforme/);
  await rows.first().locator('.image-framing-controls summary').click();
  await rows.first().locator('.image-framing-controls input[type=range]').fill('145'); await rows.first().locator('.image-framing-controls input[type=range]').press('ArrowRight');
  assert.equal((await page.evaluate(()=>window.wallModel.covers['back-left'])).imageZoom, 1.5);
  assert.equal(Number(await card.locator('.wall-options-map g[data-surface-id="back-left"] image').getAttribute('width')), 2.48 * 1.5, 'The map reflects the selected image framing');
  await rows.first().getByRole('button', { name: /Retirer l’aperçu/ }).click(); assert.equal(await rows.first().locator('.wall-cover-format').count(), 1);
  await page.setViewportSize({width:408,height:3200});
  await card.getByRole('button', { name: 'Activer sur toutes les cloisons', exact: true }).click(); assert.equal(await rows.getByRole('switch', { checked: true }).count(), 6);
  await card.getByRole('button', { name: 'Désactiver sur toutes les cloisons', exact: true }).click(); assert.equal(await rows.getByRole('switch', { checked: true }).count(), 0);
  await tab('Coton gratté').click(); await card.getByRole('button', { name: /Repérer la cloison 3/ }).click();
  assert.equal(await tab('Bâches').getAttribute('aria-selected'), 'true'); assert.match(await rows.nth(2).getAttribute('class'), /located/); assert.equal(await rows.getByRole('switch', { checked: true }).count(), 0, 'Map navigation does not purchase or activate a banner');
  await page.getByRole('button', { name: 'Deux actives', exact: true }).click(); await rows.first().waitFor();
  assert.equal(await rows.getByRole('switch', { checked: true }).count(), 2);
  await card.screenshot({ path: '/tmp/standing-cloisons-banners.png' });
  assert.match(await card.locator('.wall-options-allowance').innerText(), /3 ml.*288 €/);
  const droppedFile = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'visuel-depose.svg', { type: 'image/svg+xml' })); return transfer; });
  await rows.nth(1).locator('.wall-options-upload').dispatchEvent('drop', { dataTransfer: droppedFile });
  assert.deepEqual(await page.evaluate(()=>window.lastWallUpload), { id: 'back-right', name: 'visuel-depose.svg' });
  await droppedFile.dispose();
  const second = rows.nth(1); await page.getByRole('button', { name: 'Erreur import', exact: true }).click(); assert.equal(await second.getByRole('alert').count(), 1);
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click(); assert.equal(await rows.getByRole('switch', { disabled: false }).count(), 0); assert.equal(await card.locator('input[type=file]:not(:disabled)').count(), 0);
  await tab('Coton gratté').click(); assert.equal(await card.locator('.wall-fabric-swatches button:not(:disabled)').count(), 0);
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  for (const width of [320, 390, 480]) { await page.setViewportSize({ width, height: 1800 }); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); }
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const pack of packs) {
    await page.getByRole('button', { name: `Pack ${pack}`, exact: true }).click();
    await page.getByRole('button', { name: /^Cloisons/ }).click(); await card.locator('.wall-options-map').waitFor();
    assert.equal(await card.locator('.wall-fabric-selector').count(), 1, `${pack} uses the same partition selector`);
    assert.doesNotMatch(await card.innerText(), /Suppléments HT/);
  }
  for (const layout of ['left','back','right','u']) {
    await page.getByRole('button', { name: `Implantation ${layout}`, exact: true }).click(); await page.getByRole('button', { name: /^Cloisons/ }).click();
    const ids=await page.evaluate(()=>window.actualWallSurfaces.map(surface=>surface.id));
    assert.deepEqual(await card.locator('.wall-options-map g[data-surface-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.surfaceId).sort()),ids.toSorted());
  }
  const geometryBefore=await page.evaluate(()=>JSON.stringify(window.wallSceneItems.find(item=>item.id==='manual-reserve')));
  await tab('Bâches').click(); await card.getByRole('button', { name: 'Activer sur toutes les cloisons', exact: true }).click();
  await page.waitForFunction(()=>window.savedScene?.options.wallCovers&&window.actualWallSurfaces.every(surface=>window.savedScene.options.wallCovers[surface.id]?.enabled));
  const saved=await page.evaluate(()=>({covers:window.savedScene.options.wallCovers,ids:window.actualWallSurfaces.map(surface=>surface.id),pricing:window.wallPricing.lines.find(line=>line.type==='wall-cover')}));
  assert.deepEqual(Object.keys(saved.covers).sort(),saved.ids.toSorted(),'Only the existing allowed surfaces can be enabled');
  assert.ok(!saved.ids.some(id=>/porte|door|interieur|interior/.test(id)));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.wallSceneItems.find(item=>item.id==='manual-reserve'))),geometryBefore);
  assert.equal(saved.pricing.unitPrice,288);
  const firstId=saved.ids[0]; const firstRealRow=rows.first();
  await firstRealRow.getByRole('checkbox', { name: 'Je fournirai le visuel plus tard', exact: true }).check();
  await firstRealRow.locator('input[type=file]').setInputFiles({name:'nouveau-visuel.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"/>')});
  await page.waitForFunction(id=>window.savedScene?.options.wallCovers[id]?.previewName==='nouveau-visuel.svg'&&!window.savedScene.options.wallCovers[id].visualPending,firstId);
  await firstRealRow.locator('.image-framing-controls summary').click(); await firstRealRow.locator('.image-framing-controls input[type=range]').fill('145'); await firstRealRow.locator('.image-framing-controls input[type=range]').press('ArrowRight');
  await page.waitForFunction(id=>window.savedScene?.options.wallCovers[id]?.imageZoom===1.5,firstId);
  await page.getByRole('button', {name:'Reouvrir scène',exact:true}).click(); await page.getByRole('button',{name:/^Cloisons/}).click();
  assert.equal(await tab('Bâches').getAttribute('aria-selected'),'true'); assert.match(await rows.first().innerText(),/nouveau-visuel.svg/);
  assert.equal(await rows.first().getByRole('checkbox',{name:'Je fournirai le visuel plus tard',exact:true}).isChecked(),false);
  await tab('Coton gratté').click(); await card.getByRole('button',{name:'Appliquer',exact:true}).click(); assert.equal(await card.locator('.wall-options-panel').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Partitions: reference layout, exact palette order, tabs/map/numbered eligible faces, bulk toggles, real pricing, uploads/errors/framing, read-only/mobile, all packs/layouts, unchanged reserve geometry and save/reopen OK');
} finally { await browser?.close(); await server.close(); }
