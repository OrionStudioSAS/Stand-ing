const text = item => `${item?.label || ''} ${item?.type || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function signatureArchVariant(item = {}) {
  const label = text(item);
  // Legacy Totem + Plafond models were previously called 1 m, but are old 2 m arches.
  const requestedSize = Number(label.match(/\b([123])\s*m\b/)?.[1] || item?.options?.signatureArchSizeM || 2);
  const size = requestedSize === 3 ? 3 : 2;
  const lighting = label.includes('suspension') ? 'suspension' : 'spot';
  return { size, lighting, supplement: Math.max(0, size - 2) * 249 };
}
export function isSignatureLedArch(item = {}) {
  return /mur[ -]+led[ -]+signature/.test(text(item));
}
export function signatureArchChoice(entries = [], size = 2, lighting = 'spot', ledWall = false) {
  return entries.find(entry => { const variant = signatureArchVariant(entry); return variant.size === size && variant.lighting === lighting && isSignatureLedArch(entry) === ledWall; }) || null;
}
export function signatureArchSizeSupplementLines(items = []) {
  return items.flatMap((item, index) => {
    const label = text(item);
    const arch = item?.options?.signatureBaseKey === 'arche' || isSignatureLedArch(item) || (label.includes('arche') && (label.includes('signature') || (label.includes('totem') && label.includes('plafond'))));
    if (!arch || item?.dimensions?.isColorGroup) return [];
    const variant = signatureArchVariant(item);
    const lines = [];
    if (isSignatureLedArch(item)) lines.push({ type: `signature-arch-led-wall-${item.id || index}`, label: `Mur LED Signature ${variant.size} m`, quantity: 1, unitPrice: 2570, total: 2570, reference: '' });
    if (!variant.supplement) return lines;
    return [...lines, { type: `signature-arch-size-${item.id || index}`, label: `Arche Signature ${variant.size} m — ${variant.lighting === 'suspension' ? 'Suspension' : 'Spot'}`, quantity: 1, unitPrice: variant.supplement, total: variant.supplement, reference: '' }];
  });
}

export function isLegacySignatureArch(item = {}) {
  const label = text(item);
  return label.includes('totem') && label.includes('plafond') && (label.includes('arche') || label.includes('asset-totem-plafond'));
}
export function upgradeLegacySignatureArch(item, entries = []) {
  if (!isLegacySignatureArch(item)) return item;
  const { lighting } = signatureArchVariant(item);
  const replacement = signatureArchChoice(entries.filter(entry => !isLegacySignatureArch(entry) && text(entry).includes('arche') && text(entry).includes('signature')), 2, lighting);
  if (!replacement) return item;
  return { ...item, type: replacement.type, label: replacement.label,
    modelUrl: replacement.modelUrl, modelSize: replacement.modelSize, materialUrl: replacement.materialUrl,
    dimensions: replacement.dimensions,
    options: { ...item.options, signatureBaseKey: 'arche', signatureArchVariantType: replacement.type,
      signatureArchVariantLabel: replacement.label, signatureArchSizeM: 2, signatureArchLighting: lighting, signatureArchSizeSupplement: 0 },
  };
}

export function signatureArchMinimumDepth(size = 2) {
  return Number(size) === 3 ? 3.45 : 2.45;
}

export function signatureArchFitsDepth(item = {}, standDepth = Infinity) {
  return Number(standDepth) >= signatureArchMinimumDepth(signatureArchVariant(item).size);
}
