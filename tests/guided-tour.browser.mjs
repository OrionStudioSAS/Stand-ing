import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Guided tour: opens on first visit, points at real elements with numbered annotations,
// drives the configurator steps, restores the exhibitor's place on exit and offers to resume.
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature'];
const wall = { type: 'wall-fixture', label: 'Cloison 1x2.5m', is_active: true, model_url: '/__wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const door = { type: 'door-trad-gauche-poignee-gauche', label: 'Porte Trad Gauche 1000x2500mm Ht + Poignée Gauche', is_active: true, model_url: '/__door.obj', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
const child = (id, asset, x, z, rotation) => ({ id, type: asset.type, label: asset.label, modelUrl: asset.model_url, modelSize: asset.dimensions.size, dimensions: asset.dimensions, x, z, rotation });
const group = { type: 'reserve-2m2-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children: [child('wall1', wall, 0, 0, 0), child('wall2', wall, -1, 0, 0), child('door', door, 0.56, -0.528, -90)], groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const stool = { type: 'stool-fixture', label: 'Tabouret test', is_active: true, model_url: '/__box.obj', dimensions: { size: [0.4, 0.75, 0.4], packs, category: 'Mobilier' }, price: 49 };
const assets = [wall, door, group, stool];
const scene = { id: 'guided-tour', client_name: 'Test visite', offer: 'Signature', event_name: 'Test', dimensions: { width: 5, depth: 5 }, layout: 'u', items: [], options: {},
  source_payload: { reserveRules: { 'signature-2m2': { includedType: group.type, includedLabel: group.label, options: [] }, large: { includedType: group.type, includedLabel: group.label, options: [] } } } };
const objBox = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
// No "tutorial done" flag: the tour must open by itself on the first visit.
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp}from'/src/__guided-tour-app.jsx';
localStorage.setItem('standing-config-intro:guided-tour','started');
createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer={false} />);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'guided-tour-test',
  resolveId(id) { if (id === '/src/__guided-tour-app.jsx') return `${root}src/__guided-tour-app.jsx`; if (id === '/src/__guided-tour-page.jsx') return `${root}src/__guided-tour-page.jsx`; },
  load(id) {
    if (id === `${root}src/__guided-tour-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp};');
    if (id === `${root}src/__guided-tour-page.jsx`) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-guided-tour';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    const objects = { '/__wall.obj': objBox(1, 2.5, 0.06), '/__door.obj': objBox(1, 2.5, 0.25), '/__box.obj': objBox(0.4, 0.75, 0.4) };
    if (objects[req.url]) { res.setHeader('Content-Type', 'text/plain'); return res.end(objects[req.url]); }
    if (req.url !== '/__guided-tour-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__guided-tour-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__guided-tour-test__`);
  const tour = page.getByRole('dialog', { name: 'Tutoriel configurateur' });
  await tour.waitFor({ timeout: 90000 });
  const title = () => page.locator('.gt-bubble h2').innerText();
  const activeStep = () => page.evaluate(() => document.querySelector('.stn-nav .stepper button.active')?.getAttribute('aria-label'));
  assert.match(await title(), /Bienvenue/);
  assert.equal(await page.locator('.gt-chapters li').count(), 6, 'Six chapters are announced on the welcome screen');

  await page.getByRole('button', { name: /Commencer la visite/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.gt-pin').length >= 6);
  assert.equal(await title(), 'Tout votre stand, en un coup d’œil');
  assert.equal(await page.locator('.gt-pin').count(), await page.locator('.gt-legend li').count(), 'Every legend entry has its pin on the interface');
  assert.ok(await page.locator('.gt-spot').isVisible(), 'The top bar is in the spotlight');
  await page.locator('.gt-legend li').nth(2).hover();
  assert.match(await page.locator('.gt-pin').nth(2).getAttribute('class'), /active/, 'Hovering a legend entry highlights its pin');

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.gt-bubble h2')?.textContent === 'Avancez à votre rythme');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.gt-bubble h2')?.textContent === 'Tout votre stand, en un coup d’œil');

  // Walk forward until the shop chapter: the tour switches the configurator to step 3 by itself.
  for (let i = 0; i < 14 && (await title()) !== 'La boutique de votre salon'; i++) {
    await page.locator('.gt-bubble .gt-primary').click();
    await page.waitForTimeout(450);
  }
  assert.equal(await title(), 'La boutique de votre salon');
  await page.waitForFunction(() => document.querySelector('.stn-nav .stepper button.active')?.getAttribute('aria-label') === 'Boutique');
  const shopCount = await page.locator('.gt-count').innerText();

  // Leaving puts the exhibitor back where they were and remembers the progress.
  await page.keyboard.press('Escape');
  await tour.waitFor({ state: 'detached' });
  assert.equal(await activeStep(), 'Configuration', 'Closing the tour restores the starting step');
  assert.equal(await page.evaluate(() => localStorage.getItem('standing-config-tutorial:guided-tour')), 'done');

  await page.locator('[data-tour="nav-questions"]').click();
  await page.getByRole('button', { name: 'Relancer le tutoriel' }).click();
  await tour.waitFor();
  const resume = page.getByRole('button', { name: /Reprendre à l’étape/ });
  await resume.waitFor();
  await resume.click();
  await page.waitForFunction(() => document.querySelector('.gt-bubble h2')?.textContent === 'La boutique de votre salon');
  assert.equal(await page.locator('.gt-count').innerText(), shopCount, 'The tour resumes exactly where it stopped');

  await page.getByRole('button', { name: 'Fermer le tutoriel' }).click();
  await tour.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('Guided tour: auto-open, annotations, keyboard, live steps, restore and resume OK');
} finally {
  await browser?.close();
  await server.close();
}
