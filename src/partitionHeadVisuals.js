const imageFields = ['imageUrl', 'imageName', 'visualPending', 'imageZoom', 'imageOffsetX', 'imageOffsetY', 'visualEnabled'];
const mainFields = ['headMainImageUrl', 'headMainImageName', 'headMainImageFraming', 'visualPending', 'headMainVisualEnabled'];
const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const pick = (value, fields) => Object.fromEntries(fields.filter((key) => has(value, key)).map((key) => [key, value[key]]));

function visualPatch(options = {}) {
  const patch = pick(options, mainFields);
  const slots = Object.entries(options?.textureSlotValues || {})
    .map(([id, value]) => [id, pick(value, imageFields)])
    .filter(([, value]) => Object.keys(value).length);
  if (slots.length) patch.textureSlotValues = Object.fromEntries(slots);
  return patch;
}

function mergeOptions(options = {}, patch = {}) {
  const next = { ...options, ...patch };
  if (patch.textureSlotValues) {
    next.textureSlotValues = { ...(options?.textureSlotValues || {}) };
    for (const [id, value] of Object.entries(patch.textureSlotValues)) {
      next.textureSlotValues[id] = { ...(next.textureSlotValues[id] || {}), ...value };
    }
  }
  return next;
}

export function partitionHeadUsesDifferentVisuals(visuals = {}, section = null) {
  if (section && typeof visuals.visualModes?.[section] === 'boolean') return visuals.visualModes[section];
  if (!section && visuals.visualModes) return Object.values(visuals.visualModes).some(Boolean);
  if (typeof visuals.differentVisuals === 'boolean') return visuals.differentVisuals;
  // Keep deliberately different artwork in scenes saved before the shared option existed.
  const left = visualPatch(visuals.left), right = visualPatch(visuals.right);
  const identity = (value) => value.headMainImageUrl || value.headMainImageName || value.imageUrl || value.imageName || '';
  if (identity(left) && identity(right) && (identity(left) !== identity(right)
    || JSON.stringify(left.headMainImageFraming || {}) !== JSON.stringify(right.headMainImageFraming || {}))) return true;
  return Object.keys({ ...left.textureSlotValues, ...right.textureSlotValues }).some((id) => {
    const a = left.textureSlotValues?.[id] || {}, b = right.textureSlotValues?.[id] || {};
    return identity(a) && identity(b) && (identity(a) !== identity(b)
      || imageFields.some((key) => key !== 'imageName' && a[key] !== b[key]));
  });
}

export function withPartitionHeadVisualMode(visuals = {}, differentVisuals = false, section = null) {
  if (section) {
    const next = { ...visuals, visualModes: { ...visuals.visualModes, [section]: differentVisuals } };
    if (differentVisuals) return next;
    if (section === 'main') {
      const a = visuals.left || {}, b = visuals.right || {};
      const source = a.headMainImageUrl || a.headMainImageName || a.visualPending ? a : b;
      const common = pick(source, mainFields);
      for (const side of ['left', 'right']) next[side] = mergeOptions(visuals[side], common);
    } else {
      const a = visuals.left?.textureSlotValues?.[section], b = visuals.right?.textureSlotValues?.[section];
      const source = a?.imageUrl || a?.imageName || a?.visualPending ? a : b || a;
      if (source) for (const side of ['left', 'right']) next[side] = mergeOptions(visuals[side], { textureSlotValues: { [section]: source } });
    }
    return next;
  }
  const next = { ...visuals, differentVisuals };
  delete next.visualModes;
  if (differentVisuals) return next;
  const left = visualPatch(visuals.left), right = visualPatch(visuals.right);
  const main = left.headMainImageUrl || left.headMainImageName || left.visualPending ? left : right;
  const common = {
    headMainImageUrl: main.headMainImageUrl || '', headMainImageName: main.headMainImageName || '',
    headMainImageFraming: main.headMainImageFraming || { imageZoom: 1, imageOffsetX: 0, imageOffsetY: 0 },
    visualPending: Boolean(main.visualPending), ...(has(main, 'headMainVisualEnabled') ? { headMainVisualEnabled: main.headMainVisualEnabled } : {}), textureSlotValues: {},
  };
  for (const id of Object.keys({ ...left.textureSlotValues, ...right.textureSlotValues })) {
    const a = left.textureSlotValues?.[id], b = right.textureSlotValues?.[id];
    common.textureSlotValues[id] = a?.imageUrl || a?.imageName || a?.visualPending ? a : b || a;
  }
  for (const side of ['left', 'right']) next[side] = mergeOptions(visuals[side], common);
  return next;
}

export function normalizePartitionHeadVisuals(visuals = {}) {
  if (visuals.visualModes) {
    return Object.entries(visuals.visualModes).reduce((next, [section, different]) => withPartitionHeadVisualMode(next, different, section), visuals);
  }
  return withPartitionHeadVisualMode(visuals, partitionHeadUsesDifferentVisuals(visuals));
}

export function patchPartitionHeadVisuals(visuals = {}, side, patch) {
  if (!['left', 'right'].includes(side)) return visuals;
  const next = { ...visuals };
  const options = visuals[side] || {};
  const change = typeof patch === 'function' ? patch(options) : patch || {};
  next[side] = mergeOptions(options, change);
  const shared = visualPatch(change);
  if (partitionHeadUsesDifferentVisuals(visuals, 'main')) for (const field of mainFields) delete shared[field];
  if (shared.textureSlotValues) {
    for (const id of Object.keys(shared.textureSlotValues)) if (partitionHeadUsesDifferentVisuals(visuals, id)) delete shared.textureSlotValues[id];
    if (!Object.keys(shared.textureSlotValues).length) delete shared.textureSlotValues;
  }
  const other = side === 'left' ? 'right' : 'left';
  if (Object.keys(shared).length) next[other] = mergeOptions(visuals[other], shared);
  if (!visuals.visualModes) next.differentVisuals = partitionHeadUsesDifferentVisuals(visuals);
  return next;
}
