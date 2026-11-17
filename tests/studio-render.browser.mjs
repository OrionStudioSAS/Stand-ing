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
  useEffect(() => {
    window.studioRenderProbe = () => {
      const { gl, scene } = state.get();
      const shadow = scene.children.find(object => object.isDirectionalLight)?.shadow;
      const textures = [];
      const devices = {};
      let signY;
      scene.traverse(object => {
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
          textures.push({ repeat: texture.repeat.toArray(), anisotropy: texture.anisotropy });
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
      };
    };
    return () => delete window.studioRenderProbe;
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
        return scene;
      }
      export async function listObjectBank() { return []; }
      export async function getSceneExhibitorState(scene) { return { status: scene.status, clientStatus: scene.client_status, locked: Boolean(scene.source_payload.exhibitor_view_only) }; }
      export async function saveScene(scene) { window.unexpectedSave = true; return scene; }
    `;
  },
  transform(source, id) {
    if (id !== appId) return;
    return source.replaceAll(
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

  async function checkStudio(name, query, viewport, standWidth) {
    await page.setViewportSize(viewport);
    await page.goto(url + query);
    const exhibitor = query.startsWith('?scene=');
    await page.waitForFunction((exhibitor) => {
      const studio = window.studioRenderProbe?.();
      return studio?.environment && studio.textures.length >= 2 && (!exhibitor || studio.devices['studio-tv']?._?.map && studio.devices['studio-rail']?.LED_5500k_1);
    }, exhibitor, { timeout: 20000 }).catch(async (error) => {
      const probeState = await page.evaluate(() => window.studioRenderProbe?.());
      throw new Error(`${name}: ${error.message}\nProbe: ${JSON.stringify(probeState)}\nBrowser errors: ${errors.join('\n')}`);
    });

    const studio = await page.evaluate(() => window.studioRenderProbe());
    assert.equal(studio.intensity, 0.42, name);
    if (exhibitor) {
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
    assert.equal(await page.locator('.studio-render-toggle').count(), 0, name);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name);
    assert.equal(await page.evaluate(() => window.unexpectedSave), undefined, name);
    if (screenshots) await page.locator('canvas').first().screenshot({ path: resolve(screenshots, `${name}.png`), scale: 'css' });
  }

  const desktop = { width: 1520, height: 960 };
  for (const pack of Object.keys(packs)) await checkStudio(pack, '?scene=' + pack, desktop, 6);
  await checkStudio('equipe-mobile', '?scene=equipe', { width: 390, height: 844 }, 6);
  await checkStudio('confort-pack-editor', '?testPackEditor', desktop, 14);
  assert.deepEqual(errors, []);
  console.log('Studio render: all four packs and mobile keep TV screens and spot lenses bright under the unchanged studio lighting; locked scenes are not saved');
} finally {
  await browser?.close();
  await server.close();
}
