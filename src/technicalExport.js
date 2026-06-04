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
  wall: '#8f1d1d',
  floor: '#f4efe5',
};

const fixedWallHeight = 2.5;
const wallPanelWidth = 1;

export function exportTechnicalPng({ width, depth, layout, items, catalog }) {
  sheet.height = Math.max(1240, 1080 + items.length * 34);
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame(ctx);
  drawSidebar(ctx, width, depth, fixedWallHeight, layout, items);
  drawPlan(ctx, width, depth, layout, items, catalog);
  drawItemTable(ctx, items, catalog, width, depth);
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

  drawInfoBlock(ctx, x, y, w, [
    ['Surface', `${formatNumber(width * depth)} m2`],
    ['Hauteur murs', `${mm(height)} mm`],
    ['Implantation', layoutLabel(layout)],
    ['Objets', String(items.length)],
    ['Date export', new Date().toLocaleDateString('fr-FR')],
  ]);
  y += infoBlockHeight(5) + 18;

  y = drawWallBreakdown(ctx, x, y, w, width, depth, layout) + 18;

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

  ctx.strokeRect(x, y, w, 170);
  drawText(ctx, 'LEGENDE', x + 16, y + 32, 20, technicalColors.blue, 'bold');
  legendLine(ctx, x + 18, y + 66, technicalColors.blue, 'Cotes stand');
  legendLine(ctx, x + 18, y + 102, technicalColors.red, 'Cotes objet');
  legendSwatch(ctx, x + 18, y + 130, technicalColors.wall, 'Murs / cloisons');

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
  const wallThickness = Math.max(10, scale * 0.08);

  drawText(ctx, `${formatNumber(width * depth)}m2`, planX + planW / 2, 105, 64, technicalColors.ink, 'bold', 'center');

  const toX = (x) => planX + (x + width / 2) * scale;
  const toY = (z) => planY + (z + depth / 2) * scale;

  ctx.fillStyle = technicalColors.floor;
  ctx.fillRect(planX, planY, planW, planH);
  drawGrid(ctx, planX, planY, planW, planH, width, depth, scale);

  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(planX, planY, planW, planH);
  drawWalls(ctx, planX, planY, planW, planH, wallThickness, layout, width, depth, scale);

  drawDimension(ctx, planX, planY - 66, planX + planW, planY - 66, mm(width), 'horizontal', technicalColors.blue);
  drawDimension(ctx, planX - 64, planY, planX - 64, planY + planH, mm(depth), 'vertical', technicalColors.blue);

  items.forEach((item, index) => {
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const center = { x: toX(item.x), y: toY(item.z) };
    const color = entry?.color || '#cccccc';
    const label = `${index + 1}`;

    if (item.type === 'screen') {
      drawScreenTop(ctx, item, width, depth, scale, toX, toY, label);
      return;
    }

    drawRotatedObject(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, item.rotation || 0, color, label);
    drawObjectDimensions(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, dims, item.rotation || 0);
  });

  drawText(ctx, 'Allee', planX + planW / 2, planY + planH + 62, 58, technicalColors.ink, 'normal', 'center');
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
      entry?.label || item.type,
      `${mm(dims.width)} x ${mm(dims.depth)} x ${mm(dims.height)} mm`,
      item.type === 'screen' ? screenPositionLabel(item, width, depth) : `X ${signedMm(item.x)} / Z ${signedMm(item.z)}`,
      item.type === 'screen' ? wallLabel(item.wall) : `${Math.round(item.rotation || 0)} deg`,
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

function drawWalls(ctx, x, y, w, h, thickness, layout, width, depth, scale) {
  ctx.fillStyle = technicalColors.wall;
  ctx.fillRect(x, y - thickness / 2, w, thickness);
  drawWallPanelTicks(ctx, x, y - thickness / 2, width, scale, 'horizontal', thickness, 'Fond');
  if (layout === 'left' || layout === 'u') {
    ctx.fillRect(x - thickness / 2, y, thickness, h);
    drawWallPanelTicks(ctx, x - thickness / 2, y, depth, scale, 'vertical', thickness, 'Gauche');
  }
  if (layout === 'right' || layout === 'u') {
    ctx.fillRect(x + w - thickness / 2, y, thickness, h);
    drawWallPanelTicks(ctx, x + w - thickness / 2, y, depth, scale, 'vertical', thickness, 'Droite');
  }
}

function drawWallPanelTicks(ctx, x, y, lengthMeters, scale, orientation, thickness, label) {
  const panels = splitWallPanels(lengthMeters);
  let offset = 0;

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2;
  drawText(ctx, label, orientation === 'horizontal' ? x + 8 : x + thickness + 8, orientation === 'horizontal' ? y - 8 : y + 18, 12, technicalColors.wall, 'bold');

  panels.forEach((panel, index) => {
    const start = offset * scale;
    const end = (offset + panel.meters) * scale;
    if (orientation === 'horizontal') {
      if (index > 0) line(ctx, x + start, y, x + start, y + thickness);
      if (end - start > 42) drawText(ctx, `${panel.mm}`, x + start + (end - start) / 2, y + thickness - 5, 10, '#ffffff', 'bold', 'center');
    } else {
      if (index > 0) line(ctx, x, y + start, x + thickness, y + start);
      if (end - start > 42) {
        ctx.save();
        ctx.translate(x + thickness / 2 + 4, y + start + (end - start) / 2);
        ctx.rotate(-Math.PI / 2);
        drawText(ctx, `${panel.mm}`, 0, 0, 10, '#ffffff', 'bold', 'center');
        ctx.restore();
      }
    }
    offset += panel.meters;
  });
  ctx.restore();
}

function drawWallBreakdown(ctx, x, y, w, width, depth, layout) {
  const rows = wallRows(width, depth, layout);
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

function wallRows(width, depth, layout) {
  const rows = [{ label: `Fond ${mm(width)}mm`, summary: wallPanelSummary(width) }];
  if (layout === 'left' || layout === 'u') rows.push({ label: `Gauche ${mm(depth)}mm`, summary: wallPanelSummary(depth) });
  if (layout === 'right' || layout === 'u') rows.push({ label: `Droite ${mm(depth)}mm`, summary: wallPanelSummary(depth) });
  return rows;
}

function wallPanelSummary(lengthMeters) {
  const panels = splitWallPanels(lengthMeters);
  const full = panels.filter((panel) => panel.mm === 1000).length;
  const remainder = panels.find((panel) => panel.mm !== 1000);
  if (full && remainder) return `${full} x 1000 + ${remainder.mm} mm`;
  if (full) return `${full} x 1000 mm`;
  return `${panels[0]?.mm || 0} mm`;
}

function splitWallPanels(lengthMeters) {
  const totalMm = Math.max(0, Math.round(lengthMeters * 1000));
  const fullPanels = Math.floor(totalMm / 1000);
  const remainder = totalMm - fullPanels * 1000;
  const panels = Array.from({ length: fullPanels }, () => ({ mm: 1000, meters: wallPanelWidth }));
  if (remainder > 0) panels.push({ mm: remainder, meters: remainder / 1000 });
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

function drawScreenTop(ctx, item, width, depth, scale, toX, toY, label) {
  const screenWidth = 0.95 * scale;
  const screenDepth = 0.08 * scale;
  ctx.fillStyle = '#22364d';
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;

  if (item.wall === 'back') {
    const x = toX(item.x) - screenWidth / 2;
    const y = toY(-depth / 2) + 8;
    ctx.fillRect(x, y, screenWidth, screenDepth);
    ctx.strokeRect(x, y, screenWidth, screenDepth);
    drawDimension(ctx, x, y - 18, x + screenWidth, y - 18, '950', 'horizontal', technicalColors.red, 12);
    drawBadge(ctx, x + screenWidth / 2, y + screenDepth + 22, label);
    return;
  }

  const x = item.wall === 'left' ? toX(-width / 2) + 8 : toX(width / 2) - screenDepth - 8;
  const y = toY(item.x) - screenWidth / 2;
  ctx.fillRect(x, y, screenDepth, screenWidth);
  ctx.strokeRect(x, y, screenDepth, screenWidth);
  drawDimension(ctx, x + screenDepth + 18, y, x + screenDepth + 18, y + screenWidth, '950', 'vertical', technicalColors.red, 12);
  drawBadge(ctx, x + screenDepth + 22, y + screenWidth / 2, label);
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

function itemDimensions(item, entry) {
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
