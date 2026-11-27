import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// The header cart must list every priced line (floor, ramps, banners, colours, insurance…)
// and its rows must add up to the total; step 4 must show the floor and its ramps too.
const appId = resolve('src/__cart-app.jsx');
const pageId = resolve('src/__cart-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const source = await readFile('src/App.jsx', 'utf8');
const shotsDir = process.env.SHOTS_DIR || '';
const scene = {
  id: 'cart-completeness', offer: 'Confort', salon: 'SMCL 2027', project_name: 'Stand panier',
  dimensions: { width: 5, depth: 4 }, layout: 'u', client_status: 'draft',
  items: [{ id: 'table-1', type: 'table', label: 'Table', x: 0, z: 0 }],
  options: {
    ledRailsEnabled: false,
    technicalFloorType: 'floor4',
    technicalFloorRamps: [{ id: 'ramp-a', edge: 'front', offset: 0 }],
    carpetThick: true,
    wallCovers: { back: { enabled: true } },
  },
  source_payload: {},
};
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import * as api from '/src/__cart-app.jsx';
localStorage.setItem('standing-config-intro:cart-completeness', 'started');
localStorage.setItem('standing-config-tutorial:cart-completeness', 'done');
const signature = new URLSearchParams(location.search).get('pack') === 'Signature';
const arch = { id: 'arch', type: 'arche-signature', label: 'Arche Signature 3 m Spot', dimensions: { size: [1.5, 2.5, 0.5] }, x: 0, z: -1, options: { signatureBaseKey: 'arche', signatureArchSizeM: 3, signatureArchColorName: 'Gris clair', signatureArchColorCode: '1893' } };
const chairs = [1, 2, 3].map((n) => ({ id: 'chair-' + n, type: 'chair', label: 'Chaise', x: n - 2, z: 1, options: { unitPrice: 120 } }));
const scene = { ...${JSON.stringify(scene)}, ...(signature ? { offer: 'Signature', items: [arch, ...chairs] } : {}) };
createRoot(document.getElementById('root')).render(<api.ConfiguratorApp initialScene={scene} />);
`;
const store = `export * from '/src/data/sceneStore.js?cart-original';
export async function listObjectBank() { return []; }
export async function saveScene(scene) { return scene; }
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'cart-completeness-test',
  resolveId(id) { if (id === '/src/__cart-app.jsx') return appId; if (id === '/src/__cart-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { ConfiguratorApp };')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.cartPricing = scenePricing;\n  const estimatedTotal = scenePricing.total;');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (!req.url.startsWith('/__cart-test__')) return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__cart-page.jsx"></script>');
  }); },
}] });

const euros = (text) => {
  const match = String(text).replace(/ | /g, ' ').match(/(−)?\s*([\d ]+,\d{2})\s*€/);
  if (!match) return 0;
  const value = Number(match[2].replace(/ /g, '').replace(',', '.'));
  return match[1] ? -value : value;
};

let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}/__cart-test__`;
  const launchOptions = { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  browser = await chromium.launch(launchOptions).catch(() => chromium.launch({ ...launchOptions, channel: 'chrome' }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.cartPricing, undefined, { timeout: 20000 });

  const pricing = await page.evaluate(() => ({ total: window.cartPricing.total, lines: window.cartPricing.lines.map(({ type, label, total }) => ({ type, label, total })) }));
  assert.ok(pricing.lines.some((line) => line.type.startsWith('technical-floor-')), 'Technical floor is priced');
  assert.ok(pricing.lines.some((line) => line.type === 'wall-cover'), 'Banner is priced');

  const badgeSum = (texts) => Math.round(texts.reduce((sum, text) => {
    const m = String(text).match(/([+−-])\s*([\d   ]+(?:,\d+)?)\s?€/);
    return m ? sum + (m[1] === '+' ? 1 : -1) * Number(m[2].replace(/[\s  ]/g, '').replace(',', '.')) : sum;
  }, 0) * 100) / 100;
  const checkScene = async (label, pricing) => {
    const allowance = pricing.lines.find((line) => line.type === 'pack-accessories-allowance')?.total || 0;
    const insurance = pricing.lines.find((line) => line.type === 'mandatory-furniture-insurance')?.total || 0;
    await page.locator('[data-tour="nav-cart"]').click();
    const drawer = page.locator('.stn-drawer');
    await drawer.waitFor();
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/cart-${label}.png` });
    const cartRows = await drawer.locator('.d-body .line').evaluateAll((nodes) => nodes.map((node) => [node.querySelector('.l-name')?.textContent, node.querySelector('.l-detail')?.textContent || '', node.querySelector('.l-price')?.textContent || '']));
    const cartSum = badgeSum(cartRows.map((row) => row[2]));
    assert.equal(euros(await drawer.locator('.totals .grand dd').innerText()), pricing.total, `${label}: drawer total matches pricing`);
    assert.equal(Math.round((cartSum + insurance + allowance) * 100) / 100, pricing.total, `${label}: cart rows add up to the total ${JSON.stringify(cartRows)}`);
    await drawer.locator('.d-foot .primary').click();
    if (!(await page.locator('.validation-v2').count())) {
      await page.locator('[data-tour="nav-cart"]').click();
      await page.locator('.stn-drawer .d-foot .primary').click();
    }
    const validation = page.locator('.validation-v2');
    await validation.waitFor();
    await validation.evaluate((node) => node.querySelectorAll('button[aria-expanded="false"]').forEach((button) => button.click()));
    if (shotsDir) await validation.screenshot({ path: `${shotsDir}/step4-${label}.png` });
    const stepRows = await validation.locator('.validation-v2-row').evaluateAll((nodes) => nodes.map((node) => [node.querySelector('strong')?.textContent, node.querySelector('.validation-v2-row-copy > span')?.textContent || '', node.querySelector('.validation-v2-price')?.textContent || '']));
    assert.deepEqual(cartRows, stepRows, `${label}: the cart shows exactly the step-4 rows`);
    return cartRows;
  };

  const confortRows = await checkScene('confort', pricing);
  const names = confortRows.map((row) => row[0]).join(' | ');
  assert.match(names, /Plancher technique 4 cm/, 'Cart lists the technical floor');
  assert.match(names, /Rampe PMR 4 cm/, 'Cart lists the ramp');
  assert.match(names, /Bâche/, 'Cart lists the banners');
  assert.match(names, /Option Moquette Épaisse/, 'Cart lists the thick carpet');
  assert.match(names, /^Moquette \|/, 'Cart lists the included carpet row');
  assert.doesNotMatch(names, /Empreinte moquette/, 'No carpet footprint with a technical floor');

  // Signature: arch size supplement, footprint colour, insured furniture.
  await page.goto(`${base}?pack=Signature`);
  await page.waitForFunction(() => window.cartPricing?.lines?.some((line) => line.type.startsWith('signature-arch-size-')), undefined, { timeout: 20000 });
  const signaturePricing = await page.evaluate(() => ({ total: window.cartPricing.total, lines: window.cartPricing.lines.map(({ type, label, total }) => ({ type, label, total })) }));
  await checkScene('signature', signaturePricing);
  assert.deepEqual(errors, []);
  console.log('cart completeness ok', { confort: pricing.total, signature: signaturePricing.total });
} finally {
  await browser?.close();
  await server.close();
}
