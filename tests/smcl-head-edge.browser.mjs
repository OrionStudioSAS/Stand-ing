import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__smcl-edge-app.jsx');
const pageId = resolve('src/__smcl-edge-page.jsx');
const cache = await mkdtemp(join(tmpdir(), 'standing-smcl-edge-'));
const assets = [
  ['left', 'gauche', 'mr2nejng', -.33793, .26207],
  ['right', 'droite', 'mr2nf7wt', -.262075, .337925],
].map(([side, label, suffix, minX, maxX]) => ({
  id: side, type: `asset-tete-de-cloison-smcl-${label}-${suffix}`, label: `Tete de cloison ${label}`,
  modelUrl: `/__smcl-${side}.glb`, isWallItem: true, wall: 'back', x: 0, z: 0,
  placementRule: { id: `outer-${side}`, locked: true },
  dimensions: { size: [1.25, 3, .11], smclHeadSide: side,
    placementBounds: { minX, maxX, minZ: -.055, maxZ: -.014, height: 2.4, source: 'legacy-smcl-head' } },
  options: {},
}));
const harness = `
import React, { Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Box3 } from 'three';
import { SceneItem, constrainItem, technicalPartitionHeadPose, sideWallEndZ } from '/src/__smcl-edge-app.jsx';
const assets = ${JSON.stringify(assets)};
function Probe({ fixture, items }) {
  useFrame(({ scene }) => {
    scene.updateMatrixWorld(true);
    const heads = [];
    for (const item of items) {
      let group;
      scene.traverse((node) => { if (node.userData.standSceneItem && node.userData.itemId === item.id) group = node; });
      if (!group) continue;
      const support = new Box3();
      const frame = new Box3();
      group.traverse((node) => {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (node.isMesh && materials.some((material) => material?.name.includes('MeshFabric_A01_16cm'))) support.union(new Box3().setFromObject(node));
        if (node.isMesh && materials.some((material) => material?.name === 'Laminate_D02_120cm_2')) frame.union(new Box3().setFromObject(node));
      });
      if (support.isEmpty() || frame.isEmpty()) continue;
      heads.push({ side: item.id, wall: item.wall, min: support.min.toArray(), max: support.max.toArray(),
        frameMin: frame.min.toArray(), frameMax: frame.max.toArray(),
        position: group.position.toArray(), pose: technicalPartitionHeadPose(item, items, fixture.width, fixture.depth) });
    }
    window.smclResult = { ...fixture, heads, frontEdge: sideWallEndZ(fixture.depth) };
  });
  return null;
}
function Test() {
  const [fixture, setFixture] = useState({ pack: 'Confort', layout: 'back', width: 6, depth: 3, revision: 0 });
  useEffect(() => { window.setSmclFixture = setFixture; }, []);
  const items = assets.map((asset) => constrainItem({ ...asset, dimensions: { ...asset.dimensions, packs: [fixture.pack] } }, fixture.width, fixture.depth, fixture.layout));
  return <Canvas camera={{ position: [7, 7, 9] }} onCreated={({ camera }) => camera.lookAt(0, 1, 0)}>
    <ambientLight intensity={2} />
    <Suspense fallback={null}>{items.map((item) => <SceneItem key={item.id} item={item} items={items} width={fixture.width} depth={fixture.depth} />)}</Suspense>
    <Probe fixture={fixture} items={items} />
  </Canvas>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
let browser;
let server;
try {
  // Use the real catalog GLBs, including their off-centre lower support and upper wing.
  for (const asset of assets) {
    const label = asset.id === 'left' ? 'gauche' : 'droite';
    const response = await fetch(`https://eljedngumyxwlvbckkkx.supabase.co/storage/v1/object/public/object-assets/${asset.type}/tete-de-cloison-smcl-${label}.glb`);
    assert.ok(response.ok, `Download ${label}: ${response.status}`);
    await writeFile(join(cache, `${asset.id}.glb`), Buffer.from(await response.arrayBuffer()));
  }
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
    name: 'smcl-head-edge-test',
    resolveId(id) {
      if (id === '/src/__smcl-edge-app.jsx') return appId;
      if (id === '/src/__smcl-edge-page.jsx') return pageId;
    },
    load(id) {
      if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { SceneItem, constrainItem, technicalPartitionHeadPose, sideWallEndZ };');
      if (id === pageId) return harness;
    },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/__smcl-edge-test__') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%}</style><div id="root"></div><script type="module" src="/src/__smcl-edge-page.jsx"></script>');
      } else {
        const asset = assets.find((entry) => entry.modelUrl === req.url);
        if (!asset) return next();
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.end(await readFile(join(cache, `${asset.id}.glb`)));
      }
    }); },
  }] });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__smcl-edge-test__`);
  await page.waitForFunction(() => window.smclResult?.heads.length === 2, null, { timeout: 60000 });
  let revision = 0;
  for (const pack of ['Confort', 'Prestige']) {
    for (const layout of ['back', 'left', 'right', 'u']) {
      for (const [width, depth] of [[6, 3], [6.13, 3.19]]) {
        const fixture = { pack, layout, width, depth, revision: ++revision };
        await page.evaluate((fixture) => window.setSmclFixture(fixture), fixture);
        await page.waitForFunction((revision) => window.smclResult?.revision === revision && window.smclResult.heads.length === 2, revision);
        const result = await page.evaluate(() => window.smclResult);
        for (const head of result.heads) {
          const edge = head.wall === 'back' ? head[head.side === 'left' ? 'min' : 'max'][0] : head.max[2];
          const expected = head.wall === 'back' ? (head.side === 'left' ? -width / 2 : width / 2) : result.frontEdge;
          assert.ok(Math.abs(edge - expected) < .001, `${pack}/${layout}/${head.side}: real support edge ${edge}, expected ${expected}`);
          // The rear frame touches the wall; the fabric face is recessed within it.
          const gap = head.wall === 'back' ? head.frameMin[2] - (-depth / 2 + .06)
            : head.wall === 'left' ? head.frameMin[0] - (-width / 2 + .06)
              : (width / 2 - .06) - head.frameMax[0];
          assert.ok(Math.abs(gap) < .001, `${pack}/${layout}/${head.side}: real frame-to-wall gap ${gap}`);
          assert.equal(head.pose.x, head.position[0], 'BAT shares the rendered X');
          assert.equal(head.pose.z, head.position[2], 'BAT shares the rendered Z');
          assert.equal(head.pose.rotation, head.wall === 'left' ? 90 : head.wall === 'right' ? -90 : 0);
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('Confort/Prestige: both real GLB supports touch walls and scene edges within 1 mm on all layouts; BAT position/orientation match.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(cache, { recursive: true, force: true });
}
