import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const source=await readFile('src/App.jsx','utf8');
const appId=resolve('src/__signature-info-app.jsx'),pageId=resolve('src/__signature-info-page.jsx');
const harness=`import {createPartitionHeadInfoTexture,applyItemOptionMaterials,prepareTechnicalExportFonts,technicalPartitionHeadInformation} from '/src/__signature-info-app.jsx';
import {MeshStandardMaterial,Texture} from 'three';
await prepareTechnicalExportFonts();
window.fontsLoaded=[document.fonts.check('500 144px Gotham'),document.fonts.check('900 130px Gotham')];
const head=side=>({id:side,type:'tete-de-cloison-signature',label:'Tête de cloison Signature',options:{partitionHeadSide:side}});
const textures={};
for(const side of ['left','right']){
 const section=document.createElement('section');section.innerHTML='<h2>Tête de cloison '+(side==='left'?'gauche':'droite')+'</h2>';document.body.appendChild(section);
 const texture=createPartitionHeadInfoTexture({company:'NOM EXPOSANT',standNumber:'G25'},head(side),{flipY:false});texture.image.id=side;section.appendChild(texture.image);textures[side]=texture;
}
const changed=createPartitionHeadInfoTexture({company:'SOCIÉTÉ ÉNERGIE INTERNATIONALE',standNumber:'H32'},head('right'));changed.image.id='changed';document.body.appendChild(changed.image);
const originalMap=new Texture(), material=new MeshStandardMaterial({name:'*28',map:originalMap});
const panel=applyItemOptionMaterials(material,head('left'),{exhibitorTexture:textures.left});
const vertical=new MeshStandardMaterial({name:'LED_5500k#4',map:originalMap});
const custom=document.createElement('canvas');custom.width=100;custom.height=70;custom.getContext('2d').fillRect(0,0,100,70);
window.results={materialCorrect:panel.map===textures.left,verticalUnchanged:applyItemOptionMaterials(vertical,head('left'),{exhibitorTexture:textures.left})===vertical,flipY:textures.left.flipY,changed:changed.image.toDataURL()!==textures.right.image.toDataURL(),customWins:applyItemOptionMaterials(material,{...head('left'),options:{...head('left').options,textureSlotValues:{'signature-head-top-28':{imageUrl:'custom.png'}}}},{exhibitorTexture:textures.left,textureSlotImages:{'signature-head-top-28':custom}}).map!==textures.left};
const information=technicalPartitionHeadInformation([head('left'),head('right')],{project_name:'NOM EXPOSANT',source_payload:{stand_number:'G25'}});
window.exportMatches=information.map((entry,i)=>entry.imageUrl===[textures.left,textures.right][i].image.toDataURL());
window.done=true;`;
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'signature-info-test',resolveId(id){if(id==='/src/__signature-info-app.jsx')return appId;if(id==='/src/__signature-info-page.jsx')return pageId;},load(id){if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {createPartitionHeadInfoTexture,applyItemOptionMaterials,prepareTechnicalExportFonts,technicalPartitionHeadInformation};');if(id===pageId)return harness;},configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__signature-info-test__')return next();res.setHeader('Content-Type','text/html');res.end('<style>body{margin:20px;background:#eee;font-family:Arial}section{display:inline-block;width:48%;margin-right:1%}canvas{width:100%;height:auto}#changed{width:48%}</style><script type="module" src="/src/__signature-info-page.jsx"></script>');});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1200}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-info-test__`);await page.waitForFunction(()=>window.done).catch(error=>{throw new Error(`${error.message}; browser errors: ${errors.join('; ')}`);});
 assert.deepEqual(await page.evaluate(()=>window.fontsLoaded),[true,true]);
 assert.deepEqual(await page.evaluate(()=>window.results),{materialCorrect:true,verticalUnchanged:true,flipY:false,changed:true,customWins:true});
 assert.deepEqual(await page.evaluate(()=>window.exportMatches),[true,true]);
 const orangeBounds=await page.evaluate(()=>['left','right'].map(id=>{const canvas=document.getElementById(id),ctx=canvas.getContext('2d'),p=ctx.getImageData(0,0,canvas.width,canvas.height).data;let minX=canvas.width,maxX=0,minY=canvas.height,maxY=0;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(p[i]>230&&p[i+1]>50&&p[i+1]<130&&p[i+2]<80){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}return{minX,maxX,minY,maxY};}));
 assert.ok(orangeBounds[0].maxX<700);assert.ok(orangeBounds[1].minX>700);assert.equal(orangeBounds[0].maxY,orangeBounds[1].maxY);assert.ok(orangeBounds.every(b=>b.minY>800&&b.maxY<930));
 for(const id of ['left','right'])await page.locator('#'+id).screenshot({path:'/tmp/standing-signature-head-'+id+'.png'});
 await page.screenshot({path:'/tmp/standing-signature-heads.png',fullPage:true});await page.screenshot({path:'/tmp/standing-signature-heads-pair.png',clip:{x:0,y:0,width:1440,height:560}});assert.deepEqual(errors,[]);
 console.log('Signature information: Gotham loaded, left/right corners, updated company/stand, correct material, optional custom logo, matching technical export OK');
}finally{await browser?.close();await server.close();}
