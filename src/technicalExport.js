const sheet = {
  width: 1800,
  height: 1200,
  margin: 34,
  left: 410,
};

const technicalColors = {
  ink: '#111111',
  red: '#c9161d',
  blue: '#0057a8',
  gray: '#d9d9d9',
  soft: '#f7f7f7',
  wall: '#c9161d',
  panel1000: '#c9161d',
  panel750: '#e87522',
  panel500: '#0057a8',
  panelOther: '#b8b8b8',
  reinforcement: '#7030a0',
  floor: '#f4efe5',
  footprint: '#eee5d6',
};

const fixedWallHeight = 2.5;
const wallPanelWidth = 1;
const reinforcementWidth = 1;
const wallThicknessMeters = 0.06;
const carpetFootprintOverflow = 0.2;

export function exportTechnicalPng({ width, depth, layout, items, catalog }) {
  const technicalItems = applyWallItemMetrics(flattenTechnicalItems(items, catalog), width, depth, catalog);
  sheet.height = Math.max(1240, 1080 + technicalItems.length * 34);
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame(ctx);
  drawSidebar(ctx, width, depth, fixedWallHeight, layout, technicalItems);
  drawPlan(ctx, width, depth, layout, technicalItems, catalog);
  drawItemTable(ctx, technicalItems, catalog, width, depth);
  downloadCanvas(canvas, `standing-plan-technique-${width}x${depth}m.png`);
}

function drawFrame(ctx) {
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(sheet.margin, sheet.margin, sheet.width - sheet.margin * 2, sheet.height - sheet.margin * 2);
  ctx.beginPath();
  ctx.moveTo(sheet.left, sheet.margin);
  ctx.lineTo(sheet.left, sheet.height - sheet.margin);
  ctx.stroke();
}

function drawSidebar(ctx, width, depth, height, layout, items) {
  const x = sheet.margin + 14;
  let y = sheet.margin + 12;
  const w = sheet.left - sheet.margin - 28;

  drawBox(ctx, x, y, w, 64, 'StandING', technicalColors.ink, 30);
  y += 76;
  drawBox(ctx, x, y, w, 54, 'PLAN TECHNIQUE ATELIER', technicalColors.red, 23);
  y += 66;
  drawBox(ctx, x, y, w, 54, `${mm(width)} x ${mm(depth)} mm`, technicalColors.blue, 22);
  y += 72;

  const infoRows = [
    ['Surface', `${formatNumber(width * depth)} m2`],
    ['Hauteur murs', `${mm(height)} mm`],
    ['Epaisseur murs', `${mm(wallThicknessMeters)} mm`],
    ['Implantation', layoutLabel(layout)],
    ['Objets', String(items.length)],
    ['Date export', new Date().toLocaleDateString('fr-FR')],
  ];
  drawInfoBlock(ctx, x, y, w, infoRows);
  y += infoBlockHeight(infoRows.length) + 18;

  y = drawWallBreakdown(ctx, x, y, w, width, depth, layout, items) + 18;

  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, 205);
  ctx.fillStyle = technicalColors.soft;
  ctx.fillRect(x + 1, y + 1, w - 2, 42);
  drawText(ctx, 'REPERES ATELIER', x + 16, y + 29, 20, technicalColors.blue, 'bold');
  drawText(ctx, 'Les numeros rouges du plan correspondent', x + 16, y + 78, 17);
  drawText(ctx, 'au tableau des elements.', x + 16, y + 102, 17);
  drawText(ctx, 'Cotes principales exprimees en mm.', x + 16, y + 142, 17);
  drawText(ctx, 'Origine X/Z au centre du stand.', x + 16, y + 168, 17);
  y += 224;

  ctx.strokeRect(x, y, w, 308);
  drawText(ctx, 'LEGENDE', x + 16, y + 32, 20, technicalColors.blue, 'bold');
  legendLine(ctx, x + 18, y + 66, technicalColors.blue, 'Cotes stand');
  legendLine(ctx, x + 18, y + 102, technicalColors.red, 'Cotes objet');
  legendSwatch(ctx, x + 18, y + 130, technicalColors.panel1000, 'Cloison 1000mm');
  legendSwatch(ctx, x + 18, y + 158, technicalColors.panel750, 'Cloison 750mm');
  legendSwatch(ctx, x + 18, y + 186, technicalColors.panel500, 'Cloison 500mm');
  legendSwatch(ctx, x + 18, y + 214, technicalColors.panelOther, 'Autre largeur');
  legendSwatch(ctx, x + 18, y + 242, technicalColors.reinforcement, 'Renfort TV');
  legendSwatch(ctx, x + 18, y + 270, technicalColors.footprint, 'Empreinte moquette +200mm');

  const footerY = sheet.height - sheet.margin - 86;
  ctx.strokeRect(x, footerY, w, 32);
  drawText(ctx, 'Echelle : automatique', x + 12, footerY + 22, 15);
  ctx.strokeRect(x, footerY + 42, w, 32);
  drawText(ctx, 'Generateur : StandING configurateur 3D', x + 12, footerY + 64, 15);
}

function drawPlan(ctx, width, depth, layout, items, catalog) {
  const bounds = { x: sheet.left + 58, y: 130, w: 1260, h: 760 };
  const scale = Math.min(bounds.w / (width + 1.1), bounds.h / (depth + 1.1));
  const planW = width * scale;
  const planH = depth * scale;
  const planX = bounds.x + (bounds.w - planW) / 2;
  const planY = bounds.y + (bounds.h - planH) / 2 + 30;
  const wallThickness = Math.max(8, scale * wallThicknessMeters);

  drawText(ctx, `${formatNumber(width * depth)}m2`, planX + planW / 2, 105, 64, technicalColors.ink, 'bold', 'center');

  const toX = (x) => planX + (x + width / 2) * scale;
  const toY = (z) => planY + (z + depth / 2) * scale;

  ctx.fillStyle = technicalColors.floor;
  ctx.fillRect(planX, planY, planW, planH);
  drawCarpetFootprint(ctx, planX, planY, planW, planH, layout, scale);
  drawGrid(ctx, planX, planY, planW, planH, width, depth, scale);

  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(planX, planY, planW, planH);
  drawWalls(ctx, planX, planY, planW, planH, wallThickness, layout, width, depth, scale, items);

  drawDimension(ctx, planX, planY - 66, planX + planW, planY - 66, mm(width), 'horizontal', technicalColors.blue);
  const hasSideWall = layout === 'left' || layout === 'right' || layout === 'u';
  const sideDimensionStartY = hasSideWall ? planY + wallThickness : planY;
  const sideDimensionLabel = hasSideWall ? mm(sideWallLength(depth)) : mm(depth);
  drawDimension(ctx, planX - 64, sideDimensionStartY, planX - 64, planY + planH, sideDimensionLabel, 'vertical', technicalColors.blue);

  items.forEach((item, index) => {
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const center = { x: toX(item.x), y: toY(item.z) };
    const color = item.color || entry?.color || '#cccccc';
    const label = `${index + 1}`;

    if (isWallItem(item)) {
      drawWallItemTop(ctx, item, width, depth, scale, wallThickness, toX, toY, label);
      return;
    }

    drawRotatedObject(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, item.rotation || 0, color, label);
    drawObjectDimensions(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, dims, item.rotation || 0);
  });

  drawText(ctx, 'Allee', planX + planW / 2, planY + planH + 62, 58, technicalColors.ink, 'normal', 'center');
}

function drawCarpetFootprint(ctx, planX, planY, planW, planH, layout, scale) {
  const overflow = carpetFootprintOverflow * scale;
  const tile = scale;
  const maxY = planY + planH + overflow;
  const y = maxY - tile;
  let x = planX + planW / 2 - tile / 2;

  if (layout === 'left') {
    x = planX + planW + overflow - tile;
  }

  if (layout === 'right') {
    x = planX - overflow;
  }

  ctx.save();
  ctx.fillStyle = technicalColors.footprint;
  ctx.strokeStyle = '#b8aa91';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([10, 6]);
  ctx.fillRect(x, y, tile, tile);
  ctx.strokeRect(x, y, tile, tile);
  ctx.restore();
}

function drawItemTable(ctx, items, catalog, width, depth) {
  const x = sheet.left + 18;
  const rowH = 28;
  const y = Math.max(900, sheet.height - sheet.margin - 70 - (items.length + 1) * rowH);
  const w = sheet.width - sheet.margin - x - 18;
  const headers = ['#', 'Element', 'Dimensions L x P x H', 'Position', 'Rotation / mur'];
  const cols = [48, 250, 300, 230, 260];

  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, sheet.height - sheet.margin - y - 14);
  drawText(ctx, 'DETAIL DES ELEMENTS', x + 16, y + 28, 22, technicalColors.blue, 'bold');

  let cy = y + 48;
  ctx.fillStyle = technicalColors.soft;
  ctx.fillRect(x + 10, cy, w - 20, rowH);
  ctx.strokeRect(x + 10, cy, w - 20, rowH);
  let cx = x + 16;
  headers.forEach((header, index) => {
    drawText(ctx, header, cx, cy + 19, 14, technicalColors.ink, 'bold');
    cx += cols[index];
  });
  cy += rowH;

  items.forEach((item, index) => {
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const values = [
      String(index + 1),
      item.label || entry?.label || item.type,
      `${mm(dims.width)} x ${mm(dims.depth)} x ${mm(dims.height)} mm`,
      isWallItem(item) ? screenPositionLabel(item, width, depth) : `X ${signedMm(item.x)} / Z ${signedMm(item.z)}`,
      item.type === 'screen' ? `${wallLabel(item.wall)} + renfort 1000x2500` : isWallItem(item) ? wallLabel(item.wall) : `${Math.round(item.rotation || 0)} deg`,
    ];

    ctx.strokeStyle = '#cccccc';
    ctx.strokeRect(x + 10, cy, w - 20, rowH);
    cx = x + 16;
    values.forEach((value, colIndex) => {
      drawText(ctx, value, cx, cy + 19, 13);
      cx += cols[colIndex];
    });
    cy += rowH;
  });
}

function drawWalls(ctx, x, y, w, h, thickness, layout, width, depth, scale, items) {
  ctx.fillStyle = technicalColors.panel1000;
  ctx.fillRect(x, y, w, thickness);
  drawWallPanelTicks(ctx, wallDescriptor('back', width, depth, items), x, y, scale, 'horizontal', thickness, 'Fond');
  if (layout === 'left' || layout === 'u') {
    const sideLength = sideWallLength(depth);
    ctx.fillRect(x, y + thickness, thickness, Math.max(1, sideLength * scale));
    drawWallPanelTicks(ctx, wallDescriptor('left', width, depth, items), x, y + thickness, scale, 'vertical', thickness, 'Gauche');
  }
  if (layout === 'right' || layout === 'u') {
    const sideLength = sideWallLength(depth);
    ctx.fillRect(x + w - thickness, y + thickness, thickness, Math.max(1, sideLength * scale));
    drawWallPanelTicks(ctx, wallDescriptor('right', width, depth, items), x + w - thickness, y + thickness, scale, 'vertical', thickness, 'Droite');
  }
}

function drawWallPanelTicks(ctx, wall, x, y, scale, orientation, thickness) {
  const panels = wallPanelSegments(wall);
  let offset = 0;

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2;

  panels.forEach((panel, index) => {
    const start = offset * scale;
    const end = (offset + panel.meters) * scale;
    ctx.fillStyle = panelColor(panel);
    if (orientation === 'horizontal') ctx.fillRect(x + start, y, end - start, thickness);
    else ctx.fillRect(x, y + start, thickness, end - start);
    ctx.fillStyle = '#ffffff';
    if (orientation === 'horizontal') {
      if (index > 0) line(ctx, x + start, y, x + start, y + thickness);
    } else {
      if (index > 0) line(ctx, x, y + start, x + thickness, y + start);
    }
    offset += panel.meters;
  });
  ctx.restore();

  drawPanelCallouts(ctx, wall, panels, x, y, scale, orientation, thickness);
}

function panelColor(panel) {
  if (panel.kind === 'reinforcement') return technicalColors.reinforcement;
  if (panel.mm === 1000) return technicalColors.panel1000;
  if (panel.mm === 750) return technicalColors.panel750;
  if (panel.mm === 500) return technicalColors.panel500;
  return technicalColors.panelOther;
}

function drawPanelCallouts(ctx, wall, panels, x, y, scale, orientation, thickness) {
  let offset = 0;

  panels.forEach((panel) => {
    const start = offset * scale;
    const end = (offset + panel.meters) * scale;
    const size = end - start;
    const title = panel.kind === 'reinforcement' ? 'CLOISON TRAD RENFORT' : 'CLOISON TRAD';
    const dimensions = `${panel.mm}x2500mm ht`;
    const fontSize = size < 84 ? 10 : 12;

    if (orientation === 'horizontal') {
      const cx = x + start + size / 2;
      drawText(ctx, title, cx, y - 32, fontSize, technicalColors.ink, 'bold', 'center');
      drawText(ctx, dimensions, cx, y - 15, fontSize, technicalColors.ink, 'bold', 'center');
    } else {
      const sideOffset = wall.wall === 'left' ? -34 : thickness + 34;
      ctx.save();
      ctx.translate(x + sideOffset, y + start + size / 2);
      ctx.rotate(-Math.PI / 2);
      drawText(ctx, title, 0, -6, fontSize, technicalColors.ink, 'bold', 'center');
      drawText(ctx, dimensions, 0, 11, fontSize, technicalColors.ink, 'bold', 'center');
      ctx.restore();
    }

    offset += panel.meters;
  });
}

function drawWallBreakdown(ctx, x, y, w, width, depth, layout, items) {
  const rows = wallRows(width, depth, layout, items);
  const h = 54 + rows.length * 32;
  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = technicalColors.soft;
  ctx.fillRect(x + 1, y + 1, w - 2, 42);
  drawText(ctx, 'DECOUPE CLOISONS', x + 16, y + 29, 20, technicalColors.blue, 'bold');

  rows.forEach((row, index) => {
    const rowY = y + 65 + index * 32;
    drawText(ctx, row.label, x + 14, rowY, 15, '#666666');
    drawText(ctx, row.summary, x + w - 14, rowY, 15, technicalColors.ink, 'bold', 'right');
  });

  return y + h;
}

function wallRows(width, depth, layout, items) {
  const rows = [wallSummaryRow(wallDescriptor('back', width, depth, items), 'Fond')];
  if (layout === 'left' || layout === 'u') rows.push(wallSummaryRow(wallDescriptor('left', width, depth, items), 'Gauche'));
  if (layout === 'right' || layout === 'u') rows.push(wallSummaryRow(wallDescriptor('right', width, depth, items), 'Droite'));
  return rows;
}

function wallSummaryRow(wall, label) {
  return {
    label: `${label} ${mm(wall.length)}mm`,
    summary: wallPanelSummary(wall),
  };
}

function wallPanelSummary(wall) {
  const segments = wallPanelSegments(wall);
  if (!segments.length) return '—';
  return formatPanelSegments(segments);
}

function formatPanelSegments(segments) {
  const parts = [];
  let standardRun = [];

  const flushStandardRun = () => {
    if (!standardRun.length) return;
    const full = standardRun.filter((segment) => segment.mm === 1000).length;
    const remainders = standardRun.filter((segment) => segment.mm !== 1000).map((segment) => `${segment.mm}`);
    if (full) parts.push(`${full} x 1000`);
    parts.push(...remainders);
    standardRun = [];
  };

  segments.forEach((segment) => {
    if (segment.kind === 'reinforcement') {
      flushStandardRun();
      parts.push(`renfort TV ${segment.mm}`);
    } else {
      standardRun.push(segment);
    }
  });
  flushStandardRun();

  return `${parts.join(' + ')} mm`;
}

function wallPanelSegments(wall) {
  const panels = [];
  let cursor = 0;

  wall.reinforcements.forEach((reinforcement) => {
    const start = Math.max(cursor, reinforcement.start);
    if (start > cursor) panels.push(...splitWallPanels(start - cursor));
    const length = Math.max(0, reinforcement.end - start);
    if (length > 0) panels.push({ mm: Math.round(length * 1000), meters: length, kind: 'reinforcement' });
    cursor = Math.max(cursor, reinforcement.end);
  });

  if (wall.length > cursor) panels.push(...splitWallPanels(wall.length - cursor));
  return panels;
}

function wallDescriptor(wall, width, depth, items = []) {
  const length = wall === 'back' ? width : sideWallLength(depth);
  const reinforcements = screenReinforcements(wall, width, depth, items, length);
  return { wall, length, reinforcements };
}

function screenReinforcements(wall, width, depth, items, wallLength) {
  return (items || [])
    .filter((item) => item.type === 'screen' && (item.wall || 'back') === wall)
    .map((item) => {
      const center = screenAxisOffset(item, wall, width, depth);
      const start = clampValue(center - reinforcementWidth / 2, 0, Math.max(0, wallLength - reinforcementWidth));
      const end = Math.min(wallLength, start + reinforcementWidth);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start)
    .reduce((acc, reinforcement) => {
      const previous = acc[acc.length - 1];
      if (previous && reinforcement.start < previous.end) {
        previous.end = Math.max(previous.end, reinforcement.end);
      } else {
        acc.push({ ...reinforcement });
      }
      return acc;
    }, []);
}

function screenAxisOffset(item, wall, width, depth) {
  if (wall === 'back') return clampValue(Number(item.x || 0) + width / 2, 0, width);
  return clampValue(Number(item.x || 0) + depth / 2 - wallThicknessMeters, 0, sideWallLength(depth));
}

function sideWallLength(depth) {
  return Math.max(0, depth - wallThicknessMeters);
}

function splitWallPanels(lengthMeters) {
  const totalMm = Math.max(0, Math.round(lengthMeters * 1000));
  const fullPanels = Math.floor(totalMm / 1000);
  const remainder = totalMm - fullPanels * 1000;
  const panels = Array.from({ length: fullPanels }, () => ({ mm: 1000, meters: wallPanelWidth, kind: 'standard' }));
  if (remainder > 0) panels.push({ mm: remainder, meters: remainder / 1000, kind: 'standard' });
  return panels;
}

function drawGrid(ctx, x, y, w, h, width, depth, scale) {
  ctx.strokeStyle = '#d4d4d4';
  ctx.lineWidth = 1;
  for (let meter = 1; meter < width; meter += 1) {
    const gx = x + meter * scale;
    line(ctx, gx, y, gx, y + h);
  }
  for (let meter = 1; meter < depth; meter += 1) {
    const gy = y + meter * scale;
    line(ctx, x, gy, x + w, gy);
  }
}

function drawRotatedObject(ctx, x, y, w, h, rotation, color, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.fillStyle = color;
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  drawBadge(ctx, x, y, label);
}

function drawObjectDimensions(ctx, x, y, w, h, dims, rotation) {
  if (Math.abs(rotation) > 1 || w < 34 || h < 26) return;
  drawDimension(ctx, x - w / 2, y - h / 2 - 18, x + w / 2, y - h / 2 - 18, mm(dims.width), 'horizontal', technicalColors.red, 12);
  drawDimension(ctx, x + w / 2 + 18, y - h / 2, x + w / 2 + 18, y + h / 2, mm(dims.depth), 'vertical', technicalColors.red, 12);
}

function drawWallItemTop(ctx, item, width, depth, scale, wallThickness, toX, toY, label) {
  const itemWidth = (item.type === 'poster' ? Number(item.posterWidth || 1) : 0.95) * scale;
  const itemDepth = (item.type === 'poster' ? 0.04 : 0.08) * scale;
  const wallLabelText = item.type === 'poster' ? `AFFICHE ${mm(item.posterWidth || 1)}` : tvTechnicalLabel(item);
  ctx.fillStyle = item.type === 'poster' ? '#f7f1dc' : '#22364d';
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;

  if (item.wall === 'back') {
    const x = toX(item.x) - itemWidth / 2;
    const y = toY(-depth / 2) + wallThickness + 4;
    ctx.fillRect(x, y, itemWidth, itemDepth);
    ctx.strokeRect(x, y, itemWidth, itemDepth);
    drawText(ctx, wallLabelText, x + itemWidth / 2, y + itemDepth + 42, 15, '#22364d', 'bold', 'center');
    drawBadge(ctx, x + itemWidth / 2, y + itemDepth + 22, label);
    return;
  }

  const x = item.wall === 'left' ? toX(-width / 2) + wallThickness + 4 : toX(width / 2) - wallThickness - itemDepth - 4;
  const y = toY(item.x) - itemWidth / 2;
  ctx.fillRect(x, y, itemDepth, itemWidth);
  ctx.strokeRect(x, y, itemDepth, itemWidth);
  drawSideTvLabel(ctx, wallLabelText, item.wall, x, y + itemWidth / 2, itemDepth);
  drawBadge(ctx, x + itemDepth + 22, y + itemWidth / 2, label);
}

function drawSideTvLabel(ctx, label, wall, x, y, screenDepth) {
  ctx.save();
  ctx.translate(wall === 'left' ? x + screenDepth + 44 : x - 36, y);
  ctx.rotate(-Math.PI / 2);
  drawText(ctx, label, 0, 0, 15, '#22364d', 'bold', 'center');
  ctx.restore();
}

function tvTechnicalLabel(item) {
  if (item.tvSize) return `TV ${item.tvSize}"`;
  if (item.label && /tv\\s*\\d+|\\d+\\s*["”]|pouce/i.test(item.label)) return item.label;
  return 'TV 43"';
}

function screenPositionLabel(item, width, depth) {
  if (item.wall === 'left') return `X ${signedMm(-width / 2)} / Z ${signedMm(item.x)}`;
  if (item.wall === 'right') return `X ${signedMm(width / 2)} / Z ${signedMm(item.x)}`;
  return `X ${signedMm(item.x)} / Z ${signedMm(-depth / 2)}`;
}

function drawDimension(ctx, x1, y1, x2, y2, label, orientation, color, fontSize = 15) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  line(ctx, x1, y1, x2, y2);

  const arrow = 8;
  if (orientation === 'horizontal') {
    line(ctx, x1, y1, x1 + arrow, y1 - arrow);
    line(ctx, x1, y1, x1 + arrow, y1 + arrow);
    line(ctx, x2, y2, x2 - arrow, y2 - arrow);
    line(ctx, x2, y2, x2 - arrow, y2 + arrow);
    drawText(ctx, label, (x1 + x2) / 2, y1 - 8, fontSize, color, 'normal', 'center');
  } else {
    line(ctx, x1, y1, x1 - arrow, y1 + arrow);
    line(ctx, x1, y1, x1 + arrow, y1 + arrow);
    line(ctx, x2, y2, x2 - arrow, y2 - arrow);
    line(ctx, x2, y2, x2 + arrow, y2 - arrow);
    ctx.translate(x1 - 12, (y1 + y2) / 2);
    ctx.rotate(-Math.PI / 2);
    drawText(ctx, label, 0, 0, fontSize, color, 'normal', 'center');
  }
  ctx.restore();
}

function drawBadge(ctx, x, y, label) {
  ctx.fillStyle = technicalColors.red;
  ctx.beginPath();
  ctx.arc(x, y, 17, 0, Math.PI * 2);
  ctx.fill();
  drawText(ctx, label, x, y + 6, 17, '#ffffff', 'bold', 'center');
}

function drawInfoBlock(ctx, x, y, w, rows) {
  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, infoBlockHeight(rows.length));
  rows.forEach(([key, value], index) => {
    const rowY = y + 18 + index * 38;
    drawText(ctx, key, x + 14, rowY + 18, 16, '#666666');
    drawText(ctx, value, x + w - 14, rowY + 18, 17, technicalColors.ink, 'bold', 'right');
  });
}

function infoBlockHeight(rowCount) {
  return rowCount * 38 + 16;
}

function drawBox(ctx, x, y, w, h, text, color, size) {
  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, h);
  drawText(ctx, text, x + w / 2, y + h / 2 + size / 3, size, color, 'bold', 'center');
}

function legendLine(ctx, x, y, color, label) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  line(ctx, x, y, x + 48, y);
  drawText(ctx, label, x + 64, y + 6, 16);
}

function legendSwatch(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 13, 48, 18);
  drawText(ctx, label, x + 64, y + 4, 16);
}

function flattenTechnicalItems(items, catalog) {
  return (items || []).flatMap((item) => {
    if (!item.isGroup || !item.children?.length) return [item];
    const parentRotation = Number(item.rotation || 0);
    const radians = (parentRotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const parentLabel = item.label || catalog.find((entry) => entry.type === item.type)?.label || 'Groupe';

    return item.children.map((child, index) => {
      const childCatalog = catalog.find((entry) => entry.type === child.type) || {};
      const localX = Number(child.x || 0);
      const localZ = Number(child.z || 0);
      return {
        ...child,
        id: `${item.id}-${child.id || index}`,
        label: `${parentLabel} - ${child.label || childCatalog.label || child.type}`,
        x: Number(item.x || 0) + localX * cos - localZ * sin,
        y: Number(item.y || 0) + Number(child.y || 0),
        z: Number(item.z || 0) + localX * sin + localZ * cos,
        rotation: parentRotation + Number(child.rotation || 0),
        modelUrl: child.modelUrl || childCatalog.modelUrl,
        modelSize: child.modelSize || childCatalog.modelSize,
        color: child.color || childCatalog.color,
        groupId: item.id,
        groupLabel: parentLabel,
      };
    });
  });
}

function applyWallItemMetrics(items, width, depth, catalog) {
  return items.map((item) => {
    if (item.type !== 'poster') return item;
    return {
      ...item,
      posterWidth: posterAvailableWidth(item, items, width, depth, catalog),
    };
  });
}

function isWallItem(item) {
  return ['screen', 'poster'].includes(item?.type);
}

function posterAvailableWidth(item, items, width, depth, catalog) {
  const wall = item.wall || 'back';
  const wallLength = wall === 'back' ? width : depth;
  const min = -wallLength / 2;
  const max = wallLength / 2;
  const axis = clampValue(Number(item.x || 0), min, max);
  const blockers = (items || [])
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate) => wallBlocker(candidate, wall, width, depth, catalog))
    .filter(Boolean)
    .map((blocker) => ({ min: clampValue(blocker.min, min, max), max: clampValue(blocker.max, min, max) }))
    .filter((blocker) => blocker.max > blocker.min)
    .sort((a, b) => a.min - b.min);
  const segments = [];
  let cursor = min;
  blockers.forEach((blocker) => {
    if (blocker.min > cursor) segments.push({ min: cursor, max: blocker.min });
    cursor = Math.max(cursor, blocker.max);
  });
  if (cursor < max) segments.push({ min: cursor, max });
  const containing = segments.find((segment) => axis >= segment.min && axis <= segment.max);
  const nearest = containing || segments.sort((a, b) => Math.abs(axis - (a.min + a.max) / 2) - Math.abs(axis - (b.min + b.max) / 2))[0] || { min, max };
  return Math.max(0.5, Number((nearest.max - nearest.min - 0.2).toFixed(2)));
}

function wallBlocker(item, wall, width, depth, catalog) {
  if (isWallItem(item)) {
    if ((item.wall || 'back') !== wall) return null;
    const axis = Number(item.x || 0);
    const itemWidth = item.type === 'screen' ? 0.95 : Number(item.posterWidth || 1);
    return { min: axis - itemWidth / 2 - 0.1, max: axis + itemWidth / 2 + 0.1 };
  }

  const entry = catalog.find((candidate) => candidate.type === item.type);
  const dims = itemDimensions(item, entry);
  const minX = Number(item.x || 0) - dims.width / 2;
  const maxX = Number(item.x || 0) + dims.width / 2;
  const minZ = Number(item.z || 0) - dims.depth / 2;
  const maxZ = Number(item.z || 0) + dims.depth / 2;
  const wallZone = 0.72;

  if (wall === 'back' && minZ <= -depth / 2 + wallZone) return { min: minX - 0.1, max: maxX + 0.1 };
  if (wall === 'left' && minX <= -width / 2 + wallZone) return { min: minZ - 0.1, max: maxZ + 0.1 };
  if (wall === 'right' && maxX >= width / 2 - wallZone) return { min: minZ - 0.1, max: maxZ + 0.1 };
  return null;
}

function itemDimensions(item, entry) {
  if (item?.type === 'poster') {
    return { width: Number(item.posterWidth || 1), depth: 0.04, height: Number(item.posterHeight || 1.25) };
  }

  if (item?.modelSize?.length >= 3) {
    return {
      width: Number(item.modelSize[0]) || 0.6,
      depth: Number(item.modelSize[2]) || 0.6,
      height: Number(item.modelSize[1]) || 0.6,
    };
  }

  if (entry?.modelSize) {
    return {
      width: entry.modelSize[0],
      depth: entry.modelSize[2],
      height: entry.modelSize[1],
    };
  }

  const defaults = {
    chair: { width: 0.52, depth: 0.5, height: 0.85 },
    table: { width: 0.96, depth: 0.96, height: 0.62 },
    screen: { width: 0.95, depth: 0.06, height: 0.58 },
    counter: { width: 1.15, depth: 0.5, height: 1.01 },
  };

  return defaults[item.type] || { width: 0.6, depth: 0.6, height: 0.6 };
}

function drawText(ctx, text, x, y, size, color = technicalColors.ink, weight = 'normal', align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function mm(meters) {
  return String(Math.round(meters * 1000));
}

function signedMm(meters) {
  const value = Math.round(meters * 1000);
  return `${value > 0 ? '+' : ''}${value} mm`;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function layoutLabel(layout) {
  if (layout === 'left') return 'Arriere gauche';
  if (layout === 'back') return 'Arriere';
  if (layout === 'right') return 'Arriere droite';
  return 'U';
}

function wallLabel(wall) {
  if (wall === 'left') return 'Mur gauche';
  if (wall === 'right') return 'Mur droit';
  return 'Mur fond';
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
