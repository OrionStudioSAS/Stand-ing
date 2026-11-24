import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const storage = 'https://eljedngumyxwlvbckkkx.supabase.co/storage/v1/object/public/object-assets/';
const fixtures = [
  ['podium-white', 'PODIUM BLANC 50x50x100cm HT', 'asset-podium-blanc-50x50x100cm-ht-mqpnvaxp', 'podium-blanc-50x50x100cm-ht.obj', [.5, 1, .5]],
  ['podium-black', 'PODIUM NOIR 50x50x100cm HT', 'asset-podium-noir-50x50x100cm-ht-mqpng77b', 'podium-noir-50x50x100cm-ht.obj', [.5, 1, .5]],
  ['icare', 'Mange Debout Icare Blanc', 'asset-mange-debout-icare-blanc-mufknchd', 'mange_debout_icare_blanc.glb', [.8, 1.1, .8]],
  ['telephe', 'Mange Debout Telephe Blanc', 'asset-mange-debout-telephe-blanc-mufkqcc0', 'mange_debout_telephe_blanc.glb', [.79, 1.1, .8]],
  ['counter', 'Comptoir accueil blanc 0.5m + Signa', 'asset-banque-accueil-blanc-0-5m-signa-mvghqhov', 'banque-accueil-blanc-0.5m-signa.glb', [.5, 1, .48]],
].map(([id, label, type, file, size], index) => ({
  id, label, type, modelUrl: storage + type + '/' + file,
  materialUrl: file.endsWith('.obj') ? storage + type + '/' + file.replace('.obj', '.mtl') : null,
  x: (index - 2) * 1.5, z: 0, rotation: 0, dimensions: { size }, options: {},
}));
const output = process.env.WHITE_FINISH_SCREENSHOTS || resolve(tmpdir(), 'standing-white-finish');
await mkdir(output, { recursive: true });
const appId = resolve('src/__white-finish-app.jsx');
const pageId = resolve('src/__white-finish-page.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const harness = `
import React, { Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { SceneItem } from '/src/__white-finish-app.jsx';
import { StudioLighting } from '/src/StudioLighting.jsx';
const fixtures = ${JSON.stringify(fixtures)};
function Probe() {
  const { scene, gl, camera } = useThree();
  useEffect(() => {
    window.whiteFinishProbe = () => {
      const materials = {};
      scene.traverse((group) => {
        if (!group.userData?.itemId) return;
        const result = materials[group.userData.itemId] = {};
        group.traverse((mesh) => {
          for (const material of [].concat(mesh.material || [])) {
            if (material.name) result[material.name] = { color: material.color?.getHexString(), type: material.type, metalness: material.metalness, roughness: material.roughness, emissive: material.emissive?.getHexString(), emissiveIntensity: material.emissiveIntensity, map: !!material.map?.image };
          }
        });
      });
      gl.render(scene, camera);
      const context = gl.getContext();
      const sample = (point) => {
        const projected = new Vector3(...point).project(camera), pixel = new Uint8Array(4);
        context.readPixels(Math.floor((projected.x + 1) * context.drawingBufferWidth / 2), Math.floor((projected.y + 1) * context.drawingBufferHeight / 2), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      const pixels = { podiumFront: sample([-3, .5, .251]), podiumSide: sample([-2.749, .5, 0]), podiumTop: sample([-3, 1.001, 0]), blackFront: sample([-1.5, .5, .251]), icareTop: sample([0, 1.101, 0]), telepheTop: sample([1.5, 1.101, 0]), counterSide: sample([3.251, .5, 0]) };
      context.finish();
      return { environment: !!scene.environment, materials, pixels,
        glError: context.getError(), drawCalls: gl.info.render.calls,
        programsReady: gl.info.programs.every((program) => program.diagnostics?.runnable !== false) };
    };
    return () => { delete window.whiteFinishProbe; };
  }, [scene, gl, camera]);
  return null;
}
createRoot(document.getElementById('root')).render(<Canvas shadows flat frameloop="demand" camera={{ position: [5, 4.5, 8], fov: 45 }} gl={{ preserveDrawingBuffer: true }} onCreated={({ camera }) => camera.lookAt(0, .5, 0)}>
  <color attach="background" args={['#050506']} />
  <StudioLighting width={8} depth={3} />
  <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[10, 4]} /><meshStandardMaterial color="#909090" roughness={.85} /></mesh>
  <Suspense fallback={null}>{fixtures.map((item) => <SceneItem key={item.id} item={item} items={fixtures} width={8} depth={3} />)}</Suspense>
  <Probe />
</Canvas>);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'white-finish-regression',
  resolveId(id) { if (id === '/src/__white-finish-app.jsx') return appId; if (id === '/src/__white-finish-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { SceneItem };');
    if (id === pageId) return harness;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__white-finish-test__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%}</style><div id="root"></div><script type="module" src="/src/__white-finish-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__white-finish-test__`);
  await page.waitForFunction(() => {
    const result = window.whiteFinishProbe?.();
    return result?.environment && Object.values(result.materials).filter((materials) => Object.keys(materials).length > 0).length === 5;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => window.whiteFinishProbe());
  await writeFile(resolve(output, 'probe.json'), JSON.stringify(result, null, 2));
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, 'desktop.png') });
  console.log(JSON.stringify(result));
  assert.deepEqual(errors, []);
  assert.equal(result.glError, 0);
  assert.equal(result.programsReady, true);
  assert.ok(result.drawCalls > 5, 'All fixtures and the floor render');
  if (!process.env.WHITE_FINISH_BASELINE) {
    const podium = result.materials['podium-white'].Laminate_D02_120cm_2;
    assert.equal(podium.type, 'MeshStandardMaterial');
    assert.equal(podium.map, true, 'The original white laminate texture is retained');
    assert.equal(podium.emissive, '000000', 'White finishes are not made self-illuminating');
    assert.equal(result.materials.counter.Plastic_Metalic_Black.color, '353535', 'Real GLB black plastic keeps its source color');
    assert.equal(result.materials.counter.Plastic_Metalic_Black.metalness, 0);
    assert.equal(result.materials.icare.chrome.metalness, .48, 'Chrome remains reflective');
    assert.ok(result.pixels.podiumFront[0] > 205, 'White podium front stays white in the studio');
    assert.ok(result.pixels.podiumSide[0] > 190, 'White podium shaded side does not turn dark grey');
    assert.ok(result.pixels.blackFront[0] < 100, 'Black podium is not whitened');
    assert.ok(result.pixels.icareTop[0] > 230 && result.pixels.telepheTop[0] > 230, 'Already-correct white GLB tabletops stay white');
    assert.ok(result.pixels.podiumTop[0] - result.pixels.podiumSide[0] > 5, 'White surfaces retain directional shading');
  }
} finally { await browser?.close(); await server.close(); }
