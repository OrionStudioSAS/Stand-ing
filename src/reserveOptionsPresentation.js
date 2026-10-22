const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Read the configured group without changing its children or their transforms.
export function reserveGroupDetails(entry = {}, item = {}, options = {}) {
  entry ||= {};
  item ||= {};
  options ||= {};
  const children = item.children || entry.children || entry.dimensions?.children || [];
  const flatten = (items) => items.flatMap((child) => {
    const nested = child.children || child.dimensions?.children;
    return nested?.length ? flatten(nested) : [child];
  });
  const leaves = flatten(children);
  const doors = leaves.filter((child) => /\bporte\b|\bdoor\b/.test(normalize(`${child.label} ${child.type}`)));
  const equipment = leaves.filter((child) => !/\b(cloison|wall|porte|door|panneau)\b/.test(normalize(`${child.label} ${child.type}`)));
  const placement = Object.hasOwn(item, 'placementRule') ? item.placementRule : entry.placementRule || entry.dimensions?.placementRule;
  const placementId = typeof placement === 'string' ? placement : placement?.id || '';
  const label = normalize(entry.label || item.label);
  const corner = /arriere\s+gauche/.test(label) ? 'back-left' : /arriere\s+droit/.test(label) ? 'back-right' : '';
  const doorLabel = normalize(doors.map((door) => door.label).join(' '));
  const handle = options.handleOrientation || item.options?.reserveHandleOrientation
    || (/(poignee|handle)\s+(gauche|left)/.test(doorLabel) ? 'left' : /(poignee|handle)\s+(droite|right)/.test(doorLabel) ? 'right' : '');
  return {
    placement: placementId || (Object.hasOwn(item, 'placementRule') ? '' : corner),
    opening: options.doorOpening || item.options?.reserveDoorOpening || '',
    handle,
    doors,
    equipment,
    equipmentCount: equipment.reduce((count, child) => count + Math.max(1, Number(child.quantity) || 1), 0),
  };
}

export function hasSignatureMeterCoverChoice(isSignature, area, item) {
  return Boolean(isSignature && Number(area) >= 9 && Number(area) < 15 && item);
}
