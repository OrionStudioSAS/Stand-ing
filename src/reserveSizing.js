const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const reserveWallUnitPrice = 111;
export const supportsReserveSizing = (pack) => ['signature', 'equipe'].includes(normalized(pack));

// Reserve-only assemblies reuse the real one-metre wall and door models.
// They are deterministic catalog entries, not new records or scaled doors.
export function reserveSizingCatalog(entries = [], assets = [], pack = '') {
  if (!supportsReserveSizing(pack)) return entries;
  const structural = assets.filter((asset) => asset.is_active !== false && !asset.dimensions?.isGroup);
  const wallAsset = structural.find((asset) => normalized(asset.label).includes('cloison') && !normalized(asset.label).includes('tete')
    && Math.abs(Number(asset.dimensions?.size?.[0]) - 1) < 0.01 && Number(asset.dimensions?.size?.[2]) <= 0.08);
  const doorAsset = structural.find((asset) => normalized(asset.label).includes('porte') && Number(asset.dimensions?.size?.[1]) >= 2.4);
  if (!wallAsset || !doorAsset) return entries;
  const child = (asset, id, x, z, rotation) => ({ id, type: asset.type, label: asset.label, x, y: 0, z, rotation,
    modelUrl: asset.model_url || asset.modelUrl, modelSize: asset.dimensions.size,
    materialUrl: asset.dimensions.materialUrl, dimensions: { ...asset.dimensions,
      ...(asset === doorAsset ? { depthLocked6cm: true } : {}) }, lockedInGroup: true });
  const extra = ['left', 'right', 'back', 'u'].flatMap((layout) => Array.from({ length: 6 }, (_, index) => {
    const area = index + 1;
    const side = layout === 'right' ? -1 : 1;
    const center = layout === 'back' || layout === 'u';
    const doorOffset = Number(doorAsset.dimensions.size[2]) / 2 - 0.03;
    const children = center
      ? Array.from({ length: area }, (_, wall) => [-1, 1].map((edge) => child(wallAsset, `side-${edge}-${wall}`, edge * 0.5, -area / 2 + wall + 0.5, 90))).flat()
      : Array.from({ length: area }, (_, wall) => child(wallAsset, `front-${wall}`, -area / 2 + wall + 0.5, 0.5, 0));
    children.push(center ? child(doorAsset, 'door', 0, area / 2 + doorOffset, 0)
      : child(doorAsset, 'door', side * (area / 2 - doorOffset), 0, side * -90));
    const size = center ? [1.06, 2.5, area + 0.06] : [area + 0.06, 2.5, 1.06];
    const type = `reserve-sized-${layout}-${area}m2`;
    const placement = layout === 'left' ? 'back-left' : layout === 'right' ? 'back-right' : 'back-center';
    return { type, label: `Réserve ${area} m² ${layout === 'left' ? 'arrière gauche' : layout === 'right' ? 'arrière droite' : 'centre arrière'}`,
      isGroup: true, children, groupSize: size, price: 0,
      icon: entries.find((entry) => entry.isGroup)?.icon,
      placementRule: { id: placement, locked: true },
      dimensions: { isGroup: true, isReserve: true, reserveSizingOnly: true, reserveAreaM2: area, reserveLayout: layout,
        packs: [pack], children, groupSize: size } };
  }));
  return [...entries, ...extra];
}

export function reserveSizingRule(rule, catalog = [], pack = '', layout = 'back', width = Infinity, depth = Infinity) {
  if (!supportsReserveSizing(pack) || !rule?.includedType) return rule;
  const included = catalog.find((entry) => entry.type === rule.includedType);
  const match = normalized(included?.label || rule.includedLabel).match(/(\d+(?:[.,]\d+)?)\s*m(?:2|²)/);
  const baseArea = Number(included?.dimensions?.reserveAreaM2 || match?.[1]?.replace(',', '.'));
  if (!(baseArea > 0)) return rule;
  const choices = catalog.filter((entry) => entry.dimensions?.reserveSizingOnly
    && entry.dimensions.reserveLayout === layout && entry.dimensions.reserveAreaM2 !== baseArea
    && entry.dimensions.reserveAreaM2 <= baseArea + 3 && entry.groupSize[0] + 0.06 <= width && entry.groupSize[2] + 0.06 <= depth);
  if (!choices.length) return rule;
  const baselinePrice = Number(included?.dimensions?.packPricing?.[normalized(pack)]?.price || 0);
  return { ...rule, options: choices.map((entry) => {
    const delta = entry.dimensions.reserveAreaM2 - baseArea;
    return { type: entry.type, label: `${entry.label}${delta > 0 ? ` (+${delta} m² · ${delta * 2} cloisons)` : ''}`,
      price: (rule.chargeIncluded || normalized(pack) === 'signature' ? baselinePrice : 0) + Math.max(0, delta) * 2 * reserveWallUnitPrice };
  }) };
}

export function reserveSizingEntry(entry, included) {
  if (!entry?.dimensions?.reserveSizingOnly || !included?.children?.length) return entry;
  const [width, , depth] = entry.groupSize;
  const accessories = included.children.filter((item) => {
    const text = normalized(`${item.type} ${item.label}`);
    return !text.includes('cloison') && !(text.includes('porte') && Number(item.modelSize?.[1] || item.dimensions?.size?.[1]) >= 2.4);
  }).map((item, index) => {
    const size = item.dimensions?.size || item.modelSize || [0.3, 0.3, 0.3];
    const rotated = Math.abs(Math.sin(Number(item.rotation || 0) * Math.PI / 180)) > 0.7;
    const halfX = Math.max(0, (width - 0.12 - Number(size[rotated ? 2 : 0])) / 2);
    const halfZ = Math.max(0, (depth - 0.12 - Number(size[rotated ? 0 : 2])) / 2);
    return { ...item, id: `included-accessory-${index}`, x: Math.max(-halfX, Math.min(halfX, Number(item.x || 0))), z: Math.max(-halfZ, Math.min(halfZ, Number(item.z || 0))) };
  });
  return { ...entry, children: [...entry.children, ...accessories] };
}
