import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/scene-config-sync/index.ts', import.meta.url), 'utf8');

function loadFunction(api, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n', start);
  const runnable = source.slice(start, end)
    .replaceAll(':Col[]', '')
    .replaceAll(':string[]', '')
    .replaceAll(':any', '');
  vm.runInContext(runnable, api);
}

function colorRuntime(fetch = async () => { throw new Error('Unexpected Monday call'); }) {
  const api = vm.createContext({ fetch });
  const code = source.replace(/^import .*\n/gm, '').replace(/^Deno\.serve\(.*\n/m, '');
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, api);
  return api;
}

function statusColumn(id, title, choices) {
  return { id, title, type: 'status', settings_str: JSON.stringify({ labels: Object.fromEntries(choices.map((label, index) => [index, label])) }) };
}

test('Prestige configuration sync prefers the three replacement Monday columns', () => {
  const api = vm.createContext({});
  for (const name of ['norm', 'col', 'preferredCol']) loadFunction(api, name);
  const columns = [
    { id: 'empreinte5', title: 'EMPREINTE' },
    { id: 'color_mm7dea15', title: 'EMPREINTE 2' },
    { id: 'color_mksfgcrz', title: 'COTON' },
    { id: 'color_mm7d5sx6', title: 'COTON 2' },
    { id: 'color_mkvqk39q', title: 'COMPTOIR' },
    { id: 'color_mm7d1pfe', title: 'COMPTOIR 2' },
  ];

  assert.equal(api.preferredCol(columns, ['color_mm7dea15'], ['EMPREINTE 2', 'EMPREINTE']).id, 'color_mm7dea15');
  assert.equal(api.preferredCol(columns, ['color_mm7d5sx6'], ['COTON 2', 'COTON']).id, 'color_mm7d5sx6');
  assert.equal(api.preferredCol(columns, ['color_mm7d1pfe'], ['COMPTOIR 2', 'COMPTOIR']).id, 'color_mm7d1pfe');
});

test('other Monday boards keep their original columns as fallback', () => {
  const api = vm.createContext({});
  for (const name of ['norm', 'col', 'preferredCol']) loadFunction(api, name);
  const columns = [
    { id: 'empreinte5', title: 'EMPREINTE' },
    { id: 'color_mksfgcrz', title: 'COTON' },
    { id: 'color_mkvqk39q', title: 'COMPTOIR' },
  ];

  assert.equal(api.preferredCol(columns, ['color_mm7dea15'], ['EMPREINTE 2', 'EMPREINTE']).id, 'empreinte5');
  assert.equal(api.preferredCol(columns, ['color_mm7d5sx6'], ['COTON 2', 'COTON']).id, 'color_mksfgcrz');
  assert.equal(api.preferredCol(columns, ['color_mm7d1pfe'], ['COMPTOIR 2', 'COMPTOIR']).id, 'color_mkvqk39q');
});

test('footprint matches real colours before an exact Personnalise fallback', () => {
  const api = colorRuntime();
  const column = statusColumn('empreinte5', 'EMPREINTE', ['Personnalisé', 'NON', 'ORANGE REWIND - 0450', 'BLEU MARINE - 0809', 'TURQUOISE - 0822', 'ÉCRU - 0533']);
  for (const [name, code, expected] of [
    ['Orange', '0450', 'ORANGE REWIND - 0450'],
    ['Marine', '0809', 'BLEU MARINE - 0809'],
    ['Turquoise', '0822', 'TURQUOISE - 0822'],
    ['ecru', '0533', 'ÉCRU - 0533'],
  ]) {
    assert.equal(api.footprint(column, { carpetFootprintColorName: name, carpetFootprintColorCode: code }), expected);
  }
});

test('older scenes can match the footprint code stored in their colour-group ID', () => {
  const api = colorRuntime();
  const column = statusColumn('color_mm7dea15', 'EMPREINTE 2', ['Personnalisé', 'BLEU AMIRAL - 0809']);
  assert.equal(api.footprint(column, { carpetFootprintColorName: 'Marine', carpetFootprintColorReference: 'SMCL02MOQ01B',
    carpetFootprintColorId: 'color-group-moquette-recyclable-rewind-mr0iojjw:0809-marine' }), 'BLEU AMIRAL - 0809');
});

test('exact colours, unknown finishes and disabled footprints retain their existing behaviour', () => {
  const api = colorRuntime();
  const column = statusColumn('empreinte5', 'EMPREINTE', ['Personnalisé', 'NON', 'ORANGE - 0450']);
  assert.equal(api.footprint(column, { carpetFootprintColorName: 'Orange', carpetFootprintColorCode: '0450' }), 'ORANGE - 0450');
  assert.equal(api.footprint(column, { carpetFootprintColorName: 'Finition spéciale', carpetFootprintColorCode: '9999' }), 'Personnalisé');
  assert.equal(api.footprint(column, {}), 'Personnalisé');
  for (const state of [{ carpetFootprintEnabled: false }, { technicalFloorType: 'floor' }]) {
    assert.equal(api.footprint(column, { carpetFootprintColorName: 'Orange', ...state }), 'NON');
  }
  assert.equal(api.footprint(null, {}), '');
  assert.equal(api.footprint(statusColumn('empty', 'EMPREINTE', []), { carpetFootprintColorName: 'Orange' }), '');
});

test('carpet, cotton and counter colours also match before their default fallbacks', () => {
  const api = colorRuntime();
  const choices = ['Personnalisé', 'GRIS CLAIR - 0939', 'BLANC - 303', 'ORANGE REWIND - 0450'];
  const column = statusColumn('colour', 'COULEUR', choices);
  assert.equal(api.carpet(column, { carpetColorName: 'Orange', carpetColorCode: '0450' }), 'ORANGE REWIND - 0450');
  assert.equal(api.wall(column, { wallFabricColorName: 'Orange', wallFabricColorCode: '0450' }), 'ORANGE REWIND - 0450');
  assert.equal(api.counterStatus(column, { options: { binary2ColorName: 'Orange', binary2ColorReference: '0450' } }), 'ORANGE REWIND - 0450');
});

test('Confort and Prestige send the matched footprint label to the proper Monday column', async () => {
  for (const [offer, id, title] of [['Confort', 'empreinte5', 'EMPREINTE'], ['Prestige', 'color_mm7dea15', 'EMPREINTE 2']]) {
    const requests = [];
    const api = colorRuntime(async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ data: { change_column_value: { id: 'test-item' } } }) };
    });
    const columns = [statusColumn(id, title, ['Personnalisé', 'NON', 'ORANGE REWIND - 0450'])];
    const tasks = api.updates({ offer, source_payload: { options: { carpetFootprintColorName: 'Orange', carpetFootprintColorCode: '0450' } } }, columns, 'test-token', 'test-board', 'test-item');
    await Promise.all(tasks.map((task) => task.promise));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].variables.columnId, id);
    assert.deepEqual(JSON.parse(requests[0].variables.value), { label: 'ORANGE REWIND - 0450' });
  }
});
