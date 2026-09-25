import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

function loadFunction(source, api, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), api);
}

test('PDF uploads render their first page as the scene preview', () => {
  assert.match(storeSource, /isPdfFile\(file\)[\s\S]*makePdfPreviewImage\(file\)/);
  assert.match(storeSource, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(storeSource, /getPage\(1\)/);
  assert.match(storeSource, /page\.render\(/);
});

test('the existing configurator lighting is preserved', () => {
  assert.equal((appSource.match(/<ambientLight intensity=\{1\.42\} \/>/g) || []).length, 2);
  assert.doesNotMatch(appSource, /ConfiguratorLighting|RoomEnvironment|environmentIntensity/);
});

test('header language flags use browser-safe SVG assets instead of platform emoji', () => {
  assert.match(appSource, /flagSrc: '\/icons\/flag-fr\.svg'/);
  assert.match(appSource, /flagSrc: '\/icons\/flag-en\.svg'/);
  assert.match(appSource, /<span className="flag-dot"><img src=\{selectedLanguage\.flagSrc\}/);
  assert.doesNotMatch(appSource, /selectedLanguage\.flag\}/);
});

test('chrome materials are detected for reflective furniture legs', () => {
  const api = vm.createContext({});
  loadFunction(appSource, api, 'isChromeMaterial');
  assert.equal(api.isChromeMaterial({ name: 'chrome' }), true);
  assert.equal(api.isChromeMaterial({ name: 'Acier poli' }), true);
  assert.equal(api.isChromeMaterial({ name: 'Chrome_Black' }), false);
  assert.equal(api.isChromeMaterial({ name: 'top' }), false);
  assert.match(appSource, /cloned\.metalness = 0\.48/);
  assert.match(appSource, /cloned\.roughness = 0\.26/);
  assert.match(appSource, /itemText\.includes\('table'\).*itemText\.includes\('icare'\)/);
  assert.match(appSource, /next\.metalness = 0\.84/);
  assert.match(appSource, /next\.roughness = 0\.14/);
  assert.match(appSource, /next\.envMapIntensity = 1\.05/);
  assert.match(appSource, /next\.envMap = getIcareChromeEnvironment\(\)/);
});

test('admin object associations use a searchable asset picker', () => {
  assert.match(appSource, /function AdminAssetPicker\(/);
  assert.match(appSource, /open && createPortal\(/);
  assert.match(appSource, /Rechercher par nom, type, catégorie ou référence/);
  assert.match(appSource, /function AssetVariantSourceRows[\s\S]*<AdminAssetPicker assets=\{sourceAssets\} value=\{type\}/);
  assert.match(appSource, /function AssetConfigOptionRows[\s\S]*emptyLabel="Aucun objet lié"/);
  assert.match(appSource, /function AssetGroupCreator[\s\S]*onChange=\{\(type\) => updateRow/);
});

test('the 3D asset drawer closes when its backdrop is clicked', () => {
  assert.match(appSource, /function AssetDrawer\([\s\S]*className="asset-drawer-layer" onMouseDown=\{\(event\) => \{[\s\S]*event\.target === event\.currentTarget[\s\S]*onClose\?\.\(\)/);
});

test('admins can preview the actual exhibitor permissions without logging out', () => {
  assert.match(appSource, /const effectiveAdminViewer = Boolean\(isAdminViewer && !adminExhibitorPreview\)/);
  assert.match(appSource, /Voir comme l.exposant/);
  assert.match(appSource, /Revenir à la vue admin/);
  assert.match(appSource, /canEditLockedItems=\{effectiveAdminViewer\}/);
});

test('step 3 counter options show the finish before the logo and podium uses height', () => {
  assert.match(stylesSource, /item-config-modal[\s\S]*item-counter-finish-card[\s\S]*order: 1/);
  assert.match(stylesSource, /item-config-modal[\s\S]*item-counter-logo-card[\s\S]*order: 2/);
  assert.match(appSource, /function PodiumVariantPicker[\s\S]*<strong>Hauteur<\/strong>/);
});

test('dragging preserves the pointer offset instead of snapping the object under the cursor', () => {
  const api = vm.createContext({});
  loadFunction(appSource, api, 'applyDragPointerOffset');
  assert.deepEqual(
    { ...api.applyDragPointerOffset({ x: 1.2, z: -0.4 }, { x: 0.3, z: -0.2 }) },
    { x: 1.5, z: -0.6000000000000001 },
  );
  assert.match(appSource, /wallDragPointFromRay\(event\.ray, draggingItem/);
  assert.match(appSource, /isWallItem\(item\) \|\| isLedRailEntry\(item\) \|\| isAutomaticSpotItem\(item\)/);
});
