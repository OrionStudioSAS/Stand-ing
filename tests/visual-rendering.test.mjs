import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');

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

test('both configurator canvases use the brighter studio environment', () => {
  assert.equal((appSource.match(/<ConfiguratorLighting \/>/g) || []).length, 2);
  assert.match(appSource, /new RoomEnvironment\(\)/);
  assert.match(appSource, /scene\.environmentIntensity = 1\.2/);
});

test('chrome materials are detected for reflective furniture legs', () => {
  const api = vm.createContext({});
  loadFunction(appSource, api, 'isChromeMaterial');
  assert.equal(api.isChromeMaterial({ name: 'chrome' }), true);
  assert.equal(api.isChromeMaterial({ name: 'Acier poli' }), true);
  assert.equal(api.isChromeMaterial({ name: 'top' }), false);
});

