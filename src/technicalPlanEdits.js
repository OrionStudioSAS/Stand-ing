const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, finite(value, fallback)));
const identifier = (value) => String(value || '').slice(0, 200);

export function normalizeTechnicalPlanEdits(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    version: 1,
    items: Object.fromEntries(Object.entries(value.items || {}).slice(0, 1000).filter(([id]) => id !== '__proto__').map(([id, edit]) => [identifier(id), {
      dx: clamp(edit?.dx, -1, 1, 0), dy: clamp(edit?.dy, -1, 1, 0), hidden: Boolean(edit?.hidden),
    }])),
    extras: (Array.isArray(value.extras) ? value.extras : []).slice(0, 100).filter((item) => item?.id && item?.type).map((item) => ({
      id: identifier(item.id), type: identifier(item.type), page: Math.floor(clamp(item.page, 0, 99)),
      x: clamp(item.x, 0.03, 0.97, 0.6), y: clamp(item.y, 0.03, 0.97, 0.4),
      width: clamp(item.width, 0.01, 0.4, 0.05), height: clamp(item.height, 0.01, 0.4, 0.05), rotation: clamp(item.rotation, -360, 360, 0),
    })),
    annotations: (Array.isArray(value.annotations) ? value.annotations : []).slice(0, 100).filter((item) => item?.id).map((item) => ({
      id: identifier(item.id), page: Math.floor(clamp(item.page, 0, 99)),
      x: clamp(item.x, 0.03, 0.97, 0.6), y: clamp(item.y, 0.03, 0.97, 0.5),
      text: String(item.text || '').slice(0, 2000), size: clamp(item.size, 12, 48, 20),
    })),
  };
}

export function moveTechnicalPlanElement(input, id, kind, dx, dy) {
  const next = normalizeTechnicalPlanEdits(input);
  if (kind === 'item') {
    const current = next.items[id] || { dx: 0, dy: 0, hidden: false };
    next.items[id] = { ...current, dx: current.dx + dx, dy: current.dy + dy };
  } else {
    const key = kind === 'annotation' ? 'annotations' : 'extras';
    next[key] = next[key].map((item) => item.id === id ? { ...item, x: item.x + dx, y: item.y + dy } : item);
  }
  return normalizeTechnicalPlanEdits(next);
}
