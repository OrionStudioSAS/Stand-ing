import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { DoubleSide, MeshStandardMaterial } from 'three';

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

test('configurator scene uses a cream stage backdrop without tinting the 3D scene', () => {
  const start = appSource.indexOf('className={sceneCanvasClassName}');
  const end = appSource.indexOf('</Canvas>', start);
  const canvas = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(canvas, /gl=\{\{ alpha: true \}\}/);
  assert.doesNotMatch(canvas, /attach="background"/);
  assert.match(stylesSource, /\.configurator-stage\s*\{[^}]*radial-gradient\([^}]*linear-gradient\(/);
  assert.match(stylesSource, /\.configurator-stage\s*\{[^}]*#f7f1e7[^}]*#d9cbb9/);
});

test('wall fabric keeps scene shading with a restrained texture lift', () => {
  const start = appSource.indexOf('function WallFabricSurface(');
  const end = appSource.indexOf('\nfunction WallCoverSurfaces(', start);
  const source = appSource.slice(start, end);
  assert.ok(start >= 0);
  assert.match(source, /<meshStandardMaterial[\s\S]*map=\{texture \|\| null\}[\s\S]*emissiveMap=\{texture \|\| null\}[\s\S]*emissiveIntensity=\{0\.16\}/);
  assert.doesNotMatch(source, /meshBasicMaterial|toneMapped=\{false\}/);
});

test('wall and floor textures cannot reuse the previous color while a new image loads', () => {
  const start = appSource.indexOf('function useRepeatedTexture(');
  const end = appSource.indexOf('\nfunction createRepeatedTextureFromImage(', start);
  const source = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /textureState\.key === textureKey \? textureState\.texture : null/);
  assert.match(source, /if \(!url\)[\s\S]*texture: null/);
});

test('carpet selector exposes the configured free and paid colors', () => {
  const start = appSource.indexOf('function CarpetColorOptionCard(');
  const end = appSource.indexOf('\nfunction GroundOptionHeading(', start);
  const source = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /includedColors\.map\(/);
  assert.match(source, /paidColors\.map\(/);
  assert.match(source, /onSelect\?\.\(color\.id\)/);
});

test('imported non-metal furniture finishes keep their colors without a false metallic cast', () => {
  const api = vm.createContext({ DoubleSide });
  for (const name of ['normalizeMaterialName', 'normalizedItemText', 'normalizeMaterialTexture', 'isChromeMaterial', 'isAluminiumMaterial', 'isImportedNonmetalFinish', 'cloneAndNormalizeMaterial', 'cloneMeshMaterial']) {
    loadFunction(appSource, api, name);
  }
  const fridge = new MeshStandardMaterial({ name: 'frigo_140l', color: '#f2f2f2', metalness: 0.5, roughness: 0.5 });
  const largeFridge = new MeshStandardMaterial({ name: 'ELECTROMENAGER', color: '#ffffff', metalness: 0.5, roughness: 0.5 });
  const fabric = new MeshStandardMaterial({ name: 'Fabric_01', color: '#4477aa', metalness: 1, roughness: 1 });
  const whiteChair = new MeshStandardMaterial({ name: 'Material.001', color: '#cccccc', metalness: 0.6 });
  const chrome = new MeshStandardMaterial({ name: 'chrome', color: '#cccccc', metalness: 1 });
  const genericColor = new MeshStandardMaterial({ name: 'Material.001', color: '#cc4433', metalness: 0.6 });

  const [fixedFridge] = api.cloneMeshMaterial([fridge], { label: 'Frigo 140L' });
  const fixedFabric = api.cloneMeshMaterial(fabric, { label: 'Canapé Charlotte Gris' });
  assert.equal(fixedFridge.metalness, 0);
  assert.equal(fixedFridge.color.getHexString(), fridge.color.getHexString());
  assert.equal(api.cloneMeshMaterial(largeFridge, { label: 'Frigo 220L' }).metalness, 0);
  assert.equal(fixedFabric.metalness, 0);
  assert.equal(fridge.metalness, 0.5);
  assert.equal(api.cloneMeshMaterial(whiteChair, { label: 'Chaise One Blanc' }).metalness, 0);
  assert.equal(api.cloneMeshMaterial(chrome, { label: 'Table Icare Blanc' }).metalness, 0.48);
  assert.equal(api.cloneMeshMaterial(genericColor, { label: 'Chaise One Rouge' }).metalness, 0.6);
});

test('header language flags use browser-safe SVG assets instead of platform emoji', () => {
  assert.match(appSource, /flagSrc: '\/icons\/flag-fr\.svg'/);
  assert.match(appSource, /flagSrc: '\/icons\/flag-en\.svg'/);
  assert.match(appSource, /<span className="flag-dot"><img src=\{selectedLanguage\.flagSrc\}/);
  assert.doesNotMatch(appSource, /selectedLanguage\.flag\}/);
});

test('the header cart only shows the HT price next to its icon', () => {
  const start = appSource.indexOf('function HeaderCartMenu(');
  const end = appSource.indexOf('\nfunction FurnitureCartBar(', start);
  const source = appSource.slice(start, end);
  assert.match(source, /className="topbar-cart-total">\s*<strong>\{total\.toLocaleString\('fr-FR'\)\} € HT<\/strong>\s*<\/div>/);
  assert.doesNotMatch(source, /topbar-cart-total[\s\S]*total_ht_estimated/);
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
