import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { manualOrderRowsToPricingLines, normalizeManualOrderCategory, replaceManualOrderPricingLines, mergeManualOrderPricing } from '../src/manualOrderLines.js';
import { scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const money = (value) => Math.round(Number(value) * 100) / 100;
const row = { id: 'coffee', label: 'Machine a cafe', reference: 'COF-1', category: 'furniture', assetType: 'coffee-machine', quantity: 2, unitPrice: 75 };

function load(api, source, name) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

function pricingApi() {
  const api = vm.createContext({
    manualOrderRowsToPricingLines, normalizeManualOrderCategory, replaceManualOrderPricingLines,
    roundCurrency: money, scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance,
    isSignatureScene: (scene) => scene.offer === 'Signature',
    sceneBaseItems: () => [], sceneHasBaseItems: () => false,
    isIncludedSceneItem: () => false, countSceneItems: () => new Map(), baseItemsToCountMap: () => new Map(),
    mergeBaseUsageRows: () => [], automaticBaseUsageRows: () => [], globalSharedOptionLines: () => [],
    furnitureInsuranceLine: () => null, wallCoverIncludedLinearMeters: () => 0,
    findCatalogEntry: () => null, assetReference: () => '', uniqueTextValues: (values) => values,
    purchaseOrderBaseLabel: (label) => label, purchaseOrderDisplayLabel: (label) => label,
    sceneAdminCatalog: () => [], sceneAllAdminItems: () => [], sceneOfferLabel: (scene) => scene.offer,
    purchaseOrderHeaderInfo: () => ({}), enrichPurchaseOrderLinesWithFallback: (lines) => lines,
  });
  for (const name of ['manualPurchaseOrderLines', 'calculateScenePricing', 'normalizePurchaseOrderLines', 'scenePurchaseOrder', 'validationCategoryFromLine', 'validationLineHandledByOptions', 'validationIsCounterLogoLine']) load(api, app, name);
  return api;
}

test('manual categories map to real recap sections, including structures and signs', () => {
  for (const [value, category] of [['Sol & Cloisons', 'personalization'], ['Mobilier', 'furniture'], ['Multim\u00e9dia', 'multimedia'], ['Enseignes', 'signage'], ['Signal\u00e9tique', 'signage'], ['\u00c9lectricit\u00e9', 'electricity']]) {
    assert.equal(normalizeManualOrderCategory(value), category);
    assert.equal(normalizeManualOrderCategory(category), category);
  }
  assert.equal(normalizeManualOrderCategory('unknown'), '');
});

test('manual pricing retains category, linked asset, reference, quantities and cents; invalid rows are ignored', () => {
  const lines = manualOrderRowsToPricingLines([row, { ...row, id: 'cents', quantity: 3, unitPrice: 0.1, category: 'Enseignes' }, null,
    { ...row, label: '' }, { ...row, quantity: 0 }, { ...row, unitPrice: -1 }, { ...row, quantity: 'invalid' }]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].total, 150);
  assert.equal(lines[0].assetType, row.assetType);
  assert.equal(lines[0].reference, row.reference);
  assert.equal(lines[1].total, 0.3);
  assert.equal(lines[1].category, 'signage');
  assert.equal(manualOrderRowsToPricingLines([{ ...row, category: undefined }])[0].category, 'furniture');
  assert.deepEqual(manualOrderRowsToPricingLines(null), []);
});

test('scene step 4 pricing includes admin rows exactly once and applies the Signature allowance', () => {
  const api = pricingApi();
  for (const offer of ['Confort', 'Signature']) {
    const scene = { offer, dimensions: { width: 3, depth: 1 }, source_payload: { manualPurchaseOrderLines: [row] } };
    const first = api.calculateScenePricing({ catalog: [], items: [], scene });
    scene.source_payload.pricing = JSON.parse(JSON.stringify(first));
    const reopened = api.calculateScenePricing({ catalog: [], items: [], scene });
    const order = api.scenePurchaseOrder(scene);
    assert.equal(first.total, offer === 'Signature' ? 30 : 150);
    assert.equal(reopened.total, first.total);
    assert.equal(order.total, first.total);
    assert.equal(order.lines.filter((line) => line.type.startsWith('admin-manual-')).length, 1);
  }
});

test('editing or removing manual rows replaces saved prices instead of duplicating stale rows', () => {
  const original = [{ type: 'desk', quantity: 1, unitPrice: 900, total: 900 }, ...manualOrderRowsToPricingLines([row])];
  const updated = mergeManualOrderPricing({ lines: original }, [{ ...row, unitPrice: 100 }], { mode: 'allowance', allowanceAmount: 1000 });
  assert.equal(updated.total, 100);
  assert.equal(updated.grossTotal, 1100);
  assert.equal(updated.allowanceApplied, 1000);
  assert.deepEqual(mergeManualOrderPricing(updated, [{ ...row, unitPrice: 100 }], updated.packBenefits), updated);
  const removed = mergeManualOrderPricing(updated, [], updated.packBenefits);
  assert.equal(removed.total, 0);
  assert.equal(removed.allowanceApplied, 900);
  assert.equal(removed.lines.some((line) => line.type.startsWith('admin-manual-')), false);
});

test('manual rows named reserve, carpet or counter logo remain distinct and respect explicit category', () => {
  const api = pricingApi();
  for (const label of ['Reserve supplementaire', 'Moquette', 'Signaletique comptoir accueil', 'TV']) {
    const line = { type: 'admin-manual-test', label, category: 'personalization' };
    assert.equal(api.validationLineHandledByOptions(line), false);
    assert.equal(api.validationIsCounterLogoLine(line), false);
    assert.equal(api.validationCategoryFromLine(line), 'personalization');
  }
});

test('asset link uses the scene pack reference and price, and maps the configured asset category', () => {
  const api = vm.createContext({ normalizeManualOrderCategory,
    sceneOfferLabel: (scene) => scene.offer,
    assetBusinessCategoryLabel: (asset) => asset.dimensions.category,
    assetToCatalogEntry: (asset) => asset,
    packPricingKey: (label) => label.toLowerCase(), normalizePackLabel: (label) => label.toLowerCase(),
    legacySalonForPack: () => '',
  });
  for (const name of ['requestOrderAssetFields', 'getPackPricing', 'firstPriceValue', 'assetReference', 'assetUnitPrice']) load(api, app, name);
  const asset = { type: 'screen', label: 'Ecran', thumbnail_url: '/screen.png', dimensions: { category: 'Multim\u00e9dia', reference: 'GENERAL', price: 450,
    packPricing: { signature: { reference: 'SIG-TV', price: 300 } } } };
  const linked = api.requestOrderAssetFields(asset, { offer: 'Signature' });
  assert.equal(linked.reference, 'SIG-TV');
  assert.equal(linked.category, 'multimedia');
  assert.equal(linked.unitPrice, 300);
  assert.equal(linked.assetType, 'screen');
  assert.equal(linked.thumbnailUrl, '/screen.png');
  const other = api.requestOrderAssetFields(asset, { offer: 'Prestige' });
  assert.equal(other.reference, 'GENERAL');
  assert.equal(other.unitPrice, 450);
});

function persistenceApi(remote = false) {
  let scenes = [{ id: 'scene-one', offer: 'Confort', source_payload: { specialRequest: { text: 'Please add coffee' }, options: { carpet: 'blue' }, pricing: { lines: [] } }, dimensions: { width: 4, depth: 3 } }];
  let readError = null;
  const api = vm.createContext({ mergeManualOrderPricing, scenePackBenefits, fixedWallHeight: 2.5,
    readLocalScenes: () => scenes, writeLocalScenes: (next) => { scenes = next; }, saveSceneItems: async () => {},
    supabase: remote ? { from(table) {
      assert.equal(table, 'scenes');
      return { select() { return { eq(column, id) { assert.equal(column, 'id'); return { async single() { return { data: scenes.find((scene) => scene.id === id), error: readError }; } }; } }; },
        update(payload) { return { async eq(column, id) { assert.equal(column, 'id'); scenes = scenes.map((scene) => scene.id === id ? { ...scene, ...payload } : scene); return { error: null }; } }; } };
    } } : null,
  });
  for (const name of ['sceneWithManualOrderLines', 'saveSceneManualOrderLines', 'preserveSceneReadOnly', 'persistScene']) load(api, store, name);
  return { api, getScenes: () => scenes, failRead: (error) => { readError = error; } };
}

for (const remote of [false, true]) {
  test(`manual order persistence survives stale scene saves (${remote ? 'Supabase adapter' : 'local storage'})`, async () => {
    const { api, getScenes } = persistenceApi(remote);
    const staleScene = structuredClone(getScenes()[0]);
    const saved = await api.saveSceneManualOrderLines(staleScene, [row]);
    assert.equal(saved.source_payload.pricing.total, 150);
    assert.equal(getScenes()[0].source_payload.options.carpet, 'blue');
    assert.equal(getScenes()[0].source_payload.specialRequest.text, 'Please add coffee');
    const resaved = await api.persistScene({ ...staleScene, items: [], source_payload: { ...staleScene.source_payload, options: { carpet: 'red' } } });
    assert.equal(resaved.source_payload.pricing.total, 150);
    assert.equal(resaved.source_payload.manualPurchaseOrderLines[0].category, 'furniture');
    assert.equal(resaved.source_payload.manualPurchaseOrderLines[0].assetType, row.assetType);
    assert.equal(getScenes()[0].source_payload.options.carpet, 'red');
    await api.saveSceneManualOrderLines(staleScene, []);
    const final = await api.persistScene(saved);
    assert.equal(final.source_payload.manualPurchaseOrderLines.length, 0);
    assert.equal(final.source_payload.pricing.total, 0);
  });
}

test('read failures abort scene writes instead of discarding unknown manual order rows', async () => {
  const { api, getScenes, failRead } = persistenceApi(true);
  const error = new Error('Read refused');
  failRead(error);
  await assert.rejects(api.persistScene(getScenes()[0]), error);
  await assert.rejects(api.saveSceneManualOrderLines(getScenes()[0], [row]), error);
  assert.equal(getScenes()[0].source_payload.manualPurchaseOrderLines, undefined);
});
