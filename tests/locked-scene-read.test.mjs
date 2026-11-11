import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const source = ['getSceneByToken', 'readLockedConfiguratorScene', 'getSceneExhibitorState'].map((name) => {
  const start = store.indexOf(`async function ${name}(`);
  return store.slice(start, store.indexOf('\n}\n', start) + 2);
}).join('\n');

function mock(direct, fallback) {
  const calls = [];
  const api = vm.createContext({
    dbSceneToScene: row => row,
    supabase: {
      from(table) {
        assert.equal(table, 'scenes');
        return { select() { return this; }, eq() { return this; }, maybeSingle: async () => direct };
      },
      async rpc(name, selector) {
        assert.equal(name, 'read_locked_configurator_scene');
        calls.push({ ...selector });
        return fallback;
      },
    },
  });
  vm.runInContext(source, api);
  return { api, calls };
}

test('draft or staff lookup uses direct access; locked exhibitor falls back to read-only scene and status', async () => {
  const locked = { status: 'configured', client_status: 'configured', scene_items: [{ item_uid: 'chair' }] };
  const draft = { ...locked, status: 'created', client_status: 'draft' };
  const direct = mock({ data: draft }, null);
  assert.equal(await direct.api.getSceneByToken('token'), draft);
  assert.deepEqual(direct.calls, []);
  const readOnly = mock({ data: null }, { data: locked });
  assert.equal(await readOnly.api.getSceneByToken('token'), locked);
  assert.equal((await readOnly.api.getSceneExhibitorState({ id: 'scene' })).clientStatus, 'configured');
  assert.deepEqual(readOnly.calls, [{ p_share_token: 'token' }, { p_scene_id: 'scene' }]);
});

test('before migration or after revocation, inaccessible scenes never return a configuration', async () => {
  for (const result of [{ data: null }, { error: { code: 'PGRST202' } }]) {
    const { api } = mock({ data: null }, result);
    await assert.rejects(api.getSceneByToken('token'), { code: 'PGRST116' });
  }
});
