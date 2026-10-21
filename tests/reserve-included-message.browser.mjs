import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const source=await readFile('src/App.jsx','utf8'),assets=JSON.parse(await readFile('tests/fixtures/signature-reserve-message-catalog.json','utf8'));
const one=assets.find(a=>a.label.includes('1m2')),two=assets.find(a=>a!==one);
const rules={ 'signature-none':{includedType:''}, 'signature-1m2':{includedType:one.type,includedLabel:one.label,options:[],chargeIncluded:false},'signature-2m2':{includedType:two.type,includedLabel:two.label,options:[],chargeIncluded:false},'signature-3m2':{includedType:''} };
const scene={id:'reserve-message-test',project_name:'TEST JULIEN L 2',offer:'Signature',dimensions:{width:6,depth:3},layout:'right',items:[],client_status:'draft',options:{ledRailsEnabled:false,reserveOptionType:two.type},source_payload:{reserveRules:rules,packBenefits:{mode:'allowance',allowanceAmount:720}}};
const appId=resolve('src/__reserve-message-app.jsx'),pageId=resolve('src/__reserve-message-page.jsx'),storeId=resolve('src/data/sceneStore.js');
const harness=`import React from 'react';import {createRoot} from 'react-dom/client';import {ConfiguratorApp} from '/src/__reserve-message-app.jsx';localStorage.setItem('standing-config-intro:reserve-message-test','started');localStorage.setItem('standing-config-tutorial:reserve-message-test','done');createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer/>);`;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'reserve-message',resolveId(id){if(id==='/src/__reserve-message-app.jsx')return appId;if(id==='/src/__reserve-message-page.jsx')return pageId;},load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {ConfiguratorApp};').replace('  const autoSpotsBaseRule = useMemo(','  window.messageReserveItems=automaticReserveItems;window.messageReserveRule=activeReserveRuleConfig;\n  const autoSpotsBaseRule = useMemo(');if(id===pageId)return harness;if(id===storeId)return `export * from '/src/data/sceneStore.js?reserve-message-original';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=scene;return scene;}`;},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__reserve-message__')return next();res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/src/__reserve-message-page.jsx"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-message__`);
 await page.waitForFunction(()=>window.messageReserveItems?.length===1&&window.messageReserveItems[0].options.unitPrice===222);
 await page.getByRole('button',{name:'Réserve',exact:true}).click();
 const formula=page.locator('.formula-included-box');assert.equal(await formula.getByText('Chaque réserve est équipée de 3 étagères, un miroir, une multiprise et une patère.',{exact:true}).isVisible(),true);
 assert.doesNotMatch(await formula.innerText(),/Aucune réserve|réserve blanche|2 étagères/);
 const base=page.locator('.reserve-choice-card').filter({hasText:/1 m²/});assert.equal(await base.locator('.reserve-choice-price').innerText(),'Inclus');
 assert.equal(await page.evaluate(()=>window.messageReserveRule.chargeIncluded),true,'Allowance mode still retains its existing accounting rule');
 await base.click();await page.waitForFunction(type=>window.messageReserveItems[0].type===type&&window.messageReserveItems[0].options.unitPrice===0,one.type);
 await page.waitForFunction(()=>window.savedScene?.options.reserveOptionType==='');
 assert.equal(await formula.locator('p').isVisible(),true);
 await page.locator('.reserve-choice-panel').screenshot({path:'/tmp/standing-reserve-included-message.png'});
 assert.deepEqual(errors,[]);console.log('Signature 18m² allowance: 1m² is included at zero, 2m² remains +222, equipment text and automatic save OK');
}finally{await browser?.close();await server.close();}
