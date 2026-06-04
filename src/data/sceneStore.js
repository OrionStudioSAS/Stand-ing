import { demoScenes } from './seed.js';
import { supabase } from './supabaseClient.js';
import { catalog } from '../config/catalog.js';

const storageKey = 'standing-scenes-v1';

function normalizeSceneItem(item) {
  const catalogItem = catalog.find((entry) => entry.type === item.type);
  return {
    ...item,
    modelUrl: catalogItem?.modelUrl || item.modelUrl,
    modelSize: catalogItem?.modelSize || item.modelSize,
    color: catalogItem?.color || item.color,
  };
}

function catalogToObjectBankItem(item) {
  return {
    id: item.type,
    type: item.type,
    label: item.label,
    model_url: item.modelUrl,
    thumbnail_url: item.thumbnailUrl,
    dimensions: {
      ...(item.modelSize ? { size: item.modelSize } : {}),
      category: objectCategory(item.type),
      salons: item.type === 'obj-tabouret' ? ['SIAE'] : ['SMCL'],
    },
    is_active: true,
    created_at: null,
    updated_at: null,
  };
}

function objectCategory(type = '') {
  if (type.includes('screen')) return 'Multimédia';
  if (type.includes('cloison') || type.includes('porte')) return 'Sol & Cloisons';
  if (type.includes('tabouret') || type.includes('podium') || type.includes('meuble') || ['chair', 'table', 'counter'].includes(type)) return 'Mobilier';
  return 'Mobilier';
}

function readLocalScenes() {
  const existing = window.localStorage.getItem(storageKey);
  if (!existing) {
    window.localStorage.setItem(storageKey, JSON.stringify(demoScenes));
    return demoScenes;
  }

  try {
    return JSON.parse(existing);
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(demoScenes));
    return demoScenes;
  }
}

function writeLocalScenes(scenes) {
  window.localStorage.setItem(storageKey, JSON.stringify(scenes));
}

function dbSceneToScene(row) {
  return {
    ...row,
    client: row.clients || row.client || null,
    dimensions: row.dimensions || { width: row.width_m, depth: row.depth_m, height: row.height_m },
    items: (row.scene_items || []).map((item) => ({
      ...item.config,
      id: item.item_uid,
      type: item.type,
      x: Number(item.x),
      y: Number(item.y),
      z: Number(item.z),
      rotation: Number(item.rotation),
      wall: item.wall || item.config?.wall,
    })).map(normalizeSceneItem),
    files: row.scene_files || [],
  };
}

export async function listScenes(filters = {}) {
  if (!supabase) {
    return filterScenes(readLocalScenes(), filters);
  }

  let query = supabase
    .from('scenes')
    .select('*, scene_items(*), scene_files(*)')
    .order('created_at', { ascending: false });

  if (filters.salon) query = query.ilike('salon', `%${filters.salon}%`);
  if (filters.offer) query = query.ilike('offer', `%${filters.offer}%`);
  if (filters.status) query = query.eq('status', filters.status);

  const { data, error } = await query;
  if (error) throw error;
  return filterScenes(data.map(dbSceneToScene), { search: filters.search });
}

export async function getSceneByToken(token) {
  if (!supabase) {
    const scene = readLocalScenes().find((item) => item.share_token === token || item.id === token) || readLocalScenes()[0];
    return { ...scene, items: (scene.items || []).map(normalizeSceneItem) };
  }

  const { data, error } = await supabase
    .from('scenes')
    .select('*, scene_items(*), scene_files(*)')
    .eq('share_token', token)
    .single();

  if (error) throw error;
  return dbSceneToScene(data);
}

export async function saveScene(scene) {
  if (!supabase) {
    const scenes = readLocalScenes();
    const next = scenes.some((item) => item.id === scene.id)
      ? scenes.map((item) => (item.id === scene.id ? { ...item, ...scene } : item))
      : [scene, ...scenes];
    writeLocalScenes(next);
    return scene;
  }

  const payload = {
    id: scene.id,
    share_token: scene.share_token,
    monday_item_id: scene.monday_item_id,
    salon: scene.salon,
    offer: scene.offer,
    status: scene.status,
    client_status: scene.client_status,
    client_name: scene.client_name,
    client_email: scene.client_email,
    project_name: scene.project_name,
    event_name: scene.event_name,
    client_id: scene.client_id || null,
    width_m: scene.dimensions.width,
    depth_m: scene.dimensions.depth,
    height_m: scene.dimensions.height,
    layout: scene.layout,
    source_payload: scene.source_payload || {},
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('scenes').update(payload).eq('id', scene.id);
  if (error) throw error;

  await supabase.from('scene_items').delete().eq('scene_id', scene.id);
  if (scene.items?.length) {
    const { error: itemError } = await supabase.from('scene_items').insert(
      scene.items.map((item) => ({
        scene_id: scene.id,
        item_uid: item.id,
        type: item.type,
        label: item.label,
        x: item.x,
        y: item.y || 0,
        z: item.z,
        rotation: item.rotation || 0,
        wall: item.wall,
        config: item,
      }))
    );
    if (itemError) throw itemError;
  }

  return scene;
}

export async function syncMondayScenes() {
  if (!supabase) throw new Error('Supabase non configure.');

  const { data, error } = await supabase.functions.invoke('monday-sync', {
    body: {},
  });

  const functionError = await getFunctionError(error, data);
  if (functionError) throw functionError;
  return data;
}

export async function listClients(filters = {}) {
  if (!supabase) {
    return filterClients(groupScenesByClient(readLocalScenes()), filters);
  }

  const { data, error } = await supabase
    .from('clients')
    .select('*, scenes(*)')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return filterClients((data || []).map(dbClientToClient), filters);
}

export async function listSalons(filters = {}) {
  if (!supabase) {
    return filterSalons(groupLocalSalons(readLocalScenes()), filters);
  }

  const salonsResult = await supabase
    .from('salons')
    .select('*')
    .order('year', { ascending: false })
    .order('name', { ascending: true });

  if (salonsResult.error) {
    console.warn('Salon table unavailable, falling back to scenes.', salonsResult.error);
    const { data: scenesData, error: scenesError } = await supabase.from('scenes').select('*');
    if (scenesError) throw salonsResult.error;
    return filterSalons(groupLocalSalons((scenesData || []).map(dbSceneToScene)), filters);
  }

  const [offersResult, presetsResult, presetItemsResult, scenesResult] = await Promise.all([
    safeSalonQuery(supabase.from('salon_offers').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }), 'salon_offers'),
    safeSalonQuery(supabase.from('stand_presets').select('*').order('created_at', { ascending: true }), 'stand_presets'),
    safeSalonQuery(supabase.from('stand_preset_items').select('*'), 'stand_preset_items'),
    safeSalonQuery(supabase.from('scenes').select('*'), 'scenes'),
  ]);

  const salons = (salonsResult.data || []).map((salon) => dbSalonToSalon(
    salon,
    offersResult || [],
    attachPresetItems(presetsResult || [], presetItemsResult || []),
    scenesResult || []
  ));
  return filterSalons(salons, filters);
}

export async function requestSceneAccessCode(sceneToken) {
  if (!supabase) return { masked_email: 'mode local' };

  const { data, error } = await supabase.functions.invoke('scene-access-request', {
    body: { scene_token: sceneToken },
  });

  const functionError = await getFunctionError(error, data);
  if (functionError) throw functionError;
  return data;
}

export async function verifySceneAccessCode(sceneToken, code) {
  if (!supabase) return { local: true };

  const { data, error } = await supabase.functions.invoke('scene-access-verify', {
    body: { scene_token: sceneToken, code },
  });

  const functionError = await getFunctionError(error, data);
  if (functionError) throw functionError;
  if (!data?.access_token || !data?.refresh_token) throw new Error('Session de vérification absente.');

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;
  return data;
}

async function getFunctionError(error, data) {
  if (data?.error) return new Error(data.error);
  if (!error) return null;

  try {
    const payload = await error.context?.json?.();
    if (payload?.error) return new Error(payload.error);
  } catch {
    // Keep the original Supabase error if the response body cannot be parsed.
  }

  return error;
}

async function safeSalonQuery(query, label) {
  const { data, error } = await query;
  if (error) {
    console.warn(`Salon secondary query failed: ${label}`, error);
    return [];
  }
  return data || [];
}

export async function listObjectBank() {
  if (!supabase) return catalog.map(catalogToObjectBankItem);

  const { data, error } = await supabase
    .from('object_bank')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  const byType = new Map(catalog.map((item) => [item.type, catalogToObjectBankItem(item)]));
  return (data || []).map((item) => ({
    ...(byType.get(item.type) || {}),
    ...item,
    model_url: byType.get(item.type)?.model_url || item.model_url,
    thumbnail_url: item.thumbnail_url || byType.get(item.type)?.thumbnail_url,
    dimensions: {
      ...(byType.get(item.type)?.dimensions || {}),
      ...(item.dimensions || {}),
    },
  }));
}

export async function saveObjectBankItem(asset) {
  if (!supabase) return asset;

  const payload = {
    type: asset.type,
    label: asset.label,
    model_url: asset.model_url,
    thumbnail_url: asset.thumbnail_url,
    dimensions: asset.dimensions || {},
    is_active: asset.is_active,
  };
  const { data, error } = await supabase
    .from('object_bank')
    .upsert(payload, { onConflict: 'type' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function uploadObjectAssetFolder(files) {
  if (!supabase) throw new Error('Supabase non configure.');

  const fileList = Array.from(files || []).filter((file) => file?.name);
  if (!fileList.length) throw new Error('Selectionne un dossier contenant au moins un fichier 3D.');

  const objFile = fileList.find((file) => file.name.toLowerCase().endsWith('.obj'));
  const glbFile = fileList.find((file) => file.name.toLowerCase().endsWith('.glb'));
  const modelFile = objFile || glbFile;
  if (!modelFile) throw new Error('Le dossier doit contenir un fichier .obj ou .glb.');

  const rootFolder = getUploadRootFolder(fileList);
  const baseName = modelFile.name.replace(/\.[^.]+$/, '');
  const assetType = `asset-${slugifyAsset(baseName)}-${Date.now().toString(36)}`;
  const bucket = supabase.storage.from('object-assets');
  let modelPath = '';
  let materialPath = '';
  let totalBytes = 0;

  for (const file of fileList) {
    totalBytes += file.size || 0;
    const relativePath = getRelativeUploadPath(file, rootFolder);
    const storagePath = `${assetType}/${relativePath}`;
    const { error } = await bucket.upload(storagePath, file, {
      cacheControl: '31536000',
      contentType: guessContentType(file),
      upsert: true,
    });
    if (error) throw error;

    if (file === modelFile) modelPath = storagePath;
    if (!materialPath && file.name.toLowerCase().endsWith('.mtl')) materialPath = storagePath;
  }

  const { data: modelPublic } = bucket.getPublicUrl(modelPath);
  const { data: materialPublic } = materialPath ? bucket.getPublicUrl(materialPath) : { data: null };
  const textureCount = fileList.filter((file) => /\.(jpe?g|png|webp|gif|bmp|tga|tiff?)$/i.test(file.name)).length;

  return saveObjectBankItem({
    type: assetType,
    label: prettifyAssetLabel(baseName),
    model_url: modelPublic.publicUrl,
    thumbnail_url: null,
    is_active: true,
    dimensions: {
      addedBy: 'Admin Stand-ING',
      category: 'Mobilier',
      fileSizeMb: Number((totalBytes / 1024 / 1024).toFixed(1)),
      format: modelFile.name.toLowerCase().endsWith('.obj') ? 'OBJ' : 'GLB',
      folderName: rootFolder || null,
      uploadedFiles: fileList.length,
      textureCount,
      storageBucket: 'object-assets',
      storagePath: modelPath,
      materialUrl: materialPublic?.publicUrl || null,
      materialPath: materialPath || null,
    },
  });
}

function getUploadRootFolder(files) {
  const firstPath = files.find((file) => file.webkitRelativePath)?.webkitRelativePath || '';
  return firstPath.includes('/') ? firstPath.split('/')[0] : '';
}

function getRelativeUploadPath(file, rootFolder) {
  const rawPath = file.webkitRelativePath || file.name;
  const normalized = rawPath.replaceAll('\\', '/');
  if (rootFolder && normalized.startsWith(`${rootFolder}/`)) {
    return normalized.slice(rootFolder.length + 1);
  }
  return normalized;
}

function prettifyAssetLabel(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugifyAsset(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'objet-3d';
}

function guessContentType(file) {
  const extension = file.name.toLowerCase().split('.').pop();
  const types = {
    obj: 'text/plain',
    mtl: 'text/plain',
    glb: 'model/gltf-binary',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tga: 'image/x-tga',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return file.type || types[extension] || 'application/octet-stream';
}

export function sceneShareUrl(scene) {
  return `${window.location.origin}/?scene=${scene.share_token}`;
}

function dbClientToClient(row) {
  return {
    ...row,
    scenes: (row.scenes || []).map((scene) => ({
      ...scene,
      dimensions: { width: scene.width_m, depth: scene.depth_m, height: scene.height_m },
    })),
  };
}

function dbSalonToSalon(row, offers = [], presets = [], scenes = []) {
  const salonOffers = offers.filter((offer) => offer.salon_id === row.id);
  const salonPresets = presets.filter((preset) => preset.salon_id === row.id);
  const salonScenes = scenes.filter((scene) => scene.salon_id === row.id || scene.salon === row.name || scene.event_name === row.name);
  return {
    ...row,
    offers: salonOffers.map((offer) => ({
      ...offer,
      presets: salonPresets.filter((preset) => preset.offer_id === offer.id),
    })),
    presets: salonPresets,
    scenes: salonScenes.map((scene) => ({
      ...scene,
      dimensions: { width: scene.width_m, depth: scene.depth_m, height: scene.height_m },
    })),
  };
}

function attachPresetItems(presets, items) {
  return presets.map((preset) => ({
    ...preset,
    stand_preset_items: items.filter((item) => item.preset_id === preset.id),
  }));
}

function groupLocalSalons(scenes) {
  const groups = new Map();
  scenes.forEach((scene) => {
    const name = scene.event_name || scene.salon || 'Salon à définir';
    const key = name.toLowerCase();
    const current = groups.get(key) || {
      id: key,
      name,
      slug: key.replace(/\s+/g, '-'),
      year: Number(String(name).match(/\b(20\d{2})\b/)?.[1]) || new Date().getFullYear(),
      status: 'active',
      location: scene.source_payload?.location || 'Lieu à définir',
      starts_on: null,
      ends_on: null,
      cover_url: null,
      offers: [],
      presets: [],
      scenes: [],
    };
    current.scenes.push(scene);
    groups.set(key, current);
  });
  return [...groups.values()];
}

function filterSalons(salons, filters = {}) {
  const search = filters.search?.trim().toLowerCase();
  return salons.filter((salon) => {
    if (filters.status && salon.status !== filters.status) return false;
    if (!search) return true;
    const haystack = [
      salon.name,
      salon.slug,
      salon.location,
      salon.status,
      ...(salon.offers || []).map((offer) => offer.name),
      ...(salon.scenes || []).flatMap((scene) => [scene.client_name, scene.project_name, scene.salon, scene.offer]),
    ];
    return haystack.filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
  });
}

function groupScenesByClient(scenes) {
  const groups = new Map();
  scenes.forEach((scene) => {
    const email = scene.client_email?.trim().toLowerCase();
    const name = scene.client_name?.trim().toLowerCase();
    const key = email ? `email:${email}` : `name:${name || scene.id}`;
    const current = groups.get(key) || {
      id: key,
      client_key: key,
      display_name: scene.client_name || scene.client_email || 'Client sans nom',
      company_name: scene.client_name || '',
      email: scene.client_email || '',
      phone: '',
      commercial_name: scene.source_payload?.commercial_name || '',
      metadata: { source: 'local' },
      created_at: scene.created_at,
      updated_at: scene.updated_at,
      scenes: [],
    };
    current.scenes.push(scene);
    groups.set(key, current);
  });
  return [...groups.values()];
}

function filterClients(clients, filters = {}) {
  const search = filters.search?.trim().toLowerCase();
  return clients.filter((client) => {
    const scenes = client.scenes || [];
    if (filters.salon && !scenes.some((scene) => scene.salon?.toLowerCase().includes(filters.salon.toLowerCase()))) return false;
    if (filters.status && !scenes.some((scene) => scene.status === filters.status || scene.client_status === filters.status)) return false;
    if (!search) return true;

    const haystack = [
      client.display_name,
      client.company_name,
      client.email,
      client.phone,
      client.commercial_name,
      ...scenes.flatMap((scene) => [scene.client_name, scene.project_name, scene.salon, scene.offer, scene.client_email, scene.monday_item_id]),
    ];

    return haystack.filter(Boolean).some((value) => String(value).toLowerCase().includes(search));
  });
}

function filterScenes(scenes, filters = {}) {
  const search = filters.search?.trim().toLowerCase();
  return scenes.filter((scene) => {
    if (filters.salon && !scene.salon?.toLowerCase().includes(filters.salon.toLowerCase())) return false;
    if (filters.offer && !scene.offer?.toLowerCase().includes(filters.offer.toLowerCase())) return false;
    if (filters.status && scene.status !== filters.status) return false;
    if (!search) return true;

    return [scene.client_name, scene.project_name, scene.salon, scene.offer, scene.client_email]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(search));
  });
}
