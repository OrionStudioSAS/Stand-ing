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
  { ...common, id: 'side-tv', project_name: 'TV sans découpe', layout: 'right', source_payload: { ...common.source_payload, hall: 'Hall 10', aisle_number: 'A', stand_number: '01' }, items: [{ id: 'tv', type: 'screen', label: 'TV', isWallItem: true, wall: 'right', x: 0, y: 1.6 }] },
  { ...common, id: 'odd-wall', project_name: 'Mur non modulaire', layout: 'left', dimensions: { width: 4, depth: 3.19 }, source_payload: { ...common.source_payload, aisle_number: 'A', stand_number: '02', column_values: [{ column: { title: 'Pavillon' }, text: 'Pavillon 2' }] } },
  { ...common, id: 'group', project_name: 'Réserve', source_payload: { ...common.source_payload, contactDetails: { hall: ' b ' } }, items: [{ id: 'reserve', type: 'reserve', label: 'Réserve', isGroup: true, children: [{ id:'part-1', type:'cloison', label:'Cloison groupe', dimensions:{size:[1,2.5,.06]} }, { id:'part-2', type:'cloison', label:'Cloison groupe', dimensions:{size:[1,2.5,.06]} }] }] },
  { ...common, id: 'no-hall', offer: 'Prestige', project_name: 'Sans hall' },
  { ...common, id: 'draft', client_status: 'draft', source_payload: { ...common.source_payload, hall: 'Z' } },
  { ...common, id: 'other', salon_id: 'other-salon', source_payload: { ...common.source_payload, hall: 'X' } },
];
const harness = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { AdminSalonsView } from '/src/__debit-app.jsx';
  import * as bat from '/src/technicalExport.js';
  import '/src/styles.css';
  window.bat = bat;
  window.debitScenes = ${JSON.stringify(scenes)};
  window.debitBefore = JSON.stringify(window.debitScenes);
  function Harness() {
    const [search, setSearch] = useState('');
    const [offers, setOffers] = useState([]);
    const salon = { ...${JSON.stringify(salon)}, packDefinitions: [{name:'Signature'}], offers };
    return <div className="admin-page-content"><input aria-label="Rechercher" value={search} onChange={event=>setSearch(event.target.value)}/><AdminSalonsView salons={[salon]} selectedSalonName={salon.name} search={search} onActivatePack={(_salon, name)=>setOffers([{id:'signature', name}])}/></div>;
  }
  createRoot(document.getElementById('root')).render(<Harness/>);
`;
const server = await createServer({ logLevel:'error', server:{host:'127.0.0.1',port:0},plugins:[{
  name:'salon-debit-export-test',
  resolveId(id){if(id==='/src/__debit-app.jsx')return appId;if(id==='/src/__debit-page.jsx')return pageId;},
  load(id){
    if(id===appId)return source.replace("createRoot(document.getElementById('root')).render(<App />);",'export {AdminSalonsView};');
    if(id===pageId)return harness;
    if(id===resolve('src/data/supabaseClient.js'))return 'export const supabase=null;';
    if(id===resolve('src/data/sceneStore.js'))return "export * from '/src/data/sceneStore.js?debit-original';export async function listScenesForSalonDebit(){window.debitFetches=(window.debitFetches||0)+1;if(window.debitFailNext){window.debitFailNext=false;throw new Error('offline')}return structuredClone(window.debitScenes)};";
  },
  configureServer(vite){vite.middlewares.use('/__debit__',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__debit-page.jsx"></script>');});},
}]});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__debit__`);
  const nav = page.getByRole('navigation', { name: 'Sections du salon' });
  await nav.getByRole('button', { name: 'Débit' }).waitFor();
  assert.deepEqual((await nav.getByRole('button').allTextContents()).slice(1, 3), ['Bon à tirer', 'Débit']);
  await page.getByRole('button', { name: 'Activer un pack' }).click();
  await page.getByRole('button', { name: 'Activer Signature' }).click();
  await page.getByText('Activé', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.debitFetches), undefined);
  await page.evaluate(() => { window.debitFailNext = true; });
  await nav.getByRole('button', { name: 'Débit' }).click();
  await page.getByRole('alert').getByText('Impossible de charger le débit du salon.').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Télécharger le débit' }).isDisabled());
  await page.getByRole('button', { name: 'Réessayer' }).click();
  const table = page.getByRole('table', { name: 'Débit par hall' });
  await table.waitFor();
  const halls = ['Hall 2', 'Hall 10', 'Hall B', 'Hall non renseigné', 'Total global'];
  assert.deepEqual((await table.getByRole('columnheader').allTextContents()).slice(2), halls);
  const tableQuantities = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].slice(2).map(cell => Number(cell.textContent))));
  const adjustmentRow = table.getByRole('row').filter({ hasText: 'hors standard 190' });
  await adjustmentRow.getByText('Contrôle atelier').click();
  await adjustmentRow.getByText(/Mur non modulaire.*mur gauche de 3190 mm/).waitFor();
  await page.getByRole('textbox', { name: 'Rechercher' }).fill('cloison groupe');
  assert.equal(await table.locator('tbody tr').count(), 1);
  const waiting=page.waitForEvent('download');
  await page.getByRole('button',{name:'Télécharger le débit'}).click();
  const download=await waiting;
  assert.equal(download.suggestedFilename(),'debit-salon-debit.csv');
  const csv=await readFile(await download.path(),'utf8');
  const rows=csv.split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match=>match[1].replaceAll('""','"')));
  const start=rows.findIndex(row=>row[0]==='Catégorie'),header=rows[start];
  assert.deepEqual(header.slice(7), halls);
  assert.deepEqual(rows.slice(start+1,-1).map(row=>row.slice(7).map(Number)), tableQuantities);
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
  assert.equal(await page.evaluate(()=>window.debitFetches),2);
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
  await page.setViewportSize({ width: 390, height: 844 });
  const region = page.getByRole('region', { name: 'Quantités par hall' });
  assert.ok(await region.evaluate(el => el.scrollWidth > el.clientWidth && el.getBoundingClientRect().right <= window.innerWidth));
  assert.deepEqual(errors,[]);
  console.log('Salon debit tab: hall columns, retry, workshop details, mobile scrolling and an identical full CSV. BAT wall cut regression checks passed.');
} finally { await browser?.close();await server.close(); }
