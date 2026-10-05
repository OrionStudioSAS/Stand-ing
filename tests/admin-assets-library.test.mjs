import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const start = source.indexOf('function adminAssetMatchesLibraryFilters(');
const code = source.slice(start, source.indexOf('\n}\n', start) + 2);
const api = vm.createContext({
  assetBusinessCategoryLabel: (asset) => asset.dimensions?.category || 'Mobilier',
  assetCategoryLabel: (asset) => asset.dimensions?.category || 'Mobilier',
  assetPacks: (asset) => asset.dimensions?.packs || [],
  assetStatus: (asset) => asset.is_active ? 'active' : 'inactive',
  assetFormat: (asset) => asset.model_url?.endsWith('.glb') ? 'GLB' : 'Natif',
  samePackLabel: (a, b) => a.toLowerCase() === b.toLowerCase(),
  normalizeTextValue: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
});
vm.runInContext(code, api);

const assets = [
  { type: 'bar', label: 'Bar chromé', is_active: true, model_url: '/bar.glb', dimensions: { category: 'Mobilier', packs: ['Signature'] } },
  { type: 'group', label: 'Ensemble accueil', is_active: true, dimensions: { isGroup: true, category: 'Mobilier', packs: ['Confort'] } },
  { type: 'color', label: 'Finitions', is_active: false, dimensions: { isColorGroup: true, category: 'Mobilier', packs: ['Prestige'], adminOnly: true } },
];
const salons = [{ name: 'SITL 2027', offers: [{ name: 'Signature' }] }, { name: 'SMCL 2026', offers: [{ name: 'Confort' }, { name: 'Prestige' }] }];
const matches = (asset, filters) => api.adminAssetMatchesLibraryFilters(asset, assets, [], filters, salons);

test('library tabs separate assets, object groups and color groups', () => {
  assert.equal(matches(assets[0], { tab: 'Assets' }), true);
  assert.equal(matches(assets[1], { tab: 'Assets' }), false);
  assert.equal(matches(assets[1], { tab: 'Groupes d’objets' }), true);
  assert.equal(matches(assets[2], { tab: 'Groupes de couleurs' }), true);
});

test('pack multi-selection, salon, status, format and visibility filter actual records', () => {
  assert.equal(matches(assets[0], { packs: ['Prestige', 'Signature'] }), true);
  assert.equal(matches(assets[1], { packs: ['Prestige', 'Signature'] }), false);
  assert.equal(matches(assets[0], { salon: 'SITL 2027', status: 'active', format: 'GLB', visibility: 'public' }), true);
  assert.equal(matches(assets[0], { salon: 'SMCL 2026' }), false);
  assert.equal(matches(assets[2], { visibility: 'admin', status: 'inactive' }), true);
  assert.equal(matches(assets[2], { visibility: 'public' }), false);
});

test('both searches work together and accents do not prevent matching', () => {
  assert.equal(matches(assets[0], { searches: ['bar', 'chrome'] }), true);
  assert.equal(matches(assets[0], { searches: ['bar', 'podium'] }), false);
});

test('new library keeps all upload/create actions and has responsive list/grid views', () => {
  assert.match(source, /ref=\{objInputRef\}[\s\S]*?onUploadAssetFolder/);
  assert.match(source, /ref=\{glbInputRef\}[\s\S]*?onUploadAssetFolder/);
  assert.match(source, /ref=\{colorInputRef\}[\s\S]*?onUploadColorGroup/);
  assert.match(source, /setGroupCreatorOpen\(true\)/);
  assert.match(source, /setVariantGroupCreatorOpen\(true\)/);
  assert.match(css, /\.asset-library-grid\.list/);
  assert.match(css, /@media \(max-width: 550px\)[^\n]*\.asset-library-grid/);
});
