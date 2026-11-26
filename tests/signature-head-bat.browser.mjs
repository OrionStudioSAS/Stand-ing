import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__head-bat-app.jsx');
const pageId = resolve('src/__head-bat-page.jsx');
const headSvg = await readFile(new URL('./fixtures/signature-partition-head-bat.svg', import.meta.url), 'utf8');
const electricalSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#63ad36"/></svg>';
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AssetDrawer, technicalPartitionHeadPose } from '/src/__head-bat-app.jsx';
import { createTechnicalPlanBlob, createTechnicalPlanSvg } from '/src/technicalExport.js';
const asset = { type: 'asset-tete-de-cloison-mub9t9vw', label: 'Tête de cloison', dimensions: {
  size: [.16, 2.5, .5], packs: ['Signature'], batPictoUrl: '/__head.svg',
  batElectricalPictos: [{ url: '/__electrical.svg', x: .5, y: .28, size: .2 }],
} };
const width = 6, depth = 3;
createRoot(document.getElementById('root')).render(<AssetDrawer asset={asset} assets={[asset]} scenes={[]} onSave={value => { window.savedAsset = value; }} />);
window.makePlan = async ({ dimensions }) => {
  const items = [['back', -1.5], ['left', .85], ['right', .85]].map(([wall, x]) => {
    const item = { ...asset, dimensions, id: wall, isWallItem: true, wall, x };
    return { ...item, technicalHeadPlan: technicalPartitionHeadPose(item, [], width, depth) };
  });
  const options = { width, depth, layout: 'u', items, catalog: [{ ...asset, dimensions }] };
  const svg = await createTechnicalPlanSvg(options);
  document.body.append(svg);
  return { svg, pdf: () => createTechnicalPlanBlob(options) };
};`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-head-bat',
  resolveId(id) {
    if (id === '/src/__head-bat-app.jsx') return appId;
    if (id === '/src/__head-bat-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { AssetDrawer, technicalPartitionHeadPose };');
    if (id === pageId) return harness;
  },
  configureServer(vite) {
    for (const [url, svg] of [['/__head.svg', headSvg], ['/__electrical.svg', electricalSvg]]) {
      vite.middlewares.use(url, (_req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg); });
    }
    vite.middlewares.use('/__head-bat-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__head-bat-page.jsx"></script>'); });
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__head-bat-test__`);
  const editor = page.getByRole('region', { name: 'Pictos électriques BAT' });
  const frame = editor.locator('.bat-electrical-preview');
  const symbol = editor.getByRole('button', { name: 'Déplacer le picto électrique', exact: true });
  await symbol.scrollIntoViewIfNeeded();
  const target = await frame.boundingBox();
  const start = await symbol.boundingBox();
  assert.ok(Math.abs(target.width / target.height - .5 / .16) < .01, 'The drawer shows the same wide footprint as the BAT');
  assert.equal(await frame.locator(':scope > img').evaluate(node => getComputedStyle(node).objectFit), 'fill');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * .7, target.y + target.height * .8);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  const result = await page.evaluate(async () => {
    const { svg, pdf } = await window.makePlan(window.savedAsset);
    const center = (shape) => {
      const box = shape.getBBox();
      return new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(shape.getScreenCTM());
    };
    const projections = ['back', 'left', 'right'].map(wall => {
      const group = svg.querySelector(`[data-bat-id="${wall}"]`);
      const [body, stripe] = group.querySelectorAll('svg rect');
      const icon = group.querySelector('svg circle');
      const origin = center(body);
      const yellow = center(stripe);
      const electrical = center(icon);
      const { width, height } = stripe.getBoundingClientRect();
      return { wall, width, height, yellow: [yellow.x - origin.x, yellow.y - origin.y],
        electrical: [electrical.x - origin.x, electrical.y - origin.y],
        physicalRatio: icon.getBoundingClientRect().width / Math.max(...['width', 'height'].map(key => body.getBoundingClientRect()[key])),
      };
    });
    return { saved: window.savedAsset.dimensions.batElectricalPictos[0], projections, pdf: [...new Uint8Array(await (await pdf()).arrayBuffer())] };
  });
  assert.ok(Math.abs(result.saved.x - .7) < .02 && Math.abs(result.saved.y - .8) < .03, 'Dragging saves the point on the wide SVG');
  for (const { wall, width, height, yellow: [sx, sy], electrical: [x, y], physicalRatio } of result.projections) {
    assert.ok(wall === 'back' ? width > 10 * height : height > 10 * width, `The yellow strip follows the long axis on ${wall}`);
    assert.ok(wall === 'back' ? sy < 0 : wall === 'left' ? sx < 0 : sx > 0, `The yellow edge sits against the ${wall} wall`);
    assert.ok(wall === 'back' ? x > 0 && y > 0 : wall === 'left' ? x > 0 && y < 0 : x < 0 && y > 0, `The electrical point follows the drawing on ${wall}`);
    assert.ok(Math.abs(physicalRatio - .2 / .5) < .01, 'The electrical pictogram retains its physical size');
  }
  const bytes = Uint8Array.from(result.pdf);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  if (process.env.BAT_HEAD_TEST_PDF) await writeFile(process.env.BAT_HEAD_TEST_PDF, bytes);
  assert.deepEqual(errors, []);
  console.log('Signature BAT head: original yellow strip follows each wall, electrical placement matches the drawer, single-page PDF OK');
} finally {
  await browser?.close();
  await server.close();
}
