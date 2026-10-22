import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const source=await readFile('src/App.jsx','utf8'),appId=resolve('src/__palette-badges-app.jsx'),pageId=resolve('src/__palette-badges-page.jsx');
const exports='SurfaceColorOptionCard,CounterFinishCard,TextureSlotsOptionsPanel,FootprintColorOptionCard,ColorOptionCard,WoodReceptionDeskOptionsPanel,VariantColorOptionsPanel,PodiumVariantPicker,counterFinishOptions';
const harness=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import * as api from '/src/__palette-badges-app.jsx';
const colors=[{id:'white',name:'Blanc',code:'01',hex:'#ffffff',included:true,isFree:true,isDefault:true,price:0},{id:'blue',name:'Bleu',code:'02',hex:'#0044aa',included:true,isFree:true,price:0},{id:'red',name:'Rouge',code:'03',hex:'#ff0000',price:2},{id:'black',name:'Noir',code:'04',hex:'#111111',price:4}];
const counter=colors.map(c=>({...c,priceManagedByOption:true,mode:'color',price:c.included?0:25}));
const group={type:'colors',label:'Couleurs test',is_active:true,dimensions:{isColorGroup:true,colorGroupUsage:'counter',colorGroupUsages:['counter'],colorGroupPrice:25,colorOptions:colors}};
function Test(){const [selected,setSelected]=useState(colors[0]);return <main style={{width:340,maxWidth:'100%',margin:'auto',display:'grid',gap:16,height:'100vh',overflow:'auto',background:'#fff'}}>
<section data-case="surface"><api.SurfaceColorOptionCard title="COTON GRATTÉ" colors={colors} selectedColor={selected} area={4} onSelect={id=>setSelected(colors.find(c=>c.id===id))}/></section>
<section data-case="all-paid"><api.SurfaceColorOptionCard title="PAYANT" colors={colors.slice(2)} selectedColor={colors[2]} area={2}/></section>
<section data-case="single-free"><api.SurfaceColorOptionCard title="INCLUS" colors={colors.slice(0,1)} selectedColor={colors[0]} disabled/></section>
<section data-case="counter-paid"><api.CounterFinishCard finishes={counter.slice(2)} selectedFinish={counter[2]}/></section>
<section data-case="legacy-paid"><api.ColorOptionCard title="COTON" colors={colors.slice(2)} selectedColor={colors[2]} area={4}/></section>
<section data-case="footprint-paid"><api.FootprintColorOptionCard enabled colors={colors.slice(2)} selectedColor={colors[2]} area={2}/></section>
<section data-case="wood-paid"><api.WoodReceptionDeskOptionsPanel embedded item={{options:{}}} colors={counter.slice(2)}/></section>
<section data-case="counter-multi"><api.CounterFinishCard finishes={counter} selectedFinish={counter[0]}/></section>
<section data-case="counter-single"><api.CounterFinishCard finishes={[counter[0],counter[2]]} selectedFinish={counter[0]}/></section>
<section data-case="texture"><api.TextureSlotsOptionsPanel embedded item={{options:{}}} slots={[{id:'color',kind:'color',colorUsage:'counter',label:'Couleur'}]} counterColors={counter}/></section>
<section data-case="native"><api.TextureSlotsOptionsPanel embedded item={{options:{}}} slots={[{id:'native',kind:'color',label:'Teinte libre'}]}/></section>
<section data-case="footprint"><api.FootprintColorOptionCard enabled colors={colors} selectedColor={colors[0]} area={2} onSelect={()=>{}}/></section>
<section data-case="wood"><api.WoodReceptionDeskOptionsPanel embedded item={{options:{}}} colors={counter}/></section>
<section data-case="variant"><api.VariantColorOptionsPanel options={[{id:'color',type:'color',label:'Couleur',colorGroupType:'colors'}]} catalog={[group]}/></section>
<section data-case="podium"><api.PodiumVariantPicker choices={[{id:'white',label:'Podium blanc 50cm',price:20},{id:'black',label:'Podium noir 50cm',price:20}]} value="white" onChange={()=>{}}/></section>
</main>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'palette-badges',resolveId(id){if(id==='/src/__palette-badges-app.jsx')return appId;if(id==='/src/__palette-badges-page.jsx')return pageId;},load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",`export {${exports}};`);if(id===pageId)return harness;},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__palette-badges__')return next();res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/src/__palette-badges-page.jsx"></script>');});}}]});let browser;
try{await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__palette-badges__`);
const block=name=>page.locator(`[data-case="${name}"]`);await block('surface').getByRole('button',{name:'Blanc (01)',exact:true}).waitFor();
for(const name of ['surface','single-free','counter-multi','counter-single','texture','native','footprint','podium'])assert.ok(await block(name).locator('.color-palette-badge.included').count()>0,`${name}: visible included tag`);
assert.equal(await block('all-paid').locator('.included').count(),0);assert.match(await block('all-paid').locator('.price').innerText(),/4 €/);
assert.match(await block('surface').locator('.price').innerText(),/Dès.*8 €/);await block('surface').getByRole('button',{name:'Noir (04)',exact:true}).click();assert.match(await block('surface').locator('.price').innerText(),/16 €/);
for(const name of ['counter-paid','legacy-paid','footprint-paid','wood-paid']){assert.equal(await (name==='wood-paid'?block(name).locator('.counter-color-card'):block(name)).locator('.included').count(),0,`${name}: no invented free colors`);assert.ok(await block(name).locator('.price').count()>0);}
for(const name of ['counter-multi','counter-single','texture'])assert.match(await block(name).locator('.price').innerText(),/25 €/);
for(const name of ['wood','variant']){assert.ok(await block(name).locator('.included').count()>0,`${name}: existing included tags retained`);assert.ok(await block(name).locator('.price').count()>0,`${name}: existing optional tags retained`);}
assert.match(await block('footprint').locator('.color-palette-badge.price').innerText(),/4 €/);
await block('surface').screenshot({path:'/tmp/standing-color-badges-surface.png'});await block('texture').locator('aside').screenshot({path:'/tmp/standing-color-badges-counter.png'});
await page.setViewportSize({width:320,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);console.log('Color badges: shared/legacy surfaces, counters, material palettes, single/all-paid cases, selected/area prices, footprint, podium, existing tags and 320px layout OK');
}finally{await browser?.close();await server.close();}
