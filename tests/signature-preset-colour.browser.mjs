import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__signature-colour-app.jsx');
const pageId = resolve('src/__signature-colour-page.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const draft = {
  dimensions: { width: 5, depth: 3 }, layout: 'u',
  defaultColorOptions: { carpetColorId: '1893', carpetFootprintColorId: '1893', wallFabricColorId: '303' },
  items: [{ id: 'arch', type: 'test-arch', label: 'Arche Totem + Plafond Spot', x: 0, z: 0, rotation: 0,
    modelUrl: '/__signature-fixture.obj', materialUrl: '/__signature-fixture.mtl',
    dimensions: { size: [1, 2.5, 2], sizeSource: 'manual' },
    options: { signatureArchColorId: 'stale', signatureArchColorHex: '#ff0000', signatureArchColorImage: '',
      signatureArchVariantType: 'test-arch', textureSlotValues: { logo: { imageUrl: '' } } } }],
};
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PresetSceneEditor } from '/src/__signature-colour-app.jsx';
const original = ${JSON.stringify(draft)};
const salon = { name: 'SITL test' }, offer = { name: 'Signature' }, preset = { id: 'test', base_config: {} }, assets = [];
const remember = (_id, draft) => { window.lastDraft = draft; };
function Test() {
  const [draft, setDraft] = useState(original), [revision, setRevision] = useState(0);
  return <><button onClick={() => { setDraft(JSON.parse(JSON.stringify(window.lastDraft))); setRevision((n) => n+1); }}>Reouvrir</button>
    <PresetSceneEditor key={revision} salon={salon} offer={offer} preset={preset} assets={assets} initialDraft={draft} onDraftChange={remember} /></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
// Test-only probe reads the actual rendered Three.js material, not just the draft options.
const probe = `
  useFrame(({ scene }) => {
    const paints = [];
    scene.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) if (material?.name === 'Laminate_D02_120cm#1') paints.push({ hex: material.color.getHexString(), textured: Boolean(material.map) });
    });
    window.paints = paints;
  });
`;
const fixtureObj = `mtllib __signature-fixture.mtl
o PaintPanel
v -0.5 0 -1
v 0.5 0 -1
v 0.5 2.5 -1
v -0.5 2.5 -1
v -0.5 0 1
v 0.5 0 1
v 0.5 2.5 1
v -0.5 2.5 1
usemtl Laminate_D02_120cm#1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 4 3 7 8
f 1 4 8 5
f 2 6 7 3
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'signature-preset-colour-test',
  resolveId(id) {
    if (id === '/src/__signature-colour-app.jsx') return appId;
    if (id === '/src/__signature-colour-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source
      .replace("createRoot(document.getElementById('root')).render(<App />);", 'export { PresetSceneEditor };')
      .replace("  const color = item?.options?.signatureArchColorHex || '#bebebe';", "  const color = item?.options?.signatureArchColorHex || '#bebebe';\n  window.footprintTextureUrl = texture ? imageUrl : ''; ")
      .replace('  const [hoveredId, setHoveredId] = useState(null);', `${probe}\n  const [hoveredId, setHoveredId] = useState(null);`);
    if (id === pageId) return harness;
  },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/__signature-colour-test__') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__signature-colour-page.jsx"></script>');
      } else if (req.url === '/__signature-fixture.obj') {
        res.setHeader('Content-Type', 'text/plain'); res.end(fixtureObj);
      } else if (req.url === '/__signature-fixture.mtl') {
        res.setHeader('Content-Type', 'text/plain'); res.end('newmtl Laminate_D02_120cm#1\nKd 1 1 1\n');
      } else next();
    });
  },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-colour-test__`);
  await page.waitForFunction(() => window.lastDraft?.items[0]?.options.signatureArchColorId === '1893');
  await page.waitForFunction(() => window.paints?.some((material) => material.hex === 'bebebe'));
  await page.getByLabel('Empreinte moquette / arche', { exact: true }).selectOption('1964');
  await page.waitForFunction(() => window.lastDraft?.items[0]?.options.signatureArchColorId === '1964');
  await page.waitForFunction(() => window.paints?.some((material) => material.hex === 'd20014'));
  await page.waitForFunction(() => window.footprintTextureUrl?.includes('1964'));
  const changed = await page.evaluate(() => ({ draft: window.lastDraft, paints: window.paints }));
  assert.equal(changed.draft.defaultColorOptions.carpetFootprintColorId, '1964');
  assert.equal(changed.draft.options.carpetFootprintColorId, '1964');
  assert.equal(changed.draft.items[0].options.signatureArchColorHex, '#d20014');
  assert.match(changed.draft.items[0].options.signatureArchColorImage, /1964/);
  assert.equal(changed.draft.items[0].options.signatureArchVariantType, 'test-arch');
  assert.ok(changed.paints.every((material) => !material.textured), 'The arch is solid paint, not carpet');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  assert.equal(await page.getByLabel("Empreinte moquette de l'arche", { exact: true }).getAttribute('fill'), '#d20014');
  await page.getByRole('button', { name: 'Reouvrir', exact: true }).click();
  await page.waitForFunction(() => window.paints?.some((material) => material.hex === 'd20014'));
  await page.getByLabel('Empreinte moquette / arche', { exact: true }).selectOption('1390');
  await page.waitForFunction(() => window.paints?.some((material) => material.hex === '283c5a'));
  await page.waitForFunction(() => window.footprintTextureUrl?.includes('1390'));
  assert.equal(await page.evaluate(() => window.lastDraft.items[0].options.signatureArchColorId), '1390');
  assert.deepEqual(errors, []);
  console.log('Signature preset browser: selector -> carpet texture + painted OBJ + plan -> saved draft -> reopen OK');
} finally {
  await browser?.close();
  await server.close();
}
