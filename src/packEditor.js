const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalizedName = (name) => String(name || '').trim().toLocaleLowerCase('fr-FR');
const number = (value) => Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

export function packEditorImpact(salons = [], selectedOffer = {}) {
  const matchesPack = (offer) => selectedOffer?.pack_id && offer.pack_id
    ? offer.pack_id === selectedOffer.pack_id
    : Boolean(selectedOffer?.name) && normalizedName(offer.name) === normalizedName(selectedOffer.name);
  const affected = salons.filter((salon) => (salon.offers || []).some(matchesPack));
  const sceneIds = new Set();
  affected.forEach((salon) => {
    const offers = (salon.offers || []).filter(matchesPack);
    (salon.scenes || []).forEach((scene, index) => {
      const matches = scene.offer_id
        ? offers.some((offer) => offer.id === scene.offer_id)
        : offers.some((offer) => normalizedName(scene.offer || scene.options?.includedPack) === normalizedName(offer.name));
      if (matches) sceneIds.add(scene.id || `${salon.id}-${index}`);
    });
  });
  return { salons: affected, sceneCount: sceneIds.size };
}

export function packEditorChanges(before = {}, after = {}) {
  const changes = [];
  if (!same(before.dimensions, after.dimensions)) {
    const dimensions = (draft) => `${number(draft.dimensions?.width)} × ${number(draft.dimensions?.depth)} m`;
    changes.push({ label: 'Dimensions', detail: `${dimensions(before)} → ${dimensions(after)}` });
  }
  const colors = [
    ['carpetColor', 'Sol / moquette'],
    ['carpetFootprintColor', 'Empreinte moquette'],
    ['wallFabricColor', 'Murs / coton cloison'],
    ['reserveWallFabricColor', 'Cloisons de la réserve'],
  ];
  colors.forEach(([key, label]) => {
    const oldColor = before.defaultColorOptions || {};
    const newColor = after.defaultColorOptions || {};
    if (!same([oldColor[`${key}Id`], oldColor[`${key}Hex`]], [newColor[`${key}Id`], newColor[`${key}Hex`]])) {
      changes.push({ label, detail: `${oldColor[`${key}Name`] || 'Par défaut'} → ${newColor[`${key}Name`] || 'Par défaut'}` });
    }
  });
  if (!same(before.reserveRules, after.reserveRules)) {
    const optionCount = Object.values(after.reserveRules || {}).reduce((count, rule) => count + (rule.options || []).filter((option) => option.type).length, 0);
    changes.push({ label: 'Réserves', detail: `Règles de surface mises à jour · ${optionCount} option${optionCount > 1 ? 's' : ''} complémentaire${optionCount > 1 ? 's' : ''}` });
  }
  if (!same(before.partitionHeadRules, after.partitionHeadRules)) {
    changes.push({ label: 'Têtes de cloison', detail: 'Objets associés, côtés inclus ou suppléments mis à jour' });
  }
  if (!same(before.autoSpotsRule, after.autoSpotsRule)) {
    const enabled = after.autoSpotsRule?.twoSpotType || after.autoSpotsRule?.threeSpotType || after.autoSpotsRule?.type;
    changes.push({ label: 'Spots', detail: enabled ? 'Rails automatiques mis à jour' : 'Rails automatiques désactivés' });
  }
  if (!same(before.items, after.items)) {
    const oldItems = before.items || [];
    const newItems = after.items || [];
    changes.push({ label: 'Objets inclus', detail: `${oldItems.length} → ${newItems.length} objet${newItems.length > 1 ? 's' : ''} · composition ou placement mis à jour` });
  }
  return changes;
}
