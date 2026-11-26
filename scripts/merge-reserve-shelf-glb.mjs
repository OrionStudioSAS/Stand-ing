// Merges "Bloc 3 Étagères" and "Multiprise" (Blender GLB exports, millimetres) into one GLB, the power strip laid
// centred on the top shelf. Meshes, materials and textures are copied as they are (no re-encoding).
// Usage: node scripts/merge-reserve-shelf-glb.mjs <bloc.glb> <multiprise.glb> <out.glb>
import { readFile, writeFile } from 'node:fs/promises';

const [shelfPath, stripPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: merge-reserve-shelf-glb.mjs <bloc.glb> <multiprise.glb> <out.glb>');

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const bin = binHeader < buffer.length ? buffer.subarray(binHeader + 8, binHeader + 8 + buffer.readUInt32LE(binHeader)) : Buffer.alloc(0);
  return { json, bin };
}

const pad4 = (buffer, byte = 0) => (buffer.length % 4 ? Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4), byte)]) : buffer);

// World bounds of a scene whose nodes are flat (no hierarchy), from the POSITION accessors.
function worldBounds(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  json.nodes.filter((node) => node.mesh != null).forEach((node) => {
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const t = node.translation || [0, 0, 0];
    const rotate = ([x, y, z]) => {
      const ix = qw * x + qy * z - qz * y; const iy = qw * y + qz * x - qx * z; const iz = qw * z + qx * y - qy * x; const iw = -qx * x - qy * y - qz * z;
      return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
    };
    json.meshes[node.mesh].primitives.forEach((primitive) => {
      const accessor = json.accessors[primitive.attributes.POSITION];
      for (let corner = 0; corner < 8; corner += 1) {
        const point = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? accessor.max[axis] : accessor.min[axis]));
        rotate(point).forEach((value, axis) => { min[axis] = Math.min(min[axis], value + t[axis]); max[axis] = Math.max(max[axis], value + t[axis]); });
      }
    });
  });
  return { min, max };
}

// Shifts every glTF index of `json` so it can be appended after `base`.
function appendGlb(base, baseBin, add, addBin) {
  const offsetOf = (key) => (base[key] || []).length;
  const offsets = Object.fromEntries(['bufferViews', 'accessors', 'images', 'samplers', 'textures', 'materials', 'meshes', 'nodes'].map((key) => [key, offsetOf(key)]));
  const binOffset = pad4(baseBin).length;
  const remapTextureInfos = (value) => {
    if (Array.isArray(value)) return value.map(remapTextureInfos);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
      if (/Texture$/.test(key) && inner && typeof inner.index === 'number') return [key, { ...remapTextureInfos(inner), index: inner.index + offsets.textures }];
      return [key, remapTextureInfos(inner)];
    }));
  };
  const merged = { ...base };
  merged.bufferViews = [...(base.bufferViews || []), ...(add.bufferViews || []).map((view) => ({ ...view, buffer: 0, byteOffset: (view.byteOffset || 0) + binOffset }))];
  merged.accessors = [...(base.accessors || []), ...(add.accessors || []).map((accessor) => ({ ...accessor, ...(accessor.bufferView != null ? { bufferView: accessor.bufferView + offsets.bufferViews } : {}) }))];
  merged.images = [...(base.images || []), ...(add.images || []).map((image) => ({ ...image, ...(image.bufferView != null ? { bufferView: image.bufferView + offsets.bufferViews } : {}) }))];
  merged.samplers = [...(base.samplers || []), ...(add.samplers || [])];
  merged.textures = [...(base.textures || []), ...(add.textures || []).map((texture) => ({ ...texture,
    ...(texture.source != null ? { source: texture.source + offsets.images } : {}), ...(texture.sampler != null ? { sampler: texture.sampler + offsets.samplers } : {}) }))];
  merged.materials = [...(base.materials || []), ...(add.materials || []).map(remapTextureInfos)];
  merged.meshes = [...(base.meshes || []), ...(add.meshes || []).map((mesh) => ({ ...mesh, primitives: mesh.primitives.map((primitive) => ({
    ...primitive,
    attributes: Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, index + offsets.accessors])),
    ...(primitive.indices != null ? { indices: primitive.indices + offsets.accessors } : {}),
    ...(primitive.material != null ? { material: primitive.material + offsets.materials } : {}),
    ...(primitive.targets ? { targets: primitive.targets.map((target) => Object.fromEntries(Object.entries(target).map(([name, index]) => [name, index + offsets.accessors]))) } : {}),
  })) }))];
  const addedNodes = (add.nodes || []).map((node) => ({ ...node, ...(node.mesh != null ? { mesh: node.mesh + offsets.meshes } : {}),
    ...(node.children ? { children: node.children.map((child) => child + offsets.nodes) } : {}) }));
  merged.nodes = [...(base.nodes || []), ...addedNodes];
  merged.extensionsUsed = [...new Set([...(base.extensionsUsed || []), ...(add.extensionsUsed || [])])];
  const bin = Buffer.concat([pad4(baseBin), addBin]);
  merged.buffers = [{ byteLength: bin.length }];
  const addedRoots = (add.scenes?.[add.scene || 0]?.nodes || []).map((index) => index + offsets.nodes);
  return { json: merged, bin, addedRoots };
}

const shelf = readGlb(await readFile(shelfPath));
const strip = readGlb(await readFile(stripPath));
const shelfBounds = worldBounds(shelf.json);
const stripBounds = worldBounds(strip.json);
const centre = (bounds, axis) => (bounds.min[axis] + bounds.max[axis]) / 2;
// Power strip centred on the shelf in plan, its base on the top face of the top shelf (top of the model).
const shift = [centre(shelfBounds, 0) - centre(stripBounds, 0), shelfBounds.max[1] - stripBounds.min[1], centre(shelfBounds, 2) - centre(stripBounds, 2)];

const { json, bin, addedRoots } = appendGlb(shelf.json, shelf.bin, strip.json, strip.bin);
addedRoots.forEach((index) => {
  const t = json.nodes[index].translation || [0, 0, 0];
  json.nodes[index] = { ...json.nodes[index], translation: t.map((value, axis) => value + shift[axis]) };
});
json.scenes = [{ name: 'Bloc 3 Étagères + Multiprise', nodes: [...json.scenes[json.scene || 0].nodes, ...addedRoots] }];
json.scene = 0;
json.asset = { ...json.asset, generator: `${json.asset.generator || ''} + scripts/merge-reserve-shelf-glb.mjs`.trim() };

const jsonChunk = pad4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
const binChunk = pad4(bin);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHeader = (length, type) => { const buffer = Buffer.alloc(8); buffer.writeUInt32LE(length, 0); buffer.writeUInt32LE(type, 4); return buffer; };
await writeFile(outPath, Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]));

const out = worldBounds(json);
const size = out.max.map((value, axis) => value - out.min[axis]);
console.log(`${outPath}: ${size.map((v) => v.toFixed(1)).join(' × ')} (model units), strip at y ${shelfBounds.max[1].toFixed(1)}`);
