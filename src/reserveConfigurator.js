const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const structural = (part) => part.role === 'door' || part.role === 'partition';
const rotation = (value) => ((finite(value) % 360) + 360) % 360;
const clonePart = (part) => ({ id: String(part.id), type: part.type, role: part.role,
  x: finite(part.x), y: finite(part.y), z: finite(part.z), rotation: finite(part.rotation), slotId: part.slotId || '' });

export function reserveComponentRole(entry = {}) {
  const role = entry.dimensions?.reserveComponentRole;
  if (['door', 'partition', 'furniture'].includes(role)) return role;
  const label = text(`${entry.label || ''} ${entry.type || ''}`);
  if (/porte|\bdoor\b/.test(label) && !/porte.?document/.test(label)) return 'door';
  if (/cloison|partition/.test(label) && !/tete|head/.test(label)) return 'partition';
  return 'furniture';
}

function defaultChildren(entry = {}) {
  return entry.children || entry.dimensions?.children || [];
}

export function reserveCatalogEntries(entry = {}, catalog = [], includedEntry = entry) {
  const baseline = [...defaultChildren(includedEntry), ...defaultChildren(entry)];
  const allowedTypes = entry.dimensions?.reserveConfigurator?.allowedTypes;
  const allowed = Array.isArray(allowedTypes) ? new Set(allowedTypes) : null;
  const entries = new Map(baseline.map((child) => [child.type, catalog.find((asset) => asset.type === child.type) || child]));
  catalog.forEach((asset) => {
    if ((!asset.dimensions?.reserveComponentRole && !allowed?.has(asset.type)) || asset.is_active === false) return;
    if (allowed && !allowed.has(asset.type)) return;
    const variants = asset.dimensions?.isVariantGroup ? asset.dimensions.variantAssets || [] : [asset];
    variants.forEach((variant) => {
      if (variant.is_active === false || variant.isGroup || variant.dimensions?.isGroup) return;
      const candidate = { ...variant, dimensions: { ...(variant.dimensions || {}), reserveComponentRole: asset.dimensions?.reserveComponentRole || reserveComponentRole(variant) } };
      if (reserveComponentRole(candidate) !== 'furniture' && Math.abs(finite(candidate.modelSize?.[0] || candidate.dimensions?.size?.[0], 1) - 1) > 0.12) return;
      entries.set(candidate.type, candidate);
    });
  });
  return [...entries.values()];
}

export function reserveEditorAvailable(entry = {}) {
  const panels = defaultChildren(entry).filter((child) => structural({ role: reserveComponentRole(child) }));
  return entry.dimensions?.reserveConfigurator?.enabled !== false
    && panels.some((child) => reserveComponentRole(child) === 'door')
    && panels.every((child) => Math.abs(reservePartSize(child)[0] - 1) <= 0.12);
}

export function reservePartSize(part = {}, catalog = []) {
  const entry = catalog.find((candidate) => candidate.type === part.type) || part;
  const size = entry.modelSize || entry.dimensions?.size || entry.dimensions?.modelSize || [0.5, 0.8, 0.5];
  return size.map((value) => Math.max(0.02, finite(value, 0.5)));
}

export function reserveFrame(entry = {}) {
  // Imported group bounds can ignore panel rotation or include door thickness.
  const panels = defaultChildren(entry).filter((child) => structural({ role: reserveComponentRole(child) }));
  const extents = panels.flatMap((panel) => {
    const length = reservePartSize(panel)[0];
    const radians = finite(panel.rotation) * Math.PI / 180;
    const dx = Math.abs(Math.cos(radians)) * length / 2;
    const dz = Math.abs(Math.sin(radians)) * length / 2;
    return [{ x: finite(panel.x) - dx, z: finite(panel.z) - dz }, { x: finite(panel.x) + dx, z: finite(panel.z) + dz }];
  });
  const minX = extents.length ? Math.min(...extents.map((point) => point.x)) : -0.5;
  const maxX = extents.length ? Math.max(...extents.map((point) => point.x)) : 0.5;
  const minZ = extents.length ? Math.min(...extents.map((point) => point.z)) : -0.5;
  const maxZ = extents.length ? Math.max(...extents.map((point) => point.z)) : 0.5;
  const config = entry.dimensions?.reserveConfigurator || {};
  const width = Math.min(12, Math.max(1, Math.round(finite(config.width, maxX - minX))));
  const depth = Math.min(12, Math.max(1, Math.round(finite(config.depth, maxZ - minZ))));
  const centerX = finite(config.centerX, (minX + maxX) / 2);
  const centerZ = finite(config.centerZ, (minZ + maxZ) / 2);
  return { width, depth, minX: centerX - width / 2, maxX: centerX + width / 2, minZ: centerZ - depth / 2, maxZ: centerZ + depth / 2 };
}

export function reserveSlots(frame) {
  const slots = [];
  for (let index = 0; index < frame.width; index += 1) {
    slots.push({ id: `front-${index}`, edge: 'front', x: frame.minX + index + 0.5, z: frame.maxZ, rotation: 0, label: `Avant ${index + 1}` });
    slots.push({ id: `back-${index}`, edge: 'back', x: frame.minX + index + 0.5, z: frame.minZ, rotation: 180, label: `Fond ${index + 1}` });
  }
  for (let index = 0; index < frame.depth; index += 1) {
    slots.push({ id: `left-${index}`, edge: 'left', x: frame.minX, z: frame.minZ + index + 0.5, rotation: 90, label: `Gauche ${index + 1}` });
    slots.push({ id: `right-${index}`, edge: 'right', x: frame.maxX, z: frame.minZ + index + 0.5, rotation: 270, label: `Droite ${index + 1}` });
  }
  return slots;
}

function nearestSlot(slots, position) {
  return [...slots].sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z))[0];
}

function initialReserveParts(entry) {
  const slots = reserveSlots(reserveFrame(entry));
  const used = new Set();
  return defaultChildren(entry).map((child, index) => {
    const part = clonePart({ ...child, id: child.id || `reserve-base-${index}`, role: reserveComponentRole(child) });
    if (structural(part)) {
      const slot = nearestSlot(slots.filter((candidate) => !used.has(candidate.id)), part);
      part.slotId = slot?.id || '';
      if (slot) used.add(slot.id);
    }
    return part;
  });
}

function resizedFrame(base, width, depth, edges) {
  const minX = !edges.includes('left') ? base.minX : !edges.includes('right') ? base.maxX - width : (base.minX + base.maxX - width) / 2;
  const minZ = !edges.includes('back') ? base.minZ : !edges.includes('front') ? base.maxZ - depth : (base.minZ + base.maxZ - depth) / 2;
  return { width, depth, minX, maxX: minX + width, minZ, maxZ: minZ + depth };
}

export function createReserveDraft(entry = {}, customization = null, catalog = [], includedEntry = entry) {
  const baseFrame = reserveFrame(entry);
  const originalParts = initialReserveParts(entry);
  const originalSlots = originalParts.filter(structural).map((part) => part.slotId);
  const edges = [...new Set(originalSlots.map((id) => id.split('-')[0]))];
  const canResize = reserveSlots(baseFrame).filter((slot) => edges.includes(slot.edge)).every((slot) => originalSlots.includes(slot.id));
  const library = reserveCatalogEntries(entry, catalog, includedEntry);
  const types = new Map(library.map((asset) => [asset.type, asset]));
  const configured = [1, 2].includes(customization?.version) && customization.sourceType === entry.type && Array.isArray(customization.parts);
  const modular = configured && customization.version === 2;
  const size = modular ? customization.size : baseFrame;
  const validSize = size && [size.width, size.depth].every((value) => Number.isInteger(value) && value >= 1 && value <= 12)
    && (canResize || (size.width === baseFrame.width && size.depth === baseFrame.depth));
  const frame = modular && validSize ? resizedFrame(baseFrame, size.width, size.depth, edges) : baseFrame;
  const includedBaseline = initialReserveParts(includedEntry);
  const baseline = modular ? includedBaseline : originalParts;
  const parts = configured ? customization.parts.slice(0, 100).map((part, index) => clonePart({ ...part,
    id: part.id || `reserve-part-${index}`, role: reserveComponentRole(types.get(part.type) || baseline.find((child) => child.type === part.type) || part),
  })) : originalParts.map(clonePart);
  // Missing perimeter modules are existing stand walls, not editable reserve walls.
  return { version: modular ? 2 : 1, sourceType: entry.type, frame, baseFrame, originalParts, includedBaseline,
    baseline, parts, edges, canResize, invalidSize: !validSize,
    requiredSlots: modular && validSize ? reserveSlots(frame).filter((slot) => edges.includes(slot.edge)).map((slot) => slot.id) : originalSlots };
}

export function serializeReserveDraft(draft) {
  return { version: draft.version, sourceType: draft.sourceType,
    ...(draft.version === 2 ? { size: { width: draft.frame.width, depth: draft.frame.depth } } : {}), parts: draft.parts.map(clonePart) };
}

export function reserveDraftPlacementBounds(draft, bounds) {
  const minX = bounds.minX + (draft.frame.minX - draft.baseFrame.minX);
  const maxX = bounds.maxX + (draft.frame.maxX - draft.baseFrame.maxX);
  const minZ = bounds.minZ + (draft.frame.minZ - draft.baseFrame.minZ);
  const maxZ = bounds.maxZ + (draft.frame.maxZ - draft.baseFrame.maxZ);
  return { ...bounds, minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ,
    centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
}

export function resizeReserveDraft(draft, width, depth, catalog = [], limits = {}) {
  if (!draft.canResize) return { draft, error: 'Cette structure doit être préparée avec des côtés complets de modules de 1 m avant de pouvoir être redimensionnée.' };
  if (![width, depth].every((value) => Number.isInteger(value) && value >= 1 && value <= 12)
    || width > (limits.width ?? 12) || depth > (limits.depth ?? 12)) return { draft, error: 'Cette taille dépasse les dimensions disponibles dans votre stand.' };
  if (width === draft.frame.width && depth === draft.frame.depth) return { draft, error: '' };
  const frame = resizedFrame(draft.baseFrame, width, depth, draft.edges);
  const slots = reserveSlots(frame).filter((slot) => draft.edges.includes(slot.edge));
  const oldSlots = reserveSlots(draft.frame);
  const partition = catalog.find((asset) => reserveComponentRole(asset) === 'partition'
    && draft.originalParts.some((part) => part.type === asset.type)) || catalog.find((asset) => reserveComponentRole(asset) === 'partition');
  const parts = [];
  const displacedDoors = [];
  draft.parts.filter(structural).forEach((part) => {
    const target = slots.find((slot) => slot.id === part.slotId);
    const oldSlot = oldSlots.find((slot) => slot.id === part.slotId);
    if (target) parts.push({ ...part, x: target.x, z: target.z, rotation: rotation(target.rotation + (oldSlot ? rotation(part.rotation - oldSlot.rotation) : 0)) });
    else if (part.role === 'door') displacedDoors.push(part);
  });
  // Preserve doors cut off by a reduction, replacing the nearest remaining panel.
  for (const door of displacedDoors) {
    const targets = slots.filter((slot) => !parts.some((part) => part.slotId === slot.id && part.role === 'door'));
    const target = nearestSlot(targets, door);
    if (!target) return { draft, error: 'Cette réduction ne permet pas de conserver toutes les portes. Retirez une porte avant de réduire.' };
    const occupant = parts.findIndex((part) => part.slotId === target.id);
    if (occupant >= 0) parts.splice(occupant, 1);
    const oldSlot = oldSlots.find((slot) => slot.id === door.slotId);
    parts.push({ ...door, x: target.x, z: target.z, slotId: target.id, rotation: rotation(target.rotation + (oldSlot ? rotation(door.rotation - oldSlot.rotation) : 0)) });
  }
  for (const slot of slots) {
    if (parts.some((part) => part.slotId === slot.id)) continue;
    if (!partition) return { draft, error: 'Aucune cloison de 1 m disponible pour agrandir cette réserve.' };
    parts.push({ id: `reserve-part-${globalThis.crypto.randomUUID()}`, type: partition.type, role: 'partition', x: slot.x, y: 0, z: slot.z, rotation: slot.rotation, slotId: slot.id });
  }
  const next = { ...draft, version: 2, frame, baseline: draft.includedBaseline,
    parts: [...parts, ...draft.parts.filter((part) => !structural(part))], requiredSlots: slots.map((slot) => slot.id) };
  // Never silently discard or move the client's equipment to make a reduction fit.
  if (validateReserveDraft(next, catalog).length) return { draft, error: 'Déplacez ou retirez les équipements qui dépassent ou bloquent une porte avant de changer la taille.' };
  return { draft: next, error: '' };
}

function furnitureBox(part, catalog) {
  const [width, , depth] = reservePartSize(part, catalog);
  const radians = finite(part.rotation) * Math.PI / 180;
  return { halfX: (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * depth) / 2,
    halfZ: (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * depth) / 2 };
}

function furniturePosition(draft, part, position, catalog) {
  const box = furnitureBox(part, catalog);
  const frame = draft.frame;
  const margin = 0.01;
  if (box.halfX * 2 + margin * 2 > frame.width || box.halfZ * 2 + margin * 2 > frame.depth) return null;
  return { x: money(Math.min(frame.maxX - box.halfX - margin, Math.max(frame.minX + box.halfX + margin, finite(position.x)))),
    z: money(Math.min(frame.maxZ - box.halfZ - margin, Math.max(frame.minZ + box.halfZ + margin, finite(position.z)))) };
}

function furnitureCollision(draft, part, catalog) {
  const box = furnitureBox(part, catalog);
  return draft.parts.some((other) => {
    if (other.id === part.id) return false;
    if (!structural(other)) {
      if (part.y >= other.y + reservePartSize(other, catalog)[1] - 0.01 || other.y >= part.y + reservePartSize(part, catalog)[1] - 0.01) return false;
      const otherBox = furnitureBox(other, catalog);
      return Math.abs(part.x - other.x) < box.halfX + otherBox.halfX - 0.01 && Math.abs(part.z - other.z) < box.halfZ + otherBox.halfZ - 0.01;
    }
    if (other.role !== 'door') return false;
    const slot = reserveSlots(draft.frame).find((candidate) => candidate.id === other.slotId);
    if (!slot) return false;
    // Keep a clear 45 cm approach on the inside of each door.
    const vertical = slot.edge === 'left' || slot.edge === 'right';
    const inward = slot.edge === 'front' || slot.edge === 'right' ? -1 : 1;
    const centerX = other.x + (vertical ? inward * 0.225 : 0);
    const centerZ = other.z + (vertical ? 0 : inward * 0.225);
    return Math.abs(part.x - centerX) < box.halfX + (vertical ? 0.225 : 0.45)
      && Math.abs(part.z - centerZ) < box.halfZ + (vertical ? 0.45 : 0.225);
  });
}

export function moveReservePart(draft, id, position, catalog = []) {
  const part = draft.parts.find((candidate) => candidate.id === id);
  if (!part) return { draft, error: 'Objet introuvable.' };
  if (structural(part)) {
    const slot = nearestSlot(reserveSlots(draft.frame), position);
    if (!slot || !draft.requiredSlots.includes(slot.id)) return { draft, error: 'Cet emplacement correspond au mur du stand.' };
    if (slot.id === part.slotId) return { draft, error: '' };
    const occupant = draft.parts.find((candidate) => candidate.slotId === slot.id);
    const oldSlot = reserveSlots(draft.frame).find((candidate) => candidate.id === part.slotId);
    const place = (candidate, target) => ({ ...candidate, x: target.x, z: target.z, slotId: target.id,
      rotation: rotation(candidate.rotation + target.rotation - (reserveSlots(draft.frame).find((row) => row.id === candidate.slotId)?.rotation || 0)) });
    const next = { ...draft, parts: draft.parts.map((candidate) => candidate.id === id ? place(candidate, slot)
      : occupant && oldSlot && candidate.id === occupant.id ? place(candidate, oldSlot) : candidate) };
    if (next.parts.some((candidate) => !structural(candidate) && furnitureCollision(next, candidate, catalog))) return { draft, error: 'Un objet bloque le passage de la porte. Déplacez-le avant de déplacer la porte.' };
    return { draft: next, error: '' };
  }
  const elevated = { ...part, y: finite(position.y, part.y) };
  const height = reservePartSize(part, catalog)[1];
  if (elevated.y < 0 || elevated.y + height > 2.5 + 0.01) return { draft, error: 'Cet équipement doit rester entre le sol et le haut de la réserve (2,50 m).' };
  const point = furniturePosition(draft, elevated, position, catalog);
  if (!point) return { draft, error: 'Cet objet est trop grand pour cette réserve.' };
  const moved = { ...elevated, ...point };
  if (furnitureCollision(draft, moved, catalog)) return { draft, error: 'Cet emplacement chevauche un objet ou bloque le passage de la porte.' };
  return { draft: { ...draft, parts: draft.parts.map((candidate) => candidate.id === id ? moved : candidate) }, error: '' };
}

export function replaceReservePart(draft, id, type, catalog = []) {
  const part = draft.parts.find((candidate) => candidate.id === id);
  const entry = catalog.find((candidate) => candidate.type === type);
  if (!part || !entry) return { draft, error: 'Cet objet n’est pas disponible pour cette réserve.' };
  const role = reserveComponentRole(entry);
  if (structural(part) !== structural({ role })) return { draft, error: 'Choisissez une porte ou une cloison pour un emplacement de structure.' };
  const changed = { ...part, type, role };
  const next = { ...draft, parts: draft.parts.map((candidate) => candidate.id === id ? changed : candidate) };
  if (!structural(changed)) {
    const result = moveReservePart(next, id, changed, catalog);
    return result.error ? { draft, error: result.error } : result;
  }
  if (next.parts.some((candidate) => !structural(candidate) && furnitureCollision(next, candidate, catalog))) return { draft, error: 'Un objet bloque le passage de cette porte.' };
  return { draft: next, error: '' };
}

export function addReservePart(draft, type, catalog = []) {
  const entry = catalog.find((candidate) => candidate.type === type);
  if (!entry) return { draft, error: 'Cet objet n’est pas disponible pour cette réserve.' };
  const part = { id: `reserve-part-${globalThis.crypto.randomUUID()}`, type, role: reserveComponentRole(entry), x: 0, y: 0, z: 0, rotation: 0, slotId: '' };
  if (structural(part)) {
    const slot = reserveSlots(draft.frame).find((candidate) => draft.requiredSlots.includes(candidate.id) && !draft.parts.some((row) => row.slotId === candidate.id));
    if (!slot) return { draft, error: 'Tous les modules sont occupés. Sélectionnez une porte ou une cloison sur le plan pour la remplacer.' };
    return { draft: { ...draft, parts: [...draft.parts, { ...part, x: slot.x, z: slot.z, rotation: slot.rotation, slotId: slot.id }] }, error: '' };
  }
  for (let x = draft.frame.minX + 0.05; x <= draft.frame.maxX; x += 0.1) {
    for (let z = draft.frame.minZ + 0.05; z <= draft.frame.maxZ; z += 0.1) {
      const point = furniturePosition(draft, part, { x, z }, catalog);
      if (point && !furnitureCollision(draft, { ...part, ...point }, catalog)) return { draft: { ...draft, parts: [...draft.parts, { ...part, ...point }] }, error: '' };
    }
  }
  return { draft, error: 'Il n’y a pas assez de place dans cette réserve pour cet objet.' };
}

export function removeReservePart(draft, id) {
  return { ...draft, parts: draft.parts.filter((part) => part.id !== id) };
}

export function rotateReservePart(draft, id, catalog = []) {
  const part = draft.parts.find((candidate) => candidate.id === id);
  if (!part) return { draft, error: 'Objet introuvable.' };
  const changed = { ...part, rotation: rotation(part.rotation + (structural(part) ? 180 : 90)) };
  const next = { ...draft, parts: draft.parts.map((candidate) => candidate.id === id ? changed : candidate) };
  if (structural(part)) return { draft: next, error: '' };
  const result = moveReservePart(next, id, part, catalog);
  return result.error ? { draft, error: result.error } : result;
}

export function validateReserveDraft(draft, catalog = []) {
  const errors = new Set();
  const ids = new Set();
  const slots = reserveSlots(draft.frame);
  if (draft.invalidSize) errors.add('Les dimensions de la réserve sont invalides.');
  if (!draft.parts.some((part) => part.role === 'door')) errors.add('Conservez au moins une porte pour accéder à la réserve.');
  draft.requiredSlots.forEach((id) => {
    if (draft.parts.filter((part) => part.slotId === id).length !== 1) errors.add('Chaque module de structure doit contenir une porte ou une cloison.');
  });
  draft.parts.forEach((part) => {
    if (ids.has(part.id)) errors.add('Deux objets ne peuvent pas avoir le même identifiant.');
    ids.add(part.id);
    if (!catalog.some((entry) => entry.type === part.type)) errors.add('Un objet n’est plus disponible pour cette réserve.');
    if (![part.x, part.y, part.z, part.rotation].every(Number.isFinite) || part.y < 0 || (!structural(part) && part.y + reservePartSize(part, catalog)[1] > 2.51)) errors.add('La position d’un objet est invalide.');
    if (structural(part)) {
      const slot = slots.find((candidate) => candidate.id === part.slotId);
      const original = (draft.originalParts || draft.baseline).find((candidate) => candidate.id === part.id);
      const untouched = original && ['x', 'z', 'rotation', 'slotId'].every((key) => original[key] === part[key]);
      if (part.y !== (original?.y || 0)) errors.add('Les portes et cloisons doivent rester à la hauteur de la structure.');
      if (!slot || !draft.requiredSlots.includes(slot.id)) errors.add('Une porte ou une cloison est placée sur un mur du stand.');
      else if (!untouched && (Math.hypot(part.x - slot.x, part.z - slot.z) > 0.02 || rotation(part.rotation - slot.rotation) % 180 !== 0)) errors.add('Les portes et cloisons doivent respecter les modules de 1 m.');
    } else {
      const original = (draft.originalParts || draft.baseline).find((candidate) => candidate.id === part.id);
      const untouched = original && ['type', 'x', 'y', 'z', 'rotation'].every((key) => original[key] === part[key]);
      // Existing fitted accessories retain the exact admin placement until edited.
      if (untouched && draft.frame.width === (draft.baseFrame || draft.frame).width && draft.frame.depth === (draft.baseFrame || draft.frame).depth) return;
      const point = furniturePosition(draft, part, part, catalog);
      if (!point || Math.abs(point.x - part.x) > 0.02 || Math.abs(point.z - part.z) > 0.02) errors.add('Tous les équipements doivent rester à l’intérieur de la réserve.');
      if (furnitureCollision(draft, part, catalog)) errors.add('Un équipement chevauche un objet ou bloque une porte.');
    }
  });
  return [...errors];
}

export function reserveCustomizationPricingLines(entry, draft, catalog, { priceForEntry = (asset) => asset.price || 0, referenceForEntry = () => '', categoryForEntry, parentId = '' } = {}) {
  const entryFor = (type) => catalog.find((asset) => asset.type === type) || defaultChildren(entry).find((child) => child.type === type) || {};
  const credits = draft.baseline.map((part) => ({ ...part, used: false, price: Math.max(0, finite(priceForEntry(entryFor(part.type)))) }));
  const rows = draft.parts.map((part) => ({ part, credit: null }));
  // Match exact types first so replacing one variant cannot steal another object's quota.
  rows.forEach((row) => {
    const credit = credits.find((candidate) => !candidate.used && candidate.type === row.part.type);
    if (credit) { credit.used = true; row.credit = credit; }
  });
  rows.forEach((row) => {
    if (row.credit || !structural(row.part)) return;
    const credit = credits.find((candidate) => !candidate.used && candidate.role === row.part.role);
    if (credit) { credit.used = true; row.credit = credit; }
  });
  const lines = new Map();
  rows.forEach(({ part, credit }) => {
    const asset = entryFor(part.type);
    const amount = credit?.type === part.type ? 0 : money(Math.max(0, finite(priceForEntry(asset)) - finite(credit?.price)));
    if (!amount) return;
    const key = `${part.type}-${amount}`;
    const line = lines.get(key) || { type: `reserve-extra-${parentId || entry.type}-${key}`, assetType: part.type,
      label: `Réserve — ${asset.label || part.type}${credit ? ' (changement de modèle)' : ' (supplément)'}`,
      category: categoryForEntry?.(asset, part.role) || (part.role === 'furniture' ? 'furniture' : 'personalization'), quantity: 0, unitPrice: amount, total: 0,
      reference: referenceForEntry(asset), optionForItemId: parentId, thumbnailUrl: asset.thumbnailUrl || asset.thumbnail_url || '' };
    line.quantity += 1;
    line.total = money(line.quantity * amount);
    lines.set(key, line);
  });
  return [...lines.values()];
}

export function reserveChildrenFromDraft(entry, draft, catalog = []) {
  return draft.parts.map((part) => {
    const baseline = defaultChildren(entry).find((child) => child.type === part.type);
    const asset = catalog.find((candidate) => candidate.type === part.type) || baseline || {};
    return { ...baseline, ...asset, ...clonePart(part), isWallItem: false, lockedInGroup: true,
      modelUrl: asset.modelUrl || asset.model_url || baseline?.modelUrl,
      modelSize: asset.modelSize || asset.dimensions?.size || baseline?.modelSize,
      materialUrl: asset.materialUrl || asset.dimensions?.materialUrl || baseline?.materialUrl,
      dimensions: { ...(baseline?.dimensions || {}), ...(asset.dimensions || {}), reserveComponentRole: part.role },
    };
  });
}
