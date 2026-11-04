import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const assets = JSON.parse(await readFile('tests/fixtures/signature-reserve-head-banner.json', 'utf8'));
const appId = resolve('src/__signature-banner-edge-app.jsx');
const pageId = resolve('src/__signature-banner-edge-page.jsx');
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas,useFrame} from '@react-three/fiber';
import * as api from '/src/__signature-banner-edge-app.jsx';
const assets=${JSON.stringify(assets)};
const catalog=assets.map(asset=>api.assetToCatalogEntry(asset,assets));
const reserveRule={id:'signature-1m2',includedType:'group-reserve-1m2-arriere-droite-mqrv4cbu',options:[]};
const headRule={id:'medium',includedCount:2,leftType:'asset-tete-de-cloison-mub9t9vw',rightType:'asset-tete-de-cloison-mub9t9vw'};
const reserve=api.makeAutomaticReserveItems(reserveRule,'',catalog,6,3,'right','Signature');
const heads=api.makeAutomaticPartitionHeadItems(headRule,{left:true,right:true},catalog,6,3,'right','Signature');
const items=[...reserve,...heads],surfaces=api.wallCoverSurfaceOptions('right',6,3,items,{splitForCovers:true});
const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#cc4422"/></svg>');
const covers={right:{enabled:true,previewUrl:art},back:{enabled:true,previewUrl:art}};
const scene={offer:'Signature',layout:'right',dimensions:{width:6,depth:3},items,options:{ledRailsEnabled:false,wallCovers:covers}};
window.bannerEdge={reserve,heads,surfaces,catalog,items,scene,covers};window.bannerEdgeApi=api;
function Probe(){useFrame(()=>{window.bannerEdgeReady=true;});return null;}
function Test(){return <div style={{display:'flex',height:800}}><Canvas camera={{position:[7,5,6]}}><ambientLight/><Probe/><api.WallCoverSurfaces width={6} depth={3} layout="right" items={items} covers={covers}/></Canvas><aside style={{width:380,flexShrink:0}}><api.WallCoverOptionCard surfaces={surfaces.filter(s=>s.kind==='wall')} covers={covers} unitPrice={249} includedMl={3}/></aside></div>;}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{
  name:'signature-banner-head-edge',
  resolveId(id){if(id==='/src/__signature-banner-edge-app.jsx')return appId;if(id==='/src/__signature-banner-edge-page.jsx')return pageId;},
  load(id){
    if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {assetToCatalogEntry,makeAutomaticReserveItems,makeAutomaticPartitionHeadItems,wallCoverSurfaceOptions,wallCoverDisplayBlockers,reserveWallCoverBounds,wallCoverPartitionHeadBlocker,wallAxisLimits,wallItemAxisBounds,screenWorldPosition,wallMountedItemRotation,WallCoverSurfaces,WallCoverOptionCard,scenePurchaseOrder,withTechnicalOptionsMarker};');
    if(id===pageId)return harness;
  },
  configureServer(vite){vite.middlewares.use((req,res,next)=>{if(req.url!=='/__signature-banner-edge__')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__signature-banner-edge-page.jsx"></script>');});},
}]});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-banner-edge__`);
  await page.waitForFunction(()=>window.bannerEdgeReady);
  const result=await page.evaluate(()=>{
    const {reserve,heads,items,surfaces,scene,covers}=window.bannerEdge,api=window.bannerEdgeApi;
    const before=JSON.stringify({reserve,heads,covers});
    const marker=api.withTechnicalOptionsMarker(items,scene,[]).at(-1);
    return {surfaces,heads:heads.map(item=>({wall:item.wall,x:item.x,bounds:api.wallItemAxisBounds(item,item.wall)})),
      reserve:api.reserveWallCoverBounds(reserve[0]),
      blockers:api.wallCoverDisplayBlockers('right',items,6,3,'right'),
      visuals:marker.sourceVisualSurfaces,
      unchanged:before===JSON.stringify({reserve,heads,covers})};
  });
  console.log(JSON.stringify(result,null,2));
  const right=result.surfaces.find(surface=>surface.wall==='right'),back=result.surfaces.find(surface=>surface.wall==='back');
  assert.equal(right.visibleWidth,1.44,'3m minus 50cm head minus 1.06m reserve');
  assert.equal(back.visibleWidth,4.44,'The existing back wall calculation must stay unchanged');
  assert.ok(Math.abs(right.width-1.44)<1e-9,'Real 3D banner width matches the stated measurement');
  assert.ok(Math.abs(back.width-4.438895)<1e-9,'Preserve the actual fixed door-frame geometry behind the 4.44m display');
  assert.ok(Math.abs(right.position[2]-right.width/2-result.reserve.maxZ)<1e-9,'Banner meets the real reserve partition');
  const head=result.heads.find(item=>item.wall==='right');
  assert.ok(Math.abs(right.position[2]+right.width/2-(head.x+head.bounds.min))<1e-9,'Banner meets the head with no artificial centimetre gap');
  for(const surface of [right,back])assert.ok(Math.abs(result.visuals.find(v=>v.id===surface.id).width-surface.width)<1e-9,'BAT uses the same exact printable width');
  assert.match(await page.locator('.wall-cover-row-main').allTextContents().then(rows=>rows.join('\n')),/1,44 m × 2,5 m/);
  assert.equal(result.unchanged,true);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/standing-signature-banner-head-edge.png'});
  console.log('Signature 6x3 L-right: right banner 1.44m, back banner 4.44m; UI, 3D geometry and BAT agree.');
} finally {
  await browser?.close();
  await server.close();
}
