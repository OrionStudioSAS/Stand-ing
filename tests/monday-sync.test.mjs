import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { normalizePackBenefits, packBenefitsForScene, isSignaturePackScene } from '../supabase/functions/_shared/packBenefits.js';

const edgeSource = readFileSync(new URL('../supabase/functions/monday-sync/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const compiled = transformSync(edgeSource, { loader: 'ts', format: 'cjs' }).code;

function requestHandler(sourceError = null) {
  let handler;
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }) },
    from(table) {
      if (table === 'admin_users') return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { user_id: 'admin' } }) };
      if (table === 'monday_sources') return { select() { return this; }, async eq() {
        if (sourceError) throw sourceError;
        return { data: [], error: null };
      } };
      if (table === 'monday_sync_runs') return { insert: async () => ({ error: null }) };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const context = vm.createContext({
    Deno: { serve(value) { handler = value; }, env: { get: (key) => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', MONDAY_API_TOKEN: 'test-monday-token' }[key]) } },
    createClient: () => database, Response, console: { error() {} },
    normalizePackBenefits, packBenefitsForScene, isSignaturePackScene,
  });
  vm.runInContext(compiled, context);
  return { handler, database };
}

test('Monday preflight and successful synchronization return browser-readable responses', async () => {
  const { handler } = requestHandler();
  const preflight = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  const success = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: '{}' }));
  assert.equal(success.status, 200);
  assert.equal((await success.json()).processed, 0);
});

test('Monday unexpected database and network failures retain JSON and CORS instead of masking the cause', async () => {
  for (const error of [{ code: '42501', message: 'permission denied for schema private' }, new Error('Monday unavailable')]) {
    const { handler } = requestHandler(error);
    const response = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: '{}' }));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal((await response.json()).error, `Synchronisation Monday impossible : ${error.message}`);
  }
});

test('Monday authentication remains required and rejected requests retain CORS', async () => {
  const { handler, database } = requestHandler();
  database.auth.getUser = async () => ({ data: { user: null }, error: new Error('Unauthorized') });
  const response = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await response.json()).error, 'Unauthorized');
});

function runtime(fetch = () => { throw new Error('Unexpected network request'); }) {
  const context = vm.createContext({ Deno: { serve() {} }, fetch, console, normalizePackBenefits, packBenefitsForScene, isSignaturePackScene });
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

test('Monday fetches the configurable allowance without base quotas; other packs keep their included objects', async () => {
  const api = runtime();
  for (const mode of ['allowance', 'included-items']) {
    const database = { from(table) {
      assert.equal(table, 'salon_offers');
      return { select() { return this; }, eq() { return this; }, async maybeSingle() {
        return { data: { metadata: { baseItems: [{ type: 'desk', quantity: 1 }], packBenefits: { mode, allowanceAmount: 1500 } } } };
      } };
    } };
    const config = await api.fetchOfferPackConfiguration(database, 'offer');
    assert.equal(config.packBenefits.allowanceAmount, 1500);
    assert.equal(config.baseItems.length, mode === 'allowance' ? 0 : 1);
  }
  const withoutOffer = await api.fetchOfferPackConfiguration({}, null);
  assert.equal(withoutOffer.packBenefits.mode, 'included-items');
});

test('Monday Signature scene dimensions determine the allowance even when the pack still stores 1600 euros', () => {
  const api = runtime();
  const scene = api.mapMondayItemToScene({ id: 'signature-stand', name: 'Exposant', column_values: [] },
    { board_id: 'board', salon: 'SITL', offer: 'Signature', mapping: {} }, null, null,
    { salonLabel: 'SITL', salonId: 'salon', offerId: 'offer' });
  assert.equal(scene.offer, 'Signature');
  const benefits = packBenefitsForScene({ ...scene, width_m: 5, depth_m: 4 }, { mode: 'allowance', allowanceAmount: 1600 });
  assert.equal(benefits.allowanceAmount, 800);
  assert.match(edgeSource, /const packBenefits = packBenefitsForScene\(sceneDraft, packConfiguration\.packBenefits\)/);
  assert.match(edgeSource, /const currentPackBenefits = packBenefitsForScene\(/);
});

test('allowance scene creation keeps preset reserve rules without restoring included preset objects', () => {
  assert.match(edgeSource, /base_preset_id:\s*preset\?\.id\s*\|\|\s*null/);
  assert.match(edgeSource, /reserveRules:\s*presetReserveRules\(preset\)/);
  assert.doesNotMatch(edgeSource, /reserveRules:\s*hasAllowance\s*\?\s*\{\}/);
  assert.match(edgeSource, /if\s*\(!hasAllowance\s*&&\s*savedScene\?\.id\s*&&\s*preset\?\.stand_preset_items\?\.length\)/);
});

test('Signature scene creation includes both configured partition heads in every area band', () => {
  const api = runtime();
  const rules = api.signaturePartitionHeadRules({ base_config: { partitionHeadRules: {
    small: { leftType: 'head-left', rightType: 'head-right', includedCount: 0 },
    medium: { leftType: 'head-left', rightType: 'head-right', includedCount: 1 },
    large: { leftType: 'head-left', rightType: 'head-right', includedCount: 2 },
  } } });
  for (const band of ['small', 'medium', 'large']) {
    assert.equal(rules[band].includedCount, 2);
    assert.equal(JSON.stringify(rules[band].includedSides), JSON.stringify(['left', 'right']));
    assert.equal(rules[band].leftType, 'head-left');
    assert.equal(rules[band].rightType, 'head-right');
  }
});

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
