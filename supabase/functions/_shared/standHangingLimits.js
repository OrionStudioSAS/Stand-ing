export const defaultCeilingHeightM = 5.25;

export function parseHeightMeters(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*m?$/i);
  const meters = Number(match?.[1]?.replace(',', '.'));
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

export function effectiveHangingLimit(limits = {}) {
  const ceiling = parseHeightMeters(limits?.ceilingM) ?? defaultCeilingHeightM;
  const sling = parseHeightMeters(limits?.slingM);
  return sling === null ? ceiling : Math.min(ceiling, sling);
}

export function clampHangingSignBottom(bottom, height, limit) {
  return Math.max(0, Math.min(bottom, limit - height));
}

export function hangingSignBodyHeight(item = {}, modelHeight) {
  const specified = parseHeightMeters(item.dimensions?.signBodyHeightM);
  if (specified !== null) return specified;
  // Catalogue meshes include several metres of cable. The design height of
  // the sign itself is encoded just before "mm ht" in the asset filename.
  const description = [item.modelUrl, item.type, item.label].filter(Boolean).join(' ').replace(/%20/gi, ' ');
  const measured = description.match(/\d+\s*[x×]\s*(?:\d+\s*[x×]\s*)?(\d+)\s*(?:-\s*)?mm[\s_-]*ht\b/i);
  if (measured) return Number(measured[1]) / 1000;
  return Number.isFinite(modelHeight) && modelHeight > 0 && modelHeight <= 2.5 ? modelHeight : null;
}
