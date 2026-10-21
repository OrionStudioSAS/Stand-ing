import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const variants = [
  ['asset-totem-plafond-spot-mub9u8aq', 'Arche Totem + Plafond Spot', 'totem-plafond-spot.glb', 1],
  ['asset-totem-plafond-suspension-mub9uybp', 'Arche Totem + Plafond Suspension', 'totem-plafond-suspension.glb', 1],
  ['asset-arche-signature-2m-spot-210-mvhslqjn', 'Arche Signature 2m + Spot 210', 'arche-signature-2m-spot-210.glb', 2],
  ['asset-arche-signature-2m-suspension-mvghsiov', 'Arche Signature 2m + Suspension', 'arche-signature-2m-suspension.glb', 2],
  ['asset-arche-signature-3m-spot-210-mvghs5b8', 'Arche Signature 3m + Spot 110', 'arche-signature-3m-spot-210.glb', 3],
  ['asset-arche-signature-3m-suspension-mvghrlng', 'Arche Signature 3m + Suspension', 'arche-signature-3m-suspension.glb', 3],
];
variants.push(
 ['asset-mur-led-signature-2m-spot-210-mvghmqbr','Mur LED Signature 2m + Spot 210','mur-led-signature-2m-spot-210.glb',2],
 ['asset-mur-led-signature-2m-suspension-mvghm8n8','Mur LED Signature 2m + Suspension','mur-led-signature-2m-suspension.glb',2],
 ['asset-mur-led-signature-3m-spot-210-mvhvgq4h','Mur LED Signature 3m + Spot 210','mur-led-signature-3m-spot-210.glb',3],
 ['asset-mur-led-signature-3m-suspension-mvhvgazp','Mur LED Signature 3m + Suspension','mur-led-signature-3m-suspension.glb',3],
);
const models = await Promise.all(variants.map(async ([type, , file],index) => {
  if(process.env.ARCH_LED_CACHE_DIR && index>=6){const local=await readFile(resolve(process.env.ARCH_LED_CACHE_DIR,`${[1,0,3,2][index-6]}.glb`));assert.equal(local.readUInt32LE(8),local.length);return local;}
  const response = await fetch(`https://eljedngumyxwlvbckkkx.supabase.co/storage/v1/object/public/object-assets/${type}/${file}`);
  assert.ok(response.ok, file);
  return Buffer.from(await response.arrayBuffer());
}));
const entries = variants.map(([type, label, , size], index) => ({ type, label, is_active: true, model_url: `/__arch-${index}.glb`, dimensions: { packs:['Signature'], size:[1.1,3.64,size === 3 ? 3.52 : 2.52] } }));
const art = (color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/></svg>`);
const slots = { 'signature-arch-led-5':{imageUrl:art('red'),imageZoom:1.2,imageOffsetX:3}, 'signature-arch-led-30':{imageUrl:art('cyan'),imageZoom:1.1,imageOffsetY:4} };
const arch = { ...entries[0], modelUrl: entries[0].model_url, id:'arch', x:0,z:-0.68,rotation:0,options:{signatureBaseKey:'arche',signatureArchColorId:'1964',signatureArchColorCode:'1964',signatureArchColorName:'Rouge',signatureArchColorHex:'#d20014',signatureArchColorImage:art('#d20014'),textureSlotValues:slots} };
const scene = { id:'arch-variants',offer:'Signature',salon:'Signature',project_name:'Test arches',dimensions:{width:6,depth:4},layout:'back',items:[arch],client_status:'draft',options:{ledRailsEnabled:false},source_payload:{} };
const source = await readFile('src/App.jsx','utf8');
const appId = resolve('src/__arch-variants-app.jsx'), pageId = resolve('src/__arch-variants-page.jsx'), storeId = resolve('src/data/sceneStore.js');
const harness = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ConfiguratorApp} from '/src/__arch-variants-app.jsx';
localStorage.setItem('standing-config-intro:arch-variants','started');localStorage.setItem('standing-config-tutorial:arch-variants','done');
function Test(){const [scene,setScene]=useState(${JSON.stringify(scene)}),[revision,setRevision]=useState(0);return <><button style={{position:'fixed',bottom:0,left:0,zIndex:99999}} onClick={()=>{setScene(window.savedScene);setRevision(n=>n+1)}}>Reouvrir test</button><button style={{position:'fixed',bottom:0,left:140,zIndex:99999}} onClick={()=>{setScene({...window.savedScene,dimensions:{...window.savedScene.dimensions,depth:2.99}});setRevision(n=>n+1)}}>Profondeur courte test</button><button style={{position:'fixed',bottom:0,left:340,zIndex:99999}} onClick={()=>{setScene({...window.savedScene,dimensions:{...window.savedScene.dimensions,depth:3}});setRevision(n=>n+1)}}>Profondeur 3m test</button><ConfiguratorApp key={revision} initialScene={scene} isAdminViewer /></>};createRoot(document.getElementById('root')).render(<Test/>);`;
// Inspect the materials and carpet plane actually mounted in the Three.js scene.
const probe = `useFrame(({scene})=>{const paints=[],images=[],footprints=[];scene.traverse(node=>{
  for(const material of (Array.isArray(node.material)?node.material:[node.material])){
    if(!material)continue;
    if(['Laminate_D02_120cm#1','Laminate_D02_120cm_1'].includes(material.name))paints.push({hex:material.color.getHexString(),map:Boolean(material.map)});
    if(['LED_5500k#5','*30','LED_5500k_11','_28','LED_5500k_15'].includes(material.name))images.push({name:material.name,custom:Boolean(material.map?.image?.getContext)});
  }
  if(node.renderOrder===1 && node.geometry?.type==='PlaneGeometry' && Math.abs(node.rotation.x+Math.PI/2)<.01)footprints.push({width:node.geometry.parameters.width,depth:node.geometry.parameters.height,textured:Boolean(node.material?.map)});
});window.archRender={paints,images,footprints};});`;
const server = await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'arch-variants-test',resolveId(id){if(id==='/src/__arch-variants-app.jsx')return appId;if(id==='/src/__arch-variants-page.jsx')return pageId;},
  load(id){if(id===appId)return source.replace('  const [hoveredId, setHoveredId] = useState(null);', probe+'\n  const [hoveredId, setHoveredId] = useState(null);').replace("createRoot(document.getElementById('root')).render(<App />);",'export { ConfiguratorApp };').replace('  const estimatedTotal = scenePricing.total;','  window.archPricing=scenePricing; window.archItems=visibleSceneItems;\n  const estimatedTotal = scenePricing.total;');
    if(id===pageId)return harness;
    if(id===storeId)return `export * from '/src/data/sceneStore.js?arch-original';export async function listObjectBank(){return ${JSON.stringify(entries)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },configureServer(vite){vite.middlewares.use((req,res,next)=>{const model=req.url.match(/^\/__arch-(\d)\.glb$/);if(model){res.setHeader('Content-Type','model/gltf-binary');return res.end(models[Number(model[1])]);}if(req.url!=='/__arch-test__')return next();res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/src/__arch-variants-page.jsx"></script>');});},
}]});
let browser;
try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__arch-test__`);
  await page.waitForFunction(()=>window.archPricing,null,{timeout:60000});
  await page.getByRole('button',{name:/^Arche/}).click();
  const sizeGroup=page.getByRole('group',{name:'Taille',exact:true}), lightingGroup=page.getByRole('group',{name:'Éclairage du plafond',exact:true});
  assert.equal(await sizeGroup.getByRole('button').count(),2);
  assert.equal(await sizeGroup.getByRole('button',{name:/^1 m/}).count(),0);
  await page.waitForFunction(()=>window.archItems.some(i=>i.type==='asset-arche-signature-2m-spot-210-mvhslqjn'));
  for(const index of [2,3,5,4]){
    const size=variants[index][3],lighting=index%2?'Suspension':'Spot';
    await sizeGroup.getByRole('button',{name:new RegExp(`^${size} m`)}).click();
    await lightingGroup.getByRole('button',{name:lighting,exact:true}).click();
    await page.waitForFunction(type=>window.savedScene?.items.some(item=>item.type===type),entries[index].type);
    const result=await page.evaluate(()=>({arches:window.savedScene.items.filter(i=>i.options?.signatureBaseKey==='arche'),lines:window.archPricing.lines.filter(l=>l.type.startsWith('signature-arch-size-'))}));
    await page.waitForFunction(()=>window.archRender?.paints.length && window.archRender.paints.every(p=>p.hex==='d20014'&&!p.map) && window.archRender.images.length>=2 && window.archRender.images.every(i=>i.custom) && window.archRender.footprints.some(f=>Math.abs(f.width-1.1)<.01&&f.depth===4.5&&f.textured),null,{timeout:60000});
    assert.equal(result.arches.length,1);assert.deepEqual(result.arches[0].options.textureSlotValues,slots);assert.equal(result.arches[0].options.signatureArchColorHex,'#d20014');
    assert.equal(result.lines.length,size===2?0:1);if(size>2)assert.equal(result.lines[0].total,(size-2)*249);
    assert.equal(await sizeGroup.getByRole('button',{name:new RegExp(`^${size} m`)}).getAttribute('aria-pressed'),'true');
    assert.equal(await lightingGroup.getByRole('button',{name:lighting,exact:true}).getAttribute('aria-pressed'),'true');
  }
  const ledSwitch=page.getByRole('switch',{name:'Mur LED',exact:true});
  await ledSwitch.click();
  for(const index of [8,9,7,6]){
    const size=variants[index][3],lighting=index%2?'Suspension':'Spot';
    await sizeGroup.getByRole('button',{name:new RegExp(`^${size} m`)}).click();
    await lightingGroup.getByRole('button',{name:lighting,exact:true}).click();
    await page.waitForFunction(type=>window.savedScene?.items.some(i=>i.type===type),entries[index].type);
    await page.waitForFunction(()=>window.archRender?.images.some(i=>i.name==='LED_5500k_15'&&i.custom)&&window.archRender.paints.length&&window.archRender.paints.every(p=>p.hex==='d20014'&&!p.map)&&window.archRender.footprints.some(f=>f.textured),null,{timeout:60000});
    const result=await page.evaluate(()=>({arches:window.savedScene.items.filter(i=>i.options?.signatureBaseKey==='arche'),lines:window.archPricing.lines.filter(l=>l.type.startsWith('signature-arch-'))}));
    assert.equal(result.arches.length,1);assert.deepEqual(result.arches[0].options.textureSlotValues,slots);
    assert.equal(result.lines.filter(l=>l.type.startsWith('signature-arch-led-wall-')).length,1);
    assert.equal(result.lines.reduce((sum,l)=>sum+l.total,0),2570+(size===3?249:0));
    assert.equal(await ledSwitch.getAttribute('aria-checked'),'true');
  }
  await ledSwitch.click();await page.waitForFunction(()=>!window.archPricing.lines.some(l=>l.type.startsWith('signature-arch-led-wall-')));
  await ledSwitch.click();
  await sizeGroup.getByRole('button',{name:/^3 m/}).click();await page.waitForFunction(()=>window.savedScene?.items.some(i=>i.options.signatureArchSizeM===3));
  await page.getByRole('button',{name:'Reouvrir test',exact:true}).click();await page.getByRole('button',{name:/^Arche/}).click();
  assert.equal(await sizeGroup.getByRole('button',{name:/^3 m/}).getAttribute('aria-pressed'),'true');assert.equal(await lightingGroup.getByRole('button',{name:'Spot',exact:true}).getAttribute('aria-pressed'),'true');
  const pending=page.getByRole('checkbox',{name:'Je fournirai le visuel plus tard',exact:true});
  await pending.first().check();
  await page.waitForFunction(()=>window.savedScene?.items.some(i=>i.options.textureSlotValues?.['signature-arch-led-5']?.visualPending));
  await page.getByRole('button',{name:'Reouvrir test',exact:true}).click();await page.getByRole('button',{name:/^Arche/}).click();
  assert.equal(await pending.first().isChecked(),true);
  await page.getByRole('button',{name:'Appliquer',exact:true}).click();assert.equal(await page.locator('.signature-arch-card').count(),0);
  await page.getByRole('button',{name:/^Arche/}).click();
  await page.screenshot({path:'/tmp/standing-arch-variants.png'});
  await page.setViewportSize({width:390,height:844});assert.ok(await sizeGroup.getByRole('button',{name:/^3 m/}).isVisible());
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Profondeur courte test',exact:true}).click();
  await page.waitForFunction(()=>window.savedScene?.dimensions.depth===2.99&&window.savedScene.items.some(i=>i.options.signatureArchSizeM===2));
  await page.getByRole('button',{name:/^Arche/}).click();
  assert.equal(await sizeGroup.getByRole('button',{name:/^3 m/}).isDisabled(),true);assert.equal(await ledSwitch.getAttribute('aria-checked'),'true');assert.equal(await page.evaluate(()=>window.archPricing.lines.filter(l=>l.type.startsWith('signature-arch-led-wall-')).length),1);
  assert.equal(await page.getByText('L’arche 3 m nécessite une profondeur de stand d’au moins 3 m.',{exact:true}).isVisible(),true);
  assert.deepEqual(await page.evaluate(()=>window.savedScene.items.find(i=>i.options.signatureBaseKey==='arche').options.textureSlotValues['signature-arch-led-30']),slots['signature-arch-led-30']);
  assert.equal(await page.evaluate(()=>window.archPricing.lines.filter(l=>l.type.startsWith('signature-arch-size-')).length),0);
  await page.getByRole('button',{name:'Profondeur 3m test',exact:true}).click();await page.getByRole('button',{name:/^Arche/}).click();
  assert.equal(await sizeGroup.getByRole('button',{name:/^3 m/}).isEnabled(),true);
  await sizeGroup.getByRole('button',{name:/^3 m/}).click();
  await page.waitForFunction(()=>window.savedScene?.dimensions.depth===3&&window.savedScene.items.some(i=>i.options.signatureArchSizeM===3));
  assert.deepEqual(errors,[]);console.log('Eight arch models + legacy migration: LED toggle/pricing/depth, size + lighting selection, single supplement, image framing/color preservation and reopening OK');
}finally{await browser?.close();await server.close();}
