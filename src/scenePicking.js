function owner(object) {
  for (let current = object; current; current = current.parent) {
    if (current.userData?.standSceneItem) return current;
  }
  return null;
}

export function prioritizeUnderArchIntersections(hits) {
  const first = hits[0];
  const arch = owner(first?.object);
  const bounds = arch?.userData?.archPickBounds;
  if (!bounds || !first.point) return hits;
  const roofPoint = arch.worldToLocal(first.point.clone());
  if (roofPoint.y < 1.8) return hits;
  const underneath = hit => {
    const item = owner(hit.object);
    if (!item || item === arch || !hit.point) return false;
    const point = arch.worldToLocal(hit.point.clone());
    return point.y < roofPoint.y - .1 && point.x >= bounds.minX && point.x <= bounds.maxX
      && point.z >= bounds.minZ && point.z <= bounds.maxZ;
  };
  return [...hits.filter(underneath), ...hits.filter(hit => !underneath(hit))];
}
