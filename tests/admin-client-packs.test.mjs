import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');

function loadFunction(source, api, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

test('exhibitors can be filtered and summarized by pack', () => {
  const store = vm.createContext({});
  loadFunction(storeSource, store, 'filterClients');
  loadFunction(storeSource, store, 'filterScenes');

  const clients = [
    { id: 'a', scenes: [{ salon: 'SMCL 2026', offer: 'Confort', status: 'created' }] },
    { id: 'b', scenes: [{ salon: 'SMCL 2026', offer: 'Prestige', status: 'configured' }] },
    { id: 'c', scenes: [{ salon: 'SITL 2027', offer: 'Signature', status: 'created' }] },
  ];

  assert.deepEqual(store.filterClients(clients, { pack: 'Prestige' }).map((client) => client.id), ['b']);
  assert.deepEqual(store.filterScenes(clients.flatMap((client) => client.scenes), { pack: 'signature' }).map((scene) => scene.offer), ['Signature']);

  const app = vm.createContext({});
  for (const name of ['normalizeTextValue', 'packNameSort', 'uniqueByNormalized', 'clientPackSummary']) {
    loadFunction(appSource, app, name);
  }
  assert.equal(app.clientPackSummary({ scenes: [{ offer: 'Prestige' }, { offer: 'Confort' }, { offer: 'Prestige' }] }), 'Confort, Prestige');
});
