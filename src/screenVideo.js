import { CanvasTexture, SRGBColorSpace } from 'three';

// Multimedia screens (TV, touch kiosk, LED wall, digital counter) play a looping video
// instead of the still picture baked into their model, with the screen size drawn on top.
export const screenVideoUrl = '/media/ecran-loop.mp4';
export const screenPosterUrl = '/media/ecran-loop-poster.jpg';

const CANVAS_LONG_SIDE = 1280;
const FRAME_INTERVAL = 1000 / 30;

function normalize(value = '') {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function itemText(item = {}) {
  return normalize(`${item?.type || ''} ${item?.label || ''} ${item?.dimensions?.category || ''}`);
}

export function isScreenVideoItem(item = {}) {
  const text = itemText(item);
  if (text.includes('arche') || text.includes('sans tv')) return false;
  return /\btv\b|televiseur|ecran|borne tactile|mur led|comptoir numerique/.test(text);
}

// "TV 55", "TV 32\"", "TV 65\" - Sur Pied", "Borne Tactile 46\"" → 55\", 32\", 65\", 46\".
export function screenSizeLabel(item = {}) {
  const label = String(item?.options?.variantLabel || item?.label || '');
  const match = label.match(/(?:^|[^\d])(\d{2})(?:\s*(?:"|''|’|”|pouces?|inch(?:es)?))?(?![\d])/i);
  if (!match) return '';
  const size = Number(match[1]);
  return size >= 20 && size <= 99 ? `${size}"` : '';
}

// Screen surfaces carry the demo picture: SketchUp "_", "_2", "_3"… or "LED_5500k_n" materials.
export function isScreenVideoMaterial(materialName = '', material = null) {
  if (!material?.map) return false;
  const name = normalize(materialName).replace(/\.\d+$/, '');
  return /^_\d*$/.test(name) || /^led_5500k_\d+$/.test(name);
}

let video = null;
let poster = null;
let rafId = 0;
let lastDraw = 0;
const screens = new Map(); // "label|WxH" -> { canvas, ctx, label, textures, byMap }

function ensureMedia() {
  if (typeof document === 'undefined') return;
  if (!poster) {
    poster = new Image();
    poster.decoding = 'async';
    poster.onload = () => drawAll(true);
    poster.src = screenPosterUrl;
  }
  if (!video) {
    video = document.createElement('video');
    video.src = screenVideoUrl;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
    const play = () => video.play().catch(() => {});
    video.addEventListener('canplay', play, { once: true });
    // Autoplay can be refused until the first interaction: retry then.
    const resume = () => { if (video.paused) play(); };
    window.addEventListener('pointerdown', resume, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    play();
  }
  if (!rafId) rafId = window.requestAnimationFrame(tick);
}

function drawScreen(screen) {
  const { ctx, label } = screen;
  const CANVAS_WIDTH = screen.canvas.width;
  const CANVAS_HEIGHT = screen.canvas.height;
  const source = video && video.readyState >= 2 ? video : (poster?.complete && poster.naturalWidth ? poster : null);
  if (source) {
    const sw = source.videoWidth || source.naturalWidth;
    const sh = source.videoHeight || source.naturalHeight;
    const scale = Math.max(CANVAS_WIDTH / sw, CANVAS_HEIGHT / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(source, (CANVAS_WIDTH - dw) / 2, (CANVAS_HEIGHT - dh) / 2, dw, dh);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#1d3f8f');
    gradient.addColorStop(1, '#5b2a7a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
  if (!label) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(Math.min(CANVAS_HEIGHT * 0.3, CANVAS_WIDTH * 0.24))}px "Gotham", "Montserrat", "Arial Black", sans-serif`;
  ctx.shadowColor = 'rgba(8, 18, 48, 0.55)';
  ctx.shadowBlur = 36;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, CANVAS_WIDTH / 2, CANVAS_HEIGHT * 0.43);
  ctx.restore();
}

function refresh(screen) {
  // Every texture keeps its own version: bump each one that shows this canvas.
  screen.textures.forEach((texture) => { texture.needsUpdate = true; });
}

function drawAll(force = false) {
  screens.forEach((screen) => {
    if (!screen.textures.size) return;
    drawScreen(screen);
    refresh(screen);
  });
  if (force) lastDraw = performance.now();
}

function tick(now) {
  rafId = window.requestAnimationFrame(tick);
  if (!screens.size) return;
  const playing = video && !video.paused && video.readyState >= 2;
  if (!playing || now - lastDraw < FRAME_INTERVAL) return;
  lastDraw = now;
  drawAll();
}

// The canvas takes the proportions of the picture it replaces (16:9 TV, portrait LED wall…),
// so the video is cropped to fit instead of being stretched.
function screenFor(label, originalMap = null) {
  const image = originalMap?.image || originalMap?.source?.data;
  const sourceWidth = Number(image?.width || image?.videoWidth || 16);
  const sourceHeight = Number(image?.height || image?.videoHeight || 9);
  const ratio = Math.min(4, Math.max(0.25, sourceWidth / Math.max(1, sourceHeight)));
  const width = ratio >= 1 ? CANVAS_LONG_SIDE : Math.round(CANVAS_LONG_SIDE * ratio);
  const height = ratio >= 1 ? Math.round(CANVAS_LONG_SIDE / ratio) : CANVAS_LONG_SIDE;
  const key = `${label}|${width}x${height}`;
  if (!screens.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const screen = { canvas, ctx, label, textures: new Set(), byMap: new Map() };
    screens.set(key, screen);
    drawScreen(screen);
    if (document.fonts?.load) document.fonts.load('900 120px "Gotham"').then(() => { drawScreen(screen); refresh(screen); }).catch(() => {});
  }
  return screens.get(key);
}

// Texture for one screen material: it shares the canvas (and its updates) with every screen of
// the same size, and keeps the UV placement of the picture it replaces.
export function screenVideoTexture(item, originalMap = null) {
  if (typeof document === 'undefined') return null;
  ensureMedia();
  const screen = screenFor(screenSizeLabel(item), originalMap);
  // One texture per (size, source picture): models re-prepared on every edit reuse it.
  const cacheKey = originalMap?.uuid || 'none';
  const cached = screen.byMap.get(cacheKey);
  if (cached) return cached;
  const texture = new CanvasTexture(screen.canvas);
  screen.byMap.set(cacheKey, texture);
  texture.colorSpace = SRGBColorSpace;
  screen.textures.add(texture);
  texture.addEventListener('dispose', () => { screen.textures.delete(texture); screen.byMap.delete(cacheKey); });
  if (originalMap) {
    texture.flipY = originalMap.flipY;
    texture.wrapS = originalMap.wrapS;
    texture.wrapT = originalMap.wrapT;
    texture.repeat.copy(originalMap.repeat);
    texture.offset.copy(originalMap.offset);
    texture.center.copy(originalMap.center);
    texture.rotation = originalMap.rotation;
  }
  texture.needsUpdate = true;
  return texture;
}
