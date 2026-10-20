const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const included = [
  { name: 'Jaune', codes: ['1360','0400'], names: ['jaune', 'pamplemousse'] },
  { name: 'Orange', codes: ['1370','0450'], names: ['orange'] },
  { name: 'Rouge', codes: ['1964','0713'], names: ['rouge'] },
  { name: 'Fuchsia', codes: ['1805','0510'], names: ['fuchsia','fuschia','fuschisa','rose'] },
  { name: 'Vert pistache', codes: ['1323','0675'], names: ['vert pistache','pistache','anis'] },
  { name: 'Bleu turquoise', codes: ['1335','0822'], names: ['bleu turquoise','turquoise'] },
  { name: 'Bleu marine', codes: ['1390','0809'], names: ['bleu marine','marine','bleu amiral'] },
  { name: 'Noir', codes: ['1961','0913'], names: ['noir'] },
];
export function signatureIncludedFootprintColor(color = {}) {
  const code = String(color.code || color.id || '').split(':').at(-1);
  return included.find(definition => definition.codes.includes(code) || definition.names.includes(key(color.name)));
}
export function signatureFootprintPalette(colors = []) {
  const palette = colors.map(color => {
    const match = signatureIncludedFootprintColor(color);
    return { ...color, name: match?.name || color.name, included: Boolean(match), isFree: Boolean(match), isDefault: Boolean(match && color.isDefault), defaultIncluded: false, price: match ? 0 : 285, priceMode: 'flat' };
  });
  if (!palette.some(color => color.isDefault)) {
    const first = palette.findIndex(color => color.included);
    if (first >= 0) palette[first] = { ...palette[first], isDefault: true };
  }
  return palette;
}
export function signatureFootprintSupplementLine(items = []) {
  const arch = items.find(item => {
    const options = item.options || {};
    const isArch = options.signatureBaseKey === 'arche' || /arche.*signature|signature.*arche/.test(key(`${item.type} ${item.label}`));
    const hasColor = options.signatureArchColorId || options.signatureArchColorCode || options.signatureArchColorName;
    return isArch && hasColor && !signatureIncludedFootprintColor({ id: options.signatureArchColorId, code: options.signatureArchColorCode, name: options.signatureArchColorName });
  });
  if (!arch) return null;
  return { type: 'signature-footprint-color', label: `Empreinte moquette Signature — couleur en option${arch.options?.signatureArchColorName ? ` (${arch.options.signatureArchColorName})` : ''}`, quantity: 1, unitPrice: 285, total: 285, reference: arch.options?.signatureArchColorReference || arch.options?.signatureArchColorCode || '' };
}
