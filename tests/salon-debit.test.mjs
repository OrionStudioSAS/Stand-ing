import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { standWallPanelRequirements } from '../src/technicalExport.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

function loadFunction(name, context) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);
}

test('salon debit expands reserve groups and counts stand walls without counting group shells', () => {
  const entries = [
    { type: 'cloison', label: 'Cloison 1 m', dimensions: { category: 'Cloisons' } },
    { type: 'door', label: 'Porte', dimensions: { category: 'Portes' } },
    { type: 'chair', label: 'Chaise', dimensions: { category: 'Mobilier' } },
    { type: 'reserve', label: 'Réserve', isGroup: true, children: [{ type: 'cloison' }, { type: 'cloison' }, { type: 'door' }] },
  ];
  const context = vm.createContext({
    normalizeTextValue: (value) => String(value || '').toLowerCase(),
    normalizeSalonTitle: (value) => value,
    sceneOfferLabel: (scene) => scene.offer,
    sceneAdminCatalog: () => entries,
    sceneAllAdminItems: (scene) => scene.items,
    isPrestigeScene: () => false,
    isHiddenIncludedCounterItem: () => false,
    isHiddenPrestigeBaseItem: () => false,
    assetToCatalogEntry: (asset) => asset,
    assetBusinessCategoryLabel: (asset) => asset.dimensions?.category || 'Mobilier',
    assetReference: (entry) => entry.type.toUpperCase(),
    standWallPanelRequirements: ({ layout }) => Array.from({ length: layout === 'u' ? 10 : 2 }, () => ({ lengthMm: 1000, reinforced: false })),
    slugForType: (value) => value,
  });
  for (const name of ['salonDebitScenes', 'salonDebitLeafItems', 'salonDebitCsv']) loadFunction(name, context);

  const salon = { id: 'salon-1', name: 'Salon Test', scenes: [{ id: 's1' }, { id: 's2' }, { id: 'draft' }] };
  const scenes = [
    { id: 's1', salon_id: 'salon-1', client_status: 'configured', offer: 'CONFORT', layout: 'u', dimensions: { width: 4, depth: 3 }, items: [
      { id: 'reserve-1', type: 'reserve', label: 'Réserve 2 m²', isGroup: true, children: [{ type: 'cloison' }, { type: 'cloison' }, { type: 'door' }] },
      { id: 'chair-1', type: 'chair' },
    ] },
    { id: 's2', salon_id: 'salon-1', client_status: 'bat_review', offer: 'PRESTIGE', layout: 'back', dimensions: { width: 2, depth: 3 }, items: [{ id: 'chair-2', type: 'chair' }] },
    { id: 'draft', salon_id: 'salon-1', client_status: 'draft', offer: 'CONFORT', layout: 'back', dimensions: { width: 2, depth: 3 }, items: [{ id: 'chair-draft', type: 'chair' }] },
    { id: 'other', salon_id: 'salon-2', client_status: 'configured', offer: 'CONFORT', layout: 'u', dimensions: { width: 5, depth: 5 }, items: [{ id: 'chair-3', type: 'chair' }] },
  ];
  const csv = context.salonDebitCsv(salon, scenes, entries);
  assert.match(csv, /Scènes configurées par les exposants uniquement \(brouillons exclus\)/);
  assert.match(csv, /"Nombre de scènes";"2"/);
  assert.match(csv, /"Total cloisons \(stand et groupes\)";"14"/);
  assert.match(csv, /"Cloison 1 m";"";"pièce";"2";"2";"0"/);
  assert.match(csv, /"Cloison stand 1000 × 2500 mm";"";"pièce";"12";"10";"2"/);
  assert.match(csv, /"Chaise";"";"pièce";"2";"1";"1"/);
  assert.doesNotMatch(csv, /"Réserve 2 m²";"";"pièce"/);
});

test('salon debit includes submitted configurations and excludes untouched or draft scenes', () => {
  const context = vm.createContext({
    normalizeTextValue: (value) => String(value || '').toLowerCase(),
    normalizeSalonTitle: (value) => value,
  });
  loadFunction('salonDebitScenes', context);
  const salon = { id: 'salon-1', name: 'Salon Test' };
  const scenes = [
    { id: 'new', salon_id: salon.id, status: 'created', client_status: 'not_started' },
    { id: 'draft', salon_id: salon.id, status: 'created', client_status: 'draft' },
    { id: 'stale', salon_id: salon.id, status: 'configured', client_status: 'draft' },
    { id: 'submitted', salon_id: salon.id, status: 'configured', client_status: 'configured' },
    { id: 'request', salon_id: salon.id, status: 'bat_pending', client_status: 'configured' },
    { id: 'review', salon_id: salon.id, status: 'bat_pending', client_status: 'bat_review' },
    { id: 'approved', salon_id: salon.id, status: 'validated', client_status: 'bat_validated' },
    { id: 'legacy', salon_id: salon.id, status: 'validated' },
    { id: 'other-salon', salon_id: 'salon-2', status: 'configured', client_status: 'configured' },
  ];
  assert.equal(context.salonDebitScenes(salon, scenes).map((scene) => scene.id).join(','), 'submitted,request,review,approved,legacy');
});

test('stand wall requirements follow the BAT panel cutting for U and back layouts', () => {
  const u = standWallPanelRequirements({ width: 4, depth: 3, layout: 'u', items: [] });
  const back = standWallPanelRequirements({ width: 4.4, depth: 3, layout: 'back', items: [] });
  const reinforced = standWallPanelRequirements({ width: 4, depth: 3, layout: 'back', items: [{ id: 'tv', type: 'screen', wall: 'back', isWallItem: true, x: 0, y: 1.6 }] });
  assert.equal(u.length, 10);
  assert.deepEqual(back.map((panel) => panel.lengthMm), [1000, 1000, 1000, 1000, 400]);
  assert.equal(reinforced.filter((panel) => panel.reinforced).length, 1);
  assert.equal(reinforced.length, 4);
});
