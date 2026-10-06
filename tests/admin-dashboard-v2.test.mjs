import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = vm.createContext({});

for (const name of ['adminDashboardIsComplete', 'adminDashboardIsStarted', 'adminDashboardScenePrice']) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

test('dashboard counts only finished configurations and recognizes drafts as started', () => {
  assert.equal(api.adminDashboardIsComplete({ client_status: 'not_started' }), false);
  assert.equal(api.adminDashboardIsStarted({ client_status: 'not_started' }), false);
  assert.equal(api.adminDashboardIsStarted({ client_status: 'draft' }), true);
  assert.equal(api.adminDashboardIsComplete({ client_status: 'draft' }), false);
  assert.equal(api.adminDashboardIsComplete({ client_status: 'configured' }), true);
  assert.equal(api.adminDashboardIsComplete({ client_status: 'bat_validated' }), true);
});

test('dashboard revenue uses recorded prices, not an area-based estimate', () => {
  assert.equal(api.adminDashboardScenePrice({ source_payload: { pricing: { total: 1600 } } }), 1600);
  assert.equal(api.adminDashboardScenePrice({ source_payload: { pricing: { total: 0 } } }), 0);
  assert.equal(api.adminDashboardScenePrice({ source_payload: { pricing: { total: null } } }), null);
  assert.equal(api.adminDashboardScenePrice({ dimensions: { width: 10, depth: 10 } }), null);
});

test('dashboard exposes the year, funnel, requests and responsive salon progress', () => {
  assert.match(source, /setDashboardYear\(\(year\) => year - 1\)/);
  assert.match(source, /Funnel de conversion/);
  assert.match(source, /Demandes en attente de validation/);
  assert.match(source, /Stands livrés[\s\S]*?Statut non suivi/);
  assert.match(source, /adminSalonCompletedScenes\(salon\)/);
  assert.match(css, /\.admin-dashboard-v2-kpis/);
  assert.match(css, /@media \(max-width: 520px\)[^\n]*\.admin-dashboard-v2-funnel/);
});
