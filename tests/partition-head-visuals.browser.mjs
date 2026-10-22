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
      .replace('  const estimatedTotal = scenePricing.total;', '  window.headPricing = scenePricing;\n  const estimatedTotal = scenePricing.total;')
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
  const openHeads = async () => page.getByRole('button', { name: /^Tête de cloison/ }).click();
  await openHeads();
  assert.equal(await page.locator('.partition-head-activity-info').count(),0,'Equipped heads do not show the sector-color notice');
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
  const framing = page.locator('.partition-head-upload-block .image-framing-controls').first();
  await framing.locator('summary').click();
  await framing.locator('input[type=range]').fill('65');
  await framing.locator('input[type=range]').press('ArrowRight');
  await page.waitForFunction(() => window.headItems.every((item) => item.options.headMainImageFraming?.imageZoom === 0.7));
  await page.waitForFunction(() => window.savedScene?.options.partitionHeadVisuals.right.headMainImageFraming?.imageZoom === 0.7);

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
  assert.equal(await page.evaluate(() => window.headItems.find((item) => item.options.partitionHeadSide === 'left').options.headMainImageFraming.imageZoom), 0.7);
  assert.equal(await page.evaluate(() => window.headItems.find((item) => item.options.partitionHeadSide === 'right').options.headMainImageFraming.imageZoom), 1);
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
  const panel=page.locator('.signature-head-v3');
  assert.equal(await panel.locator('input[type=file]').count(),0);
  await panel.getByRole('textbox',{name:'Votre nom et emplacement'}).fill('TEST JULIEN L 2');
  await page.waitForFunction(()=>window.savedScene?.options.partitionHeadCompany==='TEST JULIEN L 2');
  await panel.screenshot({path:'/tmp/standing-signature-head-v3-default.png'});
  const logo=panel.getByRole('switch',{name:'Votre logo',exact:true}),main=panel.getByRole('switch',{name:'Visuel lumineux',exact:true});
  await logo.click();await main.click();
  await page.waitForFunction(()=>window.headPricing.lines.filter(l=>l.type==='signature-head-top-logo').length===1);
  assert.equal(await panel.locator('input[type=file]').count(),2);
  assert.equal(await panel.getByRole('textbox').count(),0);
  await panel.screenshot({path:'/tmp/standing-signature-head-v3-custom.png'});
  const sigUpload=async(label,name,color)=>{await panel.getByLabel(label,{exact:true}).setInputFiles({name,mimeType:'image/svg+xml',buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"><rect width="500" height="350" fill="${color}"/></svg>`)});await page.waitForFunction((name)=>window.headItems.every(i=>i.options.textureSlotValues?.['signature-head-top-28']?.imageName===name)||window.headItems.every(i=>i.options.headMainImageName===name),name);};
  await sigUpload('Importer votre logo — Deux têtes','top.svg','green');
  const splitTop=panel.getByRole('checkbox',{name:'Visuel différent sur chaque tête — Votre logo',exact:true});
  const splitMain=panel.getByRole('checkbox',{name:'Visuel différent sur chaque tête — Visuel lumineux',exact:true});
  await splitTop.check();assert.equal(await panel.locator('input[type=file]').count(),3);assert.equal(await splitMain.isChecked(),false);
  await panel.getByLabel('Importer votre logo — Droite',{exact:true}).setInputFiles({name:'right-top.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"><rect width="500" height="350" fill="yellow"/></svg>')});
  await page.waitForFunction(()=>window.headItems.find(i=>i.options.partitionHeadSide==='right').options.textureSlotValues['signature-head-top-28'].imageName==='right-top.svg');
  await sigUpload('Importer visuel lumineux — Deux têtes','light.svg','blue');
  assert.equal(await page.evaluate(()=>window.headItems.find(i=>i.options.partitionHeadSide==='left').options.textureSlotValues['signature-head-top-28'].imageName),'top.svg');
  assert.equal(await page.evaluate(()=>window.headItems.every(i=>i.options.headMainImageName==='light.svg')),true);
  await main.click();await logo.click();
  assert.equal(await panel.getByRole('textbox',{name:'Votre nom et emplacement'}).inputValue(),'TEST JULIEN L 2');
  await page.waitForFunction(()=>!window.headPricing.lines.some(l=>l.type==='signature-head-top-logo'));
  assert.equal(await page.evaluate(()=>window.headItems.every(i=>i.options.headMainImageName==='light.svg'&&i.options.headMainVisualEnabled===false)),true);
  await page.waitForFunction(()=>window.savedScene?.options.partitionHeadVisuals.left?.textureSlotValues?.['signature-head-top-28']?.visualEnabled===false&&window.savedScene.options.partitionHeadVisuals.right?.headMainVisualEnabled===false);
  await page.getByRole('button',{name:'Reouvrir test',exact:true}).click();await openHeads();
  assert.equal(await logo.getAttribute('aria-checked'),'false');await logo.click();await main.click();
  assert.equal(await splitTop.isChecked(),true);assert.equal(await splitMain.isChecked(),false);
  await splitMain.check();assert.equal(await panel.locator('input[type=file]').count(),4);
  await page.setViewportSize({width:390,height:844});await panel.screenshot({path:'/tmp/standing-signature-head-v3-mobile.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.setViewportSize({width:1440,height:1000});
  await panel.getByRole('button',{name:'Appliquer',exact:true}).click();assert.equal(await panel.count(),0);await openHeads();
  await page.getByRole('button', { name: 'Lecture seule test', exact: true }).click();
  assert.equal(await logo.isDisabled(),true);assert.equal(await splitTop.isDisabled(),true);assert.equal(await panel.locator('input[type=file]').first().isDisabled(),true);
  assert.deepEqual(errors, []);
  console.log('Partition heads browser: shared upload -> independent artwork -> autosave/reopen -> shared reset/pending -> Signature v3 independent sections, toggles, price, persistence, mobile -> read-only OK');
} finally {
  await browser?.close();
  await server.close();
}
