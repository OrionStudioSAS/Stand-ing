import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/useSceneExhibitorReadOnly.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261007115000_lock_resolved_request_scenes.sql', import.meta.url), 'utf8');
const serviceRoleFix = readFileSync(new URL('../supabase/migrations/20261008082556_fix_scene_lock_service_role_checks.sql', import.meta.url), 'utf8');

function load(api, name) {
  let start = store.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (store.slice(start - 6, start) === 'async ') start -= 6;
  vm.runInContext(store.slice(start, store.indexOf('\n}\n', start) + 2), api);
}

for (const remote of [false, true]) {
  test(`marking a request treated also locks the client without discarding newer scene fields (${remote ? 'Supabase' : 'local'})`, async () => {
    let scene = { id: 'test', source_payload: { specialRequest: 'Latest request', options: { carpet: 'blue' }, manualPurchaseOrderLines: [{ id: 'item', label: 'Coffee' }] } };
    const api = vm.createContext({
      readLocalScenes: () => [scene], writeLocalScenes: (rows) => { scene = rows[0]; },
      supabase: remote ? { from(table) {
        assert.equal(table, 'scenes');
        return {
          select() { return { eq(field, id) { assert.equal(id, scene.id); return { single: async () => ({ data: scene, error: null }) }; } }; },
          update(payload) { return { eq: async () => { scene = { ...scene, ...payload }; return { error: null }; } }; },
        };
      } } : null,
    });
    load(api, 'markSceneSpecialRequestResolved');
    load(api, 'preserveSceneReadOnly');
    const updated = await api.markSceneSpecialRequestResolved({ id: 'test', source_payload: { specialRequest: { text: 'Stale request' } } });
    assert.equal(updated.status, 'configured');
    assert.equal(updated.client_status, 'configured');
    assert.equal(updated.source_payload.specialRequest.status, 'resolved');
    assert.equal(updated.source_payload.specialRequest.text, 'Latest request');
    assert.equal(updated.source_payload.exhibitor_view_only, true);
    assert.equal(updated.source_payload.exhibitor_view_only_updated_at, updated.source_payload.specialRequest.resolvedAt);
    assert.equal(updated.source_payload.options.carpet, 'blue');
    assert.equal(updated.source_payload.manualPurchaseOrderLines[0].label, 'Coffee');
    const staleSave = api.preserveSceneReadOnly({ source_payload: { options: { carpet: 'red' }, exhibitor_view_only: false } }, scene.source_payload);
    assert.equal(staleSave.source_payload.exhibitor_view_only, true);
    assert.equal(staleSave.source_payload.options.carpet, 'red');
    assert.equal(api.preserveSceneReadOnly(updated, { exhibitor_view_only: false }).source_payload.exhibitor_view_only, false);
  });
}

test('locking fails atomically if the database rejects the scene update', async () => {
  const error = new Error('Forbidden');
  const api = vm.createContext({ supabase: { from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: { source_payload: {} }, error: null }) }) }),
    update: () => ({ eq: async () => ({ error }) }),
  }) } });
  load(api, 'markSceneSpecialRequestResolved');
  await assert.rejects(api.markSceneSpecialRequestResolved({ id: 'test' }), error);
});

test('read-only hook respects admin editing, forced previews and initial client lock', () => {
  for (const [isAdmin, forced, locked, expected] of [[false, false, true, true], [true, false, true, false], [true, true, true, true], [false, false, false, false]]) {
    const api = vm.createContext({ useState: (value) => [value, () => {}], useEffect: () => {} });
    vm.runInContext(hook.slice(hook.indexOf('export function')).replace('export function', 'function'), api);
    assert.equal(api.useSceneExhibitorReadOnly({ id: 'test', source_payload: { exhibitor_view_only: locked } }, isAdmin, forced), expected);
  }
  assert.match(hook, /setInterval\(refresh, 15000\)/);
  assert.match(hook, /removeEventListener\('focus', refresh\)/);
});

test('database guards cover parent updates and all child mutations without granting elevated privileges', () => {
  assert.equal((migration.match(/security invoker/g) || []).length, 2);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /old\.source_payload->>'exhibitor_view_only' = 'true'/);
  assert.match(migration, /is distinct from new\.source_payload->'exhibitor_view_only'/);
  assert.match(migration, /before update on public\.scenes/);
  assert.match(migration, /before insert or update or delete on public\.scene_items/);
  assert.match(migration, /before insert or update or delete on public\.scene_files/);
  assert.match(migration, /private\.is_admin\(\)/);
});

test('backend roles return before private admin checks are planned, without widening permissions', () => {
  assert.equal((serviceRoleFix.match(/security invoker/g) || []).length, 2);
  assert.doesNotMatch(serviceRoleFix, /security definer|grant /i);
  assert.equal((serviceRoleFix.match(/if current_user in \('postgres', 'service_role', 'supabase_admin'\) then/g) || []).length, 2);
  assert.match(serviceRoleFix, /return new;\s+end if;\s+if \(select private\.is_admin\(\)\) then/);
  assert.match(serviceRoleFix, /if tg_op = 'DELETE' then return old; end if;\s+return new;\s+end if;\s+if \(select private\.is_admin\(\)\) then/);
  assert.match(serviceRoleFix, /old\.source_payload->>'exhibitor_view_only' = 'true'/);
  assert.match(serviceRoleFix, /order by id for share/);
  assert.match(serviceRoleFix, /Seul un administrateur peut modifier le verrouillage/);
});
