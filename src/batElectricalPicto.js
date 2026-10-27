export function normalizeBatElectricalPicto(metadata = {}) {
  const number = (value, fallback) => value == null || !Number.isFinite(Number(value)) ? fallback : Number(value);
  const size = Math.min(.6, Math.max(.1, number(metadata.batElectricalPictoSize, .25)));
  const coordinate = value => Math.min(1 - size / 2, Math.max(size / 2, number(value, .5)));
  return { url: metadata.batElectricalPictoUrl || '', path: metadata.batElectricalPictoPath || '',
    x: coordinate(metadata.batElectricalPictoX), y: coordinate(metadata.batElectricalPictoY), size };
}
