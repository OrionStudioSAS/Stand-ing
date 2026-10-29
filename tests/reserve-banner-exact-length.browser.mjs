import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { outsideDoorReserve } from './helpers/reserve-outside-door.mjs';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__reserve-exact-app.jsx'), pageId = resolve('src/__reserve-exact-page.jsx');
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as api from '/src/__reserve-exact-app.jsx';
window.exactApi = api;
const groups = ${JSON.stringify([outsideDoorReserve(2, 1), outsideDoorReserve(2, 2)])};
const art = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#cc4422"/></svg>');
const covers = {right:{enabled:true,previewUrl:art,previewName:'visuel-client.svg',imageZoom:1.2,imageOffsetX:5}};
function Probe(){useFrame(({scene})=>{const result=[];scene.traverse(node=>{if(node.geometry?.type==='PlaneGeometry'&&node.material?.polygonOffsetFactor===-4)result.push({width:node.geometry.parameters.width,position:node.parent.position.toArray()});});window.exactPlanes=result;});return null;}
function Test(){
 const [pack,setPack]=useState('Prestige'),[count,setCount]=useState(1);
 const group = structuredClone(groups[count-1]), bounds = api.reserveWallCoverBounds(group);
 group.x=3-.06-bounds.maxX;group.z=-3.5/2+.06-bounds.minZ;
 const items=[group],surfaces=api.wallCoverSurfaceOptions('right',6,3.5,items,{splitForCovers:true}),right=surfaces.find(surface=>surface.wall==='right');
 const scene={offer:pack,dimensions:{width:6,depth:3.5},layout:'right',items,options:{ledRailsEnabled:false,wallCovers:covers},source_payload:{pricing:{lines:[{type:'wall-cover',label:'Ancienne mesure',quantity:2.5,unitPrice:288,total:720}]}}};
 window.exactCase={pack,count,group,surfaces,right,scene,covers};
 return <><nav>{['Confort','Prestige','Signature','Équipé'].map(name=><button key={name} onClick={()=>setPack(name)}>{name}</button>)}<button onClick={()=>setCount(count===1?2:1)}>Changer les cloisons</button></nav><div style={{display:'flex',height:800}}>
 <div style={{flex:1}}><Canvas camera={{position:[6,5,6],fov:48}}><color attach="background" args={['#eee']}/><ambientLight intensity={2}/><Probe/>
 <mesh position={[0,1.25,-1.75]}><boxGeometry args={[6,2.5,.06]}/><meshStandardMaterial color="#eee"/></mesh>
 <mesh position={[3,1.25,.06]}><boxGeometry args={[.06,2.5,3.5]}/><meshStandardMaterial color="#eee"/></mesh>
 <group position={[group.x,0,group.z]}>{group.children.filter(child=>child.id!=='door').map(child=><mesh key={child.id} position={[child.x,1.25,child.z]}><boxGeometry args={child.dimensions.size}/><meshStandardMaterial color="#787878"/></mesh>)}</group>
 <api.WallCoverSurfaces width={6} depth={3.5} layout="right" items={items} covers={covers} previews={{right:{url:art,name:'visuel-client.svg'}}}/>
 </Canvas></div><aside style={{width:380,padding:20}}><h2>{pack}</h2><api.WallCoverOptionCard surfaces={[right]} covers={covers} previews={{right:{url:art,name:'visuel-client.svg'}}} unitPrice={api.wallCoverPackTariff(scene).unitPrice} includedMl={api.wallCoverPackTariff(scene).includedMl} /></aside>
 </div></>;
}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({ logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'reserve-banner-exact',
  resolveId(id){if(id==='/src/__reserve-exact-app.jsx')return appId;if(id==='/src/__reserve-exact-page.jsx')return pageId;},
  load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {wallCoverSurfaceOptions,reserveWallCoverBounds,WallCoverSurfaces,WallCoverOptionCard,wallCoverPackTariff,scenePurchaseOrder,withTechnicalOptionsMarker};');if(id===pageId)return harness;},
  configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__reserve-exact__')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{margin:0}nav{padding:12px}</style><div id="root"></div><script type="module" src="/src/__reserve-exact-page.jsx"></script>');});},
}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-exact__`);
 for(const count of [1,2]){
  if(count===2)await page.getByRole('button',{name:'Changer les cloisons'}).click();
  const length=count===1?2.44:2.38;
  for(const pack of ['Confort','Prestige','Signature','Équipé']){
   await page.getByRole('button',{name:pack,exact:true}).click();
   await page.waitForFunction(expected=>window.exactCase?.right.visibleWidth===expected&&window.exactPlanes?.length===1&&Math.abs(window.exactPlanes[0].width-expected)<1e-8,length);
   assert.match(await page.locator('.wall-cover-row-main').innerText(),new RegExp(String(length).replace('.',',')));
   const result=await page.evaluate(()=>{
    const {scene,group,right,covers}=window.exactCase,api=window.exactApi,before=JSON.stringify({scene,group,covers});
    const order=api.scenePurchaseOrder(scene,[]),marker=api.withTechnicalOptionsMarker([group],scene,[]).at(-1),bounds=api.reserveWallCoverBounds(group);
    return {line:order.lines.find(line=>line.type==='wall-cover'),visual:marker.sourceVisualSurfaces.find(surface=>surface.id==='right'),bounds,plane:window.exactPlanes[0],unchanged:before===JSON.stringify({scene,group,covers})};
   });
   assert.equal(result.line.quantity,length,'Existing saved orders are repriced with the current physical banner length');
   assert.ok(Math.abs(result.visual.width-length)<1e-8,'BAT/email visual dimensions use the same measurement');
   assert.ok(Math.abs(result.plane.position[2]-result.plane.width/2-result.bounds.maxZ)<1e-8,'The 3D banner starts exactly at the reserve partition');
   assert.equal(result.unchanged,true,'Measurements preserve the manual group, enabled banner, uploaded visual and framing');
  }
  await page.screenshot({path:'/tmp/standing-reserve-banner-'+count+'-wall.png'});
 }
 assert.deepEqual(errors,[]);
 console.log('All packs: 3.50m minus 1.06/1.12m reserve yields 2.44/2.38m in UI, actual 3D, saved-order repricing and BAT visual metadata; reserve groups/uploads unchanged.');
}finally{await browser?.close();await server.close();}
