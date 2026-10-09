import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__head-visuals-app.jsx');
const pageId = resolve('src/__head-visuals-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const source = await readFile('src/App.jsx', 'utf8');
const assets = ['left', 'right'].map((side) => ({
  id: side, type: `head-${side}`, label: `Tete De Cloison SIAE ${side === 'left' ? 'Gauche' : 'Droite'}`, is_active: true,
  dimensions: { packs: ['Equipé', 'Signature'], size: [0.6, 2.5, 0.2], sizeSource: 'manual' },
}));
const scene = { id: 'head-test', offer: 'Equipé', salon: 'SIAE test', project_name: 'Test',
  dimensions: { width: 5, depth: 5 }, layout: 'u', items: [], client_status: 'draft',
  options: { ledRailsEnabled: false, partitionHeadLeftEnabled: true, partitionHeadRightEnabled: true },
  source_payload: { partitionHeadRules: { large: { includedCount: 2, leftType: 'head-left', rightType: 'head-right' } } },
};
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfiguratorApp } from '/src/__head-visuals-app.jsx';
localStorage.setItem('standing-config-intro:head-test', 'started');
localStorage.setItem('standing-config-tutorial:head-test', 'done');
function Test() {
  const [scene, setScene] = useState(${JSON.stringify(scene)}), [revision, setRevision] = useState(0), [readOnly, setReadOnly] = useState(false);
  return <><div style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
    <button onClick={() => { setScene(JSON.parse(JSON.stringify(window.savedScene))); setRevision((n) => n + 1); }}>Reouvrir test</button>
    <button onClick={() => setReadOnly((value) => !value)}>Lecture seule test</button>
    <button onClick={() => { setScene({ ...window.savedScene, offer: 'Signature' }); setRevision((n) => n + 1); }}>Signature test</button>
  </div><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer forceReadOnly={readOnly} /></>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const store = `
export * from '/src/data/sceneStore.js?head-test-original';
export async function listObjectBank() { return ${JSON.stringify(assets)}; }
export async function saveScene(scene) { window.savedScene = JSON.parse(JSON.stringify(scene)); return scene; }
export async function uploadSceneItemOptionImage(scene, target, file) {
  window.headUploads = [...(window.headUploads || []), { target, name: file.name }];
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); });
}
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'partition-head-visuals-test',
  resolveId(id) {
    if (id === '/src/__head-visuals-app.jsx') return appId;
    if (id === '/src/__head-visuals-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source
      .replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp };')
      .replace('  const autoSpotsBaseRule = useMemo(', '  window.headItems = automaticPartitionHeadItems;\n  const autoSpotsBaseRule = useMemo(');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__head-visuals-test__') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__head-visuals-page.jsx"></script>');
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__head-visuals-test__`);
  await page.waitForFunction(() => window.headItems?.length === 2);
  const openHeads = async () => page.getByRole('button', { name: 'Tête de cloison', exact: true }).click();
  await openHeads();
  const checkbox = page.getByRole('checkbox', { name: 'Je veux un visuel différent', exact: true });
  const uploads = page.locator('.partition-head-upload-block input[type=file]');
  const upload = async (index, name, fill) => {
    await uploads.nth(index).setInputFiles({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${fill}"/></svg>`) });
    await page.waitForFunction(() => !document.querySelector('.partition-head-upload-block input:disabled'));
  };
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await uploads.count(), 1);
  await upload(0, 'common.svg', 'red');
  await page.waitForFunction(() => window.headItems.every((item) => item.options.headMainImageName === 'common.svg'));
  assert.equal(await page.evaluate(() => window.headUploads.length), 1, 'Shared artwork requires one upload, not two');
  const rightHead = page.locator('.partition-head-choice-grid button').filter({ hasText: 'Droite' });
  await rightHead.click();
  assert.equal(await checkbox.count(), 0, 'A single head does not need a different-artwork option');
  assert.equal(await uploads.count(), 1);
  await rightHead.click();
  await page.waitForFunction(() => window.headItems.length === 2);
  assert.equal(await checkbox.isChecked(), false);
  await page.screenshot({ path: '/tmp/stand-ing-head-visuals-shared.png' });
  await checkbox.check();
  assert.equal(await uploads.count(), 2);
  await upload(1, 'right.svg', 'blue');
  await page.waitForFunction(() => window.savedScene?.options.partitionHeadVisuals.right?.headMainImageName === 'right.svg');
  assert.equal(await page.evaluate(() => window.headItems.find((item) => item.options.partitionHeadSide === 'left').options.headMainImageName), 'common.svg');
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  await page.waitForFunction(() => window.headItems.length === 2);
  await openHeads();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await uploads.count(), 2);
  await checkbox.uncheck();
  await page.waitForFunction(() => window.headItems.length === 2 && window.headItems.every((item) => item.options.headMainImageName === 'common.svg'));
  assert.equal(await uploads.count(), 1);
  await page.getByRole('checkbox', { name: 'Je fournirai le visuel plus tard' }).check();
  await page.waitForFunction(() => window.headItems.every((item) => item.options.visualPending));
  await page.locator('.partition-head-upload-block .item-image-reset').click();
  await page.waitForFunction(() => window.headItems.every((item) => !item.options.headMainImageUrl && !item.options.visualPending));
  await page.waitForFunction(() => window.savedScene.options.partitionHeadVisuals.right.headMainImageName === '');
  await page.getByRole('button', { name: 'Signature test', exact: true }).click();
  await page.waitForFunction(() => window.headItems.length === 2);
  await openHeads();
  assert.equal(await uploads.count(), 2, 'Signature shares the main image and top image separately');
  await upload(1, 'top.svg', 'green');
  await page.waitForFunction(() => window.headItems.length === 2 && window.headItems.every((item) => item.options.textureSlotValues?.['signature-head-top-28']?.imageName === 'top.svg'));
  await checkbox.check();
  assert.equal(await uploads.count(), 4);
  await upload(3, 'right-top.svg', 'yellow');
  await page.waitForFunction(() => window.headItems.find((item) => item.options.partitionHeadSide === 'right').options.textureSlotValues?.['signature-head-top-28']?.imageName === 'right-top.svg');
  assert.equal(await page.evaluate(() => window.headItems.find((item) => item.options.partitionHeadSide === 'left').options.textureSlotValues['signature-head-top-28'].imageName), 'top.svg');
  await page.getByRole('button', { name: 'Lecture seule test', exact: true }).click();
  assert.equal(await checkbox.isDisabled(), true);
  assert.equal(await uploads.nth(0).isDisabled(), true);
  await page.screenshot({ path: '/tmp/stand-ing-head-visuals.png' });
  assert.deepEqual(errors, []);
  console.log('Partition heads browser: shared upload -> independent artwork -> autosave/reopen -> shared reset/pending -> Signature *28 -> read-only OK');
} finally {
  await browser?.close();
  await server.close();
}
