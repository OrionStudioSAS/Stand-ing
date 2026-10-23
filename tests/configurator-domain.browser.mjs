import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const origin = 'https://stand-ing.vercel.app';
const fixture = { id: 'domain-scene', share_token: 'test-domain-token', project_name: 'Scène de test', offer: 'Signature', status: 'created', client_status: 'draft', dimensions: { width: 5, depth: 4 }, source_payload: {} };
const harness = `import React from'react';import{createRoot}from'react-dom/client';import{App,AdminClientsView}from'/src/__domain-app.jsx';
const scene=${JSON.stringify(fixture)};
createRoot(document.getElementById('root')).render(location.pathname==='/__domain_links__'?<AdminClientsView clients={[{id:'exhibitor',display_name:'Exposant test',company_name:'Société test',scenes:[scene]}]} scenes={[scene]} filters={{search:'',salon:'',pack:'',status:''}} salonChoices={[]} packChoices={[]} updateFilter={()=>{}}/>:<App/>);`;
const server = await createServer({
  logLevel: 'error',
  define: { 'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify('https://configurateur3d.stand-ing.com') },
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'configurator-domain-test',
    resolveId(id) {
      if (id === '/src/__domain-app.jsx') return `${root}src/__domain-app.jsx`;
      if (id === '/src/__domain-page.jsx') return `${root}src/__domain-page.jsx`;
    },
    load(id) {
      if (id === `${root}src/__domain-app.jsx`) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {App,AdminClientsView};');
      if (id === `${root}src/__domain-page.jsx`) return harness;
      if (id === `${root}src/data/supabaseClient.js`) return 'export const supabase=null;';
      if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?domain-original';export async function getSceneByToken(){return new Promise(()=>{});}`;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!['/', '/admin', '/__domain_links__'].includes(req.url.split('?')[0])) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__domain-page.jsx"></script>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const errors = [], productionRequests = [];
  context.on('page', page => page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); }));
  await context.route(`${origin}/**`, async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `http://127.0.0.1:${server.httpServer.address().port}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await context.route('https://configurateur3d.stand-ing.com/**', async route => {
    productionRequests.push(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();
  for (const path of ['/', '/admin']) {
    await page.goto(`${origin}${path}`);
    await page.locator('.admin-login-shell').waitFor().catch(async error => {
      console.error(page.url(), await page.locator('body').innerText());
      throw error;
    });
    assert.equal(page.url(), `${origin}${path}`);
  }
  await page.goto(`${origin}/__domain_links__`);
  await page.locator('summary').filter({ hasText: 'Exposant test' }).click();
  const view = page.getByRole('link', { name: 'Voir la scène', exact: true });
  assert.equal(await view.getAttribute('href'), `${origin}/?scene=${fixture.share_token}`);
  const [popup] = await Promise.all([page.waitForEvent('popup'), view.click()]);
  await popup.getByText('Chargement de la scene...', { exact: true }).waitFor();
  assert.equal(popup.url(), `${origin}/?scene=${fixture.share_token}`);
  assert.deepEqual(productionRequests, []);
  assert.deepEqual(errors, []);
  console.log('Development domain: home/admin do not redirect, real exhibitor scene link and popup stay on stand-ing.vercel.app despite production env URL, no production requests OK');
} finally {
  await browser?.close();
  await server.close();
}
