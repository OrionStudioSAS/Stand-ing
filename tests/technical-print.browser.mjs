import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'bat-print-test-page',
  configureServer(vite) {
    vite.middlewares.use('/__bat-print-test__', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><script type="module">import * as exporter from "/src/technicalExport.js"; import * as svg from "/src/technicalSvgContext.js"; window.exporter=exporter;window.svgTools=svg;</script>');
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const directory = await mkdtemp(join(tmpdir(), 'standing-bat-test-'));
try {
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/__bat-print-test__`);
  await page.waitForFunction(() => window.exporter);
  const result = await page.evaluate(async () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.edge{fill:none;stroke:#111;stroke-width:2}.colour{fill:url(#paint)}</style><defs><linearGradient id="paint"><stop stop-color="#0057a8"/><stop offset="1" stop-color="#c9161d"/></linearGradient></defs><path class="edge" d="M10 10H90V90H10Z"/><path class="colour" d="M12 12H30V30H12Z"/></svg>';
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const catalog = [{ type: 'furniture', label: 'Mobilier', modelSize: [1, 1, 0.5], dimensions: { batPictoUrl: url, batPictoPath: 'furniture.svg', reference: 'AMCO-TEST' } }];
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `item-${i}`, type: 'furniture', label: `Objet ${i + 1}`, x: i - 1, z: 0, modelSize: [1, 1, 0.5], dimensions: catalog[0].dimensions }));
    const input = { width: 7, depth: 3.5, layout: 'u', items, catalog, documentInfo: { title: 'Société test', salon: 'SMCL 2026', hall: '3', stand: 'A-12' } };
    window.batInput = input;
    const svgPages = await window.exporter.createTechnicalPlanSvgPages(input);
    const pdf = await window.exporter.createTechnicalPlanBlob(input);
    const longItems = Array.from({ length: 65 }, (_, i) => ({ ...items[i % 3], id: `long-${i}`, label: `Mobilier ${i + 1}`, options: { variantBatDescription: `DESCRIPTION-COMPLETE-${i + 1}\n${'X'.repeat(400)}\nInstruction 1\nInstruction 2\nInstruction 3\nInstruction finale ${i + 1}` } }));
    const longPages = await window.exporter.createTechnicalPlanSvgPages({ ...input, items: longItems });
    const unsafe = new XMLSerializer().serializeToString(window.svgTools.sanitizeTechnicalSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><image href="https://invalid.example/image"/><path style="fill:url(https://invalid.example/a)" d="M0 0L10 10"/></svg>'));
    const encode = (blob) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    return { pdf: await encode(pdf), type: pdf.type, pages: svgPages.map((svg) => new XMLSerializer().serializeToString(svg)), longPages: longPages.map((svg) => svg.textContent), unsafe };
  });
  assert.equal(result.type, 'application/pdf');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].match(/<svg/g).length, 4, 'Each original SVG is embedded inline, not as a PNG');
  assert.doesNotMatch(result.pages[0], /<image/);
  assert.match(result.pages[0], /picto-1-paint/);
  assert.match(result.pages[0], /#picto-1 \.edge/);
  assert.match(result.pages[0], /url\(["']?#picto-1-paint["']?\)/);
  assert.doesNotMatch(result.unsafe, /onload|<script|https:\/\//);
  assert.ok(result.longPages.length > 2);
  assert.match(result.longPages.join(' '), /Instruction finale 65/);
  assert.match(result.longPages.join(' '), /DESCRIPTION-COMPLETE-65/);
  const pdf = await PDFDocument.load(Buffer.from(result.pdf.split(',')[1], 'base64'));
  assert.equal(pdf.getPageCount(), 2);
  for (const pdfPage of pdf.getPages()) {
    assert.ok(Math.abs(pdfPage.getWidth() - 420 * 72 / 25.4) < 0.02);
    assert.ok(Math.abs(pdfPage.getHeight() - 297 * 72 / 25.4) < 0.02);
    const xobjects = pdfPage.node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict);
    assert.equal(xobjects?.entries().length || 0, 0, 'No flattened full-page bitmap');
  }
  const downloading = page.waitForEvent('download');
  await page.evaluate(() => window.exporter.exportTechnicalPdf(window.batInput));
  const download = await downloading;
  assert.match(download.suggestedFilename(), /-A3\.pdf$/);
  const path = join(directory, 'download.pdf');
  await download.saveAs(path);
  assert.equal((await PDFDocument.load(await readFile(path))).getPageCount(), 2);
  assert.deepEqual(errors, []);
  console.log('BAT browser: transparent vector SVGs, A3 PDF, complete multipage details and PDF download OK');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
