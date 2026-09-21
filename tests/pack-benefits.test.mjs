import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { normalizePackBenefits, scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance, inheritCurrentPackBenefits } from '../supabase/functions/_shared/packBenefits.js';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
function loadFunction(api, source, name) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

test('allowance is capped at spend and never refunded; included-item packs are unchanged', () => {
  for (const [total, applied, remaining, supplement] of [[0, 0, 1000, 0], [750, 750, 250, 0], [1000, 1000, 0, 0], [1250, 1000, 0, 250]]) {
    const result = packAllowanceBreakdown(total, { mode: 'allowance', allowanceAmount: 1000 });
    assert.equal(result.allowanceApplied, applied);
    assert.equal(result.allowanceRemaining, remaining);
    assert.equal(result.accessoriesSupplement, supplement);
  }
  assert.equal(packAllowanceBreakdown(1250, { allowanceAmount: 1000 }).accessoriesSupplement, 1250);
  assert.equal(packAllowanceBreakdown(10, { mode: 'allowance', allowanceAmount: 0 }).allowanceLine, null);
  assert.equal(normalizePackBenefits({ mode: 'allowance', allowanceAmount: -4 }).allowanceAmount, 0);
  assert.equal(normalizePackBenefits({ allowanceAmount: 'bad' }).allowanceAmount, 0);
  assert.equal(packAllowanceBreakdown(1000.01, { mode: 'allowance', allowanceAmount: 1000 }).accessoriesSupplement, 0.01);
});

test('an existing SITL scene inherits its current 1600 euro pack without Monday synchronization', () => {
  const old = { client_status: 'draft', source_payload: { options: { wallColor: 'red' }, pricing: { lines: [{ type: 'desk', total: 500 }] } },
    salon_offers: { metadata: { packBenefits: { mode: 'allowance', allowanceAmount: 1600 } } } };
  const updated = inheritCurrentPackBenefits(old);
  assert.equal(scenePackBenefits(updated).allowanceAmount, 1600);
  assert.equal(packAllowanceBreakdown(500, scenePackBenefits(updated)).accessoriesSupplement, 0);
  assert.equal(packAllowanceBreakdown(500, scenePackBenefits(updated)).allowanceRemaining, 1100);
  assert.deepEqual(updated.source_payload.options, old.source_payload.options);
  assert.deepEqual(updated.source_payload.pricing.lines, old.source_payload.pricing.lines);
  assert.equal(old.source_payload.packBenefits, undefined);
  const confirmed = { ...old, client_status: 'configured', source_payload: { packBenefits: { mode: 'allowance', allowanceAmount: 1000 } } };
  assert.equal(inheritCurrentPackBenefits(confirmed), confirmed);
  assert.equal(scenePackBenefits(confirmed).allowanceAmount, 1000);
  assert.equal(inheritCurrentPackBenefits({ client_status: 'draft' }).source_payload, undefined);
});

test('scene loading resolves pack benefits before automatic objects and preset defaults', () => {
  const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const api = vm.createContext({ inheritCurrentPackBenefits, scenePackBenefits,
    dedupeIncludedReceptionDesks: (items) => items,
    fixedWallHeight: 2.5,
    normalizeSceneItem: (item) => item,
  });
  for (const name of ['dbSceneToScene', 'applyPresetDefaultColorOptions', 'mergePresetDefaultsIntoDraftOptions']) loadFunction(api, store, name);
  const result = api.dbSceneToScene({ client_status: 'draft', source_payload: {},
    salon_offers: { metadata: { packBenefits: { mode: 'allowance', allowanceAmount: 1600 } } },
    stand_presets: { base_config: { autoSpotsRule: { rail3Type: 'rail' } } },
  });
  assert.equal(result.source_payload.packBenefits.allowanceAmount, 1600);
  assert.equal(result.source_payload.options.ledRailsEnabled, false);
  assert.equal(result.source_payload.options.autoSpotsRule, null);
});

test('all objects and options consume one allowance; insurance is separate and recalculation is idempotent', () => {
  const lines = [
    { type: 'desk', total: 753 }, { type: 'logo', total: 279 }, { type: 'color', total: 79 },
    { type: 'electricity', total: 49 }, { type: 'wall-cover', total: 288 },
    { type: 'mandatory-furniture-insurance', total: 60.21 },
  ];
  const benefits = { mode: 'allowance', allowanceAmount: 1000 };
  const result = withPackAllowance(lines, benefits);
  assert.ok(Math.abs(result.reduce((sum, line) => sum + line.total, 0) - 508.21) < 1e-10);
  assert.deepEqual(withPackAllowance(result, benefits), result);
  const covered = withPackAllowance(lines, { mode: 'allowance', allowanceAmount: 5000 });
  assert.ok(Math.abs(covered.reduce((sum, line) => sum + line.total, 0) - 60.21) < 1e-10);
  assert.deepEqual(withPackAllowance(result, { mode: 'included-items' }), lines);
});

test('scene pricing deducts the allowance after objects, shared options, covers, floor and colours, before insurance', () => {
  const api = vm.createContext({ normalizePackBenefits, scenePackBenefits, packAllowanceBreakdown,
    roundCurrency: (value) => Math.round(value * 100) / 100,
    normalizeBaseItemsForUi: (value) => value,
    baseItemsToCountMap: () => new Map(),
    mergeBaseUsageRows: (value) => value,
    automaticBaseUsageRows: () => [],
    findCatalogEntry: () => ({ label: 'TV', price: 600 }),
    cartItemBasePrice: () => 600,
    textureSlotColorSupplement: () => 0,
    isFurnitureInsuranceEligible: () => false,
    pricingLineLabelForItems: () => 'TV', itemOptionLines: () => [], uniqueTextValues: (value) => value,
    itemReferenceWithOptions: () => '', assetReference: () => '',
    counterVariantUpgradeOptionLine: () => null, counterColorOptionLine: () => null, counterLogoOptionLine: () => null,
    globalSharedOptionLines: () => [{ type: 'technician', total: 100 }],
    isIncludedColorSelection: () => false,
    formatNumber: String,
    wallCoverEnabledForSurface: () => true,
    roundLinearMeters: (value) => value,
    wallCoverUnitPrice: 288,
    furnitureInsuranceLine: () => ({ type: 'mandatory-furniture-insurance', total: 25 }),
  });
  for (const name of ['calculateScenePricing', 'sceneBaseItems', 'sceneHasBaseItems', 'isIncludedSceneItem', 'countSceneItems', 'mergeIncludedCountMaps', 'wallCoverIncludedLinearMeters']) loadFunction(api, appSource, name);
  const scene = { source_payload: { packBenefits: { mode: 'allowance', allowanceAmount: 1000 }, baseItems: [{ type: 'tv', quantity: 1 }] } };
  const pricing = api.calculateScenePricing({ catalog: [], items: [{ id: 'tv', type: 'tv' }], scene,
    colorSelections: [{ usage: 'Moquette', color: { price: 10 }, quantityM2: 2 }],
    technicalFloor: { id: 'floor', price: 5, area: 10 }, wallCoverSurfaces: [{ width: 2 }],
  });
  assert.equal(pricing.grossTotal, 1371);
  assert.equal(pricing.total, 371);
  assert.equal(pricing.allowanceApplied, 1000);
  assert.equal(pricing.lines.reduce((sum, line) => sum + line.total, 0), pricing.total);
  assert.equal(pricing.baseItems.length, 0);
  assert.equal(pricing.billableCounts.get('tv'), 1);
});

test('BDC keeps the negative allowance, including fully covered orders, without accepting arbitrary negative prices', () => {
  const api = vm.createContext({ packAllowanceLineType,
    roundCurrency: (value) => Math.round(value * 100) / 100,
    findCatalogEntry: () => null, assetReference: () => '', uniqueTextValues: (value) => value,
    purchaseOrderBaseLabel: (value) => value, purchaseOrderDisplayLabel: (value) => value,
  });
  for (const name of ['normalizePurchaseOrderLines', 'purchaseOrderFromPricingLines']) loadFunction(api, appSource, name);
  for (const amount of [750, 1250]) {
    const lines = withPackAllowance([{ type: 'desk', label: 'Comptoir', quantity: 1, unitPrice: amount, total: amount }], { mode: 'allowance', allowanceAmount: 1000 });
    const order = api.purchaseOrderFromPricingLines(lines);
    assert.equal(order.total, Math.max(0, amount - 1000));
    assert.equal(order.lines.at(-1).type, packAllowanceLineType);
    assert.equal(order.lines.at(-1).total, -Math.min(amount, 1000));
  }
  assert.equal(api.normalizePurchaseOrderLines([{ type: 'invalid', quantity: 1, total: -100 }]).length, 0);
});

test('allowance scenes cannot regain automatic pack LEDs from preset defaults on reload', () => {
  const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const api = vm.createContext({ scenePackBenefits });
  for (const name of ['applyPresetDefaultColorOptions', 'mergePresetDefaultsIntoDraftOptions']) loadFunction(api, storeSource, name);
  const result = api.applyPresetDefaultColorOptions({ client_status: 'in_progress',
    source_payload: { packBenefits: { mode: 'allowance', allowanceAmount: 1000 } },
    stand_presets: { base_config: { autoSpotsRule: { rail3Type: 'rail' } } },
  });
  assert.equal(result.options.ledRailsEnabled, false);
  assert.equal(result.options.autoSpotsRule, null);
});

test('allowance scenes inherit automatic reserve rules and charge the default reserve against the allowance', () => {
  const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const presetReserveRules = { small: { includedType: 'reserve-2m2', includedLabel: 'Réserve 2 m²', options: [] } };
  const storeApi = vm.createContext({ scenePackBenefits });
  for (const name of ['applyPresetDefaultColorOptions', 'mergePresetDefaultsIntoDraftOptions']) loadFunction(storeApi, storeSource, name);
  const sourcePayload = storeApi.applyPresetDefaultColorOptions({
    client_status: 'draft',
    source_payload: { packBenefits: { mode: 'allowance', allowanceAmount: 1600 }, reserveRules: {} },
    stand_presets: { base_config: { reserveRules: presetReserveRules } },
  });
  assert.equal(sourcePayload.reserveRules.small.includedType, 'reserve-2m2');
  assert.equal(sourcePayload.pricing.reserveRules.small.includedType, 'reserve-2m2');

  const reserveRuleBands = [{ id: 'small', label: 'Petit stand', minArea: 0, maxArea: 20, includedLabel: 'Réserve' }];
  const api = vm.createContext({ scenePackBenefits, reserveRuleBands });
  for (const name of ['normalizeComplementaryOptions', 'normalizeReserveRules', 'sceneReserveRules']) loadFunction(api, appSource, name);
  const rules = api.sceneReserveRules({
    source_payload: { packBenefits: { mode: 'allowance', allowanceAmount: 1600 }, reserveRules: presetReserveRules },
  });
  assert.equal(rules.small.includedType, 'reserve-2m2');
  assert.equal(rules.small.chargeIncluded, true);

  const itemApi = vm.createContext({
    normalizeComplementaryOptions: api.normalizeComplementaryOptions,
    findCatalogEntry: (_catalog, type) => ({ type, label: 'Réserve 2 m²', price: 450 }),
    reserveOptionPrice: (_option, entry) => entry.price,
    makeItem: (type) => ({ type, options: {} }),
    constrainItem: (item) => item,
  });
  loadFunction(itemApi, appSource, 'makeAutomaticReserveItems');
  const [reserve] = itemApi.makeAutomaticReserveItems(rules.small, '', [], 5, 4, 'back', 'SITL 2027', {});
  assert.equal(reserve.included, false);
  assert.equal(reserve.priceMode, 'billable');
  assert.equal(reserve.options.unitPrice, 450);
});

test('a full BDC still displays the allowance within its 15 template rows and retains the correct sum', () => {
  const api = vm.createContext({ packAllowanceLineType, roundCurrency: (value) => Math.round(value * 100) / 100 });
  loadFunction(api, appSource, 'purchaseOrderTemplateRows');
  const lines = withPackAllowance(Array.from({ length: 18 }, (_, index) => ({ type: `object-${index}`, total: 100 })), { mode: 'allowance', allowanceAmount: 1000 });
  const rows = api.purchaseOrderTemplateRows(lines);
  assert.equal(rows.length, 15);
  assert.equal(rows.at(-1).type, packAllowanceLineType);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 800);
});

test('the actual BDC template stores a negative allowance and net HT/VAT/TTC totals', async () => {
  const template = readFileSync(new URL('../public/templates/bon-commande-template.pdf', import.meta.url));
  const api = vm.createContext({ PDFDocument, StandardFonts, rgb, Blob, Uint8Array, console, packAllowanceLineType,
    roundCurrency: (value) => Math.round(value * 100) / 100,
    uniqueTextValues: (values) => [...new Set(values)],
    fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from(template).buffer }),
  });
  for (const name of ['fillPurchaseOrderTemplate', 'purchaseOrderTemplateRows', 'purchaseOrderTemplateFieldMap', 'drawPurchaseOrderHeaderLine', 'setPdfFieldAny', 'moneyPdf', 'toPdfWinAnsi', 'truncatePdfText']) loadFunction(api, appSource, name);
  const lines = withPackAllowance([{ type: 'desk', label: 'Comptoir accueil', quantity: 1, unitPrice: 1250, total: 1250 }], { mode: 'allowance', allowanceAmount: 1000 });
  const blob = await api.fillPurchaseOrderTemplate({ lines, total: 250 });
  const document = await PDFDocument.load(await blob.arrayBuffer());
  const form = document.getForm();
  const fields = api.purchaseOrderTemplateFieldMap(form);
  assert.match(form.getTextField(fields.rows[1].description).getText(), /Forfait accessoires/);
  assert.equal(form.getTextField(fields.rows[1].total).getText(), '-1 000,00 €');
  assert.equal(form.getTextField(fields.total).getText(), '250,00 €');
  assert.equal(form.getTextField(fields.tva).getText(), '50,00 €');
  assert.equal(form.getTextField(fields.totalTtc).getText(), '300,00 €');
});

test('pack settings preserve unrelated metadata and clear base quotas only in allowance mode', async () => {
  const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const api = vm.createContext({ normalizePackBenefits, supabase: null });
  for (const name of ['saveSalonOfferBaseItems', 'normalizeBaseItems']) loadFunction(api, storeSource, name);
  const offer = { id: 'offer', metadata: { custom: 'keep' } };
  const result = await api.saveSalonOfferBaseItems(offer, [{ type: 'desk', quantity: 1 }], { mode: 'allowance', allowanceAmount: '1200' });
  assert.equal(result.metadata.custom, 'keep');
  assert.equal(result.metadata.baseItems.length, 0);
  assert.equal(result.metadata.packBenefits.allowanceAmount, 1200);
  const legacy = await api.saveSalonOfferBaseItems(offer, [{ type: 'desk', quantity: 1 }]);
  assert.equal(legacy.metadata.baseItems.length, 1);
});
