import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Euler, Vector3 } from 'three';
import { scenePackBenefits } from '../supabase/functions/_shared/packBenefits.js';

const source = readFileSync(new URL('../src/technicalExport.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function runtime() {
  const text = [];
  const images = [];
  const rectangles = [];
  const outlines = [];
  const points = [];
  const ctx = new Proxy({
    fillText(value, x, y) { text.push({ value, x, y }); },
    drawImage(...args) { images.push(args); },
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: ctx.fillStyle }); },
    strokeRect(x, y, width, height) { outlines.push({ x, y, width, height }); },
    moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    measureText(value) { return { width: String(value).length * 8 }; },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,aGVhZA==' };
  const api = vm.createContext({ document: { createElement: () => canvas }, console, scenePackBenefits });
  vm.runInContext(source, api);
  return { api, canvas, text, images, rectangles, outlines, points, ctx };
}

const imageUrl = 'https://storage.example/scene-options/counter-preview.jpg';
const counter = (id, options = {}) => ({ id, type: 'counter', label: 'Comptoir accueil', x: 0, z: 0, dimensions: { width: 1, depth: 0.5 }, options: { binary3Enabled: true, binary3ImageUrl: imageUrl, ...options } });

test('BAT furniture and SVG pictos turn in the same direction as the 3D scene', () => {
  const { api, ctx } = runtime();
  const image = { width: 100, height: 50 };
  for (const degrees of [0, 45, 90, -90, 180, 270]) {
    const expected = new Vector3(1, 0, 0).applyEuler(new Euler(0, degrees * Math.PI / 180, 0));
    for (const draw of [
      () => api.drawRotatedObject(ctx, 0, 0, 100, 50, degrees, '#fff', '1'),
      () => api.drawRotatedPictoObject(ctx, 0, 0, 100, 50, degrees, image, '1'),
      () => api.drawCeilingObject(ctx, 0, 0, 100, 50, degrees, image, '#fff', '1'),
    ]) {
      const angles = [];
      ctx.rotate = (angle) => angles.push(angle);
      draw();
      assert.equal(angles.length, 1);
      assert.ok(Math.abs(Math.cos(angles[0]) - expected.x) < 1e-10);
      assert.ok(Math.abs(Math.sin(angles[0]) - expected.z) < 1e-10);
    }
  }
});

test('rotated group child positions and orientations match Three parent transforms', () => {
  const { api } = runtime();
  for (const degrees of [0, 45, 90, -90, 180, 270]) {
    const group = { id: 'group', isGroup: true, x: 2, z: -1, rotation: degrees,
      children: [{ id: 'desk', type: 'counter', x: 0.8, z: -0.4, rotation: 30 }] };
    const [child] = api.flattenTechnicalItems([group], []);
    const expected = new Vector3(0.8, 0, -0.4).applyEuler(new Euler(0, degrees * Math.PI / 180, 0));
    assert.ok(Math.abs(child.x - (group.x + expected.x)) < 1e-10);
    assert.ok(Math.abs(child.z - (group.z + expected.z)) < 1e-10);
    assert.equal(child.rotation, degrees + 30);
  }
});

test('each counter has its own visual and numbered placement, even with the same image', () => {
  const { api } = runtime();
  const visuals = api.technicalPlanVisuals([counter('base'), counter('extra')], [], 4, 3);
  assert.equal(visuals.length, 2);
  assert.equal(visuals[0].reference, 'S1');
  assert.match(visuals[1].placement, /Objet n° 2/);
  assert.equal(visuals[1].imageUrl, imageUrl);
  assert.equal(api.technicalPlanVisuals([counter('off', { binary3Enabled: false })]).length, 0);
});

test('wall and reserve cover previews retain the exact surface location', () => {
  const { api } = runtime();
  const position = [-1.2, 1.25, -0.8];
  const visuals = api.technicalPlanVisuals([{ sourceOptions: {}, sourceVisualSurfaces: [{ label: 'Cloison réserve', position, width: 2, height: 2.5, previewUrl: imageUrl }] }]);
  assert.equal(visuals.length, 1);
  assert.deepEqual(visuals[0].position, position);
  assert.match(visuals[0].placement, /Cloison réserve/);
  assert.equal(visuals[0].imageUrl, imageUrl);
});

test('the admin/email marker exports enabled surfaces with database preview URLs, not HD originals', () => {
  const { api } = runtime();
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  api.sceneOfferLabel = (scene) => scene.offer || '';
  api.assetReference = (entry, pack) => entry.dimensions?.packPricing?.[pack.toLowerCase()]?.reference || '';
  api.technicalPartitionHeadInformation = () => [];
  api.sceneConstraintsFromPayload = () => [];
  for (const name of ['withTechnicalOptionsMarker', 'wallCoverPreviewsFromCovers', 'wallCoverPreviewForSurface', 'wallCoverEnabledForSurface']) {
    const start = appSource.indexOf(`function ${name}(`);
    const end = appSource.indexOf('\n}\n', start) + 2;
    vm.runInContext(appSource.slice(start, end), api);
  }
  api.wallCoverSurfaceOptions = () => [
    { id: 'reserve-1', sourceWall: 'reserve', label: 'Cloison réserve', position: [1, 1.25, -1], width: 2, height: 2.5 },
    { id: 'left', label: 'Cloison gauche' },
  ];
  const items = api.withTechnicalOptionsMarker([], { offer: 'Confort', source_payload: { options: { wallCovers: { reserve: { enabled: true, previewUrl: imageUrl, previewName: 'Logo.jpg', originalUrl: 'https://storage.example/original-hd.pdf', visualPending: true }, left: { enabled: false } } } } }, [{ type: 'counter', dimensions: { packPricing: { confort: { reference: 'SMCL-COMPT01' } } } }]);
  assert.equal(items[0].sourceVisualSurfaces.length, 1);
  assert.equal(items[0].sourceProductReferences.counter, 'SMCL-COMPT01');
  const visuals = api.technicalPlanVisuals(items);
  assert.equal(visuals[0].imageUrl, imageUrl);
  assert.match(visuals[0].status, /En attente/);
  assert.match(visuals[0].placement, /Cloison réserve/);
});

test('image loading includes surface and head previews and only fetches each URL once', async () => {
  const { api } = runtime();
  const loaded = [];
  api.loadCanvasImage = async (url) => { loaded.push(url); return { width: 10, height: 10 }; };
  const headUrl = 'https://storage.example/head-preview.jpg';
  const images = await api.loadTechnicalPictoImages([counter('base'), counter('extra'), { sourceOptions: { partitionHeadVisuals: { right: { headMainImageUrl: headUrl } } }, sourceVisualSurfaces: [{ previewUrl: imageUrl }] }]);
  assert.equal(images.size, 2);
  assert.deepEqual(loaded, [imageUrl, headUrl]);
});

test('side wall visual markers use wall coordinates rather than the floor coordinates', () => {
  const { api } = runtime();
  const visuals = api.technicalPlanVisuals([{ ...counter('poster'), type: 'poster', wall: 'right', x: 0.7, z: 99, options: { posterImageUrl: imageUrl } }], [], 6, 4);
  assert.equal(visuals[0].position[0], 3);
  assert.equal(visuals[0].position[2], 0.7);
});

test('saved head visuals are exported without duplication, and removed heads are ignored', () => {
  const { api } = runtime();
  const options = { partitionHeadVisuals: { right: { headMainImageUrl: imageUrl }, left: { visualPending: true } }, partitionHeadLeftEnabled: false };
  const marker = { sourceOptions: options };
  assert.equal(api.technicalPlanVisuals([marker]).length, 1);
  const head = { id: 'head', type: 'head', label: 'Tête de cloison droite', options: options.partitionHeadVisuals.right };
  assert.equal(api.technicalPlanVisuals([head, marker]).length, 1);
});

test('both head artworks are exported separately and saved uploads replace stale pending artwork', () => {
  const { api } = runtime();
  const heads = ['left', 'right'].map((side) => ({ id: side, type: 'head', label: 'Support', options: { partitionHeadSide: side, visualPending: true }, x: side === 'left' ? -2 : 2, z: 1.5 }));
  const marker = { sourceOptions: { partitionHeadVisuals: { left: { headMainImageUrl: imageUrl, visualPending: false }, right: { headMainImageUrl: imageUrl, visualPending: false } } } };
  const visuals = api.technicalPlanVisuals([...heads, marker]);
  assert.equal(visuals.length, 2);
  assert.match(visuals[0].label, /gauche/);
  assert.match(visuals[1].label, /droite/);
  assert.equal(visuals[0].position[0], -2);
  assert.equal(visuals[1].position[0], 2);
  assert.ok(visuals.every((visual) => visual.imageUrl === imageUrl && visual.status.startsWith('Visuel fourni')));
});

test('the product recap shows the selected product reference or its salon/catalog reference', () => {
  const { api } = runtime();
  const entry = { type: 'counter', dimensions: { reference: 'GENERIC' } };
  assert.equal(api.technicalObjectRow(counter('a', { baseObjectReference: 'VARIANT-1M' }), entry, [], 0, { counter: 'SMCL-1M' }).lines[0], 'Référence : VARIANT-1M');
  assert.equal(api.technicalObjectRow(counter('b'), entry, [], 0, { counter: 'SMCL-1M' }).lines[0], 'Référence : SMCL-1M');
  assert.equal(api.technicalObjectRow(counter('c'), entry).lines[0], 'Référence : GENERIC');
});

test('group artwork survives flattening and is associated with one child only', () => {
  const { api } = runtime();
  const items = api.technicalItemsForPlan([null, { id: 'group', type: 'group', label: 'Enseigne haute', isGroup: true, options: { headMainImageUrl: imageUrl }, children: [{ id: 'a', type: 'part' }, { id: 'b', type: 'part' }] }], 4, 3, []);
  const visuals = api.technicalPlanVisuals(items);
  assert.equal(visuals.length, 1);
  assert.equal(visuals[0].imageUrl, imageUrl);
  assert.match(visuals[0].placement, /Enseigne haute/);
});

test('a long BAT includes all gallery images below the details without clipping', () => {
  const { api, canvas, text, images } = runtime();
  const items = Array.from({ length: 24 }, (_, index) => counter(String(index), { variantLabel: '1,5 m', technician: true, fileCheck: true, binary2ColorName: 'Rouge', variantBatDescription: 'Description\nAvec plusieurs\nLignes' }));
  api.renderTechnicalPlanCanvas({ width: 4, depth: 3, layout: 'u', items, catalog: [], pictoImages: new Map([[imageUrl, { width: 100, height: 80 }]]) });
  assert.ok(text.some(({ value }) => value === 'SIGNALETIQUE / VISUELS'));
  assert.ok(text.some(({ value, y }) => value.startsWith('S24 -') && y > 1040));
  assert.equal(images.length, 24);
  assert.ok(text.every(({ y }) => y < canvas.height - 34));
  assert.ok(images.every(([, , y, , height]) => y + height < canvas.height - 34));
});

test('stand reinforcement replaces the existing panel containing the TV, without adding a centred panel', () => {
  const { api } = runtime();
  const panels = api.wallPanelSegments(api.wallDescriptor('back', 4, 3, [{ type: 'screen', wall: 'back', x: -1.2 }]));
  assert.equal(panels.length, 4);
  assert.equal(panels[0].kind, 'reinforcement');
  assert.ok(panels.every((panel) => panel.mm === 1000));
  const last = api.reinforcementPanelForAxis(2.3, 0, 2.4);
  assert.equal(last.start, 2);
  assert.equal(last.end, 2.4);
  assert.equal(api.screenReinforcements('back', 4, 3, [{ type: 'tv-on-stand', label: 'TV sur pied', x: 0 }], 4).length, 0);
});

test('reserve TV reinforcement stays on the selected lateral face and does not affect stand walls', () => {
  const { api, ctx, rectangles } = runtime();
  const tv = { type: 'screen', x: -1.455, wall: 'object-wall:auto-reserve-medium:merged-1-0', wallSurface: { orientation: 'z', centerAxis: -0.99, normalAxis: -0.02, length: 1.9 } };
  api.drawObjectWallReinforcements(ctx, [tv], 100, 6, (x) => x * 100, (z) => z * 100);
  assert.equal(rectangles.length, 1);
  assert.equal(rectangles[0].x, -5);
  assert.ok(Math.abs(rectangles[0].y + 194) < 0.000001);
  assert.equal(rectangles[0].width, 6);
  assert.equal(rectangles[0].height, 100);
  assert.equal(api.screenReinforcements('back', 6, 4, [tv], 6).length, 0);
  assert.equal(api.screenReinforcements('right', 6, 4, [tv], 4).length, 0);
});

test('a missing reserve surface cannot create reinforcement at the scene origin', () => {
  const { api, ctx, rectangles } = runtime();
  api.drawObjectWallReinforcements(ctx, [{ type: 'screen', wall: 'object-wall:reserve', wallSurface: { orientation: 'x', length: 2 } }], 100, 6, (x) => x, (z) => z);
  assert.equal(rectangles.length, 0);
});

test('the BAT uses the moved reserve and refreshes the TV surface from its current walls', () => {
  const { api } = runtime();
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const name of ['sceneAllAdminItems', 'resolveTechnicalWallSurfaces', 'isObjectWallId', 'serializeObjectWallSurface', 'safeObjectWallSide', 'protectedObjectOutsideSide']) {
    const start = appSource.indexOf(`function ${name}(`);
    const end = appSource.indexOf('\n}\n', start) + 2;
    vm.runInContext(appSource.slice(start, end), api);
  }
  Object.assign(api, {
    sceneAdminItems: (scene) => scene.items,
    sceneOfferLabel: (scene) => scene.offer || '',
    sceneReserveRules: () => [], activeReserveRule: () => ({}),
    scenePartitionHeadRules: () => [], activePartitionHeadRule: () => null,
    partitionHeadEnabledSides: () => ({}), hasOwn: (value, key) => Object.hasOwn(value, key),
    ledRailCatalogEntries: () => [], makeAutomaticPartitionHeadItems: () => [],
    makeAutomaticReserveItems: () => [{ id: 'auto-reserve-medium', x: 0 }],
    applyReserveItemOverride: (item, overrides) => ({ ...item, x: overrides[item.id]?.x ?? item.x }),
    objectWallSurfaces: (items) => [{ id: 'object-wall:auto-reserve-medium:merged-1-0', orientation: 'z', centerAxis: -0.99, normalAxis: items.find((item) => item.id === 'auto-reserve-medium').x - 0.5, length: 1.9, protectedBounds: { minX: -0.05, maxX: 1.01 } }],
  });
  const tv = { id: 'tv', type: 'screen', x: -1.455, wall: 'object-wall:auto-reserve-medium:merged-1-0', wallSurface: { orientation: 'z', centerAxis: -0.99, normalAxis: -0.5, length: 1.9 }, wallSide: -1 };
  const items = api.sceneAllAdminItems({ dimensions: { width: 6, depth: 4 }, layout: 'u', items: [tv], options: { ledRailsEnabled: false, reserveItemOverrides: { 'auto-reserve-medium': { x: 0.48 } } } });
  assert.equal(items.find((item) => item.id === 'auto-reserve-medium').x, 0.48);
  assert.ok(Math.abs(items[0].wallSurface.normalAxis + 0.02) < 0.000001);
  assert.equal(items[0].wall, tv.wall);
  assert.equal(items[0].wallSide, -1);
  assert.equal(items[0].x, tv.x);
  assert.equal(tv.wallSurface.normalAxis, -0.5);
});

test('wall breakdown labels and long summaries have separate rows, within the sidebar width', () => {
  const { api, ctx, text } = runtime();
  const tvs = [-2.4, -0.4, 1.6].map((x) => ({ type: 'screen', wall: 'back', x }));
  const rows = api.technicalWallBreakdownRows(ctx, 348, 6, 4, 'u', tvs);
  assert.ok(rows[0].lines.length > 1);
  api.drawWallBreakdown(ctx, 48, 522, 348, 6, 4, 'u', tvs);
  const label = text.find(({ value }) => value.startsWith('Fond '));
  const summary = text.find(({ value }) => value.includes('renfort TV'));
  assert.ok(summary.y > label.y);
  assert.equal(summary.x, label.x);
  assert.ok(rows.every((row) => row.lines.every((line) => ctx.measureText(line).width <= 320)));
  const nextWall = text.find(({ value }) => value.startsWith('Gauche '));
  assert.ok(nextWall.y > label.y + 20 + (rows[0].lines.length - 1) * 18);
});

test('head information uses the scene renderer even with no uploaded image, including sector colour and stand/hall', () => {
  const { api, text, rectangles } = runtime();
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const names = ['technicalPartitionHeadInformation', 'isPartitionHeadItem', 'isSmclPartitionHeadItem', 'normalizedItemText', 'smclPartitionHeadSide', 'createPartitionHeadInfoTexture', 'createSmclPartitionHeadInfoTexture', 'smclCanvasFont', 'drawSmclLeftHeadInfo', 'drawSmclRightHeadInfo', 'normalizeSmclAisleCode', 'normalizeSmclStandNumber', 'normalizeSmclHallNumber', 'smclStandCode', 'drawSmclSalonMark', 'drawSmclPartnerMarks', 'smclSectorColor', 'fitCanvasText'];
  for (const name of names) {
    const start = appSource.indexOf(`function ${name}(`);
    const end = appSource.indexOf('\n}\n', start) + 2;
    vm.runInContext(appSource.slice(start, end), api);
  }
  let disposed = 0;
  Object.assign(api, {
    CanvasTexture: class { constructor(image) { this.image = image; } dispose() { disposed += 1; } },
    prepareDynamicTexture: (texture) => texture,
    normalizeLookupText: (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    mondayColumnTextByTitle: () => '', savedContactDetail: () => '',
    sceneExhibitorCompanyName: (scene) => scene.project_name,
    sceneStandNumber: (scene) => scene.source_payload.stand_number,
    sceneAisleNumber: (scene) => scene.source_payload.aisle_number,
    sceneHallLabel: (scene) => scene.source_payload.hall,
    sceneSectorLabel: (scene) => scene.source_payload.sector,
  });
  const heads = ['left', 'right'].map((side) => ({ id: side, type: 'head-smcl', label: `Tête de cloison SMCL ${side === 'left' ? 'gauche' : 'droite'}`, x: side === 'left' ? -2 : 2, z: 1.5, options: { partitionHeadSide: side } }));
  heads[0] = { ...heads[0], type: 'group', label: 'Support gauche', isGroup: true, children: [{ type: 'head-smcl', label: 'Tête de cloison SMCL gauche' }] };
  const scene = { project_name: 'Société test', source_payload: { options: { partitionHeadCompany: 'Nom personnalisé' }, stand_number: '25', aisle_number: 'A', hall: '6', sector: 'Sécurité prévention protection' } };
  const information = api.technicalPartitionHeadInformation(heads, scene);
  assert.equal(information.length, 2);
  assert.equal(disposed, 4);
  assert.ok(text.some(({ value }) => value === 'NOM PERSONNALISÉ'));
  assert.ok(text.some(({ value }) => value === '25A'));
  assert.ok(text.some(({ value }) => value === 'PAVILLON 6'));
  assert.ok(rectangles.some(({ color }) => color === '#E20519'));
  const visuals = api.technicalPlanVisuals([...heads, { sourceOptions: {}, sourceHeadInformation: information }]);
  assert.equal(visuals.length, 2);
  assert.match(visuals[0].label, /Habillage.*gauche/);
  assert.match(visuals[1].label, /Habillage.*droite/);
  assert.ok(visuals.every((visual) => visual.imageUrl.startsWith('data:image/png;')));
});

test('a pole is drawn at its back-left corner offset with its actual dimensions and both diagonals', () => {
  const { api, ctx, outlines, points } = runtime();
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  for (const name of ['parseSceneConstraintValues', 'parseCombinedConstraintValue', 'parseNumberParts', 'clamp', 'sceneConstraintsFromPayload', 'normalizeSceneConstraint', 'dedupeSceneConstraints']) {
    const start = appSource.indexOf(`function ${name}(`);
    const end = appSource.indexOf('\n}\n', start) + 2;
    vm.runInContext(appSource.slice(start, end), api);
  }
  const pole = api.parseSceneConstraintValues('700 X 500 (900 - 400)', '', 4, 3, 'Poteau 1', { forceMillimeters: true });
  const savedPole = { width: 0.7, depth: 0.5, fromLeft: 0.9, fromBack: 0.4 };
  const saved = api.sceneConstraintsFromPayload({ constraints: [savedPole, savedPole] }, 4, 3);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].x, pole.x);
  assert.equal(saved[0].z, pole.z);
  api.drawTechnicalConstraints(ctx, [pole], 100, (x) => x * 100, (z) => z * 100);
  assert.equal(outlines.length, 1);
  assert.ok(Math.abs(outlines[0].x + 110) < 0.000001);
  assert.ok(Math.abs(outlines[0].y + 110) < 0.000001);
  assert.equal(outlines[0].width, 70);
  assert.equal(outlines[0].height, 50);
  assert.equal(points.length, 4);
  assert.ok(Math.abs(points[1][0] + 40) < 0.000001);
  assert.ok(Math.abs(points[1][1] + 60) < 0.000001);
  assert.deepEqual(points[2], [points[1][0], points[0][1]]);
  assert.deepEqual(points[3], [points[0][0], points[1][1]]);
});

test('the BAT renders all saved poles from its marker without counting them as furniture', () => {
  const { api, outlines, text } = runtime();
  const poles = [{ label: 'Poteau 1', width: 0.8, depth: 0.3, x: -0.6, z: -0.85 }, { label: 'Poteau 2', width: 0.5, depth: 0.5, x: 1, z: 0.3 }];
  api.renderTechnicalPlanCanvas({ width: 4, depth: 3, layout: 'back', items: [{ sourceOptions: {}, sourceConstraints: poles }], catalog: [] });
  assert.ok(text.some(({ value }) => value === 'Poteau 1'));
  assert.ok(text.some(({ value }) => value === 'Poteau 2'));
  const scale = Math.min(1260 / 5.1, 760 / 4.1);
  assert.equal(outlines.filter((rect) => Math.abs(rect.width - 0.8 * scale) < 0.000001 && Math.abs(rect.height - 0.3 * scale) < 0.000001).length, 1);
  assert.equal(api.technicalTableSections([{ sourceOptions: {}, sourceConstraints: poles }], []).some((section) => section.id === 'amco'), false);
  const { api: emptyApi, ctx, outlines: emptyOutlines } = runtime();
  emptyApi.drawTechnicalConstraints(ctx, [], 100, (x) => x, (z) => z);
  emptyApi.drawTechnicalConstraints(ctx, [{ width: 0, depth: 1, x: 0, z: 0 }], 100, (x) => x, (z) => z);
  assert.equal(emptyOutlines.length, 0);
});
