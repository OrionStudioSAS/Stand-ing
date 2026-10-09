import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { DoubleSide, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace, Texture } from 'three';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const groundSource = readFileSync(new URL('../src/PresentationGround.jsx', import.meta.url), 'utf8');

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

test('configurator scene uses a black backdrop and textured ground without changing its lighting', () => {
  const start = appSource.indexOf('className={sceneCanvasClassName}');
  const end = appSource.indexOf('</Canvas>', start);
  const canvas = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(canvas, /gl=\{\{ alpha: true \}\}/);
  assert.match(canvas, /<color attach="background" args=\{\['#050506'\]\} \/>/);
  assert.match(canvas, /<PresentationGround \/>/);
  assert.match(stylesSource, /\.configurator-stage\s*\{[^}]*background: #050506/);
  assert.match(groundSource, /function PresentationGround\(\)[\s\S]*<planeGeometry args=\{\[40, 40\]\}/);
  assert.equal((appSource.match(/<PresentationGround \/>/g) || []).length, 2);
});

test('presentation ground uses continuous filtered grain and an analytic fade, not stretched pixels', () => {
  assert.match(groundSource, /fwidth\(p\)/);
  assert.match(groundSource, /smoothstep\(9\.0, 19\.6, length\(vGroundPosition\)\)/);
  assert.match(groundSource, /#include <colorspace_fragment>/);
  assert.match(groundSource, /raycast=\{\(\) => null\}/);
  assert.match(groundSource, /transparent depthWrite=\{false\}/);
  assert.doesNotMatch(groundSource, /CanvasTexture|createImageData/);
});

test('scene orbiting and panning cannot expose the underside of the ground', () => {
  const api = vm.createContext({ sceneCameraTargetMinY: 0.7 });
  loadFunction(appSource, api, 'keepSceneCameraAboveGround');
  const controls = { target: { y: -0.3 }, object: { position: { y: 1 } }, updateCalls: 0, update() { this.updateCalls += 1; } };
  api.keepSceneCameraAboveGround(controls);
  assert.equal(controls.target.y, 0.7);
  assert.equal(controls.object.position.y, 2);
  assert.equal(controls.updateCalls, 1);
  api.keepSceneCameraAboveGround(controls);
  assert.equal(controls.updateCalls, 1);
  assert.equal((appSource.match(/maxPolarAngle=\{sceneCameraMaxPolarAngle\}/g) || []).length, 2);
  assert.equal((appSource.match(/onChange=\{\(\) => keepSceneCameraAboveGround\(orbitControlsRef\.current\)\}/g) || []).length, 2);
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
  const api = vm.createContext({ DoubleSide, isSignaturePrintedSurface: () => false });
  for (const name of ['normalizeMaterialName', 'normalizedItemText', 'normalizeMaterialTexture', 'isChromeMaterial', 'isAluminiumMaterial', 'isImportedNonmetalFinish', 'isBrightFridgeFinish', 'cloneAndNormalizeMaterial', 'cloneMeshMaterial']) {
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
  assert.equal(fixedFridge.emissiveIntensity, 0.16);
  assert.equal(fixedFridge.color.getHexString(), fridge.color.getHexString());
  const fixedLargeFridge = api.cloneMeshMaterial(largeFridge, { label: 'Frigo 220L' });
  assert.equal(fixedLargeFridge.metalness, 0);
  assert.equal(fixedLargeFridge.emissiveIntensity, 0.16);
  assert.equal(fixedFabric.metalness, 0);
  assert.equal(fridge.metalness, 0.5);
  assert.equal(api.cloneMeshMaterial(whiteChair, { label: 'Chaise One Blanc' }).metalness, 0);
  assert.equal(api.cloneMeshMaterial(chrome, { label: 'Table Icare Blanc' }).metalness, 0.48);
  assert.equal(api.cloneMeshMaterial(genericColor, { label: 'Chaise One Rouge' }).metalness, 0.6);
  const darkFridgePart = new MeshStandardMaterial({ name: 'Dark plastic', color: '#333333', metalness: 0.5 });
  assert.equal(api.cloneMeshMaterial(darkFridgePart, { label: 'Frigo 220L' }).emissiveIntensity, 1);
});

test('Signature printed panels stay white without metallic gray, including uploaded image margins', () => {
  const api = vm.createContext({ DoubleSide, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace });
  api.isSignaturePackLabel = (label) => label === 'Signature';
  for (const name of [
    'normalizeMaterialName', 'normalizedItemText', 'normalizeMaterialTexture',
    'isChromeMaterial', 'isAluminiumMaterial', 'isPartitionHeadItem',
    'isSignaturePartitionHeadItem', 'isSignatureArchItem', 'isSignaturePrintedSurface',
    'isImportedNonmetalFinish', 'cloneAndNormalizeMaterial', 'materialWithTexture',
  ]) loadFunction(appSource, api, name);

  const arch = { label: 'Arche Totem + Plafond Spot' };
  const head = { label: 'Tete De Cloison - Signature', dimensions: { packs: ['Signature'] } };
  const whitePanel = (name) => new MeshStandardMaterial({ name, color: '#ffffff', metalness: 0.5, roughness: 0.5, map: new Texture() });
  const archVisual = api.cloneAndNormalizeMaterial(whitePanel('LED_5500k#5'), arch);
  const headTop = api.cloneAndNormalizeMaterial(whitePanel('*28'), head);
  const uploaded = new Texture();
  const archWithImage = api.materialWithTexture(archVisual, uploaded);

  assert.equal(archVisual.metalness, 0);
  assert.equal(headTop.metalness, 0);
  assert.equal(headTop.emissiveMap, headTop.map);
  assert.equal(archWithImage.emissiveMap, uploaded);
  assert.equal(archWithImage.emissiveIntensity, 0.16);
  assert.equal(api.cloneAndNormalizeMaterial(whitePanel('LED_5500k#5'), { label: 'Other stand' }).metalness, 0.5);
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
