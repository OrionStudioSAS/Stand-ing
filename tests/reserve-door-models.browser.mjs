import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Reserve door: each opening (inwards / outwards) and handle (left / right) shows the catalogue door of the
// right hand, its leaf ajar to the chosen side and its handle on the chosen side seen from the aisle; the door
// module sits in the partition line (flush corner on a side wall, same plane as the partitions on the façade).
const root = new URL('../', import.meta.url).pathname;
const source = await readFile(`${root}src/App.jsx`, 'utf8');
const packs = ['Signature'];

// Door models shaped like the catalogue GLBs (metres, model frame): a 1 m partition module (panel), a leaf left
// ajar on one side of it and a handle near the latch edge. "Gauche" and "Droite" are the two hands of door.
const box = ([x0, y0, z0], [x1, y1, z1]) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]].flatMap((face) => face.flatMap((i) => v[i]));
};
const doorGltf = ({ handle, swing }) => {
  const leaf = swing < 0 ? box([0.135, 0, -0.19], [0.865, 2, -0.004]) : box([0.135, 0, -0.066], [0.865, 2, 0.124]);
  const knob = box([handle > 0 ? 0.66 : 0.16, 0.966, swing < 0 ? -0.249 : -0.035], [handle > 0 ? 0.84 : 0.34, 1.021, swing < 0 ? -0.031 : 0.183]);
  const parts = [['panel', box([0, 0, -0.063], [1, 2.5, -0.003])], ['leaf', leaf], ['handle', knob]];
  const buffers = parts.map(([, points]) => Buffer.from(new Float32Array(points).buffer));
  const offsets = buffers.reduce((list, buffer, index) => [...list, index ? list[index - 1] + buffers[index - 1].length : 0], []);
  const bytes = Buffer.concat(buffers);
  const bounds = (points) => [0, 1, 2].map((axis) => points.filter((_, i) => i % 3 === axis));
  return JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: parts.map((_, i) => i) }],
    nodes: parts.map(([name], mesh) => ({ name, mesh })),
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: buffers.map((buffer, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: buffer.length })),
    accessors: parts.map(([, points], i) => ({ bufferView: i, componentType: 5126, count: points.length / 3, type: 'VEC3',
      min: bounds(points).map((values) => Math.min(...values)), max: bounds(points).map((values) => Math.max(...values)) })),
    meshes: parts.map((_, i) => ({ primitives: [{ attributes: { POSITION: i } }] })),
  });
};
const models = {
  // Same geometry as "Porte Trad Gauche … Poignée Gauche" and "Porte Trad Droite … Poignée Droite".
  '/__door-gauche.glb': doorGltf({ handle: 1, swing: -1 }),
  '/__door-droite.glb': doorGltf({ handle: -1, swing: -1 }),
};
const wall = { type: 'wall-fixture', label: 'Cloison Trad 1000x2500mm Ht', is_active: true, model_url: '/__wall.obj', dimensions: { size: [1, 2.5, 0.06], packs: [] } };
const doorGauche = { type: 'door-gauche-fixture', label: 'Porte Trad Gauche 1000x2500mm Ht + Poignée Gauche', is_active: true, model_url: '/__door-gauche.glb', dimensions: { size: [1, 2.5, 0.25], packs: [] } };
const doorDroite = { type: 'door-droite-fixture', label: 'Porte Trad Droite 1000x2500mm Ht + Poignée Droite', is_active: true, model_url: '/__door-droite.glb', dimensions: { size: [1, 2.5, 0.24], packs: [] } };
// Hook supplied with the reserve, fixed on the façade partition where the door can be moved.
const hook = { type: 'hook-fixture', label: 'Patère', is_active: true, model_url: '/__hook.obj', dimensions: { size: [0.46, 0.06, 0.07], packs: [], mountType: 'wall' } };
const child = (id, asset, x, z, rotation) => ({ id, type: asset.type, label: asset.label, modelUrl: asset.model_url, modelSize: asset.dimensions.size, dimensions: asset.dimensions, x, z, rotation });
// Same layout as the catalogue "Réserve 2m² arrière gauche": two façade partitions, the door on the right side.
const reserve = { type: 'reserve-door-fixture', label: 'Réserve 2m² arrière gauche', is_active: true, dimensions: { isGroup: true, isReserve: true, children: [child('wall1', wall, 0, 0, 0), child('wall2', wall, -1, 0, 0), child('door', doorGauche, 0.56, -0.528, -90), child('hook', hook, -0.473, -0.073, 180)], groupSize: [2, 2.5, 1], packs, placementRule: { id: 'back-left', locked: true } } };
const assets = [wall, doorGauche, doorDroite, hook, reserve];
const rules = { 'signature-2m2': { includedType: reserve.type, includedLabel: 'Réserve', options: [] }, large: { includedType: reserve.type, includedLabel: 'Réserve', options: [] } };
const scene = { id: 'reserve-door-models', client_name: 'Test porte', offer: 'Signature', event_name: 'Test', dimensions: { width: 5, depth: 5 }, layout: 'u', items: [], options: {}, source_payload: { reserveRules: rules } };
const objBox = (width, height, depth) => {
  const x = width / 2, z = depth / 2;
  return `o Fixture\nv ${-x} 0 ${-z}\nv ${x} 0 ${-z}\nv ${x} ${height} ${-z}\nv ${-x} ${height} ${-z}\nv ${-x} 0 ${z}\nv ${x} 0 ${z}\nv ${x} ${height} ${z}\nv ${-x} ${height} ${z}\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\n`;
};
const harness = `import React from 'react';import{createRoot}from'react-dom/client';import{ConfiguratorApp}from'/src/__reserve-door-models-app.jsx';
localStorage.setItem('standing-config-intro:reserve-door-models','started');localStorage.setItem('standing-config-tutorial:reserve-door-models','done');
createRoot(document.getElementById('root')).render(<ConfiguratorApp initialScene={${JSON.stringify(scene)}} isAdminViewer={false} />);`;
const appId = `${root}src/__reserve-door-models-app.jsx`;
const pageId = `${root}src/__reserve-door-models-page.jsx`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'reserve-door-models-test',
  resolveId(id) { if (id === '/src/__reserve-door-models-app.jsx') return appId; if (id === '/src/__reserve-door-models-page.jsx') return pageId; },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export {ConfiguratorApp};')
      .replace('  pivot.userData.reserveDoorFit =', '  (window.doorPivots ||= []).push(pivot);\n  pivot.userData.reserveDoorFit =')
      .replace('  const estimatedTotal = scenePricing.total;', '  window.doorItems=visibleSceneItems;\n  const estimatedTotal = scenePricing.total;');
    if (id === pageId) return harness;
    if (id === `${root}src/data/sceneStore.js`) return `export * from '/src/data/sceneStore.js?original-reserve-door-models';export async function listObjectBank(){return ${JSON.stringify(assets)}};export async function saveScene(scene){window.savedScene=JSON.parse(JSON.stringify(scene));return scene;}`;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/__wall.obj') { res.setHeader('Content-Type', 'text/plain'); return res.end(objBox(1, 2.5, 0.06)); }
    if (req.url === '/__hook.obj') { res.setHeader('Content-Type', 'text/plain'); return res.end(objBox(0.46, 0.06, 0.07)); }
    if (models[req.url]) { res.setHeader('Content-Type', 'model/gltf+json'); return res.end(models[req.url]); }
    if (req.url !== '/__reserve-door-models-test__') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/src/__reserve-door-models-page.jsx"></script>');
  }); },
}] });

// World boxes of the door shown in the editor's 3D view, and of the partitions around it.
const measure = (page) => page.evaluate(() => {
  const canvas = document.querySelector('.rsv-modal canvas');
  const inScene = (object) => { let top = object; while (top.parent) top = top.parent; return top.type === 'Scene' ? top : null; };
  const pivots = (window.doorPivots || []).filter(inScene);
  const pivot = pivots[pivots.length - 1];
  if (!canvas || !pivot) return null;
  const sceneRoot = inScene(pivot);
  const worldBox = (object) => {
    const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    object.updateWorldMatrix(true, true);
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      ['x', 'y', 'z'].forEach((k, i) => { out.min[i] = Math.min(out.min[i], b.min[k]); out.max[i] = Math.max(out.max[i], b.max[k]); });
    });
    return out;
  };
  const part = (name) => { let found = null; pivot.traverse((o) => { if (!found && o.name === name) found = o; }); return found ? worldBox(found) : null; };
  const insideDoor = (object) => { for (let o = object; o; o = o.parent) if (o === pivot) return true; return false; };
  const walls = [];
  sceneRoot.traverse((mesh) => {
    if (!mesh.isMesh || insideDoor(mesh) || !mesh.visible || mesh.material?.visible === false || mesh.material?.opacity === 0 || mesh.material?.colorWrite === false) return;
    const b = worldBox(mesh);
    const height = b.max[1] - b.min[1];
    const sizes = [b.max[0] - b.min[0], b.max[2] - b.min[2]].sort((a, c) => a - c);
    if (height > 2.4 && height < 2.6 && Math.abs(sizes[0] - 0.06) < 0.01 && Math.abs(sizes[1] - 1) < 0.02) walls.push(b);
  });
  return { fit: pivot.userData.reserveDoorFit, panel: part('panel'), leaf: part('leaf'), handle: part('handle'), walls };
});
const centre = (b, axis) => (b.min[axis] + b.max[axis]) / 2;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.003, `${message}: ${actual.toFixed(4)} ≠ ${expected.toFixed(4)}`);

let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__reserve-door-models-test__`);
  await page.waitForFunction(() => window.doorItems?.some((item) => item.autoReserve));
  await page.getByRole('button', { name: /^Réserve/ }).first().click();
  await page.getByRole('button', { name: /Personnaliser la réserve/ }).click();
  const editor = page.locator('.rsv-modal');
  await editor.waitFor();
  await page.getByRole('button', { name: /Suivant : la porte/ }).click();
  await editor.getByRole('tab', { name: /3D/ }).click();

  const choose = async (opening, handle) => {
    await editor.locator('.rsv-choice-card').filter({ hasText: opening === 'push' ? 'Vers l’intérieur' : 'Vers l’extérieur' }).click();
    await editor.getByRole('button', { name: new RegExp(`^À ${handle === 'left' ? 'gauche' : 'droite'} Charnières`) }).click();
    await page.waitForFunction(({ opening, handle }) => {
      const pivots = (window.doorPivots || []).filter((p) => { let o = p; while (o.parent) o = o.parent; return o.type === 'Scene'; });
      const fit = pivots[pivots.length - 1]?.userData.reserveDoorFit;
      return fit && fit.opening === opening && fit.handle === handle;
    }, { opening, handle });
    return measure(page);
  };
  // Leaf and handle seen from the aisle side of the door wall.
  const checkDoor = (shot, opening, handle, label) => {
    const thin = (shot.panel.max[0] - shot.panel.min[0]) < (shot.panel.max[2] - shot.panel.min[2]) ? 0 : 2;
    const along = thin === 0 ? 2 : 0;
    const wallsCentre = shot.walls.reduce((sum, b) => sum + centre(b, thin), 0) / shot.walls.length;
    const inward = Math.sign(wallsCentre - centre(shot.panel, thin));
    const leafSide = Math.sign(centre(shot.leaf, thin) - centre(shot.panel, thin));
    assert.equal(leafSide, opening === 'push' ? inward : -inward, `${label}: the leaf opens ${opening === 'push' ? 'inwards' : 'outwards'}`);
    const inwardVector = thin === 0 ? { x: inward, z: 0 } : { x: 0, z: inward };
    const right = { x: -inwardVector.z, z: inwardVector.x };
    const offset = centre(shot.handle, along) - centre(shot.panel, along);
    const handleSide = Math.sign(offset * (along === 0 ? right.x : right.z));
    assert.equal(handleSide, handle === 'right' ? 1 : -1, `${label}: handle on the ${handle} seen from the aisle`);
    assert.equal(shot.fit.mirrored, false, `${label}: a catalogue door of the right hand is used, not a mirror image`);
    return { thin, along, inward };
  };

  // Door on the side wall: the four choices, the module never moves and closes the corner with the façade.
  let reference = null;
  for (const [opening, handle] of [['push', 'left'], ['push', 'right'], ['pull', 'left'], ['pull', 'right']]) {
    const shot = await choose(opening, handle);
    assert.ok(shot?.panel && shot.leaf && shot.handle, `${opening}/${handle}: door parts measured`);
    assert.equal(shot.walls.length, 2, 'The two façade partitions are measured');
    const { thin, inward } = checkDoor(shot, opening, handle, `side ${opening}/${handle}`);
    reference ||= shot.panel;
    close(shot.panel.min[thin], reference.min[thin], 'The door module stays in place whatever the choice');
    close(shot.panel.min[2 - thin], reference.min[2 - thin], 'The door module stays in place along the wall');
    // Façade partitions run along the other axis and stop where the door panel's outer face is.
    const outerFace = inward > 0 ? shot.panel.min[thin] : shot.panel.max[thin];
    const wallEnd = inward > 0 ? Math.min(...shot.walls.map((b) => b.min[thin])) : Math.max(...shot.walls.map((b) => b.max[thin]));
    close(outerFace, wallEnd, 'The door panel is flush with the end of the façade partitions');
  }
  const types = await page.evaluate(() => window.doorItems.find((item) => item.autoReserve).children.find((c) => /porte/i.test(c.label)).type);
  assert.equal(types, 'door-droite-fixture', 'Outwards with the handle on the right uses the "droite" hand');

  // Door moved to the façade: same plane as the partition next to it, the partition moved to the side closes the corner.
  await editor.getByRole('button', { name: /Façade/ }).first().click();
  // The hook hung on that partition: it moves to a free wall and the exhibitor is told.
  await editor.getByText('Porte posée sur ce mur : Patère passe sur une autre cloison').waitFor();
  for (const [opening, handle] of [['pull', 'right'], ['push', 'left']]) {
    const shot = await choose(opening, handle);
    const { thin, along } = checkDoor(shot, opening, handle, `façade ${opening}/${handle}`);
    const facade = shot.walls.filter((b) => (b.max[thin] - b.min[thin]) < 0.1);
    assert.equal(facade.length, 1, 'One façade partition next to the door');
    close(shot.panel.min[thin], facade[0].min[thin], 'Door panel and façade partition share the same plane (inner face)');
    close(shot.panel.max[thin], facade[0].max[thin], 'Door panel and façade partition share the same plane (outer face)');
    const gap = Math.min(Math.abs(shot.panel.min[along] - facade[0].max[along]), Math.abs(facade[0].min[along] - shot.panel.max[along]));
    close(gap, 0, 'No gap between the door and the partition');
    const side = shot.walls.find((b) => b !== facade[0]);
    const facadeEnd = Math.max(shot.panel.max[along], facade[0].max[along]);
    const sideOuter = Math.abs(side.max[along] - facadeEnd) < Math.abs(side.min[along] - facadeEnd) ? side.max[along] : side.min[along];
    close(sideOuter, facadeEnd, 'The partition now on the side wall closes the corner');
  }

  await page.getByRole('button', { name: /Suivant : l’aménagement/ }).click();
  await page.getByRole('button', { name: /Valider la réserve/ }).click();
  await editor.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.savedScene?.options?.reserveOptions?.handleOrientation);
  const saved = await page.evaluate(() => window.savedScene.options.reserveOptions);
  assert.equal(saved.doorOpening, 'push');
  assert.equal(saved.handleOrientation, 'left');
  const shown = await page.evaluate(() => window.doorItems.find((item) => item.autoReserve).children.find((c) => /porte/i.test(c.label)));
  assert.equal(shown.type, 'door-droite-fixture', 'Inwards with the handle on the left uses the "droite" hand in the stand view too');
  const hung = await page.evaluate(async () => {
    const geometry = await import('/src/reserveConfigurator.js');
    const reserveItem = window.doorItems.find((item) => item.autoReserve);
    const children = reserveItem.children;
    const hookChild = children.find((c) => c.label === 'Patère');
    const door = geometry.reserveDoorState(children, { doorOpening: reserveItem.options.reserveDoorOpening, handleOrientation: reserveItem.options.reserveHandleOrientation });
    const interior = geometry.reserveInterior(children);
    const content = geometry.builtinWallContent(hookChild, interior);
    return { x: hookChild.x, z: hookChild.z, issues: geometry.reserveContentIssues(content, { interior, door, builtins: children.filter((c) => !geometry.isReserveDoorChild(c) && !/cloison/i.test(c.label) && c !== hookChild), contents: [] }), side: door.side };
  });
  assert.equal(hung.side, 'front');
  assert.notDeepEqual([hung.x, hung.z], [-0.473, -0.073], 'The hook left the partition now taken by the door');
  assert.deepEqual(hung.issues, [], 'The hook hangs on a free wall, not on the door');
  assert.deepEqual(errors, []);
  console.log('Reserve door models: right hand per opening and handle, leaf and handle sides, flush on the side wall and on the façade OK');
} finally {
  await browser?.close();
  await server.close();
}
