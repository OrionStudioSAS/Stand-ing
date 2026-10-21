const text = item => `${item?.label || ''} ${item?.type || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function signatureArchVariant(item = {}) {
  const label = text(item);
  // Legacy Totem + Plafond arches are the included 1 m models. Their model bounds
  // include the overhang, so those bounds must not determine the commercial size.
  const size = Number(label.match(/\b([123])\s*m\b/)?.[1] || item?.options?.signatureArchSizeM || 1);
  const lighting = label.includes('suspension') ? 'suspension' : 'spot';
  return { size, lighting, supplement: Math.max(0, size - 1) * 249 };
}
export function signatureArchChoice(entries = [], size = 1, lighting = 'spot') {
  return entries.find(entry => { const variant = signatureArchVariant(entry); return variant.size === size && variant.lighting === lighting; }) || null;
}
export function signatureArchSizeSupplementLines(items = []) {
  return items.flatMap((item, index) => {
    const label = text(item);
    const arch = item?.options?.signatureBaseKey === 'arche' || (label.includes('arche') && (label.includes('signature') || (label.includes('totem') && label.includes('plafond'))));
    if (!arch || item?.dimensions?.isColorGroup) return [];
    const variant = signatureArchVariant(item);
    if (!variant.supplement) return [];
    return [{ type: `signature-arch-size-${item.id || index}`, label: `Arche Signature ${variant.size} m — ${variant.lighting === 'suspension' ? 'Suspension' : 'Spot'}`, quantity: 1, unitPrice: variant.supplement, total: variant.supplement, reference: '' }];
  });
}
