import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';

const appId = resolve('src/__refinements-app.jsx');
const pageId = resolve('src/__refinements-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const source = await readFile('src/App.jsx', 'utf8');
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="orange"/></svg>');
const arch = { id: 'arch', type: 'arche-signature', label: 'Arche Signature', dimensions: { size: [1.5, 2.5, 0.5] }, x: 0, z: -1, options: {signatureBaseKey: 'arche'} };
const scene = { id: 'refinements', offer: 'Signature', salon: 'SITL 2027 salon avec un nom tres long', project_name: 'Societe avec une raison sociale tres longue pour tester le header',
  dimensions: { width: 5, depth: 4 }, layout: 'back', items: [arch], client_status: 'draft', options: { ledRailsEnabled: false, wallCovers: { back: { enabled: true, previewUrl: art } } }, source_payload: {},
};
const exports = 'ConfiguratorApp, PosterOptionsPanel, PartitionHeadOptionsPanel, WoodReceptionDeskOptionsPanel, SignatureArchOptionCard, WallCoverOptionCard, sceneAllAdminItems, makeAutomaticReserveItems, makeAutomaticSpotItems, resolveSpotWallAttachments, objectWallSurfaces, spotPlacementTargetsForItem, pickLedRailOverride, reserveDoorColorForPack, automaticReserveBackWallCandidate, floorDragPatch, constrainItem';
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as api from '/src/__refinements-app.jsx';
window.refinementApi = api;
const art = ${JSON.stringify(art)};
localStorage.setItem('standing-config-intro:refinements', 'started');
localStorage.setItem('standing-config-tutorial:refinements', 'done');
function Test() {
  const [components, setComponents] = useState(false), [revision, setRevision] = useState(0), [scene, setScene] = useState(${JSON.stringify(scene)});
  const [values, setValues] = useState({});
  window.componentFrames = values;
  const change = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));
  const options = { posterImageUrl: art, posterImageFraming: values.poster, headMainImageUrl: art, headMainImageFraming: values.head, binary3ImageUrl: art, binary3Enabled: true, binary3ImageFraming: values.counter };
  return <><div style={{ position: 'fixed', bottom: 0, left: 0, zIndex: 9999 }}>
    <button onClick={() => setComponents((value) => !value)}>Composants test</button>
    <button onClick={() => { setScene(JSON.parse(JSON.stringify(window.savedScene))); setRevision((n) => n + 1); }}>Reouvrir test</button>
    {['Confort', 'Prestige', 'Équipé', 'Signature'].map((pack) => <button key={pack} onClick={() => {
      window.savedScene = null;
      setComponents(false);
      setScene({ ...${JSON.stringify(scene)}, offer: pack, items: pack === 'Signature' ? [${JSON.stringify(arch)}] : [] });
      setRevision((n) => n + 1);
    }}>Pack test {pack}</button>)}
  </div>{components ? <div style={{ maxWidth: 600, margin: 'auto', overflow: 'auto', height: '100vh' }}>
    <section data-test="poster"><api.PosterOptionsPanel item={{ id: 'poster', type: 'poster', wall: 'back', x: 0, options }} items={[]} width={5} depth={4} onFramingChange={change('poster')} embedded /></section>
    <section data-test="head"><api.PartitionHeadOptionsPanel item={{ options }} onFramingChange={change('head')} embedded /></section>
    <section data-test="counter"><api.WoodReceptionDeskOptionsPanel item={{ type: 'comptoir accueil bois', options }} onFramingChange={change('counter')} embedded /></section>
    <section data-test="arch"><api.SignatureArchOptionCard items={[{ ...${JSON.stringify(arch)}, options: { textureSlotValues: { 'signature-arch-led-5': { imageUrl: art, ...values.arch } } } }]} onFramingChange={(item, slot, value) => change('arch')(value)} /></section>
    <section data-test="cover"><api.WallCoverOptionCard surfaces={[{id:'back', label:'Fond', width:5, height:2.5}]} covers={{back:{enabled:true}}} previews={{back:{url:art, ...values.cover}}} onFramingChange={(id, value) => change('cover')(value)} /></section>
  </div> : <api.ConfiguratorApp key={revision} initialScene={scene} isAdminViewer />}</>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const store = `export * from '/src/data/sceneStore.js?refinements-original';
import { makeScenePreviewImage } from '/src/data/sceneStore.js?refinements-original';
export async function listObjectBank() { return []; }
export async function saveScene(scene) { window.savedScene = JSON.parse(JSON.stringify(scene)); return scene; }
export async function uploadSceneItemOptionImage(_scene, _target, file) {
  const preview = await makeScenePreviewImage(file, { requirePreview: true }).catch((error) => {
    window.previewError = error.cause?.message || error.message;
    throw error;
  });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(preview);
  });
}
`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'configurator-refinements-test',
  resolveId(id) { if (id === '/src/__refinements-app.jsx') return appId; if (id === '/src/__refinements-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", `export { ${exports} };`)
      .replace('  const texture = previewTexture || genericTexture;', '  window.testWallCoverTexture = previewTexture;\n  const texture = previewTexture || genericTexture;')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.refinementItems = visibleSceneItems; window.refinementPricing = scenePricing;\n  const estimatedTotal = scenePricing.total;');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__refinements-test__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__refinements-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__refinements-test__`);
  await page.waitForFunction(() => window.refinementPricing, undefined, { timeout: 15000 }).catch((error) => {
    throw new Error(`${error.message}; browser: ${errors.join('; ')}`);
  });
  const positions = await page.evaluate(() => {
    const { automaticReserveBackWallCandidate, floorDragPatch, constrainItem } = window.refinementApi;
    const reserve = { type: 'reserve', label: 'Reserve 2 m2 centre arriere', autoReserve: true, modelSize: [2.12, 2.5, 1.06] };
    const counter = { type: 'counter-fixture', label: 'Banque accueil', modelSize: [1.15, 1, .51], rotation: 0 };
    return {
      legacy: automaticReserveBackWallCandidate(reserve, { x: -1.88 }, 6, 4, 'back'),
      leftWall: automaticReserveBackWallCandidate(reserve, { x: -3 }, 6, 4, 'left'),
      front: constrainItem({ ...counter, placementRule: 'front-left' }, 6, 4, 'back', false),
      dragged: floorDragPatch({ x: -2.40, z: 1.72 }, counter, 6, 4, 'back', false),
      interior: floorDragPatch({ x: -.8, z: .25 }, counter, 6, 4, 'back', false),
    };
  });
  assert.ok(Math.abs(positions.legacy.x - (-3 + 1.06)) < 1e-9);
  assert.ok(Math.abs(positions.legacy.z - (-2 + .06 + .53)) < 1e-9);
  assert.ok(Math.abs(positions.leftWall.x - (-3 + .06 + 1.06)) < 1e-9);
  for (const position of [positions.front, positions.dragged]) {
    assert.ok(Math.abs(position.x - (-3 + .575)) < 1e-9);
    assert.ok(Math.abs(position.z - (2 - .255)) < 1e-9);
  }
  assert.deepEqual(positions.interior, { x: -.8, z: .25 });
  await page.getByRole('button', { name: /^Sol/ }).click();
  const thick = page.locator('.config-toggle-option').filter({ hasText: 'Moquette épaisse' });
  const appearance = () => thick.evaluate((button) => {
    const style = (element) => getComputedStyle(element);
    const rect = (element) => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right }; };
    return { background: style(button).backgroundColor, title: style(button.querySelector('strong')).color,
      detail: style(button.querySelector('small')).color, switch: style(button.querySelector('i')).backgroundColor,
      toggle: rect(button.querySelector('i')), text: rect(button.querySelector('span')), price: rect(button.querySelector('em')), card:rect(button) };
  });
  const contrast = (foreground, background) => {
    const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map((part) => Number(part) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const unchecked = await appearance();
  await thick.screenshot({ path: '/tmp/standing-carpet-thick-unchecked.png' });
  await thick.click();
  await page.waitForFunction(() => window.savedScene?.options.carpetThick);
  const checked = await appearance();
  assert.equal(checked.background, unchecked.background, 'The neutral card background must not change when toggled');
  assert.notEqual(checked.switch, unchecked.switch, 'The switch indicates the selected state');
  for (const state of [unchecked, checked]) {
    assert.ok(contrast(state.title, state.background) >= 4.5, 'Title contrast meets WCAG AA');
    assert.ok(contrast(state.detail, state.background) >= 4.5, 'Description contrast meets WCAG AA');
  }
  await thick.screenshot({ path: '/tmp/standing-carpet-thick-checked.png' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    const state = await appearance();
    assert.ok(state.text.right <= state.toggle.left, `Card contents do not overlap at ${width}px`);
    assert.ok(state.price.right <= state.card.right, 'Price stays inside the card');
    assert.equal(state.background, unchecked.background);
  }
  const carpetLines = await page.evaluate(() => window.refinementPricing.lines.filter((line) => line.label.includes('Moquette épaisse')));
  assert.equal(carpetLines.length, 2, 'Carpet and Signature arch footprint are both charged');
  assert.equal(carpetLines.find((line) => line.label.startsWith('Moquette')).total, 20 * 30);
  assert.equal(carpetLines.find((line) => line.label.startsWith('Empreinte')).total, Math.round(1.5 * 4.5 * 30));
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  await page.getByRole('button', { name: /^Sol/ }).click();
  assert.equal(await thick.getAttribute('aria-pressed'), 'true');
  for (const width of [1920, 1440, 1280, 1100, 1024, 900, 820, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.evaluate(() => {
      const rect = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return { info: rect('.config-breadcrumb'), steps: rect('.stepper'), tools: rect('.language-pill'), header: rect('.configurator-topbar'), cart: rect('.topbar-cart') };
    });
    const separated = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
    assert.ok(separated(bounds.info, bounds.steps), `Information does not overlap steps at ${width}px`);
    assert.ok(separated(bounds.steps, bounds.tools), `Steps do not overlap tools at ${width}px`);
    assert.ok(Math.abs((bounds.steps.left + bounds.steps.right) / 2 - width / 2) <= 1, `Steps are centered at ${width}px`);
    assert.ok(bounds.cart.right <= width, `Header fits at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.stepper').isVisible(), false);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({ path: '/tmp/standing-header-refinements.png' });
  // Export reconstruction uses the exact saved reserve attachment, including source payload options.
  const bat = await page.evaluate(() => {
    const api = window.refinementApi;
    const reserve = { type:'reserve-test', label:'Reserve 2 m2', isGroup:true, groupSize:[2,2.5,1], dimensions:{isReserve:true}, children:[
      { id:'front', type:'cloison', label:'Cloison avant', x:0,z:0.47,modelSize:[2,2.5,0.06],dimensions:{size:[2,2.5,0.06]} },
      { id:'side', type:'cloison', label:'Cloison droite', x:0.97,z:0,modelSize:[0.06,2.5,1],dimensions:{size:[0.06,2.5,1]} },
    ]};
    const rail = { type:'rail-test', label:'Rail LED 3 spots', modelSize:[0.9,0.15,0.3], dimensions:{mountType:'wall', isLedSpotOption:true, size:[0.9,0.15,0.3]} };
    const entries=[reserve,rail];
    const reserveRules={medium:{includedType:reserve.type}};
    const base={ offer:'Confort',dimensions:{width:5,depth:4},layout:'back',items:[],options:{ledRailsEnabled:true},source_payload:{reserveRules,options:{autoSpotsRule:{threeSpotType:rail.type}}}};
    const automatic=api.sceneAllAdminItems(base,entries);
    const target=automatic.find((item)=>item.autoSpot);
    const surface=api.objectWallSurfaces(automatic).find((entry)=>entry.orientation==='x' && entry.normalAxis>-1.5);
    if(!target || !surface) return {automatic,surface,error:'missing fixtures'};
    base.source_payload.options.ledRailOverrides={ [target.id]:{wall:surface.id,x:surface.centerAxis,wallSide:1,wallSurface:surface} };
    const saved=api.sceneAllAdminItems(base,entries).find((item)=>item.id===target.id);
    return {wall:saved.wall,normalAxis:saved.wallSurface?.normalAxis,expected:surface.normalAxis};
  });
  assert.ok(bat.wall?.startsWith('object-wall:'), JSON.stringify(bat));
  assert.equal(bat.normalAxis,bat.expected);
  assert.ok(bat.normalAxis > -1.5, 'A reserve-mounted spot must not end up at the back scene wall');

  // The actual 3D banner texture and saved scene must use the same framing.
  await page.getByRole('button', { name: /^Cloison/ }).click();
  const coverEditor = page.locator('.wall-cover-row .image-framing-controls');
  await coverEditor.locator('summary').click();
  await coverEditor.locator('input[type=range]').fill('65');
  await coverEditor.locator('input[type=range]').press('ArrowRight');
  await page.waitForFunction(() => window.savedScene?.options.wallCovers.back.imageZoom === 0.7);
  await page.waitForFunction(() => {
    const canvas = window.testWallCoverTexture?.image;
    if (!canvas?.getContext) return false;
    const pixel = canvas.getContext('2d').getImageData(10,10,1,1).data;
    return pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255;
  });
  await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
  await page.getByRole('button', { name: /^Cloison/ }).click();
  await coverEditor.locator('summary').click();
  assert.equal(await coverEditor.locator('input[type=range]').inputValue(), '70', 'Banner framing survives reopening the scene');
  const upload = page.locator('.wall-cover-row input[type=file]').first();
  const thumbnail = page.locator('.wall-cover-preview-button img').first();
  const oldPreview = await thumbnail.getAttribute('src');
  for (const [name, mimeType, buffer, message] of [
    ['empty.jpg', 'image/jpeg', Buffer.alloc(0), 'Ce fichier est vide'],
    ['invalid.jpg', 'image/jpeg', Buffer.from('not an image'), 'Impossible de lire cette image'],
    ['invalid.pdf', 'application/pdf', Buffer.from('not a PDF'), 'Impossible de lire le PDF'],
  ]) {
    await page.waitForFunction(() => !document.querySelector('.wall-cover-row input[type=file]').disabled);
    await upload.setInputFiles({ name, mimeType, buffer });
    await page.locator('.wall-cover-row [role=alert]').filter({ hasText: message }).waitFor({ timeout: 12000 }).catch(async (error) => {
      throw new Error(`${error.message}; ${await page.locator('.wall-cover-row [role=alert]').allTextContents()}; ${await page.evaluate(() => window.previewError)}`);
    });
    assert.equal(await thumbnail.getAttribute('src'), oldPreview);
  }
  const pdf = await PDFDocument.create();
  pdf.addPage([4000, 8000]).drawRectangle({ x: 0, y: 0, width: 4000, height: 8000, color: rgb(0, .6, .3) });
  await page.waitForFunction(() => !document.querySelector('.wall-cover-row input[type=file]').disabled);
  await upload.setInputFiles({ name: 'new-banner.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.waitForFunction(() => window.savedScene?.options.wallCovers.back.previewName === 'new-banner.pdf', undefined, { timeout: 10000 }).catch(async (error) => {
    const alert = await page.locator('.wall-cover-row [role=alert]').allTextContents();
    throw new Error(`${error.message}; ${alert.join('; ')}; ${await page.evaluate(() => window.previewError)}`);
  });
  assert.match(await thumbnail.getAttribute('src'), /^data:image\/jpeg/);
  assert.deepEqual(await thumbnail.evaluate((image) => [image.naturalWidth, image.naturalHeight]), [700, 1400]);
  await page.waitForFunction(() => {
    const canvas = window.testWallCoverTexture?.image;
    const pixel = canvas?.getContext('2d')?.getImageData(10, 10, 1, 1).data;
    return pixel?.[1] > 120 && pixel[0] < 10;
  });

  await page.getByRole('button', { name: 'Composants test', exact: true }).click();
  for (const key of ['poster', 'head', 'counter', 'arch', 'cover']) {
    const editor = page.locator(`[data-test="${key}"] .image-framing-controls`);
    assert.equal(await editor.count(), 1, `${key} has a framing editor`);
    await editor.locator('summary').click();
    const range = editor.locator('input[type=range]');
    await range.fill('65');
    await range.press('ArrowRight');
    await page.waitForFunction((key) => window.componentFrames[key]?.imageZoom === 0.7, key);
    const canvas = editor.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.mouse.up();
    const framing = await page.evaluate((key) => window.componentFrames[key], key);
    assert.ok(framing.imageOffsetX > 9 && framing.imageOffsetY > 9);
    await editor.getByRole('button', {name:'Réinitialiser le cadrage'}).click();
    assert.deepEqual(await page.evaluate((key) => window.componentFrames[key], key), { imageZoom:1,imageOffsetX:0,imageOffsetY:0 });
  }
  for (const pack of ['Confort', 'Prestige', 'Équipé', 'Signature']) {
    await page.getByRole('button', { name: `Pack test ${pack}`, exact: true }).click();
    await page.getByRole('button', { name: /^Réserve/ }).click();
    const formula=page.locator('.formula-included-box');
    assert.equal(await formula.locator('p').first().isVisible(),true,`${pack} keeps the included formula visible`);
    assert.equal(await formula.locator('button').count(),0,'The formula cannot be collapsed');
    await formula.locator('header').click();
    assert.equal(await formula.locator('p').first().isVisible(),true);
    await page.getByRole('button', { name: /^Sol/ }).click();
    const option = page.locator('.config-toggle-option').filter({ hasText: 'Moquette épaisse' });
    assert.equal(await option.count(), 1, `${pack} exposes just one shared thick-carpet option`);
    if (['Équipé', 'Signature'].includes(pack)) {
      assert.equal(await page.locator('.surface-color-option-card').filter({hasText:'MOQUETTE'}).count() >= 1, true, `${pack} uses the shared floor color layout`);
      await page.getByRole('button', { name: /^Cloison/ }).click();
      assert.equal(await page.locator('.surface-color-option-card').filter({hasText:'COTON GRATTÉ'}).count(), 1, `${pack} uses the shared wall color layout`);
      await page.getByRole('button', { name: /^Sol/ }).click();
    }
    await option.click();
    await page.waitForFunction((pack) => window.savedScene?.offer === pack && window.savedScene.options.carpetThick && window.savedScene.options.footprintThick, pack);
    const lines = await page.evaluate(() => window.refinementPricing.lines.filter((line) => line.label.includes('Moquette épaisse')));
    assert.equal(lines.length, 2, `${pack} charges carpet and footprint once each`);
    await page.getByRole('button', { name: 'Reouvrir test', exact: true }).click();
    await page.getByRole('button', { name: /^Sol/ }).click();
    assert.equal(await option.count(), 1, `${pack} keeps a single option after reopening`);
    assert.equal(await option.getAttribute('aria-pressed'), 'true');
    await option.click();
    await page.waitForFunction(() => window.savedScene && !window.savedScene.options.carpetThick && !window.savedScene.options.footprintThick);
    assert.equal(await page.evaluate(() => window.refinementPricing.lines.filter((line) => line.label.includes('Moquette épaisse')).length), 0);
  }
  assert.deepEqual(errors, []);
  console.log('Configurator refinements: single thick-carpet option across all packs + footprint pricing / autosave / responsive header / reserve spot BAT reconstruction / native image zoom and drag OK');
} finally { await browser?.close(); await server.close(); }
