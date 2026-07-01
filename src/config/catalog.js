import { Armchair, Box, Image, Monitor, Square, Table2 } from 'lucide-react';

export function modelUrl(fileName) {
  return `/models/${encodeURIComponent(fileName)}`;
}

export const catalog = [
  { type: 'chair', label: 'Chaise', icon: Armchair, color: '#c85f3f' },
  { type: 'table', label: 'Table', icon: Table2, color: '#1d8f83' },
  { type: 'screen', label: 'Ecran', icon: Monitor, color: '#22364d' },
  { type: 'poster', label: 'Affiche murale', icon: Image, color: '#f7f1dc', isWallItem: true, posterHeight: 1 },
  { type: 'counter', label: 'Comptoir', icon: Box, color: '#d5b767' },
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
];

export const layouts = [
  { id: 'left', label: 'Arriere gauche' },
  { id: 'back', label: 'Arriere' },
  { id: 'right', label: 'Arriere droite' },
  { id: 'u', label: 'U' },
];
