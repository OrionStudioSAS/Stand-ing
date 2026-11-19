import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { normalizePackBenefits, packBenefitsForScene, isSignaturePackScene, sceneLightingOptions } from '../supabase/functions/_shared/packBenefits.js';
import { defaultCeilingHeightM, parseHeightMeters } from '../supabase/functions/_shared/standHangingLimits.js';

const edgeSource = readFileSync(new URL('../supabase/functions/monday-sync/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const compiled = transformSync(edgeSource, { loader: 'ts', format: 'cjs' }).code;

function requestHandler(sourceError = null, sources = []) {
  let handler;
  const history = [];
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }) },
    from(table) {
      if (table === 'admin_users') return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { user_id: 'admin', full_name: 'Admin Test' } }) };
      if (table === 'monday_sources') return { select() { return this; }, async eq() {
        if (sourceError) throw sourceError;
        return { data: sources, error: null };
      } };
      if (table === 'monday_sync_runs') return {
        insert(value) { history.push(value); return this; }, select() { return this; },
        single: async () => ({ data: { id: 'run' }, error: null }),
        update(value) { history.push(value); return this; }, eq: async () => ({ error: null }),
      };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const context = vm.createContext({
    Deno: { serve(value) { handler = value; }, env: { get: (key) => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key', MONDAY_API_TOKEN: 'test-monday-token' }[key]) } },
    createClient: () => database, Response, console: { error() {} },
    normalizePackBenefits, packBenefitsForScene, isSignaturePackScene, sceneLightingOptions, defaultCeilingHeightM, parseHeightMeters,
  });
  vm.runInContext(compiled, context);
  return { handler, database, history, context };
}

test('Monday preflight and successful synchronization return browser-readable responses', async () => {
  const { handler, history } = requestHandler();
  const preflight = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  const success = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: '{}' }));
  assert.equal(success.status, 200);
  const result = await success.json();
  assert.equal(result.processed, 0);
  assert.ok(result.duration_ms >= 0);
  assert.equal(history[0].actor_user_id, 'admin');
  assert.equal(history[0].actor_name, 'Admin Test');
  assert.equal(history[1].status, 'success');
  assert.equal(history[1].result.invite_emails_sent, 0);
  assert.ok(history[1].finished_at);
});

test('Monday unexpected database and network failures retain JSON and CORS instead of masking the cause', async () => {
  for (const error of [{ code: '42501', message: 'permission denied for schema private' }, new Error('Monday unavailable')]) {
    const { handler, history } = requestHandler(error);
    const response = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', headers: { Authorization: 'Bearer admin-token' }, body: '{}' }));
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal((await response.json()).error, `Synchronisation Monday impossible : ${error.message}`);
    assert.equal(history.at(-1).status, 'error');
    assert.equal(history.at(-1).error, error.message);
  }
});

test('Monday authentication remains required and rejected requests retain CORS', async () => {
  const { handler, database, history } = requestHandler();
  database.auth.getUser = async () => ({ data: { user: null }, error: new Error('Unauthorized') });
  const response = await handler(new Request('https://test.supabase.co/functions/v1/monday-sync', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await response.json()).error, 'Unauthorized');
  assert.equal(history.length, 0);
});

function runtime(fetch = () => { throw new Error('Unexpected network request'); }) {
  const context = vm.createContext({ Deno: { serve() {} }, fetch, console, normalizePackBenefits, packBenefitsForScene, isSignaturePackScene, sceneLightingOptions, defaultCeilingHeightM, parseHeightMeters });
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
  assert.match(edgeSource, /const defaultOptions = sceneLightingOptions\(/, 'Creation uses the same pack lighting policy as existing scenes');
  assert.doesNotMatch(edgeSource, /hasAllowance\s*\?\s*\{ autoSpotsRule: null, ledRailsEnabled: false \}/, 'The allowance must not disable Signature lighting');
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

test('preparing the Signature test board adds the numeric ceiling column once', async () => {
  let created = 0;
  const api = runtime(async (_url, request) => {
    const { query, variables } = JSON.parse(request.body);
    assert.equal([variables.boardId].flat()[0], '18410370871');
    if (query.includes('mutation')) {
      created += 1;
      assert.equal(variables.title, 'Hauteur plafond');
      assert.equal(variables.type, 'numbers');
      return { ok: true, json: async () => ({ data: { create_column: { title: variables.title } } }) };
    }
    const configured = [...columns, ...(created ? [{ id: 'height', title: 'HAUTEUR PLAFOND', type: 'numbers' }] : [])];
    return { ok: true, json: async () => ({ data: { boards: [{ columns: configured }] } }) };
  });
  await api.prepareMondayBoard('test-token', '18410370871');
  await api.prepareMondayBoard('test-token', '18410370871');
  assert.equal(created, 1);
});

test('Monday updates ceiling, sling and aisle direction on existing drafts and validated scenes', () => {
  const api = runtime();
  const source = { board_id: '18410370871', offer: 'Signature' };
  const item = (sling, side, ceiling = '4,80 m') => ({ column_values: [
    { id: 'numbers', column: { title: 'Hauteur plafond' }, text: ceiling },
    { id: 'color_mm91v4f9', text: sling }, { id: 'color_mm91rwqj', text: side },
  ] });
  const parse = (value, scene) => JSON.parse(JSON.stringify(api.mondayStandProductionPatch(value, source, scene)));
  assert.deepEqual(parse(item('4,25 m', 'HAUT')), {
    hanging_limits: { ceilingM: 4.8, slingM: 4.25, slingStatus: '4,25 m' }, plan_aisle_side: 'top',
  });
  for (const [status, side] of [['AUTRE', 'GAUCHE'], ['ATT', 'DROITE'], ['PAS BESOIN', 'BAS']]) {
    assert.deepEqual(parse(item(status, side, '')).hanging_limits, { ceilingM: 5.25, slingM: null, slingStatus: status });
  }
  assert.equal(parse(item('5,25 m', 'ATT')).plan_aisle_side, null);
  assert.equal(parse(item('5,25 m', 'BAS'), { status: 'created', client_status: 'not_started' }).hanging_limits.slingM, 5.25);
  assert.deepEqual(parse({}, { status: 'created', client_status: 'not_started' }), {
    hanging_limits: { ceilingM: 5.25, slingM: null, slingStatus: '' },
  });
  for (const existing of [
    { status: 'created', client_status: 'draft' },
    { status: 'created', client_status: 'not_started', source_payload: { exhibitor_view_only: true } },
    { status: 'validated', client_status: 'bat_validated' },
    { status: 'configured', client_status: 'configured', source_payload: { options: { carpet: 'blue' } } },
  ]) assert.deepEqual(parse(item('4,25 m', 'GAUCHE'), existing), {
    plan_aisle_side: 'left',
    hanging_limits: { ceilingM: 4.8, slingM: 4.25, slingStatus: '4,25 m' },
  });
  const other = api.mondayStandProductionPatch({ column_values: [{ column: { title: 'HAUTEUR PLAFOND' }, text: '4,2' }] }, { board_id: 'siae' });
  assert.equal(other.hanging_limits.ceilingM, 4.2);
});

test('partial Monday height patches distinguish absent columns from explicit resets', () => {
  const api = runtime();
  const source = { board_id: 'other-board', offer: 'Prestige', mapping: {
    ceiling_height_m: 'ceiling', sling_height_m: 'sling', plan_aisle_side: 'aisle',
  } };
  const previous = { ceilingM: 4.8, slingM: 4.25, slingStatus: '4,25 m' };
  for (const client_status of ['not_started', 'draft', 'configured', 'bat_validated']) {
    const existing = { status: 'created', client_status, source_payload: { hanging_limits: previous } };
    const parse = (column_values) => JSON.parse(JSON.stringify(api.mondayStandProductionPatch({ column_values }, source, existing)));
    assert.deepEqual(parse([]), {});
    assert.deepEqual(parse([{ id: 'aisle', text: 'BAS' }]), { plan_aisle_side: 'bottom' });
    assert.deepEqual(parse([{ id: 'ceiling', text: '4,20 m' }]), { hanging_limits: { ceilingM: 4.2 } });
    assert.deepEqual(parse([{ id: 'ceiling', text: '' }]), { hanging_limits: { ceilingM: 5.25 } });
    assert.deepEqual(parse([{ id: 'sling', text: '5,25 m' }]), { hanging_limits: { slingM: 5.25, slingStatus: '5,25 m' } });
    for (const text of ['', 'ATT', 'AUTRE', 'PAS BESOIN']) {
      assert.deepEqual(parse([{ id: 'sling', text }]), { hanging_limits: { slingM: null, slingStatus: text } });
    }
    assert.deepEqual(existing.source_payload.hanging_limits, previous);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(api.mondayStandProductionPatch({}, source, {
    status: 'created', client_status: 'draft', source_payload: {},
  }))), {}, 'Do not invent height limits for legacy drafts on boards without these columns');
});

test('existing production columns are read by title outside the Signature pilot', () => {
  const api = runtime();
  for (const offer of ['Signature', 'Prestige', 'Confort', 'Équipé']) {
    const patch = api.mondayStandProductionPatch({ column_values: [
      { id: 'new-sling-id', column: { title: 'ELINGUE' }, text: '4,25 m' },
      { id: 'new-aisle-id', column: { title: 'ALLEE PLAN' }, text: 'DROITE' },
    ] }, { board_id: 'other-board', offer }, { status: 'validated', client_status: 'bat_validated' });
    assert.deepEqual(JSON.parse(JSON.stringify(patch)), {
      plan_aisle_side: 'right', hanging_limits: { slingM: 4.25, slingStatus: '4,25 m' },
    });
  }
});

test('existing scenes are read in unique batches of 200, not once per exhibitor', async () => {
  const api = runtime();
  const batches = [];
  const database = { from(table) {
    assert.equal(table, 'scenes');
    return { select() { return this; }, async in(column, ids) {
      assert.equal(column, 'monday_item_id');
      batches.push([...ids]);
      return { data: ids.map((id) => ({ id: `scene-${id}`, monday_item_id: id })) };
    } };
  } };
  const scenes = await api.fetchExistingMondayScenes(database, [...Array.from({ length: 401 }, (_, id) => ({ id })), { id: 1 }]);
  assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 1]);
  assert.equal(scenes.size, 401);
  assert.equal(scenes.get('400').id, 'scene-400');
  assert.equal((await api.fetchExistingMondayScenes(database, [])).size, 0);
  const error = new Error('Database unavailable');
  await assert.rejects(api.fetchExistingMondayScenes({ from: () => ({ select() { return this; }, in: async () => ({ error }) }) }, [{ id: 1 }]), /Database unavailable/);
});

test('unchanged JSONB data compares equal regardless of object key ordering', () => {
  const api = runtime();
  assert.equal(api.sameMondayData({ a: 1, b: [{ x: 1, y: null }] }, { b: [{ y: null, x: 1 }], a: 1 }), true);
  assert.equal(api.sameMondayData({ a: 1 }, { a: 2 }), false);
  assert.equal(api.sameMondayData([1, 2], [2, 1]), false);
  assert.equal(api.sameMondayData(null, {}), false);
  assert.equal(api.sameMondayData([], {}), false);
  assert.equal(api.sameMondayData({ a: 1 }, { a: 1, b: 2 }), false);
});

test('Monday skips correct configurator links and repairs absent, incorrect or malformed ones', async () => {
  const calls = [];
  const api = runtime(async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ data: { change_multiple_column_values: { id: 'item' } } }) };
  });
  const options = { mondayToken: 'token', publicAppUrl: 'https://example.com/', shareToken: 'token', source: { board_id: 'board', link_column_id: 'link' } };
  await api.ensureMondayConfiguratorLink({ ...options, item: { id: 'item', column_values: [{ id: 'link', value: JSON.stringify({ url: 'https://example.com?scene=token', text: 'Custom label' }) }] } });
  assert.equal(calls.length, 0);
  for (const value of [null, '{invalid', JSON.stringify({ url: 'https://old.example.com' })]) {
    await api.ensureMondayConfiguratorLink({ ...options, item: { id: 'item', column_values: [{ id: 'link', value }] } });
  }
  assert.equal(calls.length, 3);
  for (const call of calls) assert.match(call.variables.value, /https:\/\/example.com\?scene=token/);
});

test('full sync skips unchanged scene writes and caches shared board reads while keeping history', async () => {
  const sources = [{ id: 's1', board_id: 'board', offer: 'Confort', mapping: {} }, { id: 's2', board_id: 'board', offer: 'Confort', mapping: {} }];
  const { handler, database, context, history } = requestHandler(null, sources);
  let columnReads = 0;
  let itemReads = 0;
  let sceneReads = 0;
  const writes = [];
  context.fetchMondayBoardColumnsSafe = async () => { columnReads++; return { columns: [] }; };
  context.ensureSourceContext = async () => ({ offerId: 'offer' });
  context.fetchOfferPackConfiguration = async () => ({ packBenefits: {}, baseItems: [] });
  context.fetchMondayItems = async () => { itemReads++; return Array.from({ length: 100 }, (_, id) => ({ id: String(id), name: 'Company', column_values: [] })); };
  const from = database.from.bind(database);
  database.from = (table) => table === 'scenes' ? { select() { return this; }, async in(_column, ids) {
    sceneReads++;
    return { data: ids.map((id) => ({ id, monday_item_id: id, offer: 'Confort', client_name: 'Contact', client_email: 'contact@example.com', client_status: 'configured', source_payload: { stand_number: id === '0' ? 'OUTDATED' : '', aisle_number: '', hall: '', sector: '', constraint: null, constraints: [], poteau_1_text: '', poteau_2_text: '' } })) };
  } } : from(table);
  context.mondaySceneLocation = () => ({ standNumber: 'NEW', aisleNumber: '', hall: '', sector: '' });
  // Every scene except 0 already has the mapped stand number.
  const scenesFrom = database.from;
  database.from = (table) => {
    const query = scenesFrom(table);
    if (table === 'scenes') {
      const original = query.in;
      query.in = async (...args) => {
        const result = await original(...args);
        for (const scene of result.data) if (scene.id !== '0') scene.source_payload.stand_number = 'NEW';
        return result;
      };
    }
    return query;
  };
  database.rpc = async (name, args) => { writes.push({ name, args }); return { data: true }; };
  const response = await handler(new Request('https://test/functions/v1/monday-sync', { method: 'POST', headers: { Authorization: 'Bearer token' }, body: '{}' }));
  assert.equal(response.status, 200);
  assert.equal(columnReads, 1);
  assert.equal(itemReads, 1);
  assert.equal(sceneReads, 2);
  assert.equal(writes.filter(write => write.name === 'patch_scene_from_monday').length, 2);
  const stamps = writes.filter(write => write.name === 'stamp_scene_monday_sync');
  assert.equal(stamps.length, 1, 'Sync timestamps use one batch, not one request per scene');
  assert.equal(stamps[0].args.p_scene_ids.length, 100, 'Scene IDs are deduplicated across sources');
  assert.equal(writes[0].name, 'patch_scene_from_monday');
  assert.equal(writes[0].args.p_source_patch.stand_number, 'NEW');
  assert.equal(writes[0].args.p_source_patch.options, undefined);
  assert.deepEqual([...history.at(-1).source_ids], ['s1', 's2']);
});

test('full sync updates production settings after creation once, without rebuilding scene objects', async () => {
  const source = { id: 'production', board_id: '18410370871', offer: 'Prestige', mapping: {} };
  const { handler, database, context } = requestHandler(null, [source]);
  const productionColumns = [
    { id: 'color_mm91v4f9', title: 'ELINGUE', text: '4,25 m' },
    { id: 'color_mm91rwqj', title: 'ALLEE PLAN', text: 'DROITE' },
  ];
  const scenes = ['draft', 'configured', 'bat_validated'].map((client_status, index) => ({
    id: String(index), monday_item_id: String(index), offer: 'Prestige',
    status: client_status === 'draft' ? 'created' : 'validated', client_status,
    client_name: 'Current contact', client_email: 'current@example.com',
    source_payload: {
      stand_number: '', aisle_number: '', hall: '', sector: '',
      constraint: null, constraints: [], poteau_1_text: '', poteau_2_text: '',
      packBenefits: { mode: 'included-items' }, baseItems: [],
      hanging_limits: { ceilingM: 4.8, slingM: 5.25, slingStatus: '5,25 m' },
      plan_aisle_side: 'top', options: { savedImage: 'saved.jpg' },
      exhibitor_view_only: true,
    },
  }));
  context.fetchMondayBoardColumnsSafe = async () => ({ columns: productionColumns });
  context.fetchMondayItems = async () => scenes.map((scene) => ({
    id: scene.monday_item_id, name: 'Company', column_values: productionColumns,
  }));
  context.ensureSourceContext = async () => ({ offerId: 'offer' });
  context.fetchOfferPackConfiguration = async () => ({ packBenefits: { mode: 'included-items' }, baseItems: [] });
  context.packBenefitsForScene = () => ({ mode: 'included-items' });
  const from = database.from.bind(database);
  database.from = (table) => table === 'scenes'
    ? { select() { return this; }, in: async () => ({ data: scenes }) }
    : from(table);
  const writes = [];
  database.rpc = async (name, args) => {
    if (name === 'patch_scene_from_monday') {
      writes.push(args);
      const scene = scenes.find((value) => value.id === args.p_scene_id);
      scene.source_payload = {
        ...scene.source_payload, ...args.p_source_patch,
        hanging_limits: { ...scene.source_payload.hanging_limits, ...args.p_source_patch.hanging_limits },
      };
    } else assert.equal(name, 'stamp_scene_monday_sync');
    return { data: true };
  };
  const sync = () => handler(new Request('https://test/functions/v1/monday-sync', {
    method: 'POST', headers: { Authorization: 'Bearer token' }, body: '{}',
  }));
  assert.equal((await sync()).status, 200);
  assert.equal(writes.length, 3);
  for (const scene of scenes) {
    assert.deepEqual(JSON.parse(JSON.stringify(scene.source_payload.hanging_limits)), {
      ceilingM: 4.8, slingM: 4.25, slingStatus: '4,25 m',
    });
    assert.equal(scene.source_payload.plan_aisle_side, 'right');
    assert.equal(scene.source_payload.options.savedImage, 'saved.jpg');
    assert.equal(scene.source_payload.exhibitor_view_only, true);
  }
  for (const write of writes) {
    assert.equal(write.p_source_patch.options, undefined);
    assert.equal(write.p_source_patch.hanging_limits.ceilingM, undefined);
  }
  assert.equal((await sync()).status, 200);
  assert.equal(writes.length, 3, 'A partial height patch must not trigger another write when unchanged');
});
