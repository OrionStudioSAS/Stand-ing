import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const source=await readFile('src/App.jsx','utf8'),audit=JSON.parse(await readFile('tests/fixtures/signature-reserve-door-audit.json','utf8'));
const two=audit.groups.find(a=>a.type==='group-reserve-2m2-arriere-droite-mqrsqnfd'),three=audit.groups.find(a=>a.type==='group-nouveau-groupe-mqruijl9'),one=audit.groups.find(a=>a.label==='Réserve 1m2 arrière droite');
const assets=[one,two,three].map(a=>({...a,is_active:true,dimensions:{...a.dimensions,packs:['Équipé']}}));
const rules={small:{includedType:'',options:[]},medium:{includedType:two.type,includedLabel:two.label,options:[]},large:{includedType:three.type,includedLabel:three.label,options:[]}};
const scene={id:'equipped-reserve-test',project_name:'NOM STAND (test)',offer:'Équipé',dimensions:{width:5,depth:5},layout:'right',items:[],client_status:'draft',options:{ledRailsEnabled:false},source_payload:{reserveRules:rules}};
const appId=resolve('src/__equipped-reserves-app.jsx'),pageId=resolve('src/__equipped-reserves-page.jsx'),storeId=resolve('src/data/sceneStore.js');
const harness=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ConfiguratorApp,sceneAllAdminItems,assetToCatalogEntry} from '/src/__equipped-reserves-app.jsx';
const assets=${JSON.stringify(assets)};window.reconstructReserve=()=>sceneAllAdminItems(window.savedScene,assets.map(a=>assetToCatalogEntry(a,assets))).find(i=>i.autoReserve);
localStorage.setItem('standing-config-intro:equipped-reserve-test','started');localStorage.setItem('standing-config-tutorial:equipped-reserve-test','done');
function Test(){const [scene,setScene]=useState(${JSON.stringify(scene)}),[revision,setRevision]=useState(0);return <><button style={{position:'fixed',bottom:0,left:0,zIndex:9999}} onClick={()=>{setScene(window.savedScene);setRevision(n=>n+1)}}>Reouvrir test</button><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer/></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'equipped-reserve-choices',resolveId(id){if(id==='/src/__equipped-reserves-app.jsx')return appId;if(id==='/src/__equipped-reserves-page.jsx')return pageId;},load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {ConfiguratorApp,sceneAllAdminItems,assetToCatalogEntry};').replace('  const autoSpotsBaseRule = useMemo(','  window.equippedReserves=automaticReserveItems;\n  const autoSpotsBaseRule = useMemo(');if(id===pageId)return harness;if(id===storeId)return `export * from '/src/data/sceneStore.js?equipped-reserves-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__equipped-reserves__')return next();res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/src/__equipped-reserves-page.jsx"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__equipped-reserves__`);
 await page.waitForFunction(type=>window.equippedReserves?.[0]?.type===type,three.type);await page.getByRole('button',{name:'Réserve',exact:true}).click();
 const choices=page.locator('.reserve-choice-card');assert.equal(await choices.count(),2,'Only the two groups linked to this pack are offered');const smaller=choices.filter({hasText:/2 m²/});await smaller.click();
 await page.waitForFunction(type=>window.equippedReserves?.[0]?.type===type,two.type);await page.waitForFunction(type=>window.savedScene?.options.reserveOptionType===type,two.type);
 assert.equal(await page.evaluate(()=>window.reconstructReserve().type),two.type,'Admin/export reconstruction keeps the chosen smaller reserve');
 assert.equal(await page.evaluate(()=>window.equippedReserves[0].options.unitPrice),0);
 await page.getByRole('button',{name:'Reouvrir test',exact:true}).click();await page.getByRole('button',{name:'Réserve',exact:true}).click();assert.match(await smaller.getAttribute('class'),/active/);assert.equal(await choices.count(),2);
 await choices.filter({hasText:/3 m²/}).click();await page.waitForFunction(type=>window.equippedReserves?.[0]?.type===type,three.type);await page.waitForFunction(()=>window.savedScene?.options.reserveOptionType==='');
 await page.locator('.reserve-choice-panel').screenshot({path:'/tmp/standing-equipped-reserve-choices.png'});assert.deepEqual(errors,[]);console.log('Equipped 25m² right layout: 2m² and 3m² linked groups selectable, single replacement, zero catalog supplement, autosave/reopen and export OK');
}finally{await browser?.close();await server.close();}
