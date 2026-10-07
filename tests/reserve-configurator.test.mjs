import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as reserve from '../src/reserveConfigurator.js';
import { scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance } from '../supabase/functions/_shared/packBenefits.js';
import { manualOrderRowsToPricingLines, replaceManualOrderPricingLines, normalizeManualOrderCategory } from '../src/manualOrderLines.js';

const {
  createReserveDraft, serializeReserveDraft, reserveCatalogEntries, reserveFrame, reserveSlots,
  moveReservePart, replaceReservePart, addReservePart, removeReservePart, rotateReservePart,
  validateReserveDraft, reserveChildrenFromDraft, reserveCustomizationPricingLines,
  resizeReserveDraft, reserveDraftPlacementBounds,
} = reserve;
const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const wall = { type: 'wall', label: 'Cloison 1 m', modelSize: [1, 2.5, 0.06], modelUrl: '/wall.glb', price: 60 };
const door = { type: 'door', label: 'Porte poignée droite', modelSize: [1, 2.5, 0.25], modelUrl: '/door.glb', price: 100 };
const coded = { ...door, type: 'coded', label: 'Porte avec code', price: 150, dimensions: { reserveComponentRole: 'door', reserveOnly: true, adminOnly: true } };
const coffee = { type: 'coffee', label: 'Machine à café', modelSize: [0.2, 0.35, 0.25], price: 45, dimensions: { reserveComponentRole: 'furniture', reserveOnly: true } };
const fridge = { type: 'fridge', label: 'Frigo AMCO', modelSize: [0.5, 0.85, 0.45], price: 80, dimensions: { reserveComponentRole: 'furniture' } };
const shelf = { type: 'shelf', label: 'Tablette', modelSize: [0.4, 1, 0.3], price: 20, dimensions: { reserveComponentRole: 'furniture' } };
const catalog = [wall, door, coded, coffee, fridge, shelf];
const entry = { type: 'reserve-2', label: 'Réserve 2 m² arrière gauche', isGroup: true, groupSize: [2.48, 2.5, 0.66], price: 200,
  children: [
    { ...wall, id: 'front-left', x: -0.5, y: 0, z: 0, rotation: 0 },
    { ...wall, id: 'front-right', x: 0.5, y: 0, z: 0, rotation: 0 },
    { ...door, id: 'entrance', x: 1, y: 0, z: -0.5, rotation: -90 },
  ], dimensions: { isGroup: true } };
const clone = (value) => JSON.parse(JSON.stringify(value));
const money = (value) => Math.round(Number(value) * 100) / 100;

function appApi(extra = {}) {
  const api = vm.createContext({
    ...reserve, scenePackBenefits, packAllowanceBreakdown, packAllowanceLineType, withPackAllowance,
    manualOrderRowsToPricingLines, replaceManualOrderPricingLines, normalizeManualOrderCategory,
    roundCurrency: money, normalizeModelSize: (size) => size, normalizeTextValue: (value) => String(value || '').toLowerCase(),
    isSignatureScene: (scene) => scene.offer === 'Signature', isSignaturePackLabel: (label) => label === 'Signature',
    sceneBaseItems: () => [], sceneHasBaseItems: () => false, isIncludedSceneItem: (item) => item.included,
    baseItemsToCountMap: () => new Map(), mergeBaseUsageRows: () => [], automaticBaseUsageRows: () => [],
    findCatalogEntry: (list, type) => list.find((asset) => asset.type === type),
    cartItemBasePrice: (item, asset) => item.options?.unitPrice ?? asset.price,
    assetUnitPrice: (asset) => asset.price || 0, assetReference: (asset) => `REF-${asset.type}`,
    textureSlotColorSupplement: () => 0, pricingLineLabelForItems: (_items, asset) => asset.label,
    itemOptionLines: () => [], uniqueTextValues: (values) => [...new Set(values)], itemReferenceWithOptions: () => '',
    counterVariantUpgradeOptionLine: () => null, counterColorOptionLine: () => null, counterLogoOptionLine: () => null,
    globalSharedOptionLines: () => [], wallCoverIncludedLinearMeters: () => 0,
    itemDefaultSize: (item) => item.modelSize || [1, 2.5, 0.1], groupChildRenderY: (part) => part.y || 0,
    itemPlacementBoundsOverride: () => null, isCeilingMountedItem: () => false,
    configuredMarketCategory: (asset) => asset.dimensions?.marketCategory || '', normalizeMarketCategory: () => 'furniture',
    makeItem: (type, _width, _depth, _layout, asset) => ({ ...asset, type, x: 1.2, y: 0, z: -1.1, rotation: 90, options: {} }),
    constrainItem: (item) => item,
    sceneAdminCatalog: (assets) => assets, sceneAllAdminItems: (scene) => scene.items,
    sceneOfferLabel: (scene) => scene.offer, enrichPurchaseOrderLinesWithFallback: (lines) => lines,
    purchaseOrderHeaderInfo: () => ({}), purchaseOrderBaseLabel: (label) => label, purchaseOrderDisplayLabel: (label) => label,
    ...extra,
  });
  const start = source.indexOf('const furnitureInsuranceRows =');
  vm.runInContext(source.slice(start, source.indexOf('\n];', start) + 3), api);
  for (const name of ['rotatePoint', 'childrenBounds', 'itemGroupBounds', 'normalizeComplementaryOptions', 'reserveOptionPrice', 'applyReserveCustomization',
    'makeAutomaticReserveItems', 'isFurnitureInsuranceEligible', 'furnitureInsuranceLine', 'countSceneItems', 'manualPurchaseOrderLines',
    'calculateScenePricing', 'scenePurchaseOrder', 'normalizePurchaseOrderLines', 'salonDebitLeafItems', 'validationLineHandledByOptions', 'validationCategoryFromEntry', 'validationCategoryFromLine']) {
    const offset = source.indexOf(`function ${name}(`);
    assert.ok(offset >= 0, name);
    vm.runInContext(source.slice(offset, source.indexOf('\n}\n', offset) + 2), api);
  }
  return api;
}

test('semantic footprint uses real structural orientation, not erroneous imported groupSize', () => {
  assert.deepEqual(reserveFrame(entry), { width: 2, depth: 1, minX: -1, maxX: 1, minZ: -1, maxZ: 0 });
  const centre = { ...entry, children: [
    { ...wall, x: -0.5, z: -0.4, rotation: 90 }, { ...wall, x: -0.5, z: -1.3, rotation: 90 },
    { ...wall, x: 0.5, z: -0.4, rotation: 90 }, { ...wall, x: 0.5, z: -1.3, rotation: 90 },
    { ...door, x: 0, z: 0.16, rotation: 0 },
  ] };
  const frame = reserveFrame(centre);
  assert.equal(frame.width, 1);
  assert.equal(frame.depth, 2);
  assert.ok(frame.minZ < -1.8 && frame.maxZ < 0.2);
});

test('opening and JSON reloading preserve exact original child transforms', () => {
  const draft = createReserveDraft(entry, null, catalog);
  assert.deepEqual(draft.parts.map(({ x, y, z, rotation }) => ({ x, y, z, rotation })), entry.children.map(({ x, y, z, rotation }) => ({ x, y, z, rotation })));
  assert.deepEqual(draft.requiredSlots.sort(), ['front-0', 'front-1', 'right-0']);
  assert.deepEqual(validateReserveDraft(draft, catalog), []);
  assert.deepEqual(serializeReserveDraft(createReserveDraft(entry, clone(serializeReserveDraft(draft)), catalog)), serializeReserveDraft(draft));
});

test('catalog includes original snapshots and explicitly assigned variants but not the ordinary shop', () => {
  const variant = { type: 'door-variants', dimensions: { reserveComponentRole: 'door', isVariantGroup: true, variantAssets: [coded] } };
  const pool = reserveCatalogEntries(entry, [variant, coffee, { type: 'chair', label: 'Chaise', price: 10 }, { ...fridge, is_active: false },
    { ...coded, type: 'wide-door', modelSize: [1.5, 2.5, 0.1] }]);
  assert.deepEqual(pool.map((asset) => asset.type).sort(), ['coded', 'coffee', 'door', 'wall']);
  assert.deepEqual(validateReserveDraft(createReserveDraft(entry), pool), []);
  const limited = { ...entry, dimensions: { reserveConfigurator: { allowedTypes: ['coffee'] } } };
  assert.deepEqual(reserveCatalogEntries(limited, catalog).map((asset) => asset.type).sort(), ['coffee', 'door', 'wall']);
});

test('monolithic reserves and old half-metre modules cannot be edited as 1 m structures', () => {
  assert.equal(reserve.reserveEditorAvailable(entry), true);
  assert.equal(reserve.reserveEditorAvailable({ ...entry, dimensions: { reserveConfigurator: { enabled: false } } }), false);
  assert.equal(reserve.reserveEditorAvailable({ ...entry, children: [{ ...door, modelSize: [0.5, 2.5, 0.1] }, wall] }), false);
  assert.equal(reserve.reserveEditorAvailable({ ...entry, children: [{ type: 'single-model', label: 'Réserve complète' }] }), false);
});

test('LABOSPORT reserve opens the mini editor from the scene pencil, header basket and recap', () => {
  const labosport = { ...entry, type: 'group-reserve-2m2-arriere-droite-mqrsqnfd', label: 'Réserve 2m² arrière droite', children: [
    { ...door, id: 'entrance', x: -0.88, z: -0.5, rotation: -90 },
    { ...wall, id: 'front-left', x: -0.33, z: 0, rotation: 0 },
    { ...wall, id: 'front-right', x: 0.6, z: 0, rotation: 0 },
  ] };
  const selected = { ...labosport, id: 'auto-reserve-medium', autoReserve: true };
  const events = [];
  const api = vm.createContext({
    selected, readOnly: false, availableCatalog: [labosport], assetPackLabel: 'Prestige',
    reserveEditorAvailable: reserve.reserveEditorAvailable,
    isAutomaticReserveItem: (item) => Boolean(item.autoReserve),
    step2OptionKeyForItem: () => 'reserve',
    findCatalogEntry: (list, type) => list.find((asset) => asset.type === type),
    setReserveEditorType: (type) => events.push(['editor', type]),
    setActiveStep: (step) => events.push(['step', step]),
    openOnlyStepOption: (key) => events.push(['option', key]),
    setHeaderPanel: () => {}, setSelectedId: () => {},
    itemConfiguratorEntry: () => labosport, itemEditNeedsConfigurator: () => true,
    setItemConfigModal: () => events.push(['generic-editor']),
  });
  for (const name of ['openStepOptionForItem', 'openSelectedItemConfigurator', 'openCartItemConfigurator', 'openValidationItemConfigurator']) {
    const start = source.indexOf(`  const ${name} =`);
    assert.ok(start >= 0, name);
    vm.runInContext(`${source.slice(start, source.indexOf('\n  };', start) + 5)}\nglobalThis.${name} = ${name};`, api);
  }
  for (const name of ['openSelectedItemConfigurator', 'openCartItemConfigurator', 'openValidationItemConfigurator']) {
    events.length = 0;
    api[name](selected);
    assert.deepEqual(events, [['editor', labosport.type]], name);
  }
  api.readOnly = true;
  for (const name of ['openSelectedItemConfigurator', 'openCartItemConfigurator', 'openValidationItemConfigurator']) {
    events.length = 0;
    api[name](selected);
    assert.ok(!events.some(([event]) => event === 'editor' || event === 'generic-editor'), name);
  }
  api.readOnly = false;
  api.availableCatalog = [{ ...labosport, dimensions: { reserveConfigurator: { enabled: false } } }];
  events.length = 0;
  api.openValidationItemConfigurator(selected);
  assert.deepEqual(events, [['step', 2], ['option', 'reserve']]);
});

test('door swaps with a partition on a 1 m slot and leaves inherited stand walls locked', () => {
  const draft = createReserveDraft(entry, null, catalog);
  const swap = moveReservePart(draft, 'entrance', { x: -0.5, z: 0.1 }, catalog);
  assert.equal(swap.error, '');
  assert.deepEqual(swap.draft.parts.find((part) => part.id === 'entrance'), { ...draft.parts[2], x: -0.5, z: 0, rotation: 0, slotId: 'front-0' });
  assert.equal(swap.draft.parts[0].slotId, 'right-0');
  assert.equal(swap.draft.parts[0].rotation, 270);
  assert.deepEqual(validateReserveDraft(swap.draft, catalog), []);
  const locked = moveReservePart(swap.draft, 'entrance', { x: -0.5, z: -1 }, catalog);
  assert.match(locked.error, /mur du stand/);
  assert.equal(locked.draft, swap.draft);
  assert.deepEqual(draft.parts.map((part) => part.type), ['wall', 'wall', 'door']);
});

test('door variants, reversals and wall-door replacements are supported without enlarging the structure', () => {
  const draft = createReserveDraft(entry, null, catalog);
  const replacement = replaceReservePart(draft, 'entrance', 'coded', catalog);
  assert.equal(replacement.error, '');
  const turned = rotateReservePart(replacement.draft, 'entrance', catalog);
  assert.equal(turned.draft.parts[2].rotation, 90);
  assert.deepEqual(validateReserveDraft(turned.draft, catalog), []);
  assert.equal(replaceReservePart(draft, 'front-left', 'coded', catalog).draft.parts[0].role, 'door');
  assert.ok(replaceReservePart(draft, 'entrance', 'coffee', catalog).error);
});

test('furniture moves freely, remains inside, avoids other equipment and the door approach', () => {
  const added = addReservePart(createReserveDraft(entry, null, catalog), 'coffee', catalog);
  assert.equal(added.error, '');
  const part = added.draft.parts.at(-1);
  const moved = moveReservePart(added.draft, part.id, { x: -0.456, z: -0.65 }, catalog);
  assert.equal(moved.error, '');
  assert.equal(moved.draft.parts.at(-1).x, -0.46);
  const outside = moveReservePart(moved.draft, part.id, { x: -8, z: -8 }, catalog);
  assert.equal(outside.error, '');
  assert.ok(outside.draft.parts.at(-1).x > -1 && outside.draft.parts.at(-1).z > -1);
  assert.deepEqual(validateReserveDraft(outside.draft, catalog), []);
  const blocked = moveReservePart(moved.draft, part.id, { x: 0.8, z: -0.5 }, catalog);
  assert.match(blocked.error, /passage de la porte/);
  assert.equal(blocked.draft, moved.draft);
});

test('equipment height permits a coffee machine over a shelf but rejects actual overlap and excessive heights', () => {
  const draft = createReserveDraft(entry, null, catalog);
  draft.parts.push({ id: 'support', type: 'shelf', role: 'furniture', x: -0.5, y: 0, z: -0.65, rotation: 0, slotId: '' });
  draft.parts.push({ id: 'machine', type: 'coffee', role: 'furniture', x: -0.5, y: 1, z: -0.65, rotation: 0, slotId: '' });
  assert.deepEqual(validateReserveDraft(draft, catalog), []);
  assert.equal(moveReservePart(draft, 'machine', { x: -0.5, z: -0.65, y: 1.2 }, catalog).error, '');
  assert.ok(moveReservePart(draft, 'machine', { x: -0.5, z: -0.65, y: 0.8 }, catalog).error);
  assert.ok(moveReservePart(draft, 'machine', { x: -0.5, z: -0.65, y: 2.3 }, catalog).error);
});

test('a fitted 95 cm shelf remains movable inside a 1 m reserve', () => {
  const fitted = { ...shelf, modelSize: [0.95, 1.8, 0.33] };
  const small = { ...entry, children: [
    { ...wall, id: 'panel', x: 0, z: 0.5, rotation: 0 },
    { ...door, id: 'entrance', x: -0.5, z: 0, rotation: 90 },
    { ...fitted, id: 'fitted', x: 0.3, z: 0, rotation: 90 },
  ] };
  const pool = [wall, door, fitted];
  const moved = moveReservePart(createReserveDraft(small, null, pool), 'fitted', { x: 0.32, z: 0 }, pool);
  assert.equal(moved.error, '');
  assert.deepEqual(validateReserveDraft(moved.draft, pool), []);
});

test('invalid replacement or rotation is atomic and retains the original draft', () => {
  const draft = createReserveDraft(entry, null, catalog);
  draft.parts.push({ id: 'machine', type: 'coffee', role: 'furniture', x: -0.5, y: 0, z: -0.65, rotation: 0, slotId: '' });
  const huge = { ...fridge, type: 'huge', modelSize: [3, 2, 2] };
  const result = replaceReservePart(draft, 'machine', 'huge', [...catalog, huge]);
  assert.ok(result.error);
  assert.equal(result.draft, draft);
  const long = { ...coffee, type: 'long', modelSize: [1.4, 0.3, 0.2] };
  draft.parts.at(-1).type = 'long';
  const rotated = rotateReservePart(draft, 'machine', [...catalog, long]);
  assert.ok(rotated.error);
  assert.equal(rotated.draft, draft);
});

test('saving rejects gaps, missing doors, unknown assets, shifted panels and forged structure heights', () => {
  const draft = createReserveDraft(entry, null, catalog);
  assert.ok(validateReserveDraft(removeReservePart(draft, 'entrance'), catalog).length >= 2);
  const forged = clone(draft);
  forged.parts[0].x += 0.1;
  forged.parts[1].y = 7;
  forged.parts[2].type = 'unknown';
  assert.ok(validateReserveDraft(forged, catalog).length >= 3);
  assert.ok(validateReserveDraft(replaceReservePart(draft, 'entrance', 'wall', catalog).draft, catalog).some((error) => error.includes('porte')));
});

test('reset/reload derives slots and included quotas from the admin group, not saved client metadata', () => {
  const saved = { ...serializeReserveDraft(createReserveDraft(entry, null, catalog)), baseline: [{ ...fridge }], frame: { width: 12 }, requiredSlots: [] };
  const reloaded = createReserveDraft(entry, saved, catalog);
  assert.equal(reloaded.frame.width, 2);
  assert.equal(reloaded.baseline.length, 3);
  assert.equal(reloaded.requiredSlots.length, 3);
  assert.equal(serializeReserveDraft(reloaded).baseline, undefined);
});

test('included quotas are consumed before additions, with variant deltas and no refunds on removals', () => {
  const original = { ...entry, children: [...entry.children, { ...coffee, id: 'included-machine', x: -0.7, z: -0.7, y: 0, rotation: 0 }] };
  let draft = createReserveDraft(original, null, catalog);
  assert.deepEqual(reserveCustomizationPricingLines(original, draft, catalog), []);
  draft = replaceReservePart(draft, 'entrance', 'coded', catalog).draft;
  draft = addReservePart(draft, 'coffee', catalog).draft;
  const lines = reserveCustomizationPricingLines(original, draft, catalog, { parentId: 'auto-reserve-medium', referenceForEntry: (asset) => `REF-${asset.type}` });
  assert.equal(lines.find((line) => line.assetType === 'coded').total, 50);
  assert.equal(lines.find((line) => line.assetType === 'coffee').total, 45);
  assert.equal(lines.find((line) => line.assetType === 'coffee').category, 'furniture');
  assert.equal(lines.find((line) => line.assetType === 'coded').reference, 'REF-coded');
  draft = removeReservePart(draft, 'included-machine');
  assert.equal(reserveCustomizationPricingLines(original, draft, catalog).reduce((sum, line) => sum + line.total, 0), 50);
});

test('each reserve size has its own original included equipment allowance', () => {
  const bigger = { ...entry, type: 'reserve-3', children: [...entry.children, { ...fridge, id: 'included-fridge', x: -0.5, z: -0.65, y: 0, rotation: 0 }] };
  const smallDraft = addReservePart(createReserveDraft(entry, null, catalog), 'fridge', catalog).draft;
  assert.equal(reserveCustomizationPricingLines(entry, smallDraft, catalog)[0].total, 80);
  assert.deepEqual(reserveCustomizationPricingLines(bigger, createReserveDraft(bigger, null, catalog), catalog), []);
  assert.equal(createReserveDraft(bigger, serializeReserveDraft(smallDraft), catalog).parts.at(-1).id, 'included-fridge');
});

test('automatic reconstruction preserves root placement and collision footprint, and restores real model children', () => {
  const api = appApi({ firstPriceValue: (...values) => values.find((value) => value !== undefined && value !== '') });
  const rule = { id: 'medium', includedType: entry.type, includedLabel: entry.label, options: [] };
  const all = [entry, ...catalog];
  const original = api.makeAutomaticReserveItems(rule, '', all, 5, 4, 'left', 'Confort')[0];
  let draft = moveReservePart(createReserveDraft(entry, null, all), 'entrance', { x: -0.5, z: 0 }, all).draft;
  draft = replaceReservePart(draft, 'entrance', 'coded', all).draft;
  draft = addReservePart(draft, 'coffee', all).draft;
  const opts = { customizations: { [entry.type]: serializeReserveDraft(draft) } };
  const custom = api.makeAutomaticReserveItems(rule, '', all, 5, 4, 'left', 'Confort', clone(opts))[0];
  for (const key of ['id', 'x', 'y', 'z', 'rotation', 'movementLocked', 'rotationLocked', 'included']) assert.equal(custom[key], original[key], key);
  assert.deepEqual(clone(api.itemGroupBounds(custom)), clone(api.itemGroupBounds(original)));
  assert.equal(custom.children.find((part) => part.id === 'entrance').modelUrl, '/door.glb');
  assert.equal(custom.children.at(-1).type, 'coffee');
  assert.equal(api.salonDebitLeafItems([custom], all).map(({ item }) => item.type).sort().join(','), 'coded,coffee,wall,wall');
  const invalid = clone(opts);
  invalid.customizations[entry.type].parts.pop();
  invalid.customizations[entry.type].parts[2].type = 'unassigned';
  assert.equal(api.makeAutomaticReserveItems(rule, '', all, 5, 4, 'left', 'Confort', invalid)[0].options.reserveCustomization, undefined);
  assert.deepEqual(api.makeAutomaticReserveItems(rule, '__none__', all, 5, 4, 'left', 'Confort', opts).length, 0);
});

test('step 4 and BDC price reserve extras exactly once, include AMCO insurance in the Signature allowance', () => {
  const api = appApi();
  const insuredFurniture = { ...fridge, type: 'cabinet', label: 'Meuble bas AMCO' };
  const all = [entry, ...catalog, insuredFurniture];
  let draft = replaceReservePart(createReserveDraft(entry, null, all), 'entrance', 'coded', all).draft;
  draft = addReservePart(draft, 'cabinet', all).draft;
  const item = api.applyReserveCustomization({ ...entry, id: 'auto-reserve-medium', included: false, options: { unitPrice: 200 } }, entry, serializeReserveDraft(draft), all);
  const scene = { offer: 'Signature', dimensions: { width: 4, depth: 4 }, items: [item] };
  const pricing = api.calculateScenePricing({ catalog: all, scene, items: [item], salonLabel: 'Signature' });
  assert.equal(pricing.lines.filter((line) => line.type.startsWith('reserve-extra-')).length, 2);
  assert.equal(pricing.lines.find((line) => line.assetType === 'coded').total, 50);
  assert.equal(pricing.lines.find((line) => line.assetType === 'cabinet').total, 80);
  assert.equal(pricing.furnitureInsuranceBase, 80);
  assert.equal(pricing.grossTotal, money(330 + pricing.insuranceLine.total));
  assert.equal(pricing.allowanceApplied, pricing.grossTotal);
  assert.equal(pricing.total, 0);
  const extra = pricing.lines.find((line) => line.assetType === 'cabinet');
  assert.equal(api.validationLineHandledByOptions(extra), false);
  assert.equal(api.validationCategoryFromLine(extra), 'furniture');
  scene.source_payload = { pricing: clone(pricing) };
  const order = api.scenePurchaseOrder(scene, all);
  assert.equal(order.total, 0);
  assert.equal(order.lines.filter((line) => line.type.startsWith('reserve-extra-')).length, 2);
  item.included = true;
  item.options.unitPrice = 0;
  const confort = api.calculateScenePricing({ catalog: all, scene: { offer: 'Confort', dimensions: scene.dimensions }, items: [item] });
  assert.equal(confort.total, money(130 + confort.insuranceLine.total));
  assert.equal(confort.lines.some((line) => line.type === entry.type), false);
});

test('custom equipment metadata and height survive reconstruction for BAT and 3D rendering', () => {
  const draft = createReserveDraft(entry, null, catalog);
  const asset = { ...coffee, dimensions: { ...coffee.dimensions, batPictoUrl: '/coffee-picto.png', materialUrl: '/coffee.mtl' } };
  draft.parts.push({ id: 'coffee-on-shelf', type: coffee.type, role: 'furniture', x: -0.5, y: 1, z: -0.65, rotation: 90, slotId: '' });
  const children = reserveChildrenFromDraft(entry, draft, [...catalog.filter((row) => row.type !== coffee.type), asset]);
  assert.equal(children.at(-1).y, 1);
  assert.equal(children.at(-1).rotation, 90);
  assert.equal(children.at(-1).dimensions.batPictoUrl, '/coffee-picto.png');
  assert.equal(children.at(-1).materialUrl, '/coffee.mtl');
  assert.equal(children.at(-1).isWallItem, false);
  assert.equal(children.at(-1).lockedInGroup, true);
});

test('charged reserve equipment uses its actual basket category rather than always furniture', () => {
  const api = appApi();
  const socket = { ...coffee, type: 'socket', label: 'Triplette électrique', price: 30 };
  const pool = [entry, ...catalog, socket];
  const draft = addReservePart(createReserveDraft(entry, null, pool), socket.type, pool).draft;
  const item = api.applyReserveCustomization({ ...entry, id: 'reserve', included: true, options: {} }, entry, serializeReserveDraft(draft), pool);
  const pricing = api.calculateScenePricing({ catalog: pool, items: [item], scene: { offer: 'Confort' } });
  const line = pricing.lines.find((row) => row.assetType === socket.type);
  assert.equal(line.category, 'electricity');
  assert.equal(api.validationCategoryFromLine(line), 'electricity');
});

test('exhibitor entry points respect scene locking and reserve-only shop restrictions', () => {
  assert.match(source, /\.\.\.\(initialOptions\.reserveOptions \|\| \{\}\)/);
  assert.match(source, /reserveOptions\.customizations\?\.\[reserveEditorType\]/);
  assert.match(source, /reserveEditorType && !readOnly/);
  assert.match(source, /setReserveEditorType\(''\)/);
  assert.match(source, /!entry\.dimensions\?\.adminOnly && !entry\.dimensions\?\.reserveOnly/);
  assert.match(source, /reserveOnlyTypes\.has\(entry\.type\)/);
  assert.match(source, /entry\.dimensions\?\.isVariantGroup \? variantManagedAssetTypes\(entry\)/);
  for (const name of ['openAddItemConfigurator', 'addItem']) {
    const start = source.indexOf(`const ${name} =`);
    const guardedEntry = source.slice(start, source.indexOf('\n    if (', start + source.slice(start).indexOf('if (readOnly)') + 1) + 250);
    // A public variant group may legitimately use admin-only child models.
    assert.doesNotMatch(guardedEntry, /entry\.dimensions\?\.adminOnly/);
  }
  assert.match(source, /options\.reserveOptions \|\| \{\}/);
});

test('growing the included reserve adds only the necessary partitions and preserves fixed stand edges', () => {
  const draft = createReserveDraft(entry, null, catalog);
  const { draft: grown, error } = resizeReserveDraft(draft, 3, 1, catalog);
  assert.equal(error, '');
  assert.equal(grown.frame.minX, draft.frame.minX);
  assert.equal(grown.frame.minZ, draft.frame.minZ);
  assert.equal(grown.frame.width * grown.frame.depth, 3);
  assert.equal(grown.parts.length, 4);
  assert.deepEqual(validateReserveDraft(grown, catalog), []);
  assert.deepEqual(grown.requiredSlots.sort(), ['front-0', 'front-1', 'front-2', 'right-0']);
  const lines = reserveCustomizationPricingLines(entry, grown, catalog);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].assetType, wall.type);
  assert.equal(lines[0].quantity, 1);
  assert.equal(lines[0].total, wall.price);
  assert.equal(draft.parts.length, 3);
});

test('reducing from included 2 m2 to 1 m2 costs nothing, even after growing and reloading', () => {
  let draft = resizeReserveDraft(createReserveDraft(entry, null, catalog), 3, 2, catalog).draft;
  const saved = clone(serializeReserveDraft(draft));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.size, { width: 3, depth: 2 });
  draft = createReserveDraft(entry, saved, catalog);
  assert.deepEqual(validateReserveDraft(draft, catalog), []);
  const reduced = resizeReserveDraft(draft, 1, 1, catalog);
  assert.equal(reduced.error, '');
  assert.equal(reduced.draft.parts.length, 2);
  assert.deepEqual(reserveCustomizationPricingLines(entry, reduced.draft, catalog), []);
  assert.equal(reduced.draft.baseline.length, 3);
  const restored = createReserveDraft(entry, clone(serializeReserveDraft(reduced.draft)), catalog);
  assert.deepEqual(validateReserveDraft(restored, catalog), []);
  assert.equal(restored.frame.width * restored.frame.depth, 1);
  assert.deepEqual(reserveCustomizationPricingLines(entry, restored, catalog), []);
});

test('reduction relocates a door on a cut-off module without dropping it or its variant', () => {
  let draft = createReserveDraft(entry, null, catalog);
  draft = moveReservePart(draft, 'entrance', { x: 0.5, z: 0 }, catalog).draft;
  draft = replaceReservePart(draft, 'entrance', coded.type, catalog).draft;
  const reduced = resizeReserveDraft(draft, 1, 1, catalog);
  assert.equal(reduced.error, '');
  assert.equal(reduced.draft.parts.find((part) => part.id === 'entrance').type, coded.type);
  assert.equal(reduced.draft.parts.filter((part) => part.role === 'door').length, 1);
  assert.deepEqual(validateReserveDraft(reduced.draft, catalog), []);
  assert.equal(reserveCustomizationPricingLines(entry, reduced.draft, catalog)[0].total, 50);
});

test('resizing is atomic when equipment would be outside, obstruct a door or exceed stand limits', () => {
  const draft = createReserveDraft(entry, null, catalog);
  draft.parts.push({ id: 'coffee-right', type: coffee.type, role: 'furniture', x: 0.6, y: 1, z: -0.7, rotation: 0, slotId: '' });
  const reduced = resizeReserveDraft(draft, 1, 1, catalog);
  assert.ok(reduced.error);
  assert.equal(reduced.draft, draft);
  for (const [width, depth] of [[0, 1], [1.5, 1], [13, 1], [4, 1], [2, 3]]) {
    const result = resizeReserveDraft(draft, width, depth, catalog, { width: 3, depth: 2 });
    assert.ok(result.error);
    assert.equal(result.draft, draft);
  }
});

test('the resized collision footprint tracks all dimensions while retaining original thickness margins', () => {
  const original = createReserveDraft(entry, null, catalog);
  const grown = resizeReserveDraft(original, 3, 2, catalog).draft;
  const bounds = { minX: -1.03, maxX: 1.125, minZ: -1, maxZ: 0.03, width: 2.155, depth: 1.03, height: 2.5 };
  const changed = reserveDraftPlacementBounds(grown, bounds);
  assert.equal(changed.minX, bounds.minX);
  assert.equal(changed.minZ, bounds.minZ);
  assert.equal(changed.maxX, bounds.maxX + 1);
  assert.equal(changed.maxZ, bounds.maxZ + 1);
  assert.equal(money(changed.width), money(bounds.width + 1));
  assert.equal(money(changed.depth), money(bounds.depth + 1));
  assert.equal(changed.height, 2.5);
});

test('resizing a centred reserve keeps the back wall fixed and charges both new side modules', () => {
  const centre = { ...entry, children: [
    { ...wall, id: 'l0', x: -0.5, z: -0.5, rotation: 90 }, { ...wall, id: 'l1', x: -0.5, z: -1.5, rotation: 90 },
    { ...wall, id: 'r0', x: 0.5, z: -0.5, rotation: 90 }, { ...wall, id: 'r1', x: 0.5, z: -1.5, rotation: 90 },
    { ...door, id: 'entrance', x: 0, z: 0, rotation: 0 },
  ] };
  const draft = createReserveDraft(centre, null, catalog);
  const grown = resizeReserveDraft(draft, 1, 3, catalog);
  assert.equal(grown.error, '');
  assert.equal(grown.draft.frame.minZ, draft.frame.minZ);
  assert.equal(reserveCustomizationPricingLines(centre, grown.draft, catalog)[0].quantity, 2);
});

test('client JSON cannot forge resize metadata, editable edges or included quotas', () => {
  const grown = resizeReserveDraft(createReserveDraft(entry, null, catalog), 3, 1, catalog).draft;
  const saved = serializeReserveDraft(grown);
  for (const size of [{ width: 0, depth: 1 }, { width: 1000, depth: 1 }, { width: '3', depth: 1 }, null]) {
    const draft = createReserveDraft(entry, { ...saved, size, baseline: [], requiredSlots: [], edges: ['back'] }, catalog);
    assert.ok(validateReserveDraft(draft, catalog).some((error) => error.includes('dimensions')));
    assert.equal(draft.baseline.length, 3);
    assert.ok(!draft.edges.includes('back'));
  }
  const api = appApi({ firstPriceValue: (...values) => values.find((value) => value !== undefined && value !== '') });
  const rule = { id: 'medium', includedType: entry.type };
  for (const invalid of [{ ...saved, sourceType: 'other' }, { ...saved, version: 3 }, { version: 2, sourceType: entry.type }]) {
    const items = api.makeAutomaticReserveItems(rule, '', [entry, ...catalog], 5, 4, 'left', 'Confort', { customizations: { [entry.type]: invalid } });
    assert.equal(items[0].options.reserveCustomization, undefined);
  }
});

test('nonrectangular groups cannot silently replace missing perimeter panels during resizing', () => {
  const partial = { ...entry, children: [entry.children[0], entry.children[2]], dimensions: { reserveConfigurator: { width: 2, depth: 1 } } };
  const draft = createReserveDraft(partial, null, catalog);
  assert.equal(draft.canResize, false);
  assert.equal(resizeReserveDraft(draft, 3, 1, catalog).draft, draft);
  const saved = { ...serializeReserveDraft(draft), version: 2, size: { width: 3, depth: 1 } };
  assert.ok(validateReserveDraft(createReserveDraft(partial, saved, catalog), catalog).length);
});

test('a legacy fixed upgrade switches to actual module prices and original stand entitlement on resize', () => {
  const api = appApi({ firstPriceValue: (...values) => values.find((value) => value !== undefined && value !== '') });
  const bigger = { ...entry, type: 'reserve-3', children: [
    { ...wall, id: 'p0', x: -1, y: 0, z: 0, rotation: 0 },
    { ...wall, id: 'p1', x: 0, y: 0, z: 0, rotation: 0 },
    { ...wall, id: 'p2', x: 1, y: 0, z: 0, rotation: 0 },
    { ...door, id: 'entrance', x: 1.5, y: 0, z: -0.5, rotation: -90 },
  ] };
  const all = [entry, bigger, ...catalog];
  const rule = { id: 'medium', includedType: entry.type, options: [{ type: bigger.type, price: 111 }] };
  const original = api.makeAutomaticReserveItems(rule, bigger.type, all, 5, 4, 'left', 'Confort')[0];
  assert.equal(original.options.unitPrice, 111);
  let draft = resizeReserveDraft(createReserveDraft(bigger, null, all, entry), 4, 1, catalog).draft;
  let options = { customizations: { [bigger.type]: serializeReserveDraft(draft) } };
  const grown = api.makeAutomaticReserveItems(rule, bigger.type, all, 5, 4, 'left', 'Confort', options)[0];
  assert.equal(grown.options.unitPrice, 0);
  assert.equal(grown.included, true);
  let price = api.calculateScenePricing({ catalog: all, items: [grown], scene: { offer: 'Confort' } });
  assert.equal(price.lines.find((row) => row.assetType === wall.type).quantity, 2);
  assert.equal(price.total, 120);
  draft = resizeReserveDraft(draft, 1, 1, catalog).draft;
  options = { customizations: { [bigger.type]: serializeReserveDraft(draft) } };
  const reduced = api.makeAutomaticReserveItems(rule, bigger.type, all, 5, 4, 'left', 'Confort', options)[0];
  price = api.calculateScenePricing({ catalog: all, items: [reduced], scene: { offer: 'Confort' } });
  assert.equal(price.total, 0);
});

test('a stand with no included reserve still pays its purchased base after resizing', () => {
  const api = appApi({ firstPriceValue: (...values) => values.find((value) => value !== undefined && value !== '') });
  const all = [entry, ...catalog];
  const rule = { id: 'small', includedType: '', options: [{ type: entry.type, price: 170 }] };
  const draft = resizeReserveDraft(createReserveDraft(entry, null, catalog), 1, 1, catalog).draft;
  const item = api.makeAutomaticReserveItems(rule, entry.type, all, 5, 4, 'left', 'Confort', { customizations: { [entry.type]: serializeReserveDraft(draft) } })[0];
  assert.equal(item.included, false);
  assert.equal(item.options.unitPrice, 170);
});

test('the group equipment picker authorizes existing assets without exposing the whole ordinary shop', () => {
  const socket = { type: 'socket', label: 'Multiprise', price: 20, modelSize: [0.2, 0.05, 0.1] };
  const patere = { ...socket, type: 'coat', label: 'Patère' };
  const configured = { ...entry, dimensions: { ...entry.dimensions, reserveConfigurator: { allowedTypes: [socket.type, patere.type] } } };
  const pool = reserveCatalogEntries(configured, [...catalog, socket, patere, { type: 'chair', label: 'Chaise' }]);
  assert.ok(pool.some((asset) => asset.type === socket.type && reserve.reserveComponentRole(asset) === 'furniture'));
  assert.ok(pool.some((asset) => asset.type === patere.type));
  assert.ok(!pool.some((asset) => asset.type === 'chair'));
  const added = addReservePart(createReserveDraft(configured, null, pool), socket.type, pool);
  assert.equal(added.error, '');
  assert.equal(reserveCustomizationPricingLines(configured, added.draft, pool)[0].total, 20);
});
