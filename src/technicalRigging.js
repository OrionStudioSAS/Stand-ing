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
