import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const categories = ['Sol & Cloisons', 'Mobilier', 'Signalétique', 'Multimédia', 'Enseignes', 'Électricité'];

function loadFunction(api, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

function runtime() {
  const api = vm.createContext({ assetCategoryOptions: categories });
  for (const name of ['assetCategoryLabel', 'assetBusinessCategoryLabel', 'adminAssetMatchesCategory']) {
    loadFunction(api, name);
  }
  return api;
}

test('every individual asset remains visible in its configured admin category', () => {
  const api = runtime();
  const triplette = {
    type: 'asset-triplette',
    label: 'Triplette',
    dimensions: { category: 'Électricité' },
  };
  const reserveGroup = {
    type: 'reserve-group',
    dimensions: {
      isGroup: true,
      category: 'Mobilier',
      children: [{ type: triplette.type }],
    },
  };

  assert.equal(api.adminAssetMatchesCategory(triplette, 'Électricité', [triplette, reserveGroup]), true);
  assert.equal(api.adminAssetMatchesCategory(triplette, 'Mobilier', [triplette, reserveGroup]), false);

  for (const category of categories) {
    const asset = { type: `asset-${category}`, dimensions: { category } };
    assert.equal(api.adminAssetMatchesCategory(asset, category, [asset]), true);
  }
});
