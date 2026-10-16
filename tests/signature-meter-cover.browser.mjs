import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__meter-cover-app.jsx');
const pageId = resolve('src/__meter-cover-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const source = await readFile('src/App.jsx', 'utf8');
const assets = ['Blanc', 'Noir'].map((finish) => ({ id: finish, type: `asset-cache-compteur-${finish.toLowerCase()}`, label: `Cache Compteur ${finish} 500x500x750ht`,
  model_url: `/__meter-${finish}.obj`, is_active: true, dimensions: { packs: ['Signature'], color: finish === 'Blanc' ? '#ffffff' : '#111111', size: [0.53,0.75,0.5], sizeSource: 'manual', packPricing: { signature: { price: 95, reference: `CACHE-${finish}` } } } }));
const original = { id: 'meter-cover-test', offer:'Signature', salon:'SITL test', project_name:'Cache compteur',
  client_status:'draft', dimensions:{ width:4, depth:3 }, layout:'back', items:[], options:{ledRailsEnabled:false}, source_payload:{} };
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfiguratorApp, PresetSceneEditor, sceneAllAdminItems, sceneAdminCatalog } from '/src/__meter-cover-app.jsx';
const original = ${JSON.stringify(original)}, assets = ${JSON.stringify(assets)};
const salon = { name:'SITL test' }, offer = { name:'Signature' }, preset = { id:'meter-pack', base_config:{} };
const rememberDraft = (_id, draft) => { window.lastDraft = draft; };
window.rebuildForBat = (scene) => sceneAllAdminItems(scene, sceneAdminCatalog(assets, scene));
localStorage.setItem('standing-config-intro:meter-cover-test', 'started');
localStorage.setItem('standing-config-tutorial:meter-cover-test', 'done');
function Test() {
  const [scene,setScene] = useState(original), [revision,setRevision] = useState(0), [readOnly,setReadOnly] = useState(false), [pack,setPack] = useState(false);
  return <><div style={{position:'fixed',left:0,bottom:0,zIndex:9999}}>
    <button onClick={() => { setScene(JSON.parse(JSON.stringify(window.savedScene))); setRevision((n)=>n+1); }}>Reouvrir</button>
    {['left','right','back','u'].map((layout) => <button key={layout} onClick={() => { setScene({...original, options:window.savedScene?.options || original.options, layout}); setRevision((n)=>n+1); }}>{layout}</button>)}
    <button onClick={() => { setScene({...original, dimensions:{width:5,depth:3}}); setRevision((n)=>n+1); }}>15 m2</button>
    <button onClick={() => setReadOnly((value)=>!value)}>Lecture seule</button>
    <button onClick={() => setPack(true)}>Apercu pack</button>
  </div>{pack ? <PresetSceneEditor salon={salon} offer={offer} preset={preset} assets={assets} initialDraft={{dimensions:original.dimensions,layout:'u',items:[],options:{signatureMeterCoverType:assets[1].type}}} onDraftChange={rememberDraft} />
    : <ConfiguratorApp key={revision} initialScene={scene} isAdminViewer forceReadOnly={readOnly} />}</>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const probe = `
  useFrame(({scene,camera,gl}) => {
    window.renderedMeterModels = [];
    scene.traverse((node) => { if (/^Meter(Blanc|Noir)$/.test(node.name)) window.renderedMeterModels.push(node.name); });
    const item = items.find((candidate) => candidate.autoMeterCover);
    if (!item) { window.meterPoint = null; return; }
    const point = new Vector3(item.x+cameraPivot[0],0.375,item.z+cameraPivot[2]).project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    window.meterPoint = {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
  });
`;
const obj = (finish) => `o Meter${finish}
v -0.265 0 -0.25
v 0.265 0 -0.25
v 0.265 0.75 -0.25
v -0.265 0.75 -0.25
v -0.265 0 0.25
v 0.265 0 0.25
v 0.265 0.75 0.25
v -0.265 0.75 0.25
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 4 3 7 8
f 1 4 8 5
f 2 6 7 3
`;
const server = await createServer({ server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{
  name:'signature-meter-cover-test',
  resolveId(id) { if(id==='/src/__meter-cover-app.jsx') return appId; if(id==='/src/__meter-cover-page.jsx') return pageId; },
  load(id) {
    if(id===appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {ConfiguratorApp,PresetSceneEditor,sceneAllAdminItems,sceneAdminCatalog};')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.meterItems=visibleSceneItems.filter((item)=>item.autoMeterCover); window.meterPricing=scenePricing;\n  const estimatedTotal = scenePricing.total;')
      .replace('  const dragFromPointer = (event) => {', `${probe}\n  const dragFromPointer = (event) => {`)
      .replace('  const presetTextureLoad = useSceneTexturePreload(', '  window.previewMeterItems=previewItems.filter((item)=>item.autoMeterCover);\n  const presetTextureLoad = useSceneTexturePreload(');
    if(id===pageId) return harness;
    if(id===storeId) return `export * from '/src/data/sceneStore.js?meter-original';
      export async function listObjectBank(){return ${JSON.stringify(assets)};}
      export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req,res,next)=>{
    if(req.url==='/__meter-cover-test__') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__meter-cover-page.jsx"></script>'); }
    else if(req.url==='/__meter-Blanc.obj'||req.url==='/__meter-Noir.obj') { res.setHeader('Content-Type','text/plain'); res.end(obj(req.url.includes('Blanc')?'Blanc':'Noir')); }
    else next();
  }); },
}]});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',(error)=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__meter-cover-test__`);
  await page.waitForFunction(()=>window.meterItems?.length===1&&window.renderedMeterModels?.includes('MeterBlanc')&&window.meterPoint);
  const clickCover = async () => { const point=await page.evaluate(()=>window.meterPoint); await page.mouse.click(point.x,point.y); };
  await clickCover();
  const modal=page.locator('.item-config-modal'); await modal.waitFor();
  await modal.getByRole('button',{name:/^Noir/}).click();
  assert.match(await modal.locator('.item-config-heading-main').innerText(), /2 coloris/);
  assert.match(await modal.locator('.item-config-footer-total').innerText(),/0\s*€/);
  await modal.screenshot({path:'/tmp/standing-meter-cover-picker.png'});
  await modal.getByRole('button',{name:'Appliquer',exact:true}).click();
  await page.waitForFunction(()=>window.savedScene?.options.signatureMeterCoverType==='asset-cache-compteur-noir'&&window.renderedMeterModels?.includes('MeterNoir'));
  const saved=await page.evaluate(()=>({scene:window.savedScene,items:window.meterItems,pricing:window.meterPricing,bat:window.rebuildForBat(window.savedScene)}));
  assert.equal(saved.items.length,1); assert.equal(saved.items[0].type,assets[1].type);
  assert.equal(saved.scene.items.filter((item)=>item.autoMeterCover).length,0,'Derived objects must not be saved as duplicate manual objects');
  assert.equal(saved.pricing.lines.filter((line)=>line.type===assets[1].type).length,0,'The included cache compteur is not charged');
  assert.equal(saved.pricing.grossTotal,0,'The cover does not consume the Signature accessories allowance');
  assert.equal(saved.pricing.baseUsage.find((row)=>row.type===assets[1].type).quantity,1);
  assert.equal(saved.bat.find((item)=>item.autoMeterCover).type,assets[1].type);
  await page.getByRole('button',{name:'Reouvrir',exact:true}).click();
  await page.waitForFunction(()=>window.meterItems?.length===1&&window.meterItems[0].type==='asset-cache-compteur-noir');
  for(const [layout,x] of [['left',-1.675],['right',1.675],['back',0],['u',0]]) {
    await page.getByRole('button',{name:layout,exact:true}).click();
    await page.waitForFunction((x)=>window.meterItems?.length===1&&Math.abs(window.meterItems[0].x-x)<1e-8&&Math.abs(window.meterItems[0].z+1.19)<1e-8,x);
    assert.equal(await page.evaluate(()=>window.meterItems[0].type),assets[1].type);
  }
  await page.getByRole('button',{name:'Lecture seule',exact:true}).click();
  await clickCover(); assert.equal(await modal.count(),0,'Read-only scenes cannot change variants');
  await page.getByRole('button',{name:'Lecture seule',exact:true}).click();
  await page.getByRole('button',{name:'15 m2',exact:true}).click();
  await page.waitForFunction(()=>window.meterItems?.length===0);
  await page.getByRole('button',{name:'Apercu pack',exact:true}).click();
  await page.waitForFunction(()=>window.previewMeterItems?.length===1&&window.previewMeterItems[0].type==='asset-cache-compteur-noir');
  assert.equal(await page.evaluate(()=>window.lastDraft.options.signatureMeterCoverType),assets[1].type);
  assert.deepEqual(errors,[]);
  console.log('Signature meter cover: actual object click, white/black model swap, included price, autosave/reopen, four layouts, 15m2 boundary, read-only mode, BAT and preset preview OK');
} finally { await browser?.close(); await server.close(); }
