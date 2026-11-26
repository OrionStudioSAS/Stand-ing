import { Armchair, Box, Square } from 'lucide-react';

export function modelUrl(fileName) {
  return `/models/${encodeURIComponent(fileName)}`;
}

export const catalog = [
  {
    type: 'obj-cloison',
    label: 'Cloison 1x2.5m',
    icon: Square,
    color: '#efece2',
    modelUrl: modelUrl('Cloison 1x2.5m HT (1).obj'),
    modelSize: [1, 2.5, 0.06],
  },
  {
    type: 'obj-podium',
    label: 'Podium 50cm',
    icon: Box,
    color: '#f7f5eb',
    modelUrl: modelUrl('Poidum Blanc 50x50x50cm.obj'),
    modelSize: [0.5, 0.5, 0.5],
  },
  {
    type: 'obj-porte',
    label: 'Porte poussant',
    icon: Square,
    color: '#e4ded2',
    modelUrl: modelUrl('Porte Poussant Gauche (1).obj'),
    modelSize: [1, 2.5, 0.24],
  },
  {
    type: 'obj-meuble-bas',
    label: 'Meuble bas',
    icon: Box,
    color: '#d9c49b',
    modelUrl: modelUrl('meuble.obj'),
    modelSize: [1.04, 0.54, 0.5],
  },
  {
    type: 'obj-porte-doc',
    label: 'Porte document',
    icon: Box,
    color: '#d7dde0',
    modelUrl: modelUrl('Porte document.obj'),
    modelSize: [0.3, 1.4, 0.3],
  },
  {
    type: 'obj-tabouret',
    label: 'Tabouret SIAE',
    icon: Armchair,
    color: '#f2f0e8',
    modelUrl: modelUrl('TABOURET SIAE.obj'),
    modelSize: [0.52, 0.86, 0.5],
  },
  // Reserve shelving + power strip: two separate GLB (scripts/generate-reserve-shelf-models.mjs), grouped below.
  // Free bay under the bottom shelf for a 240 L fridge (about 60 × 60 × 143-146 cm): 64 cm wide, 150 cm high,
  // 65 cm deep, nothing in front nor behind below the shelf.
  {
    type: 'obj-etagere-reserve-frigo',
    label: 'Étagère réserve haute',
    icon: Box,
    color: '#9aa1a6',
    modelUrl: modelUrl('etagere-reserve-frigo.glb'),
    modelSize: [0.7, 2, 0.65],
    dimensions: {
      size: [0.7, 2, 0.65],
      category: 'Mobilier',
      reserveShelf: true,
      topSurfaceY: 2,
      // Fridge bay, read by the reserve rules (fitsUnderReserveShelf): a 240 L fridge (≈ 60 × 60 × 146 cm max) fits.
      freeUnder: { width: 0.64, height: 1.5 },
    },
  },
  {
    type: 'obj-multiprise-6-prises',
    label: 'Multiprise 6 prises',
    icon: Box,
    color: '#f4f4f2',
    modelUrl: modelUrl('multiprise-6-prises.glb'),
    modelSize: [0.47, 0.055, 0.065],
    dimensions: { size: [0.47, 0.055, 0.065], category: 'Électricité', mountType: 'shelf' },
  },
];

const reserveShelfEntry = catalog.find((entry) => entry.type === 'obj-etagere-reserve-frigo');
const powerStripEntry = catalog.find((entry) => entry.type === 'obj-multiprise-6-prises');
const groupChild = (id, entry, position) => ({
  id, type: entry.type, label: entry.label, modelUrl: entry.modelUrl, modelSize: entry.modelSize, dimensions: entry.dimensions,
  rotation: 0, lockedInGroup: true, ...position,
});

// Same shape as an object_bank group (dimensions.isGroup / children): the strip lies on the top shelf, near the back
// so its cable can run down the rear upright.
export const reserveShelfGroupChildren = [
  groupChild('reserve-shelf', reserveShelfEntry, { x: 0, y: 0, z: 0 }),
  groupChild('reserve-shelf-power-strip', powerStripEntry, { x: 0, y: reserveShelfEntry.dimensions.topSurfaceY, z: -0.2 }),
];

catalog.push({
  type: 'group-etagere-reserve-multiprise',
  label: 'Étagère réserve + multiprise',
  icon: Box,
  color: '#dfe8ec',
  isGroup: true,
  groupSize: [0.7, 2.055, 0.65],
  children: reserveShelfGroupChildren,
  dimensions: { isGroup: true, category: 'Mobilier', groupSize: [0.7, 2.055, 0.65], children: reserveShelfGroupChildren },
});

export const layouts = [
  { id: 'left', label: 'Arriere gauche' },
  { id: 'back', label: 'Arriere' },
  { id: 'right', label: 'Arriere droite' },
  { id: 'u', label: 'U' },
];
