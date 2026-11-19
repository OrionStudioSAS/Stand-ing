const riggingOneMeter = [[0, -.49], [0, .49]];
const riggingTwoMeters = [[-.99, -.99], [.99, -.99], [.99, .99], [-.99, .99]];
const riggingTurntable = [[0, 0]];

// Ceiling attachment centres measured from the original model bounds, in metres.
const highSignPoints = new Map([
  ['asset-enseigne-haute-aluminium-1000x1000x1000mm-ht-mrbx1icy', riggingOneMeter],
  ['asset-enseigne-haute-aluminium-1000x1000x1000mm-ht-opt-mrbx1r65', riggingOneMeter],
  ['asset-enseigne-haute-aluminium-2000x2000x1000mm-ht-mrbwze9h', riggingTwoMeters],
  ['asset-enseigne-haute-aluminium-2000x2000x1000mm-ht-opt-mrbwzqut', riggingTwoMeters],
  ['asset-enseigne-haute-aluminium-1000x1000x1000mm-ht-kit-mrbx2oam', riggingTurntable],
  ['asset-enseigne-haute-aluminium-1000x1000x1000mm-ht-opt-mrbx29rv', riggingTurntable],
  ['asset-enseigne-haute-aluminium-2000x2000x1000mm-ht-kit-mrbx0zab', riggingTurntable],
  ['asset-enseigne-haute-aluminium-2000x2000x1000mm-ht-opt-mrbx0gnj', riggingTurntable],
  ['asset-enseigne-haute-hexagonale-smcl-1500x1300mm-ht-mqqg851n', [[-.325, 0], [.325, 0]]],
]);

export function technicalSignRiggingPoints(item = {}, entry = {}) {
  if (item.options?.prestigeHidden) return [];
  const variantType = item.options?.variantAssetType;
  const variant = entry.dimensions?.variantAssets?.find((asset) => asset.type === variantType);
  const points = item.dimensions?.riggingPoints ?? variant?.dimensions?.riggingPoints ?? entry.dimensions?.riggingPoints
    ?? highSignPoints.get(variantType) ?? highSignPoints.get(item.type) ?? highSignPoints.get(entry.type) ?? [];
  if (!Array.isArray(points)) return [];
  const angle = Number(item.rotation || 0) * Math.PI / 180;
  const x = Number(item.x ?? 0), z = Number(item.z ?? 0);
  if (![angle, x, z].every(Number.isFinite)) return [];
  return points.filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)).map(([dx, dz]) => ({
    x: x + dx * Math.cos(angle) + dz * Math.sin(angle),
    z: z - dx * Math.sin(angle) + dz * Math.cos(angle),
  }));
}

export function technicalRiggingCoordinates({ x, z }, width, depth, layout, wallThickness) {
  const left = layout === 'left' || layout === 'u';
  const right = layout === 'right' || layout === 'u';
  const xOptions = [];
  if (left) xOptions.push({ position: -width / 2 + wallThickness, label: 'mur gauche' });
  if (right) xOptions.push({ position: width / 2 - wallThickness, label: 'mur droit' });
  if (!xOptions.length) xOptions.push({ position: -width / 2, label: 'bord gauche' }, { position: width / 2, label: 'bord droit' });
  const referenceX = xOptions.reduce((a, b) => Math.abs(x - a.position) <= Math.abs(x - b.position) ? a : b);
  return {
    xMm: Math.round(Math.abs(x - referenceX.position) * 1000), xReference: referenceX.label,
    yMm: Math.round(Math.abs(z - (-depth / 2 + wallThickness)) * 1000), yReference: 'mur du fond',
  };
}
