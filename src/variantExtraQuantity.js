export const maxVariantExtraQuantity = 99;

export function variantExtraQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.min(maxVariantExtraQuantity, Math.max(0, Math.floor(quantity))) : 0;
}

export function variantExtraUnits(option, selected) {
  return option.type === 'quantity' ? variantExtraQuantity(selected) : Number(Boolean(selected));
}
