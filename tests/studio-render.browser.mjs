import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const appId = resolve('src/App.jsx');
const storeId = resolve('src/data/sceneStore.js');
const clientId = resolve('src/data/supabaseClient.js');
const packs = {
  signature: { offer: 'Signature', salon: 'SITL', layout: 'left', source_payload: { hanging_limits: { ceilingM: 5.25, slingM: 4.25 } } },
  confort: { offer: 'Confort', salon: 'SMCL 2026', layout: 'right' },
  prestige: { offer: 'Prestige', salon: 'SMCL 2026', layout: 'u', status: 'validated', client_status: 'bat_validated' },
  equipe: { offer: 'Équipé', salon: 'SIAE 2027', layout: 'back' },
};
const item = (id, type, x, z, extra = {}) => ({ id, type, label: type, x, y: 0, z, rotation: 0, ...extra });
const wall = '/models/Cloison%201x2.5m%20HT%20(1).obj';
const studioDevices = [
  item('studio-tv', 'asset-tv-32', -0.75, -1.8, { label: 'TV 32', wall: 'back', dimensions: { isTelevision: true }, y: 1.5, modelUrl: '/studio-test/tv.obj', materialUrl: '/studio-test/tv.mtl' }),
  item('studio-rail', 'asset-rail-led-2-spots', 0.75, -1.8, { label: 'Rail LED 2 Spots', wall: 'back', dimensions: { isLedSpotOption: true }, y: 2.45, modelUrl: '/studio-test/rail.obj', materialUrl: '/studio-test/rail.mtl' }),
];
const studioDeviceFiles = {
  'tv.obj': deviceFixtureObj('_', 'Plastic_Metalic_Black'),
  'tv.mtl': 'newmtl _\nKd 1 1 1\nmap_Kd screen.jpg\nnewmtl Plastic_Metalic_Black\nKd 0.06 0.06 0.06\n',
  'rail.obj': deviceFixtureObj('LED_5500k_1', 'Aluminum_Anodized_Clear'),
  'rail.mtl': 'newmtl LED_5500k_1\nKd 1 0.95 0.88\nnewmtl Aluminum_Anodized_Clear\nKd 0.6 0.6 0.6\n',
};

function deviceFixtureObj(face, housing) {
  return `o fixture\nv -0.4 -0.2 0.02\nv 0.4 -0.2 0.02\nv 0.4 0.2 0.02\nv -0.4 0.2 0.02\n` +
    `v -0.44 -0.24 -0.02\nv 0.44 -0.24 -0.02\nv 0.44 0.24 -0.02\nv -0.44 0.24 -0.02\n` +
    `vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl ${face}\nf 1/1 2/2 3/3 4/4\nusemtl ${housing}\nf 5/1 6/2 7/3 8/4\n`;
}

const fixture = {
  id: 'studio-preview-fixture', status: 'created', client_status: 'draft',
  salon: 'SITL', offer: 'Signature', project_name: 'Stand de comparaison',
  dimensions: { width: 6, depth: 4 }, layout: 'left', source_payload: {},
  options: {
    carpetColorId: '1390', wallFabricColorId: '180', ledRailsEnabled: false,
    wallCovers: { left: { enabled: true } },
  },
  items: [
    ...studioDevices,
    item('hanging-sign', 'asset-enseigne-haute-1000x1000x1000mm-ht', 0, 0, {
      label: 'Enseigne haute 1m', modelUrl: '/models/Poidum%20Blanc%2050x50x50cm.obj',
      dimensions: { ceilingMounted: true, ceilingBottomY: 4, size: [1, 5.8, 1] },
    }),
    item('table', 'table', -1.52, 0.51),
    item('chair-1', 'chair', -2.24, 0.71, { rotation: 80 }),
    item('chair-2', 'chair', -1.26, -0.2, { rotation: 170 }),
    item('counter', 'counter', 0.91, 1.13),
    item('stool', 'asset-tabouret-siae', 0.91, 0.49, { modelUrl: '/models/TABOURET%20SIAE.obj', modelSize: [0.36, 0.78, 0.36], color: '#d5d5d5' }),
    item('reserve', 'reserve-fixture', 1.98, -1.42, {
      label: 'Reserve fixture', isGroup: true,
      children: [
        item('partition-1', 'reserve-partition-fixture', -0.5, 0.49, { label: 'Cloison', modelUrl: wall, modelSize: [1, 2.5, 0.06], color: '#636365' }),
        item('partition-2', 'reserve-partition-fixture', 0.5, 0.49, { label: 'Cloison', modelUrl: wall, modelSize: [1, 2.5, 0.06], color: '#636365' }),
        item('door', 'reserve-door-fixture', -0.98, 0, { label: 'Porte', rotation: 90, modelUrl: '/models/Porte%20Poussant%20Gauche%20(1).obj', modelSize: [1, 2.5, 0.06] }),
      ],
    }),
  ],
};

const probe = `
function StudioRenderProbe() {
  const state = useThree();
  const motion = useRef({});
  const hiddenRender = useRef(null);
  useFrame(({ scene, camera, controls }) => {
    if (controls) {
      const [x, y, z] = camera.position.toArray();
      const angle = controls.getAzimuthalAngle();
      const previous = motion.current.camera;
      motion.current.camera = { angle, max: Math.max(previous?.max ?? angle, angle), position: [x, y, z] };
    }
    scene.traverse((object) => {
      const phase = object.userData?.assemblyPhase;
      if (phase === 'walls') motion.current.walls = Math.min(motion.current.walls ?? 1, object.scale.y);
      if (object.userData?.itemId) {
        const id = object.userData.itemId;
        if (object.parent?.userData?.assemblyPhase === 'departure') {
          motion.current.departed = { id, scale: Math.min(motion.current.departed?.scale ?? 1, object.parent.scale.x) };
        }
        const y = object.parent?.userData?.assemblyPhase === 'item' ? object.parent.position.y : 0;
        const previous = motion.current[id] || { max: 0 };
        motion.current[id] = { max: Math.max(previous.max, y), current: y };
      }
    });
  });
  useEffect(() => {
    const { scene, gl } = state.get();
    const previousAfterRender = scene.onAfterRender;
    scene.onAfterRender = (renderer, renderedScene, camera, ...args) => {
      previousAfterRender.call(scene, renderer, renderedScene, camera, ...args);
      if (camera !== state.get().camera || !gl.domElement.closest('.scene-canvas-loading')) return;
      const items = [];
      let walls;
      scene.traverseVisible((object) => {
        if (object.userData.assemblyPhase === 'walls') walls = object.scale.y;
        if (object.userData.itemId) items.push(object.userData.itemId);
      });
      if (walls === 1) hiddenRender.current = { items };
    };
    window.studioRenderProbe = () => {
      const { gl, scene } = state.get();
      const shadow = scene.children.find(object => object.isDirectionalLight)?.shadow;
      const textures = [];
      const devices = {};
      const renderedItems = [];
      let signY;
      scene.traverse(object => {
        if (object.userData?.itemId) renderedItems.push(object.userData.itemId);
        if (object.userData?.itemId === 'hanging-sign') signY = object.position.y;
        if (['studio-tv', 'studio-rail'].includes(object.userData?.itemId)) {
          const finishes = devices[object.userData.itemId] = {};
          object.traverse(mesh => {
            for (const material of [].concat(mesh.material || [])) {
              if (material.name) finishes[material.name] = { unlit: Boolean(material.isMeshBasicMaterial), toneMapped: material.toneMapped, map: Boolean(material.map?.image) };
            }
          });
        }
        const texture = object.material?.map;
        if (texture?.isCanvasTexture && texture.wrapS === RepeatWrapping) {
          textures.push({ source: texture.source.id, repeat: texture.repeat.toArray(), anisotropy: texture.anisotropy });
        }
      });
      return {
        dpr: gl.getPixelRatio(),
        environment: Boolean(scene.environment),
        intensity: scene.environmentIntensity,
        maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
        shadowMapSize: shadow?.mapSize.toArray(),
        shadowWidth: shadow?.camera.right - shadow?.camera.left,
        shadowProjectionWidth: 2 / shadow?.camera.projectionMatrix.elements[0],
        textures,
        devices,
        signY,
        motion: motion.current,
        hiddenRender: hiddenRender.current,
        renderedItems,
      };
    };
    return () => {
      scene.onAfterRender = previousAfterRender;
      delete window.studioRenderProbe;
    };
  }, [state]);
  return null;
}
`;

const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'studio-render-test',
  enforce: 'pre',
  load(id) {
    if (id === clientId) return 'export const supabase = null; export const hasSupabase = false;';
    if (id === storeId) return `
      export * from '/src/data/sceneStore.js?studio-original';
      export async function getSceneByToken(token) {
        const scene = { ...${JSON.stringify(fixture)}, ...(${JSON.stringify(packs)})[token] };
        if (token === 'prestige') scene.source_payload = { exhibitor_view_only: true };
        if (token === 'signature') scene.source_payload = {
          ...scene.source_payload, ...JSON.parse(localStorage.getItem('studio-production-update') || '{}'),
        };
        return scene;
      }
      export async function listObjectBank() { return []; }
      export async function getSceneExhibitorState(scene) { return { status: scene.status, clientStatus: scene.client_status, locked: Boolean(scene.source_payload.exhibitor_view_only) }; }
      export async function saveScene(scene) { window.unexpectedSave = true; return scene; }
    `;
  },
  transform(source, id) {
    if (id !== appId) return;
    return source.replace('  const showCartBar = false;', '  window.addStudioItem = (item) => setItems((items) => [...items, item]);\n  window.removeStudioItem = (id) => removeSceneItemById(id);\n  const showCartBar = false;').replaceAll(
      '<StudioLighting width={width} depth={depth} />',
      '<StudioLighting width={width} depth={depth} /><StudioRenderProbe />',
    ).replace(
      'createRoot(document.getElementById(\'root\')).render(<App />);',
      `const root = createRoot(document.getElementById('root'));
      if (new URLSearchParams(location.search).has('testPackEditor')) {
        const preset = { id: 'studio-preset', base_config: {} };
        const draft = { ...${JSON.stringify(fixture)}, dimensions: { width: 14, depth: 4 }, items: [] };
        root.render(<PresetSceneEditor salon={{ name: 'SMCL 2026' }} offer={{ name: 'Confort' }}
          preset={preset} initialDraft={draft} assets={[]} onDraftChange={() => {}} />);
      } else {
        root.render(<App />);
      }`,
    ) + probe;
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1520, height: 960 }, deviceScaleFactor: 2 });
  const errors = [];
  await page.route('**/studio-test/*', async (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    if (filename === 'screen.jpg') {
      await route.fulfill({ path: resolve('public/textures/floor-laminate.jpg') });
    } else {
      await route.fulfill({ contentType: 'text/plain', body: studioDeviceFiles[filename] });
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /THREE|WebGL|shader/i.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(() => {
    localStorage.setItem('standing-config-intro:studio-preview-fixture', 'started');
    localStorage.setItem('standing-config-tutorial:studio-preview-fixture', 'done');
  });

  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const screenshots = process.env.STUDIO_RENDER_SCREENSHOTS;
  if (screenshots) await mkdir(screenshots, { recursive: true });

  async function checkStudio(name, query, viewport, standWidth, reload = false) {
    await page.setViewportSize(viewport);
    if (reload) await page.reload();
    else await page.goto(url + query);
    const exhibitor = query.startsWith('?scene=');
    await page.waitForFunction((exhibitor) => {
      const studio = window.studioRenderProbe?.();
      return studio?.environment && studio.textures.length >= 2 && !document.querySelector('.scene-texture-loader')
        && (!exhibitor || studio.devices['studio-tv']?._?.map && studio.devices['studio-rail']?.LED_5500k_1);
    }, exhibitor, { timeout: 20000 }).catch(async (error) => {
      const probeState = await page.evaluate(() => window.studioRenderProbe?.());
      throw new Error(`${name}: ${error.message}\nProbe: ${JSON.stringify(probeState)}\nBrowser errors: ${errors.join('\n')}`);
    });

    const studio = await page.evaluate(() => window.studioRenderProbe());
    assert.ok(studio.hiddenRender, `${name}: the stand renders behind the loader before being shown`);
    assert.equal(studio.intensity, 0.42, name);
    if (exhibitor) {
      assert.ok(['table', 'studio-tv', 'studio-rail'].every((id) => studio.hiddenRender.items.includes(id)), name);
      assert.equal(studio.signY, name === 'signature' ? 3.25 : 4, name);
      const tv = studio.devices['studio-tv'];
      assert.deepEqual(tv._, { unlit: true, toneMapped: false, map: true }, name);
      assert.equal(tv.Plastic_Metalic_Black.unlit, false, name);
      const rail = studio.devices['studio-rail'];
      assert.deepEqual(rail.LED_5500k_1, { unlit: true, toneMapped: false, map: false }, name);
      assert.equal(rail.Aluminum_Anodized_Clear.unlit, false, name);
    }
    assert.equal(studio.dpr, 1.5, name);
    assert.deepEqual(studio.shadowMapSize, [2048, 2048], name);
    assert.ok(studio.shadowWidth >= standWidth, name);
    assert.ok(Math.abs(studio.shadowWidth - studio.shadowProjectionWidth) < 0.0001, name);
    assert.ok(studio.textures.some(({ repeat }) => Math.abs(repeat[0] - standWidth * 1.8) < 0.0001), name);
    assert.ok(studio.textures.every(({ anisotropy }) => anisotropy === Math.min(studio.maxAnisotropy, 8)), name);
    if (query === '?scene=prestige') {
      assert.ok(studio.textures.some((texture) => studio.textures.some((other) => (
        other.source === texture.source && other.repeat[0] !== texture.repeat[0]
      ))), `${name}: different wall sizes reuse the same texture data`);
    }
    assert.equal(await page.locator('.studio-render-toggle').count(), 0, name);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name);
    assert.equal(await page.evaluate(() => window.unexpectedSave), undefined, name);
    if (screenshots) await page.locator('canvas').first().screenshot({ path: resolve(screenshots, `${name}.png`), scale: 'css' });
  }

  const desktop = { width: 1520, height: 960 };
  for (const pack of Object.keys(packs)) await checkStudio(pack, '?scene=' + pack, desktop, 6);
  await checkStudio('signature', '?scene=signature', desktop, 6);
  await page.evaluate(() => localStorage.setItem('studio-production-update', JSON.stringify({
    hanging_limits: { ceilingM: 5.25, slingM: 5.25, slingStatus: '5,25 m' }, plan_aisle_side: 'right',
  })));
  await checkStudio('signature-after-monday-sync', '?scene=signature', desktop, 6, true);
  await page.evaluate(() => localStorage.removeItem('studio-production-update'));
  await checkStudio('equipe-mobile', '?scene=equipe', { width: 390, height: 844 }, 6);
  await checkStudio('confort-pack-editor', '?testPackEditor', desktop, 14);
  await page.goto(url + '?scene=prestige');
  await checkStudio('motion-saved-scene-reload', '?scene=prestige', desktop, 6, true);
  const originalView = [4.5, 4.2, 5.7];
  const originalAngle = Math.atan2(originalView[0], originalView[2]);
  await page.waitForFunction((angle) => {
    const camera = window.studioRenderProbe?.().motion.camera;
    return camera?.max > angle + .2 && Math.abs(camera.angle - angle) < .001;
  }, originalAngle);
  const motion = await page.evaluate(() => window.studioRenderProbe().motion);
  assert.ok(motion.walls < 1 && motion.table.max > .05, 'The stand assembles on a previously validated scene');
  assert.ok(motion.camera.position.every((value, index) => Math.abs(value - originalView[index]) < .01), 'The opening orbit ends at the original framing');
  await checkStudio('motion-new-item', '?scene=confort', desktop, 6);
  await page.waitForFunction((angle) => {
    const camera = window.studioRenderProbe().motion.camera;
    return camera?.max > angle + .2 && Math.abs(camera.angle - angle) < .001;
  }, originalAngle);
  await page.evaluate(() => window.addStudioItem({ id: 'motion-chair', type: 'chair', label: 'Chaise', x: 0, y: 0, z: 0, rotation: 0 }));
  await page.waitForFunction(() => window.studioRenderProbe().motion['motion-chair']?.max > .05 && window.studioRenderProbe().motion['motion-chair'].current === 0);
  assert.ok(Math.abs(await page.evaluate(() => window.studioRenderProbe().motion.camera.angle) - originalAngle) < .001, 'Adding an item does not replay the orbit');
  await page.evaluate(() => window.removeStudioItem('motion-chair'));
  await page.waitForFunction(() => {
    const { motion, renderedItems } = window.studioRenderProbe();
    return motion.departed?.id === 'motion-chair' && motion.departed.scale < .98 && !renderedItems.includes('motion-chair');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await checkStudio('motion-reduced', '?scene=confort', desktop, 6);
  const reducedMotion = await page.evaluate(() => window.studioRenderProbe().motion);
  assert.equal(reducedMotion.walls, 1);
  assert.equal(reducedMotion.table.max, 0);
  assert.ok(Math.abs(reducedMotion.camera.max - originalAngle) < .001, 'Reduced motion disables the opening orbit');
  await page.evaluate(() => window.removeStudioItem('chair-1'));
  await page.waitForFunction(() => !window.studioRenderProbe().renderedItems.includes('chair-1'));
  assert.equal(await page.evaluate(() => window.studioRenderProbe().motion.departed), undefined);
  assert.deepEqual(errors, []);
  console.log('Studio render: hidden warmup on reload, opening motion, item entry/departure, reduced motion, and studio lighting OK.');
} finally {
  await browser?.close();
  await server.close();
}
