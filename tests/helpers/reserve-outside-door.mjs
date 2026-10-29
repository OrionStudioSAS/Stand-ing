export function outsideDoorReserve(length = 2, wallCount = 1) {
  const children = [
    { id: 'front', label: 'Cloison extérieure avant', x: 0, z: .53, dimensions: { size: [length, 2.5, .06] } },
    { id: 'door', label: 'Porte réserve', x: length / 2 - .03, z: 0, rotation: 90,
      dimensions: { size: [1, 2.5, .25], depthLocked6cm: true, wallCoverFrameBounds: { minX: -.5, maxX: .5, minZ: -.03, maxZ: .03 } } },
  ];
  if (wallCount === 2) children.push({ id: 'back', label: 'Cloison extérieure arrière', x: 0, z: -.53, dimensions: { size: [length, 2.5, .06] } });
  return { id: 'reserve', label: `Réserve ${length} m²`, isGroup: true, children, rotation: 0 };
}
