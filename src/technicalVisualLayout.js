export const technicalFrontPage = Object.freeze({
  sidebar: { x: 48, y: 348, width: 348, cardHeight: 202 },
  plan: { x: 492, y: 132, w: 1150, h: 600 },
  gallery: { x: 438, y: 840, width: 1204, height: 166, columns: 4 },
  footer: { x: 438, y: 1020, height: 184, bannerWidth: 360, notesWidth: 560, finishesWidth: 368 },
  legend: { x: 1658, y: 142, width: 94, height: 864 },
});

export const technicalVisualSections = Object.freeze([
  { number: 1, role: 'head-visual', title: 'Tête de cloison visuel' },
  { number: 2, role: 'head-text', title: 'Tête de cloison texte' },
  { number: 3, role: 'counter', title: 'Adhésif banque accueil' },
  { number: 4, role: 'hanging-sign', title: 'Viscom suspendu' },
  { number: 5, role: 'wall-banner', title: 'Bâche cloison' },
]);

export function layoutTechnicalVisuals(visuals = []) {
  const slots = technicalVisualSections.map((section) => ({ ...section, visuals: [], primary: null }));
  const extra = [];
  const mapped = [];
  let otherCount = 0;
  for (const visual of visuals) {
    const slot = slots.find((section) => section.role === visual.role);
    if (!slot) {
      const card = { ...visual, reference: `6.${++otherCount}`, occurrences: [visual] };
      extra.push(card);
      mapped.push(card);
      continue;
    }
    // Identical artwork on two heads needs one print preview, but both plan markers.
    const existing = visual.imageUrl && slot.visuals.find((card) => card.imageUrl === visual.imageUrl && card.status === visual.status && card.format === visual.format);
    if (existing) {
      existing.occurrences.push(visual);
      mapped.push({ ...visual, reference: existing.reference });
      continue;
    }
    const reference = slot.role === 'wall-banner' || slot.visuals.length ? `${slot.number}.${slot.visuals.length + 1}` : String(slot.number);
    const card = { ...visual, reference, occurrences: [visual] };
    slot.visuals.push(card);
    mapped.push(card);
    if (!slot.primary) slot.primary = card;
    else extra.push(card);
  }
  return { slots, visuals: mapped, extra };
}
