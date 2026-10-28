import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { glb } from './helpers/glb-fixture.mjs';

const appId = resolve('src/__signature-lighting-app.jsx');
const pageId = resolve('src/__signature-lighting-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const mappingId = resolve('src/data/__signature-lighting-mapping.js');
const source = await readFile('src/App.jsx', 'utf8');
const storeSource = await readFile('src/data/sceneStore.js', 'utf8');
const assets = [2, 3].map((count) => ({
  type: `rail-${count}`, label: `Rail LED ${count} Spots`, is_active: true, model_url: '/__lighting-rail.glb',
  dimensions: { size: [.9, .15, .3], packs: ['Signature', 'Confort', 'Prestige', 'Équipé'], mountType: 'wall', unitPrice: 99 },
}));
const rule = { twoSpotType: 'rail-2', threeSpotType: 'rail-3' };
const row = { id: 'signature-lighting-test', offer: 'Signature', project_name: 'Test éclairage Signature',
  client_status: 'draft', dimensions: { width: 6, depth: 3 }, layout: 'back', scene_items: [],
  stand_presets: { base_config: { autoSpotsRule: rule } },
  source_payload: { baseItems: [], options: { ledRailsEnabled: false, autoSpotsRule: null } },
};
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfiguratorApp, sceneAllAdminItems, assetToCatalogEntry } from '/src/__signature-lighting-app.jsx';
import { dbSceneToScene } from '/src/data/__signature-lighting-mapping.js';
const assets = ${JSON.stringify(assets)}, row = ${JSON.stringify(row)};
const catalog = assets.map(asset => assetToCatalogEntry(asset, assets));
window.lightingAdminItems = scene => sceneAllAdminItems(scene, catalog);
window.lightingLoaded = dbSceneToScene(row);
localStorage.setItem('standing-config-intro:' + row.id, 'started');
localStorage.setItem('standing-config-tutorial:' + row.id, 'done');
function Test() {
  const [scene, setScene] = useState(window.lightingLoaded);
  const [revision, setRevision] = useState(0);
  return <><div style={{ position:'fixed', bottom:0, left:0, zIndex:9999 }}>
    <button onClick={() => { setScene(JSON.parse(JSON.stringify(window.savedLightingScene))); setRevision(n => n + 1); }}>Recharger test</button>
    <button onClick={() => { setScene({ ...window.lightingLoaded, options:{ledRailsEnabled:false,autoSpotsRule:null}, source_payload:row.source_payload }); setRevision(n => n + 1); }}>Ancienne scène directe</button>
  </div><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer /></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const rail = glb([{ size: [.9, .15, .3] }]);
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-lighting-regression',
  resolveId(id) {
    if (id === '/src/__signature-lighting-app.jsx') return appId;
    if (id === '/src/__signature-lighting-page.jsx') return pageId;
    if (id === '/src/data/__signature-lighting-mapping.js') return mappingId;
  },
  load(id) {
    if (id === appId) return source
      .replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp, sceneAllAdminItems, assetToCatalogEntry };')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.lightingState = { items: visibleSceneItems, pricing: scenePricing };\n  const estimatedTotal = scenePricing.total;')
      .replace('  const [hoveredId, setHoveredId] = useState(null);', `
        useFrame(({scene}) => {
          const result = [];
          scene.traverse(node => {
            if (!node.userData.itemId?.startsWith('auto-spot-')) return;
            let model = false;
            node.traverse(child => { if (/Real.*fixture.*model/i.test(child.name)) model = true; });
            result.push({ id:node.userData.itemId, model });
          });
          window.renderedLighting = result;
        });
        const [hoveredId, setHoveredId] = useState(null);`);
    if (id === pageId) return harness;
    if (id === mappingId) return storeSource + '\nexport { dbSceneToScene };';
    if (id === storeId) return `export * from '/src/data/sceneStore.js?signature-lighting-original';
      export async function listObjectBank(){ return ${JSON.stringify(assets)}; }
      export async function saveScene(scene){ window.savedLightingScene=JSON.parse(JSON.stringify(scene)); return scene; }`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__signature-lighting__') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__signature-lighting-page.jsx"></script>');
    } else if (req.url === '/__lighting-rail.glb') {
      res.setHeader('Content-Type', 'model/gltf-binary'); res.end(rail);
    } else next();
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-lighting__`);
  await page.waitForFunction(() => window.renderedLighting?.length === 2 && window.renderedLighting.every(item => item.model));
  await page.waitForFunction(() => window.savedLightingScene?.options.signatureLightingVersion === 1);
  const restored = await page.evaluate(() => ({
    loaded: window.lightingLoaded.source_payload.options,
    count: window.lightingState.items.filter(item => item.autoLedRail).length,
    adminCount: window.lightingAdminItems(window.savedLightingScene).filter(item => item.autoLedRail).length,
    billed: window.lightingState.pricing.lines.filter(line => line.type.startsWith('rail-')),
    baseItems: window.savedLightingScene.source_payload.baseItems,
  }));
  assert.equal(restored.loaded.ledRailsEnabled, true);
  assert.deepEqual(restored.loaded.autoSpotsRule, rule);
  assert.equal(restored.count, 2, '18 m2 receives two 3-spot rails');
  assert.equal(restored.adminCount, restored.count, 'The admin/BAT path sees the same lighting');
  assert.deepEqual(restored.billed, [], 'Automatic lighting does not consume the accessories allowance');
  assert.deepEqual(restored.baseItems, [], 'Do not bring back the old included furniture');
  await page.getByRole('button', { name: /^Spots LED/ }).click();
  await page.screenshot({ path: '/tmp/standing-signature-lighting.png' });
  await page.locator('.led-option-card button').click();
  await page.waitForFunction(() => window.renderedLighting?.length === 0 && window.savedLightingScene?.options.ledRailsEnabled === false);
  await page.getByRole('button', { name: 'Recharger test', exact: true }).click();
  await page.waitForFunction(() => window.lightingState?.items.filter(item => item.autoLedRail).length === 0);
  await page.getByRole('button', { name: /^Spots LED/ }).click();
  await page.locator('.led-option-card button').click();
  await page.waitForFunction(() => window.renderedLighting?.length === 2 && window.savedLightingScene?.options.ledRailsEnabled === true);
  await page.getByRole('button', { name: 'Ancienne scène directe' }).click();
  await page.waitForFunction(() => window.renderedLighting?.length === 2 && window.renderedLighting.every(item => item.model));
  assert.deepEqual(errors, []);
  console.log('Signature lighting: legacy repair, real 3D models, step-2 menu, admin/BAT parity, no accessory charge, removal and restoration survive reload.');
} finally {
  await browser?.close();
  await server.close();
}
