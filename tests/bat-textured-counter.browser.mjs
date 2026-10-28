import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFArray, decodePDFRawStream } from 'pdf-lib';

const counterSvg = await readFile(new URL('./fixtures/reception-counter-bat.svg', import.meta.url));
const blueImage = await readFile(new URL('./fixtures/melamine-blue-delft.jpeg', import.meta.url));
let imageRequests = 0;
let retryRequests = 0;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'bat-textured-counter',
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/__counter.svg') {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(counterSvg);
      } else if (['/__blue-delft.jpeg', '/__retry.jpeg'].includes(req.url)) {
        if (req.url === '/__retry.jpeg' && ++retryRequests === 1) { res.statusCode = 503; res.end('Unavailable'); return; }
        if (req.url === '/__blue-delft.jpeg') imageRequests += 1;
        res.setHeader('Content-Type', 'image/jpeg');
        res.end(blueImage);
      } else if (req.url === '/__bat-texture__') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><style>body{margin:0}</style><script type="module">import * as bat from "/src/technicalExport.js";window.bat=bat;</script>');
      } else next();
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1280 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bat-texture__`);
  await page.waitForFunction(() => window.bat);
  const result = await page.evaluate(async () => {
    const counter = { type: 'asset-banque-accueil-bois-1-5m-signa', label: 'Comptoir accueil bois 1.5m + Signa', modelSize: [1.54, 1, .48],
      dimensions: { batPictoUrl: '/__counter.svg', batPictoReplaceColor: '#ff00ff' } };
    // Saved fields from the reported scene: every imported melamine HEX is grey,
    // while the 3D renderer applies binary2ColorImage (or leaves the native wood).
    const blue = { ...counter, id: 'blue', x: -1.5, z: 0, options: {
      binary2Color: '#b8b8b8', binary2ColorImage: '/__blue-delft.jpeg', binary2ColorMode: 'color',
      binary2ColorName: 'U525 Bleu de Delft ST9', variantColorTargetHex: '#b8b8b8',
      variantColorSelections: { finish: { hex: '#b8b8b8', image: '/__blue-delft.jpeg' } },
    } };
    const wood = { ...counter, id: 'wood', x: 1.5, z: 0, options: {
      variantColorTargetHex: '#b8b8b8', variantColorSelections: { finish: { hex: '#b8b8b8', name: 'Brun taupe' } },
    } };
    const input = { width: 6, depth: 3, layout: 'back', items: [blue, wood], catalog: [counter] };
    const pages = await window.bat.createTechnicalPlanSvgPages(input);
    document.body.append(pages[0]);
    const fills = ['blue', 'wood'].map(id => getComputedStyle(pages[0].querySelector(`[data-bat-id="${id}"] .st2`)).fill);
    const stroke = getComputedStyle(pages[0].querySelector('[data-bat-id="blue"] .st2')).stroke;
    const pdf = await window.bat.createTechnicalPlanBlob(input);
    let textureError = '';
    const retryInput = { ...input, items: [{ ...blue, options: { ...blue.options, binary2ColorImage: '/__retry.jpeg' } }] };
    try { await window.bat.createTechnicalPlanSvgPages(retryInput); } catch (error) { textureError = error.message; }
    const retried = await window.bat.createTechnicalPlanSvgPages(retryInput);
    document.body.append(retried[0]);
    const retriedFill = getComputedStyle(retried[0].querySelector('.st2')).fill;
    retried[0].remove();
    return { fills, stroke, retriedFill, textureError, bytes: [...new Uint8Array(await pdf.arrayBuffer())] };
  });
  const blueRgb = result.fills[0].match(/\d+/g).map(Number);
  assert.ok(blueRgb[2] > blueRgb[0] + 60 && blueRgb[1] > blueRgb[0], `Expected the real Delft blue image, not the grey HEX: ${result.fills[0]}`);
  assert.equal(result.fills[1], 'rgb(196, 155, 99)', 'Unapplied modal selections must not repaint native wood');
  assert.equal(result.stroke, 'rgb(29, 29, 27)');
  assert.equal(result.retriedFill, result.fills[0]);
  assert.match(result.textureError, /texture de couleur/);
  assert.equal(imageRequests, 1, 'Share the sampled swatch between preview and PDF');
  assert.equal(retryRequests, 2, 'A failed texture read must be retried, never cached as grey');
  const pdf = await PDFDocument.load(Uint8Array.from(result.bytes));
  const contents = pdf.getPage(0).node.get(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  const commands = streams.map(ref => Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('latin1')).join('\n');
  const pdfColors = [...commands.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map(match => match.slice(1).map(Number));
  for (const color of [blueRgb, [196, 155, 99]]) {
    assert.ok(pdfColors.some(candidate => candidate.every((value, channel) => Math.abs(value - color[channel] / 255) < .006)), 'The PDF itself must contain both the blue and wood colors');
  }
  await writeFile('/tmp/standing-bat-blue-native-wood.pdf', Uint8Array.from(result.bytes));
  await page.locator('body > svg').screenshot({ path: '/tmp/standing-bat-blue-native-wood.png' });
  assert.deepEqual(errors, []);
  console.log('BAT actual melamine data: grey HEX + Delft blue image, native wood despite stale modal selection, SVG/PDF colors, outlines, sample cache and failed-read retry OK');
} finally {
  await browser?.close();
  await server.close();
}
