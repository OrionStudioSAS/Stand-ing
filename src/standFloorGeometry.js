export const standWallThickness = 0.06;

function layoutHasSideWalls(layout) {
  return layout === 'left' || layout === 'right' || layout === 'u';
}

export function sceneFloorDepth(layout, depth) {
  return Math.max(0.01, Number(depth || 0) + (layoutHasSideWalls(layout) ? standWallThickness : 0));
}

export function sceneFloorCenterZ(layout) {
  return layoutHasSideWalls(layout) ? standWallThickness / 2 : 0;
}

export function sceneFloorFrontZ(layout, depth) {
  return sceneFloorCenterZ(layout) + sceneFloorDepth(layout, depth) / 2;
}
