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
    sceneAisleNumber: (scene, contact) => scene.aisle || contact.allee || '',
    sceneStandNumber: () => '',
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
  for (const name of ['salonDebitScenes', 'salonDebitLeafItems', 'salonDebitAisle', 'salonDebitCsv']) loadFunction(name, context);

  const salon = { id: 'salon-1', name: 'Salon Test', scenes: [{ id: 's1' }, { id: 's2' }, { id: 'draft' }] };
  const scenes = [
    { id: 's1', salon_id: 'salon-1', client_status: 'configured', offer: 'CONFORT', aisle: 'B', layout: 'u', dimensions: { width: 4, depth: 3 }, items: [
      { id: 'reserve-1', type: 'reserve', label: 'Réserve 2 m²', isGroup: true, children: [{ type: 'cloison' }, { type: 'cloison' }, { type: 'door' }] },
      { id: 'chair-1', type: 'chair' },
    ] },
    { id: 's2', salon_id: 'salon-1', client_status: 'bat_review', offer: 'PRESTIGE', aisle: 'A', layout: 'back', dimensions: { width: 2, depth: 3 }, items: [{ id: 'chair-2', type: 'chair' }] },
    { id: 'draft', salon_id: 'salon-1', client_status: 'draft', offer: 'CONFORT', layout: 'back', dimensions: { width: 2, depth: 3 }, items: [{ id: 'chair-draft', type: 'chair' }] },
    { id: 'other', salon_id: 'salon-2', client_status: 'configured', offer: 'CONFORT', layout: 'u', dimensions: { width: 5, depth: 5 }, items: [{ id: 'chair-3', type: 'chair' }] },
  ];
  const csv = context.salonDebitCsv(salon, scenes, entries);
  assert.match(csv, /Scènes configurées par les exposants uniquement \(brouillons exclus\)/);
  assert.match(csv, /"Nombre de scènes";"2"/);
  assert.match(csv, /"Total cloisons \(stand et groupes\)";"14"/);
  const rows = csvRows(csv);
  assert.deepEqual(rows.find(row => row[0] === 'Catégorie').slice(-3), ['Allée A', 'Allée B', 'Total global']);
  assert.deepEqual(rows.find(row => row[2] === 'Cloison 1 m').slice(-3), ['0', '2', '2']);
  assert.deepEqual(rows.find(row => row[2] === 'Cloison stand 1000 × 2500 mm').slice(-3), ['2', '10', '12']);
  assert.deepEqual(rows.find(row => row[2] === 'Chaise').slice(-3), ['1', '1', '2']);
  assert.doesNotMatch(csv, /"Réserve 2 m²";"";"pièce"/);
});

function csvRows(csv) {
  return csv.split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"')));
}

function debitRuntime() {
  const context = vm.createContext({
    normalizeTextValue: value => String(value || '').toLowerCase(), normalizeSalonTitle: value => value,
    sceneOfferLabel: scene => scene.offer, sceneAisleNumber: (scene, contact) => scene.source_payload?.aisle_number || contact.allee || '',
    sceneStandNumber: scene => scene.source_payload?.stand_number || '', sceneAdminCatalog: () => [], sceneAllAdminItems: scene => scene.items || [],
    isPrestigeScene: () => false, isHiddenIncludedCounterItem: () => false, isHiddenPrestigeBaseItem: () => false,
    assetToCatalogEntry: asset => asset, assetBusinessCategoryLabel: () => 'Mobilier', assetReference: () => '', standWallPanelRequirements,
  });
  for (const name of ['salonDebitScenes', 'salonDebitLeafItems', 'salonDebitAisle', 'salonDebitCsv']) loadFunction(name, context);
  return context;
}

test('debit quantities are grouped by normalized naturally sorted aisles with missing aisles kept and totals last', () => {
  const api = debitRuntime(),salon = { id: 'salon', name: 'Salon' };
  const scenes = ['Allée 10', '2', 'b', ' B ', ''].map((aisle, index) => ({
    id: String(index),salon_id: 'salon',client_status: 'configured',offer: index % 2 ? 'Prestige' : 'Confort',
    source_payload: { aisle_number: aisle },items: [{ type: 'chair',label: 'Chaise',quantity: index + 1 }],
  }));
  const rows = csvRows(api.salonDebitCsv(salon,scenes));
  const header = rows.find(row => row[0] === 'Catégorie');
  assert.deepEqual(header.slice(7),['Allée 2','Allée 10','Allée B','Allée non renseignée','Total global']);
  const chair = rows.find(row => row[2] === 'Chaise');
  assert.deepEqual(chair.slice(7),['2','1','7','5','15']);
  assert.deepEqual(rows.at(-1).slice(7),chair.slice(7));
  assert.equal(rows.at(-1)[0],'TOTAL PIÈCES');
  assert.equal(rows.find(row => row[0] === 'Nombre de scènes')[1],'5');
  assert.equal(api.salonDebitAisle({source_payload:{contactDetails:{allee:' allée c '}}}),'C');
  assert.equal(api.salonDebitAisle({}),'');
});

test('only unavoidable custom widths appear as traceable atelier adjustments, never invented catalogue partitions', () => {
  const api = debitRuntime(),salon = { id: 'salon', name: 'Salon' };
  const scenes = [{ id:'custom',project_name:'Stand 2,19m',salon_id:'salon',client_status:'configured',offer:'Confort',layout:'u',dimensions:{width:4,depth:2.19},source_payload:{aisle_number:'F',stand_number:'12'} },
    { id:'tv',project_name:'Stand TV',salon_id:'salon',client_status:'configured',offer:'Prestige',layout:'right',dimensions:{width:4,depth:3},source_payload:{aisle_number:'B'},items:[{id:'tv',type:'screen',wall:'right',isWallItem:true,x:0}] }];
  const csv = api.salonDebitCsv(salon,scenes),rows=csvRows(csv);
  assert.doesNotMatch(csv,/Cloison stand (60|190) ×/);
  assert.doesNotMatch(csv,/hors standard 60 ×/);
  const adjustment=rows.find(row=>row[2]==='Ajustement cloison hors standard 190 × 2500 mm');
  assert.equal(adjustment[0],'Ajustements à vérifier');
  assert.match(adjustment[6],/Stand 2,19m \(stand F 12\).*mur gauche de 2190 mm/);
  assert.match(adjustment[6],/mur droite de 2190 mm/);
  assert.deepEqual(adjustment.slice(7),['0','2','2']);
  assert.equal(rows.find(row=>row[0]==='Dont ajustements hors standard à vérifier')[1],'2');
  assert.match(csv,/pas des formats catalogue/);
  const before=JSON.stringify(scenes);api.salonDebitCsv(salon,scenes);assert.equal(JSON.stringify(scenes),before);
});

test('empty salon debit still has a global total and CSV text is escaped safely', () => {
  const api=debitRuntime(),salon={id:'salon',name:'=FORMULE'};
  const empty=csvRows(api.salonDebitCsv(salon,[]));
  assert.equal(empty.find(row=>row[0]==='Catégorie').at(-1),'Total global');
  assert.equal(empty.at(-1).at(-1),'0');
  assert.equal(empty[0][1],"'=FORMULE");
  const csv=api.salonDebitCsv(salon,[{id:'s',salon_id:'salon',client_status:'configured',items:[{type:'chair',label:'=objet; "test"'}]}]);
  assert.equal(csvRows(csv).find(row=>row[0]==='Mobilier')[2],"'=objet; \"test\"");
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
  assert.equal(reinforced.length, 5);
});
