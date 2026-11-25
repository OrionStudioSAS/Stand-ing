import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const realDataPath = process.env.BAT_LAYOUT_REAL_DATA;
const output = process.env.BAT_LAYOUT_OUTPUT || resolve(tmpdir(), 'standing-bat-production-layout');
await mkdir(output, { recursive: true });
const artwork = (name, color = '#15547b') => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${color}"/><text x="200" y="150" fill="white" font-size="25" text-anchor="middle">${name}</text></svg>`);
const logo = artwork('LOGO');
const counter = { id: 'counter', type: 'counter', label: 'Comptoir accueil', x: 1.8, z: 1.05, modelSize: [1.5, 1, .5], options: { binary3Enabled: true, binary3ImageUrl: logo } };
const marker = (banners = []) => ({ sourceOptions: { carpetColorName: 'Gris clair', carpetColorCode: '0939', carpetColorHex: '#c6c6c6', wallFabricColorName: 'Blanc', wallFabricColorCode: '303', wallFabricColorHex: '#ffffff', carpetFootprintColorName: 'Rouge', carpetFootprintColorHex: '#cc1421' }, sourceVisualSurfaces: banners });
const banners = (count) => Array.from({ length: count }, (_, index) => ({ label: `Cloison ${index + 1}`, position: [-2 + index * .5, 0, -1.5], width: 1.88 + index * .2, height: 2.5, previewUrl: artwork(`BACHE ${index + 1}`, index % 2 ? '#403526' : '#1a447b') }));
const header = artwork('SOCIETE - P77', '#75bfd2');
const input = {
  width: 6, depth: 3, layout: 'left', catalog: [],
  documentInfo: { title: 'ACTIPOLE - TEST DE MISE EN PAGE', salon: 'SMCL 2026', pack: 'Prestige', hall: '7.3', stand: 'P77', aisleNumber: 'P', aisleSide: 'bottom' },
  items: [
    ...['left', 'right'].map((side) => ({ id: `head-${side}`, type: `tete-de-cloison-smcl-${side}`, label: `Tête de cloison ${side}`, x: side === 'left' ? -2.7 : 2.7, z: -1.45, modelSize: [.6, 3, .11], options: { partitionHeadSide: side, headMainImageUrl: artwork('VISUEL TETE') } })),
    counter,
    { id: 'sign', type: 'enseigne-haute', label: 'Enseigne haute', x: .5, z: -.2, modelSize: [1.5, 5.8, 1.3], dimensions: { ceilingMounted: true }, options: { posterImageUrl: artwork('VISCOM') } },
    { ...marker(banners(3)), sourceHeadInformation: ['left', 'right'].map((side) => ({ itemId: `head-${side}`, side, label: 'Tête de cloison', position: [side === 'left' ? -2.7 : 2.7, 0, -1.45], imageUrl: header })) },
  ],
};
const cases = [
  { name: 'actipole', input },
  { name: 'axione', input: { ...input, width: 8, depth: 5.75, layout: 'back', documentInfo: { ...input.documentInfo, title: 'AXIONE - TEST DE MISE EN PAGE', stand: 'A44' }, items: [counter, { ...marker(), sourceFloor: { footprintEnabled: false } }] } },
  { name: 'many-artworks', input: { ...input, items: [...input.items.filter((item) => !item.sourceOptions), { ...input.items.at(-1), sourceVisualSurfaces: banners(19) }] } },
];
const data = realDataPath ? JSON.parse(await readFile(realDataPath, 'utf8')) : { cases };
const appId = resolve('src/__bat-layout-app.jsx'), storeId = resolve('src/data/__bat-layout-store.js');
const appSource = realDataPath ? await readFile('src/App.jsx', 'utf8') : '';
const storeSource = realDataPath ? await readFile('src/data/sceneStore.js', 'utf8') : '';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'production-bat-layout-test',
  resolveId(id) { if (id === '/src/__bat-layout-app.jsx') return appId; if (id === '/src/data/__bat-layout-store.js') return storeId; },
  load(id) {
    if (realDataPath && id === appId) return appSource.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { sceneAllAdminItems, withTechnicalOptionsMarker, sceneTechnicalDocumentInfo, sceneAdminCatalog, prepareTechnicalExportFonts };');
    if (realDataPath && id === storeId) return storeSource + '\nexport { dbSceneToScene };';
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__bat-layout-data__') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(data)); }
    if (req.url !== '/__bat-layout-test__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><script type="module">import * as bat from "/src/technicalExport.js";window.bat=bat;</script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__bat-layout-test__`);
  await page.waitForFunction(() => window.bat);
  const results = await page.evaluate(async (realData) => {
    const data = await (await fetch('/__bat-layout-data__')).json();
    let cases = data.cases;
    if (realData) {
      const app = await import('/src/__bat-layout-app.jsx');
      const { dbSceneToScene } = await import('/src/data/__bat-layout-store.js');
      cases = [];
      for (const raw of data.scenes) {
        const scene = dbSceneToScene(raw);
        await app.prepareTechnicalExportFonts(scene);
        const catalog = app.sceneAdminCatalog(data.assets, scene);
        cases.push({ name: scene.project_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), input: {
          width: Number(scene.dimensions.width), depth: Number(scene.dimensions.depth), layout: scene.layout,
          catalog, items: app.withTechnicalOptionsMarker(app.sceneAllAdminItems(scene, catalog), scene, catalog), documentInfo: app.sceneTechnicalDocumentInfo(scene),
        } });
      }
    }
    const results = [];
    for (const { name, input } of cases) {
      const pages = await window.bat.createTechnicalPlanSvgPages(input);
      const blob = await window.bat.createTechnicalPlanBlob(input);
      const pdf = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      results.push({ name, pdf, pages: pages.map((svg) => new XMLSerializer().serializeToString(svg)),
        headers: pages.map((svg) => [...svg.querySelectorAll('[data-bat-text-role="visual-slot-title"]')].map((node) => ({ text: node.textContent, x: +node.getAttribute('x'), y: +node.getAttribute('y') }))),
        non: pages.map((svg) => [...svg.querySelectorAll('text')].filter((node) => node.textContent === 'NON').map((node) => ({ x: +node.getAttribute('x'), y: +node.getAttribute('y') }))),
        text: pages.map((svg) => svg.textContent),
      });
    }
    return results;
  }, Boolean(realDataPath));
  assert.deepEqual(errors, []);
  for (const result of results) {
    const pdf = Buffer.from(result.pdf.split(',')[1], 'base64');
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), result.pages.length);
    await writeFile(resolve(output, `${result.name}.pdf`), pdf);
    for (const [index, svg] of result.pages.entries()) await writeFile(resolve(output, `${result.name}-${index + 1}.svg`), svg);
    const headers = result.headers.filter((headers) => headers.length);
    assert.ok(headers.length > 0);
    for (const header of headers) assert.deepEqual(header.map((entry) => entry.text), [
      '1 - Tête de cloison visuel', '2 - Tête de cloison texte', '3 - Adhésif banque accueil', '4 - Viscom suspendu', '5 - Bâche cloison',
    ]);
    if (!realDataPath && result.name === 'axione') assert.equal(result.non[0].length, 5, 'Four absent artwork sections and disabled footprint are explicitly marked NON');
    if (!realDataPath && result.name === 'many-artworks') {
      assert.equal(headers.length, 5, 'Additional artwork is paginated below a repeated 2D plan');
      for (let number = 1; number <= 19; number++) assert.match(result.pages.join(''), new RegExp(`>5\\.${number}</text>`));
    }
    console.log(JSON.stringify({ name: result.name, pages: result.pages.length, planPages: headers.length, absentMarkers: result.non[0].length }));
  }
  if (!realDataPath) assert.deepEqual(results[0].headers[0], results[1].headers[0], 'Artwork headings never move when sections are absent');
} finally { await browser?.close(); await server.close(); }
