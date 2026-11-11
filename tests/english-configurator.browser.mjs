import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source=await readFile('src/App.jsx','utf8');
const appId=resolve('src/__english-app.jsx'),pageId=resolve('src/__english-page.jsx');
const harness=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import * as api from'/src/__english-app.jsx';
const colours=[{id:'gray',name:'Gris clair',code:'0939',hex:'#ccc',included:true},{id:'navy',name:'Bleu marine',code:'0809',hex:'#124',price:4}];
const sign={type:'variant-group-enseigne-haute',label:'Enseigne haute',dimensions:{isVariantGroup:true,configOptions:[{id:'light',type:'toggle',label:'Option lumière',price:281},{id:'turn',type:'toggle',label:'Option tournette',price:800}],variantAssets:[{type:'sign-1m',label:'Enseigne haute 1m',price:100,dimensions:{size:[1,3,1]}}]}};
function Test(){const[lang,setLang]=useState('en'),[mode,setMode]=useState('panels'),[modal,setModal]=useState(true);window.testLanguage=lang;
return <><nav><button onClick={()=>setLang(l=>l==='en'?'fr':'en')}>Language</button><button onClick={()=>{setMode('sign');setModal(true)}}>Sign</button><button onClick={()=>setMode('panels')}>Panels</button></nav><api.LanguageContext.Provider value={lang}>
{mode==='sign'&&modal?<api.ItemConfiguratorModal mode="add" entry={sign} scene={{offer:'Signature'}} salonLabel="Signature" catalog={[sign,...sign.dimensions.variantAssets]} items={[]} onClose={()=>setModal(false)} onConfirm={value=>{window.confirmedSign=value;setModal(false)}}/>:mode==='panels'?<main style={{display:'flex',flexWrap:'wrap',gap:20,padding:20}}>
<section style={{width:340}} data-panel="ground"><api.CarpetColorOptionCard uniformLayout colors={colours} selectedColor={colours[0]} area={18} thick={false}/><api.FootprintColorOptionCard enabled colors={colours} selectedColor={colours[1]} area={1}/></section>
<section style={{width:340}} data-panel="covers"><api.WallCoverOptionCard surfaces={[{id:'back',label:'Cloison arrière',width:4.44,visibleWidth:4.44,height:2.5}]} covers={{back:{enabled:true}}} includedMl={3} unitPrice={249}/></section>
<section style={{width:340}} data-panel="heads"><api.PartitionHeadOptionCard rule={{id:'medium',includedCount:2,leftType:'head',rightType:'head'}} sides={{left:true,right:true}} isSignatureStand salonLabel="Signature" companyName="Maison Réserve Blanche" catalog={[{type:'head',label:'Tête de cloison Signature'}]} visualOptions={{}}/></section>
<section style={{width:340}} data-panel="arch"><api.SignatureArchOptionCard standDepth={2} standArea={10}/></section>
<section style={{width:340}} data-panel="reserve"><api.ReserveOptionCard rule={{id:'included',includedType:'reserve',includedLabel:'Réserve 1m2',options:[]}} catalog={[{type:'reserve',label:'Réserve 1m2',dimensions:{size:[1,2.5,1]}}]} salonLabel="Confort"/></section>
</main>:null}</api.LanguageContext.Provider></>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
 name:'english-configurator-test',resolveId(id){if(id==='/src/__english-app.jsx')return appId;if(id==='/src/__english-page.jsx')return pageId;},
 load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {LanguageContext,ItemConfiguratorModal,CarpetColorOptionCard,FootprintColorOptionCard,WallCoverOptionCard,PartitionHeadOptionCard,SignatureArchOptionCard,ReserveOptionCard};');if(id===pageId)return harness;},
 configureServer(vite){vite.middlewares.use('/__english__',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__english-page.jsx"></script>');});},
}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__english__');
 await page.locator('[data-panel="heads"]').waitFor();
 console.log('ENGLISH PANELS\n'+await page.locator('main').innerText());
 assert.match(await page.locator('[data-panel="ground"]').innerText(),/CARPET/);
 assert.match(await page.locator('[data-panel="covers"]').innerText(),/3 linear metres included/);
 assert.match(await page.locator('[data-panel="arch"]').innerText(),/The arch does not fit/);
 assert.equal(await page.locator('[data-panel="heads"] input').first().inputValue(),'Maison Réserve Blanche','The exhibitor company name is never translated');
 await page.getByRole('button',{name:'Language',exact:true}).click();assert.match(await page.locator('[data-panel="ground"]').innerText(),/MOQUETTE/);
 await page.getByRole('button',{name:'Language',exact:true}).click();
 await page.getByRole('button',{name:'Sign',exact:true}).click();
 console.log('ENGLISH SIGN\n'+await page.locator('.item-config-modal').innerText());
  const controls=page.locator('.item-config-options');
 await controls.getByText('Lighting option',{exact:true}).click();
 assert.equal(await controls.locator('.config-toggle-option[aria-pressed=true]').count(),1);
 await controls.getByText('Rotating kit',{exact:true}).click();
 assert.equal(await controls.locator('.config-toggle-option[aria-pressed=true]').count(),1);
 await controls.getByText('Rotating kit',{exact:true}).click();
 assert.equal(await controls.locator('.config-toggle-option[aria-pressed=true]').count(),0);
 await controls.getByText('Rotating kit',{exact:true}).click();
 await page.getByRole('button',{name:/Apply/i}).click();
 const confirmed=await page.evaluate(()=>window.confirmedSign);
 assert.deepEqual(confirmed.options.extraOptions,{light:false,turn:true});
 assert.equal(confirmed.options.unitPrice,900,'Only one option is charged');
 assert.deepEqual(errors,[]);
 console.log('English redesigned panels and catalogue labels, untouched company name, FR/EN switching and mutually exclusive overhead sign options/pricing OK.');
}finally{await browser?.close();await server.close();}
