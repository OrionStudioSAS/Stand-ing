const text = item => `${item?.type || ''} ${item?.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const included = item => Boolean(item?.included || item?.priceMode === 'included' || item?.price_mode === 'included' || item?.basePresetId);

export function counterPowerCatalogEntry(catalog = []) {
  return catalog.find(entry => /\btriplette\b|\bmultiprise\b/.test(text(entry)));
}

export function includedCounterPowerItems(items = [], catalog = []) {
  const power = counterPowerCatalogEntry(catalog);
  if (!power) return [];
  return items.filter(item => (included(item) || item.options?.counterPowerEnabled === true) && /(?:banque|comptoir).*accueil/.test(text(item))
    && !item.options?.counterHidden && !item.options?.prestigeHidden).map(counter => {
    const free = included(counter);
    const size = counter.modelSize || counter.dimensions?.size || [1, 1, .5];
    const radians = Number(counter.rotation || 0) * Math.PI / 180;
    const localZ = -Math.max(0, Number(size[2]) / 2 - .1);
    return { ...power, id: `${free ? 'included-counter-power' : 'counter-power'}-${counter.id}`, label: free ? 'Multiprise du comptoir inclus' : 'Multiprise dans le comptoir',
      x: Number(counter.x || 0) + localZ * Math.sin(radians), z: Number(counter.z || 0) + localZ * Math.cos(radians),
      y: Number(counter.y || 0) + Number(size[1]) + .002, rotation: Number(counter.rotation || 0),
      autoCounterPower: true, surfaceHostId: counter.id, included: free, priceMode: free ? 'included' : 'billable', basePresetId: null,
      movementLocked: true, deleteLocked: true, rotationLocked: true, collisionEnabled: false,
      options: free ? { unitPrice: 0 } : {}, dimensions: { ...power.dimensions, category: 'Électricité', collisionEnabled: false },
    };
  }).filter(power => !items.some(item => item.id === power.id));
}
