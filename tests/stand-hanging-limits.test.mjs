import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { clampHangingSignBottom, effectiveHangingLimit, hangingSignBodyHeight, parseHeightMeters } from '../supabase/functions/_shared/standHangingLimits.js';

test('ceiling and sling heights use metres, respect the lower value and default to 5.25', () => {
  for (const value of ['4,25 m', '4.25', 4.25]) assert.equal(parseHeightMeters(value), 4.25);
  for (const value of ['ATT', 'AUTRE', 'PAS BESOIN', '0', '4 m 25', '4,25 cm']) assert.equal(parseHeightMeters(value), null);
  assert.equal(effectiveHangingLimit(), 5.25);
  assert.equal(effectiveHangingLimit({ ceilingM: 4.8, slingM: 4.25 }), 4.25);
  assert.equal(effectiveHangingLimit({ ceilingM: 4.1, slingM: 4.25 }), 4.1);
  assert.equal(effectiveHangingLimit({ ceilingM: 4.8, slingM: null }), 4.8);
});

test('the renderer lowers only hanging signs and excludes the built-in cables from the sign height', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('function sceneItemDisplayY(');
  const context = vm.createContext({
    floorItemBaseY: () => 4,
    isCeilingMountedItem: (item) => item.dimensions.ceilingMounted,
    isHighSignageVisualItem: (item) => item.label.startsWith('Enseigne haute'),
    itemGroupBounds: (item) => ({ height: item.dimensions.size[1] }),
    clampHangingSignBottom, hangingSignBodyHeight,
  });
  vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 2), context);

  const cube = { label: 'Enseigne haute 1m', modelUrl: '/enseigne-haute-1000x1000x1000mm-ht.glb', dimensions: { ceilingMounted: true, size: [1, 5.8, 1] } };
  const hex = { ...cube, modelUrl: '/enseigne-haute-1500x1300mm-ht.obj' };
  assert.equal(context.sceneItemDisplayY(cube, { hangingLimitM: 4.25 }), 3.25);
  assert.equal(context.sceneItemDisplayY(hex, { hangingLimitM: 4.25 }), 2.95);
  assert.equal(context.sceneItemDisplayY(cube, { hangingLimitM: 5.25 }), 4);
  assert.equal(context.sceneItemDisplayY(cube, { hangingLimitM: null }), 4);
  assert.equal(context.sceneItemDisplayY({ ...cube, label: 'Projecteur suspendu' }, { hangingLimitM: 4.25 }), 4);
});
