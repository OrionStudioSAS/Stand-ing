export function headArtwork(visual = {}, slotId = '') {
  const value = slotId ? visual.textureSlotValues?.[slotId] || {} : visual;
  return {
    url: slotId ? value.imageUrl || '' : value.headMainImageUrl || '',
    name: slotId ? value.imageName || '' : value.headMainImageName || '',
    pending: Boolean(value.visualPending),
    enabled: !slotId || value.visualEnabled !== false,
    selected: slotId ? value.visualEnabled === true : value.headMainVisualMode === 'custom',
    framing: slotId ? value : value.headMainImageFraming || {},
  };
}

export function headArtworkIsCustom(artwork, intent = false) {
  return artwork.enabled && Boolean(artwork.url || artwork.name || artwork.pending || artwork.selected || intent);
}

export function headArtworkStatus(artwork, custom = true) {
  if (!custom) return 'standard';
  if (artwork.pending) return 'pending';
  return artwork.url ? 'ready' : 'missing';
}

export function headFormat(size = []) {
  return size.length === 2 && size.every(value => Number(value) > 0)
    ? `${size.map(value => Math.round(Number(value))).join(' × ')} mm` : '';
}
