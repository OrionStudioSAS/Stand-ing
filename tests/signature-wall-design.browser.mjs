import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const white = { id: 'white', name: 'Blanc', code: '303', hex: '#bfc0c3', included: true, isDefault: true, price: 0 };
const colors = [white, ...['#edcc1d', '#b39a6b', '#891d27', '#286c39', '#8c8c8c', '#151515', '#662b66', '#626262', '#31312f', '#141e34', '#dac9a7', '#3d85ac', '#205441', '#71675a'].map((hex, index) => ({ id: `wall-${index}`, name: `Couleur ${index + 1}`, code: `C${index}`, hex, included: false, price: 11 }))];
const surfaces = [
  { id: 'left-front', sourceWall: 'left', label: 'Cloison gauche avant', width: 1.5, height: 2.5 },
  { id: 'back-right', sourceWall: 'back', label: 'Cloison arrière droite', width: 2.4, height: 2.5 },
  { id: 'reserve', label: 'Cloison réserve', width: 3, visibleWidth: 2.8, height: 2.5 },
];
const scene = { id: 'wall-design', offer: 'Signature', event_name: 'SITL 2027', dimensions: { width: 5, depth: 4 }, layout: 'back', items: [], options: {}, source_payload: {} };
const assets = [{ type: 'wall-palette', label: 'Coton', is_active: true, dimensions: { isColorGroup: true, packs: ['Signature'], colorUsages: ['wallFabric'], colorOptions: colors } }];
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OptionAccordion,SignatureWallColorOptionCard,WallCoverOptionCard,ConfiguratorApp}from'/src/__wall-design-app.jsx';
const colors=${JSON.stringify(colors)},surfaces=${JSON.stringify(surfaces)};
function Test(){const[open,setOpen]=useState(true),[selected,setSelected]=useState(colors[0]),[disabled,setDisabled]=useState(false),[covers,setCovers]=useState({}),[previews,setPreviews]=useState({}),[full,setFull]=useState(false),[revision,setRevision]=useState(0),[scene,setScene]=useState(${JSON.stringify(scene)});
 const toggle=(id,enabled,sourceWall)=>{window.lastToggle=[id,enabled,sourceWall];setCovers(value=>({...value,[id]:{...value[id],enabled}}))};
 return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:9999}}><button onClick={()=>setDisabled(value=>!value)}>Lecture seule test</button><button onClick={()=>setCovers({left:{enabled:true,visualPending:true}})}>Ancien format test</button><button onClick={()=>setFull(true)}>Scène complète test</button><button onClick={()=>{setScene(window.savedScene);setRevision(value=>value+1)}}>Reouvrir test</button></nav>{full?<ConfiguratorApp key={revision} initialScene={scene} isAdminViewer/>:
 <main style={{width:360,maxWidth:'calc(100vw - 32px)',margin:'16px auto'}}><OptionAccordion className="signature-wall-accordion" title="Cloison" subtitle="Coton gratté · Bâche imprimée" open={open} onToggle={()=>setOpen(value=>!value)}>
 <SignatureWallColorOptionCard colors={colors} selectedColor={selected} area={57.3} disabled={disabled} onSelect={id=>setSelected(colors.find(color=>color.id===id))}/>
 <WallCoverOptionCard signatureLayout surfaces={surfaces} covers={covers} previews={previews} includedMl={2} disabled={disabled} onToggle={toggle}
 onPreview={(id,file)=>setPreviews(value=>({...value,[id]:{name:file.name,url:URL.createObjectURL(file)}}))}
 onPreviewReset={id=>setPreviews(value=>({...value,[id]:null}))}
 onPending={(id,visualPending)=>setCovers(value=>({...value,[id]:{...value[id],visualPending}}))}
 onFramingChange={(id,framing)=>{window.lastFraming=[id,framing];setPreviews(value=>({...value,[id]:{...value[id],...framing}}))}}/>
 </OptionAccordion></main>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-wall-design-test',
  resolveId(id) { if (id === '/src/__wall-design-app.jsx') return `${root}src/__wall-design-app.jsx`; if (id === '/src/__wall-design-page.jsx') return `${root}src/__wall-design-page.jsx`; },
  load(id) {
    if (id === `${root}src/__wall-design-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {OptionAccordion,SignatureWallColorOptionCard,WallCoverOptionCard,ConfiguratorApp};');
    if (id === `${root}src/__wall-design-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?wall-design-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use('/__wall-design-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__wall-design-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 408, height: 1250 } });
  const errors = []; page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  await page.addInitScript(() => { localStorage.setItem('standing-config-intro:wall-design', 'started'); localStorage.setItem('standing-config-tutorial:wall-design', 'done'); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__wall-design-test__`);
  const card = page.locator('.signature-wall-accordion');
  await card.locator('.wall-cover-row').last().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const layout = await card.evaluate((element) => {
    const rect = (target) => { const bounds = target.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; };
    return { root: rect(element), header: rect(element.querySelector(':scope > button')), heading: rect(element.querySelector('.ground-section-heading')), rows: [...element.querySelectorAll('.wall-cover-row')].map(rect), notices: [...element.querySelectorAll('.wall-cover-info-box')].map(rect), uploads: [...element.querySelectorAll('.wall-cover-actions')].map(rect), swatches: [...element.querySelectorAll('.signature-ground-swatches button')].map(rect) };
  });
  console.log('Reference geometry:', JSON.stringify(layout));
  await card.screenshot({ path: '/tmp/standing-signature-wall-reference.png' });
  assert.equal(layout.root.width, 360);
  assert.equal(layout.root.height, 1140);
  assert.equal(layout.header.height, 65);
  assert.equal(layout.heading.width, 324);
  assert.equal(layout.heading.y, 98);
  assert.equal(layout.rows[0].y, 485);
  assert.equal(layout.swatches.length, 14, 'Only configured colours are shown');
  assert.equal(layout.swatches.filter((item) => item.y === layout.swatches[0].y).length, 9);
  assert.ok(layout.swatches.every((item) => item.width === 26));
  assert.ok(layout.rows.every((item) => item.width === 324 && item.height === 209));
  assert.ok(layout.uploads.every((item) => item.width === 300 && item.height === 90));
  assert.ok(layout.notices.every((item) => item.height === 46));
  assert.equal(layout.rows[1].y - layout.rows[0].y, 223);
  assert.match(await card.locator('.signature-wall-optional-colors em').innerText(), /630 €/);
  assert.equal(await card.locator(':scope > button > svg').getAttribute('class').then((value) => value.includes('lucide-x')), true);
  const whiteButton = card.getByRole('button', { name: 'Blanc (303)', exact: true });
  const optional = card.getByRole('button', { name: 'Couleur 1 (C0)', exact: true });
  await optional.click(); assert.equal(await optional.getAttribute('aria-pressed'), 'true');
  assert.equal(await whiteButton.getAttribute('aria-pressed'), 'false');
  await whiteButton.click(); assert.equal(await whiteButton.getAttribute('aria-pressed'), 'true');
  const rows = card.locator('.wall-cover-row');
  await rows.nth(0).getByRole('button', { name: 'Activer Cloison gauche avant' }).click();
  assert.deepEqual(await page.evaluate(() => window.lastToggle), ['left-front', true, 'left']);
  assert.equal(await card.locator('.signature-wall-cover-heading em').innerText(), '+0€');
  await rows.nth(2).getByRole('button', { name: 'Activer Cloison réserve' }).click();
  assert.match(await card.locator('.signature-wall-cover-heading em').innerText(), /662 €/, 'Visible widths and shared allowance keep existing pricing');
  await rows.nth(0).getByRole('checkbox').check();
  assert.equal(await rows.nth(0).getByRole('checkbox').isChecked(), true);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCWsAAAAASUVORK5CYII=', 'base64');
  await rows.nth(0).locator('input[type=file]').setInputFiles({ name: 'visuel.png', mimeType: 'image/png', buffer: png });
  await rows.nth(0).locator('.image-framing-controls').waitFor();
  assert.equal(await rows.nth(0).locator('.wall-cover-preview-button > img').count(), 1);
  await rows.nth(0).locator('.image-framing-controls summary').click();
  await rows.nth(0).locator('.image-framing-controls input[type=range]').first().fill('145');
  await rows.nth(0).locator('.image-framing-controls input[type=range]').first().press('ArrowRight');
  await page.waitForFunction(() => Boolean(window.lastFraming));
  assert.equal((await page.evaluate(() => window.lastFraming))[0], 'left-front');
  assert.equal((await page.evaluate(() => window.lastFraming))[1].imageZoom, 1.5);
  await rows.nth(0).getByRole('button', { name: 'Retirer l’aperçu', exact: true }).click();
  assert.equal(await rows.nth(0).locator('.image-framing-controls').count(), 0);
  await page.getByRole('button', { name: 'Ancien format test' }).click();
  assert.equal(await rows.nth(0).locator('.wall-cover-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(await rows.nth(0).getByRole('checkbox').isChecked(), true);
  await page.getByRole('button', { name: 'Lecture seule test' }).click();
  assert.equal(await card.locator('input:not(:disabled), .signature-wall-colors button:not(:disabled), .wall-cover-row button:not(:disabled)').count(), 0);
  await card.locator(':scope > button').click(); assert.equal(await card.locator('.wall-cover-row').count(), 0);
  await card.locator(':scope > button').click(); assert.equal(await card.locator('.wall-cover-row').count(), 3);
  for (const width of [320, 390, 480]) {
    await page.setViewportSize({ width, height: 1250 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button', { name: 'Scène complète test' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /^Cloison/ }).click();
  await page.locator('.signature-wall-optional-colors').getByRole('button', { name: 'Couleur 1 (C0)', exact: true }).click();
  await page.waitForFunction(() => window.savedScene?.options.wallFabricColorCode === 'C0');
  await page.locator('.signature-wall-covers .wall-cover-toggle').first().click();
  await page.waitForFunction(() => Object.values(window.savedScene?.options.wallCovers || {}).some((cover) => cover.enabled));
  await page.getByRole('button', { name: 'Reouvrir test' }).click();
  await page.getByRole('button', { name: /^Cloison/ }).click();
  assert.equal(await page.locator('.signature-wall-optional-colors').getByRole('button', { name: 'Couleur 1 (C0)', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.signature-wall-covers .wall-cover-toggle').first().getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Signature walls: reference layout, configured palette/pricing, uploads, framing/reset, pending/source-wall aliases, read-only/mobile and scene autosave/reopen OK');
} finally { await browser?.close(); await server.close(); }
