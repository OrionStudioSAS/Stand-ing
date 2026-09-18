import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/technicalExport.js', import.meta.url), 'utf8').replace(/^export /gm, '');

function runtime() {
  const text = [];
  const images = [];
  const ctx = new Proxy({
    fillText(value, x, y) { text.push({ value, x, y }); },
    drawImage(...args) { images.push(args); },
    measureText(value) { return { width: String(value).length * 8 }; },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = { getContext: () => ctx };
  const api = vm.createContext({ document: { createElement: () => canvas }, console });
  vm.runInContext(source, api);
  return { api, canvas, text, images };
}

const imageUrl = 'https://storage.example/scene-options/counter-preview.jpg';
const counter = (id, options = {}) => ({ id, type: 'counter', label: 'Comptoir accueil', x: 0, z: 0, dimensions: { width: 1, depth: 0.5 }, options: { binary3Enabled: true, binary3ImageUrl: imageUrl, ...options } });

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
  for (const name of ['withTechnicalOptionsMarker', 'wallCoverPreviewsFromCovers', 'wallCoverPreviewForSurface', 'wallCoverEnabledForSurface']) {
    const start = appSource.indexOf(`function ${name}(`);
    const end = appSource.indexOf('\n}\n', start) + 2;
    vm.runInContext(appSource.slice(start, end), api);
  }
  api.wallCoverSurfaceOptions = () => [
    { id: 'reserve-1', sourceWall: 'reserve', label: 'Cloison réserve', position: [1, 1.25, -1], width: 2, height: 2.5 },
    { id: 'left', label: 'Cloison gauche' },
  ];
  const items = api.withTechnicalOptionsMarker([], { source_payload: { options: { wallCovers: { reserve: { enabled: true, previewUrl: imageUrl, previewName: 'Logo.jpg', originalUrl: 'https://storage.example/original-hd.pdf', visualPending: true }, left: { enabled: false } } } } });
  assert.equal(items[0].sourceVisualSurfaces.length, 1);
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
