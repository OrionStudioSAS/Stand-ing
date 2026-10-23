import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const urls = store.slice(store.indexOf('const defaultPublicAppUrl ='), store.indexOf('function dbClientToClient('))
  .replaceAll('export function ', 'function ')
  .replace('import.meta.env.VITE_PUBLIC_APP_URL', 'configuredUrl');
const production = 'https://configurateur3d.stand-ing.com';
function api(origin, configuredUrl = production) {
  const context = vm.createContext({ configuredUrl, ...(origin ? { window: { location: { origin } } } : {}) });
  vm.runInContext(urls, context);
  return context;
}

test('scene links stay on the current environment despite production environment variables', () => {
  for (const origin of ['https://stand-ing.vercel.app', 'https://stand-ing-git-test.vercel.app', 'http://localhost:5173', production]) {
    const context = api(origin);
    assert.equal(context.publicConfiguratorUrl(), origin);
    assert.equal(context.sceneShareUrl({ share_token: 'token /+?é' }), `${origin}/?scene=token%20%2F%2B%3F%C3%A9`);
  }
});

test('URL generation without a browser retains configured and production fallbacks', () => {
  assert.equal(api(undefined, 'https://preview.example.test///').publicConfiguratorUrl(), 'https://preview.example.test');
  assert.equal(api(undefined, '').publicConfiguratorUrl(), production);
});

test('test deployments no longer redirect to the production domain', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal((config.redirects || []).length, 0);
  assert.ok(config.rewrites.some(rule => rule.source === '/admin' && rule.destination === '/index.html'));
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /legacyConfiguratorRedirectUrl|LegacyDomainRedirect/);
});
