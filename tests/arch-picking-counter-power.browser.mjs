import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { glb } from './helpers/glb-fixture.mjs';

const archModel = glb([{ size: [2, .1, 3], position: [0, 3.05, 0] }, { size: [.2, 3, .2], position: [-.9, 1.5, -1.4] }]);
const powerModel = glb([{ size: [.23, .05, .13], position: [0, .025, 0] }]);
const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__arch-selection-app.jsx');
const harnessId = resolve('src/__arch-selection-test.jsx');
const harness = `import React,{Suspense,useState}from'react';import{createRoot}from'react-dom/client';import{Canvas}from'@react-three/fiber';import{Vector3,Vector2}from'three';import{SceneItem,StandScene,standSceneEvents}from'/src/__arch-selection-app.jsx';import{prioritizeUnderArchIntersections}from'/src/scenePicking.js';
const arch={id:'arch',type:'asset-arche-signature',label:'Arche Signature 2m',modelUrl:'/arch.glb',modelSize:[2,3.1,3],x:0,z:0,rotation:0};const chair={id:'chair',type:'chair',x:0,z:0,rotation:0};
const power={type:'triplette',label:'Triplette',modelUrl:'/power.glb',modelSize:[.23,.05,.13],dimensions:{category:'Électricité'}};
window.project=()=>{const p=new Vector3(0,.6,0).project(window.sceneState.camera);const r=window.sceneState.gl.domElement.getBoundingClientRect();return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2}};
window.rawPicking=()=>{const state=window.sceneState,p=new Vector3(0,.6,0).project(state.camera);state.raycaster.setFromCamera(new Vector2(p.x,p.y),state.camera);const hits=state.raycaster.intersectObjects(state.scene.children,true);const id=h=>{for(let n=h?.object;n;n=n.parent)if(n.userData.standSceneItem)return n.userData.itemId;return null};return{raw:id(hits[0]),filtered:id(prioritizeUnderArchIntersections(hits)[0])}};
window.powerPosition=()=>{let found;window.sceneState.scene.traverse(n=>{if(n.userData.itemId==='included-counter-power-base')found=n});return found?{x:found.position.x,y:found.position.y,z:found.position.z,loaded:found.children.some(c=>c.type==='Group')}:null};
function Test(){const[mode,setMode]=useState('arch'),[selected,setSelected]=useState(''),[moved,setMoved]=useState(false);const base={id:'base',type:'counter',label:'Comptoir accueil',included:true,modelSize:[1.15,1.01,.5],x:moved?1:-1.5,z:0,rotation:moved?90:0};const shop={...base,id:'shop',included:false,x:1.5,rotation:0};return <><button onClick={()=>setMode('power')}>Tester les multiprises</button><button onClick={()=>setMoved(true)}>Déplacer le comptoir</button><output>{selected}</output><div style={{width:900,height:700}}><Canvas key={mode} events={standSceneEvents} camera={{position:[0,7,3],fov:40}} onCreated={state=>{window.sceneState=state;state.camera.lookAt(0,.6,0);state.camera.updateMatrixWorld(true)}}><ambientLight intensity={1.5}/><Suspense fallback={null}>{mode==='arch'?<>{[arch,chair].map(item=><SceneItem key={item.id} item={item} items={[arch,chair]} width={6} depth={4} selected={false} onSelect={()=>setSelected(item.id)} onDragStart={()=>{}} onDragEnd={()=>{}} onDragMove={()=>{}}/>)}</>:<StandScene width={6} depth={4} height={2.5} viewAngle={0} layout="back" items={[base,shop]} catalog={[power]} interactive={false} carpetColor={{hex:'#ddd'}} wallFabricColor={{hex:'#fff'}} setSelectedId={()=>{}}/>}</Suspense></Canvas></div></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'arch-selection-regression',
  resolveId(id) { if (id === '/src/__arch-selection-app.jsx') return appId; if (id === '/src/__arch-selection-test.jsx') return harnessId; },
  load(id) { if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {SceneItem,StandScene,standSceneEvents};'); if (id === harnessId) return harness; },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/arch.glb' || req.url === '/power.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(req.url === '/arch.glb' ? archModel : powerModel); }
    else if (req.url === '/__arch-selection__') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__arch-selection-test.jsx"></script>'); }
    else next();
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__arch-selection__`);
  await page.waitForFunction(() => window.rawPicking?.().raw === 'arch');
  assert.deepEqual(await page.evaluate(() => window.rawPicking()), { raw: 'arch', filtered: 'chair' }, 'An actual model ceiling occludes the chair before filtering');
  const point = await page.evaluate(() => window.project());
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('output').textContent === 'chair');
  await page.screenshot({ path: '/tmp/standing-arch-picking.png' });
  await page.getByRole('button', { name: 'Tester les multiprises' }).click();
  await page.waitForFunction(() => window.powerPosition()?.loaded);
  const power = await page.evaluate(() => window.powerPosition());
  assert.ok(Math.abs(power.y - 1.012) < .001);
  assert.equal(await page.evaluate(() => { let count=0; window.sceneState.scene.traverse(n=>{if(n.userData.itemId?.startsWith('included-counter-power-'))count++});return count }), 1);
  await page.getByRole('button', { name: 'Déplacer le comptoir' }).click();
  await page.waitForFunction(() => Math.abs(window.powerPosition().x - .85) < .001);
  assert.ok(Math.abs((await page.evaluate(() => window.powerPosition())).z) < .001);
  assert.deepEqual(errors, []);
  console.log('3D: real arch GLB roof click-through to contained furniture; base-only real power-strip model at countertop height following translation/rotation OK');
} finally { await browser?.close(); await server.close(); }
