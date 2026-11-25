import { normalizeHexColor, recoloredImageCacheKey, recolorImageUrl, sampleImageColor } from './imageColorReplacement.js';
import { normalizeBatElectricalPicto, normalizeBatElectricalPictos, electricalPictoPoint } from './batElectricalPicto.js';
import { includedCounterPowerItems } from './includedCounterPower.js';
import { technicalRiggingCoordinates, technicalSignRiggingPoints } from './technicalRigging.js';
import { isSignatureLedArch } from './signatureArchVariants.js';
import { createTechnicalSvgContext, sanitizeTechnicalSvg } from './technicalSvgContext.js';
import { technicalA3, wrapTechnicalPrintText } from './technicalPrintLayout.js';
import { normalizeTechnicalPlanEdits } from './technicalPlanEdits.js';
import { groupStructuralAsset } from './groupPlacement.js';
import { layoutTechnicalVisuals, technicalFrontPage } from './technicalVisualLayout.js';

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
const technicalTableY = 1040;
// A 2.75x backing canvas produces roughly 300 dpi on an A3 landscape print
// while preserving the existing logical layout dimensions.
const technicalRenderScale = 2.75;

// Legacy raster preview only; downloads and email attachments use the A3 PDF.
export function renderTechnicalPlanCanvas({ width, depth, layout, items, catalog, technicalItems: providedTechnicalItems = null, pictoImages = new Map(), documentInfo = {} }) {
  const technicalItems = providedTechnicalItems || technicalItemsForPlan(items, width, depth, catalog);
  const floor = technicalFloorContext(providedTechnicalItems || items, catalog, depth);
  const drawableTechnicalItems = technicalItems.filter((item) => !item?.sourceOptions);
  const sections = technicalTableSections(technicalItems, catalog);
  const rigging = technicalRiggingSection(drawableTechnicalItems, catalog, width, depth, layout);
  if (rigging) sections.unshift(rigging);
  const visuals = technicalPlanVisuals(technicalItems, catalog, width, depth);
  const constraints = technicalItems.find((item) => item?.sourceOptions)?.sourceConstraints || [];
  const tableHeight = technicalTableHeight(sections);
  const galleryHeight = visuals.length ? 70 + Math.ceil(visuals.length / 2) * 240 : 0;
  const canvas = document.createElement('canvas');
  const measureContext = canvas.getContext('2d');
  const sidebarWidth = sheet.left - sheet.margin - 28;
  const breakdownRows = technicalWallBreakdownRows(measureContext, sidebarWidth, width, depth, layout, drawableTechnicalItems);
  // Keep both the variable-length sidebar and the visual gallery inside the sheet.
  sheet.height = Math.max(1240, 1210 + technicalWallBreakdownHeight(breakdownRows), technicalTableY + tableHeight + galleryHeight + sheet.margin + 30);
  canvas.width = Math.round(sheet.width * technicalRenderScale);
  canvas.height = Math.round(sheet.height * technicalRenderScale);
  const ctx = canvas.getContext('2d');
  ctx.scale(technicalRenderScale, technicalRenderScale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  drawFrame(ctx);
  drawSidebar(ctx, width, depth, fixedWallHeight, layout, drawableTechnicalItems, floor);
  drawPlan(ctx, width, depth, layout, drawableTechnicalItems, catalog, pictoImages, visuals, constraints, false, {}, floor, documentInfo);
  drawItemTable(ctx, sections);
  drawVisualGallery(ctx, visuals, pictoImages, technicalTableY + tableHeight + 20);
  return canvas;
}

export async function createTechnicalPlanBlob(options, svg = null) {
  const page = svg || await createTechnicalPlanSvg(options);
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  pdf.setProperties({ title: `BAT - ${options.documentInfo?.title || 'Plan technique'}`, subject: 'Plan technique A3', creator: 'Stand-ING' });
  await pdf.svg(page, { x: 0, y: 0, width: technicalA3.widthMm, height: technicalA3.heightMm });
  return pdf.output('blob');
}

export async function createTechnicalPlanSvgPages(options) {
  return [await createTechnicalPlanSvg(options)];
}

export async function createTechnicalPlanSvg({ width, depth, layout, items, catalog, documentInfo = {}, batEdits = {} }) {
  const edits = normalizeTechnicalPlanEdits(batEdits);
  const technicalItems = technicalItemsForPlan(items, width, depth, catalog);
  const floor = technicalFloorContext(items, catalog, depth);
  const extraItems = edits.extras.filter((item) => item.page === 0).map((extra) => ({ ...extra, dimensions: catalog.find((entry) => entry.type === extra.type)?.dimensions }));
  const pictoImages = await loadTechnicalPictoImages([...technicalItems, ...extraItems], catalog);
  const drawable = technicalItems.filter((item) => !item?.sourceOptions);
  const sections = technicalTableSections(technicalItems, catalog);
  const rigging = technicalRiggingSection(drawable, catalog, width, depth, layout, edits);
  const visuals = technicalPlanVisuals(technicalItems, catalog, width, depth);
  const constraints = technicalItems.find((item) => item?.sourceOptions)?.sourceConstraints || [];
  const visualLayout = layoutTechnicalVisuals(visuals);
  const ctx = createTechnicalSvgContext(technicalA3.width, technicalA3.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, technicalA3.width, technicalA3.height);
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(technicalA3.margin, technicalA3.margin, technicalA3.width - 2 * technicalA3.margin, technicalA3.height - 2 * technicalA3.margin);
  drawPrintProductionSidebar(ctx, documentInfo, visualLayout.slots, pictoImages);
  drawPlan(ctx, width, depth, layout, drawable, catalog, pictoImages, visualLayout.visuals, constraints, true, edits, floor, documentInfo);
  drawPrintVisualStrip(ctx, visualLayout.extra, pictoImages);
  drawPrintProductionFooter(ctx, visualLayout.slots[4], sections, technicalItems, floor, pictoImages, rigging);
  drawPrintProductionLegend(ctx, drawable, catalog, pictoImages);
  drawPrintPageHeader(ctx, documentInfo);
  drawText(ctx, 'BAT - A3 paysage - Imprimer a 100 % / taille reelle', technicalA3.margin + 16, technicalA3.height - 48, 15, '#555555');
  drawText(ctx, 'Page 1 / 1', technicalA3.width - technicalA3.margin - 16, technicalA3.height - 48, 16, technicalColors.ink, 'bold', 'right');
  drawTechnicalPlanEdits(ctx, edits, 0, catalog, pictoImages);
  return ctx.svg;
}

function drawTechnicalPlanEdits(ctx, edits, page, catalog, images) {
  edits.extras.filter((item) => item.page === page).forEach((item) => {
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const image = technicalPictoImageForItem(item, entry, images, catalog);
    if (!image) return;
    ctx.beginObject(item.id, 'extra', {}, entry?.label || 'Picto');
    drawRotatedContainedImage(ctx, image, (item.x - item.width / 2) * technicalA3.width,
      (item.y - item.height / 2) * technicalA3.height, item.width * technicalA3.width, item.height * technicalA3.height, item.rotation * Math.PI / 180);
    ctx.endObject();
  });
  edits.annotations.filter((item) => item.page === page).forEach((item) => {
    ctx.beginObject(item.id, 'annotation', {}, 'Annotation');
    const lines = wrapTechnicalPrintText(ctx, item.text, Math.max(80, (0.97 - item.x) * technicalA3.width), item.size);
    lines.forEach((line, index) => drawText(ctx, line, item.x * technicalA3.width, item.y * technicalA3.height + index * item.size * 1.25, item.size, technicalColors.blue));
    ctx.endObject();
  });
}

export async function exportTechnicalPdf(options, svg) {
  const blob = await createTechnicalPlanBlob(options, svg);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `standing-plan-technique-${options.width}x${options.depth}m-A3.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function technicalItemsForPlan(items, width, depth, catalog) {
  return applyWallItemMetrics(flattenTechnicalItems([...(items || []), ...includedCounterPowerItems(items, catalog)], catalog), width, depth, catalog);
}

async function loadTechnicalPictoImages(items = [], catalog = []) {
  const imageRequests = new Map();
  (items || []).forEach((item) => {
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const descriptor = technicalSvgPictoDescriptor(item, entry, catalog);
    if (descriptor) imageRequests.set(descriptor.key, { ...descriptor, isPicto: true });
    descriptor?.electricalPictos.forEach(icon => imageRequests.set(icon.url, { key: icon.url, url: icon.url, isPicto: true }));
  });
  technicalPlanVisuals(items, catalog).forEach((visual) => {
    if (visual.imageUrl && !imageRequests.has(visual.imageUrl)) imageRequests.set(visual.imageUrl, { key: visual.imageUrl, url: visual.imageUrl, sourceColor: '', targetColor: '' });
  });
  const loaded = await Promise.all([...imageRequests.values()].map(async (request) => {
    let targetColor = request.targetColor;
    if (request.sourceColor && request.targetImageUrl) {
      try { targetColor = await sampleImageColor(request.targetImageUrl); }
      catch (cause) { throw new Error('Impossible de lire la texture de couleur d’un objet pour le BAT. Réessayez après avoir vérifié son image de finition.', { cause }); }
    }
    const imageUrl = request.sourceColor && targetColor
      ? await recolorImageUrl(request.url, request.sourceColor, targetColor)
      : request.url;
    let image = await loadCanvasImage(imageUrl);
    if (!image && request.isPicto) throw new Error('Impossible de charger un picto BAT. Verifiez le fichier importe puis relancez le BAT.');
    return [request.key, image];
  }));
  return new Map(loaded.filter(([, image]) => image));
}

function technicalPictoImageForItem(item, entry, pictoImages, catalog = []) {
  const descriptor = technicalSvgPictoDescriptor(item, entry, catalog);
  return descriptor ? pictoImages.get(descriptor.key) || null : null;
}

function technicalSvgPictoUrl(item = {}, entry = {}, catalog = []) {
  return technicalSvgPictoDescriptor(item, entry, catalog)?.url || '';
}

function technicalSvgPictoDescriptor(item = {}, entry = {}, catalog = []) {
  const groupEntry = technicalOverrideGroupEntry(item, catalog) || (entry?.dimensions?.isVariantGroup ? entry : null);
  const variantType = item.options?.variantAssetType || (groupEntry && item.type === groupEntry.type
    ? groupEntry.dimensions?.variantAssets?.[0]?.type || groupEntry.dimensions?.variantAssetTypes?.[0]
    : item.type);
  const variantEntry = catalog.find((candidate) => candidate.type === variantType)
    || groupEntry?.dimensions?.variantAssets?.find((candidate) => candidate.type === variantType);
  const variantMeta = groupEntry?.dimensions?.variantMeta?.[variantType] || groupEntry?.dimensions?.variantBatPictos?.[variantType] || {};
  const sources = [{
    batPictoUrl: item.options?.variantBatPictoUrl,
    batPictoPath: item.options?.variantBatPictoPath,
    batPictoReplaceColor: item.options?.variantBatPictoReplaceColor || undefined,
  }, variantMeta, groupEntry?.dimensions, item.options, variantEntry?.dimensions, entry?.dimensions, item.dimensions].filter(Boolean);
  const picto = sources.find((source) => source.batPictoUrl);
  const url = picto?.batPictoUrl || '';
  if (!url) return null;
  // A color rule belongs to its SVG, not to an unrelated variant override.
  const rule = sources.find((source, index) => {
    const inheritedUrl = source.batPictoUrl || sources.slice(index + 1).find((parent) => parent.batPictoUrl)?.batPictoUrl;
    return inheritedUrl === url && source.batPictoReplaceColor != null;
  });
  const sourceColor = normalizeHexColor(rule?.batPictoReplaceColor);
  const selectedColors = Object.values(item.options?.variantColorSelections || {});
  const textureColors = Object.values(item.options?.textureSlotValues || {}).map((value) => value?.color);
  const counterText = [item.type, item.label, variantEntry?.label, entry?.label].join(' ').toLowerCase();
  const isReceptionCounter = /(?:banque|comptoir).*accueil/.test(counterText);
  const counterFinish = isReceptionCounter ? technicalReceptionCounterFinish(item, variantEntry || entry) : null;
  // Imported palette HEX values can be grey placeholders; 3D uses the finish image instead.
  const targetColor = counterFinish?.color || [item.options?.signatureArchColorHex, item.options?.variantColorTargetHex,
    ...selectedColors.map((color) => color?.hex || color?.color || color?.value),
    item.options?.binary2Color,
    ...textureColors,
    item.color, variantEntry?.color, entry?.color,
  ].map((color) => normalizeHexColor(color)).find(Boolean) || '';
  const targetImageUrl = sourceColor ? counterFinish?.image || '' : '';
  const electricalPictos = normalizeBatElectricalPictos(sources.find((source) => Array.isArray(source.batElectricalPictos) || source.batElectricalPictoUrl) || {});
  const electrical = electricalPictos[0] || normalizeBatElectricalPicto();
  const colorKey = sourceColor && targetColor ? recoloredImageCacheKey(url, sourceColor, targetColor) : url;
  const baseKey = targetImageUrl ? `${colorKey}|finish-image:${targetImageUrl}` : colorKey;
  const key = electricalPictos.length ? `${baseKey}|electric:${JSON.stringify(electricalPictos)}` : baseKey;
  // These models have their doors on local -Z, while their BAT drawings put the doors at the bottom.
  const rotationOffset = /^asset-banque-accueil-(?:bois-(?:1|1-5|2)m|blanc-0-5m)-signa(?:-|$)/.test(variantType || '') ? 180 : 0;
  return { key, url, sourceColor, targetColor, targetImageUrl, electrical, electricalPictos, rotationOffset };
}

function technicalReceptionCounterFinish(item = {}, entry = {}) {
  const options = item.options || {};
  const rawSlots = item.dimensions?.textureSlots || entry.dimensions?.textureSlots;
  const slots = Array.isArray(rawSlots) ? rawSlots : [];
  for (const slot of slots) {
    const value = options.textureSlotValues?.[slot.id];
    if (slot.kind === 'color' && value && (value.colorImage || normalizeHexColor(value.color))) {
      return { color: normalizeHexColor(value.color) || '#c49b63', image: value.colorImage || '' };
    }
  }
  if (options.binary2ColorImage || normalizeHexColor(options.binary2Color)) {
    return { color: normalizeHexColor(options.binary2Color) || '#c49b63', image: options.binary2ColorImage || '' };
  }
  // Without a live finish override, the renderer keeps the model's original wood (or white).
  // variantColorSelections alone is a modal selection, not an applied 3D material.
  const whiteModel = /\bblanc\b/.test(`${item.label || ''} ${entry.label || ''}`.toLowerCase());
  return { color: whiteModel ? '#ffffff' : '#c49b63', image: '' };
}

function technicalOverrideGroupEntry(item = {}, catalog = []) {
  const groupType = item.options?.variantGroupType || item.options?.groupType || item.groupType || '';
  return groupType ? catalog.find((entry) => entry.type === groupType) || null : null;
}

function technicalBatDescription(item = {}, entry = {}, catalog = []) {
  const groupEntry = technicalOverrideGroupEntry(item, catalog);
  return item.options?.variantBatDescription
    || groupEntry?.dimensions?.batDescription
    || item.dimensions?.batDescription
    || entry?.dimensions?.batDescription
    || '';
}

async function loadCanvasImage(url) {
  let isSvg = /\.svg(?:$|[?#])/i.test(url) || /^data:image\/svg\+xml/i.test(url);
  try {
    const response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(20000) });
    if (response.ok) {
      let blob = await response.blob();
      let svg = null;
      isSvg ||= /svg/i.test(blob.type);
      if (isSvg) {
        svg = sanitizeTechnicalSvg(await blob.text());
        blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = await loadImageElement(objectUrl);
        if (image) {
          image.technicalSvg = svg;
          image.technicalDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
          });
          return image;
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch {
    // Fallback to direct image loading below when the storage URL is already canvas-safe.
  }
  // Never silently rasterize an SVG that could not be parsed or sanitized.
  if (isSvg) return null;
  return loadImageElement(url);
}

function loadImageElement(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 15000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
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

function drawPrintPageHeader(ctx, info) {
  const x = sheet.left + 58;
  drawText(ctx, 'PLAN D’IMPLANTATION', x, 66, 25, technicalColors.ink, 'bold');
  const details = [info.salon, info.hall && `Hall ${info.hall}`, info.stand && `Stand ${info.stand}`].filter(Boolean).join(' - ');
  drawText(ctx, details || 'Vue de dessus - cotes en millimetres', x, 116, 16, '#555555');
}

function drawPrintProductionSidebar(ctx, info, slots, imageMap) {
  const { x, y, width, cardHeight } = technicalFrontPage.sidebar;
  ctx.strokeStyle = technicalColors.ink; ctx.lineWidth = 1;
  line(ctx, sheet.left, sheet.margin, sheet.left, technicalA3.bottom + 18);
  ctx.strokeRect(x, 48, width, 92);
  wrappedProductionText(ctx, info.title || 'Stand', width - 24, 24, 'bold', 2)
    .forEach((text, index) => drawText(ctx, text, x + width / 2, 85 + index * 28, 24, technicalColors.red, 'bold', 'center'));
  ctx.strokeRect(x, 150, width / 2 - 4, 48);
  ctx.strokeRect(x + width / 2 + 4, 150, width / 2 - 4, 48);
  drawText(ctx, info.hall ? `HALL ${info.hall}` : 'HALL —', x + width / 4 - 2, 180, 19, technicalColors.red, 'bold', 'center');
  drawText(ctx, info.stand || 'STAND —', x + width * .75 + 2, 180, 19, technicalColors.red, 'bold', 'center');
  ctx.strokeRect(x, 208, width, 78);
  drawText(ctx, 'Stand·ING', x + 12, 240, 27, technicalColors.ink, 'bold');
  wrappedProductionText(ctx, info.salon || 'Salon non renseigné', width - 24, 15, 'normal', 2)
    .forEach((text, index) => drawText(ctx, text, x + 12, 264 + index * 16, 15, '#555555'));
  ctx.fillStyle = technicalColors.red;
  ctx.fillRect(x, 298, width, 38);
  drawText(ctx, info.pack ? `FORMULE ${String(info.pack).toLocaleUpperCase('fr-FR')}` : 'CONFIGURATION DU STAND', x + width / 2, 323, 19, '#ffffff', 'bold', 'center');
  slots.slice(0, 4).forEach((slot, index) => drawPrintArtworkCard(ctx, slot, imageMap, x, y + index * cardHeight, width, cardHeight));
  ctx.strokeRect(x, 1170, width, 34);
  drawText(ctx, 'Échelle automatique - cotes faisant foi', x + width / 2, 1192, 13, technicalColors.ink, 'normal', 'center');
}

function drawPrintArtworkCard(ctx, slot, imageMap, x, y, width, height) {
  ctx.strokeStyle = technicalColors.ink; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  const previousRole = ctx.textRole;
  ctx.textRole = 'visual-slot-title';
  wrappedProductionText(ctx, `${slot.number} - ${slot.title}`, width - 24, 18, 'bold', 2)
    .forEach((text, index) => drawText(ctx, text, x + 12, y + 26 + index * 21, 18, technicalColors.red, 'bold'));
  ctx.textRole = previousRole;
  const visual = slot.primary;
  const box = { x: x + width - 166, y: y + 60, w: 148, h: Math.min(126, height - 76) };
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  if (!visual) {
    drawText(ctx, 'NON', box.x + box.w / 2, box.y + box.h / 2 + 12, 34, '#f4b574', 'bold', 'center');
    return;
  }
  const image = imageMap.get(visual.imageUrl);
  if (image) drawContainedImage(ctx, image, box.x + 5, box.y + 5, box.w - 10, box.h - 10);
  else {
    const lines = visual.imageUrl ? ['APERÇU', 'INDISPONIBLE'] : ['À FOURNIR'];
    lines.forEach((text, index) => drawText(ctx, text, box.x + box.w / 2, box.y + box.h / 2 + index * 18, 15, '#956200', 'bold', 'center'));
  }
  const textWidth = width - 192;
  const lines = [visual.format, `${visual.occurrences.length} emplacement${visual.occurrences.length > 1 ? 's' : ''}`,
    visual.imageUrl ? 'Visuel enregistré' : 'Visuel en attente', slot.visuals.length > 1 ? `${slot.visuals.length - 1} autre(s) visuel(s) sous le plan` : ''];
  const maxLines = Math.floor((height - 84) / 16) + 1;
  wrappedProductionText(ctx, lines.filter(Boolean).join('\n'), textWidth, 13, 'normal', maxLines)
    .forEach((text, index) => drawText(ctx, text, x + 12, y + 74 + index * 16, 13));
  if (slot.role === 'wall-banner') drawPrintVisualBadge(ctx, visual.reference, box.x + box.w, box.y);
}

function wrappedProductionText(ctx, text, width, size, weight, maxLines) {
  const lines = wrapTechnicalPrintText(ctx, text, width, size, weight);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].trimEnd().slice(0, -2)}…`;
  return visible;
}

function drawPrintVisualBadge(ctx, reference, x, y, radius = 15) {
  ctx.fillStyle = '#ffdaa8'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  const previousRole = ctx.textRole;
  ctx.textRole = 'banner-preview-reference';
  drawText(ctx, reference, x, y + radius / 3, Math.min(14, radius), technicalColors.ink, 'bold', 'center');
  ctx.textRole = previousRole;
}

function drawPrintVisualStrip(ctx, visuals, imageMap) {
  const { x, y, width, height, columns: baseColumns } = technicalFrontPage.gallery;
  const columns = visuals.length <= baseColumns ? baseColumns : Math.max(baseColumns + 1, Math.ceil(Math.sqrt(visuals.length * width / (height * 1.6))));
  const rows = Math.max(1, Math.ceil(visuals.length / columns));
  const gap = rows === 1 ? 12 : 6;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = (height - gap * (rows - 1)) / rows;
  const textSize = rows === 1 ? 13 : 10;
  const padding = rows === 1 ? 10 : 5;
  const badgeRadius = rows === 1 ? 15 : 11;
  visuals.forEach((visual, index) => {
    const cx = x + (index % columns) * (cardWidth + gap);
    const cy = y + Math.floor(index / columns) * (cardHeight + gap);
    const image = imageMap.get(visual.imageUrl);
    ctx.strokeStyle = '#cccccc'; ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, cardWidth, cardHeight);
    if (image) drawContainedImage(ctx, image, cx + padding, cy + padding, cardWidth - 2 * padding, cardHeight - 3 * padding - textSize);
    else wrappedProductionText(ctx, visual.imageUrl ? 'Aperçu indisponible' : 'Visuel à fournir', cardWidth - 2 * padding, textSize, 'normal', 2)
      .forEach((text, lineIndex) => drawText(ctx, text, cx + cardWidth / 2, cy + cardHeight / 2 + lineIndex * (textSize + 1), textSize, '#956200', 'normal', 'center'));
    if (visual.role === 'wall-banner') drawPrintVisualBadge(ctx, visual.reference, cx + cardWidth - badgeRadius - 3, cy + badgeRadius + 1, badgeRadius);
    wrappedProductionText(ctx, visual.format || visual.label, cardWidth - 2 * padding, textSize, 'normal', rows === 1 ? 2 : 1)
      .forEach((text, lineIndex) => drawText(ctx, text, cx + padding, cy + cardHeight - padding - (rows === 1 ? 11 : 0) + lineIndex * 14, textSize));
  });
}

function drawPrintProductionFooter(ctx, banner, sections, items, floor, imageMap, rigging) {
  const { x, y, height, bannerWidth, notesWidth, finishesWidth } = technicalFrontPage.footer;
  drawPrintArtworkCard(ctx, banner, imageMap, x, y, bannerWidth, height);
  const notesX = x + bannerWidth + 12;
  ctx.strokeStyle = technicalColors.ink; ctx.strokeRect(notesX, y, notesWidth, height);
  drawText(ctx, '6 - AMCO / ÉQUIPEMENTS', notesX + 12, y + 26, 18, technicalColors.red, 'bold');
  const equipment = sections.find((section) => section.id === 'amco')?.rows || [];
  const notesColumnWidth = rigging ? notesWidth * .52 : notesWidth;
  let textY = y + 54;
  for (const row of equipment.slice(0, 4)) {
    const lines = wrappedProductionText(ctx, row.label.replace(/^\d+\.\s*/, ''), notesColumnWidth - 24, 14, 'bold', 2);
    lines.forEach((text, index) => drawText(ctx, text, notesX + 12, textY + index * 16, 14, technicalColors.ink, 'bold'));
    textY += 16 * lines.length + 4;
  }
  if (rigging) {
    const riggingX = notesX + notesColumnWidth;
    ctx.strokeStyle = technicalColors.ink; line(ctx, riggingX, y, riggingX, y + height);
    drawText(ctx, 'ÉLINGUES - X/Y (mm)', riggingX + 12, y + 26, 15, technicalColors.red, 'bold');
    rigging.rows.slice(0, 8).forEach(({ id, coords }, index) => {
      const axis = (value, reference) => `${value} ${reference.replace(/^mur (?:du )?|^bord /, '')}`;
      drawText(ctx, `${id} · X ${axis(coords.xMm, coords.xReference)} · Y ${axis(coords.yMm, coords.yReference)}`, riggingX + 12, y + 47 + index * 17, 12);
    });
  }
  const colorsX = notesX + notesWidth + 12;
  ctx.strokeRect(colorsX, y, finishesWidth, height);
  const options = items.find((item) => item?.sourceOptions)?.sourceOptions || {};
  const footprint = floor.footprints?.[0];
  const colors = [
    ['Empreinte moquette', footprint?.color || options.carpetFootprintColorHex, footprint?.colorName || [options.carpetFootprintColorName, options.carpetFootprintColorCode].filter(Boolean).join(' '), floor.signature ? !footprint : floor.footprintEnabled === false],
    ['Moquette', options.carpetColorHex, [options.carpetColorName, options.carpetColorCode].filter(Boolean).join(' ')],
    ['Coton cloison', options.wallFabricColorHex, [options.wallFabricColorName, options.wallFabricColorCode].filter(Boolean).join(' ')],
  ];
  colors.forEach(([label, color, name, absent], index) => {
    const cy = y + 17 + index * 54;
    ctx.fillStyle = absent ? '#ffffff' : normalizeHexColor(color) || '#ffffff';
    ctx.fillRect(colorsX + 14, cy, 28, 28); ctx.strokeStyle = technicalColors.ink; ctx.strokeRect(colorsX + 14, cy, 28, 28);
    if (absent) { ctx.strokeStyle = technicalColors.red; line(ctx, colorsX + 14, cy, colorsX + 42, cy + 28); line(ctx, colorsX + 42, cy, colorsX + 14, cy + 28); }
    drawText(ctx, label, colorsX + 54, cy + 10, 13, '#555555');
    wrappedProductionText(ctx, absent ? 'NON' : name || 'Non renseigné', finishesWidth - 66, 14, 'bold', 2)
      .forEach((text, lineIndex) => drawText(ctx, text, colorsX + 54, cy + 29 + lineIndex * 14, 14, technicalColors.ink, 'bold'));
  });
}

function drawPrintProductionLegend(ctx, items, catalog, imageMap) {
  const { x, y, width, height } = technicalFrontPage.legend;
  ctx.strokeStyle = technicalColors.ink; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
  drawText(ctx, 'LÉGENDE', x + width / 2, y + 24, 14, technicalColors.ink, 'bold', 'center');
  [
    [technicalColors.panel1000, '1000 mm'], [technicalColors.panel750, '750 mm'],
    [technicalColors.panel500, '500 mm'], [technicalColors.panelOther, 'Autre'], [technicalColors.reinforcement, 'Renfort'],
  ].forEach(([color, label], index) => {
    const cy = y + 44 + index * 31;
    ctx.fillStyle = color; ctx.fillRect(x + 8, cy, 13, 13);
    drawText(ctx, label, x + 27, cy + 11, 12);
  });
  const seen = new Set();
  const available = items.filter((item) => {
    const entry = catalog.find((candidate) => candidate.type === item.type) || {};
    if (technicalItemSection(item, entry) !== 'electricity') return false;
    const descriptor = technicalSvgPictoDescriptor(item, entry, catalog);
    if (!descriptor || !imageMap.get(descriptor.key) || seen.has(descriptor.key)) return false;
    seen.add(descriptor.key); return true;
  });
  available.slice(0, 6).forEach((item, index) => {
    const entry = catalog.find((candidate) => candidate.type === item.type) || {};
    const cy = y + 214 + index * 102;
    drawContainedImage(ctx, technicalPictoImageForItem(item, entry, imageMap, catalog), x + 12, cy, width - 24, 56);
    if (!isLedRailItem(item)) {
      wrappedProductionText(ctx, item.label || entry.label || item.type, width - 12, 11, 'normal', 3)
        .forEach((text, lineIndex) => drawText(ctx, text, x + width / 2, cy + 72 + lineIndex * 12, 11, technicalColors.ink, 'normal', 'center'));
    }
  });
}

function drawSidebar(ctx, width, depth, height, layout, items, floor = {}) {
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
  drawText(ctx, "Cotes electriques : valeurs en mm.", x + 16, y + 192, 13);
  drawText(ctx, 'Rectangle barré : poteau de contrainte.', x + 16, y + 192, 13);
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
  legendSwatch(ctx, x + 18, y + 270, floor.signature ? floor.footprints?.[0]?.color || technicalColors.footprint : technicalColors.footprint, floor.signature ? 'Empreinte sous arche' : 'Empreinte moquette +200mm');

  const footerY = sheet.height - sheet.margin - 86;
  ctx.strokeRect(x, footerY, w, 32);
  drawText(ctx, 'Echelle : automatique', x + 12, footerY + 22, 15);
  ctx.strokeRect(x, footerY + 42, w, 32);
  drawText(ctx, 'Generateur : StandING configurateur 3D', x + 12, footerY + 64, 15);
}

function technicalPlanScale(width, depth, print = true) {
  const bounds = print ? technicalFrontPage.plan : { w: 1260, h: 760 };
  return Math.min(bounds.w / (width + 1.1), bounds.h / (depth + 1.1));
}

function drawPlan(ctx, width, depth, layout, items, catalog, pictoImages = new Map(), visuals = [], constraints = [], print = false, edits = {}, floor = technicalFloorContext(items, catalog, depth), documentInfo = {}) {
  const bounds = print ? technicalFrontPage.plan : { x: sheet.left + 58, y: 130, w: 1260, h: 760 };
  const scale = technicalPlanScale(width, depth, print);
  const planW = width * scale;
  const planH = depth * scale;
  const planX = bounds.x + (bounds.w - planW) / 2;
  const planY = bounds.y + (bounds.h - planH) / 2 + 30;
  const wallThickness = Math.max(8, scale * wallThicknessMeters);

  drawText(ctx, `${formatNumber(width * depth)}m2`, print ? sheet.width - 60 : planX + planW / 2, print ? 116 : 105, print ? 24 : 64, technicalColors.ink, 'bold', print ? 'right' : 'center');

  const toX = (x) => planX + (x + width / 2) * scale;
  const toY = (z) => planY + (z + depth / 2) * scale;

  ctx.fillStyle = technicalColors.floor;
  ctx.fillRect(planX, planY, planW, planH);
  drawCarpetFootprint(ctx, planX, planY, planW, planH, layout, scale, floor);
  drawGrid(ctx, planX, planY, planW, planH, width, depth, scale);

  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(planX, planY, planW, planH);
  drawWalls(ctx, planX, planY, planW, planH, wallThickness, layout, width, depth, scale, items);

  drawDimension(ctx, planX, planY - 66, planX + planW, planY - 66, dimensionMm(width), 'horizontal', technicalColors.blue);
  const hasSideWall = layout === 'left' || layout === 'right' || layout === 'u';
  const sideDimensionStartY = hasSideWall ? planY + wallThickness : planY;
  const sideDimensionEndY = hasSideWall ? sideDimensionStartY + sideWallLength(depth) * scale : planY + planH;
  const sideDimensionLabel = hasSideWall ? dimensionMm(sideWallLength(depth)) : dimensionMm(depth);
  drawDimension(ctx, planX - 64, sideDimensionStartY, planX - 64, sideDimensionEndY, sideDimensionLabel, 'vertical', technicalColors.blue);

  const electricalDimensions = [];
  const riggingMarkers = [];
  const annotateElectricity = (item, entry, frame, index) => {
    if (!frame) return;
    const descriptor = technicalSvgPictoDescriptor(item, entry, catalog);
    const icons = descriptor?.electricalPictos || [];
    const isElectricalObject = /electric/.test(normalizeTechnicalText(item.dimensions?.category || entry?.dimensions?.category || ''));
    (icons.length ? icons : isElectricalObject ? [null] : []).forEach(icon => {
      const point = icon?.url ? electricalPictoPoint(frame, icon) : { x: frame.x, y: frame.y };
      const overlay = icon?.url ? pictoImages.get(icon.url) : null;
      if (overlay) {
        const imageWidth = overlay.naturalWidth || overlay.width || 1;
        const imageHeight = overlay.naturalHeight || overlay.height || 1;
        ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(frame.angle || 0);
        const w = icon.size * scale, h = w * imageHeight / imageWidth;
        drawContainedImage(ctx, overlay, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      if (icon?.url || isElectricalObject) {
        const edit = edits.items?.[item.id] || {};
        if (!edit.hidden && electricalDimensionAllowed(item)) electricalDimensions.push({
          x: point.x + Number(edit.dx || 0) * technicalA3.width,
          y: point.y + Number(edit.dy || 0) * technicalA3.height, index,
        });
      }
    });
  };
  // Draw overhead structures first, preserving the numbering from the original item order.
  items.map((item, index) => ({ item, index })).sort((a, b) => Number(isTechnicalArch(b.item)) - Number(isTechnicalArch(a.item))).forEach(({ item, index }) => {
    if (isWallItem(item)) return;
    ctx.beginObject?.(item.id, 'item', edits.items?.[item.id], item.label || item.type);
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const center = { x: toX(item.x), y: toY(item.z) };
    const color = item.options?.signatureArchColorHex || item.color || entry?.color || '#cccccc';
    const label = print ? '' : `${index + 1}`;
    const picto = technicalSvgPictoDescriptor(item, entry, catalog);
    const pictoImage = picto ? pictoImages.get(picto.key) : null;

    const hasElectric = Boolean(picto?.electrical.url);
    const arch = isTechnicalArch(item);
    ctx.save();
    if (arch) ctx.globalAlpha = .5;
    let frame;
    if (item.technicalHeadPlan) {
      frame = drawTechnicalHead(ctx, item.technicalHeadPlan, toX, toY, scale, pictoImage, label);
    } else if (isTechnicalCeilingItem(item, entry)) {
      const solidW = Math.max(0.32, dims.width || 0.6) * scale;
      const solidH = Math.max(0.18, dims.depth || 0.3) * scale;
      const points = technicalSignRiggingPoints(item, entry);
      frame = drawCeilingObject(ctx, center.x, center.y, solidW, solidH, item.rotation || 0, pictoImage, color, label, points.length > 0);
      const edit = edits.items?.[item.id];
      if (!edit?.hidden) points.forEach((point, pointIndex) => riggingMarkers.push({
        x: toX(point.x) + Number(edit?.dx || 0) * technicalA3.width,
        y: toY(point.z) + Number(edit?.dy || 0) * technicalA3.height,
        label: technicalRiggingId(index, pointIndex),
      }));
    } else {
      frame = pictoImage
        ? drawRotatedPictoObject(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, Number(item.rotation || 0) + picto.rotationOffset, pictoImage, label, groupStructuralAsset(item), hasElectric)
        : drawRotatedObject(ctx, center.x, center.y, dims.width * scale, dims.depth * scale, item.rotation || 0, color, label, hasElectric);
    }
    ctx.restore();
    annotateElectricity(item, entry, frame, index);
    ctx.endObject?.();
  });

  drawObjectWallReinforcements(ctx, items, scale, wallThickness, toX, toY);

  items.forEach((item, index) => {
    if (!isWallItem(item)) return;
    ctx.beginObject?.(item.id, 'item', edits.items?.[item.id], item.label || item.type);
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const label = print ? '' : `${index + 1}`;
    const pictoImage = technicalPictoImageForItem(item, entry, pictoImages, catalog);
    const frame = item.technicalHeadPlan
      ? drawTechnicalHead(ctx, item.technicalHeadPlan, toX, toY, scale, pictoImage, label)
      : drawWallItemTop(ctx, item, width, depth, scale, wallThickness, toX, toY, label, dims, item.label || entry?.label, pictoImage);
    annotateElectricity(item, entry, frame, index);
    ctx.endObject?.();
  });

  electricalDimensions.forEach(point => drawElectricalDimensions(ctx, point, { minX: planX, maxX: planX + planW, minY: planY, maxY: planY + planH }, scale));

  drawTechnicalConstraints(ctx, constraints, scale, toX, toY);
  riggingMarkers.forEach(({ x, y, label }) => drawTechnicalRiggingMarker(ctx, x, y, label));
  const previousRole = ctx.textRole;
  if (print) ctx.textRole = 'banner-plan-reference';
  visuals.forEach((visual) => {
    if (!visual.position || (print && visual.role !== 'wall-banner')) return;
    const x = toX(visual.position[0]);
    const y = toY(visual.position[2]) + 16 + (visual.slotIndex || 0) * 26;
    ctx.font = 'bold 13px Arial';
    const badgeWidth = Math.max(28, ctx.measureText(visual.reference).width + 12);
    ctx.fillStyle = technicalColors.blue;
    ctx.fillRect(x - badgeWidth / 2, y - 12, badgeWidth, 24);
    drawText(ctx, visual.reference, x, y + 5, 13, '#ffffff', 'bold', 'center');
  });
  ctx.textRole = previousRole;
  drawPlanAisle(ctx, planX, planY, planW, planH, floor.signature && floor.footprints?.length ? .5 * scale : 0, documentInfo, print ? technicalFrontPage.gallery.y - 24 : 0);
}

function drawPlanAisle(ctx, x, y, width, height, frontOverflow, { aisleSide, aisleNumber } = {}, frontBaseline = 0) {
  const number = String(aisleNumber ?? '').trim().replace(/^all[ée]e(?:\s+|$)/i, '');
  const label = number ? `Allée ${number}` : 'Allée';
  if (aisleSide === 'left' || aisleSide === 'right') {
    ctx.save();
    ctx.translate(aisleSide === 'left' ? x - 26 : x + width + 33, y + height / 2);
    ctx.rotate(aisleSide === 'left' ? -Math.PI / 2 : Math.PI / 2);
    drawText(ctx, label, 0, 0, 22, technicalColors.ink, 'bold', 'center');
    ctx.restore();
  } else if (aisleSide === 'top') {
    drawText(ctx, label, x + width / 2, y - 25, 22, technicalColors.ink, 'bold', 'center');
  } else if (aisleSide === 'bottom') {
    drawText(ctx, label, x + width / 2, Math.max(frontBaseline, y + height + frontOverflow + 62), 28, technicalColors.ink, 'bold', 'center');
  } else {
    drawText(ctx, 'Allée', x + width / 2, Math.max(frontBaseline, y + height + frontOverflow + 62), 58, technicalColors.ink, 'normal', 'center');
  }
}

function isTechnicalArch(item = {}) {
  return item.options?.signatureBaseKey === 'arche' || isSignatureLedArch(item) || /\barche\b/.test(normalizeTechnicalText(`${item.type || ''} ${item.label || ''}`).replace(/[-_]/g, ' '));
}

function technicalRiggingId(itemIndex, pointIndex) {
  return `E${itemIndex + 1}.${pointIndex + 1}`;
}

function isTechnicalCeilingItem(item, entry) {
  return Boolean(item.ceilingMounted || item.dimensions?.ceilingMounted || entry?.dimensions?.ceilingMounted);
}

function technicalRiggingSection(items, catalog, width, depth, layout, edits = {}) {
  const scale = technicalPlanScale(width, depth);
  const rows = items.flatMap((item, index) => {
    const edit = edits.items?.[item.id];
    if (edit?.hidden) return [];
    const entry = catalog.find((candidate) => candidate.type === item.type);
    if (!isTechnicalCeilingItem(item, entry)) return [];
    return technicalSignRiggingPoints(item, entry).map(({ x, z }, pointIndex) => {
      const coords = technicalRiggingCoordinates({
        x: x + Number(edit?.dx || 0) * technicalA3.width / scale,
        z: z + Number(edit?.dy || 0) * technicalA3.height / scale,
      }, width, depth, layout, wallThicknessMeters);
      const id = technicalRiggingId(index, pointIndex);
      return { ...technicalSimpleRow(`${id} · ${item.label || entry?.label || 'Enseigne haute'}`,
        `X : ${coords.xMm} mm depuis le ${coords.xReference} · Y : ${coords.yMm} mm depuis le ${coords.yReference}`), id, coords };
    });
  });
  return rows.length ? { id: 'rigging', title: 'ÉLINGUES — COTES X/Y', rows } : null;
}

function drawTechnicalRiggingMarker(ctx, x, y, label) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#15526b';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = 'bold 12px Arial';
  ctx.fillRect(x + 8, y - 17, ctx.measureText(label).width + 5, 17);
  drawText(ctx, label, x + 10, y - 5, 12, '#15526b', 'bold');
  ctx.restore();
}

function drawElectricalDimensions(ctx, point, bounds, scale) {
  const previousRole = ctx.textRole;
  ctx.textRole = 'electrical-dimension';
  const edgeX = Math.abs(point.x - bounds.minX) <= Math.abs(point.x - bounds.maxX) ? bounds.minX : bounds.maxX;
  const edgeY = Math.abs(point.y - bounds.minY) <= Math.abs(point.y - bounds.maxY) ? bounds.minY : bounds.maxY;
  const offset = 18 + (point.index % 5) * 14;
  const directionX = point.x < bounds.minX ? -1 : point.x > bounds.maxX ? 1 : edgeX === bounds.minX ? 1 : -1;
  const directionY = point.y < bounds.minY ? -1 : point.y > bounds.maxY ? 1 : edgeY === bounds.minY ? 1 : -1;
  const lineX = point.x + directionX * offset, lineY = point.y + directionY * offset;
  const horizontal = point.wallNormalAxis !== 'x' && dimensionMm(Math.abs(point.x - edgeX) / scale) !== '0';
  const vertical = point.wallNormalAxis !== 'y' && dimensionMm(Math.abs(point.y - edgeY) / scale) !== '0';
  ctx.save(); ctx.strokeStyle = technicalColors.red; ctx.lineWidth = 1;
  if (horizontal) { line(ctx, point.x, point.y, point.x, lineY); line(ctx, edgeX, point.y, edgeX, lineY); }
  if (vertical) { line(ctx, point.x, point.y, lineX, point.y); line(ctx, point.x, edgeY, lineX, edgeY); }
  ctx.restore();
  if (horizontal) drawDimension(ctx, Math.min(point.x, edgeX), lineY, Math.max(point.x, edgeX), lineY, dimensionMm(Math.abs(point.x - edgeX) / scale), 'horizontal', technicalColors.red, 12);
  if (vertical) drawDimension(ctx, lineX, Math.min(point.y, edgeY), lineX, Math.max(point.y, edgeY), dimensionMm(Math.abs(point.y - edgeY) / scale), 'vertical', technicalColors.red, 12);
  ctx.textRole = previousRole;
}

function electricalDimensionAllowed(item = {}) {
  const label = normalizeTechnicalText(`${item.type || ''} ${item.label || ''}`).replace(/[-_]/g, ' ');
  return !isWallItem(item) && !isObjectWallItem(item) && !label.includes('tete de cloison');
}

function drawTechnicalConstraints(ctx, constraints = [], scale, toX, toY) {
  constraints.forEach((constraint, index) => {
    const width = Number(constraint.width);
    const depth = Number(constraint.depth);
    const centerX = Number(constraint.x);
    const centerZ = Number(constraint.z);
    if (![width, depth, centerX, centerZ].every(Number.isFinite) || width <= 0 || depth <= 0) return;
    const x = toX(centerX - width / 2);
    const y = toY(centerZ - depth / 2);
    const w = width * scale;
    const h = depth * scale;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = technicalColors.ink;
    ctx.lineWidth = 2.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    line(ctx, x, y, x + w, y + h);
    line(ctx, x + w, y, x, y + h);
    drawText(ctx, constraint.label || `Poteau ${index + 1}`, x + w / 2, y - 8, 13, technicalColors.ink, 'bold', 'center');
    ctx.restore();
  });
}

function technicalFloorContext(items = [], catalog = [], standDepth = 0) {
  items = (items || []).filter(Boolean);
  const marker = items.find((item) => item?.sourceOptions);
  if (marker?.sourceFloor) return marker.sourceFloor;
  const arches = items.filter((item) => {
    const entry = catalog.find((candidate) => candidate.type === item?.type);
    const text = normalizeTechnicalText(`${item?.type || ''} ${item?.label || ''} ${entry?.label || ''}`);
    return item?.options?.signatureBaseKey === 'arche' || isSignatureLedArch(item)
      || (isTechnicalArch(item) && (text.includes('signature') || text.includes('totem') && text.includes('plafond')));
  });
  return {
    signature: arches.length > 0,
    footprintEnabled: marker?.sourceOptions?.carpetFootprintEnabled !== false,
    footprints: arches.map((item) => {
      const dims = itemDimensions(item, catalog.find((entry) => entry.type === item.type));
      const angle = Number(item.rotation || 0) * Math.PI / 180;
      const localZ = .25 - Number(item.z || 0);
      return { width: dims.width, depth: standDepth + .5,
        x: Number(item.x || 0) + localZ * Math.sin(angle), z: Number(item.z || 0) + localZ * Math.cos(angle),
        rotation: Number(item.rotation || 0), color: item.options?.signatureArchColorHex || '#bebebe' };
    }),
  };
}

function drawCarpetFootprint(ctx, planX, planY, planW, planH, layout, scale, floor = {}) {
  if (floor.signature) {
    (floor.footprints || []).forEach((footprint) => {
      const w = footprint.width * scale, h = footprint.depth * scale;
      ctx.save();
      ctx.translate(planX + planW / 2 + footprint.x * scale, planY + planH / 2 + footprint.z * scale);
      ctx.rotate(-Number(footprint.rotation || 0) * Math.PI / 180);
      ctx.fillStyle = footprint.color || '#bebebe';
      ctx.strokeStyle = '#777777'; ctx.lineWidth = 1.5; ctx.setLineDash([10, 6]);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    });
    return;
  }
  if (floor.footprintEnabled === false) return;
  const overflow = carpetFootprintOverflow * scale;
  const tile = scale;
  const maxY = planY + planH + overflow;
  const y = maxY - tile;
  let x = planX + planW / 2 - tile / 2;

  if (layout === 'left' || layout === 'back') {
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

function technicalTableHeight(sections) {
  return 58 + sections.reduce((sum, section) => sum + 28 + section.rows.reduce((total, row) => total + row.height, 0), 0);
}

function drawItemTable(ctx, sections) {
  const x = sheet.left + 18;
  const rowH = 28;
  const w = sheet.width - sheet.margin - x - 18;
  const y = technicalTableY;

  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, technicalTableHeight(sections));
  drawText(ctx, 'DETAIL DES ELEMENTS', x + 16, y + 28, 22, technicalColors.blue, 'bold');

  let cy = y + 48;
  sections.forEach((section) => {
    ctx.fillStyle = technicalColors.soft;
    ctx.fillRect(x + 10, cy, w - 20, rowH);
    ctx.strokeStyle = '#777';
    ctx.strokeRect(x + 10, cy, w - 20, rowH);
    drawText(ctx, section.title, x + 18, cy + 20, 14, technicalColors.blue, 'bold');
    cy += rowH;

    section.rows.forEach((row) => {
      ctx.strokeStyle = '#cccccc';
      ctx.strokeRect(x + 10, cy, w - 20, row.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 18, cy, 258, row.height);
      ctx.clip();
      drawText(ctx, row.label, x + 18, cy + 20, 13, technicalColors.ink, 'bold');
      ctx.restore();
      row.lines.forEach((line, lineIndex) => {
        drawText(ctx, line, x + 288, cy + 20 + lineIndex * 15, 12, '#555555');
      });
      cy += row.height;
    });
  });
}

function technicalTableSections(items = [], catalog = []) {
  const productReferences = items.find((item) => item?.sourceOptions)?.sourceProductReferences || {};
  const sections = [
    { id: 'amco', title: 'AMCO', rows: [] },
    { id: 'electricity', title: 'ELEC', rows: [] },
    { id: 'coverings', title: 'MOQUETTE / EMPREINTE / COTON CLOISON', rows: technicalCoveringRows(items) },
  ];

  (items || []).filter((item) => !item?.sourceOptions).forEach((item, index) => {
    const entry = catalog.find((candidate) => candidate.type === item.type) || {};
    const row = technicalObjectRow(item, entry, catalog, index, productReferences);
    const sectionId = technicalItemSection(item, entry);
    sections.find((section) => section.id === sectionId)?.rows.push(row);
  });

  return sections.filter((section) => section.rows.length > 0);
}

function technicalObjectRow(item = {}, entry = {}, catalog = [], index = 0, productReferences = {}) {
  const descriptionLines = technicalDescriptionLines(technicalBatDescription(item, entry, catalog));
  const optionLines = technicalItemOptionLines(item, entry);
  const reference = item.options?.baseObjectReference || item.options?.variantReference || item.options?.resolvedObjectReference
    || productReferences[item.type] || entry.dimensions?.reference || item.dimensions?.reference || entry.reference || '';
  const lines = [...(reference ? [`Référence : ${reference}`] : []), ...optionLines, ...descriptionLines];
  return {
    label: `${index + 1}. ${item.label || entry?.label || item.type || 'Objet'}`,
    lines: lines.length ? lines : ['—'],
    height: 28 + Math.max(1, lines.length) * 15,
  };
}

function technicalItemSection(item = {}, entry = {}) {
  const text = normalizeTechnicalText(`${item.label || ''} ${item.type || ''} ${entry.label || ''} ${entry.type || ''} ${entry.dimensions?.category || ''}`);
  if (text.includes('spot') || text.includes('rail') || text.includes('led') || text.includes('alimentation') || text.includes('multiprise') || text.includes('triplette')) return 'electricity';
  return 'amco';
}

function technicalCoveringRows(items = []) {
  const rows = [];
  const marker = (items || []).find((item) => item?.sourceOptions);
  const sourceOptions = marker?.sourceOptions || null;
  if (sourceOptions) {
    rows.push(technicalSimpleRow('Moquette', [sourceOptions.carpetColorName, sourceOptions.carpetColorCode].filter(Boolean).join(' ')));
    if (marker.sourceFloor?.signature) {
      (marker.sourceFloor.footprints || []).forEach((footprint) => rows.push(technicalSimpleRow('Empreinte sous arche',
        [footprint.colorName || footprint.color, `${formatNumber(footprint.width)} x ${formatNumber(footprint.depth)} m`].filter(Boolean).join(' - '))));
    } else if (sourceOptions.carpetFootprintEnabled !== false) rows.push(technicalSimpleRow('Empreinte moquette', [sourceOptions.carpetFootprintColorName, sourceOptions.carpetFootprintColorCode].filter(Boolean).join(' ')));
    rows.push(technicalSimpleRow('Coton cloison', [sourceOptions.wallFabricColorName, sourceOptions.wallFabricColorCode].filter(Boolean).join(' ')));
  }
  return rows;
}

function technicalPlanVisuals(items = [], catalog = [], width = 4, depth = 3) {
  const visuals = [];
  const marker = items.find((item) => item?.sourceOptions);
  const drawable = items.filter((item) => item && !item.sourceOptions);
  drawable.forEach((item, index) => {
    if (item.options?.partitionHeadHidden || item.options?.prestigeHidden) return;
    const headSide = technicalHeadSide(item);
    const savedHeadVisual = marker?.sourceOptions?.partitionHeadVisuals?.[headSide];
    if (savedHeadVisual) item = { ...item, options: { ...(item.options || {}), ...savedHeadVisual } };
    const surface = objectWallSurfaceForTechnicalItem(item);
    let position = [Number(item.x || 0), Number(item.y || 0), Number(item.z || 0)];
    if (isWallItem(item)) {
      if (surface) position = surface.orientation === 'z'
        ? [surface.normalAxis, 0, Number(item.x ?? surface.centerAxis)]
        : [Number(item.x ?? surface.centerAxis), 0, surface.normalAxis];
      else if (item.wall === 'back') position = [Number(item.x || 0), 0, -depth / 2];
      else position = [item.wall === 'left' ? -width / 2 : width / 2, 0, Number(item.x || 0)];
    }
    if (item.technicalHeadPlan) position = [item.technicalHeadPlan.x, 0, item.technicalHeadPlan.z];
    technicalItemVisuals(item, catalog.find((candidate) => candidate.type === item.type) || {}).forEach((visual, slotIndex) => {
      visuals.push({ ...visual, position, slotIndex, placement: `Objet n° ${index + 1} - ${item.groupLabel || item.label || item.type}${item.options?.variantLabel ? ` (${item.options.variantLabel})` : ''}` });
    });
  });
  (marker?.sourceVisualSurfaces || []).forEach((surface) => {
    // Use the same printable width as the banner option, not the inset 3D mesh.
    const format = `${mm(Number(surface.visibleWidth ?? surface.width ?? 0))} × ${mm(Number(surface.height || fixedWallHeight))} mm`;
    visuals.push({
      label: `Bâche - ${surface.label}`,
      role: 'wall-banner',
      format,
      placement: `${surface.label || 'Cloison'} - ${format}`,
      position: surface.position,
      imageUrl: validTechnicalImageUrl(surface.previewUrl),
      status: technicalVisualStatus(surface.visualPending, surface.previewUrl, surface.previewName),
    });
  });
  // Some older scenes keep the head artwork only in the scene-level options.
  Object.entries(marker?.sourceOptions?.partitionHeadVisuals || {}).forEach(([side, value]) => {
    if (!['left', 'right'].includes(side) || (!value?.headMainImageUrl && !value?.headMainImageName && !value?.visualPending)) return;
    const head = drawable.find((item) => technicalHeadSide(item) === side);
    if (visuals.some((visual) => visual.headSide === side)) return;
    if (marker.sourceOptions[side === 'left' ? 'partitionHeadLeftEnabled' : 'partitionHeadRightEnabled'] === false) return;
    const label = `Tête de cloison ${side === 'left' ? 'gauche' : 'droite'}`;
    const pose = head?.technicalHeadPlan || head;
    visuals.push({ label: `Visuel ${label.toLowerCase()}`, role: 'head-visual', headSide: side, placement: label, position: pose ? [pose.x || 0, 0, pose.z || 0] : [side === 'left' ? -width / 2 : width / 2, 0, depth / 2], imageUrl: validTechnicalImageUrl(value.headMainImageUrl), status: technicalVisualStatus(value.visualPending, value.headMainImageUrl, value.headMainImageName) });
  });
  (marker?.sourceHeadInformation || []).forEach((head) => {
    const itemIndex = drawable.findIndex((item) => item.id === head.itemId || item.groupId === head.itemId);
    const pose = drawable[itemIndex]?.technicalHeadPlan;
    const headVisual = visuals.find((visual) => visual.headSide === head.side);
    visuals.push({
      label: `Habillage tête de cloison ${head.side === 'left' ? 'gauche' : head.side === 'right' ? 'droite' : ''}${head.face ? ` — ${head.face === 'front' ? 'recto' : 'verso'}` : ''}`.trim(),
      role: 'head-text',
      placement: `${itemIndex >= 0 ? `Objet n° ${itemIndex + 1} - ` : ''}${head.label}`,
      position: pose ? [pose.x, 0, pose.z] : head.position,
      slotIndex: headVisual ? 1 : 0,
      imageUrl: head.imageUrl,
      status: head.face ? 'Société, allée, emplacement et pays - visuel automatique' : 'Société, stand, pavillon et secteur - visuel automatique',
    });
  });
  return visuals.map((visual, index) => ({ ...visual, reference: `S${index + 1}` }));
}

function drawVisualGallery(ctx, visuals, imageMap, y) {
  if (!visuals.length) return;
  const x = sheet.left + 18;
  const w = sheet.width - sheet.margin - x - 18;
  drawText(ctx, 'SIGNALETIQUE / VISUELS', x + 16, y + 24, 22, technicalColors.blue, 'bold');
  drawText(ctx, 'Aperçus enregistrés - emplacements repérés S1, S2… sur le plan', x + 16, y + 46, 14, '#555555');
  const cardWidth = (w - 18) / 2;
  visuals.forEach((visual, index) => {
    const cx = x + (index % 2) * (cardWidth + 18);
    const cy = y + 64 + Math.floor(index / 2) * 240;
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, cardWidth, 222);
    ctx.fillStyle = technicalColors.soft;
    ctx.fillRect(cx + 12, cy + 12, 190, 198);
    const image = imageMap.get(visual.imageUrl);
    if (image) drawContainedImage(ctx, image, cx + 18, cy + 18, 178, 186);
    else drawText(ctx, visual.imageUrl ? 'Aperçu indisponible' : 'En attente de visuel', cx + 107, cy + 111, 13, '#777777', 'normal', 'center');
    const textX = cx + 218;
    const textWidth = cardWidth - 232;
    let textY = cy + 28;
    const fields = [
      { text: `${visual.reference} - ${visual.label}`, size: 16, color: technicalColors.blue, weight: 'bold', maxLines: 2 },
      { text: `Emplacement : ${visual.placement}`, size: 14, color: technicalColors.ink, maxLines: 3 },
      { text: visual.status, size: 13, color: visual.imageUrl ? '#267346' : '#956200', maxLines: 3 },
    ];
    fields.forEach((field) => {
      const lines = wrappedTechnicalText(ctx, field.text, textWidth, field.size, field.weight, field.maxLines);
      lines.forEach((text) => {
        drawText(ctx, text, textX, textY, field.size, field.color, field.weight || 'normal');
        textY += 18;
      });
      textY += 8;
    });
  });
}

function wrappedTechnicalText(ctx, text, width, size, weight = 'normal', maxLines = 3) {
  ctx.font = `${weight || 'normal'} ${size}px Arial`;
  const lines = [];
  let line = '';
  for (const character of String(text || '')) {
    if (line && ctx.measureText(line + character).width > width) {
      lines.push(line.trim());
      line = '';
    }
    line += character;
  }
  if (line) lines.push(line.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -2)}…`;
  }
  return lines;
}

function technicalSimpleRow(label, detail = '', imageUrl = '') {
  const lines = [String(detail || '—')];
  return { label, lines, imageUrl, height: Math.max(52, 28 + lines.length * 15) };
}

function technicalItemOptionLines(item = {}, entry = {}) {
  const options = item.options || {};
  const lines = [];
  const optionRefs = Array.isArray(options.optionReferences) ? options.optionReferences : [];
  const colorCandidate = technicalSelectedColorCandidate(options, optionRefs);
  if (options.variantLabel) lines.push(`Variante : ${options.variantLabel}`);
  if (colorCandidate?.name) lines.push(`Couleur : ${cleanTechnicalColorName(colorCandidate.name)}`);
  optionRefs.forEach((option) => {
    if (option?.label && !isTechnicalColorReference(option)) lines.push(String(option.label));
  });
  if (options.technician) lines.push('Permanence technicien');
  if (options.fileCheck) lines.push('Vérification fichier');
  if (entry?.dimensions?.category) lines.push(`Catégorie : ${entry.dimensions.category}`);
  return uniqueTechnicalLines(lines);
}

function technicalSelectedColorCandidate(options = {}, optionRefs = []) {
  const colorRefs = optionRefs.filter(isTechnicalColorReference).map((option, index) => ({
    name: String(option.label || '').replace(/^\s*Couleur\s*:\s*/i, '') || option.reference || option.colorId || '',
    price: Number(option.price || 0),
    index,
  }));
  const textureColors = Object.values(options.textureSlotValues || {})
    .filter((value) => value && (value.colorName || value.color))
    .map((value, index) => ({
      name: value.colorName || value.color,
      price: Number(value.colorPrice || value.price || 0),
      index,
    }));
  const binaryColor = options.binary2ColorName || options.binary2Color
    ? [{ name: options.binary2ColorName || options.binary2Color, price: Number(options.binary2ColorPrice || 0), index: 0 }]
    : [];
  const ordered = [...colorRefs, ...textureColors, ...binaryColor].filter((candidate) => candidate.name);
  return ordered.find((candidate) => candidate.price > 0)
    || [...colorRefs].reverse().find((candidate) => candidate.name)
    || [...textureColors].reverse().find((candidate) => candidate.name)
    || binaryColor[0]
    || null;
}

function isTechnicalColorReference(option = {}) {
  const text = normalizeTechnicalText(`${option.id || ''} ${option.label || ''} ${option.reference || ''}`);
  return Boolean(option.colorId || text.startsWith('couleur') || text.includes(' couleur') || text.includes('color'));
}

function technicalItemVisuals(item = {}, entry = {}) {
  if (item?.sourceOptions) return [];
  const visuals = [];
  const label = item.label || entry.label || item.type || 'objet';
  const textureSlots = normalizeTechnicalTextureSlots(item.dimensions?.textureSlots || entry.dimensions?.textureSlots);
  const hasCounterTextureVisual = isCounterTechnicalItem(item, entry)
    && textureSlots.some((slot) => technicalTextureSlotRequiresVisual(item, slot, item.options?.textureSlotValues?.[slot.id] || {}));
  if (!hasCounterTextureVisual && item.options?.binary3Enabled !== false && (item.options?.binary3ImageUrl || item.options?.binary3ImageName || item.options?.binary3VisualPending || isCounterTechnicalItem(item, entry))) {
    visuals.push({
      label: `Logo ${counterTechnicalLabel(label)}`,
      role: technicalVisualRole(item, entry),
      status: technicalVisualStatus(item.options?.binary3VisualPending, item.options?.binary3ImageUrl || item.options?.binary3ImageName, item.options?.binary3ImageName),
      imageUrl: validTechnicalImageUrl(item.options?.binary3ImageUrl),
    });
  }
  if (item.options?.headMainImageUrl || item.options?.headMainImageName || item.options?.visualPending) {
    const headSide = technicalHeadSide(item);
    visuals.push({ label: headSide ? `Visuel tête de cloison ${headSide === 'left' ? 'gauche' : 'droite'}` : `Image ${label}`, role: headSide ? 'head-visual' : technicalVisualRole(item, entry), headSide, status: technicalVisualStatus(item.options?.visualPending, item.options?.headMainImageUrl || item.options?.headMainImageName, item.options?.headMainImageName), imageUrl: validTechnicalImageUrl(item.options?.headMainImageUrl) });
  }
  if (item.options?.posterImageUrl || item.options?.posterImageName || item.options?.posterVisualPending) {
    visuals.push({ label: `Image ${label}`, role: technicalVisualRole(item, entry), status: technicalVisualStatus(item.options?.posterVisualPending, item.options?.posterImageUrl || item.options?.posterImageName, item.options?.posterImageName), imageUrl: validTechnicalImageUrl(item.options?.posterImageUrl) });
  }
  textureSlots.forEach((slot) => {
    const value = item.options?.textureSlotValues?.[slot.id] || {};
    if (technicalTextureSlotRequiresVisual(item, slot, value)) {
      visuals.push({
        label: `${technicalVisualSlotLabel(slot, item)} ${label}`,
        role: technicalVisualRole(item, entry, slot),
        status: technicalVisualStatus(value.visualPending, value.imageUrl || value.imageName, value.imageName),
        imageUrl: validTechnicalImageUrl(value.imageUrl),
      });
    }
  });
  return visuals;
}

function technicalVisualRole(item = {}, entry = {}, slot = {}) {
  const text = normalizeTechnicalText(`${item.type || ''} ${item.label || ''} ${entry.label || ''}`);
  if (technicalHeadSide(item) || text.includes('tete de cloison')) {
    return /logo|haute|texte|information/.test(normalizeTechnicalText(`${slot.id || ''} ${slot.label || ''}`)) ? 'head-text' : 'head-visual';
  }
  if (isCounterTechnicalItem(item, entry)) return 'counter';
  if (/enseigne.*(?:haute|suspend)|viscom.*suspend/.test(text)) return 'hanging-sign';
  return 'other';
}

function technicalHeadSide(item = {}) {
  const side = item.options?.partitionHeadSide || item.dimensions?.smclHeadSide;
  if (['left', 'right'].includes(side)) return side;
  const text = normalizeTechnicalText(`${item.label || ''} ${item.type || ''} ${item.dimensions?.folderName || ''}`);
  if (!text.includes('tete de cloison')) return '';
  return text.includes('gauche') ? 'left' : text.includes('droite') ? 'right' : '';
}

function technicalVisualStatus(pending = false, hasImage = false, imageName = '') {
  if (hasImage && !pending) return `Visuel fourni${imageName ? ` : ${imageName}` : ''}`;
  if (pending) return 'En attente - visuel à fournir plus tard';
  return 'Visuel manquant';
}

function technicalTextureSlotRequiresVisual(item = {}, slot = {}, value = {}) {
  if (isSignatureLedArch(item) && slot.id === 'signature-arch-led-5') return false;
  if (value.visualEnabled === false) return false;
  if (value.imageUrl || value.imageName || value.visualPending) return true;
  const text = normalizeTechnicalText(`${item.type || ''} ${item.label || ''} ${slot.label || ''}`);
  const optionText = normalizeTechnicalText((item.options?.optionReferences || []).map((option) => option?.label || '').join(' '));
  if (text.includes('enseigne') && (text.includes('haute') || text.includes('suspend'))) return true;
  if (text.includes('pont') && text.includes('lumiere')) return true;
  return optionText.includes('logo') || optionText.includes('signa') || optionText.includes('visuel') || optionText.includes('image');
}

function technicalVisualSlotLabel(slot = {}, item = {}) {
  const text = normalizeTechnicalText(`${item.type || ''} ${item.label || ''} ${slot.label || ''}`);
  if (text.includes('logo') || text.includes('signa') || (text.includes('enseigne') && text.includes('haute'))) return 'Logo';
  return slot.label || 'Image';
}

function validTechnicalImageUrl(url = '') {
  const value = String(url || '').trim();
  return /^(https?:|data:|blob:|\/)/i.test(value) ? value : '';
}

function normalizeTechnicalTextureSlots(slots = []) {
  return (Array.isArray(slots) ? slots : [])
    .map((slot, index) => ({ id: slot.id || `texture-slot-${index}`, label: slot.label || slot.name || 'Image', kind: slot.kind || 'image' }))
    .filter((slot) => slot.kind !== 'color');
}

function isCounterTechnicalItem(item = {}, entry = {}) {
  return /(?:comptoir|banque).*accueil/.test(normalizeTechnicalText(`${item.type || ''} ${item.label || ''} ${entry.type || ''} ${entry.label || ''}`));
}

function counterTechnicalLabel(label = '') {
  return normalizeTechnicalText(label).includes('comptoir') ? 'comptoir accueil' : label;
}

function cleanTechnicalColorName(value = '') {
  return String(value || '').replace(/\s*\([^)]*\)\s*$/g, '').replace(/\b[A-Z]\d{2,4}\b/g, '').replace(/\bST\d+\b/gi, '').replace(/\s+/g, ' ').trim();
}

function uniqueTechnicalLines(lines = []) {
  const seen = new Set();
  return lines.map((line) => String(line || '').trim()).filter((line) => {
    const key = normalizeTechnicalText(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTechnicalText(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function technicalDescriptionLines(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
    const title = panel.kind === 'reinforcement' ? 'RENFORT TV' : size < 120 ? 'CLOISON' : 'CLOISON TRAD';
    const dimensions = size < 120 ? `${panel.mm} mm` : `${panel.mm}x2500mm ht`;
    const fontSize = size < 70 ? 9 : size < 120 ? 10 : 12;

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
  const rows = technicalWallBreakdownRows(ctx, w, width, depth, layout, items);
  const h = technicalWallBreakdownHeight(rows);
  ctx.strokeStyle = '#777';
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = technicalColors.soft;
  ctx.fillRect(x + 1, y + 1, w - 2, 42);
  drawText(ctx, 'DECOUPE CLOISONS', x + 16, y + 29, 20, technicalColors.blue, 'bold');

  let rowY = y + 48;
  rows.forEach((row) => {
    drawText(ctx, row.label, x + 14, rowY + 18, 14, '#666666', 'bold');
    row.lines.forEach((text, index) => drawText(ctx, text, x + 14, rowY + 38 + index * 18, 13, technicalColors.ink));
    rowY += row.height;
  });

  return y + h;
}

function technicalWallBreakdownRows(ctx, w, width, depth, layout, items) {
  return wallRows(width, depth, layout, items).map((row) => {
    const lines = wrappedTechnicalText(ctx, row.summary, w - 28, 13, 'normal', Infinity);
    return { ...row, lines, height: 38 + lines.length * 18 };
  });
}

function technicalWallBreakdownHeight(rows) {
  return 54 + rows.reduce((sum, row) => sum + row.height, 0);
}

function wallRows(width, depth, layout, items) {
  const rows = [wallSummaryRow(wallDescriptor('back', width, depth, items), 'Fond')];
  if (layout === 'left' || layout === 'u') rows.push(wallSummaryRow(wallDescriptor('left', width, depth, items), 'Gauche'));
  if (layout === 'right' || layout === 'u') rows.push(wallSummaryRow(wallDescriptor('right', width, depth, items), 'Droite'));
  return rows;
}

export function standWallPanelRequirements({ width, depth, layout, items = [], catalog = [] }) {
  const technicalItems = technicalItemsForPlan(items, width, depth, catalog);
  const walls = ['back', ...(layout === 'left' || layout === 'u' ? ['left'] : []), ...(layout === 'right' || layout === 'u' ? ['right'] : [])];
  return walls.flatMap((wall) => wallPanelSegments(wallDescriptor(wall, width, depth, technicalItems)).map((panel) => ({
    wall,
    lengthMm: panel.mm,
    reinforced: panel.kind === 'reinforcement',
  })));
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
    if (start > cursor) panels.push(...splitWallPanels(start - cursor, true).reverse());
    const length = Math.max(0, reinforcement.end - start);
    if (length > 0) panels.push(...splitWallPanels(length, true).map((panel) => ({ ...panel, kind: 'reinforcement' })));
    cursor = Math.max(cursor, reinforcement.end);
  });

  if (wall.length > cursor) panels.push(...splitWallPanels(wall.length - cursor, wall.reinforcements.length > 0));
  return panels;
}

function wallDescriptor(wall, width, depth, items = []) {
  const length = wall === 'back' ? width : sideWallLength(depth);
  const reinforcements = screenReinforcements(wall, width, depth, items, length);
  return { wall, length, reinforcements };
}

function screenReinforcements(wall, width, depth, items, wallLength) {
  return (items || [])
    .filter((item) => isWallItem(item) && isTechnicalScreenItem(item) && !isObjectWallItem(item) && item.wall === wall)
    .map((item) => {
      const center = screenAxisOffset(item, wall, width, depth);
      return reinforcementPanelForAxis(center, 0, wallLength);
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

function reinforcementPanelForAxis(axis, min, max) {
  const length = Math.min(reinforcementWidth, Math.max(0, max - min));
  // Anchor to the actual wall start, including the side-wall 6cm offset.
  // Only a non-modular wall end may require a cut; the TV never moves.
  const module = .25;
  const start = clampValue(min + Math.round((Number(axis) - length / 2 - min) / module) * module, min, max - length);
  return { start, end: start + length };
}

function screenAxisOffset(item, wall, width, depth) {
  if (wall === 'back') return clampValue(Number(item.x || 0) + width / 2, 0, width);
  return clampValue(Number(item.x || 0) + depth / 2 - wallThicknessMeters, 0, sideWallLength(depth));
}

function drawObjectWallReinforcements(ctx, items = [], scale, wallThickness, toX, toY) {
  (items || [])
    .filter((item) => isWallItem(item) && isTechnicalScreenItem(item) && isObjectWallItem(item))
    .forEach((item) => {
      const surface = objectWallSurfaceForTechnicalItem(item);
      if (!surface) return;
      const halfSurface = Number(surface.length || 0) / 2;
      const panel = reinforcementPanelForAxis(Number(item.x ?? surface.centerAxis), surface.centerAxis - halfSurface, surface.centerAxis + halfSurface);
      const center = (panel.start + panel.end) / 2;
      const segmentLength = (panel.end - panel.start) * scale;
      const thickness = wallThickness;
      ctx.save();
      ctx.fillStyle = technicalColors.reinforcement;
      if (surface.orientation === 'x') {
        ctx.fillRect(toX(center) - segmentLength / 2, toY(Number(surface.normalAxis || 0)) - thickness / 2, segmentLength, thickness);
      } else {
        ctx.fillRect(toX(Number(surface.normalAxis || 0)) - thickness / 2, toY(center) - segmentLength / 2, thickness, segmentLength);
      }
      ctx.restore();
    });
}

function sideWallLength(depth) {
  return Math.max(0, Number(depth || 0));
}

function splitWallPanels(lengthMeters, quarterPanels = false) {
  const totalMm = Math.max(0, Math.round(lengthMeters * 1000));
  const fullPanels = Math.floor(totalMm / 1000);
  const remainder = totalMm - fullPanels * 1000;
  const panels = Array.from({ length: fullPanels }, () => ({ mm: 1000, meters: wallPanelWidth, kind: 'standard' }));
  if (quarterPanels) {
    let remaining = remainder;
    for (const width of [500, 250]) {
      while (remaining >= width) { panels.push({ mm: width, meters: width / 1000, kind: 'standard' }); remaining -= width; }
    }
    if (remaining) panels.push({ mm: remaining, meters: remaining / 1000, kind: 'standard' });
  } else if (remainder > 0) panels.push({ mm: remainder, meters: remainder / 1000, kind: 'standard' });
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

function drawRotatedObject(ctx, x, y, w, h, rotation, color, label, outsideBadge = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(technicalPlanRotation(rotation));
  ctx.fillStyle = color;
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  drawBadge(ctx, x, outsideBadge ? y + (Math.abs(Math.sin(technicalPlanRotation(rotation))) * w + Math.abs(Math.cos(technicalPlanRotation(rotation))) * h) / 2 + 23 : y, label);
  return { x, y, width: w, height: h, angle: technicalPlanRotation(rotation) };
}

function drawRotatedPictoObject(ctx, x, y, w, h, rotation, image, label, fillFootprint = false, outsideBadge = false) {
  const angle = technicalPlanRotation(rotation);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Thin wall symbols must span the panel's full length, regardless of the SVG aspect ratio.
  if (fillFootprint) ctx.drawImage(image, -w / 2, -h / 2, w, h);
  else drawContainedImage(ctx, image, -w / 2, -h / 2, w, h);
  ctx.restore();
  const imageW = image.naturalWidth || image.width || 1;
  const imageH = image.naturalHeight || image.height || 1;
  const scale = Math.min(w / imageW, h / imageH);
  const pictoW = fillFootprint ? w : imageW * scale;
  const pictoH = fillFootprint ? h : imageH * scale;
  // The 34px number badge otherwise hides small electrical pictos entirely.
  const smallPicto = outsideBadge || Math.min(pictoW, pictoH) < 42;
  const halfHeight = (Math.abs(Math.sin(angle)) * pictoW + Math.abs(Math.cos(angle)) * pictoH) / 2;
  drawBadge(ctx, x, smallPicto ? y + halfHeight + 23 : y, label);
  return { x, y, width: w, height: h, angle };
}

function drawCeilingObject(ctx, x, y, w, h, rotation, image, color, label, outsideBadge = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(technicalPlanRotation(rotation));
  ctx.fillStyle = color;
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  if (!image) {
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  }
  ctx.setLineDash([]);
  if (image) drawContainedImage(ctx, image, -w / 2, -h / 2, w, h);
  ctx.restore();
  const angle = technicalPlanRotation(rotation);
  const halfWidth = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
  drawBadge(ctx, outsideBadge ? x + halfWidth + 23 : x, y, label);
  return { x, y, width: w, height: h, angle: technicalPlanRotation(rotation) };
}

function drawTechnicalHead(ctx, pose, toX, toY, scale, pictoImage, label) {
  const { width, depth, rotation } = pose;
  const x = toX(pose.x), y = toY(pose.z), w = width * scale, h = depth * scale;
  if (pictoImage) return drawRotatedPictoObject(ctx, x, y, w, h, rotation, pictoImage, label, true, true);
  const angle = technicalPlanRotation(rotation);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#ecf2f8';
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  const halfHeight = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2;
  drawBadge(ctx, x, y + halfHeight + 23, label);
  return { x, y, width: w, height: h, angle };
}

function technicalPlanRotation(rotation) {
  // The plan maps world Z downwards; Three's positive Y rotation turns the other way.
  return -(Number(rotation || 0) * Math.PI) / 180;
}

function drawContainedImage(ctx, image, x, y, w, h) {
  if (!image || w <= 1 || h <= 1) return;
  const imageW = image.naturalWidth || image.width || 1;
  const imageH = image.naturalHeight || image.height || 1;
  const scale = Math.min(w / imageW, h / imageH);
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}

function drawRotatedContainedImage(ctx, image, x, y, w, h, angleRadians) {
  if (!angleRadians) {
    drawContainedImage(ctx, image, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angleRadians);
  const sideways = Math.abs(Math.sin(angleRadians)) > .5;
  drawContainedImage(ctx, image, -(sideways ? h : w) / 2, -(sideways ? w : h) / 2, sideways ? h : w, sideways ? w : h);
  ctx.restore();
}

function drawWallAttachedPicto(ctx, image, x, y, w, h, angle, orientation, side) {
  const sideways = Math.abs(Math.sin(angle)) > .5;
  const imageW = image.naturalWidth || image.width || 1, imageH = image.naturalHeight || image.height || 1;
  const scale = Math.min(w / (sideways ? imageH : imageW), h / (sideways ? imageW : imageH));
  const drawW = (sideways ? imageH : imageW) * scale, drawH = (sideways ? imageW : imageH) * scale;
  // Anchor the wall-facing edge instead of centering the SVG in the model depth.
  const drawX = orientation === 'z' ? (side >= 0 ? x : x + w - drawW) : x + (w - drawW) / 2;
  const drawY = orientation === 'x' ? (side >= 0 ? y : y + h - drawH) : y + (h - drawH) / 2;
  drawRotatedContainedImage(ctx, image, drawX, drawY, drawW, drawH, angle);
}

function wallFacingPictoAngle(orientation, side) {
  // The TV bracket and rail base are on top of the SVG; its front points down.
  if (orientation === 'x') return side >= 0 ? 0 : Math.PI;
  return side >= 0 ? -Math.PI / 2 : Math.PI / 2;
}

function drawWallItemTop(ctx, item, width, depth, scale, wallThickness, toX, toY, label, dims, defaultLabel, pictoImage = null) {
  const screen = isTechnicalScreenItem(item);
  const attachedPicto = screen || isLedRailItem(item);
  const isCustomWallModel = Boolean(item.modelUrl) && !['screen', 'poster'].includes(item.type);
  const itemWidth = (item.type === 'poster' ? Number(item.posterWidth || 1) : attachedPicto || isCustomWallModel ? dims.width : 0.95) * scale;
  const itemDepth = (item.type === 'poster' ? 0.04 : attachedPicto || isCustomWallModel ? Math.max(0.04, dims.depth) : 0.08) * scale;
  const wallLabelText = !label ? '' : item.type === 'poster' ? `AFFICHE ${mm(item.posterWidth || 1)}` : screen ? tvTechnicalLabel(item) : (defaultLabel || 'OBJET MURAL');
  ctx.fillStyle = item.type === 'poster' ? '#f7f1dc' : screen ? '#22364d' : (item.color || '#dfe8ec');
  ctx.strokeStyle = technicalColors.ink;
  ctx.lineWidth = 2;

  if (isObjectWallItem(item)) {
    return drawObjectWallItemTop(ctx, item, scale, toX, toY, label, itemWidth, itemDepth, wallLabelText, pictoImage);
  }

  if (!item.wall || item.wall === 'back') {
    const x = toX(item.x) - itemWidth / 2;
    const y = toY(-depth / 2) + wallThickness + wallItemPlanGap(item);
    if (!pictoImage) ctx.fillRect(x, y, itemWidth, itemDepth);
    if (!pictoImage) ctx.strokeRect(x, y, itemWidth, itemDepth);
    if (pictoImage) {
      if (attachedPicto) drawWallAttachedPicto(ctx, pictoImage, x, y, itemWidth, itemDepth, 0, 'x', 1);
      else drawContainedImage(ctx, pictoImage, x + 2, y + 2, itemWidth - 4, itemDepth - 4);
    }
    if (wallLabelText) drawText(ctx, wallLabelText, x + itemWidth / 2, y + itemDepth + 58, 15, '#22364d', 'bold', 'center');
    drawBadge(ctx, x + itemWidth / 2, y + itemDepth + 22, label);
    return { x: x + itemWidth / 2, y: y + itemDepth / 2, width: itemWidth, height: itemDepth, angle: 0 };
  }

  const gap = wallItemPlanGap(item);
  const x = item.wall === 'left' ? toX(-width / 2) + wallThickness + gap : toX(width / 2) - wallThickness - itemDepth - gap;
  const y = toY(item.x) - itemWidth / 2;
  const side = item.wall === 'left' ? 1 : -1;
  const angle = attachedPicto ? wallFacingPictoAngle('z', side) : side * Math.PI / 2;
  if (!pictoImage) ctx.fillRect(x, y, itemDepth, itemWidth);
  if (!pictoImage) ctx.strokeRect(x, y, itemDepth, itemWidth);
  if (pictoImage) {
    if (attachedPicto) drawWallAttachedPicto(ctx, pictoImage, x, y, itemDepth, itemWidth, angle, 'z', side);
    else drawRotatedContainedImage(ctx, pictoImage, x + 2, y + 2, itemDepth - 4, itemWidth - 4, angle);
  }
  drawSideTvLabel(ctx, wallLabelText, item.wall, x, y + itemWidth / 2, itemDepth);
  drawBadge(ctx, x + itemDepth + 22, y + itemWidth / 2, label);
  return { x: x + itemDepth / 2, y: y + itemWidth / 2, width: itemWidth, height: itemDepth, angle };
}

function drawObjectWallItemTop(ctx, item, scale, toX, toY, label, itemWidth, itemDepth, wallLabelText, pictoImage = null) {
  const surface = objectWallSurfaceForTechnicalItem(item);
  if (!surface) return;
  const axis = clampValue(Number(item.x ?? surface.centerAxis ?? 0), Number(surface.centerAxis || 0) - Number(surface.length || 0) / 2, Number(surface.centerAxis || 0) + Number(surface.length || 0) / 2);
  const side = objectWallSideForTechnicalItem(item, surface);
  const attachedPicto = isTechnicalScreenItem(item) || isLedRailItem(item);
  const gap = attachedPicto ? wallThicknessMeters * scale / 2 : 4;

  if (surface.orientation === 'x') {
    const x = toX(axis) - itemWidth / 2;
    const wallY = toY(Number(surface.normalAxis || 0));
    const y = side >= 0 ? wallY + gap : wallY - itemDepth - gap;
    const angle = wallFacingPictoAngle('x', side);
    if (!pictoImage) ctx.fillRect(x, y, itemWidth, itemDepth);
    if (!pictoImage) ctx.strokeRect(x, y, itemWidth, itemDepth);
    if (pictoImage) {
      if (attachedPicto) drawWallAttachedPicto(ctx, pictoImage, x, y, itemWidth, itemDepth, angle, 'x', side);
      else drawRotatedContainedImage(ctx, pictoImage, x + 2, y + 2, itemWidth - 4, itemDepth - 4, angle);
    }
    if (wallLabelText) drawText(ctx, wallLabelText, x + itemWidth / 2, side >= 0 ? y + itemDepth + 58 : y - 48, 15, '#22364d', 'bold', 'center');
    drawBadge(ctx, x + itemWidth / 2, side >= 0 ? y + itemDepth + 22 : y - 22, label);
    return { x: x + itemWidth / 2, y: y + itemDepth / 2, width: itemWidth, height: itemDepth, angle };
  }

  const wallX = toX(Number(surface.normalAxis || 0));
  const x = side >= 0 ? wallX + gap : wallX - itemDepth - gap;
  const y = toY(axis) - itemWidth / 2;
  if (!pictoImage) ctx.fillRect(x, y, itemDepth, itemWidth);
  if (!pictoImage) ctx.strokeRect(x, y, itemDepth, itemWidth);
  const angle = attachedPicto ? wallFacingPictoAngle('z', side) : side * Math.PI / 2;
  if (pictoImage) {
    if (attachedPicto) drawWallAttachedPicto(ctx, pictoImage, x, y, itemDepth, itemWidth, angle, 'z', side);
    else drawRotatedContainedImage(ctx, pictoImage, x + 2, y + 2, itemDepth - 4, itemWidth - 4, angle);
  }
  drawSideTvLabel(ctx, wallLabelText, side >= 0 ? 'left' : 'right', x, y + itemWidth / 2, itemDepth);
  drawBadge(ctx, x + itemDepth + 22, y + itemWidth / 2, label);
  return { x: x + itemDepth / 2, y: y + itemWidth / 2, width: itemWidth, height: itemDepth, angle };
}

function drawSideTvLabel(ctx, label, wall, x, y, screenDepth) {
  if (!label) return;
  ctx.save();
  ctx.translate(wall === 'left' ? x + screenDepth + 58 : x - 36, y);
  ctx.rotate(-Math.PI / 2);
  drawText(ctx, label, 0, 0, 15, '#22364d', 'bold', 'center');
  ctx.restore();
}

function wallItemPlanGap(item = {}) {
  return isTechnicalScreenItem(item) || isLedRailItem(item) ? 0 : 4;
}

function isLedRailItem(item = {}) {
  const text = `${item.type || ''} ${item.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return Boolean(item.isLedSpotOption || item.dimensions?.isLedSpotOption || item.autoLedRail || item.autoSpot || (text.includes('rail') && text.includes('spot')) || /\bspots?\s+led\b/.test(text));
}

function isTechnicalScreenItem(item = {}) {
  const text = `${item.type || ''} ${item.label || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return Boolean(item.type === 'screen' || item.dimensions?.isTelevision || text.includes('televiseur') || text.includes('television') || /\btv\b/.test(text));
}

function isObjectWallItem(item = {}) {
  return String(item?.wall || '').startsWith('object-wall:') || Boolean(item?.wallSurface?.orientation);
}

function objectWallSurfaceForTechnicalItem(item = {}) {
  const surface = item.wallSurface || null;
  if (!['x', 'z'].includes(surface?.orientation)) return null;
  const centerAxis = Number(surface.centerAxis ?? (surface.orientation === 'z' ? surface.centerZ : surface.centerX));
  const normalAxis = Number(surface.normalAxis ?? (surface.orientation === 'z' ? surface.centerX : surface.centerZ));
  const length = Number(surface.length);
  if (![centerAxis, normalAxis, length].every(Number.isFinite) || length <= 0) return null;
  return {
    ...surface,
    orientation: surface.orientation === 'z' ? 'z' : 'x',
    centerAxis,
    normalAxis,
    length,
  };
}

function objectWallSideForTechnicalItem(item = {}, surface = {}) {
  const outsideSide = protectedObjectOutsideSide(surface);
  if (outsideSide) return outsideSide;
  return Number(item.wallSide || 1) >= 0 ? 1 : -1;
}

function protectedObjectOutsideSide(surface = {}) {
  const bounds = surface?.protectedBounds;
  if (!bounds) return null;
  const normalAxis = Number(surface.normalAxis || 0);
  const center = surface.orientation === 'x'
    ? (Number(bounds.minZ || 0) + Number(bounds.maxZ || 0)) / 2
    : (Number(bounds.minX || 0) + Number(bounds.maxX || 0)) / 2;
  return normalAxis >= center ? 1 : -1;
}

function tvTechnicalLabel(item) {
  if (item.tvSize) return `TV ${item.tvSize}"`;
  if (item.label && /tv\\s*\\d+|\\d+\\s*["”]|pouce/i.test(item.label)) return item.label;
  return 'TV 43"';
}

function screenPositionLabel(item, width, depth) {
  if (isObjectWallItem(item)) {
    const surface = objectWallSurfaceForTechnicalItem(item);
    if (surface?.orientation === 'x') return `X ${signedMm(item.x)} / Z ${signedMm(surface.normalAxis)}`;
    if (surface?.orientation === 'z') return `X ${signedMm(surface.normalAxis)} / Z ${signedMm(item.x)}`;
  }
  if (item.wall === 'left') return `X ${signedMm(-width / 2)} / Z ${signedMm(item.x)}`;
  if (item.wall === 'right') return `X ${signedMm(width / 2)} / Z ${signedMm(item.x)}`;
  return `X ${signedMm(item.x)} / Z ${signedMm(-depth / 2)}`;
}

function drawDimension(ctx, x1, y1, x2, y2, label, orientation, color, fontSize = 15, backdrop = false) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  line(ctx, x1, y1, x2, y2);

  const arrow = 8;
  const labelBackground = (x, y) => {
    if (!backdrop) return;
    ctx.font = `${fontSize}px Arial`;
    const width = ctx.measureText(label).width + 8;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - width / 2, y - fontSize, width, fontSize + 4);
  };
  if (orientation === 'horizontal') {
    line(ctx, x1, y1, x1 + arrow, y1 - arrow);
    line(ctx, x1, y1, x1 + arrow, y1 + arrow);
    line(ctx, x2, y2, x2 - arrow, y2 - arrow);
    line(ctx, x2, y2, x2 - arrow, y2 + arrow);
    labelBackground((x1 + x2) / 2, y1 - 8);
    drawText(ctx, label, (x1 + x2) / 2, y1 - 8, fontSize, color, 'normal', 'center');
  } else {
    line(ctx, x1, y1, x1 - arrow, y1 + arrow);
    line(ctx, x1, y1, x1 + arrow, y1 + arrow);
    line(ctx, x2, y2, x2 - arrow, y2 - arrow);
    line(ctx, x2, y2, x2 + arrow, y2 - arrow);
    ctx.translate(x1 - 12, (y1 + y2) / 2);
    ctx.rotate(-Math.PI / 2);
    labelBackground(0, 0);
    drawText(ctx, label, 0, 0, fontSize, color, 'normal', 'center');
  }
  ctx.restore();
}

function drawBadge(ctx, x, y, label) {
  if (!label) return;
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

function technicalChildOptions(childOptions = {}, parentOptions = {}, parentDimensions = {}, index = 0) {
  const parentOptionReferences = Array.isArray(parentOptions.optionReferences) ? parentOptions.optionReferences : [];
  const childOptionReferences = Array.isArray(childOptions.optionReferences) ? childOptions.optionReferences : [];
  const inheritedVisuals = index === 0 ? {
    ...(parentDimensions.smclHeadSide ? { partitionHeadSide: parentDimensions.smclHeadSide } : {}),
    ...Object.fromEntries(['partitionHeadSide', 'headMainImageUrl', 'headMainImageName', 'visualPending', 'posterImageUrl', 'posterImageName', 'posterVisualPending'].filter((key) => hasTechnicalValue(parentOptions[key])).map((key) => [key, parentOptions[key]])),
    ...(hasTechnicalValue(parentOptions.binary3ImageUrl) ? { binary3ImageUrl: parentOptions.binary3ImageUrl } : {}),
    ...(hasTechnicalValue(parentOptions.binary3ImageName) ? { binary3ImageName: parentOptions.binary3ImageName } : {}),
    ...(hasTechnicalValue(parentOptions.binary3VisualPending) ? { binary3VisualPending: parentOptions.binary3VisualPending } : {}),
    ...(hasTechnicalValue(parentOptions.binary3Enabled) ? { binary3Enabled: parentOptions.binary3Enabled } : {}),
    ...(hasTechnicalValue(parentOptions.textureSlotValues) ? { textureSlotValues: { ...(childOptions.textureSlotValues || {}), ...(parentOptions.textureSlotValues || {}) } } : {}),
  } : {};

  return {
    ...childOptions,
    ...(hasTechnicalValue(parentOptions.binary2ColorName) ? { binary2ColorName: parentOptions.binary2ColorName } : {}),
    ...(hasTechnicalValue(parentOptions.binary2Color) ? { binary2Color: parentOptions.binary2Color } : {}),
    ...(hasTechnicalValue(parentOptions.binary2ColorPrice) ? { binary2ColorPrice: parentOptions.binary2ColorPrice } : {}),
    ...(hasTechnicalValue(parentOptions.variantColorSelections) ? { variantColorSelections: parentOptions.variantColorSelections } : {}),
    ...(parentOptionReferences.length ? { optionReferences: [...childOptionReferences, ...parentOptionReferences] } : {}),
    ...(parentOptions.variantBatPictoUrl || parentDimensions.batPictoUrl ? {
      variantBatPictoUrl: parentOptions.variantBatPictoUrl || parentDimensions.batPictoUrl || '',
      variantBatPictoPath: parentOptions.variantBatPictoPath || parentDimensions.batPictoPath || '',
      variantBatPictoReplaceColor: parentOptions.variantBatPictoReplaceColor || parentDimensions.batPictoReplaceColor || '',
      variantColorTargetHex: parentOptions.variantColorTargetHex || '',
    } : {}),
    ...(parentOptions.variantBatDescription || parentDimensions.batDescription ? {
      variantBatDescription: parentOptions.variantBatDescription || parentDimensions.batDescription || '',
    } : {}),
    ...Object.fromEntries(['batElectricalPictoUrl', 'batElectricalPictoPath', 'batElectricalPictoX', 'batElectricalPictoY', 'batElectricalPictoSize', 'batElectricalPictoSizeMeters']
      .filter((key) => hasTechnicalValue(parentOptions[key] ?? parentDimensions[key]))
      .map((key) => [key, parentOptions[key] ?? parentDimensions[key]])),
    ...(Array.isArray(parentOptions.batElectricalPictos ?? parentDimensions.batElectricalPictos)
      ? { batElectricalPictos: parentOptions.batElectricalPictos ?? parentDimensions.batElectricalPictos } : {}),
    ...inheritedVisuals,
  };
}

function hasTechnicalValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && value !== '';
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
  return (items || []).filter(Boolean).flatMap((item) => {
    // Wall-mounted assemblies use the parent's wall axis, not child floor coordinates.
    if (item.technicalHeadPlan || isWallItem(item) || !item.isGroup || !item.children?.length) return [item];
    const parentRotation = Number(item.rotation || 0);
    const radians = (parentRotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const parentLabel = item.label || catalog.find((entry) => entry.type === item.type)?.label || 'Groupe';

    return item.children.map((child, index) => {
      const childCatalog = catalog.find((entry) => entry.type === child.type) || {};
      const localX = Number(child.x || 0);
      const localZ = Number(child.z || 0);
      const parentOptions = item.options || {};
      const parentDimensions = item.dimensions || {};
      const inheritedOptions = technicalChildOptions(child.options || {}, parentOptions, parentDimensions, index);
      return {
        ...child,
        id: `${item.id}-${child.id || index}`,
        label: `${parentLabel} - ${child.label || childCatalog.label || child.type}`,
        x: Number(item.x || 0) + localX * cos + localZ * sin,
        y: Number(item.y || 0) + Number(child.y || 0),
        z: Number(item.z || 0) - localX * sin + localZ * cos,
        rotation: parentRotation + Number(child.rotation || 0),
        modelUrl: child.modelUrl || childCatalog.modelUrl,
        modelSize: child.modelSize || childCatalog.modelSize,
        color: child.color || childCatalog.color,
        options: inheritedOptions,
        dimensions: {
          ...(child.dimensions || {}),
          ...(index === 0 && parentDimensions.textureSlots && !child.dimensions?.textureSlots ? { textureSlots: parentDimensions.textureSlots } : {}),
          ...(parentDimensions.batPictoUrl ? { batPictoUrl: parentDimensions.batPictoUrl, batPictoPath: parentDimensions.batPictoPath || '' } : {}),
          ...(parentDimensions.batDescription ? { batDescription: parentDimensions.batDescription } : {}),
        },
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
  return ['screen', 'poster'].includes(item?.type) || Boolean(item?.wall && (item?.isWallItem || isLedRailItem(item)));
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
  if (item?.collisionEnabled === false || item?.dimensions?.collisionEnabled === false) return null;
  if (isWallItem(item)) {
    if ((item.wall || 'back') !== wall) return null;
    const axis = Number(item.x || 0);
    const entry = catalog.find((candidate) => candidate.type === item.type);
    const dims = itemDimensions(item, entry);
    const itemWidth = isTechnicalScreenItem(item) ? 0.95 : item.type === 'poster' ? Number(item.posterWidth || 1) : dims.width;
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

  if (item?.isGroup && item?.groupSize?.length >= 3) {
    return { width: Number(item.groupSize[0]), height: Number(item.groupSize[1]), depth: Number(item.groupSize[2]) };
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

function dimensionMm(meters) {
  return String(Math.round(Number(meters || 0) * 20) * 50);
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
  if (String(wall || '').startsWith('object-wall:')) return 'Mur reserve';
  if (wall === 'left') return 'Mur gauche';
  if (wall === 'right') return 'Mur droit';
  return 'Mur fond';
}
