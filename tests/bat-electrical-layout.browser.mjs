import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFDict, PDFNumber } from 'pdf-lib';

const fixtures = {
  '/__tv.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect data-tv="" x="0" y="0" width="100" height="20" fill="#222"/></svg>',
  '/__electric.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle data-electric="" cx="10" cy="10" r="9" fill="#ffcc22" stroke="#111"/></svg>',
  '/__arch.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><defs><style>.paint{fill:#f0f;opacity:.5;stroke:#0b0c1d;stroke-width:2}</style></defs><rect data-arch="" class="paint" width="100" height="200"/><rect data-detail="" x="8" y="9" width="10" height="15" fill="#fcffdd"/></svg>',
  '/bat-picto-mvryukq3.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><style>.old{fill:#ad7d05;opacity:.5;stroke:#0b0c1d}</style><rect class="old" width="100" height="200"/></svg>',
  '/__counter.svg': await readFile(new URL('./fixtures/reception-counter-bat.svg', import.meta.url), 'utf8'),
  '/__coffee.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34"><rect data-coffee="" width="24" height="34" fill="#432a18"/></svg>',
};
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'bat-electrical-layout', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (fixtures[req.url]) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(fixtures[req.url]); }
      else if (req.url === '/__electrical-layout__') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>body{margin:0}</style><script type="module">import * as bat from "/src/technicalExport.js"; window.bat=bat;</script>'); }
      else next();
    });
  },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1280 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__electrical-layout__`);
  await page.waitForFunction(() => window.bat);
  const result = await page.evaluate(async () => {
    const electric = { batElectricalPictoUrl: '/__electric.svg', batElectricalPictoY: -1, batElectricalPictoSize: .6 };
    const tv = { type: 'screen', label: 'TV 43 pouces', isWallItem: true, wall: 'back', modelSize: [.95, .6, .18], dimensions: { ...electric, batPictoUrl: '/__tv.svg' } };
    const counter = { type: 'comptoir-accueil', label: 'Comptoir accueil 2m', modelSize: [2, 1, .48], dimensions: { ...electric, batElectricalPictoY: .5, batPictoUrl: '/__counter.svg', batPictoReplaceColor: '#ff00ff' } };
    const power = { type: 'triplette', label: 'Triplette', modelSize: [.23, .05, .13], dimensions: { category: 'Électricité', batPictoUrl: '/__electric.svg' } };
    const arch = { type: 'arche-signature', label: 'Arche Signature 2m', modelSize: [1.1, 3.64, 2.52], dimensions: { batPictoUrl: '/__arch.svg', batPictoReplaceColor: '#ff00ff' } };
    const coffee = { id: 'coffee', type: 'nespresso', label: 'Machine à café', surfaceHostId: 'base', x: -.7, z: .65, y: 1, modelSize: [.24, .28, .34], dimensions: { batPictoUrl: '/__coffee.svg' } };
    const items = [coffee, { ...tv, id: 'tv', x: -.25, y: 1.6 }, { ...counter, id: 'base', included: true, x: -.7, z: .65, options: { binary2Color: '#0057a8' } },
      { ...counter, id: 'shop', x: .7, z: .65 }, { ...arch, id: 'arch', x: -.7, z: 0, options: { signatureArchColorHex: '#cc4422' } },
      { id: 'chair-under-arch', type: 'chair', x: -.7, z: 0, modelSize: [.52, .86, .5], color: '#116699' }];
    const before = JSON.stringify(items);
    const input = { width: 3, depth: 3, layout: 'back', items, catalog: [tv, counter, power, arch] };
    const pages = await window.bat.createTechnicalPlanSvgPages(input);
    document.body.append(pages[0]);
    const bounds = node => { const box = node.getBoundingClientRect(); let root = node.ownerSVGElement; while (root.ownerSVGElement) root = root.ownerSVGElement; const origin = root.getBoundingClientRect(); return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }; };
    const tvBody = bounds(pages[0].querySelector('[data-bat-id="tv"] [data-tv]'));
    const tvElectric = bounds(pages[0].querySelector('[data-bat-id="tv"] [data-electric]'));
    const counterElectric = bounds(pages[0].querySelector('[data-bat-id="base"] [data-electric]'));
    const archNode = pages[0].querySelector('[data-bat-id="arch"] [data-arch]');
    const detail = pages[0].querySelector('[data-bat-id="arch"] [data-detail]');
    const archPaint = (node) => {
      const { fill, fillOpacity, opacity, stroke, strokeOpacity } = getComputedStyle(node);
      return { fill, fillOpacity, opacity, stroke, strokeOpacity, groupOpacity: node.closest('g[opacity]')?.getAttribute('opacity') || '1' };
    };
    const variants = [{ ...arch, id: 'legacy', type: 'asset-arche-signature-2m-spot-210-mvhslqjn', x: 0, z: 0,
      dimensions: { batPictoUrl: '/bat-picto-mvryukq3.svg' }, options: { signatureArchColorHex: '#254abc' } },
    { ...arch, id: 'fallback', x: 1, z: 0, dimensions: {}, options: { signatureArchColorHex: '#254abc' } }];
    const variantSvg = (await window.bat.createTechnicalPlanSvgPages({ ...input, items: variants, catalog: [] }))[0];
    document.body.append(variantSvg);
    const legacyPaint = archPaint(variantSvg.querySelector('[data-bat-id="legacy"] .old'));
    const fallbackPaint = [...variantSvg.querySelectorAll('[data-bat-id="fallback"] rect')].map(archPaint);
    variantSvg.remove();
    const archBounds = bounds(archNode);
    const chairBounds = bounds(pages[0].querySelector('[data-bat-id="chair-under-arch"] rect'));
    const dimensions = [...pages[0].querySelectorAll('text')].filter(node=>node.getAttribute('data-bat-text-role')==='electrical-dimension').map(node=>node.textContent);
    const requirements = window.bat.standWallPanelRequirements(input).map(panel => [panel.lengthMm, panel.reinforced]);
    const glyphs = [...pages[0].querySelectorAll('[data-bat-id]')].map(node => node.dataset.batLayer ? `${node.dataset.batId}:${node.dataset.batLayer}` : node.dataset.batId);
    const noElectric = await window.bat.createTechnicalPlanSvgPages({ ...input, items: items.map(item => ({ ...item, dimensions: { ...item.dimensions, batElectricalPictoUrl: '' } })), catalog: [tv, counter, power, arch].map(entry => ({ ...entry, dimensions: { ...entry.dimensions, batElectricalPictoUrl: '' } })) });
    document.body.append(noElectric[0]);
    const withoutTvBody = bounds(noElectric[0].querySelector('[data-bat-id="tv"] [data-tv]'));
    noElectric[0].remove();
    const pdf = await window.bat.createTechnicalPlanBlob(input);
    return { unchanged: before === JSON.stringify(items), tvBody, tvElectric, counterElectric, withoutTvBody, glyphs, dimensions, requirements,
      arch: archPaint(archNode), detail: archPaint(detail), legacyPaint, fallbackPaint, archBounds, chairBounds,
      bytes: [...new Uint8Array(await pdf.arrayBuffer())] };
  });
  assert.equal(result.unchanged, true);
  assert.ok(Object.keys(result.tvBody).every(key => Math.abs(result.tvBody[key] - result.withoutTvBody[key]) < .001), 'The electrical symbol must never resize or shift the TV');
  assert.ok(result.tvElectric.y + result.tvElectric.height / 2 < result.tvBody.y, 'The symbol can protrude behind the TV/wall');
  assert.ok(Math.abs(result.tvElectric.width - result.counterElectric.width) < .01, 'Same physical symbol size on small TVs and large counters');
  assert.deepEqual(result.requirements, [[250, false], [500, false], [1000, true], [1000, false], [250, false]]);
  assert.ok(result.glyphs.includes('included-counter-power-base'));
  assert.ok(!result.glyphs.includes('included-counter-power-shop'));
  assert.equal(result.dimensions.length, 6, 'Only floor objects and the included power strip have electrical cotations');
  assert.ok(result.dimensions.every(text => Number(text) % 50 === 0));
  const coloredPaint = { fill: 'rgb(204, 68, 34)', fillOpacity: '0.5', opacity: '1', stroke: 'rgb(11, 12, 29)', strokeOpacity: '1', groupOpacity: '1' };
  assert.deepEqual(result.arch, coloredPaint, 'A former shape opacity becomes fill opacity only');
  assert.equal(result.detail.fill, 'rgb(252, 255, 221)');
  assert.equal(result.detail.fillOpacity, '1');
  assert.equal(result.detail.opacity, '1');
  assert.equal(result.detail.groupOpacity, '1');
  assert.deepEqual(result.legacyPaint, { ...coloredPaint, fill: 'rgb(37, 74, 188)' });
  assert.equal(result.fallbackPaint[0].opacity, '0.5', 'The fallback fill is translucent');
  assert.equal(result.fallbackPaint[1].opacity, '1', 'The fallback outline is opaque');
  const { archBounds: a, chairBounds: c, glyphs } = result;
  assert.ok(c.x > a.x && c.x + c.width < a.x + a.width && c.y > a.y && c.y + c.height < a.y + a.height, 'The test chair is physically under the arch');
  assert.ok(glyphs.indexOf('chair-under-arch') < glyphs.indexOf('arch') && glyphs.indexOf('tv') < glyphs.indexOf('arch'), 'Floor and wall objects paint before the translucent arch');
  const stack = ['base', 'coffee', 'arch', 'included-counter-power-base', 'base:electrical-overlay'];
  assert.deepEqual(glyphs.filter(id => stack.includes(id)), stack, 'Support, coffee machine, arch, power strip and electrical overlay paint bottom to top');
  assert.ok(glyphs.indexOf('tv:electrical-overlay') > glyphs.indexOf('arch'), 'Wall-mounted electrical overlays also stay on top');
  const pdf = await PDFDocument.load(Uint8Array.from(result.bytes));
  assert.equal(pdf.getPage(0).node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict)?.entries().length || 0, 0);
  const transparency = pdf.getPage(0).node.Resources().lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  assert.ok(transparency?.entries().some(([, ref]) => {
    const state = pdf.context.lookup(ref, PDFDict);
    return state.lookupMaybe(PDFName.of('ca'), PDFNumber)?.asNumber() === .5 && (state.lookupMaybe(PDFName.of('CA'), PDFNumber)?.asNumber() ?? 1) === 1;
  }), 'The printed PDF keeps the fill at 50% opacity and the outline opaque');
  if (process.env.BAT_ELECTRICAL_TEST_PDF) await writeFile(process.env.BAT_ELECTRICAL_TEST_PDF, Uint8Array.from(result.bytes));
  await page.locator('body > svg').screenshot({ path: '/tmp/standing-bat-electrical-layout.png' });
  assert.deepEqual(errors, []);
  console.log('BAT: electrical overlays, nearest-edge cotations, opaque arch outlines and details, 50%-opacity arch fill over the furniture and vector A3 OK');
} finally { await browser?.close(); await server.close(); }
