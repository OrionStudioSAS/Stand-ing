import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const directory = await mkdtemp(resolve('node_modules/.standing-bat-recovery-'));
const source = await readFile('src/App.jsx', 'utf8');
const counterSvg = await readFile('tests/fixtures/reception-counter-bat.svg', 'utf8');
const appId = resolve('src/__bat-recovery-app.jsx');
const pageId = resolve('src/__bat-recovery-page.jsx');
const asset = { type: 'reception-counter-test', label: 'Comptoir accueil 1,5 m', is_active: true,
  dimensions: { size: [1.5, 1, .5], category: 'Mobilier', packs: ['Confort'], batPictoUrl: '/counter.svg', batPictoPath: 'counter.svg', batPictoReplaceColor: '#ff00ff' } };
const scene = { id: 'bat-recovery', client_name: 'Exposant test', project_name: 'NOM STAND 2 (test)', offer: 'Confort', dimensions: { width: 5, depth: 4 }, layout: 'back',
  items: [{ id: 'counter', type: asset.type, label: asset.label, x: 0, z: 0, dimensions: asset.dimensions, options: { binary2Color: '#244998' } }], options: { ledRailsEnabled: false }, source_payload: {} };
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{AdminBatView}from'/src/__bat-recovery-app.jsx';import Notice from '/src/DeploymentUpdateNotice.jsx';import{createTechnicalPlanSvgPages}from'/src/technicalExport.js';
const scene=${JSON.stringify(scene)},asset=${JSON.stringify(asset)};
window.checkCounter=async(color='#244998')=>{const pages=await createTechnicalPlanSvgPages({width:5,depth:4,layout:'back',items:scene.items.map(item=>({...item,options:{...item.options,binary2Color:color}})),catalog:[asset]});const svg=pages[0];document.body.append(svg);const result={fill:getComputedStyle(svg.querySelector('.st2')).fill,stroke:getComputedStyle(svg.querySelector('.st0')).stroke,raster:svg.querySelectorAll('image').length,vectors:svg.querySelectorAll('svg').length};svg.remove();return result};
createRoot(document.getElementById('root')).render(<><label>Brouillon admin <input aria-label="Brouillon admin"/></label><AdminBatView scenes={[scene]} assets={[asset]}/><Notice/></>);`;
let browser, server, broken = true;
const requestedChunks = [];
try {
  const entry = join(directory, 'index.html');
  await writeFile(entry, '<!doctype html><html lang="fr"><div id="root"></div><script type="module" src="/src/__bat-recovery-page.jsx"></script></html>');
  const result = await build({ configFile: false, logLevel: 'error', plugins: [{
    name: 'bat-recovery-fixtures',
    resolveId(id) { if (id === '/src/__bat-recovery-app.jsx') return appId; if (id === '/src/__bat-recovery-page.jsx') return pageId; },
    load(id) {
      if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {AdminBatView};');
      if (id === pageId) return harness;
      if (id === resolve('src/data/supabaseClient.js')) return 'export const supabase=null;';
      if (id === resolve('src/data/technicalPlanStore.js')) return 'export async function loadTechnicalPlanEdits(){return {edits:{},revision:0}};export async function saveTechnicalPlanEdits(){throw Error("No writes allowed in this test")};';
    },
  }], build: { write: false, rollupOptions: { input: entry } } });
  const outputs = (Array.isArray(result) ? result.flatMap(bundle => bundle.output) : result.output);
  const files = new Map(outputs.map(output => [`/${output.fileName}`, output.type === 'chunk' ? output.code : output.source]));
  const html = outputs.find(output => output.fileName.endsWith('.html')).source;
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://test').pathname;
    if (path === '/counter.svg') { response.setHeader('Content-Type', 'image/svg+xml'); return response.end(counterSvg); }
    if (/\/assets\/(?:jspdf|svg2pdf)/.test(path)) {
      requestedChunks.push(path);
      if (broken) return setTimeout(() => { response.writeHead(404); response.end('Chunk from the old deployment is gone'); }, 200);
    }
    const body = files.get(path) ?? (path === '/admin' ? html : undefined);
    if (body === undefined) { response.writeHead(404); return response.end(); }
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], downloads = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('download', download => downloads.push(download));
  await page.goto(`http://127.0.0.1:${server.address().port}/admin`);
  await page.getByRole('button', { name: 'Télécharger BAT', exact: true }).waitFor();
  const counter = await page.evaluate(() => window.checkCounter());
  assert.equal(counter.fill, 'rgb(36, 73, 152)');
  assert.equal(counter.stroke, 'rgb(29, 29, 27)');
  assert.ok(counter.vectors > 0);
  assert.equal(counter.raster, 0, 'The real Illustrator counter remains vectorial');
  assert.equal((await page.evaluate(() => window.checkCounter('#ab1234'))).fill,'rgb(171, 18, 52)','Different finishes do not reuse the previous color');
  await page.getByLabel('Brouillon admin').fill('Modification non enregistrée à conserver');
  await page.getByRole('button', { name: 'Télécharger BAT', exact: true }).click();
  await page.getByRole('button', { name: 'Préparation du BAT…', exact: true }).waitFor();
  const notice = page.locator('.deployment-update-notice'); await notice.waitFor();
  assert.match(await page.locator('.bat-table > [role=alert]').innerText(), /rechargez la page/);
  assert.equal(await page.getByLabel('Brouillon admin').inputValue(), 'Modification non enregistrée à conserver', 'No automatic reload can discard pending edits');
  assert.equal(await page.getByRole('button', { name: 'Télécharger BAT', exact: true }).isEnabled(), true);
  assert.ok(requestedChunks.length > 0); assert.equal(downloads.length, 0);
  await notice.getByRole('button', { name: "Masquer l'avertissement", exact: true }).click();
  assert.equal(await notice.count(), 0);
  assert.equal(await page.getByLabel('Brouillon admin').inputValue(), 'Modification non enregistrée à conserver');
  await page.getByRole('button', { name: 'Télécharger BAT', exact: true }).click(); await notice.waitFor();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await notice.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  }
  await notice.screenshot({ path: '/tmp/standing-bat-download-reload-notice.png' });
  broken = false;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: "Recharger l'application", exact: true }).click()]);
  assert.equal(await notice.count(), 0);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger BAT', exact: true }).click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /-A3\.pdf$/);
  const path = join(directory, 'BAT.pdf'); await download.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  assert.ok(pdf.getPageCount() >= 1);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 420 * 72 / 25.4) < .02);
  assert.deepEqual(errors, []);
  console.log('BAT recovery: real production PDF chunk 404, visible error/reload notice, preserved draft, successful PDF after reload, responsive notice and real Illustrator shorthand counter recoloring without rasterization OK');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
