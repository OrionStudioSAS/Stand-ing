import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const hexes = ['#db2329', '#234da8', '#b7bac1', '#e7dcc0', '#b49a6e', '#74665a', '#f5d22b', '#f88b1e', '#df3987', '#942333', '#7b3185', '#b1c92b', '#3da343', '#1e5842', '#4bb6c3', '#4094cc', '#19243e', '#8a8d8d', '#696c6d', '#37322d', '#171817'];
const colors = hexes.map((hex, i) => ({ id: `color-${i}`, name: i === 1 ? 'Marine' : i === 2 ? 'Gris clair' : `Couleur ${i}`, code: i === 1 ? '0809' : i === 2 ? '0939' : `C${i}`, hex, included: i < 3, isFree: i < 3, isDefault: i === 1, price: i < 3 ? 0 : 30 }));
const footprint = colors.map((color, i) => ({ ...color, id: `foot-${i}`, name: i === 3 ? 'Orange' : color.name, code: i === 3 ? '0450' : color.code, included: i < 6, isFree: i < 6, isDefault: i === 3, price: i < 6 ? 0 : 36 }));
const gray = [{ ...colors[2], isDefault: true, included: true, isFree: true }];
const assets = ['Signature', 'Confort', 'Prestige', 'Équipé'].flatMap(pack => [
  { type: `carpet-${pack}`, label: `Moquette ${pack}`, is_active: true, dimensions: { isColorGroup: true, packs: [pack], colorUsages: ['carpet'], colorGroupPrice: 30, colorOptions: pack === 'Signature' ? colors : gray } },
  { type: `footprint-${pack}`, label: `Empreinte ${pack}`, is_active: true, dimensions: { isColorGroup: true, packs: [pack], colorUsages: ['footprint'], colorGroupPrice: 36, colorOptions: footprint } },
]);
const arch = { id: 'arch', type: 'arche-signature', label: 'Arche Signature', dimensions: { size: [1.5, 2.5, .5] }, x: 0, z: -1, options: { signatureBaseKey: 'arche' } };
const scene = { id: 'ground-design', offer: 'Signature', salon: 'SITL 2027', dimensions: { width: 6, depth: 3.6 }, layout: 'back', items: [arch], options: { ledRailsEnabled: false } };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import*as api from'/src/__ground-design-app.jsx';import Ground from'/src/GroundOptionsQuickView.jsx';import{t}from'/src/i18n.js';window.api=api;
const colors=${JSON.stringify(colors)},feet=${JSON.stringify(footprint)},gray=${JSON.stringify(gray)},original=${JSON.stringify(scene)};
function Test(){const[mode,setMode]=useState('card'),[signature,setSignature]=useState(true),[color,setColor]=useState(colors[1]),[foot,setFoot]=useState(feet[3]),[thick,setThick]=useState(false),[disabled,setDisabled]=useState(false),[floor,setFloor]=useState(false),[enabled,setEnabled]=useState(true),[empty,setEmpty]=useState(false),[locale,setLocale]=useState('fr'),[open,setOpen]=useState(true),[scene,setScene]=useState(original),[key,setKey]=useState(0);window.groundCard={color,foot,thick};
const actual=(pack,variant={})=>{setScene({...original,offer:pack,salon:pack==='Signature'?'SITL 2027':'SMCL 2026',dimensions:pack==='Signature'?original.dimensions:{width:5,depth:4},items:pack==='Signature'?[${JSON.stringify(arch)}]:[],...variant});setMode('scene');setKey(n=>n+1)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:99999,background:'white'}}><button onClick={()=>{setMode('card');setSignature(true);setEmpty(false);setDisabled(false);setFloor(false);setEnabled(true);setOpen(true)}}>Carte Signature</button><button onClick={()=>{setMode('card');setSignature(false);setEmpty(false);setColor(gray[0]);setOpen(true)}}>Carte SMCL</button><button onClick={()=>setDisabled(v=>!v)}>Lecture seule</button><button onClick={()=>setFloor(v=>!v)}>Plancher</button><button onClick={()=>setEnabled(false)}>Retirer empreinte</button><button onClick={()=>setEmpty(v=>!v)}>Sans couleurs</button><button onClick={()=>setLocale(v=>v==='fr'?'en':'fr')}>Langue</button>{['Signature','Confort','Prestige','Équipé'].map(pack=><button key={pack} onClick={()=>actual(pack)}>Scène {pack}</button>)}<button onClick={()=>{setScene(window.savedScene);setKey(n=>n+1)}}>Reouvrir</button><button onClick={()=>actual('Confort',{options:{ledRailsEnabled:false,technicalFloorType:'floor4',carpetThick:true,footprintThick:true}})}>Scène plancher</button></nav>
{mode==='scene'?<api.ConfiguratorApp key={key} initialScene={scene} isAdminViewer forceReadOnly={disabled}/>:<main style={{width:345,maxWidth:'calc(100vw - 24px)',margin:'12px auto'}}><api.OptionAccordion className="ground-section-accordion" title="Sol" subtitle={signature?'Moquette':'Moquette · Empreinte'} ariaLabel="Sol" icon={<api.ConfiguratorOptionIcon src="/icons/sol.svg"/>} open={open} onToggle={()=>setOpen(v=>!v)}><Ground signature={signature} carpet={{...api.surfaceColorOptionGroups(empty?[]:signature?colors:gray,color,'',signature?21.6:20),area:signature?21.6:20}} footprint={{...api.surfaceColorOptionGroups(empty?[]:feet,foot,'',1),area:1}} carpetArea={signature?21.6:20} footprintArea={floor||!enabled?0:signature?0.25:1} thick={thick} footprintEnabled={enabled} disabled={disabled} footprintDisabled={floor} footprintDisabledReason={floor?'Plancher technique : empreinte indisponible.':''} dirtyFootprint={['0939','0219','0400'].includes(foot.code)} onCarpet={id=>setColor(colors.find(c=>c.id===id)||gray[0])} onFootprint={id=>setFoot(feet.find(c=>c.id===id))} onThick={setThick} onRestoreFootprint={()=>setEnabled(true)} t={(key,vars)=>t(locale,key,vars)}/></api.OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'ground-options-design',
  resolveId(id) { if (id === '/src/__ground-design-app.jsx') return `${root}src/__ground-design-app.jsx`; if (id === '/src/__ground-design-page.jsx') return `${root}src/__ground-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__ground-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,OptionAccordion,ConfiguratorOptionIcon,surfaceColorOptionGroups};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.groundActual={carpet:selectedCarpetColor,footprint:selectedCarpetFootprintColor,footArea:thickFootprintArea,pricing:scenePricing};\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__ground-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?ground-design-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__ground-design__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__ground-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 1500 } });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:ground-design', 'started'); localStorage.setItem('standing-config-tutorial:ground-design', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__ground-design__`);
  const card = page.locator('.ground-options-quickview'), thick = page.locator('.ground-thick-option');
  const group = (name) => card.getByRole('group', { name, exact: true });
  await thick.waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await group('Moquette : couleurs incluses').getByRole('button').count(), 3);
  assert.equal(await group('Moquette : couleurs en option').getByRole('button').count(), 18);
  assert.match(await card.innerText(), /648 €/); assert.match(await thick.innerText(), /656 €/);
  assert.deepEqual(await card.locator('.ground-color-swatches button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), colors.map(color => `${color.name} (${color.code})`));
  assert.equal(await card.locator('.ground-color-swatches button').first().evaluate(el => el.offsetWidth), 26);
  await page.locator('.ground-section-accordion').screenshot({ path: '/tmp/standing-ground-signature.png' });
  const background = await thick.evaluate(el => getComputedStyle(el).backgroundColor);
  await thick.click(); assert.equal(await thick.getAttribute('aria-pressed'), 'true'); assert.equal(await thick.evaluate(el => getComputedStyle(el).backgroundColor), background);
  await group('Moquette : couleurs en option').getByRole('button').nth(1).click(); assert.equal(await page.evaluate(() => window.groundCard.color.id), colors[4].id);
  await page.getByRole('button', { name: 'Carte SMCL', exact: true }).click();
  assert.equal(await card.locator('.ground-single-color').count(), 1); assert.equal(await thick.count(), 1);
  assert.match(await thick.innerText(), /630 €/); assert.match(await card.innerText(), /36 €/);
  assert.equal(await group('Empreinte moquette : couleurs incluses').getByRole('button').count(), 6);
  assert.equal(await group('Empreinte moquette : couleurs en option').getByRole('button').count(), 15);
  assert.equal(await card.locator('.ground-light-warning').count(), 0);
  await group('Empreinte moquette : couleurs incluses').getByRole('button', { name: 'Gris clair (0939)', exact: true }).click();
  assert.equal(await card.locator('.ground-light-warning').count(), 1);
  await page.locator('.ground-section-accordion').screenshot({ path: '/tmp/standing-ground-smcl.png' });
  await page.getByRole('button', { name: 'Plancher', exact: true }).click();
  assert.equal(await card.locator('.ground-palette').last().locator('button:not(:disabled)').count(), 0); assert.match(await thick.innerText(), /600 €/);
  await page.getByRole('button', { name: 'Plancher', exact: true }).click(); await page.getByRole('button', { name: 'Retirer empreinte', exact: true }).click();
  await card.getByRole('button', { name: 'La remettre', exact: true }).click(); assert.match(await thick.innerText(), /630 €/);
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click(); assert.equal(await card.locator('button:not(:disabled)').count(), 0);
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  await page.getByRole('button', { name: 'Sans couleurs', exact: true }).click(); assert.equal(await card.locator('.ground-color-swatches button').count(), 0);
  await page.getByRole('button', { name: 'Sans couleurs', exact: true }).click();
  await page.getByRole('button', { name: 'Langue', exact: true }).click(); assert.match(await card.innerText(), /Carpet footprint/); await page.getByRole('button', { name: 'Langue', exact: true }).click();
  for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 1500 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px`); }

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const pack of ['Signature', 'Confort', 'Prestige']) {
    await page.getByRole('button', { name: `Scène ${pack}`, exact: true }).click(); await page.getByRole('button', { name: 'Sol', exact: true }).click();
    await page.waitForFunction(pack => window.groundActual.carpet?.id?.startsWith(`carpet-${pack}:`), pack);
    assert.equal(await card.count(), 1); assert.equal(await thick.count(), 1);
    const palette = pack === 'Signature' ? group('Moquette : couleurs en option') : group('Empreinte moquette : couleurs en option');
    await palette.getByRole('button').first().click(); await thick.click();
    await page.waitForFunction(pack => window.savedScene?.offer === pack && window.savedScene.options.carpetThick && window.savedScene.options.footprintThick, pack);
    const actual = await page.evaluate(() => window.groundActual);
    const thickLines = actual.pricing.lines.filter(line => line.label.includes('Moquette épaisse'));
    assert.equal(thickLines.length, 2); assert.equal(thickLines[0].total, Math.round((pack === 'Signature' ? 21.6 : 20) * 30));
    assert.equal(thickLines[1].total, Math.round(actual.footArea * 30));
    assert.equal(pack === 'Signature' ? actual.carpet.included : actual.footprint.included, false);
    const chosen = pack === 'Signature' ? actual.carpet.id : actual.footprint.id;
    await page.getByRole('button', { name: 'Reouvrir', exact: true }).click(); await page.getByRole('button', { name: 'Sol', exact: true }).click();
    await page.waitForFunction(({ pack, chosen }) => (pack === 'Signature' ? window.groundActual.carpet.id : window.groundActual.footprint.id) === chosen, { pack, chosen });
    assert.equal(await thick.getAttribute('aria-pressed'), 'true');
  }
  await page.getByRole('button', { name: 'Scène plancher', exact: true }).click(); await page.getByRole('button', { name: 'Sol', exact: true }).click();
  await page.waitForFunction(() => window.groundActual.footArea === 0);
  assert.equal(await card.locator('.ground-palette').last().locator('button:not(:disabled)').count(), 0); assert.match(await thick.innerText(), /600 €/);
  assert.equal((await page.evaluate(() => window.groundActual.pricing.lines.filter(line => line.label.includes('Moquette épaisse')))).length, 1);
  await page.getByRole('button', { name: 'Scène Équipé', exact: true }).click(); await page.getByRole('button', { name: 'Sol', exact: true }).click(); assert.equal(await card.count(), 0, 'The Equipped design is not changed by this request');
  assert.deepEqual(errors, []);
  console.log('Ground designs: real palette order/counts, prices, single linked thick option, Signature arch footprint, SMCL single carpet/footprint, warnings, technical floor, restore, readonly/mobile/EN and save/reopen OK');
} finally { await browser?.close(); await server.close(); }
