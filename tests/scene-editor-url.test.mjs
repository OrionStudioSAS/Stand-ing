import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const publicUrl = 'https://configurateur3d.stand-ing.com';
const scene = { share_token: 'labosport-test' };

function urlApi(origin) {
  const api = vm.createContext({
    defaultPublicAppUrl: publicUrl,
    configuredPublicUrl: publicUrl,
    ...(origin === undefined ? {} : { window: { location: { origin } } }),
  });
  for (const name of ['publicConfiguratorUrl', 'sceneShareUrl', 'sceneEditorUrl']) {
    const start = store.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, name);
    vm.runInContext(store.slice(start, store.indexOf('\n}', start) + 2)
      .replace('export function', 'function')
      .replace('import.meta.env.VITE_PUBLIC_APP_URL', 'configuredPublicUrl'), api);
  }
  return api;
}

test('opening a scene from the local admin preserves its exact host and port', () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5174', 'http://[::1]:5173']) {
    const api = urlApi(origin);
    assert.equal(api.sceneEditorUrl(scene), `${origin}/?scene=labosport-test`);
    assert.equal(api.sceneShareUrl(scene), `${publicUrl}/?scene=labosport-test`);
  }
});

test('reserve branch previews open scenes on the same preview, not production', () => {
  const origin = 'https://stand-ing-git-reserve-orionstudiosas-projects.vercel.app';
  const api = urlApi(origin);
  assert.equal(api.sceneEditorUrl(scene), `${origin}/?scene=labosport-test`);
  assert.equal(api.sceneShareUrl(scene), `${publicUrl}/?scene=labosport-test`);
});

test('production admin continues opening scenes on production', () => {
  assert.equal(urlApi(publicUrl).sceneEditorUrl(scene), `${publicUrl}/?scene=labosport-test`);
});

test('scene tokens remain encoded instead of becoming query parameters or fragments', () => {
  const api = urlApi('http://localhost:5173/');
  const tokenScene = { share_token: 'a&admin=1 #/test' };
  assert.equal(api.sceneEditorUrl(tokenScene), 'http://localhost:5173/?scene=a%26admin%3D1%20%23%2Ftest');
  assert.equal(api.sceneShareUrl(tokenScene), `${publicUrl}/?scene=a%26admin%3D1%20%23%2Ftest`);
});

test('outside a browser or with an opaque origin, editor links use the public fallback', () => {
  for (const origin of [undefined, '', 'null']) {
    assert.equal(urlApi(origin).sceneEditorUrl(scene), `${publicUrl}/?scene=labosport-test`);
  }
});

test('admin open links use the current environment while client message links stay public', () => {
  assert.doesNotMatch(app, /href=\{sceneShareUrl\(scene\)\}/);
  assert.ok([...app.matchAll(/href=\{sceneEditorUrl\(scene\)\}/g)].length >= 9);
  assert.ok([...app.matchAll(/sceneUrl: sceneShareUrl\(initialScene\)/g)].length >= 2);
});
