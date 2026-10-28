const recoloredImageCache = new Map();
const sampledImageColors = new Map();

export function averageOpaquePixelColor(data) {
  let alpha = 0;
  const channels = [0, 0, 0];
  for (let index = 0; index < data.length; index += 4) {
    const weight = data[index + 3] / 255;
    alpha += weight;
    for (let channel = 0; channel < 3; channel += 1) channels[channel] += data[index + channel] * weight;
  }
  if (!alpha) throw new Error('La texture de couleur est entièrement transparente.');
  return `#${channels.map(value => Math.round(value / alpha).toString(16).padStart(2, '0')).join('')}`;
}

export async function sampleImageColor(url) {
  if (!sampledImageColors.has(url)) {
    const request = (async () => {
      const response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Texture HTTP ${response.status}`);
      const image = await imageFromBlob(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Impossible de lire la texture de couleur.');
      // Sample the central surface, avoiding borders and averaging the material grain.
      context.drawImage(image, image.naturalWidth * .1, image.naturalHeight * .1, image.naturalWidth * .8, image.naturalHeight * .8, 0, 0, 24, 24);
      return averageOpaquePixelColor(context.getImageData(0, 0, 24, 24).data);
    })().catch(error => { sampledImageColors.delete(url); throw error; });
    sampledImageColors.set(url, request);
  }
  return sampledImageColors.get(url);
}

export function normalizeHexColor(value = '') {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map((char) => `${char}${char}`).join('').toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return '';
}

export function recolorSvgMarkup(markup = '', sourceColor = '', targetColor = '') {
  const source = normalizeHexColor(sourceColor);
  const target = normalizeHexColor(targetColor);
  if (!source || !target || source === target) return String(markup || '');
  // Illustrator often writes #f0f even when the configured source is #ff00ff.
  // Match paint declarations only, leaving SVG IDs and gradient references intact.
  const paint = /(\b(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*(?:=\s*["']\s*|:\s*))(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])/gi;
  return String(markup || '').replace(paint, (match, prefix, color) => normalizeHexColor(color) === source ? `${prefix}${target}` : match);
}

export function recolorPixelData(data, sourceColor = '', targetColor = '', tolerance = 36) {
  const source = hexToRgb(sourceColor);
  const target = hexToRgb(targetColor);
  if (!source || !target || !data?.length) return data;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    if (
      Math.abs(data[index] - source.r) <= tolerance
      && Math.abs(data[index + 1] - source.g) <= tolerance
      && Math.abs(data[index + 2] - source.b) <= tolerance
    ) {
      data[index] = target.r;
      data[index + 1] = target.g;
      data[index + 2] = target.b;
    }
  }
  return data;
}

export function recoloredImageCacheKey(url = '', sourceColor = '', targetColor = '') {
  return `${url}|${normalizeHexColor(sourceColor)}>${normalizeHexColor(targetColor)}`;
}

export async function recolorImageUrl(url = '', sourceColor = '', targetColor = '') {
  const source = normalizeHexColor(sourceColor);
  const target = normalizeHexColor(targetColor);
  if (!url || !source || !target || source === target) return url;
  const key = recoloredImageCacheKey(url, source, target);
  if (!recoloredImageCache.has(key)) {
    recoloredImageCache.set(key, createRecoloredImageUrl(url, source, target).catch(() => url));
  }
  return recoloredImageCache.get(key);
}

async function createRecoloredImageUrl(url, sourceColor, targetColor) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (/svg/i.test(contentType) || /\.svg(?:$|[?#])/i.test(url)) {
    const markup = recolorSvgMarkup(await response.text(), sourceColor, targetColor);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }

  const image = await imageFromBlob(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) throw new Error('Image non exploitable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixelData(pixels.data, sourceColor, targetColor);
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

function imageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image illisible'));
    };
    image.src = objectUrl;
  });
}

function hexToRgb(value = '') {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}
