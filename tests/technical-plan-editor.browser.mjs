import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="none" stroke="#111" stroke-width="4" d="M10 10H90V90H10Z"/></svg>';
const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const catalog = [{ type: 'chair', label: 'Chaise test', modelSize: [0.6, 1, 0.6], dimensions: { batPictoUrl: image, batPictoPath: 'chair.svg' } }];
const input = { width: 5, depth: 4, layout: 'u', catalog, items: [{ ...catalog[0], id: 'original-chair', x: 0, z: 0 }], documentInfo: { title: 'BAT test', salon: 'Salon test', stand: 'B-12' } };
const harness = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Editor from '/src/TechnicalPlanEditor.jsx';import * as exporter from '/src/technicalExport.js';import '/src/styles.css';
window.exporter=exporter;window.batInput=${JSON.stringify(input)};
function Test(){const[open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>Ouvrir le BAT</button>{open&&<Editor sceneId="editor-test" options={window.batInput} onClose={()=>setOpen(false)}/>}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'bat-editor-test',
  resolveId(id) { if (id === '/src/__bat-editor-test.jsx') return new URL('../src/__bat-editor-test.jsx', import.meta.url).pathname; },
  load(id) {
    if (id === new URL('../src/__bat-editor-test.jsx', import.meta.url).pathname) return harness;
    if (id.endsWith('/src/data/supabaseClient.js')) return 'export const supabase=null;';
  },
  configureServer(vite) { vite.middlewares.use('/__bat-editor-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__bat-editor-test.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bat-editor-test__`);
  const original = page.locator('.bat-editor-paper [data-bat-id="original-chair"]');
  await original.waitFor();
  const originalBox = await original.boundingBox();
  await page.mouse.move(originalBox.x + originalBox.width / 2, originalBox.y + originalBox.height / 2);
  await page.mouse.down(); await page.mouse.move(originalBox.x + originalBox.width / 2 + 45, originalBox.y + originalBox.height / 2 + 25, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-bat-id="original-chair"]')?.getAttribute('transform') !== 'translate(0 0)');
  await page.getByRole('button', { name: 'Ajouter une annotation' }).click();
  await page.getByLabel("Texte de l'annotation").fill('Pose à vérifier — BAT admin');
  await page.getByLabel('Picto du catalogue').selectOption('chair');
  await page.getByRole('button', { name: 'Ajouter le picto', exact: true }).click();
  await page.locator('[data-bat-kind="extra"]').waitFor();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter une annotation' }).click();
  await page.getByLabel("Texte de l'annotation").fill('Instruction sur la deuxième page');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByText('BAT enregistré.', { exact: true }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('standing-bat-edits-editor-test')));
  assert.equal(saved.revision, 1); assert.equal(saved.edits.annotations.length, 2); assert.equal(saved.edits.extras.length, 1);
  assert.ok(saved.edits.items['original-chair'].dx > 0);
  assert.equal(saved.edits.annotations[1].page, 1);
  await page.getByLabel("Fermer l'éditeur BAT").click();
  await page.getByRole('button', { name: 'Ouvrir le BAT' }).click();
  await original.waitFor();
  assert.notEqual(await original.getAttribute('transform'), 'translate(0 0)');
  const rendered = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('standing-bat-edits-editor-test'));
    const pages = await window.exporter.createTechnicalPlanSvgPages({ ...window.batInput, batEdits: saved.edits });
    const blob = await window.exporter.createTechnicalPlanBlob({ ...window.batInput, batEdits: saved.edits });
    const bytes = await blob.arrayBuffer();
    return { first: pages[0].outerHTML, second: pages[1].outerHTML, pdf: Array.from(new Uint8Array(bytes)), original: window.batInput.items[0] };
  });
  assert.match(rendered.first, /Pose à vérifier/); assert.match(rendered.second, /Instruction sur la deuxième page/);
  assert.match(rendered.first, /data-bat-kind="extra"/);
  assert.equal(rendered.original.x, 0); assert.equal(rendered.original.z, 0);
  const pdf = await PDFDocument.load(Uint8Array.from(rendered.pdf));
  assert.equal(pdf.getPageCount(), 2);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 420 * 72 / 25.4) < 0.02);
  await page.screenshot({ path: '/tmp/standing-bat-editor-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/standing-bat-editor-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
  console.log('BAT editor: drag existing picto, add pictos and annotations across pages, save/reopen, unchanged scene, vector A3 export, mobile OK');
} finally { await browser?.close(); await server.close(); }
