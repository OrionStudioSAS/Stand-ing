// Pure geometry and catalogue helpers for the reserve configurator.
// Coordinates are expressed in the reserve group's local frame (metres):
// x to the right, z towards the aisle, rotations follow three.js (degrees around Y).

export const RESERVE_WALL = 0.06;
export const RESERVE_DOOR_OFFSET = 0.03;
export const RESERVE_DOOR_LEAF = 0.8;
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

function lineInset(segments = []) {
  return segments.some((segment) => segment.kind === 'door') ? RESERVE_DOOR_OFFSET + RESERVE_WALL / 2 : RESERVE_WALL / 2;
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
  return withSize({
    minX: outer.minX + (left.length ? lineInset(left) : 0),
    maxX: outer.maxX - (right.length ? lineInset(right) : 0),
    minZ: outer.minZ + (back.length ? lineInset(back) : 0),
    maxZ: outer.maxZ - (front.length ? lineInset(front) : 0),
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

// Wall axis of a slot: door modules are authored 3 cm outside the partition axis.
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
    : doorHandleFromLabel(slot.child);
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
  return (children || []).flatMap((child) => {
    const override = overrides[child.id];
    if (!override || isReserveStructuralChild(child)) return [child];
    if (override.removed) return [];
    return [{
      ...child,
      x: Number.isFinite(Number(override.x)) ? Number(override.x) : child.x,
      z: Number.isFinite(Number(override.z)) ? Number(override.z) : child.z,
      rotation: Number.isFinite(Number(override.rotation)) ? Number(override.rotation) : child.rotation,
    }];
  });
}

// Applies the exhibitor's reserve choices to catalogue-authored children.
// Without any stored choice the authored geometry is returned untouched.
export function configureReserveChildren(children = [], config = {}, catalogEntries = []) {
  let next = children || [];
  if (config.doorSlot) next = moveReserveDoor(next, config.doorSlot);
  if (config.handleOrientation) {
    const door = reserveDoorChild(next);
    const variant = door ? findDoorHandleVariant(door, config.handleOrientation, catalogEntries) : null;
    if (door && variant) {
      next = next.map((child) => (child.id === door.id ? {
        ...child,
        type: variant.type,
        label: variant.label,
        modelUrl: variant.modelUrl || child.modelUrl,
        modelSize: variant.modelSize || child.modelSize,
        materialUrl: variant.materialUrl ?? child.materialUrl,
        dimensions: { ...(child.dimensions || {}), ...(variant.dimensions || {}) },
      } : child));
    }
  }
  return applyReserveBuiltins(next, config.builtins);
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
  const box = contentFootprint(content, interior);
  const issues = [];
  if (!boundsInside(box, interior)) issues.push('outside');
  if (door?.zoneInside && boundsOverlap(box, door.zone)) issues.push('door');
  const mount = content.mount === 'wall' ? 'wall' : 'floor';
  const blocking = [
    ...contents.filter((other) => other.key !== content.key).map((other) => ({ mount: other.mount === 'wall' ? 'wall' : 'floor', box: contentFootprint(other, interior), wall: other.wall })),
    ...builtins.map((child) => ({ mount: isWallBuiltin(child) ? 'wall' : 'floor', box: childFootprint(child), wall: '' })),
  ];
  const overlaps = blocking.some((other) => {
    if (mount === 'wall' && other.mount === 'wall') return boundsOverlap(box, other.box);
    if (mount === 'floor' && other.mount === 'floor') return boundsOverlap(box, other.box);
    return false;
  });
  if (overlaps) issues.push('overlap');
  return issues;
}

export function isWallBuiltin(child = {}) {
  const mountType = child.dimensions?.mountType || child.mountType;
  if (mountType === 'wall') return true;
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
    ...builtins.filter((child) => !isWallBuiltin(child)).map(childFootprint),
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
  if (/triplette|alimentation|multiprise|prise electrique/.test(text)) return 'electric';
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
