import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = vm.createContext({
  normalizeTextValue: (value) => String(value || '').toLowerCase().trim(),
  mondayColumnTextByTitle: (source, titles) => source?.column_values?.find((column) => titles.includes(column.title))?.text || '',
  mondayColumnTextAny: () => '',
});
for (const name of ['sceneStandNumber', 'sceneAisleNumber', 'clientSceneEmplacement', 'adminSalonSortScenesByStand']) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(app.slice(start, app.indexOf('\n}\n', start) + 2), api);
}
const scene = (id, stand, aisle = '') => ({ id, source_payload: { stand_number: stand, aisle_number: aisle } });
const rows = [scene('ten', '10'), scene('two', '2'), scene('twenty', '20'), scene('one', '1')];
const ids = (scenes, order) => Array.from(api.adminSalonSortScenesByStand(scenes, order), (row) => row.id);

test('stands sort numerically ascending and descending instead of lexicographically', () => {
  assert.deepEqual(ids(rows, 'stand-asc'), ['one', 'two', 'ten', 'twenty']);
  assert.deepEqual(ids(rows, 'stand-desc'), ['twenty', 'ten', 'two', 'one']);
  assert.deepEqual(rows.map((row) => row.id), ['ten', 'two', 'twenty', 'one']);
  assert.deepEqual(ids(rows, 'default'), ['ten', 'two', 'twenty', 'one']);
});

test('numeric component takes precedence over aisle letters with natural tie-breaks', () => {
  const scenes = [scene('a10', '10', 'A'), scene('c2', 'C2'), scene('b2', '2B'), scene('a2', '2', 'A')];
  assert.deepEqual(ids(scenes, 'stand-asc'), ['b2', 'a2', 'c2', 'a10']);
  assert.deepEqual(ids(scenes, 'stand-desc'), ['a10', 'c2', 'a2', 'b2']);
});

test('missing stand numbers stay last in both directions', () => {
  const scenes = [scene('missing', ''), ...rows, scene('letters', 'ACCUEIL')];
  assert.deepEqual(ids(scenes, 'stand-asc'), ['one', 'two', 'ten', 'twenty', 'letters', 'missing']);
  assert.deepEqual(ids(scenes, 'stand-desc'), ['twenty', 'ten', 'two', 'one', 'letters', 'missing']);
  assert.deepEqual(ids([], 'stand-asc'), []);
});

test('stand numbers resolve from saved contacts and Monday, including alphanumeric stands', () => {
  const scenes = [
    { id: 'contact', source_payload: { contactDetails: { emplacement: 'A12' } } },
    { id: 'monday', source_payload: { column_values: [{ title: 'numéro stand', text: 'C3' }] } },
    scene('number', '10'),
  ];
  assert.deepEqual(ids(scenes, 'stand-asc'), ['monday', 'number', 'contact']);
  assert.equal(api.clientSceneEmplacement(scenes[0]), 'A12');
});

test('duplicate numbers retain their input order and sorting applies before pagination and export', () => {
  assert.deepEqual(ids([scene('first', '2'), scene('second', '2')], 'stand-desc'), ['first', 'second']);
  assert.match(app, /aria-label="Trier par numéro de stand"/);
  assert.match(app, /Stand : croissant/);
  assert.match(app, /Stand : décroissant/);
  assert.match(app, /sortedScenes\.slice\(\(currentPage - 1\) \* 12/);
  assert.match(app, /\.\.\.sortedScenes\.map\(\(scene\)/);
  assert.match(app, /\[filter, search, salon\.id, standSort\]/);
  assert.doesNotMatch(app, /admin-salon-hall-filter/);
});
