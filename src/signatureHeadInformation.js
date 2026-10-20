// Signature artwork: 500 × 350 mm, matching the supplied TDC template.
export const signatureHeadCanvasSize = { width: 1400, height: 980 };
export function signatureHeadSide(item = {}) {
  const side = item.options?.partitionHeadSide || item.dimensions?.smclHeadSide;
  if (side === 'left' || side === 'right') return side;
  return /droite|right/i.test(`${item.label || ''} ${item.type || ''}`) ? 'right' : 'left';
}
function font(weight, size) { return `${weight} ${size}px "Gotham", sans-serif`; }
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
export function drawSignatureHeadInformation(ctx, visualContext = {}, item = {}) {
  const { width, height } = signatureHeadCanvasSize;
  const company = String(visualContext.company || 'NOM EXPOSANT').trim().toUpperCase() || 'NOM EXPOSANT';
  const stand = String(visualContext.standNumber || '').replace(/^stand\s+/i, '').trim().toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#140e0c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Fit within the central area, including long names and single unbroken words.
  let size = 144, lines;
  do {
    ctx.font = font(500, size);
    lines = wrap(ctx, company, 1050);
    if (lines.length <= 3 && lines.every(line => ctx.measureText(line).width <= 1050) && lines.length * size * 1.1 <= 420) break;
    size -= 1;
  } while (size > 1);
  const lineHeight = size * 1.1;
  const firstBaseline = 480 - (lines.length - 1) * lineHeight / 2 + size * 0.35;
  lines.forEach((line, index) => ctx.fillText(line, width / 2, firstBaseline + index * lineHeight));
  // The alignment is tied to the head's side, independently of its wall/rotation.
  ctx.fillStyle = '#f25723';
  ctx.textAlign = signatureHeadSide(item) === 'right' ? 'right' : 'left';
  let standSize = 130;
  do { ctx.font = font(900, standSize); if (ctx.measureText(stand).width <= 600) break; standSize -= 1; } while (standSize > 1);
  ctx.fillText(stand, ctx.textAlign === 'right' ? width - 70 : 70, height - 70);
  return { company, stand, side: signatureHeadSide(item), lines, companyFontSize: size };
}
