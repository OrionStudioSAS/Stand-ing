import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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
