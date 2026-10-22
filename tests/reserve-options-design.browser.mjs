import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature', 'Équipé', 'Confort', 'Prestige', 'SIAE', 'Autre'];
const groups = [1, 2, 3].map(area => ({ type: `reserve-${area}`, label: `Réserve ${area}m² arrière gauche`, is_active: true, dimensions: {
  isGroup: true, isReserve: true, packs, groupSize: [area, 2.5, 1], placementRule: { id: 'back-left', locked: true },
  children: [{ id: 'wall', type: 'cloison', label: 'Cloison', x: 0, z: .47, modelSize: [area, 2.5, .06], dimensions: { size: [area, 2.5, .06] } },
    { id: 'door', type: 'porte', label: 'Porte + poignée droite', x: area / 2 - .05, z: 0, rotation: 90, modelSize: [1, 2.5, .24], dimensions: { size: [1, 2.5, .24] } },
    ...['Bloc 3 étagères', 'Miroir', 'Multiprise', 'Patère'].map((label, i) => ({ id: `equipment-${i}`, type: `equipment-${i}`, label, x: 0, z: 0, modelSize: [.2, .2, .2], dimensions: { size: [.2, .2, .2] } }))],
} }));
const meters = ['Blanc', 'Noir'].map(label => ({ type: `cache-compteur-${label}`, label: `Cache Compteur ${label}`, is_active: true, dimensions: { size: [.5, .75, .5], packs, color: label === 'Blanc' ? '#eeeeee' : '#222222' } }));
const assets = [...groups, ...meters];
const rule = { includedType: groups[1].type, includedLabel: groups[1].label, options: [{ type: groups[0].type, label: groups[0].label, price: 0 }, { type: groups[2].type, label: groups[2].label, price: 222 }] };
const scene = { id: 'reserve-design', offer: 'Signature', dimensions: { width: 8, depth: 4 }, layout: 'left', items: [], options: { ledRailsEnabled: false }, source_payload: { reserveRules: { 'signature-none': {}, small: {}, medium: rule, large: rule, 'signature-2m2': rule } } };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import*as api from'/src/__reserve-design-app.jsx';window.api=api;
const assets=${JSON.stringify(assets)},rule=${JSON.stringify(rule)},original=${JSON.stringify(scene)};window.testCatalog=assets;
function Test(){const[mode,setMode]=useState('card'),[key,setKey]=useState(0),[pack,setPack]=useState('Signature'),[area,setArea]=useState(32),[available,setAvailable]=useState(true),[optional,setOptional]=useState(false),[disabled,setDisabled]=useState(false),[type,setType]=useState(''),[options,setOptions]=useState({}),[meter,setMeter]=useState(assets[3]),[scene,setScene]=useState(original),[open,setOpen]=useState(true);
window.reserveUiState={type,options,meter};const useScene=(pack,area=32)=>{setScene({...original,offer:pack,dimensions:area===32?original.dimensions:{width:area/2.5,depth:2.5}});setKey(n=>n+1);setMode('scene')};
const cardRule=available?(optional?{options:[{type:'reserve-3',label:'Réserve 3m²',price:222}]}:rule):{};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:99999,background:'white'}}><button onClick={()=>{setMode('card');setAvailable(true);setOptional(false);setArea(32);setType('');setOpen(true);setDisabled(false)}}>Carte</button><button onClick={()=>{setMode('card');setAvailable(false);setArea(10);setType('');setOpen(true)}}>Sans réserve</button><button onClick={()=>setOptional(true)}>Option seulement</button><button onClick={()=>setDisabled(v=>!v)}>Lecture seule</button><button onClick={()=>{setScene(window.savedScene);setKey(n=>n+1)}}>Reouvrir</button>{[8,9,14.99,15].map(area=><button key={area} onClick={()=>useScene('Signature',area)}>Surface {area}</button>)}{${JSON.stringify(packs)}.map(pack=><React.Fragment key={pack}><button onClick={()=>setPack(pack)}>Carte {pack}</button><button onClick={()=>useScene(pack)}>Scène {pack}</button><button onClick={()=>useScene(pack,10)}>Sans réserve {pack}</button></React.Fragment>)}</nav>
{mode==='scene'?<api.ConfiguratorApp key={key} initialScene={scene} isAdminViewer forceReadOnly={disabled}/>:<main style={{width:340,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><api.OptionAccordion className="reserve-section-accordion" title={<>Réserve{!available&&<em className="reserve-unavailable-badge">Non disponible</em>}</>} subtitle={available?'Taille · Porte · Aménagement':'Cache-compteur inclus'} ariaLabel="Réserve" open={open} onToggle={()=>setOpen(v=>!v)} icon={<api.ConfiguratorOptionIcon src="/icons/reserve.svg"/>}><api.ReserveOptionCard rule={cardRule} selectedOptionType={type} options={options} catalog={assets.map(asset=>api.assetToCatalogEntry(asset,assets))} salonLabel={pack} isSignatureStand={pack==='Signature'} area={area} meterCoverItem={meter} disabled={disabled} onChange={setType} onOptions={patch=>setOptions(value=>({...value,...patch}))} onMeterCoverChange={type=>setMeter(assets.find(asset=>asset.type===type))} onOpenShop={()=>window.shopOpened=true}/></api.OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-options-design',
  resolveId(id) { if (id === '/src/__reserve-design-app.jsx') return `${root}src/__reserve-design-app.jsx`; if (id === '/src/__reserve-design-page.jsx') return `${root}src/__reserve-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reserve-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,OptionAccordion,ConfiguratorOptionIcon,ReserveOptionCard,assetToCatalogEntry,sceneAllAdminItems};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.actualReserveItems=visibleSceneItems;window.actualReserveCatalog=availableCatalog;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__reserve-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?reserve-design-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__reserve-design__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__reserve-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 1500 } });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:reserve-design', 'started'); localStorage.setItem('standing-config-tutorial:reserve-design', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-design__`);
  const card = page.locator('.reserve-section-accordion');
  const choose = (area) => card.locator('.reserve-choice-card').filter({ hasText: `${area} m²` });
  await choose(2).waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await card.locator('.reserve-choice-card').count(), 3);
  assert.equal(await choose(2).getAttribute('aria-pressed'), 'true');
  assert.equal(await card.locator('.reserve-detail-row').count(), 3);
  assert.match(await card.innerText(), /Coin arrière gauche/);
  assert.match(await card.innerText(), /Poignée droite/);
  assert.match(await card.innerText(), /4 objets/);
  assert.equal(await card.locator('.reserve-meter-selector').count(), 0);
  assert.equal(await card.locator(':scope > button').evaluate(el => el.offsetHeight), 62);
  const widths = await card.locator('.reserve-choice-card').evaluateAll(elements => elements.map(el => el.offsetWidth));
  assert.ok(Math.max(...widths) - Math.min(...widths) < 2);
  await card.screenshot({ path: '/tmp/standing-reserve-new-design.png' });
  await choose(3).click(); assert.equal(await page.evaluate(() => window.reserveUiState.type), 'reserve-3');
  assert.match(await choose(3).innerText(), /222 €/);
  await card.locator('.reserve-detail-expander').first().locator('summary').click();
  await card.getByRole('button', { name: 'Tirante', exact: true }).click();
  await card.getByRole('button', { name: 'Gauche', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.reserveUiState.options), { doorOpening: 'pull', handleOrientation: 'left' });
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  assert.equal(await card.locator('.reserve-choice-card:not(:disabled), .reserve-suboption:not(:disabled), .reserve-remove-button:not(:disabled)').count(), 0);
  await page.setViewportSize({ width: 320, height: 1500 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 408, height: 1500 });
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  await card.getByRole('button', { name: 'Supprimer la réserve', exact: true }).click();
  assert.equal(await card.locator('.reserve-detail-list').count(), 0);
  await card.getByRole('button', { name: 'Remettre la réserve', exact: true }).click();
  assert.equal(await choose(2).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Option seulement', exact: true }).click();
  assert.equal(await card.locator('.reserve-unavailable-notice').count(), 0, 'Optional storage stays available without an included reserve');
  await choose(3).click(); await card.getByRole('button', { name: 'Supprimer la réserve', exact: true }).click(); await card.getByRole('button', { name: 'Remettre la réserve', exact: true }).click();
  assert.equal(await choose(3).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Sans réserve', exact: true }).click();
  assert.equal(await card.locator('.reserve-choice-card').count(), 0);
  assert.equal(await card.locator('.reserve-meter-choices > button').count(), 2);
  assert.match(await card.locator('.reserve-unavailable-notice').innerText(), /10 m²/);
  await card.screenshot({ path: '/tmp/standing-reserve-no-storage.png' });
  await card.locator('.reserve-meter-choices > button').filter({ hasText: 'Noir' }).click();
  assert.equal(await page.evaluate(() => window.reserveUiState.meter.type), meters[1].type);
  await card.locator('.reserve-shop-section button').click(); assert.equal(await page.evaluate(() => window.shopOpened), true);
  for (const pack of packs.filter(pack => pack !== 'Signature')) {
    await page.getByRole('button', { name: `Carte ${pack}`, exact: true }).click();
    assert.equal(await card.locator('.reserve-meter-selector').count(), 0, pack);
    assert.equal(await card.locator('.reserve-unavailable-notice').count(), 1);
  }
  await page.getByRole('button', { name: 'Carte Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  assert.equal(await card.locator('.reserve-meter-choices > button:not(:disabled)').count(), 0);
  await page.setViewportSize({ width: 320, height: 1500 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();

  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const pack of packs) {
    await page.getByRole('button', { name: `Scène ${pack}`, exact: true }).click();
    await page.waitForFunction(() => window.actualReserveItems?.some(item => item.autoReserve));
    await page.getByRole('button', { name: 'Réserve', exact: true }).click();
    assert.ok(await card.locator('.reserve-choice-card').count() >= 2, pack);
    assert.equal(await card.locator('.reserve-meter-selector').count(), 0, pack);
    if (pack === 'Signature') {
      await choose(3).click();
      await card.locator('.reserve-detail-expander').first().locator('summary').click();
      await card.getByRole('button', { name: 'Tirante', exact: true }).click();
      await card.getByRole('button', { name: 'Gauche', exact: true }).click();
      await page.waitForFunction(() => window.savedScene?.options?.reserveOptions?.handleOrientation === 'left');
      const current = await page.evaluate(() => ({ item: window.actualReserveItems.find(item => item.autoReserve), bat: window.api.sceneAllAdminItems(window.savedScene, window.actualReserveCatalog).find(item => item.autoReserve) }));
      assert.equal(current.item.type, groups[2].type); assert.equal(current.item.options.unitPrice, 222);
      assert.equal(current.item.options.reserveDoorOpening, 'pull'); assert.equal(current.bat.options.reserveHandleOrientation, 'left');
      assert.deepEqual(current.item.children, current.bat.children);
      await page.getByRole('button', { name: 'Reouvrir', exact: true }).click();
      await page.getByRole('button', { name: 'Réserve', exact: true }).click();
      assert.equal(await choose(3).getAttribute('aria-pressed'), 'true');
      assert.match(await card.innerText(), /Tirante · Poignée gauche/);
    }
    await page.getByRole('button', { name: `Sans réserve ${pack}`, exact: true }).click();
    await page.getByRole('button', { name: 'Réserve', exact: true }).click();
    await page.waitForFunction(() => window.actualReserveCatalog?.length > 0);
    assert.equal(await card.locator('.reserve-meter-selector').count(), pack === 'Signature' ? 1 : 0, pack);
  }
  for (const area of [8, 9, 14.99, 15]) {
    await page.getByRole('button', { name: `Surface ${area}`, exact: true }).click();
    await page.getByRole('button', { name: 'Réserve', exact: true }).click();
    await page.waitForFunction(() => window.actualReserveCatalog?.length > 0);
    assert.equal(await card.locator('.reserve-meter-selector').count(), area >= 9 && area < 15 ? 1 : 0, String(area));
  }
  await page.getByRole('button', { name: 'Surface 9', exact: true }).click();
  await page.getByRole('button', { name: 'Réserve', exact: true }).click();
  await card.locator('.reserve-meter-choices > button').filter({ hasText: 'Noir' }).click();
  await page.waitForFunction(() => window.savedScene?.options?.signatureMeterCoverType === 'cache-compteur-Noir');
  const coverBefore = await page.evaluate(() => window.actualReserveItems.find(item => item.autoMeterCover));
  await page.getByRole('button', { name: 'Reouvrir', exact: true }).click();
  await page.waitForFunction(() => window.actualReserveItems.find(item => item.autoMeterCover)?.type === 'cache-compteur-Noir');
  const coverAfter = await page.evaluate(() => window.actualReserveItems.find(item => item.autoMeterCover));
  for (const key of ['x', 'z', 'rotation', 'included', 'priceMode']) assert.equal(coverAfter[key], coverBefore[key]);
  assert.equal(coverAfter.options.unitPrice, 0);
  assert.deepEqual(errors, []);
  console.log('Shared reserve design: all packs, manual sizes/prices, equipment, door metadata, save/reopen/BAT, optional-only, removal, Signature-only meter covers, read-only and mobile OK');
} finally { await browser?.close(); await server.close(); }
