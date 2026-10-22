// This view uses only the eligible surfaces supplied by the configurator.
export function wallOptionsMapGeometry(surfaces = [], standWidth = 4, standDepth = 3) {
  const width = Number.isFinite(Number(standWidth)) && Number(standWidth) > 0 ? Number(standWidth) : 4;
  const depth = Number.isFinite(Number(standDepth)) && Number(standDepth) > 0 ? Number(standDepth) : 3;
  const project = ([x, y, z]) => [(x - z) * 0.866, (x + z) * 0.44 - y];
  const floor = [[-width / 2, 0, -depth / 2], [width / 2, 0, -depth / 2], [width / 2, 0, depth / 2], [-width / 2, 0, depth / 2]].map(project);
  const planes = surfaces.map((surface, index) => {
    const [x = 0, y = 1.25, z = 0] = surface.position || [];
    const rotation = Number(surface.rotation || 0);
    const halfWidth = Math.max(0.01, Number(surface.width) || 0.01) / 2;
    const halfHeight = Math.max(0.01, Number(surface.height) || 2.5) / 2;
    const dx = Math.cos(rotation) * halfWidth;
    const dz = -Math.sin(rotation) * halfWidth;
    const corners = [[x - dx, y - halfHeight, z - dz], [x + dx, y - halfHeight, z + dz], [x + dx, y + halfHeight, z + dz], [x - dx, y + halfHeight, z - dz]];
    return { id: surface.id, number: index + 1, points: corners.map(project), center: project([x, y, z]), distance: x + z };
  });
  const allPoints = [...floor, ...planes.flatMap((plane) => plane.points)];
  const minX = Math.min(...allPoints.map(([x]) => x)), maxX = Math.max(...allPoints.map(([x]) => x));
  const minY = Math.min(...allPoints.map(([, y]) => y)), maxY = Math.max(...allPoints.map(([, y]) => y));
  const scale = Math.min(278 / Math.max(0.1, maxX - minX), 186 / Math.max(0.1, maxY - minY));
  const transform = ([x, y]) => [160 + (x - (minX + maxX) / 2) * scale, 104 + (y - (minY + maxY) / 2) * scale];
  return { floor: floor.map(transform), planes: planes.map((plane) => ({ ...plane, points: plane.points.map(transform), center: transform(plane.center) })).sort((a, b) => a.distance - b.distance) };
}

export function wallCoverPrintSize(surface = {}) {
  return { widthMm: Math.round(Math.max(0, Number(surface.width) || 0) * 1000), heightMm: Math.round(Math.max(0, Number(surface.height) || 0) * 1000) };
}
