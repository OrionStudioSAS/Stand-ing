import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const source = await readFile('src/App.jsx', 'utf8');
const appId = resolve('src/__signature-standard-app.jsx');
const pageId = resolve('src/__signature-standard-page.jsx');
const names = ['LED_5500k#4', '*28', 'LED_5500k#40'];
const positions = new Float32Array([-.23, 0, 0, .23, 0, 0, .23, 2.13, 0, -.23, 0, 0, .23, 2.13, 0, -.23, 2.13, 0]);
const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
const normals = new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat());
const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(normals.buffer)]);
const gltf = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }],
  nodes: names.map((name, mesh) => ({ name, mesh, ...(mesh ? { translation: [0, 2.2 + mesh * .25, 0], scale: [1, .1, 1] } : {}) })),
  buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength }, { buffer: 0, byteOffset: positions.byteLength + uvs.byteLength, byteLength: normals.byteLength }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-.23, 0, 0], max: [.23, 2.13, 0] }, { bufferView: 1, componentType: 5126, count: 6, type: 'VEC2' }, { bufferView: 2, componentType: 5126, count: 6, type: 'VEC3' }],
  materials: names.map(name => ({ name, pbrMetallicRoughness: { baseColorFactor: [.2, .3, .7, 1], metallicFactor: 0, roughnessFactor: .9 } })),
  meshes: names.map((_, material) => ({ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 }, material }] })),
});
const obj = `v -0.23 0 0
v 0.23 0 0
v 0.23 2.13 0
v -0.23 2.13 0
v -0.23 2.2 0
v 0.23 2.2 0
v 0.23 2.5 0
v -0.23 2.5 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
o LowerVisual
usemtl LED_5500k#4
f 1/1 2/2 3/3 4/4
o Top
usemtl *28
f 5/1 6/2 7/3 8/4
o Neighbor
usemtl LED_5500k#40
f 5 6 7
`;
const harness = `
import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { Model3D } from '/src/__signature-standard-app.jsx';
const custom = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="460" height="2130"><rect width="460" height="2130" fill="red"/></svg>');
function Probe() {
  useFrame(({scene}) => {
    const results = [];
    scene.traverse(node => {
      if (!node.userData.headTest) return;
      node.traverse(mesh => {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material || !${JSON.stringify(names)}.includes(material.name)) continue;
          const canvas = material.map?.image;
          results.push({ id:node.userData.headTest, name:material.name, width:canvas?.width, height:canvas?.height,
            pixels:canvas?.getContext ? Array.from(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data) : null,
            image:canvas?.toDataURL?.(), flipY:material.map?.flipY, luminous:material.emissiveIntensity });
        }
      });
    });
    window.materials = results;
  });
  return null;
}
function Test() {
  const [uploaded, setUploaded] = useState(false);
  const formats = [
    { key:'glb', modelUrl:'/__signature-head.glb', materialUrl:'' },
    { key:'obj-mtl', modelUrl:'/__signature-head.obj', materialUrl:'/__signature-head.mtl' },
    { key:'obj', modelUrl:'/__signature-head.obj', materialUrl:'' },
  ];
  return <><button onClick={() => setUploaded(true)}>Visuel personnalisé</button><button onClick={() => setUploaded(false)}>Visuel standard</button>
    <div style={{width:1100,height:700}}><Canvas orthographic camera={{position:[0,1.4,8],zoom:130}}><ambientLight intensity={2}/><Probe/><Suspense fallback={null}>
      {formats.flatMap((format, i) => ['left','right'].map((side, j) => {
        const options = { partitionHeadSide:side, visualPending:!uploaded, headMainImageUrl:uploaded && side==='left' ? custom : '', headMainImageFraming:{imageZoom:.4} };
        return <group key={format.key+side} userData={{headTest:format.key+side}} position={[(i*2+j-2.5)*.65,0,0]}>
          <Model3D item={{id:format.key+side,type:'head-signature',label:'Tête de cloison Signature',...format,modelSize:[.46,2.7,.1],options}} visualContext={{company:'TEST',standNumber:'A1'}}/>
        </group>;
      }))}
    </Suspense></Canvas></div></>;
}
const image = new Image(); image.src='/images/signature/partition-head-standard-signa-32.png'; await image.decode();
const reference = document.createElement('canvas'); reference.width=image.width; reference.height=image.height;
reference.getContext('2d').fillStyle='white'; reference.getContext('2d').fillRect(0,0,image.width,image.height); reference.getContext('2d').drawImage(image,0,0);
window.standardReference = reference.toDataURL();
createRoot(document.getElementById('root')).render(<Test/>);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'signature-standard-visual',
  resolveId(id) { if (id === '/src/__signature-standard-app.jsx') return appId; if (id === '/src/__signature-standard-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { Model3D };');
    if (id === pageId) return harness;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__signature-standard__') {
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__signature-standard-page.jsx"></script>');
    } else if (req.url === '/__signature-head.glb') {
      res.setHeader('Content-Type', 'model/gltf+json'); res.end(gltf);
    } else if (req.url === '/__signature-head.obj') {
      res.setHeader('Content-Type', 'text/plain'); res.end(obj);
    } else if (req.url === '/__signature-head.mtl') {
      res.setHeader('Content-Type', 'text/plain'); res.end(names.map(name => 'newmtl '+name+'\nKd 0.2 0.3 0.7\n').join(''));
    } else next();
  }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1120, height: 750 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signature-standard__`);
  const standardReady = () => page.waitForFunction(() => {
    const panels = window.materials?.filter(material => material.name === 'LED_5500k#4');
    return panels?.length === 6 && panels.every(panel => panel.image === window.standardReference);
  });
  await standardReady();
  const panels = await page.evaluate(() => window.materials.filter(material => material.name === 'LED_5500k#4'));
  assert.ok(panels.every(panel => panel.width === 174 && panel.height === 805 && panel.luminous === .72));
  assert.deepEqual(panels.map(panel => panel.flipY).sort(), [false, false, true, true, true, true]);
  const neighbors = await page.evaluate(() => window.materials.filter(material => material.name === 'LED_5500k#40'));
  assert.ok(neighbors.every(material => !material.image), 'Neighboring materials never receive the standard image');
  await page.screenshot({ path: '/tmp/standing-signature-standard-visual.png' });
  await page.getByRole('button', { name: 'Visuel personnalisé', exact: true }).click();
  await page.waitForFunction(() => {
    const panels = window.materials?.filter(material => material.name === 'LED_5500k#4');
    return panels?.length === 6 && panels.every(panel => panel.id.endsWith('right') ? panel.image === window.standardReference : panel.width === 546 && panel.pixels?.[0] === 255 && panel.pixels?.[1] === 0);
  });
  await page.getByRole('button', { name: 'Visuel standard', exact: true }).click();
  await standardReady();
  assert.deepEqual(errors, []);
  console.log('Signature standard SIGNA-32: exact supplied image on both heads in GLB, OBJ/MTL and OBJ; uploaded visuals retain priority; reset restores the standard; neighboring materials unchanged.');
} finally { await browser?.close(); await server.close(); }
