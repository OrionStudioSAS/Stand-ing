import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const floor = { id: 'gray', name: 'Gris Clair', code: '0939', hex: '#bfc0c3', included: true, isDefault: true, price: 0 };
const hexes = ['#263388', '#229b9f', '#c52d2d', '#ed9027', '#db3784', '#9cad2c', '#bfc0c3', '#edcc1d', '#b39a6b', '#891d27', '#286c39', '#8c8c8c', '#151515', '#662b66', '#626262', '#31312f', '#141e34', '#dac9a7', '#3d85ac', '#205441', '#71675a'];
const colors = hexes.map((hex, index) => ({ id: `footprint-${index}`, name: index === 3 ? 'Orange' : `Couleur ${index + 1}`, code: index === 3 ? '0450' : `C${index}`, hex, included: index < 6, isFree: index < 6, price: index < 6 ? 0 : 2 }));
const arch = { id: 'arch', type: 'arche-signature', label: 'Arche Signature', dimensions: { size: [1.5, 2.5, 0.5] }, x: 0, z: -1, options: { signatureBaseKey: 'arche' } };
const scene = { id: 'ground-design', offer: 'Signature', event_name: 'SITL 2027', dimensions: { width: 5, depth: 4 }, layout: 'back', items: [arch], options: {}, source_payload: {} };
const assets = [
  { type: 'floor-palette', label: 'Moquette', is_active: true, dimensions: { isColorGroup: true, packs: ['Signature'], colorUsages: ['carpet'], colorOptions: [floor] } },
  { type: 'footprint-palette', label: 'Empreinte', is_active: true, dimensions: { isColorGroup: true, packs: ['Signature'], colorUsages: ['footprint'], colorGroupPrice: 2, colorOptions: colors } },
];
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OptionAccordion,SignatureGroundOptionCard,ConfiguratorApp}from'/src/__ground-design-app.jsx';
const colors=${JSON.stringify(colors)},floor=${JSON.stringify(floor)};
function Test(){const[open,setOpen]=useState(true),[selected,setSelected]=useState(colors[3]),[thick,setThick]=useState(false),[disabled,setDisabled]=useState(false),[full,setFull]=useState(false),[revision,setRevision]=useState(0),[scene,setScene]=useState(${JSON.stringify(scene)});
 return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999}}><button onClick={()=>setDisabled(value=>!value)}>Lecture seule test</button><button onClick={()=>setFull(true)}>Scène complète test</button><button onClick={()=>{setScene(window.savedScene);setRevision(value=>value+1)}}>Reouvrir test</button></nav>{full?<ConfiguratorApp key={revision} initialScene={scene} isAdminViewer/>:
 <main style={{width:360,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><OptionAccordion className="signature-ground-accordion" title="Sol" subtitle="Moquette · Empreinte" open={open} onToggle={()=>setOpen(value=>!value)}>
 <SignatureGroundOptionCard colors={[floor]} selectedColor={floor} footprintColors={colors} selectedFootprintColor={selected} area={20} footprintArea={1} thick={thick} disabled={disabled} onFootprintSelect={id=>setSelected(colors.find(color=>color.id===id))} onThickChange={setThick}/>
 </OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-ground-design-test',
  resolveId(id) { if (id === '/src/__ground-design-app.jsx') return `${root}src/__ground-design-app.jsx`; if (id === '/src/__ground-design-page.jsx') return `${root}src/__ground-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__ground-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {OptionAccordion,SignatureGroundOptionCard,ConfiguratorApp};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.groundItems=visibleSceneItems;window.groundPricing=scenePricing;\n  const estimatedTotal = scenePricing.total;');
    if (id === `${root}src/__ground-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?ground-design-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__ground-design-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__ground-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 650 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:ground-design', 'started'); localStorage.setItem('standing-config-tutorial:ground-design', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__ground-design-test__`);
  const card = page.locator('.signature-ground-accordion');
  await card.getByRole('button', { name: 'Option Moquette épaisse' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const layout = await card.evaluate((element) => {
    const rect = (selector) => { const bounds = element.querySelector(selector).getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; };
    return { root: { width: element.clientWidth, height: element.getBoundingClientRect().height }, header: rect(':scope > button'), heading: rect('.signature-ground-carpet .ground-section-heading'), swatches: [...element.querySelectorAll('.signature-ground-footprint .signature-ground-swatches')].map((row) => [...row.children].map((button) => ({ top: button.getBoundingClientRect().top, width: button.offsetWidth }))), thick: rect('.config-toggle-option') };
  });
  assert.equal(layout.root.width, 358);
  assert.equal(layout.root.height, 565);
  assert.equal(layout.header.height, 65);
  assert.equal(layout.heading.width, 324);
  assert.equal(layout.swatches[0].length, 6);
  assert.equal(layout.swatches[1].length, 15);
  assert.equal(layout.swatches[1].filter((item) => item.top === layout.swatches[1][0].top).length, 9);
  assert.ok(layout.swatches.flat().every((item) => item.width === 26));
  assert.match(await card.locator('.signature-ground-thick em').innerText(), /630 €/);
  await card.screenshot({ path: '/tmp/standing-signature-ground-reference.png' });
  console.log('Reference geometry:', JSON.stringify(layout));
  const thickButton = card.locator('.config-toggle-option');
  const bg = await thickButton.evaluate((button) => getComputedStyle(button).backgroundColor);
  await thickButton.click(); assert.equal(await thickButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await thickButton.evaluate((button) => getComputedStyle(button).backgroundColor), bg);
  await card.getByRole('button', { name: 'Couleur 7 (C6)', exact: true }).click();
  assert.equal(await card.getByRole('button', { name: 'Couleur 7 (C6)', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Lecture seule test' }).click();
  assert.equal(await card.locator('.signature-ground-card button:not(:disabled)').count(), 0);
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button', { name: 'Scène complète test' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /^Sol/ }).click();
  const optional = page.getByRole('group', { name: 'EMPREINTE MOQUETTE : couleurs en option' });
  await optional.getByRole('button', { name: 'Couleur 7 (C6)', exact: true }).click();
  await page.waitForFunction(() => window.savedScene?.items.some((item) => item.options?.signatureArchColorCode === 'C6'));
  const saved = await page.evaluate(() => window.savedScene);
  assert.equal(saved.options.carpetFootprintColorCode, 'C6');
  assert.equal(saved.items[0].options.signatureArchColorSupplement, 285, 'Existing Signature surcharge stays unchanged');
  await page.locator('.signature-ground-thick .config-toggle-option').click();
  await page.waitForFunction(() => window.savedScene?.options.carpetThick);
  const lines = await page.evaluate(() => window.groundPricing.lines.filter((line) => line.label.includes('Moquette épaisse')));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].total + lines[1].total, 600 + Math.round(1.5 * 4.5 * 30));
  await page.getByRole('button', { name: 'Reouvrir test' }).click();
  await page.getByRole('button', { name: /^Sol/ }).click();
  assert.equal(await page.getByRole('group', { name: 'EMPREINTE MOQUETTE : couleurs en option' }).getByRole('button', { name: 'Couleur 7 (C6)', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.signature-ground-thick .config-toggle-option').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Signature ground: reference sizing, ordered 6/15 swatches, responsive/read-only UI, linked arch color, unchanged pricing, single thick-carpet toggle and autosave/reopen OK');
} finally { await browser?.close(); await server.close(); }
