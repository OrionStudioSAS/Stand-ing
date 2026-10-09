import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const functions = [
  'isSpotWallItem', 'spotPlacementTargetsForItem', 'resolveSpotWallAttachments',
  'wallDragPatch', 'wallDragPointFromRay', 'applyDragPointerOffset',
  'rotatePoint', 'wallSurfaceCandidate', 'isObjectWallSurfaceCandidate',
  'objectWallSurfaces', 'groupObjectWallSurfaces', 'mergeObjectWallSurfaces',
  'isProtectedBoundarySurface', 'protectedObjectOutsideSide', 'safeObjectWallSide',
  'serializeObjectWallSurface', 'pickLedRailOverride',
];

// Real application snapping/drag adapters, with only catalog/model sizing replaced by fixtures.
export const spotFixtureSource = `
const wallThickness = 0.06, objectWallSnapThreshold = 0.75, fixedWallHeight = 2.5;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const isWallItem = (item) => Boolean(item?.isWallItem);
const isLedRailEntry = (item) => Boolean(item?.isLedSpotOption);
const isAutomaticSpotItem = (item) => Boolean(item?.autoSpot);
const isReserveSceneItem = (item) => Boolean(item?.autoReserve);
const itemCollisionEnabled = (item) => item.collisionEnabled !== false;
const itemDefaultSize = (item) => item.dimensions.size;
const itemGroupSize = (item) => ({ width: item.dimensions.size[0], depth: item.dimensions.size[2] });
const wallItemMetrics = (item) => ({ width: item.dimensions.size[0] });
const itemHardCollisionBox = (item) => item.bounds;
const wallMountedNormalOffset = (item, object = false) => (object ? 0.03 : 0.06) + item.dimensions.size[2] / 2;
const availableWalls = (layout) => ['back', ...(layout === 'left' || layout === 'u' ? ['left'] : []), ...(layout === 'right' || layout === 'u' ? ['right'] : [])].map((id) => ({id}));
const wallAxisLimits = (wall, width, depth) => wall === 'back' ? { min: -width/2, max: width/2 } : { min: -depth/2 + 0.06, max: depth/2 };
const standFloorBounds = (width, depth, layout) => ({ minX: -width/2 + (layout === 'u' || layout === 'left' ? 0.06 : 0), maxX: width/2 - (layout === 'u' || layout === 'right' ? 0.06 : 0), minZ: -depth/2 + 0.06, maxZ: depth/2 });
function screenWorldPosition(item, width, depth, items) {
  const surface = objectWallSurfaces(items).find((surface) => surface.id === item.wall) || item.wallSurface;
  if (surface) {
    const normal = surface.normalAxis + safeObjectWallSide(surface, item.x, item.wallSide) * wallMountedNormalOffset(item, true);
    return surface.orientation === 'x' ? [item.x, 2.4, normal] : [normal, 2.4, item.x];
  }
  const offset = wallMountedNormalOffset(item);
  return item.wall === 'left' ? [-width/2 + offset, 2.4, item.x] : item.wall === 'right' ? [width/2 - offset, 2.4, item.x] : [item.x, 2.4, -depth/2 + offset];
}
${functions.map((name) => {
    const start = app.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Missing ${name}`);
    return app.slice(start, app.indexOf('\n}\n', start) + 2);
  }).join('\n')}
`;

export const spotApiNames = ['spotPlacementTargetsForItem', 'resolveSpotWallAttachments', 'wallDragPatch', 'wallDragPointFromRay', 'applyDragPointerOffset', 'screenWorldPosition', 'pickLedRailOverride'];

export function reserveFixture(minX = 0.5, maxX = 2.5, minZ = -1.94, maxZ = -0.88) {
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  return { id: 'reserve', autoReserve: true, isGroup: true, x, z,
    bounds: { minX, maxX, minZ, maxZ },
    children: [
      { id: 'front', label: 'Cloison avant', x: 0, z: maxZ - z - 0.03, dimensions: { size: [maxX-minX, 2.5, 0.06] } },
      { id: 'rear', label: 'Cloison arrière', x: 0, z: minZ - z + 0.03, dimensions: { size: [maxX-minX, 2.5, 0.06] } },
      { id: 'left', label: 'Cloison gauche', x: minX - x + 0.03, z: 0, dimensions: { size: [0.06, 2.5, maxZ-minZ] } },
      { id: 'right', label: 'Cloison droite', x: maxX - x - 0.03, z: 0, dimensions: { size: [0.06, 2.5, maxZ-minZ] } },
    ],
  };
}

export const railFixture = { id: 'spot', wall: 'back', x: 0, isWallItem: true, isLedSpotOption: true, autoSpot: true,
  autoLedRail: true, collisionEnabled: false, dimensions: { size: [0.9, 0.15, 0.3] } };
