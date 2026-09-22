import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(api, name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(appSource.slice(start, appSource.indexOf('\n}\n', start) + 2), api);
}

function runtime() {
  const api = vm.createContext({});
  for (const name of [
    'normalizeTextValue',
    'normalizeSalonLabel',
    'slugForType',
    'packNameSort',
    'uniqueByNormalized',
    'sceneOfferLabel',
    'legacySalonPackNames',
    'assetPacks',
    'normalizePackLabel',
    'samePackLabel',
    'assetMatchesPack',
    'packPricingKey',
    'legacySalonForPack',
    'getPackPricing',
    'firstPriceValue',
    'assetUnitPrice',
    'assetReference',
  ]) loadFunction(api, name);
  return api;
}

test('pack assignments control visibility and keep independent prices and references', () => {
  const api = runtime();
  const asset = {
    dimensions: {
      packs: ['Confort', 'Prestige'],
      packPricing: {
        confort: { pack: 'Confort', price: '120', reference: 'CONF-01' },
        prestige: { pack: 'Prestige', price: '180', reference: 'PRES-01' },
      },
    },
  };

  assert.equal(api.assetMatchesPack(asset, 'CONFORT'), true);
  assert.equal(api.assetMatchesPack(asset, 'Prestige'), true);
  assert.equal(api.assetMatchesPack(asset, 'Signature'), false);
  assert.equal(api.assetUnitPrice(asset, 'Confort'), 120);
  assert.equal(api.assetUnitPrice(asset, 'Prestige'), 180);
  assert.equal(api.assetReference(asset, 'Confort'), 'CONF-01');
  assert.equal(api.assetReference(asset, 'Prestige'), 'PRES-01');
});

test('legacy salon assignments remain compatible during deployment', () => {
  const api = runtime();
  const smclAsset = {
    dimensions: {
      salons: ['SMCL 2026'],
      salonPricing: { 'smcl-2026': { salon: 'SMCL 2026', price: '79', reference: 'SMCL-79' } },
    },
  };
  const sitlAsset = { dimensions: { salons: ['SITL 2027'] } };

  assert.deepEqual([...api.assetPacks(smclAsset)], ['Confort', 'Prestige']);
  assert.equal(api.assetMatchesPack(smclAsset, 'Confort'), true);
  assert.equal(api.assetMatchesPack(smclAsset, 'Signature'), false);
  assert.equal(api.assetUnitPrice(smclAsset, 'Prestige'), 79);
  assert.equal(api.assetReference(smclAsset, 'Confort'), 'SMCL-79');
  assert.deepEqual([...api.assetPacks(sitlAsset)], ['Signature']);
  assert.equal(api.assetMatchesPack(sitlAsset, 'Business'), true);
});

test('the data migration maps SMCL to Confort and Prestige and SITL to Signature', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260922140639_migrate_object_assignments_to_packs.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('Confort', 10, has_smcl\)/);
  assert.match(sql, /\('Prestige', 30, has_smcl\)/);
  assert.match(sql, /\('Signature', 20, has_sitl\)/);
  assert.match(sql, /'confort'.*'smcl-2026'/s);
  assert.match(sql, /'prestige'.*'smcl-2026'/s);
  assert.match(sql, /'signature'.*'sitl-2027'/s);
});
