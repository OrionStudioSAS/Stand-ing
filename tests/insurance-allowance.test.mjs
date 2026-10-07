import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';
import { manualOrderRowsToPricingLines, replaceManualOrderPricingLines, mergeManualOrderPricing } from '../src/manualOrderLines.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const money = (value) => Math.round(Number(value) * 100) / 100;

function pricingApi() {
  const api = vm.createContext({
    scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance,
    manualOrderRowsToPricingLines, replaceManualOrderPricingLines, roundCurrency: money,
    isSignatureScene: (scene) => scene.offer === 'Signature',
    sceneBaseItems: () => [], sceneHasBaseItems: () => false, isIncludedSceneItem: () => false,
    baseItemsToCountMap: () => new Map(), mergeBaseUsageRows: () => [], automaticBaseUsageRows: () => [],
    findCatalogEntry: (catalog, type) => catalog.find((entry) => entry.type === type),
    cartItemBasePrice: (_item, entry) => entry.price, textureSlotColorSupplement: () => 0,
    pricingLineLabelForItems: (_items, entry) => entry.label, itemOptionLines: () => [],
    uniqueTextValues: (values) => [...new Set(values)], itemReferenceWithOptions: () => '', assetReference: () => '',
    counterVariantUpgradeOptionLine: () => null, counterColorOptionLine: () => null, counterLogoOptionLine: () => null,
    globalSharedOptionLines: () => [], wallCoverIncludedLinearMeters: () => 0,
    sceneAdminCatalog: (assets) => assets, sceneAllAdminItems: (scene) => scene.items,
    sceneOfferLabel: (scene) => scene.offer, enrichPurchaseOrderLinesWithFallback: (lines) => lines,
    purchaseOrderHeaderInfo: () => ({}), purchaseOrderBaseLabel: (label) => label, purchaseOrderDisplayLabel: (label) => label,
  });
  const start = source.indexOf('const furnitureInsuranceRows =');
  vm.runInContext(source.slice(start, source.indexOf('\n];', start) + 3), api);
  for (const name of ['normalizeTextValue', 'isFurnitureInsuranceEligible', 'furnitureInsuranceLine', 'countSceneItems',
    'manualPurchaseOrderLines', 'calculateScenePricing', 'scenePurchaseOrder', 'normalizePurchaseOrderLines']) {
    const offset = source.indexOf(`function ${name}(`);
    assert.ok(offset >= 0, name);
    vm.runInContext(source.slice(offset, source.indexOf('\n}\n', offset) + 2), api);
  }
  return api;
}

test('Signature covers furniture insurance before charging only the combined excess', () => {
  const api = pricingApi();
  for (const [price, total, remaining] of [[700, 0, 15.26], [715.26, 0, 0], [750, 34.74, 0]]) {
    const catalog = [{ type: 'counter', label: 'Comptoir accueil AMCO', price }];
    const scene = { offer: 'Signature', dimensions: { width: 5, depth: 4 }, items: [{ id: 'desk', type: 'counter' }] };
    const pricing = api.calculateScenePricing({ catalog, items: scene.items, scene });
    assert.equal(pricing.allowanceAmount, 800);
    assert.equal(pricing.furnitureInsuranceBase, price);
    assert.equal(pricing.insuranceLine.total, 84.74);
    assert.equal(pricing.grossTotal, money(price + 84.74));
    assert.equal(pricing.allowanceApplied, Math.min(800, money(price + 84.74)));
    assert.equal(pricing.allowanceRemaining, remaining);
    assert.equal(pricing.accessoriesSupplement, total);
    assert.equal(pricing.total, total);
    assert.equal(money(pricing.lines.reduce((sum, line) => sum + line.total, 0)), total);
    scene.source_payload = { pricing: JSON.parse(JSON.stringify(pricing)) };
    assert.equal(api.calculateScenePricing({ catalog, items: scene.items, scene }).total, total);
    const order = api.scenePurchaseOrder(scene, catalog);
    assert.equal(order.total, total);
    assert.equal(order.lines.filter((line) => line.type === 'mandatory-furniture-insurance').length, 1);
    assert.equal(order.lines.find((line) => line.type === packAllowanceLineType).total, -pricing.allowanceApplied);
  }
});

test('non-allowance packs and the furniture insurance eligibility and tariff remain unchanged', () => {
  const api = pricingApi();
  const scene = { offer: 'Confort', dimensions: { width: 5, depth: 4 } };
  const catalog = [{ type: 'counter', label: 'Comptoir accueil AMCO', price: 700 }, { type: 'tv', label: 'TV', price: 700 }];
  const insured = api.calculateScenePricing({ catalog, scene, items: [{ type: 'counter' }] });
  assert.equal(insured.insuranceLine.total, 84.74);
  assert.equal(insured.total, 784.74);
  assert.equal(insured.allowanceApplied, 0);
  const other = api.calculateScenePricing({ catalog, scene: { ...scene, offer: 'Signature' }, items: [{ type: 'tv' }] });
  assert.equal(other.insuranceLine, null);
  assert.equal(other.allowanceApplied, 700);
  assert.equal(other.allowanceRemaining, 100);
});

test('old saved BDC discounts are recalculated including insurance without duplicating it', () => {
  const api = pricingApi();
  const scene = { offer: 'Signature', dimensions: { width: 5, depth: 4 }, items: [], source_payload: { pricing: { lines: [
    { type: 'counter', label: 'Comptoir accueil AMCO', quantity: 1, unitPrice: 700, total: 700 },
    { type: 'mandatory-furniture-insurance', label: 'Assurance mobilier', quantity: 1, unitPrice: 84.74, total: 84.74, mandatory: true },
    { type: packAllowanceLineType, label: 'Forfait accessoires offert', quantity: 1, unitPrice: -700, total: -700 },
  ] } } };
  const order = api.scenePurchaseOrder(scene);
  assert.equal(order.total, 0);
  assert.equal(order.lines.length, 3);
  assert.equal(order.lines.find((line) => line.type === packAllowanceLineType).total, -784.74);
});

test('editing admin manual lines includes existing insurance in saved allowance usage and totals', () => {
  const benefits = scenePackBenefits({ offer: 'Signature', dimensions: { width: 5, depth: 4 } });
  const pricing = { lines: [
    { type: 'counter', total: 700 }, { type: 'mandatory-furniture-insurance', total: 84.74 },
    { type: packAllowanceLineType, total: -700 },
  ] };
  const rows = [{ id: 'service', label: 'Service', quantity: 1, unitPrice: 50 }];
  const updated = mergeManualOrderPricing(pricing, rows, benefits);
  assert.equal(updated.grossTotal, 834.74);
  assert.equal(updated.allowanceApplied, 800);
  assert.equal(updated.total, 34.74);
  assert.deepEqual(mergeManualOrderPricing(updated, rows, benefits), updated);
  const removed = mergeManualOrderPricing(updated, [], benefits);
  assert.equal(removed.total, 0);
  assert.equal(removed.allowanceApplied, 784.74);
  assert.equal(removed.allowanceRemaining, 15.26);
  assert.equal(removed.lines.filter((line) => line.type === 'mandatory-furniture-insurance').length, 1);
});
