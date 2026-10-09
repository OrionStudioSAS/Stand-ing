const epsilon = 0.001;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function subtractInterval(intervals, blocker) {
  return intervals.flatMap((interval) => {
    if (blocker.max <= interval.min || blocker.min >= interval.max) return [interval];
    return [
      { min: interval.min, max: Math.min(interval.max, blocker.min) },
      { min: Math.max(interval.min, blocker.max), max: interval.max },
    ].filter((part) => part.max >= part.min);
  });
}

// Work with the complete rail footprint, even when its normal collisions are disabled.
export function spotWallTargets({ walls, objectSurfaces, reserves, bounds, halfWidth, halfDepth, nativeOffset, objectOffset }) {
  const surfaces = [
    ...walls,
    ...objectSurfaces.flatMap((surface) => {
      const protectedBounds = surface.protectedBounds;
      const center = protectedBounds && (surface.orientation === 'x'
        ? (protectedBounds.minZ + protectedBounds.maxZ) / 2
        : (protectedBounds.minX + protectedBounds.maxX) / 2);
      const sides = protectedBounds ? [surface.normalAxis >= center ? 1 : -1] : [1, -1];
      return sides.map((side) => ({
        wall: surface.id, wallSurface: surface, wallSide: side,
        orientation: surface.orientation,
        normalAxis: surface.normalAxis + side * objectOffset,
        min: surface.centerAxis - surface.length / 2,
        max: surface.centerAxis + surface.length / 2,
      }));
    }),
  ];
  return surfaces.flatMap((surface) => {
    const alongX = surface.orientation === 'x';
    const normal = surface.wallSurface ? surface.normalAxis : surface.normalAxis + surface.side * nativeOffset;
    const normalMin = alongX ? bounds.minZ : bounds.minX;
    const normalMax = alongX ? bounds.maxZ : bounds.maxX;
    if (normal - halfDepth < normalMin - epsilon || normal + halfDepth > normalMax + epsilon) return [];
    const min = Math.max(surface.min, alongX ? bounds.minX : bounds.minZ) + halfWidth;
    const max = Math.min(surface.max, alongX ? bounds.maxX : bounds.maxZ) - halfWidth;
    if (max < min - epsilon) return [];
    let intervals = [{ min, max: Math.max(min, max) }];
    for (const reserve of reserves) {
      const near = alongX ? reserve.minZ : reserve.minX;
      const far = alongX ? reserve.maxZ : reserve.maxX;
      if (normal + halfDepth <= near + epsilon || normal - halfDepth >= far - epsilon) continue;
      intervals = subtractInterval(intervals, {
        min: (alongX ? reserve.minX : reserve.minZ) - halfWidth - 0.02,
        max: (alongX ? reserve.maxX : reserve.maxZ) + halfWidth + 0.02,
      });
    }
    return intervals.length ? [{ ...surface, normalAxis: normal, intervals }] : [];
  });
}

export function spotTargetAxis(target, axis, step = 0.05) {
  return target.intervals.map(({ min, max }) => clamp(Number((Math.round(axis / step) * step).toFixed(4)), min, max))
    .sort((a, b) => Math.abs(a - axis) - Math.abs(b - axis))[0];
}

export function spotTargetPatch(target, axis) {
  return {
    wall: target.wall,
    x: spotTargetAxis(target, axis),
    wallSide: target.wallSide ?? null,
    wallSurface: target.wallSurface ?? null,
  };
}

export function closestSpotWallTarget(point, targets, { threshold = Infinity, preferredWall = null } = {}) {
  return targets.map((target) => {
    const rawAxis = target.orientation === 'x' ? point.x : point.z;
    const normal = target.orientation === 'x' ? point.z : point.x;
    const axis = spotTargetAxis(target, rawAxis);
    const distance = Math.hypot(rawAxis - axis, normal - target.normalAxis);
    return { target, axis, distance };
  }).filter((candidate) => candidate.distance <= threshold)
    .sort((a, b) => (a.distance - (a.target.wall === preferredWall ? 0.08 : 0))
      - (b.distance - (b.target.wall === preferredWall ? 0.08 : 0)))[0] || null;
}

export function spotWallTargetFromRay(ray, targets, { height = 2.5, pivot = [0, 0, 0], axisPadding = 0.1 } = {}) {
  if (!ray?.origin || !ray?.direction) return null;
  return targets.flatMap((target) => {
    const alongX = target.orientation === 'x';
    const direction = alongX ? ray.direction.z : ray.direction.x;
    const side = target.wallSide ?? target.side;
    // Only the accessible face is selectable, never the back of a reserve/stand wall.
    if (direction * side >= -epsilon) return [];
    const origin = alongX ? ray.origin.z - pivot[2] : ray.origin.x - pivot[0];
    const distance = (target.normalAxis - origin) / direction;
    if (distance < 0) return [];
    const x = ray.origin.x + distance * ray.direction.x - pivot[0];
    const z = ray.origin.z + distance * ray.direction.z - pivot[2];
    const y = ray.origin.y + distance * ray.direction.y - pivot[1];
    const axis = alongX ? x : z;
    if (y < 0 || y > height + 0.6 || axis < target.min - epsilon || axis > target.max + epsilon) return [];
    if (!target.intervals.some((interval) => axis >= interval.min - axisPadding && axis <= interval.max + axisPadding)) return [];
    return [{ target, point: { x, z }, distance }];
  }).sort((a, b) => a.distance - b.distance)[0] || null;
}
