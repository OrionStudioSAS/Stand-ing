export const technicalA3 = Object.freeze({ width: 1800, height: 1800 * 297 / 420, widthMm: 420, heightMm: 297, dpi: 300, margin: 34, top: 132, bottom: 1190 });

export function wrapTechnicalPrintText(ctx, text, width, size = 16, weight = 'normal') {
  ctx.font = `${weight} ${size}px Arial`;
  return String(text || '').split(/\r?\n/).flatMap((paragraph) => {
    const lines = [];
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (!word) continue;
      if (line && ctx.measureText(`${line} ${word}`).width > width) { lines.push(line); line = ''; }
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ''; }
        line += character;
      }
      line += ' ';
    }
    lines.push(line.trimEnd());
    return lines;
  });
}

export function paginateTechnicalPrintDetails(ctx, sections, visuals) {
  const pages = [];
  let page;
  let y;
  let activeSection;
  const nextPage = () => { page = { kind: 'details', blocks: [] }; pages.push(page); y = technicalA3.top; activeSection = ''; };
  const heading = (title) => {
    if (!page || y + 104 > technicalA3.bottom) nextPage();
    if (activeSection !== title) { page.blocks.push({ kind: 'heading', title, y, height: 38 }); y += 38; activeSection = title; }
  };
  for (const section of sections) {
    for (const row of section.rows) {
      const labelLines = wrapTechnicalPrintText(ctx, row.label, 410, 16, 'bold');
      const detailLines = row.lines.flatMap((line) => wrapTechnicalPrintText(ctx, line, 1230, 16));
      const lines = Array.from({ length: Math.max(labelLines.length, detailLines.length) }, (_, i) => [labelLines[i] || '', detailLines[i] || '']);
      let offset = 0;
      while (offset < lines.length) {
        heading(section.title);
        let count = Math.floor((technicalA3.bottom - y - 22) / 22);
        if (count < 1) { nextPage(); heading(section.title); count = Math.floor((technicalA3.bottom - y - 22) / 22); }
        const slice = lines.slice(offset, offset + count);
        const height = 22 + slice.length * 22;
        page.blocks.push({ kind: 'row', y, height, lines: slice, continued: offset > 0, continuationLabel: offset > 0 ? wrapTechnicalPrintText(ctx, `(suite) ${row.label}`, 410, 16, 'bold')[0] : '' });
        y += height;
        offset += slice.length;
      }
    }
  }
  for (let i = 0; i < visuals.length; i += 2) {
    const cards = visuals.slice(i, i + 2).map((visual) => ({ ...visual, fields: [
      { lines: wrapTechnicalPrintText(ctx, `${visual.reference} - ${visual.label}`, 590, 17, 'bold'), bold: true },
      { lines: wrapTechnicalPrintText(ctx, `Emplacement : ${visual.placement}`, 590, 16) },
      { lines: wrapTechnicalPrintText(ctx, visual.status, 590, 16) },
    ] }));
    const height = Math.max(248, ...cards.map((card) => 38 + card.fields.reduce((sum, field) => sum + field.lines.length * 22 + 10, 0)));
    if (height + 38 > technicalA3.bottom - technicalA3.top) throw new Error('Description de visuel trop longue pour une page A3. Raccourcissez son nom.');
    if (!page || y + height + (activeSection === 'SIGNALETIQUE / VISUELS' ? 0 : 38) > technicalA3.bottom) nextPage();
    heading('SIGNALETIQUE / VISUELS');
    page.blocks.push({ kind: 'visuals', cards, y, height });
    y += height + 18;
  }
  return pages;
}
