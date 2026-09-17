import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const edgeSource = readFileSync(new URL('../supabase/functions/monday-sync/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const compiled = transformSync(edgeSource, { loader: 'ts', format: 'cjs' }).code;

function runtime(fetch = () => { throw new Error('Unexpected network request'); }) {
  const context = vm.createContext({ Deno: { serve() {} }, fetch, console });
  vm.runInContext(compiled, context);
  return context;
}

const columns = [
  { id: 'email', title: 'E MAIL', type: 'email' },
  { id: 'statut86', title: 'CONFIGURABLE', type: 'status' },
  { id: 'statut464', title: 'ETAPE 1', type: 'status' },
  { id: 'layout_signature', title: 'IMPLANTATION', type: 'status' },
  { id: 'link_signature', title: 'LIEN CONFIGURATEUR', type: 'link' },
  { id: 'texte38', title: 'RAISON SOCIALE', type: 'text' },
  { id: 'phone', title: 'TEL', type: 'phone' },
];

test('a shared pack board only imports the groups of its configured salon', () => {
  const api = runtime();
  const items = [
    { id: 'sitl', group: { id: 'sitl', title: 'SITL 2027' } },
    { id: 'smcl', group: { id: 'smcl', title: ' SMCL 2026 ' } },
    { id: 'smcl2', group: { id: 'smcl2', title: 'smcl 2026' } },
    { id: 'database', group: { id: 'database', title: 'BASE DE DONNEE' } },
  ];
  const source = { salon: 'SMCL 2026', group_id: 'smcl', mapping: { salon_from_group: true } };
  assert.equal(JSON.stringify(api.filterMondaySourceItems(items, source).map(item => item.id)), JSON.stringify(['smcl', 'smcl2']));
  assert.equal(api.filterMondaySourceItems(items, { ...source, salon: 'Unknown' }).length, 0);
  assert.equal(api.filterMondaySourceItems(items, { mapping: {} }).length, 4);
  assert.equal(api.filterMondaySourceItems(items, { group_id: 'sitl' })[0].id, 'sitl');
});

test('Signature columns override old board IDs and keep company and phone data', () => {
  const api = runtime();
  const source = api.withResolvedMondayColumns({ create_column_id: 'old', status_column_id: 'old', link_column_id: 'old', mapping: { layout: 'old' } }, columns);
  assert.equal(source.create_column_id, 'statut86');
  assert.equal(source.status_column_id, 'statut464');
  assert.equal(source.link_column_id, 'link_signature');
  assert.equal(source.mapping.layout, 'layout_signature');
  assert.equal(source.mapping.company_name, 'texte38');
  assert.equal(source.mapping.client_phone, 'phone');
});

test('scene metadata preserves the actual Monday group and correct salon/pack', () => {
  const api = runtime();
  const item = { id: 'test', name: 'TEST stand', group: { id: 'sitl_group', title: 'SITL 2027' }, column_values: [] };
  const source = { board_id: 'signature_board', offer: 'Signature', group_id: null, mapping: {} };
  const context = { salonLabel: 'SITL 2027', salonId: 'salon', offerId: 'offer' };
  const scene = api.mapMondayItemToScene(item, source, undefined, undefined, context, 'back');
  assert.equal(scene.monday_group_id, 'sitl_group');
  assert.equal(scene.salon, 'SITL 2027');
  assert.equal(scene.offer, 'Signature');
  assert.equal(scene.layout, 'back');
});

test('pagination also reads stands beyond the first 100 items', async () => {
  const queries = [];
  const api = runtime(async (_url, request) => {
    const body = JSON.parse(request.body);
    queries.push(body);
    if (body.variables.cursor) return { ok: true, json: async () => ({ data: { next_items_page: { cursor: null, items: [{ id: '101', group: { id: 'target' } }] } } }) };
    return { ok: true, json: async () => ({ data: { boards: [{ items_page: { cursor: 'next', items: Array.from({ length: 100 }, (_, id) => ({ id: String(id), group: { id: 'other' } })) } }] } }) };
  });
  const items = await api.fetchMondayItems('test-token', 'test-board', 'target');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, '101');
  assert.equal(queries.length, 2);
  assert.equal(queries[1].variables.cursor, 'next');
});

test('Monday API errors are reported instead of pretending the board is empty', async () => {
  const api = runtime(async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Board access denied' }] }) }));
  await assert.rejects(api.fetchMondayItems('test-token', 'board'), /Board access denied/);
});

test('board preparation does not duplicate the required columns', async () => {
  const api = runtime(async (_url, request) => {
    assert.ok(!JSON.parse(request.body).query.includes('mutation'));
    return { ok: true, json: async () => ({ data: { boards: [{ id: 'test', columns }] } }) };
  });
  const result = await api.prepareMondayBoard('test-token', 'test-board');
  assert.equal(result.created.length, 0);
});
