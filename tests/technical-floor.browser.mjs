import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Technical floor quick-view + ramps placed on open sides only.
// SHOTS_DIR=/some/dir to keep screenshots of the quick-view and the 3D scene.
const appId = resolve('src/__technical-floor-app.jsx');
const pageId = resolve('src/__technical-floor-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const shotsDir = process.env.SHOTS_DIR || '';
const source = await readFile('src/App.jsx', 'utf8');
const scene = {
  id: 'technical-floor', offer: 'Confort', salon: 'SMCL 2027', project_name: 'Stand plancher',
  dimensions: { width: 5, depth: 5 }, layout: 'left', items: [], client_status: 'draft',
  options: { ledRailsEnabled: false, carpetFootprintColorId: '1370' }, source_payload: {},
};
const exports = 'ConfiguratorApp, technicalFloorObstacleRects, technicalFloorFootprintRects, technicalRampRect, normalizeTechnicalFloorRamps, nextTechnicalFloorRamp, technicalFloorSlabBounds, technicalFloorSlabOutline, technicalRampDimensions, technicalFloorPreviewModel, legacyTechnicalFloorRamps, sceneFloorDepth';
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as api from '/src/__technical-floor-app.jsx';
window.floorApi = api;
localStorage.setItem('standing-config-intro:technical-floor', 'started');
localStorage.setItem('standing-config-tutorial:technical-floor', 'done');
const params = new URLSearchParams(location.search);
const arch = { id: 'arch', type: 'arche-signature', label: 'Arche Signature', dimensions: { size: [1.5, 2.5, 0.5] }, x: 0, z: -1, options: { signatureBaseKey: 'arche', signatureArchColorHex: '#d4145a', signatureArchColorName: 'Fuchsia' } };
const signature = params.get('pack') === 'Signature';
const scene = { ...${JSON.stringify(scene)}, layout: params.get('layout') || 'left', ...(signature ? { offer: 'Signature', items: [arch] } : {}) };
createRoot(document.getElementById('root')).render(<api.ConfiguratorApp initialScene={scene} />);
`;
const store = `export * from '/src/data/sceneStore.js?technical-floor-original';
export async function listObjectBank() { return []; }
export async function saveScene(scene) { window.savedScene = JSON.parse(JSON.stringify(scene)); return scene; }
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'technical-floor-test',
  resolveId(id) { if (id === '/src/__technical-floor-app.jsx') return appId; if (id === '/src/__technical-floor-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", `export { ${exports} };`)
      .replace('  const estimatedTotal = scenePricing.total;', '  window.floorPricing = scenePricing;\n  const estimatedTotal = scenePricing.total;')
      .replace('      name={`technical-floor-ramp-${ramp.id}`}', '      name={`technical-floor-ramp-${ramp.id}`}\n      ref={(mesh) => { window.floorRampMeshes = { ...(window.floorRampMeshes || {}), [ramp.id]: mesh }; }}');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (!req.url.startsWith('/__technical-floor-test__')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__technical-floor-page.jsx"></script>');
  }); },
}] });

let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__technical-floor-test__`;
  const launchOptions = { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  browser = await chromium.launch(launchOptions).catch(() => chromium.launch({ ...launchOptions, channel: 'chrome' }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const assetFailures = [];
  page.on('console', (message) => { if (message.text().includes('Technical floor asset unavailable')) assetFailures.push(message.text()); });
  page.on('response', (response) => { if (response.url().includes('/models/technical-floor/') && !response.ok()) assetFailures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}?layout=left`);
  await page.waitForFunction(() => window.floorPricing, undefined, { timeout: 20000 }).catch((error) => { throw new Error(`${error.message}; browser: ${errors.join('; ')}`); });

  // Pure placement rules: ramps only on open sides, inside the edge, without overlap.
  const rules = await page.evaluate(() => {
    const { normalizeTechnicalFloorRamps, nextTechnicalFloorRamp, legacyTechnicalFloorRamps } = window.floorApi;
    const floor12 = { id: 'floor12', height: 0.12 };
    const floor4 = { id: 'floor4', height: 0.04 };
    const context = (layout, floor = floor12, width = 5, depth = 5) => ({ width, depth, layout, floor, trimType: 'straight' });
    const againstWall = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'left', offset: 0 }], context('left'));
    const uLayout = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'right', offset: 0 }], context('u'));
    const overlap = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'front', offset: 0 }, { id: 'b', edge: 'front', offset: 0.2 }], context('back', floor4));
    const clamped = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'front', offset: 99 }], context('back'));
    const sloped = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'front', offset: 0 }], { ...context('back', floor4), trimType: 'sloped' });
    const added = [];
    let current = normalizeTechnicalFloorRamps(legacyTechnicalFloorRamps({ technicalFloorRampX: 0 }), context('back'));
    for (let index = 0; index < 12; index += 1) {
      const next = nextTechnicalFloorRamp(current, context('back'));
      if (!next) break;
      current = normalizeTechnicalFloorRamps([...current, next], context('back'));
      added.push(next.edge);
    }
    // Corners: a ramp stops at the side partition and at the partition head, never runs under them.
    const { technicalFloorObstacleRects } = window.floorApi;
    const wallObstacles = technicalFloorObstacleRects({ width: 5, depth: 5, layout: 'left', items: [] });
    const head = { id: 'head', minX: -2.5, maxX: -2.2, minZ: 2.4, maxZ: 2.6 };
    const cornered = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'front', offset: -9 }], { ...context('left'), obstacles: [...wallObstacles, head] });
    return { againstWall, uLayout, overlap, clamped, sloped, added, final: current, cornered, wallObstacles };
  });
  assert.deepEqual(rules.againstWall.map((ramp) => ramp.edge), ['front'], 'A ramp is never kept against a partition');
  assert.deepEqual(rules.uLayout.map((ramp) => ramp.edge), ['front'], 'U stands only accept front ramps');
  assert.equal(rules.overlap.length, 2);
  assert.ok(Math.abs(rules.overlap[1].offset - rules.overlap[0].offset) >= 1.1 - 1e-6, 'Ramps on the same side never overlap');
  assert.ok(rules.clamped[0].offset <= 2.5 - 0.5, 'Ramp stays inside its edge');
  assert.equal(rules.sloped.length, 0, 'The sloped trim needs no ramp');
  assert.ok(rules.added.includes('left') && rules.added.includes('right'), 'Extra ramps go to the open sides once the front is full');
  assert.ok(rules.wallObstacles.some((rect) => rect.id === 'wall-left'), 'The left partition is an obstacle');
  assert.ok(rules.cornered[0].offset - 0.5 >= -2.2 - 1e-6, `Corner ramp stops at the partition head: ${rules.cornered[0].offset}`);
  const sameEdge = (edge) => rules.final.filter((ramp) => ramp.edge === edge).map((ramp) => ramp.offset).sort((a, b) => a - b);
  for (const edge of ['front', 'left', 'right']) {
    const offsets = sameEdge(edge);
    for (let index = 1; index < offsets.length; index += 1) assert.ok(offsets[index] - offsets[index - 1] >= 1.1 - 1e-6);
  }

  // Open the quick-view.
  await page.getByRole('button', { name: /Configuration/ }).first().click();
  const accordion = page.locator('.floor-qv-accordion');
  await accordion.locator('> button').click();
  await page.locator('.floor-qv').waitFor();
  assert.equal(await accordion.getByRole('button', { name: 'Plancher technique', exact: true }).getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('.floor-qv-hero').textContent(), /Empreinte/);
  const panel = await accordion.locator('.floor-qv').evaluate(el => {
    const preview = el.querySelector('.floor-qv-hero');
    const info = el.querySelector('.floor-qv-about-toggle');
    const choice = el.querySelector('.floor-qv-option');
    return {
      panel: getComputedStyle(el).display,
      preview: getComputedStyle(preview).overflow,
      info: getComputedStyle(info).position,
      choice: getComputedStyle(choice).display,
    };
  });
  assert.deepEqual(panel, { panel: 'grid', preview: 'hidden', info: 'absolute', choice: 'grid' }, 'Technical floor quick-view styles are loaded');
  if (shotsDir) await accordion.screenshot({ path: `${shotsDir}/quickview-none.png` });
  await page.getByRole('button', { name: 'À quoi sert le plancher technique ?' }).click();
  assert.match(await page.locator('.floor-qv-about').textContent(), /câbles/);
  if (shotsDir) await accordion.screenshot({ path: `${shotsDir}/quickview-about.png` });
  await page.getByRole('button', { name: 'À quoi sert le plancher technique ?' }).click();

  await page.getByRole('radio', { name: /^12 cm/ }).click();
  await page.waitForFunction(() => window.savedScene?.options.technicalFloorType === 'floor12');
  const quickView = await page.locator('.floor-qv').textContent();
  assert.match(quickView, /Retire l’empreinte/);
  assert.match(quickView, /≈ 1\s475 € HT/u);
  assert.match(quickView, /25 m² × 59 € HT/);
  assert.match(quickView, /Côté allée \(devant\)/);
  if (shotsDir) await accordion.screenshot({ path: `${shotsDir}/quickview-12.png` });

  // Drag the ramp in the 3D view towards the open right side: it snaps onto that side.
  await page.waitForFunction(() => Object.values(window.floorRampMeshes || {}).some(Boolean), undefined, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const rampScreen = async (target) => page.evaluate((target) => {
    const mesh = Object.values(window.floorRampMeshes).find(Boolean);
    const state = mesh.__r3f.root.getState();
    const Vector = mesh.position.constructor;
    mesh.updateWorldMatrix(true, false);
    const point = target ? new Vector(...target) : mesh.geometry.boundingBox.getCenter(new Vector()).applyMatrix4(mesh.matrixWorld);
    point.project(state.camera);
    const rect = state.gl.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height, world: mesh.geometry.boundingBox.getCenter(new Vector()).applyMatrix4(mesh.matrixWorld).toArray() };
  }, target);
  const start = await rampScreen();
  const end = await rampScreen([2.45, 0, 0.3 + start.world[2] - 2.2]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(start.x + (end.x - start.x) * step / 12, start.y + (end.y - start.y) * step / 12);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.floor-qv-ramp small')?.textContent.includes('droit'), undefined, { timeout: 5000 })
    .catch(async () => { throw new Error(`Ramp did not snap to the right side: ${await page.locator('.floor-qv-ramp small').first().textContent()}`); });
  // Dragging towards the left partition never puts the ramp against it.
  const back = await rampScreen([-2.45, 0, 0]);
  const from = await rampScreen();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(from.x + (back.x - from.x) * step / 12, from.y + (back.y - from.y) * step / 12);
  await page.mouse.up();
  assert.doesNotMatch(await page.locator('.floor-qv-ramp small').first().textContent(), /gauche/);
  // Releasing a ramp drag away from the ramp (here outside the 3D view) must
  // hand the camera back: orbit/pan stayed locked when the release was missed.
  const grab = await rampScreen();
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y + 10);
  await page.waitForFunction(() => document.querySelector('.dragging-canvas'), undefined, { timeout: 5000 });
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.dragging-canvas'), undefined, { timeout: 5000 })
    .catch(() => { throw new Error('Camera stayed locked after a ramp drag released outside the scene'); });

  // 5 m aisle: four 1 m ramps fit on the front, the fifth goes to the open right side.
  for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: 'Ajouter une rampe' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.floor-qv-ramp').length === 5);
  const sides = await page.locator('.floor-qv-ramp small').allTextContents();
  assert.ok(sides.some((text) => text.includes('droit')), `Extra ramp placed on the open right side: ${sides.join(' | ')}`);
  assert.ok(!sides.some((text) => text.includes('gauche')), 'No ramp against the left partition');
  if (shotsDir) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shotsDir}/scene-12.png` });
    await accordion.screenshot({ path: `${shotsDir}/quickview-12-ramps.png` });
  }

  await page.getByRole('radio', { name: /^4 cm/ }).click();
  await page.locator('.floor-qv-segmented button', { hasText: 'Cornière inclinée' }).click();
  await page.waitForFunction(() => !document.querySelector('.floor-qv-ramp'));
  if (shotsDir) { await page.waitForTimeout(2000); await page.screenshot({ path: `${shotsDir}/scene-4-sloped.png` }); }

  await page.locator('.floor-qv-option', { hasText: 'Aucun plancher' }).click();
  await page.waitForFunction(() => document.querySelector('.floor-qv-hero')?.textContent.includes('Empreinte'));

  // Another stand shape: the preview follows the scene (U stand → no side trims, footprint against the right wall).
  await page.goto(`${base}?layout=u`);
  await page.waitForFunction(() => window.floorPricing, undefined, { timeout: 20000 });
  await page.getByRole('button', { name: /Configuration/ }).first().click();
  await page.locator('.floor-qv-accordion > button').click();
  await page.getByRole('radio', { name: /^4 cm/ }).click();
  if (shotsDir) await page.locator('.floor-qv-accordion').screenshot({ path: `${shotsDir}/quickview-u-4.png` });
  // Regression: switching trim type must never hand Three.js a mesh without material (whole scene vanished).
  for (const label of ['Cornière inclinée', 'Cornière droite', 'Cornière inclinée']) {
    await page.locator('.floor-qv-segmented button', { hasText: label }).click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('radio', { name: /^12 cm/ }).click();
  await page.waitForTimeout(1500);

  // Signature: the arch footprint stays inside the stand, ramps are fully on it or fully beside it.
  const signatureRules = await page.evaluate(() => {
    const { technicalFloorFootprintRects, normalizeTechnicalFloorRamps, technicalFloorSlabBounds, technicalRampRect, technicalRampDimensions, sceneFloorDepth } = window.floorApi;
    const floor = { id: 'floor12', height: 0.12 };
    const archItem = { id: 'arch', type: 'arche-signature', label: 'Arche Signature', dimensions: { size: [1.5, 2.5, 0.5] }, x: 0, z: -2, options: { signatureBaseKey: 'arche' } };
    const context = { width: 5, depth: 5, layout: 'back', floor, trimType: 'straight' };
    const footprints = technicalFloorFootprintRects([archItem], context);
    const bounds = technicalFloorSlabBounds(5, sceneFloorDepth('back', 5), 'back', 'straight');
    const size = technicalRampDimensions(0.12);
    const onFootprint = normalizeTechnicalFloorRamps([{ id: 'a', edge: 'front', offset: 0.6 }], { ...context, footprints });
    const rect = technicalRampRect(onFootprint[0], bounds, size);
    const beside = normalizeTechnicalFloorRamps([{ id: 'b', edge: 'front', offset: 1.6 }], { ...context, footprints });
    const besideRect = technicalRampRect(beside[0], bounds, size);
    const fp = footprints[0];
    return { fp, bounds, rect, besideRect, beside: beside[0] };
  });
  const { fp, rect, besideRect } = signatureRules;
  assert.ok(fp.maxZ <= signatureRules.bounds.maxZ + 1e-9, 'Arch footprint never passes the stand front');
  assert.ok(Math.abs(rect.minX - fp.minX) < 0.002 && Math.abs(rect.maxX - fp.maxX) < 0.002, `A ramp on the footprint takes its exact width: ${JSON.stringify(rect)} vs ${JSON.stringify(fp)}`);
  assert.ok(besideRect.minX >= fp.maxX - 0.002 && !signatureRules.beside.width, `A ramp beside the footprint stays 1 m and fully outside it: ${JSON.stringify(besideRect)}`);

  await page.goto(`${base}?layout=back&pack=Signature`);
  await page.waitForFunction(() => window.floorPricing, undefined, { timeout: 20000 });
  await page.getByRole('button', { name: /Configuration/ }).first().click();
  await page.locator('.floor-qv-accordion > button').click();
  assert.match(await page.locator('.floor-qv-hero').textContent(), /Empreinte arche/);
  if (shotsDir) await page.locator('.floor-qv-hero').screenshot({ path: `${shotsDir}/signature-none.png` });
  await page.getByRole('radio', { name: /^12 cm/ }).click();
  const signatureView = await page.locator('.floor-qv').textContent();
  assert.match(signatureView, /Empreinte conservée/);
  assert.match(signatureView, /largeur de l’empreinte/);
  assert.doesNotMatch(signatureView, /Retire l’empreinte/);
  // Dragging the ramp off the arch footprint remounts it (footprint ramp ->
  // standalone ramp). The camera must be unlocked once the drag is released.
  await page.waitForFunction(() => Object.values(window.floorRampMeshes || {}).some(Boolean), undefined, { timeout: 20000 });
  await page.waitForTimeout(1500);
  // Wait for the opening camera orbit to settle before aiming at the ramp.
  await page.waitForFunction(async () => {
    const mesh = Object.values(window.floorRampMeshes).find(Boolean);
    const camera = mesh?.__r3f?.root.getState().camera;
    if (!camera) return false;
    const before = camera.position.toArray().join();
    await new Promise((done) => setTimeout(done, 300));
    return before === camera.position.toArray().join();
  }, undefined, { timeout: 15000 });
  const sigFrom = await rampScreen();
  const sigOn = await rampScreen([-0.3, 0, sigFrom.world[2]]);
  const sigTo = await rampScreen([1.9, 0, sigFrom.world[2]]);
  await page.mouse.move(sigFrom.x, sigFrom.y);
  await page.mouse.down();
  const sweep = async (a, b) => { for (let step = 1; step <= 16; step += 1) await page.mouse.move(a.x + (b.x - a.x) * step / 16, a.y + (b.y - a.y) * step / 16); };
  await sweep(sigFrom, sigOn);
  await page.waitForTimeout(300);
  await sweep(sigOn, sigTo);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.dragging-canvas'), undefined, { timeout: 5000 })
    .catch(() => { throw new Error('Camera stayed locked after dragging a ramp off the Signature footprint'); });
  const sigMoved = await page.evaluate(() => Object.values(window.floorRampMeshes).find(Boolean).position.x);
  assert.ok(sigMoved > 0.5, `Ramp followed the drag off the footprint (x=${sigMoved})`);
  if (shotsDir) {
    await page.locator('.floor-qv-hero').screenshot({ path: `${shotsDir}/signature-12.png` });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shotsDir}/signature-scene-12.png` });
    await page.getByRole('radio', { name: /^4 cm/ }).click();
    await page.locator('.floor-qv-segmented button', { hasText: 'Cornière inclinée' }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shotsDir}/signature-scene-4-sloped.png` });
    await page.locator('.floor-qv-hero').screenshot({ path: `${shotsDir}/signature-4-sloped-hero.png` });
  }

  assert.deepEqual(assetFailures, [], 'Trim GLB assets load');
  assert.deepEqual(errors, []);
  console.log('technical floor quick-view and ramps: ok');
} finally {
  await browser?.close();
  await server.close();
}
