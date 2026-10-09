const imageFields = ['imageUrl', 'imageName', 'visualPending', 'imageZoom', 'imageOffsetX', 'imageOffsetY', 'visualEnabled'];
const mainFields = ['headMainImageUrl', 'headMainImageName', 'visualPending'];
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

export function partitionHeadUsesDifferentVisuals(visuals = {}) {
  if (typeof visuals.differentVisuals === 'boolean') return visuals.differentVisuals;
  // Keep deliberately different artwork in scenes saved before the shared option existed.
  const left = visualPatch(visuals.left), right = visualPatch(visuals.right);
  const identity = (value) => value.headMainImageUrl || value.headMainImageName || value.imageUrl || value.imageName || '';
  if (identity(left) && identity(right) && identity(left) !== identity(right)) return true;
  return Object.keys({ ...left.textureSlotValues, ...right.textureSlotValues }).some((id) => {
    const a = left.textureSlotValues?.[id] || {}, b = right.textureSlotValues?.[id] || {};
    return identity(a) && identity(b) && (identity(a) !== identity(b)
      || imageFields.some((key) => key !== 'imageName' && a[key] !== b[key]));
  });
}

export function withPartitionHeadVisualMode(visuals = {}, differentVisuals = false) {
  const next = { ...visuals, differentVisuals };
  if (differentVisuals) return next;
  const left = visualPatch(visuals.left), right = visualPatch(visuals.right);
  const main = left.headMainImageUrl || left.headMainImageName || left.visualPending ? left : right;
  const common = {
    headMainImageUrl: main.headMainImageUrl || '', headMainImageName: main.headMainImageName || '',
    visualPending: Boolean(main.visualPending), textureSlotValues: {},
  };
  for (const id of Object.keys({ ...left.textureSlotValues, ...right.textureSlotValues })) {
    const a = left.textureSlotValues?.[id], b = right.textureSlotValues?.[id];
    common.textureSlotValues[id] = a?.imageUrl || a?.imageName || a?.visualPending ? a : b || a;
  }
  for (const side of ['left', 'right']) next[side] = mergeOptions(visuals[side], common);
  return next;
}

export function normalizePartitionHeadVisuals(visuals = {}) {
  return withPartitionHeadVisualMode(visuals, partitionHeadUsesDifferentVisuals(visuals));
}

export function patchPartitionHeadVisuals(visuals = {}, side, patch) {
  if (!['left', 'right'].includes(side)) return visuals;
  const differentVisuals = partitionHeadUsesDifferentVisuals(visuals);
  const next = { ...visuals, differentVisuals };
  for (const target of differentVisuals ? [side] : ['left', 'right']) {
    const options = visuals[target] || {};
    const change = typeof patch === 'function' ? patch(options) : patch || {};
    // Only artwork is shared; side-specific placement and colour options stay independent.
    next[target] = mergeOptions(options, target === side ? change : visualPatch(change));
  }
  return next;
}
