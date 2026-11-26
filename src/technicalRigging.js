export function technicalSignRigging(item = {}, entry = {}) {
  if (item.options?.prestigeHidden) return null;
  // The nominal span is a production dimension, not a measurement of the GLB.
  const names = [item.options?.variantAssetType, item.type, entry.type, item.label, entry.label]
    .filter(Boolean).join(' ').toLowerCase();
  if (!/enseigne[- ]haute/.test(names)) return null;

  const showMarkers = /hexagonal/.test(names);
  const spanMm = showMarkers ? 700
    : /2000\s*[x×]|\b2\s*m\b/.test(names) ? 2000
    : /1000\s*[x×]|\b1\s*m\b/.test(names) ? 1000 : 0;
  if (!spanMm) return null;

  const angle = Number(item.rotation || 0) * Math.PI / 180;
  const x = Number(item.x ?? 0);
  const z = Number(item.z ?? 0);
  if (![angle, x, z].every(Number.isFinite)) return null;
  const points = [-spanMm / 2000, spanMm / 2000].map(dx => ({
    x: x + dx * Math.cos(angle),
    z: z - dx * Math.sin(angle),
  }));
  return { spanMm, points, showMarkers };
}

export function technicalRiggingPowerEnd(points, reserves = []) {
  const distance = (point, reserve) => {
    const angle = Number(reserve.rotation || 0) * Math.PI / 180;
    const dx = point.x - reserve.x, dz = point.z - reserve.z;
    const x = dx * Math.cos(angle) - dz * Math.sin(angle);
    const z = dx * Math.sin(angle) + dz * Math.cos(angle);
    return Math.hypot(Math.max(0, Math.abs(x) - reserve.width / 2), Math.max(0, Math.abs(z) - reserve.depth / 2));
  };
  if (!reserves.length) return points[0].z <= points[1].z + 1e-6 ? 0 : 1;
  const closest = point => Math.min(...reserves.map(reserve => distance(point, reserve)));
  return closest(points[0]) <= closest(points[1]) ? 0 : 1;
}
