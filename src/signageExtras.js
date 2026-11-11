const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function signageExtraOptions(entry = {}, options = []) {
  if (!/enseigne|hanging.sign|overhead.sign/.test(normalized(`${entry.type} ${entry.label}`))) return options;
  return options.map(option => /tournette|turntable|rotating|lumiere|eclairage|lighting/.test(normalized(option.label))
    ? { ...option, exclusiveGroup: 'signage-drive-or-lighting', required: false } : option);
}

export function normalizedExtraChoices(options = [], selected = {}) {
  const next = { ...selected };
  const chosen = new Set();
  // Prefer the rotating kit when opening a legacy combination that selected both.
  const ordered = [...options].sort((a, b) => Number(/tournette|turntable|rotating/.test(normalized(b.label))) - Number(/tournette|turntable|rotating/.test(normalized(a.label))));
  for (const option of ordered) {
    if (!option.exclusiveGroup || !next[option.id]) continue;
    if (chosen.has(option.exclusiveGroup)) next[option.id] = false;
    else chosen.add(option.exclusiveGroup);
  }
  return next;
}
