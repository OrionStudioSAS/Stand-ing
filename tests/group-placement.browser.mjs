import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { BoxGeometry, Matrix4, Vector3 } from 'three';

function geometry(boxes) {
  const positions=[],normals=[];
  for(const {size,position=[0,0,0],rotation=0} of boxes){const box=new BoxGeometry(...size).toNonIndexed();const matrix=new Matrix4().makeRotationY(rotation);matrix.setPosition(...position);box.applyMatrix4(matrix);positions.push(...box.attributes.position.array);normals.push(...box.attributes.normal.array);box.dispose();}
  return{positions,normals};
}
function glb(boxes){
  const {positions,normals}=geometry(boxes),p=Buffer.from(new Float32Array(positions).buffer),n=Buffer.from(new Float32Array(normals).buffer),bin=Buffer.concat([p,n]);
  const min=[0,1,2].map(axis=>Math.min(...positions.filter((_,index)=>index%3===axis))),max=[0,1,2].map(axis=>Math.max(...positions.filter((_,index)=>index%3===axis)));
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:'Real fixture model'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.7,.66,.57,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:p.length},{buffer:0,byteOffset:p.length,byteLength:n.length}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min,max},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'}]};
  const text=Buffer.from(JSON.stringify(json)),jsonChunk=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonChunk.length+8+bin.length,8);jh.writeUInt32LE(jsonChunk.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length);bh.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,jh,jsonChunk,bh,bin]);
}
const wallGeom=geometry([{size:[1,2.5,.06],position:[0,1.25,0]}]);
const wallObj=wallGeom.positions.reduce((text,_,index)=>index%3?text:text+`v ${wallGeom.positions.slice(index,index+3).join(' ')}\n`,'')+Array.from({length:wallGeom.positions.length/9},(_,index)=>`f ${index*3+1} ${index*3+2} ${index*3+3}`).join('\n');
const doorGlb=glb([{size:[.06,2.5,.06],position:[-.47,1.25,0]},{size:[1,.06,.06],position:[0,2.47,0]},{size:[.8,2.3,.04],position:[-.08,1.15,-.2],rotation:.55},{size:[.1,.04,.12],position:[.22,1,-.42]}]);
const hookGlb=glb([{size:[.12,.16,.025],position:[0,.08,0]},{size:[.025,.025,.08],position:[0,.02,.035]}]);
const assets=[{type:'wall',label:'Cloison 1m',model_url:'/group-wall.obj',is_active:true,dimensions:{size:[1,2.5,.06],packs:['Confort']}},{type:'door',label:'Porte réserve poignée droite',model_url:'/group-door.glb',is_active:true,dimensions:{size:[1,2.5,.5],packs:['Confort']}},{type:'hook',label:'Patère',model_url:'/group-hook.glb',is_active:true,dimensions:{size:[.12,.16,.08],packs:['Confort']}}];
const children=[{id:'wall',type:'wall',x:-1,z:-1,rotation:0},{id:'door',type:'door',x:0,z:-1,rotation:0,dimensions:{depthLocked6cm:true}},{id:'hook',type:'hook',x:-.8,y:1.8,z:-.9,rotation:0}];
const reserve={type:'group-reserve-test',label:'Réserve test',is_active:true,dimensions:{isGroup:true,category:'Personnalisation',packs:['Confort'],children}};
const source=await readFile('src/App.jsx','utf8'),appId=resolve('src/__group-test-app.jsx'),pageId=resolve('src/__group-test-page.jsx');
const probe=`useFrame(({scene,camera})=>{window.groupScene=scene;window.groupCamera=camera;});`;
const harness=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AssetDrawer,AssetGroupCreator}from'/src/__group-test-app.jsx';
function Test(){const[group,setGroup]=useState(${JSON.stringify(reserve)}),[open,setOpen]=useState(true),[create,setCreate]=useState(false);const assets=${JSON.stringify(assets)};return <><nav style={{position:'fixed',bottom:0,left:0,zIndex:12000}}><button onClick={()=>{setOpen(true);setCreate(false)}}>Rouvrir réserve</button><button onClick={()=>{setOpen(true);setCreate(true)}}>Créer réserve test</button></nav>{open&&(create?<AssetGroupCreator assets={assets} scenes={[]} onClose={()=>setOpen(false)} onCreate={async value=>{window.savedGroup=value;setGroup(value);setOpen(false)}}/>:<AssetDrawer key={group.type} asset={group} assets={[...assets,group]} scenes={[]} onClose={()=>setOpen(false)} onSave={async value=>{window.savedGroup=structuredClone(value);setGroup(value);return value}}/>)}</>};createRoot(document.getElementById('root')).render(<Test/>);`;
const server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'group-editor-test',resolveId(id){if(id==='/src/__group-test-app.jsx')return appId;if(id==='/src/__group-test-page.jsx')return pageId;},load(id){if(id===appId)return source.replace('function GroupEditorModel({ item }) {','function GroupEditorModel({ item }) {'+probe).replace('function MiniGroupPlan({ rows, sourceAssets, selectedUid, onSelect, onMove }) {','function MiniGroupPlan({ rows, sourceAssets, selectedUid, onSelect, onMove }) {window.groupRows=rows;').replace("createRoot(document.getElementById('root')).render(<App />);",'export {AssetDrawer,AssetGroupCreator};');if(id===pageId)return harness;if(id===resolve('src/data/supabaseClient.js'))return'export const supabase=null;';},configureServer(vite){vite.middlewares.use((req,res,next)=>{const files={'/group-wall.obj':['text/plain',wallObj],'/group-door.glb':['model/gltf-binary',doorGlb],'/group-hook.glb':['model/gltf-binary',hookGlb]};if(files[req.url]){res.setHeader('Content-Type',files[req.url][0]);return res.end(files[req.url][1]);}if(req.url!=='/__group-editor__')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__group-test-page.jsx"></script>');});}}]});
let browser;
try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__group-editor__`);
  const editor=page.getByRole('region',{name:'Placement précis des objets',exact:true});await editor.waitFor();await editor.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>window.groupScene?.children.filter(child=>child.name==='group-placement-model').length===3);
  const row=async type=>page.evaluate(type=>window.groupRows.find(row=>row.type===type),type);
  assert.deepEqual((await page.evaluate(()=>window.groupRows.map(({type,x,y,z,rotation})=>({type,x,y,z,rotation})))).map(value=>({...value,y:value.y||0})),children.map(({type,x,y,z,rotation})=>({type,x,y:y||0,z,rotation})),'Opening never snaps existing positions');
  const rendered=await page.evaluate(()=>window.groupScene.children.filter(child=>child.name==='group-placement-model').map(group=>{let vertices=0;group.traverse(node=>{if(node.isMesh)vertices+=node.geometry?.attributes.position.count||0});return{uid:group.userData.uid,vertices}}));
  assert.ok(rendered.every(item=>item.vertices>0));assert.ok(rendered.find(item=>item.uid.startsWith('door')).vertices>rendered.find(item=>item.uid.startsWith('wall')).vertices,'Real asymmetric GLB door geometry, not a rectangle, is rendered');
  const select=editor.getByLabel('Objet à positionner',{exact:true});await select.selectOption((await row('door')).uid);
  const project=async(type,delta={x:0,z:0})=>page.evaluate(({type,delta})=>{const object=window.groupScene.children.find(child=>child.userData.uid===window.groupRows.find(row=>row.type===type).uid);let mesh;object.traverse(node=>{if(node.isMesh&&!mesh)mesh=node});const point=mesh.localToWorld(new window.groupCamera.position.constructor(type==='door'?-.47:0,type==='door'?2.49:.03,type==='hook'?.065:0));point.x+=delta.x;point.z+=delta.z;point.project(window.groupCamera);const rect=document.querySelector('.group-placement-viewport canvas').getBoundingClientRect();return{x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2}}, {type,delta});
  const start=await project('door');await page.mouse.click(start.x,start.y);assert.equal((await row('door')).x,0,'Click does not jump the door to the pointer');
  const end=await project('door',{x:1.05,z:.03});await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();
  assert.equal((await row('door')).x,1);assert.equal((await row('door')).z,-1);
  await editor.getByRole('button',{name:'Décaler X plus',exact:true}).click();assert.equal((await row('door')).x,1.06);
  await editor.getByLabel('X (m)',{exact:true}).fill('0.56');
  const a=await project('door'),b=await project('door',{x:1.03,z:0});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();assert.equal((await row('door')).x,1.56,'Dragging retains the six-centimeter offset');
  await editor.getByRole('button',{name:'Tourner de plus 90 degrés',exact:true}).click();assert.equal((await row('door')).rotation,90);
  await select.selectOption((await row('hook')).uid);await editor.getByLabel('X (m)',{exact:true}).fill('-0.931');await editor.getByLabel('Z (m)',{exact:true}).fill('-0.987');await editor.getByLabel('Hauteur Y (m)',{exact:true}).fill('1.823');
  await editor.getByRole('button',{name:'Décaler Z plus',exact:true}).click();assert.equal((await row('hook')).z,-.986);assert.equal((await row('hook')).y,'1.823');
  await editor.getByRole('button',{name:'Voir la sélection',exact:true}).click();await editor.locator('.group-placement-viewport').focus();await page.keyboard.press('ArrowLeft');assert.equal((await row('hook')).x,-.932);
  const hookStart=await project('hook'),hookEnd=await project('hook',{x:.013,z:.007});await page.mouse.move(hookStart.x,hookStart.y);await page.mouse.down();await page.mouse.move(hookEnd.x,hookEnd.y,{steps:5});await page.mouse.up();
  assert.ok(Math.abs((await row('hook')).x-(-.919))<=.0011,'Accessories drag freely at focused millimeter zoom');
  await editor.getByLabel('X (m)',{exact:true}).fill('-0.932');await editor.getByLabel('Z (m)',{exact:true}).fill('-0.986');
  await editor.getByRole('button',{name:'Recentrer la vue',exact:true}).click();await editor.getByRole('button',{name:'3D',exact:true}).click();await editor.getByRole('button',{name:'Dessus',exact:true}).click();
  const previousScene=await page.evaluate(()=>window.groupScene.uuid);
  await editor.getByRole('button',{name:'Agrandir',exact:true}).click();const large=page.getByRole('dialog',{name:'Placement précis des objets',exact:true});await large.waitFor();
  await page.waitForFunction(previous=>window.groupScene?.uuid!==previous&&window.groupScene?.children.filter(child=>child.name==='group-placement-model').length===3,previousScene);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await large.screenshot({path:'/tmp/standing-reserve-real-editor.png'});
  await page.keyboard.press('Escape');await editor.waitFor();
  await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  const saved=await page.evaluate(()=>window.savedGroup);assert.equal(saved.dimensions.children.find(child=>child.type==='hook').x,-.932);assert.equal(saved.dimensions.children.find(child=>child.type==='hook').y,1.823);assert.equal(saved.dimensions.children.find(child=>child.type==='door').dimensions.depthLocked6cm,true);
  await page.getByRole('button',{name:'Fermer',exact:true}).click();await page.getByRole('button',{name:'Rouvrir réserve',exact:true}).click();await editor.waitFor();assert.equal((await row('hook')).x,-.932);
  for(const width of[390,768]){await page.setViewportSize({width,height:1000});await editor.scrollIntoViewIfNeeded();assert.equal(await editor.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'Precise controls fit mobile and tablet');}
  await page.setViewportSize({width:390,height:600});await editor.getByRole('button',{name:'Agrandir',exact:true}).click();await large.waitFor();
  assert.ok(await large.evaluate(node=>node.getBoundingClientRect().bottom<=innerHeight),'Fullscreen workspace fits a short mobile screen');
  assert.ok(await large.locator('.group-placement-viewport').evaluate(node=>node.getBoundingClientRect().height)>=160);
  await large.getByRole('button',{name:'Réduire',exact:true}).click();
  await page.getByRole('button',{name:'Fermer',exact:true}).click();await page.getByRole('button',{name:'Créer réserve test',exact:true}).click();await editor.waitFor();assert.equal(await editor.locator('canvas').count(),1,'Creation uses the same real-model editor');
  assert.deepEqual(errors,[]);console.log('Reserve editor: real OBJ/GLB models, 1 m dragging without jumps, preserved 6 cm offsets, rotations, millimeter coordinates and height, keyboard, focused zoom, top/3D, fullscreen, mobile, save/reopen and shared creation editor OK');
}finally{await browser?.close();await server.close();}
