import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const view = source.slice(source.indexOf('function AdminPresetsView('), source.indexOf('function salonPackCards('));

test('pack cards expose salon filters, real metrics, and the compact actions', () => {
  assert.match(view, /setSelectedSalonId\(''\)/);
  assert.match(view, /activePackCount = packCards\.filter/);
  assert.match(view, /adminSalonPackModules\(entry\)/);
  assert.match(view, /Board Monday/);
  assert.match(view, /Nouveau pack/);
  assert.match(view, /setCreateOpen\(true\)/);
  assert.match(view, /menuPackName === entry\.packName/);
  assert.match(view, /onClick=\{\(\) => \{ setMenuPackName\(''\); openPackEditor\(entry\); \}\}/);
  assert.match(view, /onClick=\{\(\) => \{ setMenuPackName\(''\); removePreset\(entry\); \}\}/);
  assert.match(view, /onClick=\{\(\) => \{ setMenuPackName\(''\); removeGlobalPack\(entry\); \}\}/);
});

test('global pack view keeps salon-scoped actions and responsive cards', () => {
  assert.match(view, /uniqueByNormalized\(salons\.flatMap/);
  assert.match(view, /activeSalonCount: entries\.filter/);
  assert.match(view, /const targetSalon = selectedSalon \|\| entry\.salon/);
  assert.match(view, /salon: selectedSalon \|\| entry\.salon/);
  assert.match(view, /boardEditor\.salon, entry\.packName/);
  assert.match(css, /\.preset-library-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1050px\) \{ \.preset-library-grid \{ grid-template-columns: 1fr/);
});
