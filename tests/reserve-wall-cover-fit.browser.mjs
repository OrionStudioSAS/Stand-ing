import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const source=await readFile('src/App.jsx','utf8'), appId=resolve('src/__reserve-cover-app.jsx'),pageId=resolve('src/__reserve-cover-page.jsx');
const harness=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Canvas,useFrame} from '@react-three/fiber';import {OrbitControls} from '@react-three/drei';import {WallCoverSurfaces,itemGroupBounds,itemHardCollisionBox,reserveWallCoverBounds,wallCoverSurfaceOptions} from '/src/__reserve-cover-app.jsx';
const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#1d7b98"/></svg>');
function Probe({expected}){useFrame(({scene})=>{const planes=[];scene.traverse(node=>{if(node.geometry?.type==='PlaneGeometry'&&node.material?.polygonOffsetFactor===-4)planes.push({width:node.geometry.parameters.width,x:node.parent.position.x});});window.coverProbe={planes,expected};});return null;}
function Test(){const [area,setArea]=useState(2);const front=area===1?[-.5]:[.35,-.59],doorX=area===1?.05:.92;
 const children=[...front.map((x,index)=>({id:'front'+index,label:'Cloison',x,z:0,rotation:0,dimensions:{size:[1,2.5,.06]}})),{id:'door',label:'Porte',x:doorX,z:-.49,rotation:-90,dimensions:{size:[1,2.5,.25],depthLocked6cm:true}}];
 const reserve={id:'reserve',label:'Réserve '+area+' m²',isGroup:true,groupSize:[area,2.5,1],children,rotation:0};const bounds=itemGroupBounds(reserve);reserve.x=-2.5-bounds.minX;reserve.z=-2+.06-bounds.minZ;
 const expected=reserveWallCoverBounds(reserve).maxX;const measured=wallCoverSurfaceOptions('back',5,4,[reserve],{splitForCovers:true}).find(s=>s.wall==='back').visibleWidth;window.measured=measured;
 return <><div style={{position:'fixed',zIndex:10,background:'white',padding:15}}>{[1,2].map(value=><button key={value} onClick={()=>setArea(value)}>Réserve {value} m²</button>)}<p>Signature — réserve {area} m² — porte 6 cm — bâche arrière {measured} ml</p></div><Canvas orthographic camera={{position:[2,3,4],zoom:150}}><color attach="background" args={['#e4e7ec']}/><ambientLight intensity={1.8}/><directionalLight position={[1,5,4]} intensity={1.3}/><mesh position={[0,1.25,-2]}><boxGeometry args={[5,2.5,.12]}/><meshStandardMaterial color="#d0bc93"/></mesh><group position={[reserve.x,0,reserve.z]}>{children.map(child=><group key={child.id} position={[child.x,0,child.z]} rotation={[0,Math.PI*child.rotation/180,0]}>{child.id==='door'?<><mesh position={[-.47,1.25,-.095]}><boxGeometry args={[.06,2.5,.06]}/><meshStandardMaterial color="#72777e"/></mesh><mesh position={[.47,1.25,-.095]}><boxGeometry args={[.06,2.5,.06]}/><meshStandardMaterial color="#72777e"/></mesh><mesh position={[0,2.45,-.095]}><boxGeometry args={[1,.1,.06]}/><meshStandardMaterial color="#72777e"/></mesh></>:<mesh position={[0,1.25,0]}><boxGeometry args={child.dimensions.size}/><meshStandardMaterial color="#72777e"/></mesh>}</group>)}</group><WallCoverSurfaces width={5} depth={4} layout="back" items={[reserve]} covers={{back:{enabled:true}}} previews={{back:{url:art}}}/><Probe expected={expected}/><OrbitControls target={[-.7,1.25,-1.5]}/></Canvas></>;
}createRoot(document.getElementById('root')).render(<Test/>);`;
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'reserve-cover-fit-test',resolveId(id){if(id==='/src/__reserve-cover-app.jsx')return appId;if(id==='/src/__reserve-cover-page.jsx')return pageId;},load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {WallCoverSurfaces,itemGroupBounds,itemHardCollisionBox,reserveWallCoverBounds,wallCoverSurfaceOptions};');if(id===pageId)return harness;},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__reserve-cover-test__')return next();res.setHeader('Content-Type','text/html');res.end('<style>html,body,#root{margin:0;width:100%;height:100%;}</style><div id="root"></div><script type="module" src="/src/__reserve-cover-page.jsx"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-cover-test__`);
 for(const area of [1,2]) {
  await page.getByRole('button',{name:'Réserve '+area+' m²',exact:true}).click();
  await page.waitForFunction(()=>window.coverProbe?.planes.length===1&&window.measured===Math.round(window.coverProbe.planes[0].width*100)/100&&Math.abs(window.coverProbe.planes[0].x-window.coverProbe.planes[0].width/2-window.coverProbe.expected)<1e-8);
  const measurement=await page.evaluate(()=>({displayed:window.measured,physical:Math.round(window.coverProbe.planes[0].width*100)/100}));
  assert.equal(measurement.displayed,measurement.physical);
 }
 await page.screenshot({path:'/tmp/standing-reserve-2m-cover-fit.png'});assert.deepEqual(errors,[]);
 console.log('Reserve covers browser: actual 3D plane meets 6cm door boundary for 1m² and 2m²; displayed metres equal physical dimensions OK');
}finally{await browser?.close();await server.close();}
