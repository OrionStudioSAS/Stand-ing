import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const start = app.indexOf('function assetBatPictoPreviews(');
const api = vm.createContext({});
vm.runInContext(app.slice(start, app.indexOf('\n}\n', start) + 2), api);
const clearStart = app.indexOf('function clearBatPictoMetadata(');
vm.runInContext(app.slice(clearStart, app.indexOf('\n}\n', clearStart) + 2), api);

test('BAT previews use the saved pictogram, never the object thumbnail', () => {
  const asset = { label: 'Fridge', thumbnail_url: '/catalogue.png', dimensions: { batPictoUrl: '/bat.svg' } };
  const previews = api.assetBatPictoPreviews(asset);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].imageUrl, '/bat.svg');
  assert.equal(previews[0].label, 'Fridge');
  assert.equal(api.assetBatPictoPreviews({ thumbnail_url: '/catalogue.png' }).length, 0);
  assert.equal(api.assetBatPictoPreviews({ dimensions: null }).length, 0);
});

test('variant overrides and legacy variant pictograms are recognized', () => {
  const asset = { dimensions: { variantMeta: {
    white: { batPictoUrl: '/white.svg' },
    black: { batPictoUrl: '/black.png' },
    other: { itemImageUrl: '/not-a-bat.png' },
    empty: null,
  } } };
  const previews = api.assetBatPictoPreviews(asset);
  assert.equal(previews.length, 2);
  assert.equal(previews[0].label, 'white');
  assert.equal(previews[1].imageUrl, '/black.png');
  assert.equal(api.assetBatPictoPreviews({ dimensions: { variantBatPictos: { old: { batPictoUrl: '/legacy.svg' } } } })[0].imageUrl, '/legacy.svg');
});

test('replacing a saved pictogram updates preview data without caching the old URL', () => {
  const original = { dimensions: { batPictoUrl: '/old.svg' } };
  const updated = { dimensions: { batPictoUrl: '/new.svg' } };
  assert.equal(api.assetBatPictoPreviews(updated)[0].imageUrl, '/new.svg');
  assert.equal(original.dimensions.batPictoUrl, '/old.svg');
});

test('grid, list, drawer and variants expose BAT previews without changing uploads', () => {
  assert.match(app, /<th>Picto BAT<\/th>/);
  assert.match(app, /<AssetBatPictoBadge asset=\{asset\} emptyLabel=/);
  assert.match(app, /<AssetBatPictoBadge asset=\{asset\} \/>/);
  assert.match(app, /<BatPictoPreview imageUrl=\{draft\.dimensions\?\.batPictoUrl\}/);
  assert.match(app, /meta\.batPictoUrl \|\| selectedSource\?\.dimensions\?\.batPictoUrl/);
  assert.match(app, /changeBatPicto\(event\.target\.files\?\.\[0\] \|\| null\)/);
  assert.match(app, /Voir le picto en grand/);
  assert.match(app, /onError=\{\(\) => setFailedUrl\(imageUrl\)\}/);
  assert.match(css, /\.bat-picto-preview-image img[^\n]*object-fit: contain/);
  assert.match(css, /\.bat-picto-preview-image[^\n]*conic-gradient/);
});

test('removing a BAT pictogram clears its URL, path and recoloring, not the object data', () => {
  const original = { batPictoUrl: '/bat.svg', batPictoPath: 'object/bat.svg', batPictoReplaceColor: '#ff00ff', width: 1, textureSlots: [{ id: 'front' }], other: true };
  const cleared = api.clearBatPictoMetadata(original);
  assert.equal(cleared.batPictoUrl, '');
  assert.equal(cleared.batPictoPath, '');
  assert.equal(cleared.batPictoReplaceColor, '');
  assert.equal(cleared.width, 1);
  assert.equal(cleared.textureSlots, original.textureSlots);
  assert.equal(original.batPictoUrl, '/bat.svg');
  assert.equal(api.assetBatPictoPreviews({ dimensions: cleared }).length, 0);
});

test('cross persists the detached pictogram and keeps the old preview on save failure', async () => {
  const handlerStart = app.indexOf('  const removeBatPicto = async () => {');
  const handler = app.slice(handlerStart, app.indexOf('\n  };', handlerStart) + 5);
  const original = { type: 'fridge', label: 'Frigo', model_url: '/fridge.glb', thumbnail_url: '/catalogue.png', dimensions: { batPictoUrl: '/bat.svg', batPictoPath: 'bat.svg' } };
  for (const fail of [false, true]) {
    const states = [];
    let draft = original;
    let error = '';
    let saved;
    const context = vm.createContext({
      draft: original, batPictoUploading: false, clearBatPictoMetadata: api.clearBatPictoMetadata,
      setBatPictoUploading: (value) => states.push(value), setBatPictoError: (value) => { error = value; },
      setDraft: (value) => { draft = value; },
      onSave: async (value) => { if (fail) throw new Error('Save denied'); saved = value; return value; },
    });
    vm.runInContext(`${handler}\nglobalThis.remove = removeBatPicto;`, context);
    await context.remove();
    assert.deepEqual(states, [true, false]);
    if (fail) {
      assert.equal(draft, original);
      assert.equal(error, 'Save denied');
    } else {
      assert.equal(saved.dimensions.batPictoUrl, '');
      assert.equal(draft, saved);
      assert.equal(saved.model_url, original.model_url);
      assert.equal(saved.thumbnail_url, original.thumbnail_url);
      assert.equal(error, '');
    }
  }
  assert.match(app, /onRemove=\{removeBatPicto\} removeDisabled=\{batPictoUploading\}/);
  assert.match(app, /aria-label=\{`Supprimer le picto BAT de \$\{label\}`\}/);
  assert.match(css, /\.bat-picto-remove:focus-visible/);
});
