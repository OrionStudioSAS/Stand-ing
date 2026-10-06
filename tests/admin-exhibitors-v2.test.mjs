import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = vm.createContext({
  normalizeTextValue: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  sceneStandNumber: (scene) => scene.source_payload?.stand_number || '',
  adminSalonBatState: (scene) => scene.client_status === 'bat_validated' ? 'signed' : scene.client_status === 'bat_review' ? 'sent' : 'waiting',
  adminDashboardIsComplete: (scene) => ['configured', 'bat_review', 'bat_validated'].includes(scene.client_status),
});

for (const name of ['adminClientSceneState', 'adminClientMatchesFilters']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

const client = { display_name: 'Adélie Jouin', company_name: 'LABOSPORT', email: 'adelie@example.com' };
const scenes = [{ client_status: 'configured', salon: 'SMCL 2026', offer: 'Prestige', source_payload: { stand_number: 'C12' } }];

test('exhibitor states distinguish draft, pending, sent and signed BAT', () => {
  assert.equal(api.adminClientSceneState({ client_status: 'draft' }).id, 'draft');
  assert.equal(api.adminClientSceneState(scenes[0]).id, 'pending');
  assert.equal(api.adminClientSceneState({ client_status: 'bat_review' }).id, 'sent');
  assert.equal(api.adminClientSceneState({ client_status: 'bat_validated' }).id, 'signed');
});

test('search includes person, company and stand, while pack and salon filters stay effective', () => {
  assert.equal(api.adminClientMatchesFilters(client, scenes, { search: 'c12' }), true);
  assert.equal(api.adminClientMatchesFilters(client, scenes, { search: 'labosport' }), true);
  assert.equal(api.adminClientMatchesFilters(client, scenes, { search: 'adelie', pack: 'Prestige', salon: 'SMCL' }, 'C12'), true);
  assert.equal(api.adminClientMatchesFilters(client, scenes, { pack: 'Confort' }), false);
  assert.equal(api.adminClientMatchesFilters(client, scenes, { status: 'bat_validated' }), false);
});

test('directory keeps scene actions, CSV export, Monday sync and responsive table', () => {
  assert.match(source, /onSyncMonday=\{runMondaySync\}/);
  assert.match(source, /downloadSceneTechnicalPlan\(await loadSceneForAdminAction/);
  assert.match(source, /downloadScenePurchaseOrder\(await loadSceneForAdminAction/);
  assert.match(source, /onClick=\{exportCsv\}/);
  assert.match(source, /setClientPageSize\(Number\(event\.target\.value\)\)/);
  assert.match(css, /\.admin-exhibitors-table-scroll/);
  assert.match(css, /@media \(max-width: 760px\)[^\n]*\.admin-exhibitors-toolbar/);
});
