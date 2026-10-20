import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const base = { salon: 'SMCL 2026', event_name: 'SMCL 2026', offer: 'Prestige', dimensions: { width: 6, depth: 4 },
  updated_at: '2026-10-19T08:00:00.000Z', items: [{ id: 'manual-reserve', children: [{ x: 0.25, z: -0.5 }] }], files: [{ id: 'artwork.svg' }],
  source_payload: { exhibitor_view_only: true, options: { reserveOptionType: 'manual-reserve' }, manualPurchaseOrderLines: [{ id: 'manual', label: 'Café' }] } };
const fixtures = [
  { ...base, id: 'alpha', share_token: 'alpha', project_name: 'Stand Alpha', status: 'bat_pending', client_status: 'configured' },
  { ...base, id: 'signed', share_token: 'signed', project_name: 'Stand signé', status: 'validated', client_status: 'bat_validated', updated_at: '2026-10-18T08:00:00.000Z' },
  { ...base, id: 'beta', share_token: 'beta', project_name: 'Stand Beta', status: 'configured', client_status: 'configured', source_payload: { ...base.source_payload, exhibitor_view_only: false } },
  { ...base, id: 'draft', share_token: 'draft', project_name: 'Stand brouillon', status: 'created', client_status: 'draft' },
  { ...base, id: 'sent', share_token: 'sent', project_name: 'Stand envoyé', status: 'bat_pending', client_status: 'bat_review' },
];
const clients = [
  { id: 'alice', display_name: 'Alice Dupont', email: 'alice@example.test', company_name: 'Alpha', scenes: fixtures.slice(0, 2) },
  ...['beta', 'draft', 'sent'].map((id, index) => ({ id, display_name: ['Bruno Martin', 'Cécile Durand', 'Daniel Leroy'][index], company_name: id, scenes: fixtures.filter((scene) => scene.id === id) })),
];
const fakeClient = `
window.fakeDb=JSON.parse(sessionStorage.getItem('reopen-fixtures')||'null')||${JSON.stringify(fixtures)};
window.fakeWrites=[];window.fakeRole='admin';
export const supabase={from(table){if(table!=='scenes')throw Error('Unexpected write outside scenes: '+table);
 const filters={};let patch=null,columns='';const query={select(value){columns=value;return query},eq(key,value){filters[key]=value;return query},update(value){patch=value;return query},
 async single(){const row=window.fakeDb.find(scene=>scene.id===filters.id);if(!row)return{error:Error('Scène introuvable')};
  if(columns.includes('->'))return{data:{client_status:row.client_status,exhibitor_view_only:row.source_payload.exhibitor_view_only,exhibitor_view_only_updated_at:row.source_payload.exhibitor_view_only_updated_at}};return{data:structuredClone(row)};},
 async maybeSingle(){await new Promise(resolve=>setTimeout(resolve,150));const row=window.fakeDb.find(scene=>scene.id===filters.id);
  if(window.fakeRole!=='admin')return{error:Error('Seul un administrateur peut modifier le verrouillage de la scène.')};
  if(window.reopenConflict){window.reopenConflict=false;row.updated_at='2026-10-19T08:01:00.000Z';row.source_payload.serverEdit=true;}
  if(row.updated_at!==filters.updated_at)return{data:null};
  Object.assign(row,patch);window.fakeWrites.push(structuredClone(patch));sessionStorage.setItem('reopen-fixtures',JSON.stringify(window.fakeDb));return{data:structuredClone(row)};
 }};return query;}};`;
const harness = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AdminClientsView}from'/src/__reopen-app.jsx';
import{reopenSceneAsDraft}from'/src/data/sceneStore.js';import{useSceneExhibitorReadOnly}from'/src/useSceneExhibitorReadOnly.js';
const initialClients=${JSON.stringify(clients)};const staleScene=${JSON.stringify(fixtures[0])};
function ClientProbe({scene=staleScene,name='client-lock'}){const[workflow,setWorkflow]=useState('configured');const onReopen=React.useCallback(()=>setWorkflow('draft'),[]);const locked=useSceneExhibitorReadOnly(scene,false,false,onReopen);return <><output data-testid={name}>{locked?'Lecture seule':'Modification autorisée'}</output><output data-testid={name+'-workflow'}>{workflow}</output></>}
function Test(){const[scenes,setScenes]=useState(window.fakeDb),[clients,setClients]=useState(initialClients),[allowed,setAllowed]=useState(true),[filters,setFilters]=useState({search:'',salon:'',pack:'',status:''});
 const reopen=async(scene)=>{const updated=await reopenSceneAsDraft(scene);setScenes(rows=>rows.map(row=>row.id===updated.id?{...row,...updated}:row));setClients(rows=>rows.map(client=>({...client,scenes:client.scenes.map(row=>row.id===updated.id?{...row,...updated}:row)})));};
 return <><div style={{padding:12}}><ClientProbe/><ClientProbe scene={initialClients[1].scenes[0]} name="unlocked-client"/><button onClick={()=>setAllowed(false)}>Vue sans droits test</button><button onClick={()=>setAllowed(true)}>Vue admin test</button></div><AdminClientsView clients={clients} scenes={scenes} filters={filters} salonChoices={['SMCL 2026']} packChoices={['Prestige']} updateFilter={(key,value)=>setFilters(current=>({...current,[key]:value}))} onReopenScene={allowed?reopen:undefined}/></>;
}createRoot(document.getElementById('root')).render(<Test/>);`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'admin-scene-reopen-test',
  resolveId(id) { if (id === '/src/__reopen-app.jsx') return `${root}src/__reopen-app.jsx`; if (id === '/src/__reopen-page.jsx') return `${root}src/__reopen-page.jsx`; },
  load(id) {
    if (id === `${root}src/__reopen-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {AdminClientsView};');
    if (id === `${root}src/__reopen-page.jsx`) return harness;
    if (id === `${root}src/data/supabaseClient.js`) return fakeClient;
  },
  configureServer(vite) { vite.middlewares.use('/__scene-reopen-test__', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reopen-page.jsx"></script>'); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__scene-reopen-test__`);
  const row = (title) => page.locator('.admin-exhibitors-scene').filter({ has: page.locator('.admin-exhibitors-scene-title strong', { hasText: title }) });
  const alpha = row('Stand Alpha');
  await page.locator('summary').filter({ hasText: 'Alice Dupont' }).click();
  assert.equal(await page.getByRole('button', { name: 'Repasser en brouillon', exact: true, includeHidden: true }).count(), 2);
  for (const name of ['Stand signé', 'Stand brouillon', 'Stand envoyé']) assert.equal(await row(name).locator('.admin-exhibitors-reopen').count(), 0);
  assert.equal(await page.getByTestId('client-lock').innerText(), 'Lecture seule');
  const reopen = alpha.getByRole('button', { name: 'Repasser en brouillon', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await reopen.click();
  assert.equal(await page.evaluate(() => window.fakeWrites.length), 0);
  await page.evaluate(() => { window.fakeRole = 'exhibitor'; });
  page.once('dialog', (dialog) => dialog.accept()); await reopen.click();
  await page.getByRole('alert').filter({ hasText: 'Seul un administrateur' }).waitFor();
  assert.equal(await page.evaluate(() => window.fakeWrites.length), 0);
  await page.evaluate(() => { window.fakeRole = 'admin'; window.reopenConflict = true; });
  page.once('dialog', (dialog) => dialog.accept()); await reopen.click();
  await page.getByRole('alert').filter({ hasText: 'modifiée entre-temps' }).waitFor();
  page.once('dialog', (dialog) => dialog.accept()); await reopen.click();
  await page.getByRole('status').filter({ hasText: 'repassée en brouillon' }).waitFor();
  assert.equal(await alpha.locator('.admin-exhibitors-badge').innerText(), 'Brouillon');
  assert.equal(await alpha.locator('.admin-exhibitors-reopen').count(), 0);
  const updated = await page.evaluate(() => window.fakeDb.find((scene) => scene.id === 'alpha'));
  assert.equal(updated.status, 'created'); assert.equal(updated.client_status, 'draft');
  assert.equal(updated.source_payload.exhibitor_view_only, false);
  assert.equal(updated.source_payload.serverEdit, true);
  assert.deepEqual(updated.items, fixtures[0].items); assert.deepEqual(updated.files, fixtures[0].files);
  assert.deepEqual(updated.source_payload.options, fixtures[0].source_payload.options);
  assert.deepEqual(updated.source_payload.manualPurchaseOrderLines, fixtures[0].source_payload.manualPurchaseOrderLines);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByTestId('client-lock').filter({ hasText: 'Modification autorisée' }).waitFor();
  assert.equal(await page.getByTestId('client-lock-workflow').innerText(), 'draft');
  await page.getByRole('button', { name: /^BAT à valider ·/ }).click();
  assert.equal(await page.locator('summary').filter({ hasText: 'Alice Dupont' }).count(), 0);
  assert.equal(await page.locator('summary').filter({ hasText: 'Bruno Martin' }).count(), 1);
  await page.getByRole('button', { name: /^Brouillons ·/ }).click();
  assert.equal(await page.locator('summary').filter({ hasText: 'Alice Dupont' }).count(), 1);
  await page.getByRole('button', { name: /^Tous ·/ }).click();
  await page.locator('summary').filter({ hasText: 'Bruno Martin' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await row('Stand Beta').getByRole('button', { name: 'Repasser en brouillon' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/standing-scene-reopen-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Vue sans droits test' }).click();
  assert.equal(await page.locator('.admin-exhibitors-reopen').count(), 0);
  await page.getByRole('button', { name: 'Vue admin test' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await row('Stand Beta').getByRole('button', { name: 'Repasser en brouillon' }).click();
  await page.getByRole('status').filter({ hasText: 'Stand Beta est repassée' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByTestId('unlocked-client-workflow').filter({ hasText: 'draft' }).waitFor();
  await page.reload();
  await page.locator('summary').filter({ hasText: 'Alice Dupont' }).click();
  assert.equal(await alpha.locator('.admin-exhibitors-badge').innerText(), 'Brouillon');
  assert.deepEqual(errors, []);
  console.log('Admin exhibitors: per-scene reopen, confirmation/cancel, permission/concurrency errors, draft badges/tabs, persisted content, exhibitor unlock, reload and mobile OK');
} finally { await browser?.close(); await server.close(); }
