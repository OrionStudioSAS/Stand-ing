import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__debit-app.jsx'), pageId = resolve('src/__debit-page.jsx');
const salon = { id: 'salon-test', name: 'Salon débit' };
const common = { salon_id: salon.id, offer: 'Confort', client_status: 'configured', layout: 'back', dimensions: { width: 4, depth: 3 }, items: [], source_payload: { options: { ledRailsEnabled: false } } };
const scenes = [
  { ...common, id: 'side-tv', project_name: 'TV sans découpe', layout: 'right', source_payload: { ...common.source_payload, aisle_number: '10', stand_number: '01' }, items: [{ id: 'tv', type: 'screen', label: 'TV', isWallItem: true, wall: 'right', x: 0, y: 1.6 }] },
  { ...common, id: 'odd-wall', project_name: 'Mur non modulaire', layout: 'left', dimensions: { width: 4, depth: 3.19 }, source_payload: { ...common.source_payload, aisle_number: '2', stand_number: '02' } },
  { ...common, id: 'group', project_name: 'Réserve', source_payload: { ...common.source_payload, contactDetails: { allee: ' b ' } }, items: [{ id: 'reserve', type: 'reserve', label: 'Réserve', isGroup: true, children: [{ id:'part-1', type:'cloison', label:'Cloison groupe', dimensions:{size:[1,2.5,.06]} }, { id:'part-2', type:'cloison', label:'Cloison groupe', dimensions:{size:[1,2.5,.06]} }] }] },
  { ...common, id: 'no-aisle', offer: 'Prestige', project_name: 'Sans allée' },
  { ...common, id: 'draft', client_status: 'draft', source_payload: { ...common.source_payload, aisle_number: 'Z' } },
  { ...common, id: 'other', salon_id: 'other-salon', source_payload: { ...common.source_payload, aisle_number: 'X' } },
];
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{downloadSalonDebit}from'/src/__debit-app.jsx';import * as bat from '/src/technicalExport.js';window.bat=bat;window.debitScenes=${JSON.stringify(scenes)};window.debitBefore=JSON.stringify(window.debitScenes);createRoot(document.getElementById('root')).render(<button onClick={()=>downloadSalonDebit(${JSON.stringify(salon)},[])}>Télécharger le débit</button>);`;
const server = await createServer({ logLevel:'error', server:{host:'127.0.0.1',port:0},plugins:[{
  name:'salon-debit-export-test',
  resolveId(id){if(id==='/src/__debit-app.jsx')return appId;if(id==='/src/__debit-page.jsx')return pageId;},
  load(id){
    if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {downloadSalonDebit};');
    if(id===pageId)return harness;
    if(id===resolve('src/data/supabaseClient.js'))return 'export const supabase=null;';
    if(id===resolve('src/data/sceneStore.js'))return "export * from '/src/data/sceneStore.js?debit-original';export async function listScenesForSalonDebit(){window.debitFetches=(window.debitFetches||0)+1;return structuredClone(window.debitScenes)};";
  },
  configureServer(vite){vite.middlewares.use('/__debit__',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__debit-page.jsx"></script>');});},
}]});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__debit__`);
  const waiting=page.waitForEvent('download');
  await page.getByRole('button',{name:'Télécharger le débit'}).click();
  const download=await waiting;
  assert.equal(download.suggestedFilename(),'debit-salon-debit.csv');
  const csv=await readFile(await download.path(),'utf8');
  const rows=csv.split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match=>match[1].replaceAll('""','"')));
  const start=rows.findIndex(row=>row[0]==='Catégorie'),header=rows[start];
  assert.deepEqual(header.slice(7),['Allée 2','Allée 10','Allée B','Allée non renseignée','Total global']);
  assert.equal(rows.find(row=>row[0]==='Nombre de scènes')[1],'4');
  const adjustment=rows.slice(start+1).find(row=>row[2].includes('hors standard 190'));
  assert.deepEqual(adjustment.slice(7),['1','0','0','0','1']);
  assert.match(adjustment[6],/Mur non modulaire.*mur gauche de 3190 mm/);
  assert.doesNotMatch(csv,/hors standard 60/);
  const groupWall=rows.slice(start+1).find(row=>row[2]==='Cloison groupe');
  assert.deepEqual(groupWall.slice(7),['0','0','2','0','2']);
  for(const row of rows.slice(start+1))assert.equal(row.slice(7,-1).reduce((sum,q)=>sum+Number(q),0),Number(row.at(-1)));
  const totals=rows.at(-1);
  for(let i=7;i<header.length;i++)assert.equal(Number(totals[i]),rows.slice(start+1,-1).reduce((sum,row)=>sum+Number(row[i]),0));
  assert.equal(await page.evaluate(()=>window.debitFetches),1);
  assert.equal(await page.evaluate(()=>window.debitBefore===JSON.stringify(window.debitScenes)),true);
  const vector=await page.evaluate(async()=>{
    const tv={id:'tv',type:'screen',label:'TV',wall:'right',isWallItem:true,x:0,y:1.6};
    const input={width:4,depth:3,layout:'right',catalog:[],items:[tv]},before=JSON.stringify(tv);
    const pages=await window.bat.createTechnicalPlanSvgPages(input);
    const pdf=await window.bat.createTechnicalPlanBlob(input);
    return {panels:window.bat.standWallPanelRequirements(input),text:pages[0].textContent,unchanged:before===JSON.stringify(tv),pdf:[...new Uint8Array(await pdf.arrayBuffer())]};
  });
  assert.ok(vector.panels.every(panel=>[250,500,750,1000].includes(panel.lengthMm)));
  assert.equal(vector.unchanged,true);
  assert.doesNotMatch(vector.text,/(?:CLOISON|RENFORT TV)(?:60|190)(?:x2500mm ht| mm)/);
  const pdf=await PDFDocument.load(Uint8Array.from(vector.pdf));
  assert.ok(Math.abs(pdf.getPage(0).getWidth()/pdf.getPage(0).getHeight()-420/297)<.001);
  assert.deepEqual(errors,[]);
  console.log('Real CSV download: aisles naturally sorted, unknown aisle retained, drafts excluded, groups expanded, totals last and reconciled; only unavoidable 190mm cut flagged. TV side-wall BAT and A3 PDF use stock panels without moving the TV.');
} finally { await browser?.close();await server.close(); }
