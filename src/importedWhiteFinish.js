import { Material, MeshStandardMaterial } from 'three';

export function studioWhiteFinishMaterial(material, item = {}) {
  if (!material?.isMeshPhongMaterial || !material.color) return material;
  const text = `${item?.type || ''} ${item?.label || ''} ${material.name || ''}`
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (!/\b(?:blanc(?:he)?s?|white)\b/.test(text)) return material;
  const channels = [material.color.r, material.color.g, material.color.b];
  if (Math.min(...channels) < .45 || Math.max(...channels) - Math.min(...channels) > .06) return material;
  if (material.opacity < .95 || /glass|verre/i.test(material.name || '')) return material;

  // Phong ignores scene.environment; PBR lets white finishes receive studio fill light.
  const next = new MeshStandardMaterial();
  Material.prototype.copy.call(next, material);
  for (const key of [
    'color', 'map', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity',
    'emissive', 'emissiveIntensity', 'emissiveMap', 'bumpMap', 'bumpScale',
    'normalMap', 'normalMapType', 'normalScale', 'displacementMap',
    'displacementScale', 'displacementBias', 'alphaMap', 'envMap',
    'wireframe', 'wireframeLinewidth', 'flatShading', 'fog',
  ]) {
    if (material[key] === undefined) continue;
    const value = material[key];
    next[key] = value?.isColor || value?.isVector2 ? value.clone() : value;
  }
  next.metalness = 0;
  next.roughness = Math.min(1, Math.max(.5, Math.sqrt(2 / (Math.max(0, Number(material.shininess) || 0) + 2))));
  return next;
}
