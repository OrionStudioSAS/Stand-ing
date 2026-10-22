import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Confort', 'Prestige', 'Signature', 'Équipé'];
const children = [
  { id: 'front', type: 'partition-fixture', label: 'Cloison', x: 0, z: 0.5, modelSize: [2, 2.5, 0.06] },
  { id: 'door', type: 'door-fixture', label: 'Porte', x: -1, z: 0, rotation: 90, modelSize: [1, 2.5, 0.2] },
];
const reserve = { type: 'reserve-2m2', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children, groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const largeReserve = { ...reserve, type: 'reserve-3m2', label: 'Réserve 3m² arrière gauche', dimensions: { ...reserve.dimensions, groupSize: [3, 2.5, 1] } };
const rails = [3, 2].map((count) => ({ type: `rail-${count}`, label: `Rail LED ${count} spots`, is_active: true, dimensions: { packs, size: [0.9, 0.15, 0.3], mountType: 'wall', isLedSpotOption: true } }));
const podiums = ['Blanc', 'Noir'].flatMap((color) => [50, 75, 100].map((height, index) => ({ type: `podium-${color.toLowerCase()}-${height}`, label: `Podium ${color} ${height} cm`, is_active: true, dimensions: { packs, size: [0.5, height / 100, 0.5], price: [109, 129, 149][index], reference: `P-${color}-${height}`, description: 'Fichiers à fournir 2 semaines avant l’ouverture du salon. Retrouvez tous les détails du produit et les informations techniques.' } })));
const podiumGroup = { type: 'podium-group', label: 'Podium', is_active: true, dimensions: { packs, isVariantGroup: true, variantAssetTypes: podiums.map((asset) => asset.type) } };
const assets = [reserve, largeReserve, ...rails, ...podiums, podiumGroup];
const rule = { includedType: reserve.type, includedLabel: reserve.label, options: [{ type: largeReserve.type, price: 300 }] };
const scene = { id: 'reserve-led-design', offer: 'Confort', dimensions: { width: 5, depth: 3 }, layout: 'left', items: [], options: { autoSpotsRule: { twoSpotType: 'rail-2', threeSpotType: 'rail-3' } }, source_payload: { reserveRules: { small: rule, medium: rule } } };
const harness = `import React,{useState} from'react';import{createRoot}from'react-dom/client';import * as api from'/src/__reserve-led-design-app.jsx';import * as bat from'/src/technicalExport.js';window.api=api;window.bat=bat;
const assets=${JSON.stringify(assets)},original=${JSON.stringify(scene)};window.assets=assets;
function Test(){const[mode,setMode]=useState('reserve'),[options,setOptions]=useState({}),[type,setType]=useState(''),[rail,setRail]=useState(''),[enabled,setEnabled]=useState(true),[disabled,setDisabled]=useState(false),[open,setOpen]=useState(true),[scene,setScene]=useState(original),[revision,setRevision]=useState(0),[item,setItem]=useState(null),[pack,setPack]=useState('Confort');
const entry=api.assetToCatalogEntry(assets.find(asset=>asset.type==='podium-group'),assets);window.cardOptions=options;
const start=(kind)=>{setMode(kind);setOpen(true);setDisabled(false);setRevision(n=>n+1)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999,background:'white'}}>{['reserve','led','podium','scene'].map(kind=><button key={kind} onClick={()=>start(kind)}>Vue {kind}</button>)}<button onClick={()=>setDisabled(v=>!v)}>Lecture seule test</button><button onClick={()=>{setScene(window.savedScene);start('scene')}}>Reouvrir scène</button><button onClick={()=>{setOpen(true);setRevision(n=>n+1)}}>Reouvrir popup</button>{${JSON.stringify(packs)}.map(pack=><button key={pack} onClick={()=>{setPack(pack);setRevision(n=>n+1)}}>Pack {pack}</button>)}</nav>
{mode==='scene'?<api.ConfiguratorApp key={revision} initialScene={scene} isAdminViewer/>:mode==='podium'?(open&&<api.ItemConfiguratorModal key={revision} mode="edit" entry={entry} item={item||{...assets.find(asset=>asset.type==='podium-blanc-50'),id:'podium',options:{variantId:'podium-blanc-50'}}} catalog={assets} items={[]} salonLabel={pack} width={5} depth={3} onClose={()=>setOpen(false)} onConfirm={result=>{window.confirmed=result;setItem({...result.entry,id:'podium',options:result.options});setOpen(false)}}/>):<main style={{width:340,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><api.OptionAccordion open={open} className={mode==='reserve'?'reference-reserve-accordion':'reference-led-accordion'} title={mode==='reserve'?'Réserve':'Spots LED automatiques'} onToggle={()=>setOpen(v=>!v)}>
{mode==='reserve'?<api.ReserveOptionCard rule={${JSON.stringify(rule)}} selectedOptionType={type} options={options} catalog={assets.map(asset=>api.assetToCatalogEntry(asset,assets))} salonLabel="Confort" disabled={disabled} onChange={setType} onOptions={patch=>setOptions(value=>({...value,...patch}))}/>:<api.LedRailOptionCard enabled={enabled} spotCount={5} entries={assets.filter(asset=>asset.type.startsWith('rail-')).map(asset=>api.assetToCatalogEntry(asset,assets))} selectedType={rail} onTypeChange={setRail} disabled={disabled} onEnabledChange={setEnabled}/>}</api.OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-podium-led-design-test',
  resolveId(id) { if (id === '/src/__reserve-led-design-app.jsx') return `${root}src/__reserve-led-design-app.jsx`; if (id === '/src/__reserve-led-design-page.jsx') return `${root}src/__reserve-led-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-led-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,OptionAccordion,ReserveOptionCard,LedRailOptionCard,ItemConfiguratorModal,assetToCatalogEntry,sceneAllAdminItems,itemOptionLines};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.designItems=visibleSceneItems;window.designPricing=scenePricing;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__reserve-led-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?reserve-led-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__reserve-led-design__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__reserve-led-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 388, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:reserve-led-design', 'started'); localStorage.setItem('standing-config-tutorial:reserve-led-design', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-led-design__`);
  const reserveCard = page.locator('.reference-reserve-accordion');
  await reserveCard.locator('.reserve-suboption').last().waitFor(); await page.evaluate(() => document.fonts.ready);
  const geometry = await reserveCard.evaluate((element) => ({ width: element.offsetWidth, header: element.querySelector(':scope > button').offsetHeight, choices: [...element.querySelectorAll('.reserve-choice-card')].map(element=>element.offsetHeight), radios: [...element.querySelectorAll('.reserve-suboption')].map(element=>element.offsetHeight) }));
  assert.deepEqual(geometry, { width: 340, header: 60, choices: [54, 54], radios: [40, 40, 40, 40] });
  await reserveCard.screenshot({ path: '/tmp/standing-reserve-v2.png' });
  await reserveCard.getByRole('button', { name: 'Tirante', exact: true }).click();
  await reserveCard.getByRole('button', { name: 'Droite', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.cardOptions), { doorOpening: 'pull', handleOrientation: 'right' });
  await reserveCard.getByRole('button', { name: /Supprimer la réserve/ }).click(); assert.equal(await reserveCard.locator('.reserve-suboption').count(), 0);
  await reserveCard.getByRole('button', { name: /Remettre la réserve/ }).click(); assert.equal(await reserveCard.getByRole('button', { name: 'Tirante', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Lecture seule test', exact: true }).click(); assert.equal(await reserveCard.locator('.reserve-choice-panel button:not(:disabled)').count(), 0);
  await page.getByRole('button', { name: 'Vue led', exact: true }).click();
  const ledCard = page.locator('.reference-led-accordion');
  await ledCard.screenshot({ path: '/tmp/standing-led-v2.png' });
  assert.ok(Math.abs((await ledCard.boundingBox()).height - 312) <= 4);
  assert.equal(await ledCard.locator('.led-rail-choice').count(), 2);
  await ledCard.getByRole('button', { name: /Rail · 2/ }).click(); assert.equal(await ledCard.getByRole('button', { name: /Rail · 2/ }).getAttribute('aria-pressed'), 'true');
  assert.match(await ledCard.locator('.led-info-box').innerText(), /6 spots installés/);
  await ledCard.getByRole('button', { name: /Supprimer les Spots LED/ }).click(); assert.equal(await ledCard.locator('.led-rail-choice:not(:disabled)').count(), 0);
  await ledCard.getByRole('button', { name: /Remettre les Spots LED/ }).click();
  await page.getByRole('button', { name: 'Vue podium', exact: true }).click();
  const podium = page.locator('.podium-variant-modal');
  await podium.locator('.podium-color-picker button').last().waitFor();
  assert.equal((await podium.boundingBox()).width, 320);
  assert.match(await podium.locator('header small').innerText(), /2 coloris · 3 hauteurs/);
  await podium.screenshot({ path: '/tmp/standing-podium-v2.png' });
  await podium.locator('.product-description-disclosure summary').click(); assert.match(await podium.locator('.product-description-disclosure p').innerText(), /informations techniques/);
  await podium.locator('.product-description-disclosure summary').click();
  await podium.getByRole('button', { name: '75 cm', exact: true }).click(); await podium.getByRole('button', { name: 'Noir', exact: true }).click();
  assert.equal(await podium.getByRole('button', { name: '75 cm', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await podium.locator('.item-config-footer-total').innerText(), /129 €/);
  await podium.getByRole('button', { name: 'Appliquer', exact: true }).click();
  assert.equal((await page.evaluate(() => window.confirmed)).entry.type, 'podium-noir-75');
  await page.getByRole('button', { name: 'Reouvrir popup', exact: true }).click(); assert.equal(await podium.getByRole('button', { name: 'Noir', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const pack of packs) { await page.getByRole('button', { name: `Pack ${pack}`, exact: true }).click(); assert.equal(await podium.count(), 1); }
  for (const width of [320, 390, 480]) { await page.setViewportSize({ width, height: 1000 }); assert.ok((await podium.boundingBox()).width <= width - 32); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Vue scene', exact: true }).click();
  await page.waitForFunction(() => window.designItems?.some(item=>item.autoReserve));
  await page.getByRole('button', { name: /^Réserve/ }).click();
  const reserveGeometry = () => page.evaluate(() => { const item=window.designItems.find(item=>item.autoReserve); return JSON.stringify({x:item.x,z:item.z,rotation:item.rotation,children:item.children}); });
  const before = await reserveGeometry();
  await reserveCard.getByRole('button', { name: 'Poussante', exact: true }).click(); await reserveCard.getByRole('button', { name: 'Gauche', exact: true }).click();
  await page.waitForFunction(() => window.savedScene?.options.reserveOptions.handleOrientation==='left');
  assert.equal(await reserveGeometry(), before, 'Door preferences do not move or resize any geometry');
  const exported = await page.evaluate(async () => { const catalog=window.assets.map(asset=>window.api.assetToCatalogEntry(asset,window.assets));const items=window.api.sceneAllAdminItems(window.savedScene,catalog);const reserve=items.find(item=>item.autoReserve);const pages=await window.bat.createTechnicalPlanSvgPages({width:5,depth:3,layout:'left',items,catalog});return {lines:window.api.itemOptionLines(reserve),svg:pages.map(page=>page.textContent).join('')}; });
  assert.ok(exported.lines.includes('Ouverture de porte : Poussante')); assert.ok(exported.lines.includes('Orientation de la poignée : Gauche'));
  assert.match(exported.svg, /Ouverture de porte : Poussante/); assert.match(exported.svg, /Orientation de la poignée : Gauche/);
  await page.locator('.stepper button').nth(3).click();
  const recap = page.locator('.validation-modern-row').filter({ has: page.locator('.validation-modern-row-copy > strong').filter({ hasText: /^Réserve$/ }) });
  assert.match(await recap.innerText(), /Poussante · poignée gauche/);
  await page.locator('.stepper button').nth(1).click();
  const totalBeforeRailChange = await page.evaluate(() => window.designPricing.total);
  await page.getByRole('button', { name: /^Spots LED automatiques/ }).click(); await ledCard.getByRole('button', { name: /Rail · 2/ }).click();
  await page.waitForFunction(() => window.savedScene?.options.ledRailType==='rail-2');
  assert.equal(await page.evaluate(() => window.designItems.filter(item=>item.autoSpot).every(item=>item.type==='rail-2')), true);
  assert.equal(await page.evaluate(() => window.designPricing.total), totalBeforeRailChange, 'Changing included rails does not add a supplement');
  await page.getByRole('button', { name: 'Reouvrir scène', exact: true }).click();
  await page.getByRole('button', { name: /^Réserve/ }).click(); assert.equal(await reserveCard.getByRole('button', { name: 'Poussante', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: /^Spots LED automatiques/ }).click(); assert.equal(await ledCard.getByRole('button', { name: /Rail · 2/ }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => {const catalog=window.assets.map(asset=>window.api.assetToCatalogEntry(asset,window.assets));return window.api.sceneAllAdminItems(window.savedScene,catalog).filter(item=>item.autoSpot).every(item=>item.type==='rail-2');}), true);
  assert.equal(await page.evaluate(() => {const catalog=window.assets.map(asset=>window.api.assetToCatalogEntry(asset,window.assets));const scene={...window.savedScene,options:{...window.savedScene.options,ledRailType:'removed-asset'}};return new Set(window.api.sceneAllAdminItems(scene,catalog).filter(item=>item.autoSpot).map(item=>item.type)).size;}), 2, 'Stale rail choices fall back to the pack’s automatic composition');
  assert.deepEqual(errors, []);
  console.log('Reserve, podium and LED references: geometry, read-only, variants/prices, persistence, unchanged reserve geometry, cart and generated BAT metadata OK');
} finally { await browser?.close(); await server.close(); }
