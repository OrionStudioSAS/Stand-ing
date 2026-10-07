import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = vm.createContext({
  normalizeTextValue: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
  mondayColumnTextByTitle: (payload, titles) => payload?.column_values?.find((column) => titles.includes(column.title.toLowerCase()))?.text || '',
  mondayColumnTextAny: () => '',
});
for (const name of ['sceneHallLabel', 'adminSalonHallValue', 'adminSalonHallOptions', 'adminSalonFilterScenesByHall']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}
const scene = (id, hall) => ({ id, source_payload: { hall } });
const ids = (rows) => Array.from(rows, (row) => row.id);

test('hall choices are deduplicated and sorted naturally, with unknown halls last', () => {
  const scenes = [scene('ten', '10'), scene('two', '2'), scene('two-again', 'Hall 2'), scene('letter', 'Hall A'), scene('missing', '')];
  assert.deepEqual(JSON.parse(JSON.stringify(api.adminSalonHallOptions(scenes))), [
    { value: '2', label: 'Hall 2' }, { value: '10', label: 'Hall 10' },
    { value: 'a', label: 'Hall A' }, { value: '__undefined__', label: 'Hall non renseigné' },
  ]);
});

test('filter resolves Monday hall/pavilion columns and saved scene contacts', () => {
  const scenes = [scene('direct', '3'),
    { id: 'monday', source_payload: { column_values: [{ title: 'Hall', text: 'Hall 3' }] } },
    { id: 'contact', source_payload: { contactDetails: { hall: 'Pavillon : 3' } } },
    scene('other', '4'), scene('no-space', 'Hall3'),
  ];
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall(scenes, '3')), ['direct', 'monday', 'contact', 'no-space']);
  assert.equal(api.adminSalonFilterScenesByHall(scenes), scenes);
});

test('missing halls can be filtered independently and numbers use exact matching', () => {
  const scenes = [scene('one', '1'), scene('eleven', '11'), scene('missing', ''), scene('undefined', 'À définir')];
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall(scenes, '1')), ['one']);
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall(scenes, '__undefined__')), ['missing', 'undefined']);
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall(scenes, '99')), []);
  assert.deepEqual(ids(scenes), ['one', 'eleven', 'missing', 'undefined']);
});

test('hall filter combines with incoming pack, status and search filters', () => {
  const scenes = [scene('first', '2'), scene('second', '2'), scene('third', '3')];
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall(scenes.filter((row) => row.id !== 'first'), '2')), ['second']);
  assert.deepEqual(ids(api.adminSalonFilterScenesByHall([], '2')), []);
});

test('the table filters before stand sorting, pagination and CSV export, and resets on salon changes', () => {
  const start = source.indexOf('function AdminSalonExhibitorTable(');
  const component = source.slice(start, source.indexOf('\n}\n', start) + 2);
  assert.match(component, /aria-label="Filtrer par numéro de hall"/);
  assert.match(component, /Tous les halls/);
  assert.match(component, /adminSalonHallOptions\(allScenes\)/);
  assert.match(component, /adminSalonSortScenesByStand\(adminSalonFilterScenesByHall\(scenes, effectiveHall\), standSort\)/);
  assert.match(component, /Math\.ceil\(sortedScenes\.length \/ 12\)/);
  assert.match(component, /\[filter, search, salon\.id, standSort, effectiveHall\]/);
  assert.match(component, /setHallFilter\(''\), \[salon\.id\]/);
  assert.match(component, /\.\.\.sortedScenes\.map/);
  assert.match(component, /!sortedScenes\.length/);
});
