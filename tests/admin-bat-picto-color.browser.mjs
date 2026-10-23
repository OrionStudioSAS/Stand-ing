import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#ff00ff" stroke="#112233" stroke-width="3" d="M10 10H90V90H10Z"/></svg>';
const object = { type: 'picto-chair', label: 'Chaise BAT', is_active: true, thumbnail_url: '/__picto.svg', dimensions: { category: 'Mobilier', size: [1, 1, .5], reference: 'CHAIR', packs: ['Signature'], batPictoUrl: '/__picto.svg', batPictoPath: 'chair.svg' } };
const group = { type: 'picto-variants', label: 'Groupe BAT', is_active: true, dimensions: { isVariantGroup: true, packs: ['Signature'], category: 'Mobilier', variantAssetTypes: [object.type], configOptions: [], variantMeta: { [object.type]: { reference: 'VARIANT', batPictoUrl: '/__picto.svg', batPictoPath: 'chair.svg' } } } };
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AssetDrawer}from'/src/__picto-app.jsx';import{createTechnicalPlanSvgPages}from'/src/technicalExport.js';window.exportPlan=createTechnicalPlanSvgPages;
const original=${JSON.stringify([object, group])};window.savedAssets={};
function Test(){const[assets,setAssets]=useState(original),[type,setType]=useState(original[0].type),[open,setOpen]=useState(true);return <><nav style={{position:'fixed',top:0,left:0,zIndex:99999}}>{original.map(asset=><button key={asset.type} onClick={()=>{setType(asset.type);setOpen(true)}}>Ouvrir {asset.label}</button>)}</nav>{open&&<AssetDrawer key={type} asset={assets.find(asset=>asset.type===type)} assets={assets} scenes={[]} onClose={()=>setOpen(false)} onSave={async updated=>{window.savedAssets[updated.type]=structuredClone(updated);setAssets(rows=>rows.map(row=>row.type===updated.type?updated:row));return updated;}}/>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'bat-picto-colors-test',
  resolveId(id) {
    if (id === '/src/__picto-app.jsx') return `${root}src/__picto-app.jsx`;
    if (id === '/src/__picto-page.jsx') return `${root}src/__picto-page.jsx`;
  },
  load(id) {
    if (id === `${root}src/__picto-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {AssetDrawer};');
    if (id === `${root}src/__picto-page.jsx`) return harness;
    if (id === `${root}src/data/supabaseClient.js`) return 'export const supabase=null;';
  },
  configureServer(vite) {
    vite.middlewares.use('/__picto.svg', (_req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg); });
    vite.middlewares.use('/__picto-colors__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__picto-page.jsx"></script>'); });
  },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__picto-colors__`);
  const settings = page.getByRole('region', { name: 'Couleur du picto BAT', exact: true });
  const hex = settings.getByRole('textbox', { name: 'Code de la couleur à remplacer' });
  await settings.waitFor();
  await settings.getByRole('checkbox', { name: "Adapter à la couleur de l'objet" }).check();
  await hex.fill(''); assert.equal(await hex.isVisible(), true, 'Clearing the code must not hide the input while editing');
  await hex.fill('incorrect'); assert.equal(await hex.getAttribute('aria-invalid'), 'true');
  await settings.locator('input[type=color]').fill('#cc00cc');
  assert.equal(await hex.inputValue(), '#cc00cc');
  await hex.fill('#ff00ff');
  assert.equal(await hex.inputValue(), '#ff00ff');
  assert.equal(await hex.getAttribute('aria-invalid'), 'false');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  assert.equal((await page.evaluate(() => window.savedAssets['picto-chair'])).dimensions.batPictoReplaceColor, '#ff00ff');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir Chaise BAT', exact: true }).click();
  assert.equal(await hex.inputValue(), '#ff00ff');
  const exported = await page.evaluate(async () => {
    const entry = { type: 'picto-chair', modelSize: [1, 1, .5], dimensions: window.savedAssets['picto-chair'].dimensions };
    const output = [];
    for (const color of ['#1a2b3c', '#bca123']) {
      const pages = await window.exportPlan({ width: 4, depth: 3, layout: 'u', items: [{ id: 'chair', ...entry, x: 0, z: 0, options: { binary2Color: color } }], catalog: [entry] });
      const svg = pages[0];
      output.push({ target: !!svg.querySelector('[fill="'+color+'"]'), original: !!svg.querySelector('[fill="#ff00ff"]'), stroke: !!svg.querySelector('[stroke="#112233"]') });
    }
    return output;
  });
  assert.deepEqual(exported, [{ target: true, original: false, stroke: true }, { target: true, original: false, stroke: true }]);
  await settings.getByRole('button', { name: "Conserver les couleurs d'origine" }).click();
  assert.equal(await hex.count(), 0);
  assert.equal(await settings.getByRole('checkbox').isChecked(), false);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  assert.equal((await page.evaluate(() => window.savedAssets['picto-chair'])).dimensions.batPictoReplaceColor, '');
  await page.getByRole('button', { name: 'Ouvrir Groupe BAT', exact: true }).click();
  await settings.waitFor();
  assert.equal(await page.locator('.asset-variant-advanced').getAttribute('open'), null, 'Color controls are not hidden in advanced settings');
  await settings.getByRole('checkbox', { name: "Adapter à la couleur de l'objet" }).check();
  await hex.fill('#ff00ff');
  await page.getByRole('button', { name: 'Enregistrer les modifications', exact: true }).click();
  const savedGroup = await page.evaluate(() => window.savedAssets['picto-variants']);
  assert.equal(savedGroup.dimensions.variantMeta['picto-chair'].batPictoReplaceColor, '#ff00ff');
  assert.equal(savedGroup.dimensions.variantMeta['picto-chair'].reference, 'VARIANT');
  assert.deepEqual(savedGroup.dimensions.configOptions, [], 'No color group or new option is required to expose the BAT setting');
  assert.equal(await page.evaluate(async () => {
    const entry = { ...window.savedAssets['picto-chair'], modelSize: [1, 1, .5] };
    const pages = await window.exportPlan({ width: 4, depth: 3, layout: 'u', items: [{ ...entry, id: 'variant-chair', x: 0, z: 0, options: { variantGroupType: 'picto-variants', variantColorSelections: { fabric: { hex: '#bca123' } } } }], catalog: [entry, window.savedAssets['picto-variants']] });
    return !!pages[0].querySelector('[fill="#bca123"]');
  }), true, 'The saved variant rule is used by the real BAT exporter');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir Groupe BAT', exact: true }).click();
  assert.equal(await hex.inputValue(), '#ff00ff');
  assert.equal(await settings.locator('label.bat-picto-color-toggle').evaluate(label => getComputedStyle(label).display), 'flex');
  await settings.screenshot({ path: '/tmp/standing-bat-picto-color-settings.png' });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log('Admin BAT colors: visible controls on assets and variants without a color group, picker/hex validation, save/reopen/reset, real vector BAT recoloring by object finish with preserved outlines, per-color cache and responsive layout OK');
} finally { await browser?.close(); await server.close(); }
