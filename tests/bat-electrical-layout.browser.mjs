import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFDict, PDFNumber } from 'pdf-lib';

const fixtures = {
  '/__tv.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect data-tv="" x="0" y="0" width="100" height="20" fill="#222"/></svg>',
  '/__electric.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle data-electric="" cx="10" cy="10" r="9" fill="#ffcc22" stroke="#111"/></svg>',
  '/__arch.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect data-arch="" width="100" height="200" fill="#f0f"/></svg>',
  '/__counter.svg': await readFile(new URL('./fixtures/reception-counter-bat.svg', import.meta.url), 'utf8'),
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
    const items = [{ ...tv, id: 'tv', x: -.25, y: 1.6 }, { ...counter, id: 'base', included: true, x: -.7, z: .65, options: { binary2Color: '#0057a8' } },
      { ...counter, id: 'shop', x: .7, z: .65 }, { ...arch, id: 'arch', x: -.7, z: 0, options: { signatureArchColorHex: '#cc4422' } }];
    const before = JSON.stringify(items);
    const input = { width: 3, depth: 3, layout: 'back', items, catalog: [tv, counter, power, arch] };
    const pages = await window.bat.createTechnicalPlanSvgPages(input);
    document.body.append(pages[0]);
    const bounds = node => { const box = node.getBoundingClientRect(); let root = node.ownerSVGElement; while (root.ownerSVGElement) root = root.ownerSVGElement; const origin = root.getBoundingClientRect(); return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }; };
    const tvBody = bounds(pages[0].querySelector('[data-bat-id="tv"] [data-tv]'));
    const tvElectric = bounds(pages[0].querySelector('[data-bat-id="tv"] [data-electric]'));
    const counterElectric = bounds(pages[0].querySelector('[data-bat-id="base"] [data-electric]'));
    const archNode = pages[0].querySelector('[data-bat-id="arch"] [data-arch]');
    const archOpacity = archNode.closest('g[opacity]')?.getAttribute('opacity');
    const dimensions = [...pages[0].querySelectorAll('text')].map(node => node.textContent).filter(text => /^E\d+ · /.test(text));
    const requirements = window.bat.standWallPanelRequirements(input).map(panel => [panel.lengthMm, panel.reinforced]);
    const glyphs = [...pages[0].querySelectorAll('[data-bat-id]')].map(node => node.dataset.batId);
    const noElectric = await window.bat.createTechnicalPlanSvgPages({ ...input, items: items.map(item => ({ ...item, dimensions: { ...item.dimensions, batElectricalPictoUrl: '' } })), catalog: [tv, counter, power, arch].map(entry => ({ ...entry, dimensions: { ...entry.dimensions, batElectricalPictoUrl: '' } })) });
    document.body.append(noElectric[0]);
    const withoutTvBody = bounds(noElectric[0].querySelector('[data-bat-id="tv"] [data-tv]'));
    noElectric[0].remove();
    const pdf = await window.bat.createTechnicalPlanBlob(input);
    return { unchanged: before === JSON.stringify(items), tvBody, tvElectric, counterElectric, withoutTvBody, glyphs, dimensions, requirements,
      archFill: archNode.getAttribute('fill'), archOpacity, firstObject: pages[0].querySelector('[data-bat-id]')?.dataset.batId,
      bytes: [...new Uint8Array(await pdf.arrayBuffer())] };
  });
  assert.equal(result.unchanged, true);
  assert.ok(Object.keys(result.tvBody).every(key => Math.abs(result.tvBody[key] - result.withoutTvBody[key]) < .001), 'The electrical symbol must never resize or shift the TV');
  assert.ok(result.tvElectric.y + result.tvElectric.height / 2 < result.tvBody.y, 'The symbol can protrude behind the TV/wall');
  assert.ok(Math.abs(result.tvElectric.width - result.counterElectric.width) < .01, 'Same physical symbol size on small TVs and large counters');
  assert.deepEqual(result.requirements, [[250, false], [500, false], [1000, true], [1000, false], [250, false]]);
  assert.ok(result.glyphs.includes('included-counter-power-base'));
  assert.ok(!result.glyphs.includes('included-counter-power-shop'));
  assert.equal(result.dimensions.length, 8, 'Two cotations for each of three electrical overlays and the included power strip');
  assert.ok(result.dimensions.every(text => Number(text.split(' · ')[1]) % 50 === 0));
  assert.equal(result.archFill, '#cc4422'); assert.equal(result.archOpacity, '0.5'); assert.equal(result.firstObject, 'arch');
  const pdf = await PDFDocument.load(Uint8Array.from(result.bytes));
  assert.equal(pdf.getPage(0).node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict)?.entries().length || 0, 0);
  const transparency = pdf.getPage(0).node.Resources().lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  assert.ok(transparency?.entries().some(([, ref]) => pdf.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of('ca'), PDFNumber)?.asNumber() === .5), 'The printed PDF keeps the arch at 50% opacity too');
  await page.locator('body > svg').screenshot({ path: '/tmp/standing-bat-electrical-layout.png' });
  assert.deepEqual(errors, []);
  console.log('BAT: independent equal-size electrical glyphs outside TV/wall, unchanged primary geometry, nearest-edge 5cm cotations, centered reinforcement cutting, base-only power strip, colored 50%-opacity arch and vector A3 OK');
} finally { await browser?.close(); await server.close(); }
