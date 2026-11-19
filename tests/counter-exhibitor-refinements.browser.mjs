import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__counter-refinements-app.jsx');
const pageId = resolve('src/__counter-refinements-page.jsx');
const storeId = resolve('src/data/sceneStore.js');
const harness = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{CounterOptionCard,ItemConfiguratorModal,PartitionHeadOptionCard,PrestigeSignageOptionCard,AdminClientsView,calculateScenePricing}from'/src/__counter-refinements-app.jsx';
import{includedCounterPowerItems}from'/src/includedCounterPower.js';
const power={type:'triplette',label:'Triplette',price:57,dimensions:{category:'Électricité',packPricing:{confort:{price:57},prestige:{price:57},equipe:{price:48}}}};
const desk={id:'desk',type:'desk',label:'Comptoir accueil',price:473,modelSize:[1,1,.5],x:0,z:0,options:{binary3Enabled:false}};
const catalog=[desk,power];
const scenes=['old','new'].map(id=>({id,share_token:id,project_name:'Stand identique',client_name:'Client',offer:'Prestige',salon:'SMCL',client_status:'draft',source_payload:{hall:id==='new'?'6':'7'},updated_at:id==='old'?'2026-11-19T09:00:00Z':'2026-11-18T09:00:00Z'}));
function Test(){const[mode,setMode]=useState('included'),[pack,setPack]=useState('Confort'),[item,setItem]=useState(desk);
window.counterTest=()=>({item,price:calculateScenePricing({items:[item],catalog,scene:{offer:pack},salonLabel:pack}),power:includedCounterPowerItems([item],catalog)});
return <><nav>{['included','optional','heads','signage','history'].map(value=><button key={value} onClick={()=>setMode(value)}>{value}</button>)}<select aria-label="Pack test" value={pack} onChange={e=>setPack(e.target.value)}>{['Confort','Prestige','Équipé'].map(p=><option key={p}>{p}</option>)}</select></nav>
{mode==='included'&&<CounterOptionCard items={[{...desk,included:true}]} catalog={catalog} salonLabel={pack}/>}
{mode==='optional'&&<ItemConfiguratorModal mode="edit" scene={{offer:pack,source_payload:{},dimensions:{width:6,depth:3}}} item={item} entry={desk} catalog={catalog} salonLabel={pack} items={[item]} uploadState={{}} onUpdateItemOptions={(_,patch)=>setItem(old=>({...old,options:{...old.options,...patch}}))} onConfirm={value=>{window.confirmedCounter=value;setMode('included')}} onClose={()=>setMode('included')}/>}
{mode==='heads'&&<PartitionHeadOptionCard rule={{leftType:'head',rightType:'head'}} sides={{left:true,right:true}} catalog={[]} salonLabel={pack}/>}
{mode==='signage'&&<PrestigeSignageOptionCard enabled items={[{id:'signage',type:'signage',options:{}}]}/>}
{mode==='history'&&<AdminClientsView clients={[{id:'client',display_name:'Client',company_name:'Société',scenes}]} scenes={scenes} filters={{search:'',salon:'',pack:'',status:''}} updateFilter={()=>{}}/>}</>}
createRoot(document.getElementById('root')).render(<Test/>);
`;
const store = `
export * from '/src/data/sceneStore.js?counter-original';
window.auditQueries=[];
export async function listSceneLatestActivities(ids){return ids.map(scene_id=>({scene_id,actor_name:scene_id==='new'?'Client récent':'Client ancien',action:'Objet déplacé',created_at:scene_id==='new'?'2026-11-18T09:45:00Z':'2026-11-01T08:00:00Z'}))}
export async function listAdminAuditEvents(offset,filters){
 window.auditQueries.push({offset,filters});
 if(window.auditFailure){window.auditFailure=false;throw Error('Erreur temporaire de l’historique');}
 return {events:[{id:filters.sceneId+'-'+offset,scene_id:filters.sceneId,scene_name:'Stand identique',actor_name:filters.sceneId==='new'?'Client récent':'Client ancien',actor_kind:'exposant',action:offset?'Objet ajouté':'Objet déplacé',detail:'Modification '+filters.sceneId,created_at:'2026-11-18T09:45:00Z'}],hasMore:offset===0};
}`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'counter-exhibitor-refinements',
  resolveId(id) {
    if (id === '/src/__counter-refinements-app.jsx') return appId;
    if (id === '/src/__counter-refinements-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);",
      'export {CounterOptionCard,ItemConfiguratorModal,PartitionHeadOptionCard,PrestigeSignageOptionCard,AdminClientsView,calculateScenePricing};');
    if (id === pageId) return harness;
    if (id === storeId) return store;
  },
  configureServer(vite) { vite.middlewares.use('/__counter-refinements__', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<div id="root"></div><script type="module" src="/src/__counter-refinements-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__counter-refinements__`);
  const pack = page.getByLabel('Pack test');
  for (const value of ['Confort', 'Prestige', 'Équipé']) {
    await pack.selectOption(value);
    await page.getByRole('button', { name: 'Information sur la multiprise incluse' }).focus();
    assert.ok(await page.getByRole('tooltip').isVisible());
    assert.match(await page.getByRole('tooltip').textContent(), /Une multiprise est incluse/);
  }
  await pack.selectOption('Confort');
  await page.getByRole('button', { name: 'optional', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'Ajouter une multiprise dans le comptoir' });
  assert.equal(await toggle.isChecked(), false);
  const total = () => page.locator('.item-config-footer-total strong').innerText();
  const initial = await total();
  await page.locator('.counter-power-card .counter-logo-switch').click();
  await page.waitForFunction(() => window.counterTest().power.length === 1);
  assert.equal(await page.evaluate(() => window.counterTest().price.lines.find(line => line.type === 'counter-power-desk').total), 57);
  assert.notEqual(await total(), initial);
  await page.screenshot({ path: '/tmp/standing-counter-power-option.png' });
  await page.locator('.counter-power-card .counter-logo-switch').click();
  assert.equal(await total(), initial);
  assert.equal(await page.evaluate(() => window.counterTest().power.length), 0);
  await page.locator('.counter-power-card .counter-logo-switch').click();
  await page.locator('.item-config-apply').click();
  assert.equal(await page.evaluate(() => window.confirmedCounter.options.counterPowerEnabled), true);
  await page.getByRole('button', { name: 'optional', exact: true }).click();
  assert.equal(await toggle.isChecked(), true, 'The saved option survives reopening');
  await page.locator('.item-config-apply').click();
  await page.getByRole('button', { name: 'heads', exact: true }).click();
  for (const value of ['Confort', 'Prestige', 'Équipé']) {
    await pack.selectOption(value);
    assert.equal(await page.locator('.partition-head-activity-info').count(), value === 'Équipé' ? 0 : 1);
  }
  await page.getByRole('button', { name: 'signage', exact: true }).click();
  assert.ok(await page.getByText(/1500 × 1300 mm ht · RECTO VERSO/).count() > 0);
  await page.getByRole('button', { name: 'history', exact: true }).click();
  await page.locator('.admin-exhibitors-activity').getByText('Client récent', { exact: true }).waitFor();
  assert.deepEqual((await page.locator('.admin-exhibitors-head > span').allTextContents()).slice(2,5), ['Salon','Hall','Pack']);
  assert.equal(await page.locator('.admin-exhibitors-hall').innerText(), '6, 7');

  assert.match(await page.locator('.admin-exhibitors-activity').innerText(), /18\/11\/2026/);
  await page.locator('summary').click();
  assert.deepEqual(await page.locator('.admin-exhibitors-scene').evaluateAll(rows => rows.map(row => row.dataset.sceneId)), ['new', 'old']);
  await page.locator('[data-scene-id="new"]').getByRole('button', { name: 'Historique', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Historique de Stand identique' });
  await dialog.getByText('Modification new', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/standing-exhibitor-scene-history.png' });
  assert.equal(await dialog.getByText('Modification old', { exact: true }).count(), 0);
  await page.evaluate(() => { window.auditFailure = true; });
  await dialog.getByRole('button', { name: 'Charger plus d’actions' }).click();
  await dialog.getByRole('button', { name: 'Réessayer' }).click();
  await dialog.getByText('Objet ajouté', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.auditQueries.map(query => [query.offset, query.filters.sceneId])), [[0, 'new'], [100, 'new'], [100, 'new']]);
  await dialog.getByRole('button', { name: 'Fermer l’historique' }).click();
  await page.locator('[data-scene-id="old"]').getByRole('button', { name: 'Historique', exact: true }).click();
  await dialog.getByText('Modification old', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('Modification new', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await dialog.evaluate(node => node.getBoundingClientRect().width <= innerWidth));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Counters: included tooltip, optional strip pricing/persistence; pack messages; Prestige dimensions; unique-scene history, latest activity, retry and mobile OK.');
} finally {
  await browser?.close();
  await server.close();
}
