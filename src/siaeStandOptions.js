export const thickCarpetRate = 22;
export const siaeSurfaceColorRate = 10;
export const siaeViscomMinArea = 25;

export function isSiaePackLabel(label = '') {
  const key = String(label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  return key === 'equipe' || /\bsiae\b/.test(key);
}

export const siaeReserveRuleBands = [
  { id: 'small', label: 'Moins de 12 m²', minArea: 0, maxArea: 12, maxExclusive: true, includedLabel: 'Aucune réserve incluse', size: 0 },
  { id: 'medium', label: '12 à 24 m²', minArea: 12, maxArea: 25, maxExclusive: true, includedLabel: 'Réserve 1 m²', size: 1 },
  { id: 'large', label: '25 à 30 m²', minArea: 25, maxArea: 31, maxExclusive: true, includedLabel: 'Réserve 2 m²', size: 2 },
  { id: 'extraLarge', label: '31 m² et plus', minArea: 31, maxArea: null, includedLabel: 'Réserve 3 m²', size: 3 },
];
