import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { packEditorChanges, packEditorImpact } from '../src/packEditor.js';

test('global impact counts only the selected pack and deduplicates linked scenes', () => {
  const offer = { id: 'offer-a', pack_id: 'confort', name: 'Confort' };
  const salons = [
    { id: 'a', offers: [offer, { id: 'other', pack_id: 'prestige', name: 'Prestige' }], scenes: [{ id: 'one', offer_id: 'offer-a' }, { id: 'two', offer_id: 'other' }] },
    { id: 'b', offers: [{ id: 'offer-b', pack_id: 'confort', name: 'Confort' }], scenes: [{ id: 'one', offer: 'Confort' }, { id: 'three', offer_id: 'offer-b' }] },
    { id: 'c', offers: [{ pack_id: 'another', name: 'Confort' }], scenes: [] },
  ];
  const impact = packEditorImpact(salons, offer);
  assert.deepEqual(impact.salons.map((salon) => salon.id), ['a', 'b']);
  assert.equal(impact.sceneCount, 2);
  assert.deepEqual(packEditorImpact(salons, null), { salons: [], sceneCount: 0 });
});

test('legacy pack association resolves by name without counting unrelated offer IDs', () => {
  const salons = [{ id: 'legacy', offers: [{ id: 'offer', name: 'Confort' }], scenes: [{ id: 'one', options: { includedPack: 'confort' } }, { id: 'two', offer_id: 'other', offer: 'Confort' }] }];
  assert.equal(packEditorImpact(salons, { name: ' Confort ' }).sceneCount, 1);
});

test('confirmation explains dimension and color changes and automatic rail removal', () => {
  const before = { dimensions: { width: 5, depth: 3 }, defaultColorOptions: { carpetColorId: 'orange', carpetColorName: 'Orange' }, autoSpotsRule: { twoSpotType: 'rail2' }, items: [] };
  const after = { ...before, dimensions: { width: 7, depth: 2.5 }, defaultColorOptions: { carpetColorId: 'gray', carpetColorName: 'Gris clair' }, autoSpotsRule: null };
  const changes = packEditorChanges(before, after);
  assert.deepEqual(changes.map((change) => change.label), ['Dimensions', 'Sol / moquette', 'Spots']);
  assert.match(changes[0].detail, /7 × 2,5 m/);
  assert.match(changes[1].detail, /Orange → Gris clair/);
  assert.match(changes[2].detail, /désactivés/);
  assert.deepEqual(packEditorChanges(before, structuredClone(before)), []);
});

test('moving an included object is reported even when the quantity stays the same', () => {
  const before = { items: [{ id: 'chair', x: 0, z: 0 }] };
  const after = { items: [{ id: 'chair', x: 1, z: 0 }] };
  assert.equal(packEditorChanges(before, after)[0].label, 'Objets inclus');
});

test('saving an explicitly removed rail rule clears the old stored rule', async () => {
  const source = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const saveSource = source.slice(source.indexOf('export async function saveStandPresetConfig('), source.indexOf('\nfunction sceneItemToPresetRow(')).replace('export async function', 'async function');
  const preset = { id: 'preset', offer_id: 'offer', base_config: { autoSpotsRule: { twoSpotType: 'old-rail' } } };
  let payload;
  const supabase = { from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, delete() { return this; },
      update(value) { payload = value; return this; }, in() { return this; },
      maybeSingle: async () => ({ data: { id: 'offer' }, error: null }),
      then(resolve) { return Promise.resolve({ data: table === 'stand_presets' ? [{ ...preset, ...payload }] : null, error: null }).then(resolve); },
    };
    return query;
  } };
  const save = new Function('supabase', 'fixedWallHeight', `${saveSource}; return saveStandPresetConfig;`)(supabase, 2.5);
  const draft = { dimensions: { width: 5, depth: 3 }, layout: 'back', items: [], autoSpotsRule: undefined };
  const saved = await save(preset, draft);
  assert.equal(saved.base_config.autoSpotsRule, null);
  assert.equal(payload.base_config.autoSpotsRule, null);
  await save(preset, { dimensions: draft.dimensions, layout: 'back', items: [] });
  assert.deepEqual(payload.base_config.autoSpotsRule, { twoSpotType: 'old-rail' });
});
