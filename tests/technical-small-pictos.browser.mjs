import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const fixtures = {
  '/__coffee-100.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25.79 86.69"><style>.body{fill:#939598;stroke:#000;stroke-width:1}</style><path class="body" data-coffee="100" d="M1 1H24V85H1Z"/></svg>',
  '/__coffee-300.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25.79 86.69"><style>.body{fill:#7aafdf;stroke:#000;stroke-width:1}</style><path class="body" data-coffee="300" d="M1 1H24V85H1Z"/></svg>',
  '/__power.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#eee" stroke="#000"/><path d="M35 15L25 55H48L40 85L75 40H52L62 15Z" fill="#111"/></svg>',
};
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'small-bat-pictos-test',
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (fixtures[req.url]) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(fixtures[req.url]); return; }
      if (req.url !== '/__small-pictos__') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><script type="module">import * as api from "/src/technicalExport.js"; window.api=api;</script>');
    });
  },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__small-pictos__`);
  await page.waitForFunction(() => window.api);
  const result = await page.evaluate(async () => {
    const coffee = type => ({ type: `coffee-${type}`, modelSize: [.5, .25, .32], dimensions: { batPictoUrl: `/__coffee-${type}.svg`, batPictoPath: `coffee-${type}.svg` } });
    const group = { type: 'coffee-group', dimensions: { isVariantGroup: true, variantAssets: [coffee(100), coffee(300)] } };
    const power = { type: 'power', modelSize: [.12, .05, .12], dimensions: { batPictoUrl: '/__power.svg', batPictoPath: 'power.svg' } };
    const items = [
      { id: 'coffee-selected', type: group.type, modelSize: [.5, .25, .32], x: -.5, z: -.5, rotation: 30, options: { variantGroupType: group.type, variantAssetType: 'coffee-300' } },
      { id: 'coffee-default', type: group.type, modelSize: [.5, .25, .32], x: .5, z: -.5, rotation: 0 },
      { id: 'power', type: power.type, modelSize: power.modelSize, x: 0, z: .5, rotation: 45 },
    ];
    const before = JSON.stringify(items);
    const pages = await window.api.createTechnicalPlanSvgPages({ width: 4, depth: 3, layout: 'u', items, catalog: [group, power] });
    const svg = pages[0]; document.body.append(svg); svg.style.width = '1400px'; svg.style.height = 'auto';
    const bounds = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const objects = items.map(item => {
      const object = svg.querySelector(`[data-bat-id="${item.id}"]`);
      const picto = object.querySelector('svg');
      const badge = object.querySelector(':scope > path[fill="#c9161d"]');
      return { id: item.id, image: !!picto, picto: picto ? bounds(picto) : null, badge: bounds(badge), variant: picto?.querySelector('[data-coffee]')?.getAttribute('data-coffee') };
    });
    return { objects, unchanged: before === JSON.stringify(items), rasterImages: svg.querySelectorAll('image').length, nestedSvg: svg.querySelectorAll('svg').length };
  });
  assert.equal(result.unchanged, true, 'No object placement or dimensions are changed');
  assert.equal(result.nestedSvg, 3);
  assert.equal(result.rasterImages, 0, 'Original coffee and power SVGs remain vectorial');
  assert.equal(result.objects[0].variant, '300');
  assert.equal(result.objects[1].variant, '100');
  for (const object of result.objects) {
    assert.equal(object.image, true, `${object.id} has its imported pictogram`);
    assert.ok(object.badge.top > object.picto.bottom, `${object.id}: the red number cannot conceal the SVG`);
  }
  await page.screenshot({ path: '/tmp/standing-small-bat-pictos.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('BAT coffee/power: selected and default variant SVGs, small and rotated pictos visible beside number badges, vector quality and unchanged scene geometry OK');
} finally { await browser?.close(); await server.close(); }
