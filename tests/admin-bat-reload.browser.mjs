import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__admin-bat-reload-app.jsx');
const pageId = resolve('src/__admin-bat-reload-page.jsx');
const appSource = await readFile('src/App.jsx', 'utf8');
const picto = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" fill="#333"/></svg>');
const asset = { type: 'asset-bat-reload', label: 'Picto de test', is_active: true, dimensions: { size: [.6, 1, .6], packs: ['Confort'], batPictoUrl: picto } };
const target = { id: 'scene-reload', share_token: 'target-link', client_name: 'Équipe test', project_name: 'Stand à rouvrir', layout: 'back',
  offer: 'Confort', dimensions: { width: 5, depth: 4 }, source_payload: {} };
const other = { ...target, id: 'other', share_token: 'other-link', project_name: 'Autre stand', items: [] };
const fixtures = `
export * from '/src/data/sceneStore.js?bat-reload-original';
const target = ${JSON.stringify(target)}, other = ${JSON.stringify(other)}, asset = ${JSON.stringify(asset)};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function listScenes() { await wait(100); return [other]; }
export async function listClients() { await wait(180); return [{ id:'test-client', company_name:'ROZO exemple', display_name:target.client_name, scenes:[target, other] }]; }
export async function listObjectBank() { await wait(320); return [asset]; }
export async function getSceneByToken(token) {
  if (token !== target.share_token) throw new Error('Mauvaise scène');
  return { ...target, items: [{ id:'reload-picto', type:asset.type, x:0, z:0 }] };
}
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'admin-bat-reload',
  resolveId(id) {
    if (id === '/src/__admin-bat-reload-app.jsx') return appId;
    if (id === '/src/__admin-bat-reload-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return appSource.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { AdminDashboard };');
    if (id === pageId) return `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { AdminDashboard } from '/src/__admin-bat-reload-app.jsx';
      createRoot(document.getElementById('root')).render(<AdminDashboard user={{ id:'admin-test', email:'admin@example.test' }} adminProfile={{ role_label:'admin' }} />);`;
    if (id === resolve('src/data/supabaseClient.js')) return 'export const supabase=null;';
    if (id === resolve('src/data/sceneStore.js')) return fixtures;
  },
  configureServer(vite) {
    vite.middlewares.use('/admin', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__admin-bat-reload-page.jsx"></script>');
    });
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/admin`);
  await page.getByRole('navigation', { name: 'Navigation admin' }).getByRole('button', { name: 'Exposants' }).click();
  await page.getByRole('textbox', { name: 'Rechercher un exposant' }).fill('ROZO exemple');
  await page.locator('.admin-exhibitors-entry > summary').click();
  await page.getByRole('button', { name: 'Ouvrir la fiche exposant' }).click();
  await page.locator('.admin-exhibitors-profile-scene').filter({ hasText: target.project_name }).getByRole('button', { name: 'Modifier le BAT' }).click();
  const editor = page.getByRole('dialog', { name: 'Éditeur du BAT' });
  await editor.getByRole('heading', { name: target.project_name }).waitFor();
  await editor.getByRole('button', { name: 'Ajouter une annotation' }).click();
  await editor.getByLabel("Texte de l'annotation").fill('Annotation avant actualisation');
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await editor.getByText('BAT enregistré.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => history.state.adminBatSceneId), target.id);
  await page.evaluate(() => localStorage.setItem('standing-admin-active-tab', 'salons'));
  await page.reload();
  await editor.getByRole('heading', { name: target.project_name }).waitFor();
  await editor.getByText('Annotation avant actualisation', { exact: true }).waitFor();
  await editor.locator('[data-bat-id="reload-picto"] svg').waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('textbox', { name: 'Rechercher un exposant' }).inputValue(), '', 'No need to restore or re-enter the search');
  await editor.getByRole('button', { name: "Fermer l'éditeur BAT" }).click();
  assert.equal(await page.evaluate(() => history.state.adminBatSceneId), undefined);
  await page.reload();
  await page.getByRole('heading', { name: 'Salons', exact: true }).first().waitFor();
  assert.equal(await editor.count(), 0);

  await page.evaluate(() => history.replaceState({ ...history.state, adminBatSceneId: 'deleted-scene' }, ''));
  await page.reload();
  await page.getByRole('alert').getByText('Cette scène est introuvable ou son BAT ne peut pas être chargé.').waitFor();
  assert.equal(await page.evaluate(() => history.state.adminBatSceneId), undefined, 'A stale link never opens a different scene');
  assert.equal(await editor.count(), 0);
  assert.deepEqual(errors, []);
  console.log('Admin BAT: reload reopens the exact exhibitor document with its saved edits and assets; closing and missing scenes clear the restore state');
} finally {
  await browser?.close();
  await server.close();
}
