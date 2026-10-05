import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const start = app.indexOf('function AssetDrawer(');
const end = app.indexOf('function AssetConfigOptionRows(', start);
const drawer = app.slice(start, end);

test('individual assets have the four design tabs while group editors stay intact', () => {
  assert.match(drawer, /isSimpleAsset = !isColorGroup && !isGroupAsset && !isVariantGroup/);
  assert.match(drawer, /\['general', 'Général'\], \['placement', 'Règles de placement'\], \['textures', 'Textures'\], \['packs', 'Packs'\]/);
  assert.match(drawer, /isSimpleAsset && <nav className="asset-drawer-tabs"/);
  assert.match(drawer, /\{isColorGroup && \(/);
  assert.match(drawer, /\{isVariantGroup && \(/);
  assert.match(drawer, /\{isGroupAsset && \(/);
});

test('all existing editable asset fields are preserved across tabs', () => {
  for (const field of ['batDescription', 'labelEn', 'description', 'adminOnly', 'mountType', 'placementRule', 'collisionEnabled', 'depthLocked6cm', 'textureSlots', 'packPricing']) {
    assert.ok(drawer.includes(field), field);
  }
  assert.match(drawer, /style=\{\{ display: isSimpleAsset && activeTab !== 'placement'/);
  assert.match(drawer, /style=\{\{ display: activeTab !== 'textures'/);
  assert.match(drawer, /style=\{\{ display: isSimpleAsset && activeTab !== 'packs'/);
  assert.match(drawer, /onClick=\{saveDraft\}/);
});

test('list view has separate columns, selection and row actions', () => {
  assert.match(app, /className="asset-library-table"/);
  for (const heading of ['Catégorie', 'Packs', 'Format', 'Taille', 'Statut']) assert.ok(app.includes(`<th>${heading}</th>`), heading);
  assert.match(app, /aria-label="Sélectionner la page"/);
  assert.match(app, /className="asset-library-row-menu"/);
  assert.match(css, /\.asset-library-table tbody tr:hover/);
  assert.match(css, /\.asset-drawer--simple \.asset-drawer-content/);
});
