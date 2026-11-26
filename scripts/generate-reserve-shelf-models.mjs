// Generates the two reserve models as separate GLB files (they are grouped in the catalogue, not merged):
//   public/models/etagere-reserve-frigo.glb  — metal shelving unit with a free bay underneath for a 240 L fridge
//   public/models/multiprise-6-prises.glb    — 6-socket power strip laid on the top shelf
// Usage: node scripts/generate-reserve-shelf-models.mjs
//
// Units: metres. Origin at floor level, centred in x/z (the app re-centres anyway). Front (open side) faces +z,
// like the catalogue "Bloc 3 Étagères" set against the back partition with rotation 0.
//
// Fridge bay — sized for a common single-door 240 L fridge: 54-60 cm wide, 55-60 cm deep, 143-146 cm high
// (e.g. Heinner HF-HM242 54.5 × 55.5 × 143 cm, Beko RDSA240 54 × 57.4 × 146.5 cm). Envelope kept: 60 × 60 × 146 cm,
// plus ventilation (≥ 2.5 cm behind, ~4 cm above) and 2 cm of play on each side:
//   free width between uprights  : 64 cm
//   free height under bottom shelf: 150 cm
//   usable depth                 : 65 cm (no rear crossbar under the bottom shelf, nothing at the front)
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter (binary) relies on the browser FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

export const SHELF = {
  width: 0.70, // outer width
  depth: 0.65,
  height: 2.00, // top face of the top shelf: where the power strip sits
  post: 0.03, // square tube uprights
  board: 0.025, // shelf thickness
  freeHeight: 1.50, // under the bottom shelf
};
export const STRIP = { length: 0.42, height: 0.045, depth: 0.065, sockets: 6 };

const material = (name, color, { metalness = 0.1, roughness = 0.6 } = {}) => new THREE.MeshStandardMaterial({ name, color, metalness, roughness });

function box(group, name, mat, [sx, sy, sz], [x, y, z], rotation = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function cylinder(group, name, mat, radius, length, [x, y, z], rotation = null, segments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

// Diagonal bar between two points of the same side plane.
function brace(group, name, mat, from, to, thickness = 0.012) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const length = start.distanceTo(end);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, length, thickness * 0.4), mat);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  group.add(mesh);
}

export function buildShelf() {
  const { width, depth, height, post, board, freeHeight } = SHELF;
  const group = new THREE.Group();
  group.name = 'Etagere reserve frigo';
  const steel = material('Acier galvanise', '#9aa1a6', { metalness: 0.65, roughness: 0.38 });
  const deck = material('Tablette', '#6f777d', { metalness: 0.3, roughness: 0.5 }); // darker than the strip so it reads in 3D
  const foot = material('Patin', '#2b2d2f', { roughness: 0.9 });
  const x = width / 2 - post / 2;
  const z = depth / 2 - post / 2;
  [[-x, -z], [x, -z], [-x, z], [x, z]].forEach(([px, pz], index) => {
    box(group, `Montant ${index + 1}`, steel, [post, height - 0.012, post], [px, 0.012 + (height - 0.012) / 2, pz]);
    box(group, `Patin ${index + 1}`, foot, [post, 0.012, post], [px, 0.006, pz]);
  });
  // Bottom and top shelves. The front and back rails rise 1.5 cm above the board (lip) and never hang below it,
  // so the free height under the bottom shelf is exactly freeHeight. Top shelf: board flush with the top.
  const shelves = [{ name: 'Tablette basse', bottom: freeHeight }, { name: 'Tablette haute', bottom: height - board }];
  shelves.forEach(({ name, bottom }) => {
    box(group, name, deck, [width - 0.004, board, depth - 0.004], [0, bottom + board / 2, 0]);
    const rail = name === 'Tablette haute' ? board : board + 0.015;
    box(group, `${name} lisse avant`, steel, [width, rail, 0.012], [0, bottom + rail / 2, depth / 2 - 0.006]);
    box(group, `${name} lisse arriere`, steel, [width, rail, 0.012], [0, bottom + rail / 2, -depth / 2 + 0.006]);
  });
  // Bracing only above the fridge bay (sides and back), so the bay stays fully free.
  const low = freeHeight + board;
  [-1, 1].forEach((side) => brace(group, `Croisillon cote ${side < 0 ? 'gauche' : 'droit'}`, steel, [side * (width / 2 - 0.006), low + 0.02, -z], [side * (width / 2 - 0.006), height - 0.04, z]));
  brace(group, 'Croisillon arriere', steel, [-x, low + 0.02, -depth / 2 + 0.005], [x, height - 0.04, -depth / 2 + 0.005]);
  // Side rails at floor level (outside the 64 cm bay) keep the frame square.
  [-1, 1].forEach((side) => box(group, `Lisse basse ${side < 0 ? 'gauche' : 'droite'}`, steel, [0.012, 0.03, depth - 2 * post], [side * x, 0.08, 0]));
  return group;
}

export function buildPowerStrip() {
  const { length, height, depth, sockets } = STRIP;
  const group = new THREE.Group();
  group.name = 'Multiprise 6 prises';
  const body = material('Boitier', '#f4f4f2', { roughness: 0.45 });
  const recess = material('Prise', '#d4d6d6', { roughness: 0.5 });
  const dark = material('Contact', '#3a3c3e', { metalness: 0.4, roughness: 0.5 });
  const red = material('Interrupteur', '#d6372b', { roughness: 0.35 });
  const cable = material('Cable', '#f0f0ee', { roughness: 0.6 });
  box(group, 'Boitier', body, [length, height, depth], [0, height / 2, 0]);
  const pitch = 0.058;
  const first = -length / 2 + 0.075;
  for (let index = 0; index < sockets; index += 1) {
    const cx = first + index * pitch;
    cylinder(group, `Prise ${index + 1}`, recess, 0.019, 0.004, [cx, height + 0.001, 0]);
    // Two pin holes and the French earth pin.
    cylinder(group, `Prise ${index + 1} trou gauche`, dark, 0.0025, 0.002, [cx - 0.0095, height + 0.0035, 0], null, 8);
    cylinder(group, `Prise ${index + 1} trou droit`, dark, 0.0025, 0.002, [cx + 0.0095, height + 0.0035, 0], null, 8);
    cylinder(group, `Prise ${index + 1} terre`, dark, 0.0022, 0.008, [cx, height + 0.006, -0.008], null, 8);
  }
  box(group, 'Interrupteur', red, [0.03, 0.012, 0.022], [-length / 2 + 0.028, height + 0.004, 0]);
  // Cable gland and a short stub at the end of the strip (the cable runs down the back upright on site).
  cylinder(group, 'Presse-etoupe', body, 0.008, 0.02, [length / 2 + 0.01, 0.02, 0], [0, 0, Math.PI / 2], 12);
  cylinder(group, 'Cable', cable, 0.0045, 0.03, [length / 2 + 0.035, 0.02, 0], [0, 0, Math.PI / 2], 10);
  return group;
}

async function exportGlb(object, path) {
  const scene = new THREE.Scene();
  scene.add(object);
  const data = await new GLTFExporter().parseAsync(scene, { binary: true });
  await writeFile(path, Buffer.from(data));
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  console.log(`${path}: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m, ${(data.byteLength / 1024).toFixed(1)} kB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../public/models/', import.meta.url);
  await mkdir(root, { recursive: true });
  await exportGlb(buildShelf(), new URL('etagere-reserve-frigo.glb', root).pathname);
  await exportGlb(buildPowerStrip(), new URL('multiprise-6-prises.glb', root).pathname);
}
