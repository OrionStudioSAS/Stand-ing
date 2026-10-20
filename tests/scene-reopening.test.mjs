import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { canReopenSceneAsDraft, sceneDraftPatch } from '../src/sceneReopening.js';

const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const fixture = () => ({ id: 'pending', status: 'bat_pending', client_status: 'configured', updated_at: '2026-10-19T08:00:00.000Z',
  items: [{ id: 'custom-reserve', children: [{ x: 0.25, z: -0.5 }] }], files: [{ id: 'artwork.svg' }],
  source_payload: { exhibitor_view_only: true, specialRequest: { text: 'Un réfrigérateur', status: 'resolved' },
    options: { reserveOptionType: 'manual-reserve', wallCovers: { back: { imageUrl: '/artwork.svg' } } },
    manualPurchaseOrderLines: [{ id: 'extra', label: 'Réfrigérateur' }], pricing: { total: 225 } } });

function runtime({ remote = true, readError = null, writeError = null, conflict = false } = {}) {
  let current = fixture();
  let writes = 0;
  const context = vm.createContext({ sceneDraftPatch,
    readLocalScenes: () => [current], writeLocalScenes: (rows) => { writes += 1; current = rows[0]; },
    supabase: remote ? { from(table) {
      assert.equal(table, 'scenes', 'Reopening must never rewrite scene items or files');
      return {
        select(columns) { assert.equal(columns, 'status,client_status,source_payload,updated_at'); return { eq(key, value) {
          assert.equal(key, 'id'); assert.equal(value, current.id);
          return { single: async () => ({ data: structuredClone(current), error: readError }) };
        } }; },
        update(patch) {
          const filters = {};
          const query = {
            eq(key, value) { filters[key] = value; return query; }, select() { return query; },
            async maybeSingle() {
              if (writeError) return { error: writeError };
              if (conflict) current = { ...current, updated_at: '2026-10-19T08:01:00.000Z', source_payload: { ...current.source_payload, latestChange: true } };
              if (filters.id !== current.id || filters.updated_at !== current.updated_at) return { data: null };
              writes += 1; current = { ...current, ...patch }; return { data: structuredClone(current) };
            },
          };
          return query;
        },
      };
    } } : null,
  });
  const start = store.indexOf('async function reopenSceneAsDraft(');
  vm.runInContext(store.slice(start, store.indexOf('\n}\n', start) + 2), context);
  return { context, current: () => current, writes: () => writes, replace: (value) => { current = value; } };
}

test('Only scenes awaiting BAT approval can be reopened, never drafts, sent/signed BATs or archived scenes', () => {
  for (const scene of [{ status: 'configured' }, { status: 'bat_pending' }, { client_status: 'configured' }]) assert.equal(canReopenSceneAsDraft(scene), true);
  for (const scene of [{}, { status: 'created', client_status: 'draft' }, { status: 'archived', client_status: 'configured' },
    { status: 'validated', client_status: 'configured' }, { status: 'configured', client_status: 'bat_validated' },
    { status: 'bat_pending', client_status: 'bat_review' },
    ...['BAT signé', 'validated', 'Envoyé', 'Correction demandée'].map((status) => ({ status: 'configured', source_payload: { bat: { status } } }))]) {
    assert.equal(canReopenSceneAsDraft(scene), false, JSON.stringify(scene));
  }
});

for (const remote of [false, true]) {
  test(`Reopening uses the latest persisted scene and removes its exhibitor lock without touching configuration (${remote ? 'Supabase' : 'local'})`, async () => {
    const api = runtime({ remote });
    const before = structuredClone(api.current());
    const updated = await api.context.reopenSceneAsDraft({ id: before.id, source_payload: { options: { stale: true } } });
    assert.equal(updated.status, 'created');
    assert.equal(updated.client_status, 'draft');
    assert.equal(updated.source_payload.exhibitor_view_only, false);
    assert.equal(updated.source_payload.exhibitor_view_only_updated_at, updated.updated_at);
    for (const field of ['options', 'manualPurchaseOrderLines', 'pricing', 'specialRequest']) {
      assert.deepEqual(updated.source_payload[field], before.source_payload[field]);
    }
    assert.deepEqual(api.current().items, before.items);
    assert.deepEqual(api.current().files, before.files);
    assert.equal(api.writes(), 1);
    assert.equal(canReopenSceneAsDraft(updated), false);
  });
}

test('A newly signed BAT or a concurrent edit is never overwritten from a stale directory entry', async () => {
  const signed = runtime();
  signed.replace({ ...signed.current(), client_status: 'bat_validated', status: 'validated' });
  await assert.rejects(signed.context.reopenSceneAsDraft({ id: 'pending', client_status: 'configured' }), /Seule une scène/);
  assert.equal(signed.writes(), 0);
  const edited = runtime({ conflict: true });
  await assert.rejects(edited.context.reopenSceneAsDraft({ id: 'pending' }), /modifiée entre-temps/);
  assert.equal(edited.writes(), 0);
  assert.equal(edited.current().source_payload.latestChange, true);
});

test('Permission and network failures leave the scene locked and propagate to the admin', async () => {
  for (const failure of ['readError', 'writeError']) {
    const error = new Error('Accès refusé');
    const api = runtime({ [failure]: error });
    await assert.rejects(api.context.reopenSceneAsDraft({ id: 'pending' }), error);
    assert.equal(api.writes(), 0);
    assert.equal(api.current().source_payload.exhibitor_view_only, true);
  }
  const api = runtime();
  await assert.rejects(api.context.reopenSceneAsDraft({}), /introuvable/);
});

test('Returning to draft is exposed on individual exhibitor scenes, with confirmation and all admin lists refreshed', () => {
  assert.match(app, /onReopenScene=\{reopenAdminScene\}/);
  assert.match(app, /onReopenScene && canReopenSceneAsDraft\(scene\)/);
  assert.match(app, /window\.confirm\(`Repasser/);
  const action = app.slice(app.indexOf('  const reopenAdminScene ='), app.indexOf('  const deleteAdminUser ='));
  assert.match(action, /reopenSceneAsDraft\(scene\)/);
  assert.match(action, /setScenes/);
  assert.match(action, /setClients/);
  assert.match(action, /refreshScenes\(\), refreshClients\(\), refreshSalons\(\), refreshAdminAudit\(\)/);
  assert.doesNotMatch(action, /syncMonday|send.*Email|saveScene\(/);
});
