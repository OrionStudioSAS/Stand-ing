const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function wallCoverPackTariff(scene = {}) {
  if (typeof scene === 'string') scene = { offer: scene };
  const name = [scene.offer, scene.offer_name, scene.pack, scene.pack_name, scene.source_payload?.offer,
    scene.source_payload?.pack, scene.source_payload?.includedPack, scene.source_payload?.options?.includedPack,
    scene.options?.includedPack].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (name.includes('signature')) {
    const area = Number(scene.dimensions?.width ?? scene.width_m ?? 0) * Number(scene.dimensions?.depth ?? scene.depth_m ?? 0);
    return { unitPrice: 249, includedMl: area < 9 ? 0 : area < 15 ? 2 : area < 24 ? 3 : area < 36 ? 3.5 : 4 };
  }
  if (/equipe|equipped/.test(name)) return { unitPrice: 253, includedMl: 0 };
  const board = String(scene.source_payload?.board_id || scene.source_payload?.boardId || scene.monday_board_id || '');
  return { unitPrice: 288, includedMl: name.includes('prestige') || board === '18395912050' ? 4 : name.includes('confort') || board === '18395911999' ? 2 : 0 };
}

export function wallCoverQuote(surfaces = [], includedMl = 0, unitPrice = 288) {
  const quantity = money(surfaces.reduce((sum, surface) => sum + Math.max(0, Number(surface.visibleWidth ?? surface.width ?? 0)), 0));
  const included = money(Math.min(quantity, Math.max(0, Number(includedMl || 0))));
  const subtotal = money(quantity * unitPrice);
  const discount = money(included * unitPrice);
  return { quantity, included, billable: money(quantity - included), unitPrice, subtotal, discount, total: money(subtotal - discount) };
}
