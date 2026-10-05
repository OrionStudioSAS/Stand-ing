import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = vm.createContext({
  normalizeTextValue: (value) => String(value || '').trim().toLowerCase(),
  formatSalonDateRange: () => '14-18 oct. 2026',
});

function load(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

for (const name of ['adminSalonCompletedScenes', 'adminSalonPackProgress', 'adminSalonMeta', 'adminScenePackName', 'adminSalonBatKind', 'adminSalonBatLabel']) load(name);

test('salon and pack progress use actual configured scenes, not total created scenes', () => {
  const scenes = [
    { id: 'a', client_status: 'draft' },
    { id: 'b', client_status: 'configured' },
    { id: 'c', status: 'bat_pending' },
    { id: 'd', client_status: 'bat_validated' },
  ];
  assert.equal(api.adminSalonCompletedScenes({ scenes }).length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(api.adminSalonPackProgress({ scenes }))), { total: 4, complete: 3, percent: 75 });
  assert.equal(api.adminSalonBatLabel(scenes[2]), 'À valider');
  assert.equal(api.adminSalonBatKind(scenes[3]), 'success');
});

test('salon pack labels resolve offer IDs when a scene has no pack text', () => {
  const salon = { offers: [{ id: 'offer-1', name: 'Signature' }], location: 'Paris' };
  assert.equal(api.adminScenePackName({ offer_id: 'offer-1' }, salon), 'Signature');
  assert.equal(api.adminScenePackName({ offer: 'Confort' }, salon), 'Confort');
  assert.equal(api.adminSalonMeta(salon), '14-18 oct. 2026 · Paris');
});

test('new admin navigation and salon details have functional tabs and responsive styles', () => {
  assert.match(source, /tab === 'bat' && <AdminBatView/);
  assert.match(source, /\['overview', "Vue d’ensemble"\]/);
  assert.match(source, /\['packs', 'Packs'\]/);
  assert.match(source, /\['monday', 'Synchro Monday'\]/);
  assert.match(source, /onClick=\{exportRows\}/);
  assert.match(css, /\.admin-salon-detail-summary/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.admin-dashboard-shell \.admin-sidebar-nav/);
});
