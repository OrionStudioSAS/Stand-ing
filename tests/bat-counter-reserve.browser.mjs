import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

const fixtures = {
  '/__counter.svg': await readFile(new URL('./fixtures/reception-counter-bat.svg', import.meta.url), 'utf8'),
  '/__wall.svg': await readFile(new URL('./fixtures/reserve-wall-bat.svg', import.meta.url), 'utf8'),
};
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'bat-counter-reserve-regression',
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (fixtures[req.url]) {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(fixtures[req.url]);
      } else if (req.url === '/__bat-regression__') {
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bat-regression__`);
  await page.waitForFunction(() => window.bat);
  const result = await page.evaluate(async () => {
    const counter = { type: 'asset-banque-accueil-1-5m', label: 'Comptoir accueil', modelSize: [1.54, 1, .48],
      dimensions: { batPictoUrl: '/__counter.svg', batPictoReplaceColor: '#ff00ff' } };
    const wall = { type: 'cloison', label: 'Cloison Trad 1000x2500mm Ht', modelSize: [1, 2.5, .06],
      dimensions: { batPictoUrl: '/__wall.svg' } };
    const colors = ['#0057a8', '#f0dc0a'];
    const items = colors.map((color, index) => ({ ...counter, id: `counter-${index}`, x: index * 2 - 1, z: 1,
      dimensions: { ...counter.dimensions, batPictoReplaceColor: '' },
      options: { binary2Color: color, variantColorTargetHex: '#cccccc', variantColorSelections: { finish: { hex: '#cccccc' } } },
    }));
    for (const rotation of [0, 90]) items.push({ id: `reserve-${rotation}`, type: 'reserve', label: 'Reserve precise', isGroup: true,
      x: rotation ? 2 : -1, z: rotation ? -.5 : -1, rotation,
      children: [0, 1].map(index => ({ ...wall, id: `panel-${index}`, x: .06 + index, z: .06, rotation: 0 })),
    });
    const input = { width: 7, depth: 4, layout: 'back', items, catalog: [counter, wall] };
    const pages = await window.bat.createTechnicalPlanSvgPages(input);
    document.body.append(pages[0]);
    const computedColors = colors.map((_, index) => getComputedStyle(document.querySelector(`[data-bat-id="counter-${index}"] .st2`)).fill);
    const joints = [0, 90].map(rotation => {
      const rect = index => document.querySelector(`[data-bat-id="reserve-${rotation}-panel-${index}"] svg rect`).getBoundingClientRect();
      const a = rect(0), b = rect(1);
      return rotation ? Math.abs(a.top - b.bottom) : Math.abs(b.left - a.right);
    });
    const pdf = await window.bat.createTechnicalPlanBlob(input);
    const bytes = await pdf.arrayBuffer();
    const regenerated = await window.bat.createTechnicalPlanSvgPages({ ...input, items: items.map(item => item.id === 'counter-0'
      ? { ...item, options: { ...item.options, binary2Color: '#d2143c' } } : item) });
    document.body.append(regenerated[0]);
    const updatedColor = getComputedStyle(regenerated[0].querySelector('[data-bat-id="counter-0"] .st2')).fill;
    regenerated[0].remove();
    return { computedColors, joints, updatedColor, bytes: [...new Uint8Array(bytes)] };
  });
  assert.deepEqual(result.computedColors, ['rgb(0, 87, 168)', 'rgb(240, 220, 10)']);
  assert.equal(result.updatedColor, 'rgb(210, 20, 60)', 'Regenerating the BAT must not reuse a stale per-object color');
  assert.ok(result.joints.every(gap => gap < .5), `Touching panels show a gap: ${result.joints}`);
  const pdf = await PDFDocument.load(Uint8Array.from(result.bytes));
  for (const sheet of pdf.getPages()) {
    assert.ok(Math.abs(sheet.getWidth() - 420 * 72 / 25.4) < .02);
    assert.equal(sheet.node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict)?.entries().length || 0, 0, 'BAT stays vector, not a flattened image');
  }
  await writeFile('/tmp/standing-bat-counter-reserve.pdf', Uint8Array.from(result.bytes));
  await page.locator('body > svg').screenshot({ path: '/tmp/standing-bat-counter-reserve.png' });
  assert.deepEqual(errors, []);
  console.log('BAT: blue/yellow counters on the same SVG, stale saved settings, finish change, millimeter reserve joints at 0/90 degrees and vector A3 PDF OK');
} finally {
  await browser?.close();
  await server.close();
}
