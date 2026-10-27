const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const groupMillimeter = value => Number(number(value).toFixed(3));

export function groupStructuralAsset(asset = {}) {
  if (asset.dimensions?.isReserveDoor || asset.dimensions?.isWallPanel) return true;
  const text = `${asset.label || ''} ${asset.type || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ').toLowerCase();
  if (/patere|porte\s*(?:manteau|document|revue|brochure|parapluie)|affiche|viscom|spot|tete de cloison/.test(text)) return false;
  return /\b(?:portes?|cloisons?|door|wall panel)\b/.test(text);
}

export function groupDragPosition(origin, start, current, step = .001) {
  const snap = (axis) => groupMillimeter(number(origin[axis]) + Math.round((number(current[axis]) - number(start[axis])) / step) * step);
  return { x: snap('x'), z: snap('z') };
}

export function groupNudge(row, axis, amount) {
  return { [axis]: groupMillimeter(number(row[axis]) + amount) };
}

export function nextGroupRowPosition(rows, type, asset) {
  const last = [...rows].reverse().find(row => row.type === type);
  if (!last) return { x: 0, z: 0, rotation: 0 };
  const structural = groupStructuralAsset(asset);
  const step = structural ? 1 : .2;
  const radians = number(last.rotation) * Math.PI / 180;
  const size = asset?.dimensions?.size || asset?.dimensions?.dimensions || [];
  const alongZ = structural && Number(size[2]) > Number(size[0]);
  return { x: groupMillimeter(number(last.x) + step * (alongZ ? Math.sin(radians) : Math.cos(radians))), z: groupMillimeter(number(last.z) + step * (alongZ ? Math.cos(radians) : -Math.sin(radians))), rotation: number(last.rotation), ...(last.y != null ? { y: number(last.y) } : {}) };
}

export function groupPlacementBounds(items) {
  return items.reduce((box, item) => {
    const size = item.modelSize || [.6, .6, .6];
    const angle = number(item.rotation) * Math.PI / 180;
    const halfX = (Math.abs(Math.cos(angle)) * size[0] + Math.abs(Math.sin(angle)) * size[2]) / 2;
    const halfZ = (Math.abs(Math.sin(angle)) * size[0] + Math.abs(Math.cos(angle)) * size[2]) / 2;
    return { minX: Math.min(box.minX, number(item.x) - halfX), maxX: Math.max(box.maxX, number(item.x) + halfX), minZ: Math.min(box.minZ, number(item.z) - halfZ), maxZ: Math.max(box.maxZ, number(item.z) + halfZ) };
  }, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
}
