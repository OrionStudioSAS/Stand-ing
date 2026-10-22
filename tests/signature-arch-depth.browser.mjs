import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const entries = [false, true].flatMap((led) => [2, 3].flatMap((size) => ['spot', 'suspension'].map((lighting) => ({
  type: `${led ? 'led' : 'arch'}-${size}m-${lighting}`, label: `${led ? 'Mur LED' : 'Arche'} Signature ${size}m + ${lighting}`,
  is_active: true, dimensions: { packs: ['Signature'], size: [1.1, 3.64, size + 0.52] },
}))));
const artwork = { 'signature-arch-led-5': { imageUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>'), imageZoom: 1.4, imageOffsetX: 12 } };
const arch = { ...entries.find((entry) => entry.type === 'led-3m-suspension'), id: 'saved-arch', options: { signatureBaseKey: 'arche', textureSlotValues: artwork } };
const scene = { id: 'arch-depth', offer: 'Signature', event_name: 'SITL 2027', dimensions: { width: 5, depth: 4 }, layout: 'back', items: [arch], options: { ledRailsEnabled: false }, source_payload: {} };
const colors = [{ id: 'blue', name: 'Bleu marine', code: '0809', hex: '#244998', included: true }, { id: 'gray', name: 'Gris Clair', code: '0939', hex: '#bfbfbf', price: 285 }];
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import * as api from'/src/__arch-depth-app.jsx';window.api=api;
const entries=${JSON.stringify(entries)},original=${JSON.stringify(scene)},colors=${JSON.stringify(colors)};window.entries=entries;
function Test(){const[mode,setMode]=useState('card'),[depth,setDepth]=useState(3.29),[scene,setScene]=useState(original),[revision,setRevision]=useState(0),[readOnly,setReadOnly]=useState(false),[open,setOpen]=useState(true),[item,setItem]=useState({...entries[0],id:'card-arch',options:{}});
const changeDepth=(depth)=>{setDepth(depth);setScene(value=>({...window.savedScene||value,dimensions:{width:5,depth}}));setRevision(value=>value+1);setOpen(true)};
return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:99999,background:'white'}}>{[2,2.29,2.3,3,3.29,3.3,4].map(depth=><button key={depth} onClick={()=>changeDepth(depth)}>Profondeur {depth}</button>)}<button onClick={()=>{setMode('scene');setScene(original);setRevision(v=>v+1)}}>Scène complète</button><button onClick={()=>{setScene(window.savedScene);setRevision(v=>v+1)}}>Reouvrir scène</button><button onClick={()=>setReadOnly(v=>!v)}>Lecture seule</button><button onClick={()=>{setMode('card');setOpen(true)}}>Carte seule</button></nav>
{mode==='scene'?<api.ConfiguratorApp key={revision} initialScene={scene} isAdminViewer forceReadOnly={readOnly}/>:<main style={{width:340,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><api.OptionAccordion className="signature-arch-accordion" title={<span className="signature-arch-title">Arche{depth<2.3&&<small>Non disponible</small>}</span>} subtitle={depth<2.3?'Espace insuffisant · 10 m²':'Taille · Éclairage · Couleur · Options'} icon={<api.ConfiguratorOptionIcon src="/icons/arche.svg"/>} open={open} onToggle={()=>setOpen(v=>!v)}><api.SignatureArchOptionCard standDepth={depth} standArea={10} items={[item]} entries={entries} colors={colors} selectedColor={colors[0]} disabled={readOnly} onVariantChange={entry=>setItem(value=>({...value,...entry}))} onAlternative={target=>{window.alternative=target}}/></api.OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-arch-depth-test',
  resolveId(id) { if (id === '/src/__arch-depth-app.jsx') return `${root}src/__arch-depth-app.jsx`; if (id === '/src/__arch-depth-page.jsx') return `${root}src/__arch-depth-page.jsx`; },
  load(id) {
    if (id === `${root}src/__arch-depth-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp,SignatureArchOptionCard,OptionAccordion,ConfiguratorOptionIcon,sceneAllAdminItems,assetToCatalogEntry};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.depthPricing=scenePricing;window.depthItems=visibleSceneItems;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__arch-depth-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?arch-depth-original';export async function listObjectBank(){return ${JSON.stringify(entries)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__arch-depth__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__arch-depth-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 388, height: 1700 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:arch-depth', 'started'); localStorage.setItem('standing-config-tutorial:arch-depth', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__arch-depth__`);
  const card = page.locator('.signature-arch-accordion');
  const sizes = page.getByRole('group', { name: 'Taille', exact: true });
  const three = sizes.getByRole('button', { name: /^3 m/ }), two = sizes.getByRole('button', { name: /^2 m/ });
  await three.waitFor(); await page.evaluate(() => document.fonts.ready);
  const headerBackground = () => card.locator(':scope > button').evaluate((button) => getComputedStyle(button).backgroundColor);
  assert.equal(await headerBackground(), 'rgb(31, 67, 120)');
  await card.locator(':scope > button').click();
  assert.equal(await headerBackground(), 'rgb(31, 67, 120)', 'The closed arch menu uses the shared accordion blue');
  await card.locator(':scope > button').click();
  assert.equal(await three.isDisabled(), true); assert.equal(await two.isEnabled(), true);
  assert.match(await three.innerText(), /Non disponible/); assert.match(await three.getAttribute('title'), /3,30 m/);
  assert.equal(await three.evaluate((button) => getComputedStyle(button).borderStyle), 'dotted');
  await card.screenshot({ path: '/tmp/standing-arch-3m-unavailable.png' });
  for (const depth of [2.3, 3, 3.29]) {
    await page.getByRole('button', { name: `Profondeur ${depth}`, exact: true }).click();
    assert.equal(await three.isDisabled(), true); assert.equal(await two.isEnabled(), true);
  }
  await page.getByRole('button', { name: 'Profondeur 3.3', exact: true }).click(); assert.equal(await three.isEnabled(), true);
  await three.click(); assert.equal(await three.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Profondeur 2.29', exact: true }).click();
  assert.equal(await card.locator('.signature-arch-unavailable').count(), 1); assert.equal(await card.locator('input,fieldset').count(), 0);
  assert.equal(await headerBackground(), 'rgb(31, 67, 120)', 'Unavailable arches keep the same menu blue');
  assert.match(await card.locator(':scope > button').innerText(), /Non disponible.*Espace insuffisant/s);
  assert.equal(await card.locator('.signature-arch-title > small').evaluate((badge) => getComputedStyle(badge).color), 'rgb(36, 86, 159)');
  assert.match(await card.getByRole('status').innerText(), /2,30 m/);
  await card.screenshot({ path: '/tmp/standing-arch-no-space.png' });
  for (const [label, target] of [['Bâches imprimées', 'coton'], ['Visuel lumineux', 'tete'], ['Enseigne haute', 'shop']]) {
    await card.getByRole('button', { name: new RegExp(label) }).click(); assert.equal(await page.evaluate(() => window.alternative), target);
  }
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  assert.equal(await card.getByRole('button', { name: /Bâches imprimées/ }).isEnabled(), true, 'Alternatives remain navigable in read-only mode');
  for (const width of [320, 390, 480]) { await page.setViewportSize({ width, height: 1000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
  await page.getByRole('button', { name: 'Lecture seule', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Scène complète', exact: true }).click();
  await page.waitForFunction(() => window.depthItems?.some(item=>item.type==='led-3m-suspension'));
  await page.getByRole('button', { name: 'Profondeur 3.29', exact: true }).click();
  await page.waitForFunction(() => window.savedScene?.dimensions.depth===3.29 && window.savedScene.items.some(item=>item.type==='led-2m-suspension'));
  assert.deepEqual(await page.evaluate(() => window.savedScene.items.find(item=>item.id==='saved-arch').options.textureSlotValues), artwork);
  assert.equal(await page.evaluate(() => window.depthPricing.lines.some(line=>line.type.startsWith('signature-arch-size-'))), false);
  await page.getByRole('button', { name: /^Arche/ }).click(); assert.equal(await three.isDisabled(), true);
  await page.getByRole('button', { name: 'Profondeur 2.29', exact: true }).click();
  await page.waitForFunction(() => window.depthItems && !window.depthItems.some(item=>item.options?.signatureBaseKey==='arche'));
  await page.getByRole('button', { name: /^Arche/ }).click();
  assert.equal(await card.locator('.signature-arch-unavailable').count(), 1);
  await page.waitForFunction(() => window.savedScene?.dimensions.depth===2.29);
  assert.deepEqual(await page.evaluate(() => window.savedScene.items.find(item=>item.id==='saved-arch').options.textureSlotValues), artwork, 'Artwork is preserved while the arch is unavailable');
  assert.equal(await page.evaluate(() => window.depthPricing.lines.some(line=>line.type.startsWith('signature-arch-'))), false, 'An unavailable arch adds no LED or size surcharge');
  assert.equal(await page.evaluate(() => {const entries=window.entries.map(entry=>window.api.assetToCatalogEntry(entry,window.entries));return window.api.sceneAllAdminItems(window.savedScene,entries).some(item=>item.options?.signatureBaseKey==='arche');}), false, 'BAT reconstruction omits an arch that cannot fit');
  await card.getByRole('button', { name: /Bâches imprimées/ }).click(); assert.equal(await page.locator('.option-accordion.open').getByRole('button', { name: /^Cloison/ }).count(), 1);
  await page.getByRole('button', { name: /^Arche/ }).click(); await card.getByRole('button', { name: /Visuel lumineux/ }).click();
  assert.equal(await page.locator('.option-accordion.open').getByRole('button', { name: /^Tête de cloison/ }).count(), 1);
  await page.getByRole('button', { name: /^Arche/ }).click(); await card.getByRole('button', { name: /Enseigne haute/ }).click();
  assert.equal(await page.locator('.stepper button').nth(2).getAttribute('class'), 'active');
  await page.getByRole('button', { name: 'Profondeur 2.3', exact: true }).click();
  await page.waitForFunction(() => window.depthItems?.some(item=>item.type==='led-2m-suspension'));
  await page.getByRole('button', { name: /^Arche/ }).click(); assert.equal(await two.isEnabled(), true); assert.equal(await three.isDisabled(), true);
  await page.getByRole('button', { name: 'Profondeur 3.3', exact: true }).click(); await page.getByRole('button', { name: /^Arche/ }).click();
  await three.click(); await page.waitForFunction(() => window.savedScene?.dimensions.depth===3.3&&window.savedScene.items.some(item=>item.type==='led-3m-suspension'));
  await page.getByRole('button', { name: 'Reouvrir scène', exact: true }).click(); await page.getByRole('button', { name: /^Arche/ }).click();
  assert.equal(await three.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Signature arches: exact 2.30/3.30m boundaries, unavailable references/mobile, LED downgrade, artwork preservation, pricing/BAT exclusion and functional alternative links OK');
} finally { await browser?.close(); await server.close(); }
