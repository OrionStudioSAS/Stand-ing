import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const devicePicto = (width, depth) => ({ batPictoUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${depth}"><rect width="${width}" height="${depth}" fill="#aaa"/><rect y="${depth * .8}" width="${width}" height="${depth * .2}" fill="#222"/></svg>`)}` });
    items.push(
      { id: 'reception', type: 'asset-banque-accueil-bois-1m-signa-mr48wzmt', label: 'Comptoir accueil', x: 2.5, z: .5, rotation: 180, modelSize: [1, 1, .5], dimensions: devicePicto(100, 50) },
      { id: 'tv', type: 'screen', label: 'TV 43', x: .5, wall: 'back', modelSize: [1, .6, .1], dimensions: devicePicto(100, 10) },
      { id: 'rigging', type: 'asset-enseigne-haute-aluminium-2000x2000x1000mm-ht-mrbwze9h', label: 'Enseigne haute 2 m', x: 1.5, z: -.4, rotation: 90, dimensions: { ceilingMounted: true }, modelSize: [2, 5.8, 2] },
      { id: 'hex-sign', label: 'Enseigne haute hexagonale', x: 0, z: -.5, dimensions: { ceilingMounted: true }, modelSize: [1.6, 5.8, .3] },
      { id: 'one-meter-sign', label: 'Enseigne haute 1 m', x: -1.75, z: .8, dimensions: { ceilingMounted: true }, modelSize: [1, 5.8, 1] },
      { id: 'head', type: 'head-smcl', label: 'Tête de cloison gauche', isWallItem: true, wall: 'left', technicalHeadPlan: { x: -3.4, z: 1.2, rotation: 90, width: 1.25, depth: .11 } },
      { id: 'rail', type: 'rail', label: 'Rail LED 3 Spots', x: -1.5, wall: 'back', modelSize: [1, .15, .2] },
    );
    const input = { width: 7, depth: 3.5, layout: 'u', items, catalog, documentInfo: { title: 'Société test', salon: 'SMCL 2026', hall: '3', stand: 'A-12', aisleNumber: 'A', aisleSide: 'right' } };
    window.batInput = input;
    const svgPages = await window.exporter.createTechnicalPlanSvgPages(input);
    const orientations = Object.fromEntries(['reception', 'tv'].map((id) => {
      const group = svgPages[0].querySelector(`[data-bat-id="${id}"] g[transform]`);
      const matrix = group.transform.baseVal.consolidate().matrix;
      return [id, [matrix.a, matrix.b, matrix.c, matrix.d]];
    }));
    const pdf = await window.exporter.createTechnicalPlanBlob(input);
    const longItems = Array.from({ length: 65 }, (_, i) => ({ ...items[i % 3], id: `long-${i}`, label: `Mobilier ${i + 1}`, options: { variantBatDescription: `DESCRIPTION-COMPLETE-${i + 1}\n${'X'.repeat(400)}\nInstruction 1\nInstruction 2\nInstruction 3\nInstruction finale ${i + 1}` } }));
    const longPages = await window.exporter.createTechnicalPlanSvgPages({ ...input, items: longItems });
    const unsafe = new XMLSerializer().serializeToString(window.svgTools.sanitizeTechnicalSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><image href="https://invalid.example/image"/><path style="fill:url(https://invalid.example/a)" d="M0 0L10 10"/></svg>'));
    const encode = (blob) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    return { pdf: await encode(pdf), type: pdf.type, pages: svgPages.map((svg) => new XMLSerializer().serializeToString(svg)), longPages: longPages.map((svg) => svg.textContent), orientations, unsafe };
  });
  assert.equal(result.type, 'application/pdf');
  assert.equal(result.pages.length, 1);
  assert.match(result.pages[0], /<text[^>]*transform="matrix\(0 1 -1 0 [^"]+\)"[^>]*>Allée A<\/text>/);
  assert.equal(result.pages[0].match(/<svg/g).length, 6, 'Each original SVG is embedded inline, not as a PNG');
  assert.deepEqual(result.orientations, { reception: [1, 0, 0, 1], tv: [1, 0, 0, 1] });
  const spans = [...result.pages[0].matchAll(/data-bat-text-role="rigging-span"[^>]*>(\d+)<\/text>/g)].map(match => match[1]);
  assert.deepEqual(spans, ['2000', '700', '1000']);
  assert.equal(result.pages[0].match(/data-bat-text-role="rigging-offset"/g)?.length, 6);
  assert.equal(result.pages[0].match(/stroke="#207b4d"/g)?.length, 6, 'Only the two hexagonal points have green target marks');
  assert.doesNotMatch(result.pages[0], /E\d+\.\d+<\/text>/);
  assert.match(result.pages[0], /data-bat-id="head"[^>]*><rect[^>]*transform="matrix\(0 -1 1 0 /, 'The SMCL head fallback uses its scene yaw');
  assert.doesNotMatch(result.pages[0], />Rail LED 3 Spots<|>TV 43[^<]*<|fill="#ffffff"[^>]*font-size="17"/);
  assert.match(result.pages[0], />CLOISON(?: TRAD)?</);
  assert.doesNotMatch(result.pages[0], /<image/);
  assert.match(result.pages[0], /picto-1-paint/);
  assert.match(result.pages[0], /#picto-1 \.edge/);
  assert.match(result.pages[0], /url\(["']?#picto-1-paint["']?\)/);
  assert.doesNotMatch(result.unsafe, /onload|<script|https:\/\//);
  assert.equal(result.longPages.length, 1);
  assert.doesNotMatch(result.longPages[0], /Instruction finale 65|DESCRIPTION-COMPLETE-65/);
  const pdf = await PDFDocument.load(Buffer.from(result.pdf.split(',')[1], 'base64'));
  assert.equal(pdf.getPageCount(), 1);
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
  assert.equal((await PDFDocument.load(await readFile(path))).getPageCount(), 1);
  const floorCheck = await page.evaluate(async (savePdf) => {
    const layouts = [];
    for (const [layout, extension] of [['back', 0], ['left', .06], ['right', .06], ['u', .06]]) {
      const width = 15, depth = 4;
      const options = { width, depth, layout, catalog: [], items: [
        { id: 'front-counter', type: 'counter', label: 'Banque accueil', modelSize: [1.04, 1, .48], x: 0, z: depth / 2 + extension - .24, color: '#a96b32' },
        { sourceOptions: { carpetColorHex: '#000000', carpetFootprintEnabled: false }, sourceFloor: { footprintEnabled: false } },
      ] };
      const svg = await window.exporter.createTechnicalPlanSvg(options);
      document.body.append(svg);
      const floor = svg.querySelector('rect[fill="#dbdbdb"]').getBoundingClientRect();
      const scale = floor.width / width;
      const wallFronts = [...svg.querySelectorAll('rect')].map(node => node.getBoundingClientRect())
        .filter(box => Math.abs(box.height / scale - depth) < .001 && Math.abs(box.width / scale - .06) < .001);
      const counter = svg.querySelector('[data-bat-id="front-counter"] rect[fill="#a96b32"]').getBoundingClientRect();
      const texts = [...svg.querySelectorAll('text')].map(node => node.textContent);
      layouts.push({ layout, depth: floor.height / scale,
        counterGap: (floor.bottom - counter.bottom) / scale, wallGaps: wallFronts.map(box => (floor.bottom - box.bottom) / scale),
        nominalCote: texts.includes('4000') && !texts.includes('4060') });
      if (savePdf && layout === 'u') {
        const pdf = await window.exporter.createTechnicalPlanBlob(options, svg);
        layouts.at(-1).pdf = [...new Uint8Array(await pdf.arrayBuffer())];
      }
      svg.remove();
    }
    return layouts;
  }, Boolean(process.env.BAT_FLOOR_TEST_PDF));
  for (const result of floorCheck) {
    assert.ok(Math.abs(result.depth - (result.layout === 'back' ? 4 : 4.06)) < .001, result.layout);
    assert.ok(Math.abs(result.counterGap) < .001, 'The front object is flush with the carpet');
    assert.equal(result.wallGaps.length, result.layout === 'u' ? 2 : result.layout === 'back' ? 0 : 1);
    assert.ok(result.wallGaps.every(gap => Math.abs(gap) < .001), 'The carpet reaches the ends of the side panels');
    assert.equal(result.nominalCote, true);
    if (result.pdf) await writeFile(process.env.BAT_FLOOR_TEST_PDF, Uint8Array.from(result.pdf));
  }
  assert.deepEqual(errors, []);
  console.log('BAT browser: single A3 sheet, vector pictos and download, retained wall labels and rigging, actual carpet front edge with nominal cotation OK');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
