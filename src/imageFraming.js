export const defaultImageFraming = Object.freeze({ imageZoom: 1, imageOffsetX: 0, imageOffsetY: 0 });

export function normalizeImageFraming(value = {}) {
  const zoom = Number(value.imageZoom);
  const offsetX = Number(value.imageOffsetX);
  const offsetY = Number(value.imageOffsetY);
  return {
    imageZoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(3, Math.max(0.5, zoom)) : 1,
    imageOffsetX: Number.isFinite(offsetX) ? Math.min(100, Math.max(-100, offsetX)) : 0,
    imageOffsetY: Number.isFinite(offsetY) ? Math.min(100, Math.max(-100, offsetY)) : 0,
  };
}

export function framedImageRect(imageWidth, imageHeight, targetWidth, targetHeight, options = {}) {
  const width = Math.max(1, Number(imageWidth) || 1);
  const height = Math.max(1, Number(imageHeight) || 1);
  const frameWidth = Math.max(1, Number(targetWidth) || 1);
  const frameHeight = Math.max(1, Number(targetHeight) || 1);
  const framing = normalizeImageFraming(options);
  const fitScale = options.fit === 'contain'
    ? Math.min(frameWidth / width, frameHeight / height)
    : Math.max(frameWidth / width, frameHeight / height);
  const drawWidth = width * fitScale * framing.imageZoom;
  const drawHeight = height * fitScale * framing.imageZoom;
  return {
    x: (frameWidth - drawWidth) / 2 + framing.imageOffsetX * frameWidth / 100,
    y: (frameHeight - drawHeight) / 2 + framing.imageOffsetY * frameHeight / 100,
    width: drawWidth,
    height: drawHeight,
  };
}
