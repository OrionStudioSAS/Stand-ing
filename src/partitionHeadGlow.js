import { AdditiveBlending, Box3, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

// Équipé (SIAE) partition heads have a vertical LED strip between the wood cladding and the
// partition: it is lit, with a soft halo spilling around it.
function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function isBacklitPartitionHead(item = {}) {
  const text = normalize(`${item?.type || ''} ${item?.label || ''} ${item?.dimensions?.folderName || ''}`);
  if (!text.includes('tete de cloison') || text.includes('signature') || text.includes('smcl')) return false;
  const packs = Array.isArray(item?.dimensions?.packs) ? item.dimensions.packs.map(normalize) : [];
  return text.includes('siae') || packs.includes('equipe');
}

// The strip is an untextured LED material (the textured LED one is the sign's backlit picture).
function isStripMaterial(material) {
  const name = normalize(material?.name).replace(/\.\d+$/, '');
  return /^led_\d+k(?:_\d+)?$/.test(name) && !material?.map;
}

const STRIP_COLOR = '#fff3e2';
let glowTexture = null;

// Vertical light bar: bright core, soft sideways falloff, faded ends.
function getGlowTexture() {
  if (glowTexture || typeof document === 'undefined') return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const across = ctx.createLinearGradient(0, 0, canvas.width, 0);
  across.addColorStop(0, 'rgba(255, 226, 196, 0)');
  across.addColorStop(0.3, 'rgba(255, 230, 204, 0.28)');
  across.addColorStop(0.44, 'rgba(255, 242, 226, 0.75)');
  across.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
  across.addColorStop(0.56, 'rgba(255, 242, 226, 0.75)');
  across.addColorStop(0.7, 'rgba(255, 230, 204, 0.28)');
  across.addColorStop(1, 'rgba(255, 226, 196, 0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Fade both ends so the bar does not stop abruptly.
  ctx.globalCompositeOperation = 'destination-in';
  const along = ctx.createLinearGradient(0, 0, 0, canvas.height);
  along.addColorStop(0, 'rgba(0, 0, 0, 0)');
  along.addColorStop(0.06, 'rgba(0, 0, 0, 1)');
  along.addColorStop(0.94, 'rgba(0, 0, 0, 1)');
  along.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  glowTexture = new CanvasTexture(canvas);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}

// Adds the lit strip and its halo to a prepared (already centred) model, in the model root's
// local space, so it never changes the model's size or anchor.
export function addPartitionHeadGlow(root, item) {
  if (!root || !isBacklitPartitionHead(item) || typeof document === 'undefined') return;
  const texture = getGlowTexture();
  if (!texture) return;
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const box = new Box3();
  const meshBox = new Box3();
  root.traverse((child) => {
    if (!child.isMesh || child.userData.partitionHeadGlow) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (!materials.some(isStripMaterial)) return;
    // The strip itself shines.
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => (isStripMaterial(material) ? stripMaterial(material) : material))
      : stripMaterial(child.material);
    child.geometry.computeBoundingBox();
    meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld).applyMatrix4(toRoot);
    box.union(meshBox);
  });
  if (box.isEmpty()) return;
  const size = box.getSize(meshBox.min.clone());
  const center = box.getCenter(meshBox.max.clone());
  const axes = [size.x, size.y, size.z];
  // Long axis = the strip's length; the two others are its width and depth.
  const long = axes.indexOf(Math.max(...axes));
  const length = axes[long];
  const thickness = Math.max(...axes.filter((_, axis) => axis !== long));
  const spread = Math.max(thickness * 2.5, length * 0.06);
  const material = new MeshBasicMaterial({
    map: texture,
    color: '#ffe6c4',
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const halo = new Group();
  halo.name = 'partition-head-glow';
  halo.userData.partitionHeadGlow = true;
  // Two crossed planes along the strip, so the halo reads from the aisle and from the side.
  [0, Math.PI / 2].forEach((turn) => {
    const plane = new Mesh(new PlaneGeometry(spread * 2, length * 1.04), material);
    plane.userData.partitionHeadGlow = true;
    plane.renderOrder = 8;
    plane.raycast = () => {};
    plane.rotation.y = turn;
    halo.add(plane);
  });
  // Planes are built along Y: turn the group when the strip runs along another axis.
  if (long === 0) halo.rotation.z = Math.PI / 2;
  if (long === 2) halo.rotation.x = Math.PI / 2;
  halo.position.copy(center);
  root.add(halo);
}

function stripMaterial(material) {
  const lit = new MeshBasicMaterial({ color: STRIP_COLOR, toneMapped: false, side: material?.side ?? DoubleSide });
  lit.name = material?.name || 'led-strip';
  return lit;
}
