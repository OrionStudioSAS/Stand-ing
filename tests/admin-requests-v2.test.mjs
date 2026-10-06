import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('function AdminSpecialRequestsView('), source.indexOf('function sceneSpecialRequest('));
const api = vm.createContext({
  adminClientCompanyName: (client, scenes) => scenes[0]?.project_name === client.display_name ? '' : scenes[0]?.project_name || '',
});

for (const name of ['adminRequestPersonName', 'adminRequestCompanyName']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

test('requests keep the contact and company distinct', () => {
  const scene = { client_name: 'Ancien contact', project_name: 'Baywa R.E.', source_payload: { contactDetails: { firstName: 'Charisse', lastName: 'Titi' } } };
  assert.equal(api.adminRequestPersonName(scene), 'Charisse Titi');
  assert.equal(api.adminRequestCompanyName(scene), 'Baywa R.E.');
});

test('new request view has active and treated tabs, search, salon and urgency sort', () => {
  assert.match(source, /requests: 'Demandes'/);
  assert.match(view, /\['open', 'Toutes'\], \['overdue', 'En retard'\], \['pending', 'À traiter'\], \['resolved', 'Traitées'\]/);
  assert.match(view, /setSalonFilter\(event\.target\.value\)/);
  assert.match(view, /setLocalSearch\(event\.target\.value\)/);
  assert.match(view, /Trier : plus urgentes/);
  assert.match(view, /status\.id === 'resolved'/);
  assert.match(css, /\.admin-request-card-main \{ display: grid/);
  assert.match(css, /@media \(max-width: 760px\).*\.admin-request-card-main/);
});

test('request cards preserve scene, BDC, email and manual line actions', () => {
  assert.match(view, /Modifier la scène/);
  assert.match(view, /hasAmcoOrderLines\(order\)/);
  assert.match(view, /Valider par e-mail/);
  assert.match(view, /Marquer traitée/);
  assert.match(view, /initiallyOpen=\{index === 0 && activeTab === 'open'\}/);
  assert.match(view, /Référence \(optionnel\)/);
  assert.match(view, /Ajouter une ligne/);
  assert.match(view, /Enregistrer les lignes/);
  assert.match(view, /await onSave\(enteredLines\.map/);
});
