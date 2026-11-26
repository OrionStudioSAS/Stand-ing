// Pure geometry and catalogue helpers for the reserve configurator.
// Coordinates are expressed in the reserve group's local frame (metres):
// x to the right, z towards the aisle, rotations follow three.js (degrees around Y).

export const RESERVE_WALL = 0.06;
// Catalogue reserves store a door module 9 cm outside the centre of its partition panel: set there, the panel
// fills the opening between the perpendicular partitions, its outer face flush with their ends (measured on
// every catalogue reserve). The 3D view anchors the door model on that panel (see reserveDoorFit).
export const RESERVE_DOOR_OFFSET = 0.09;
export const RESERVE_DOOR_LEAF = 0.8;
// Depth of the band in front of the door opening where no wall-mounted object (hook, shelf…) can be fixed.
const RESERVE_DOOR_WALL_DEPTH = 0.05;
export const RESERVE_GRID = 0.05;
const EPSILON = 1e-6;

export function normalizeReserveText(value = '') {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ');
}

function childText(child = {}) {
  return normalizeReserveText(`${child.type || ''} ${child.label || ''}`);
}

export function isReserveDoorChild(child = {}) {
  const text = childText(child);
  return /\bporte\b/.test(text) && !/document|revue|manteau/.test(text);
}

export function isReserveWallChild(child = {}) {
  const text = childText(child);
  return /cloison/.test(text) && !/tete/.test(text);
}

export function isReserveStructuralChild(child = {}) {
  return isReserveDoorChild(child) || isReserveWallChild(child);
}

export function reserveChildSize(child = {}) {
  const size = child.modelSize || child.dimensions?.size || child.dimensions?.modelSize || [];
  return [Number(size[0]) || 0.5, Number(size[1]) || 0.5, Number(size[2]) || 0.5];
}

const radians = (degrees = 0) => (Number(degrees || 0) * Math.PI) / 180;

export function normalizeDegrees(value = 0) {
  const degrees = Math.round(Number(value || 0)) % 360;
  return degrees > 180 ? degrees - 360 : degrees <= -180 ? degrees + 360 : degrees;
}

// Same convention as three.js and the electrical clearance helper.
export function rotateReservePoint(x = 0, z = 0, degrees = 0) {
  const angle = radians(degrees);
  return {
    x: x * Math.cos(angle) + z * Math.sin(angle),
    z: -x * Math.sin(angle) + z * Math.cos(angle),
  };
}

export function footprintBounds(size = [0.5, 0.5, 0.5], x = 0, z = 0, rotation = 0) {
  const [width, , depth] = size;
  const corners = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
    .map(([px, pz]) => rotateReservePoint(px, pz, rotation));
  return {
    minX: x + Math.min(...corners.map((point) => point.x)),
    maxX: x + Math.max(...corners.map((point) => point.x)),
    minZ: z + Math.min(...corners.map((point) => point.z)),
    maxZ: z + Math.max(...corners.map((point) => point.z)),
  };
}

// Real outline of a (possibly rotated) rectangle: its four corners, in order.
export function footprintPolygon(size = [0.5, 0.5, 0.5], x = 0, z = 0, rotation = 0) {
  const [width, , depth] = size;
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
    .map(([px, pz]) => rotateReservePoint(px, pz, rotation))
    .map((point) => ({ x: x + point.x, z: z + point.z }));
}

export function boundsPolygon(bounds) {
  return [{ x: bounds.minX, z: bounds.minZ }, { x: bounds.maxX, z: bounds.minZ }, { x: bounds.maxX, z: bounds.maxZ }, { x: bounds.minX, z: bounds.maxZ }];
}

// Separating axis test between two convex outlines; touching edges (within the tolerance) do not count.
export function polygonsOverlap(a = [], b = [], tolerance = 0.005) {
  const axes = [a, b].flatMap((polygon) => polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(next.x - point.x, next.z - point.z) || 1;
    return { x: -(next.z - point.z) / length, z: (next.x - point.x) / length };
  }));
  return axes.every((axis) => {
    const project = (polygon) => polygon.map((point) => point.x * axis.x + point.z * axis.z);
    const pa = project(a);
    const pb = project(b);
    return Math.min(...pa) < Math.max(...pb) - tolerance && Math.min(...pb) < Math.max(...pa) - tolerance;
  });
}

export function childFootprint(child = {}) {
  return footprintBounds(reserveChildSize(child), Number(child.x || 0), Number(child.z || 0), Number(child.rotation || 0));
}

export function boundsOverlap(a, b, tolerance = 0.005) {
  return a.minX < b.maxX - tolerance && a.maxX > b.minX + tolerance
    && a.minZ < b.maxZ - tolerance && a.maxZ > b.minZ + tolerance;
}

export function boundsInside(inner, outer, tolerance = 0.005) {
  return inner.minX >= outer.minX - tolerance && inner.maxX <= outer.maxX + tolerance
    && inner.minZ >= outer.minZ - tolerance && inner.maxZ <= outer.maxZ + tolerance;
}

export function reserveSegments(children = []) {
  return (children || []).filter(isReserveStructuralChild).map((child) => {
    const [length] = reserveChildSize(child);
    const alongX = Math.abs(Math.sin(radians(child.rotation))) < 0.5;
    const center = Number(alongX ? child.x : child.z) || 0;
    return {
      id: child.id,
      kind: isReserveDoorChild(child) ? 'door' : 'wall',
      child,
      orientation: alongX ? 'x' : 'z',
      line: Number(alongX ? child.z : child.x) || 0,
      center,
      length,
      min: center - length / 2,
      max: center + length / 2,
    };
  });
}

// Inner face of a partition or door module, measured from its own line (a door panel sits RESERVE_DOOR_OFFSET inside it).
function segmentInset(segment) {
  return segment.kind === 'door' ? RESERVE_DOOR_OFFSET + RESERVE_WALL / 2 : RESERVE_WALL / 2;
}

// Interior rectangle: reserve walls give an inset, sides without a reserve wall are stand walls.
export function reserveInterior(children = []) {
  const segments = reserveSegments(children);
  if (!segments.length) {
    const boxes = (children || []).map(childFootprint);
    if (!boxes.length) return null;
    const minX = Math.min(...boxes.map((box) => box.minX));
    const maxX = Math.max(...boxes.map((box) => box.maxX));
    const minZ = Math.min(...boxes.map((box) => box.minZ));
    const maxZ = Math.max(...boxes.map((box) => box.maxZ));
    return withSize({ minX, maxX, minZ, maxZ, sides: { left: false, right: false, back: false, front: false } });
  }
  const xs = [];
  const zs = [];
  segments.forEach((segment) => {
    if (segment.orientation === 'x') { xs.push(segment.min, segment.max); zs.push(segment.line); }
    else { zs.push(segment.min, segment.max); xs.push(segment.line); }
  });
  const outer = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const on = (orientation, value) => segments.filter((segment) => segment.orientation === orientation && Math.abs(segment.line - value) < 0.12);
  const left = on('z', outer.minX);
  const right = on('z', outer.maxX);
  const back = on('x', outer.minZ);
  const front = on('x', outer.maxZ);
  // Each side stops at the innermost face of its modules (a filler module may sit inside the outer bounds).
  const lowSide = (list, fallback) => (list.length ? Math.max(...list.map((segment) => segment.line + segmentInset(segment))) : fallback);
  const highSide = (list, fallback) => (list.length ? Math.min(...list.map((segment) => segment.line - segmentInset(segment))) : fallback);
  return withSize({
    minX: lowSide(left, outer.minX),
    maxX: highSide(right, outer.maxX),
    minZ: lowSide(back, outer.minZ),
    maxZ: highSide(front, outer.maxZ),
    outer,
    sides: { left: left.length > 0, right: right.length > 0, back: back.length > 0, front: front.length > 0 },
  });
}

function withSize(rect) {
  return {
    ...rect,
    width: Math.max(0, rect.maxX - rect.minX),
    depth: Math.max(0, rect.maxZ - rect.minZ),
    centerX: (rect.minX + rect.maxX) / 2,
    centerZ: (rect.minZ + rect.maxZ) / 2,
  };
}

function segmentSide(segment, interior) {
  if (segment.orientation === 'z') return segment.line < interior.centerX ? 'left' : 'right';
  return segment.line < interior.centerZ ? 'back' : 'front';
}

const outwardNormals = { left: { x: -1, z: 0 }, right: { x: 1, z: 0 }, back: { x: 0, z: -1 }, front: { x: 0, z: 1 } };

// Rotation that turns a model's local +z towards the given normal.
export function rotationForNormal(normal = { x: 0, z: 1 }) {
  return normalizeDegrees((Math.atan2(normal.x, normal.z) * 180) / Math.PI);
}

export function reserveDoorSlots(children = []) {
  const interior = reserveInterior(children);
  if (!interior) return [];
  return reserveSegments(children)
    .filter((segment) => segment.kind === 'door' || Math.abs(segment.length - 1) <= 0.12)
    .map((segment) => {
      const side = segmentSide(segment, interior);
      return { ...segment, side, normal: outwardNormals[side] };
    })
    .sort((a, b) => sideOrder(a.side) - sideOrder(b.side) || viewerAxis(a) - viewerAxis(b));
}

function sideOrder(side) {
  return ['front', 'left', 'right', 'back'].indexOf(side);
}

// Position along a wall as seen from outside the reserve (left to right).
function viewerAxis(slot) {
  if (slot.side === 'front') return slot.center;
  if (slot.side === 'back') return -slot.center;
  if (slot.side === 'left') return slot.center;
  return -slot.center;
}

export function reserveDoorSlotsBySide(children = []) {
  return reserveDoorSlots(children).reduce((acc, slot) => {
    acc[slot.side] = [...(acc[slot.side] || []), slot];
    return acc;
  }, {});
}

export function reserveDoorChild(children = []) {
  return (children || []).find(isReserveDoorChild) || null;
}

export function moveReserveDoor(children = [], targetSlotId = '') {
  const slots = reserveDoorSlots(children);
  const doorSlot = slots.find((slot) => slot.kind === 'door');
  const target = slots.find((slot) => slot.id === targetSlotId);
  if (!doorSlot || !target || target.kind === 'door') return children;
  const door = doorSlot.child;
  const wall = target.child;
  const relative = normalizeDegrees(Number(door.rotation || 0) - rotationForNormal(doorSlot.normal));
  const doorPosition = slotPoint(target, RESERVE_DOOR_OFFSET);
  const wallPosition = slotPoint(doorSlot, 0);
  const wallRotation = doorSlot.orientation === target.orientation
    ? Number(wall.rotation || 0)
    : doorSlot.orientation === 'x' ? 0 : 90;
  return children.map((child) => {
    if (child.id === door.id) return { ...child, x: round(doorPosition.x), z: round(doorPosition.z), rotation: normalizeDegrees(rotationForNormal(target.normal) + relative) };
    if (child.id === wall.id) return { ...child, x: round(wallPosition.x), z: round(wallPosition.z), rotation: wallRotation };
    return child;
  });
}

function slotNormalComponent(slot) {
  return slot.orientation === 'z' ? slot.normal.x : slot.normal.z;
}

// Wall axis of a slot: door modules are authored RESERVE_DOOR_OFFSET outside the partition axis.
function slotAxis(slot) {
  return slot.kind === 'door' ? slot.line - slotNormalComponent(slot) * RESERVE_DOOR_OFFSET : slot.line;
}

function slotPoint(slot, outwardOffset = 0) {
  const line = slotAxis(slot) + slotNormalComponent(slot) * outwardOffset;
  return slot.orientation === 'x' ? { x: slot.center, z: line } : { x: line, z: slot.center };
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

export function doorHandleFromLabel(child = {}) {
  const text = childText(child);
  if (/poignee\s*(?:e\s*)?(?:g\b|gauche)/.test(text)) return 'left';
  if (/poignee\s*(?:e\s*)?(?:d\b|droite)/.test(text)) return 'right';
  return 'right';
}

export function doorFamilyFromLabel(child = {}) {
  const text = childText(child).replace(/poignee.*$/, '');
  if (/\bgauche\b/.test(text)) return 'left';
  if (/\bdroite\b/.test(text)) return 'right';
  return '';
}

// Door range from its visible name (asset types of plain doors may still contain "trad").
function isTradDoor(entry = {}) {
  return /\btrad\b/.test(normalizeReserveText(entry.label || entry.type || ''));
}

// Swap the door model for the catalogue variant with the requested handle, keeping its family and width.
export function findDoorHandleVariant(door = {}, handle = 'right', catalogEntries = []) {
  if (!door || doorHandleFromLabel(door) === handle) return null;
  const family = doorFamilyFromLabel(door);
  const width = reserveChildSize(door)[0];
  const isTrad = isTradDoor(door);
  return (catalogEntries || []).find((entry) => (
    entry && !entry.isGroup && isReserveDoorChild(entry)
    && doorFamilyFromLabel(entry) === family
    && doorHandleFromLabel(entry) === handle
    && isTradDoor(entry) === isTrad
    && Math.abs(reserveChildSize(entry)[0] - width) < 0.05
    && /poignee/.test(childText(entry))
  )) || null;
}

// Door models come in two hands, named after the side of the handle seen from the side the leaf opens
// towards: "Porte droite" (handle right when it opens outwards, left when it opens inwards) and
// "Porte gauche" (the opposite). Their "poignée …" suffix only tells how the file was authored and is
// not reliable, so the 3D view orients the leaf from the model geometry (see reserveDoorFit).
export function doorFamilyForChoice(handle = 'right', opening = 'push') {
  return (handle === 'right') === (opening === 'pull') ? 'right' : 'left';
}

// Handle side of a door as authored (all catalogue doors open outwards): its family.
export function doorDefaultHandle(child = {}) {
  if (child.doorHandle === 'left' || child.doorHandle === 'right') return child.doorHandle;
  return doorFamilyFromLabel(child) || doorHandleFromLabel(child);
}

// Catalogue door of the hand needed for the chosen handle and opening, same range and width.
export function findDoorChoiceVariant(door = {}, { handle = 'right', opening = 'push' } = {}, catalogEntries = []) {
  if (!door) return null;
  const family = doorFamilyForChoice(handle, opening);
  const current = doorFamilyFromLabel(door);
  if (!current || current === family) return null;
  const width = reserveChildSize(door)[0];
  const isTrad = isTradDoor(door);
  const series = /\bht\b/.test(childText(door));
  const candidates = (catalogEntries || []).filter((entry) => (
    entry && !entry.isGroup && isReserveDoorChild(entry)
    && doorFamilyFromLabel(entry) === family
    && isTradDoor(entry) === isTrad
    && Math.abs(reserveChildSize(entry)[0] - width) < 0.05
  ));
  return candidates.find((entry) => /\bht\b/.test(childText(entry)) === series) || candidates[0] || null;
}

// What the 3D view needs to show the door as chosen, in the door model's own frame:
// - outward: +1 when the model's local +z points to the aisle side of the door wall, -1 otherwise;
// - handle / swing: wanted sign of the handle along local x and of the ajar leaf along local z;
// - wallZ: local z of the partition axis (door modules are stored RESERVE_DOOR_OFFSET outside it).
export function reserveDoorFit(children = [], options = {}) {
  const state = reserveDoorState(children, options);
  if (!state) return null;
  const rotation = radians(state.slot.child.rotation);
  const localZ = { x: Math.sin(rotation), z: Math.cos(rotation) };
  const outward = localZ.x * state.slot.normal.x + localZ.z * state.slot.normal.z >= 0 ? 1 : -1;
  return {
    childId: state.slot.child.id,
    handle: state.handle,
    opening: state.opening,
    outward,
    handleSign: (state.handle === 'right' ? 1 : -1) * outward,
    swingSign: (state.opening === 'pull' ? 1 : -1) * outward,
    wallZ: round(-RESERVE_DOOR_OFFSET * outward),
  };
}

// Model of the same door seen in a mirror: hinge and handle both change side.
export function findMirroredDoorVariant(door = {}, catalogEntries = []) {
  if (!door) return null;
  const family = doorFamilyFromLabel(door);
  if (!family) return null;
  const mirroredFamily = family === 'left' ? 'right' : 'left';
  const mirroredHandle = doorHandleFromLabel(door) === 'left' ? 'right' : 'left';
  const width = reserveChildSize(door)[0];
  const isTrad = isTradDoor(door);
  return (catalogEntries || []).find((entry) => (
    entry && !entry.isGroup && isReserveDoorChild(entry)
    && doorFamilyFromLabel(entry) === mirroredFamily
    && doorHandleFromLabel(entry) === mirroredHandle
    && isTradDoor(entry) === isTrad
    && Math.abs(reserveChildSize(entry)[0] - width) < 0.05
    && /poignee/.test(childText(entry))
  )) || null;
}

// 'horizontal' when the reserve runs along the back wall, 'vertical' along a side wall, 'square' when both are equal.
export function reserveOrientation(children = []) {
  const interior = reserveInterior(children);
  if (!interior) return '';
  if (Math.abs(interior.width - interior.depth) < 0.15) return 'square';
  return interior.width > interior.depth ? 'horizontal' : 'vertical';
}

// Turns a corner reserve between "along the back wall" and "along the side wall" by reflecting it across the
// diagonal of its corner: the stand walls closing it stay the same, its width and depth swap.
// Partitions are symmetric; the door is replaced by its mirrored model so hinge and handle stay consistent.
export function mirrorReserveChildren(children = [], corner = 'left', doorCatalog = []) {
  return (children || []).map((child) => {
    const x = Number(child.x || 0);
    const z = Number(child.z || 0);
    const rotation = Number(child.rotation || 0);
    const next = corner === 'right'
      ? { x: round(-z), z: round(-x), rotation: normalizeDegrees(-90 - rotation) }
      : { x: round(z), z: round(x), rotation: normalizeDegrees(90 - rotation) };
    if (!isReserveDoorChild(child)) return { ...child, ...next };
    const variant = findMirroredDoorVariant(child, doorCatalog);
    return variant ? {
      ...child,
      ...next,
      type: variant.type,
      label: variant.label,
      modelUrl: variant.modelUrl || child.modelUrl,
      modelSize: variant.modelSize || child.modelSize,
      materialUrl: variant.materialUrl ?? child.materialUrl,
      dimensions: { ...(child.dimensions || {}), ...(variant.dimensions || {}) },
    } : { ...child, ...next };
  });
}

export function reserveDoorState(children = [], options = {}) {
  const slots = reserveDoorSlots(children);
  const slot = slots.find((candidate) => candidate.kind === 'door') || null;
  if (!slot) return null;
  const handle = options.handleOrientation === 'left' || options.handleOrientation === 'right'
    ? options.handleOrientation
    : doorDefaultHandle(slot.child);
  const opening = options.doorOpening === 'pull' ? 'pull' : 'push';
  const inward = { x: -slot.normal.x, z: -slot.normal.z };
  // Viewer outside looks inwards: their right-hand direction in the plan.
  const right = { x: -inward.z, z: inward.x };
  const handleSign = handle === 'right' ? 1 : -1;
  const center = slotPoint(slot, 0);
  const hinge = { x: center.x - right.x * handleSign * RESERVE_DOOR_LEAF / 2, z: center.z - right.z * handleSign * RESERVE_DOOR_LEAF / 2 };
  const latch = { x: hinge.x + right.x * handleSign * RESERVE_DOOR_LEAF, z: hinge.z + right.z * handleSign * RESERVE_DOOR_LEAF };
  const swing = opening === 'push' ? inward : slot.normal;
  const open = { x: hinge.x + swing.x * RESERVE_DOOR_LEAF, z: hinge.z + swing.z * RESERVE_DOOR_LEAF };
  const xs = [hinge.x, latch.x, open.x];
  const zs = [hinge.z, latch.z, open.z];
  // Opening in the door wall, from the inner face of the panel a few cm into the room: nothing can be fixed there.
  const face = RESERVE_WALL / 2;
  const opening0 = { x: hinge.x + inward.x * face, z: hinge.z + inward.z * face };
  const opening1 = { x: latch.x + inward.x * (face + RESERVE_DOOR_WALL_DEPTH), z: latch.z + inward.z * (face + RESERVE_DOOR_WALL_DEPTH) };
  return {
    slot,
    side: slot.side,
    handle,
    opening,
    center,
    hinge,
    latch,
    open,
    inward,
    right,
    zone: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    wallZone: {
      minX: Math.min(opening0.x, opening1.x), maxX: Math.max(opening0.x, opening1.x),
      minZ: Math.min(opening0.z, opening1.z), maxZ: Math.max(opening0.z, opening1.z),
    },
    zoneInside: opening === 'push',
  };
}

export function doorDistanceFromLeft(children = [], options = {}) {
  const state = reserveDoorState(children, options);
  const interior = reserveInterior(children);
  if (!state || !interior) return 0;
  const { slot } = state;
  const start = slot.side === 'front' ? interior.minX : slot.side === 'back' ? -interior.maxX
    : slot.side === 'left' ? interior.minZ : -interior.maxZ;
  return Math.max(0, viewerAxis(slot) - RESERVE_DOOR_LEAF / 2 - start);
}

export function applyReserveBuiltins(children = [], overrides = {}) {
  if (!overrides || !Object.keys(overrides).length) return children;
  const moved = (children || []).flatMap((child) => {
    const override = overrides[child.id];
    if (!override || isReserveStructuralChild(child)) return [child];
    if (override.removed) return [];
    if (isShelfMountedChild(child)) return [child];
    return [{
      ...child,
      x: Number.isFinite(Number(override.x)) ? Number(override.x) : child.x,
      z: Number.isFinite(Number(override.z)) ? Number(override.z) : child.z,
      rotation: Number.isFinite(Number(override.rotation)) ? Number(override.rotation) : child.rotation,
    }];
  });
  return followReserveShelves(children, moved);
}

// Reserve shelving with a power strip laid on its top shelf: two catalogue objects (two GLB), grouped in the reserve.
// The shelf asset carries dimensions.reserveShelf (+ topSurfaceY); the strip carries dimensions.mountType 'shelf'.
// The link lives in the assets, not in child ids, so it survives the admin group editor renumbering the children.
export function isReserveShelfChild(child = {}) {
  return Boolean(child?.dimensions?.reserveShelf || child?.reserveShelf);
}

export function isShelfMountedChild(child = {}) {
  return (child?.dimensions?.mountType || child?.mountType) === 'shelf';
}

export function reserveShelfTopY(shelf = {}) {
  const top = Number(shelf?.dimensions?.topSurfaceY);
  return Number.isFinite(top) && top > 0 ? top : reserveChildSize(shelf)[1];
}

// The shelf a mounted object stands on: the one under its centre, else the closest one.
export function reserveShelfHost(children = [], child = {}) {
  const shelves = (children || []).filter(isReserveShelfChild);
  if (!shelves.length) return null;
  const x = Number(child.x || 0);
  const z = Number(child.z || 0);
  const under = shelves.find((shelf) => {
    const box = childFootprint(shelf);
    return x >= box.minX - EPSILON && x <= box.maxX + EPSILON && z >= box.minZ - EPSILON && z <= box.maxZ + EPSILON;
  });
  return under || [...shelves].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
}

// A shelving unit, possibly sold with a power strip on it ("Bloc 3 Étagères Multiprise"): furniture first.
export function isReserveShelfUnit(entry = {}) {
  return /\betageres?\b|\bbloc 3\b/.test(childText(entry)) && !/murale/.test(childText(entry));
}

// "Bloc 3 Étagères" (950 × 1800 × 325 mm): under its bottom shelf (underside 922.5 mm) only the two 45 mm side
// frames reach the floor, open front and back: 86 cm wide, 92 cm high (a 140 L fridge, 63 × 86 × 56 cm, fits).
const KNOWN_FREE_UNDER = [{ pattern: /\bbloc 3 etageres?\b/, free: { width: 0.86, height: 0.92 } }];

// Free space under the bottom shelf (dimensions.freeUnder: { width, height }, metres), open front and back.
export function reserveShelfFreeUnder(child = {}) {
  const free = child?.dimensions?.freeUnder || child?.freeUnder || KNOWN_FREE_UNDER.find((known) => known.pattern.test(childText(child)))?.free;
  const width = Number(free?.width);
  const height = Number(free?.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

// A floor object lower than that space may stand under the shelf, between its uprights (a fridge under the
// shelving): its outline stays within the free width in the shelf's frame; it may stick out at the front or back.
export function fitsUnderReserveShelf(content = {}, shelf = {}, interior = null, tolerance = 0.005) {
  const free = reserveShelfFreeUnder(shelf);
  if (!free || content.mount === 'wall') return false;
  if (Number((content.size || [])[1] || 0) > free.height + EPSILON) return false;
  return contentPolygon(content, interior).every((point) => {
    const local = rotateReservePoint(point.x - Number(shelf.x || 0), point.z - Number(shelf.z || 0), -Number(shelf.rotation || 0));
    return Math.abs(local.x) <= free.width / 2 + tolerance;
  });
}

// Mounted objects keep their place on their shelf (offset and angle in the shelf's frame) when it moves or turns,
// sit on its top shelf, and go away with it.
export function followReserveShelves(before = [], after = []) {
  const byId = new Map((after || []).map((child) => [child.id, child]));
  return (after || []).flatMap((child) => {
    if (!isShelfMountedChild(child)) return [child];
    const original = (before || []).find((candidate) => candidate.id === child.id) || child;
    const host = reserveShelfHost(before, original);
    if (!host) return [child];
    const next = byId.get(host.id);
    if (!next) return [];
    const offset = rotateReservePoint(Number(original.x || 0) - Number(host.x || 0), Number(original.z || 0) - Number(host.z || 0), -Number(host.rotation || 0));
    const placed = rotateReservePoint(offset.x, offset.z, Number(next.rotation || 0));
    return [{
      ...child,
      x: round(Number(next.x || 0) + placed.x),
      z: round(Number(next.z || 0) + placed.z),
      y: reserveShelfTopY(next),
      rotation: normalizeDegrees(Number(original.rotation || 0) - Number(host.rotation || 0) + Number(next.rotation || 0)),
    }];
  });
}

// Applies the exhibitor's reserve choices to catalogue-authored children.
// Without any stored choice the authored geometry is returned untouched.
export function configureReserveChildren(children = [], config = {}, catalogEntries = []) {
  let next = children || [];
  if (config.doorSlot) next = moveReserveDoor(next, config.doorSlot);
  next = applyReserveDoorChoice(next, { handleOrientation: config.handleOrientation, doorOpening: config.doorOpening }, catalogEntries);
  next = applyReserveBuiltins(next, config.builtins);
  return relocateBlockedWallBuiltins(next, { handleOrientation: config.handleOrientation, doorOpening: config.doorOpening });
}

// Swaps the door model for the catalogue door of the right hand (see doorFamilyForChoice). Position and
// rotation are kept: the 3D view turns the leaf itself. Without a matching model the door is left as is
// and the 3D view mirrors it.
export function applyReserveDoorChoice(children = [], options = {}, catalogEntries = []) {
  const state = reserveDoorState(children, options);
  if (!state) return children;
  const door = state.slot.child;
  const variant = findDoorChoiceVariant(door, { handle: state.handle, opening: state.opening }, catalogEntries);
  const fit = reserveDoorFit(children, options);
  return children.map((child) => {
    if (child.id !== door.id) return child;
    // A door's name reads as its hand, not as the handle shown: keep the side actually chosen.
    const chosen = !variant ? child : {
      ...child,
      type: variant.type,
      label: variant.label,
      modelUrl: variant.modelUrl || child.modelUrl,
      modelSize: variant.modelSize || child.modelSize,
      materialUrl: variant.materialUrl ?? child.materialUrl,
      dimensions: { ...(child.dimensions || {}), ...(variant.dimensions || {}) },
    };
    const frame = doorPanelFrame(chosen, fit);
    if (!variant && child.doorHandle === state.handle && !frame) return child;
    return { ...chosen, doorHandle: state.handle, ...(frame ? { dimensions: { ...(chosen.dimensions || {}), wallCoverFrameBounds: frame } } : {}) };
  });
}

// The 6 cm partition panel of a door, in the door's own frame, where the 3D view shows it (see reserveDoorFit).
// Stored frames were measured on each model as authored, so they no longer match once the model is turned.
function doorPanelFrame(door = {}, fit = null) {
  const dimensions = door.dimensions || {};
  if (!fit || !(dimensions.depthLocked6cm || dimensions.wallCoverFrameBounds)) return null;
  const halfLength = reserveChildSize(door)[0] / 2;
  const frame = { minX: -halfLength, maxX: halfLength, minZ: fit.wallZ - RESERVE_WALL / 2, maxZ: fit.wallZ + RESERVE_WALL / 2 };
  const current = dimensions.wallCoverFrameBounds;
  const same = current && ['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Math.abs(Number(current[key]) - frame[key]) < 0.0005);
  return same ? null : Object.fromEntries(Object.entries(frame).map(([key, value]) => [key, Math.round(value * 1e6) / 1e6]));
}

// A wall-mounted builtin (hook, power strip…) seen as a reserve content, to reuse the wall placement rules.
export function builtinWallContent(child = {}, interior, center = null, rotation = null) {
  const point = center || { x: Number(child.x || 0), z: Number(child.z || 0) };
  return {
    ...contentFromCenter({ key: `builtin:${child.id}`, mount: 'wall', size: reserveChildSize(child) }, point, interior),
    rotation: rotation ?? Number(child.rotation || 0),
  };
}

const WALL_SIDES = ['back', 'left', 'right', 'front'];

// Closest free place on a wall for a wall-mounted object: along its own wall first, then on the other
// reserve partitions, then on the stand walls.
export function findWallSpotNear(content, context = {}) {
  const { interior } = context;
  if (!interior) return null;
  const centre = contentCenter(content, interior);
  const own = snapWallContent(content, centre, interior).wall;
  const sides = [own, ...WALL_SIDES.filter((side) => side !== own).sort((a, b) => Number(Boolean(interior.sides?.[b])) - Number(Boolean(interior.sides?.[a])))];
  for (const side of sides) {
    const horizontal = side === 'back' || side === 'front';
    const start = horizontal ? interior.minX : interior.minZ;
    const end = horizontal ? interior.maxX : interior.maxZ;
    const from = horizontal ? centre.x : centre.z;
    const positions = [];
    for (let along = start; along <= end + EPSILON; along += RESERVE_GRID / 2) positions.push(along);
    positions.sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
    for (const along of positions) {
      const point = horizontal
        ? { x: along, z: side === 'back' ? interior.minZ : interior.maxZ }
        : { x: side === 'left' ? interior.minX : interior.maxX, z: along };
      const placed = snapWallContent({ ...content, wall: side }, point, interior);
      if (placed.wall === side && !reserveContentIssues(placed, context).length) return placed;
    }
  }
  return null;
}

// Wall-mounted builtins are fixed on a partition: when the door takes the partition they hang on, they move to
// the closest free place on a wall (see findWallSpotNear). Others stay exactly where they are.
export function relocateBlockedWallBuiltins(children = [], options = {}) {
  const interior = reserveInterior(children);
  const door = reserveDoorState(children, options);
  if (!interior || !door) return children;
  let current = children;
  reserveBuiltinChildren(children).filter(isWallBuiltin).forEach((child) => {
    const others = reserveBuiltinChildren(current).filter((other) => other.id !== child.id);
    const context = { interior, door, builtins: others, contents: [] };
    const content = builtinWallContent(child, interior);
    if (!reserveContentIssues(content, context).includes('door')) return;
    const spot = findWallSpotNear(content, context);
    if (!spot) return;
    const centre = contentCenter(spot, interior);
    current = current.map((item) => (item.id === child.id ? { ...item, x: round(centre.x), z: round(centre.z), rotation: spot.rotation, wallMoved: true } : item));
  });
  return current;
}

export function reserveBuiltinChildren(children = []) {
  return (children || []).filter((child) => !isReserveStructuralChild(child));
}

export function wallMountRotation(side = 'back') {
  return { back: 0, front: 180, left: 90, right: -90 }[side] ?? 0;
}

export function contentFootprint(content = {}, interior) {
  const center = contentCenter(content, interior);
  return footprintBounds(content.size || [0.5, 0.5, 0.5], center.x, center.z, content.rotation || 0);
}

export function contentPolygon(content = {}, interior) {
  const center = contentCenter(content, interior);
  return footprintPolygon(content.size || [0.5, 0.5, 0.5], center.x, center.z, content.rotation || 0);
}

export function childPolygon(child = {}) {
  return footprintPolygon(reserveChildSize(child), Number(child.x || 0), Number(child.z || 0), Number(child.rotation || 0));
}

export function contentCenter(content = {}, interior) {
  return { x: Number(interior?.minX || 0) + Number(content.u || 0), z: Number(interior?.minZ || 0) + Number(content.v || 0) };
}

export function contentFromCenter(content = {}, center = { x: 0, z: 0 }, interior) {
  return { ...content, u: round(center.x - Number(interior?.minX || 0)), v: round(center.z - Number(interior?.minZ || 0)) };
}

// Keeps a wall-mounted object against the nearest interior wall, facing inside.
export function snapWallContent(content = {}, center = { x: 0, z: 0 }, interior) {
  if (!interior) return { ...content, ...center };
  const [width, , depth] = content.size || [0.5, 0.5, 0.1];
  const distances = {
    back: Math.abs(center.z - interior.minZ),
    front: Math.abs(interior.maxZ - center.z),
    left: Math.abs(center.x - interior.minX),
    right: Math.abs(interior.maxX - center.x),
  };
  const preferred = content.wall && distances[content.wall] < 0.25 ? content.wall : null;
  const side = preferred || Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
  const horizontal = side === 'back' || side === 'front';
  const along = horizontal
    ? clamp(center.x, interior.minX + width / 2, interior.maxX - width / 2)
    : clamp(center.z, interior.minZ + width / 2, interior.maxZ - width / 2);
  const normal = side === 'back' ? interior.minZ + depth / 2 : side === 'front' ? interior.maxZ - depth / 2
    : side === 'left' ? interior.minX + depth / 2 : interior.maxX - depth / 2;
  const point = horizontal ? { x: along, z: normal } : { x: normal, z: along };
  return { ...contentFromCenter(content, point, interior), wall: side, rotation: wallMountRotation(side) };
}

export function clampFloorContent(content = {}, center = { x: 0, z: 0 }, interior) {
  if (!interior) return contentFromCenter(content, center, interior);
  const box = footprintBounds(content.size || [0.5, 0.5, 0.5], 0, 0, content.rotation || 0);
  const point = {
    x: clamp(center.x, interior.minX - box.minX, interior.maxX - box.maxX),
    z: clamp(center.z, interior.minZ - box.minZ, interior.maxZ - box.maxZ),
  };
  return contentFromCenter(content, point, interior);
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

export function snapToGrid(value, step = RESERVE_GRID) {
  return Math.round(Number(value || 0) / step) * step;
}

// Returns the reasons why a content cannot stay at its position.
export function reserveContentIssues(content, { interior, contents = [], builtins = [], door = null } = {}) {
  if (!content || !interior) return ['outside'];
  // The bounding box decides "inside" exactly (the interior is a rectangle); collisions use the real rotated outlines.
  const box = contentFootprint(content, interior);
  const outline = contentPolygon(content, interior);
  const issues = [];
  if (!boundsInside(box, interior)) issues.push('outside');
  const mount = content.mount === 'wall' ? 'wall' : 'floor';
  const inSwing = door?.zoneInside && boundsOverlap(box, door.zone) && polygonsOverlap(outline, boundsPolygon(door.zone));
  // A wall-mounted object is fixed on a partition: never on the door, whichever way it opens.
  const onDoor = mount === 'wall' && door?.wallZone && boundsOverlap(box, door.wallZone);
  if (inSwing || onDoor) issues.push('door');
  const blocking = [
    ...contents.filter((other) => other.key !== content.key).map((other) => ({ mount: other.mount === 'wall' ? 'wall' : 'floor', box: contentFootprint(other, interior), outline: contentPolygon(other, interior) })),
    // Objects laid on a shelf take no room of their own: the shelf blocks for them. Under a shelf with free room
    // below, a low enough object fits.
    ...builtins.filter((child) => !isShelfMountedChild(child) && !fitsUnderReserveShelf(content, child, interior))
      .map((child) => ({ mount: isWallBuiltin(child) ? 'wall' : 'floor', box: childFootprint(child), outline: childPolygon(child) })),
  ];
  const overlaps = blocking.some((other) => other.mount === mount && boundsOverlap(box, other.box) && polygonsOverlap(outline, other.outline));
  if (overlaps) issues.push('overlap');
  return issues;
}

export function isWallBuiltin(child = {}) {
  if (isShelfMountedChild(child)) return false;
  const mountType = child.dimensions?.mountType || child.mountType;
  if (mountType === 'wall') return true;
  if (isReserveShelfUnit(child)) return false;
  return /patere|triplette|multiprise|miroir|porte documents mural/.test(childText(child));
}

export function findFreeReserveSpot(content, context = {}) {
  const { interior } = context;
  if (!interior) return null;
  const step = 0.05;
  const rotations = content.mount === 'wall' ? [null] : [content.rotation || 0, ...(content.rotation ? [0] : [90])];
  const candidates = [];
  if (content.mount === 'wall') {
    ['back', 'left', 'right', 'front'].forEach((side, sideIndex) => {
      const horizontal = side === 'back' || side === 'front';
      const start = horizontal ? interior.minX : interior.minZ;
      const end = horizontal ? interior.maxX : interior.maxZ;
      for (let along = start; along <= end + EPSILON; along += step) {
        const center = horizontal
          ? { x: along, z: side === 'back' ? interior.minZ : interior.maxZ }
          : { x: side === 'left' ? interior.minX : interior.maxX, z: along };
        candidates.push({ rank: sideIndex * 100 + (along - start), place: () => snapWallContent({ ...content, wall: side }, center, interior) });
      }
    });
  } else {
    rotations.forEach((rotation, rotationIndex) => {
      for (let z = interior.minZ; z <= interior.maxZ + EPSILON; z += step) {
        for (let x = interior.minX; x <= interior.maxX + EPSILON; x += step) {
          const center = { x, z };
          candidates.push({
            rank: rotationIndex * 1000 + (z - interior.minZ) * 10 + (x - interior.minX),
            place: () => clampFloorContent({ ...content, rotation }, center, interior),
          });
        }
      }
    });
  }
  for (const candidate of candidates.sort((a, b) => a.rank - b.rank)) {
    const placed = candidate.place();
    if (!reserveContentIssues(placed, context).length) return placed;
  }
  return null;
}

// Re-anchors every content into a new interior; returns the contents that no longer fit.
export function refitReserveContents(contents = [], context = {}) {
  const kept = [];
  const removed = [];
  (contents || []).forEach((content) => {
    const next = content.mount === 'wall'
      ? snapWallContent(content, contentCenter(content, context.interior), context.interior)
      : clampFloorContent(content, contentCenter(content, context.interior), context.interior);
    const placedContext = { ...context, contents: kept };
    if (!reserveContentIssues(next, placedContext).length) { kept.push(next); return; }
    const relocated = findFreeReserveSpot(next, placedContext);
    if (relocated) kept.push(relocated);
    else removed.push(content);
  });
  return { kept, removed };
}

export function reserveFreeSurfaceRatio(interior, contents = [], builtins = []) {
  if (!interior || interior.width * interior.depth <= 0) return 0;
  const area = interior.width * interior.depth;
  const used = [
    ...contents.filter((content) => content.mount !== 'wall').map((content) => contentFootprint(content, interior)),
    ...builtins.filter((child) => !isWallBuiltin(child) && !isShelfMountedChild(child)).map(childFootprint),
  ].reduce((sum, box) => sum + Math.max(0, Math.min(box.maxX, interior.maxX) - Math.max(box.minX, interior.minX))
    * Math.max(0, Math.min(box.maxZ, interior.maxZ) - Math.max(box.minZ, interior.minZ)), 0);
  return Math.max(0, Math.min(1, 1 - used / area));
}

export function reserveLocalToWorld(reserve = {}, point = { x: 0, z: 0 }) {
  const rotated = rotateReservePoint(point.x, point.z, reserve.rotation || 0);
  return { x: Number(reserve.x || 0) + rotated.x, z: Number(reserve.z || 0) + rotated.z };
}

export function reserveWorldToLocal(reserve = {}, point = { x: 0, z: 0 }) {
  return rotateReservePoint(Number(point.x || 0) - Number(reserve.x || 0), Number(point.z || 0) - Number(reserve.z || 0), -Number(reserve.rotation || 0));
}

export function reservePlacementFromEntry(entry = {}) {
  const rule = entry?.placementRule?.id || entry?.dimensions?.placementRule?.id || '';
  if (/left/.test(rule)) return 'left';
  if (/right/.test(rule)) return 'right';
  if (/center/.test(rule)) return 'center';
  const text = normalizeReserveText(`${entry?.label || ''} ${entry?.type || ''}`);
  if (/gauche/.test(text)) return 'left';
  if (/droite/.test(text)) return 'right';
  if (/centre|center/.test(text)) return 'center';
  return '';
}

export function reservePlacementAllowed(placement = '', layout = 'back') {
  if (placement === 'left') return layout === 'left' || layout === 'u';
  if (placement === 'right') return layout === 'right' || layout === 'u';
  return Boolean(placement);
}

export function reserveCatalogCategory(entry = {}) {
  const text = normalizeReserveText([
    entry.label, entry.type, entry.options?.variantGroupLabel, entry.groupLabel, entry.dimensions?.category,
  ].filter(Boolean).join(' '));
  if (/frigo|refrigerateur|fontaine|machine a cafe|nespresso|cafetiere|micro onde|bouilloire/.test(text)) return 'appliance';
  if (/triplette|alimentation|multiprise|prise electrique/.test(text) && !isReserveShelfUnit(entry)) return 'electric';
  if (/tete de cloison|\bporte\b|cloison|reserve|enseigne|arche|totem|\btv\b|ecran|mur led|moquette|spot|rail|pont lumiere|podium|comptoir|banque|\bbar\b|canape|fauteuil|chaise|tabouret|table|mange debout|vitrine|sono|borne|caisson|affiche|viscom|rampe|corniere|kit tournette|cache compteur/.test(text)) return '';
  if (/etagere murale|patere/.test(text) || entry.dimensions?.mountType === 'wall' || entry.mountType === 'wall') {
    return /etagere|patere|blanche|verre|inclinee/.test(text) ? 'wall' : '';
  }
  if (/etagere|meuble|rangement|bloc|armoire|vestiaire|portant|corbeille|poubelle/.test(text)) return 'storage';
  return '';
}

export function reserveEntryNeedsPower(entry = {}) {
  if (entry?.dimensions?.requiresPower || entry?.requiresPower) return true;
  const text = normalizeReserveText(`${entry.label || ''} ${entry.type || ''} ${entry.options?.variantGroupLabel || ''} ${entry.groupLabel || ''}`);
  return /frigo|refrigerateur|machine a cafe|nespresso|cafetiere|micro onde|bouilloire/.test(text);
}

export function isReservePowerSource(entry = {}) {
  return /triplette|alimentation|multiprise|prise electrique/.test(normalizeReserveText(`${entry.label || ''} ${entry.type || ''}`));
}

export function formatReserveCm(metres = 0) {
  return `${Math.round(Number(metres || 0) * 100)}`;
}

export function formatReserveMetres(metres = 0) {
  return Number(metres || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
