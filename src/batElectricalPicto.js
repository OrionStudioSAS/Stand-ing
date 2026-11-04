export function normalizeBatElectricalPicto(metadata = {}) {
  const number = (value, fallback) => value == null || !Number.isFinite(Number(value)) ? fallback : Number(value);
  // A physical size, not a percentage of the parent pictogram (legacy Size field).
  const size = Math.min(1, Math.max(.05, number(metadata.batElectricalPictoSizeMeters, .2)));
  const coordinate = value => Math.min(5, Math.max(-4, number(value, .5)));
  return { url: metadata.batElectricalPictoUrl || '', path: metadata.batElectricalPictoPath || '',
    x: coordinate(metadata.batElectricalPictoX), y: coordinate(metadata.batElectricalPictoY), size };
}

export function normalizeBatElectricalPictos(metadata = {}) {
  if (!Array.isArray(metadata.batElectricalPictos)) {
    const icon = normalizeBatElectricalPicto(metadata);
    return icon.url ? [icon] : [];
  }
  return metadata.batElectricalPictos.filter(icon => icon && typeof icon === 'object').map(icon => normalizeBatElectricalPicto({
    batElectricalPictoUrl: icon.url, batElectricalPictoPath: icon.path,
    batElectricalPictoX: icon.x, batElectricalPictoY: icon.y, batElectricalPictoSizeMeters: icon.size,
  })).filter(icon => icon.url);
}

export function batElectricalPictosMetadata(icons = []) {
  const normalized = normalizeBatElectricalPictos({ batElectricalPictos: icons });
  const first = normalized[0] || normalizeBatElectricalPicto();
  // Mirror the first icon for older scene snapshots; an explicit empty list clears all icons.
  return { batElectricalPictos: normalized, batElectricalPictoUrl: first.url, batElectricalPictoPath: first.path,
    batElectricalPictoX: first.x, batElectricalPictoY: first.y, batElectricalPictoSizeMeters: first.size };
}

export function electricalPictoPoint(frame, icon) {
  const x = (icon.x - .5) * frame.width;
  const y = (icon.y - .5) * frame.height;
  const angle = frame.angle || 0;
  return { x: frame.x + x * Math.cos(angle) - y * Math.sin(angle), y: frame.y + x * Math.sin(angle) + y * Math.cos(angle) };
}
