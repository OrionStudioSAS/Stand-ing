import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { demoScenes } from './seed.js';
import { supabase } from './supabaseClient.js';
import { catalog, layouts } from '../config/catalog.js';

const storageKey = 'standing-scenes-v1';
const fixedWallHeight = 2.5;

function normalizeSceneItem(item) {
  const catalogItem = catalog.find((entry) => entry.type === item.type);
  const isGroup = Boolean(item.isGroup || catalogItem?.isGroup);
  return {
    ...item,
    isGroup,
    groupSize: item.groupSize || catalogItem?.groupSize,
    children: isGroup ? normalizeGroupChildren(item.children || catalogItem?.children || []) : item.children,
    placementRule: item.placementRule || catalogItem?.placementRule,
    lockedPlacement: item.lockedPlacement ?? Boolean(item.placementRule || catalogItem?.placementRule?.locked),
    modelUrl: catalogItem?.modelUrl || item.modelUrl,
    modelSize: catalogItem?.modelSize || item.modelSize,
    materialUrl: catalogItem?.materialUrl || item.materialUrl || item.dimensions?.materialUrl,
    dimensions: {
      ...(catalogItem?.dimensions || {}),
      ...(item.dimensions || {}),
    },
    color: catalogItem?.color || item.color,
  };
}

function normalizeGroupChildren(children) {
  return children.map((child, index) => {
    const catalogItem = catalog.find((entry) => entry.type === child.type) || {};
    return {
      ...child,
      id: child.id || `${child.type}-child-${index + 1}`,
      label: child.label || catalogItem.label || child.type,
      modelUrl: child.modelUrl || catalogItem.modelUrl,
      modelSize: child.modelSize || catalogItem.modelSize,
      materialUrl: child.materialUrl || child.dimensions?.materialUrl || catalogItem.materialUrl,
      dimensions: {
        ...(catalogItem.dimensions || {}),
        ...(child.dimensions || {}),
      },
      color: child.color || catalogItem.color,
      x: Number(child.x || 0),
      y: Number(child.y || 0),
      z: Number(child.z || 0),
      rotation: Number(child.rotation || 0),
      lockedInGroup: true,
    };
  });
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
      salons: ['SMCL'],
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
    dimensions: row.dimensions ? { ...row.dimensions, height: fixedWallHeight } : { width: row.width_m, depth: row.depth_m, height: fixedWallHeight },
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
    height_m: fixedWallHeight,
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

export async function uploadSceneItemOptionImage(scene, item, file) {
  if (!file) throw new Error('Image introuvable.');
  if (!supabase) return fileToDataUrl(file);

  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'jpg';
  const safeSceneId = slugifyAsset(scene?.id || scene?.share_token || 'scene');
  const safeItemId = slugifyAsset(item?.id || item?.type || 'item');
  const safeName = slugifyAsset(file.name.replace(/\.[^.]+$/, ''));
  const storagePath = `scene-options/${safeSceneId}/${safeItemId}/${Date.now().toString(36)}-${safeName}.${extension}`;
  const bucket = supabase.storage.from('object-assets');
  const { error } = await bucket.upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type || `image/${extension}`,
    upsert: true,
  });
  if (error) throw error;

  const { data } = bucket.getPublicUrl(storagePath);
  return data.publicUrl;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  });
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

export async function syncSceneContactToMonday(scene, contactDetails) {
  if (!supabase) return { synced: false };

  const { data, error } = await supabase.functions.invoke('scene-contact-sync', {
    body: {
      sceneId: scene?.id,
      shareToken: scene?.share_token,
      contactDetails,
    },
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

  const [offersResult, presetsResult, presetItemsResult, scenesResult, sourcesResult] = await Promise.all([
    safeSalonQuery(supabase.from('salon_offers').select('*').order('display_order', { ascending: true }).order('name', { ascending: true }), 'salon_offers'),
    safeSalonQuery(supabase.from('stand_presets').select('*').order('created_at', { ascending: true }), 'stand_presets'),
    safeSalonQuery(supabase.from('stand_preset_items').select('*'), 'stand_preset_items'),
    safeSalonQuery(supabase.from('scenes').select('*'), 'scenes'),
    safeSalonQuery(supabase.from('monday_sources').select('*'), 'monday_sources'),
  ]);

  const salons = (salonsResult.data || []).map((salon) => dbSalonToSalon(
    salon,
    offersResult || [],
    attachPresetItems(presetsResult || [], presetItemsResult || []),
    scenesResult || [],
    sourcesResult || []
  ));
  return filterSalons(salons, filters);
}

export async function ensureSalonOffer(salon, packName) {
  const slug = slugifyAsset(packName);
  if (!supabase) {
    const offer = { id: `${salon.id}-${slug}`, salon_id: salon.id, slug, name: packName, presets: [], monday_source: null };
    const presets = makeLocalPreset(salon, offer);
    return { offer: { ...offer, presets }, preset: presets[0] || null };
  }

  const { data: offer, error: offerError } = await supabase
    .from('salon_offers')
    .upsert({
      salon_id: salon.id,
      slug,
      name: packName,
      display_order: packDisplayOrder(packName),
      included_description: `Pack ${packName} configure pour ${salon.name}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'salon_id,slug' })
    .select('*')
    .single();

  if (offerError) throw offerError;

  const presets = await ensurePresetForOffer(salon, offer);
  const mondaySource = await linkMondaySourceToOffer(salon, offer);
  return { offer: { ...offer, monday_source: mondaySource, presets }, preset: presets[0] || null };
}

export async function saveSalonOfferBaseItems(offer, baseItems = []) {
  if (!offer?.id) throw new Error('Pack introuvable.');
  const normalizedItems = normalizeBaseItems(baseItems);

  if (!supabase) {
    return {
      ...offer,
      metadata: {
        ...(offer.metadata || {}),
        baseItems: normalizedItems,
      },
    };
  }

  const { data, error } = await supabase
    .from('salon_offers')
    .update({
      metadata: {
        ...(offer.metadata || {}),
        baseItems: normalizedItems,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', offer.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

function normalizeBaseItems(baseItems = []) {
  return (baseItems || [])
    .map((item) => ({
      type: item.type,
      label: item.label,
      quantity: Math.max(0, Number(item.quantity || 0)),
    }))
    .filter((item) => item.type && item.quantity > 0);
}

export async function saveMondayBoardForPack(salon, packName, boardId) {
  const normalizedBoardId = String(boardId || '').trim();
  if (!normalizedBoardId) throw new Error('Ajoute un ID de board Monday.');

  if (!supabase) {
    return {
      id: `${salon.id}-${slugifyAsset(packName)}-monday`,
      salon: salonSourceLabel(salon),
      offer: packName,
      board_id: normalizedBoardId,
      is_active: true,
    };
  }

  const offer = (salon.offers || []).find((item) => normalizeKey(item.name) === normalizeKey(packName)) || null;
  const existing = await findMondaySourceForPack(salon, packName);

  if (existing) {
    const { data, error } = await supabase
      .from('monday_sources')
      .update({
        board_id: normalizedBoardId,
        salon_id: salon.id,
        offer_id: offer?.id || existing.offer_id || null,
        is_active: true,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('monday_sources')
    .insert({
      salon: salonSourceLabel(salon),
      offer: packName,
      board_id: normalizedBoardId,
      group_id: null,
      create_column_id: 'statut05',
      create_trigger_values: ['OUI', 'OK'],
      status_column_id: 'statut464',
      created_status_label: 'ENVOYE PAR MAIL',
      link_column_id: 'lien_scene',
      mapping: defaultMondayMappingForPack(),
      salon_id: salon.id,
      offer_id: offer?.id || null,
      is_active: true,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteStandPreset(preset) {
  if (!preset?.id) throw new Error('Preset introuvable.');
  if (!supabase) return true;

  if (preset.offer_id && preset.salon_id) {
    const { error } = await supabase
      .from('stand_presets')
      .delete()
      .eq('salon_id', preset.salon_id)
      .eq('offer_id', preset.offer_id);
    if (error) throw error;
    return true;
  }

  const { error } = await supabase.from('stand_presets').delete().eq('id', preset.id);
  if (error) throw error;
  return true;
}

export async function saveStandPresetConfig(preset, scene) {
  if (!supabase) return { ...preset, ...scene };

  const payload = {
    name: preset.name,
    description: preset.description || `Scene de base ${preset.name}`,
    width_m: scene.dimensions.width,
    depth_m: scene.dimensions.depth,
    height_m: fixedWallHeight,
    layout: scene.layout,
    base_config: {
      ...(preset.base_config || {}),
      options: scene.options || {},
      reserveRules: scene.reserveRules || scene.options?.reserveRules || preset.base_config?.reserveRules || {},
      partitionHeadRules: scene.partitionHeadRules || scene.options?.partitionHeadRules || preset.base_config?.partitionHeadRules || {},
      price_mode: 'included',
    },
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data: savedPreset, error: presetError } = await supabase
    .from('stand_presets')
    .update(payload)
    .eq('id', preset.id)
    .select('*')
    .single();

  if (presetError) throw presetError;

  const { error: deleteError } = await supabase.from('stand_preset_items').delete().eq('preset_id', preset.id);
  if (deleteError) throw deleteError;

  if (scene.items?.length) {
    const { error: itemError } = await supabase.from('stand_preset_items').insert(
      scene.items.map((item) => ({
        preset_id: preset.id,
        item_uid: item.id,
        type: item.type,
        label: item.label || catalog.find((entry) => entry.type === item.type)?.label || item.type,
        x: item.x,
        y: item.y || 0,
        z: item.z,
        rotation: item.rotation || 0,
        wall: item.wall,
        config: { ...item, included: true, priceMode: 'included', basePresetId: preset.id },
        included: true,
        price_mode: 'included',
      }))
    );
    if (itemError) throw itemError;
  }

  return {
    ...savedPreset,
    stand_preset_items: (scene.items || []).map((item) => ({
      preset_id: preset.id,
      item_uid: item.id,
      type: item.type,
      label: item.label,
      x: item.x,
      y: item.y || 0,
      z: item.z,
      rotation: item.rotation || 0,
      wall: item.wall,
      config: item,
      included: true,
      price_mode: 'included',
    })),
  };
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
  const mergedItems = (data || []).map((item) => ({
    ...(byType.get(item.type) || {}),
    ...item,
    model_url: byType.get(item.type)?.model_url || item.model_url,
    thumbnail_url: item.thumbnail_url || byType.get(item.type)?.thumbnail_url,
    dimensions: {
      ...(byType.get(item.type)?.dimensions || {}),
      ...(item.dimensions || {}),
    },
  }));

  return backfillObjectBankModelSizes(mergedItems);
}

export async function saveObjectBankItem(asset) {
  if (!supabase) return asset;
  const assignedSalons = Array.isArray(asset.dimensions?.salons) ? asset.dimensions.salons : null;

  const payload = {
    type: asset.type,
    label: asset.label,
    model_url: asset.model_url,
    thumbnail_url: asset.thumbnail_url,
    dimensions: asset.dimensions || {},
    is_active: assignedSalons ? assignedSalons.length > 0 : asset.is_active !== false,
  };
  const { data, error } = await supabase
    .from('object_bank')
    .upsert(payload, { onConflict: 'type' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteObjectBankItem(asset) {
  if (!supabase) return true;

  await deleteObjectAssetFiles(asset);

  const { error } = await supabase
    .from('object_bank')
    .delete()
    .eq('type', asset.type);

  if (error) throw error;
  return true;
}

async function deleteObjectAssetFiles(asset) {
  const bucketName = asset?.dimensions?.storageBucket;
  if (!bucketName) return;

  const bucket = supabase.storage.from(bucketName);
  const paths = new Set([
    asset.dimensions?.storagePath,
    asset.dimensions?.materialPath,
    ...(Array.isArray(asset.dimensions?.storagePaths) ? asset.dimensions.storagePaths : []),
  ].filter(Boolean));

  const rootPath = asset.dimensions?.storageRoot || asset.type;
  const listedPaths = await listStorageObjectPaths(bucket, rootPath);
  listedPaths.forEach((path) => paths.add(path));

  if (!paths.size) return;
  const { error } = await bucket.remove([...paths]);
  if (error) throw error;
}

async function listStorageObjectPaths(bucket, path) {
  const { data, error } = await bucket.list(path, { limit: 1000 });
  if (error || !data?.length) return [];

  const childPaths = await Promise.all(data.map(async (entry) => {
    const fullPath = `${path}/${entry.name}`;
    if (entry.id) return [fullPath];
    return listStorageObjectPaths(bucket, fullPath);
  }));

  return childPaths.flat();
}

export async function uploadObjectAssetFolder(files, profileImageFile = null) {
  if (!supabase) throw new Error('Supabase non configure.');

  const fileList = Array.from(files || []).filter((file) => file?.name && !isIgnoredAssetFile(file.name));
  if (!fileList.length) throw new Error('Selectionne un dossier contenant au moins un fichier 3D.');

  const objFile = fileList.find((file) => file.name.toLowerCase().endsWith('.obj'));
  const glbFile = fileList.find((file) => file.name.toLowerCase().endsWith('.glb'));
  const modelFile = objFile || glbFile;
  if (!modelFile) throw new Error('Le dossier doit contenir un fichier .obj ou .glb.');

  const rootFolder = getUploadRootFolder(fileList);
  const baseName = modelFile.name.replace(/\.[^.]+$/, '');
  const assetType = `asset-${slugifyAsset(baseName)}-${Date.now().toString(36)}`;
  const bucket = supabase.storage.from('object-assets');
  const uploadEntries = makeUniqueStorageEntries(fileList.map((file) => {
    const relativePath = getRelativeUploadPath(file, rootFolder);
    return {
      file,
      originalRelativePath: relativePath,
      sanitizedRelativePath: sanitizeStoragePath(relativePath),
    };
  }));
  const referenceRules = buildAssetReferenceRules(uploadEntries);
  const modelSize = await readUploadedModelSize(modelFile);
  let modelPath = '';
  let materialPath = '';
  let totalBytes = 0;

  for (const entry of uploadEntries) {
    const { file } = entry;
    totalBytes += file.size || 0;
    const storagePath = `${assetType}/${entry.sanitizedRelativePath}`;
    const uploadBody = await prepareAssetUploadBody(entry, referenceRules);
    const { error } = await bucket.upload(storagePath, uploadBody, {
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
  const thumbnailFile = profileImageFile || findProfileImageFile(fileList);
  const thumbnail = thumbnailFile ? await uploadObjectAssetThumbnailFile(assetType, thumbnailFile, bucket) : null;

  return saveObjectBankItem({
    type: assetType,
    label: prettifyAssetLabel(baseName),
    model_url: modelPublic.publicUrl,
    thumbnail_url: thumbnail?.publicUrl || null,
    is_active: true,
    dimensions: {
      addedBy: 'Admin Stand-ING',
      category: 'Mobilier',
      fileSizeMb: Number((totalBytes / 1024 / 1024).toFixed(1)),
      format: modelFile.name.toLowerCase().endsWith('.obj') ? 'OBJ' : 'GLB',
      ...(modelSize ? { size: modelSize, sizeSource: 'obj-vertices' } : {}),
      folderName: rootFolder || null,
      uploadedFiles: fileList.length,
      textureCount,
      storageBucket: 'object-assets',
      storageRoot: assetType,
      storagePath: modelPath,
      storagePaths: uploadEntries.map((entry) => `${assetType}/${entry.sanitizedRelativePath}`),
      materialUrl: materialPublic?.publicUrl || null,
      materialPath: materialPath || null,
      thumbnailPath: thumbnail?.path || null,
    },
  });
}

export async function uploadObjectAssetThumbnail(asset, file) {
  if (!supabase) throw new Error('Supabase non configure.');
  if (!asset?.type) throw new Error('Objet introuvable.');
  if (!file || !isProfileImageFile(file)) throw new Error('Selectionne une image JPG, PNG ou WebP.');

  const bucket = supabase.storage.from('object-assets');
  const thumbnail = await uploadObjectAssetThumbnailFile(asset.type, file, bucket);
  const previousPath = asset.dimensions?.thumbnailPath;
  if (previousPath && previousPath !== thumbnail.path) {
    bucket.remove([previousPath]).then(({ error }) => {
      if (error) console.warn('Ancienne vignette non supprimee', error);
    });
  }

  return {
    ...asset,
    thumbnail_url: thumbnail.publicUrl,
    dimensions: {
      ...(asset.dimensions || {}),
      storageBucket: asset.dimensions?.storageBucket || 'object-assets',
      storageRoot: asset.dimensions?.storageRoot || asset.type,
      thumbnailPath: thumbnail.path,
    },
  };
}

async function uploadObjectAssetThumbnailFile(assetType, file, bucket) {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || 'jpg';
  const path = `${assetType}/profile-${Date.now().toString(36)}.${extension}`;
  const { error } = await bucket.upload(path, file, {
    cacheControl: '31536000',
    contentType: guessContentType(file),
    upsert: true,
  });
  if (error) throw error;
  const { data } = bucket.getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

function findProfileImageFile(files) {
  return (files || []).find((file) => {
    if (!isProfileImageFile(file)) return false;
    const name = getUploadFileName(file.name || file.webkitRelativePath).toLowerCase();
    return /(^|[-_\s])(profile|profil|thumbnail|thumb|cover|preview|vignette)([-_\s.]|$)/i.test(name);
  }) || null;
}

function isProfileImageFile(file) {
  return /\.(jpe?g|png|webp)$/i.test(file?.name || '');
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

function sanitizeStoragePath(path) {
  const normalized = String(path || 'asset').replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.map((segment, index) => sanitizeStorageSegment(segment, index === segments.length - 1)).join('/') || 'asset';
}

function sanitizeStorageSegment(segment, isFile = false) {
  const normalized = String(segment || 'asset').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const extensionMatch = isFile ? normalized.match(/(\.[a-z0-9]{1,8})$/i) : null;
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
  const baseName = extension ? normalized.slice(0, -extension.length) : normalized;
  const safeBase = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 96);
  return `${safeBase || 'asset'}${extension}`;
}

function makeUniqueStorageEntries(entries) {
  const usedPaths = new Set();
  return entries.map((entry) => {
    let candidate = entry.sanitizedRelativePath || 'asset';
    if (usedPaths.has(candidate)) {
      const extension = candidate.match(/(\.[a-z0-9]{1,8})$/i)?.[1] || '';
      const base = extension ? candidate.slice(0, -extension.length) : candidate;
      let index = 2;
      while (usedPaths.has(`${base}-${index}${extension}`)) index += 1;
      candidate = `${base}-${index}${extension}`;
    }
    usedPaths.add(candidate);
    return { ...entry, sanitizedRelativePath: candidate };
  });
}

function buildAssetReferenceRules(entries) {
  const rules = new Map();
  const addRule = (from, to) => {
    const source = String(from || '').replaceAll('\\', '/');
    const target = String(to || '').replaceAll('\\', '/');
    if (!source || !target || source === target) return;
    for (const variant of new Set([source, source.normalize('NFC'), source.normalize('NFD')])) {
      if (variant && variant !== target) rules.set(variant, target);
    }
  };

  for (const entry of entries) {
    const originalPath = entry.originalRelativePath;
    const sanitizedPath = entry.sanitizedRelativePath;
    const originalName = getUploadFileName(originalPath);
    const sanitizedName = getUploadFileName(sanitizedPath);
    addRule(originalPath, sanitizedPath);
    addRule(`./${originalPath}`, `./${sanitizedPath}`);
    addRule(originalName, sanitizedName);
  }

  return Array.from(rules, ([from, to]) => ({ from, to })).sort((a, b) => b.from.length - a.from.length);
}

function getUploadFileName(path) {
  return String(path || '').replaceAll('\\', '/').split('/').pop() || '';
}

async function prepareAssetUploadBody(entry, referenceRules) {
  if (!/\.(obj|mtl)$/i.test(entry.file.name)) return entry.file;
  const text = await entry.file.text();
  const rewritten = rewriteKnownAssetReferences(text, referenceRules);
  return new Blob([rewritten], { type: guessContentType(entry.file) });
}

async function readUploadedModelSize(file) {
  const name = file?.name?.toLowerCase() || '';
  try {
    if (name.endsWith('.obj')) return parseObjModelSize(await file.text());
    if (name.endsWith('.glb')) return parseGlbModelSize(await file.arrayBuffer());
  } catch {
    return null;
  }
  return null;
}

async function readRemoteModelSize(url) {
  const cleanUrl = String(url || '').toLowerCase().split('?')[0];
  if (!cleanUrl.endsWith('.obj') && !cleanUrl.endsWith('.glb')) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    if (cleanUrl.endsWith('.obj')) return parseObjModelSize(await response.text());
    return parseGlbModelSize(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function backfillObjectBankModelSizes(items) {
  if (!supabase) return items;

  const repairedItems = await Promise.all((items || []).map(async (item) => {
    if (!shouldBackfillModelSize(item)) return item;
    const measuredSize = await readRemoteModelSize(item.model_url);
    if (!measuredSize) return item;

    const dimensions = {
      ...(item.dimensions || {}),
      size: measuredSize,
      sizeSource: 'obj-vertices',
    };
    const repairedItem = { ...item, dimensions };

    if (isAdminRoute()) {
      supabase
        .from('object_bank')
        .update({ dimensions })
        .eq('type', item.type)
        .then(({ error }) => {
          if (error) console.warn('Object bank size backfill failed', item.type, error);
        });
    }

    return repairedItem;
  }));

  return repairedItems;
}

function shouldBackfillModelSize(item) {
  const modelUrl = item?.model_url?.toLowerCase().split('?')[0] || '';
  if (!modelUrl.endsWith('.obj') && !modelUrl.endsWith('.glb')) return false;
  if (item.dimensions?.isGroup) return false;
  if (item.dimensions?.sizeSource === 'manual') return false;
  if (item.dimensions?.sizeSource === 'name') return true;
  const size = item.dimensions?.size || item.dimensions?.dimensions || item.dimensions?.modelSize;
  if (!Array.isArray(size) || size.length < 3) return true;
  const normalized = size.map(Number);
  return normalized.every((value) => value === 1);
}

function isAdminRoute() {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.replace(/\/$/, '') === '/admin' || new URLSearchParams(window.location.search).get('admin') === '1';
}

function parseGlbModelSize(arrayBuffer) {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.parse(arrayBuffer, '', (gltf) => {
      const scene = gltf?.scene || gltf?.scenes?.[0];
      if (!scene) {
        resolve(null);
        return;
      }

      scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(scene);
      const size = box.getSize(new Vector3());
      resolve(normalizeMeasuredModelSize([size.x, size.y, size.z]));
    }, () => resolve(null));
  });
}

function normalizeMeasuredModelSize(size) {
  if (!Array.isArray(size) || size.length < 3) return null;
  const values = size.map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  // Most exports are in meters. Very large values usually mean millimeters.
  const divisor = Math.max(...values) > 100 ? 1000 : 1;
  return values.map((value) => Number(Math.max(0.05, value / divisor).toFixed(2)));
}

function parseObjModelSize(text) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertexCount = 0;

  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('v ')) continue;
    const parts = trimmed.split(/\s+/).slice(1, 4).map(Number);
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) continue;
    vertexCount += 1;
    parts.forEach((value, index) => {
      min[index] = Math.min(min[index], value);
      max[index] = Math.max(max[index], value);
    });
  }

  if (!vertexCount) return null;
  const size = max.map((value, index) => value - min[index]);
  if (size.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  return normalizeMeasuredModelSize(size);
}


function rewriteKnownAssetReferences(text, referenceRules) {
  let rewritten = text;
  for (const { from, to } of referenceRules) {
    rewritten = rewritten.split(from).join(to);
    rewritten = rewritten.split(encodeURI(from)).join(encodeURI(to));
  }

  // Some SketchUp exports keep stale texture folders in the MTL. Repoint by
  // filename, preferring the sanitized subfolder path when the texture lives there.
  const rulesByFileName = buildFileNameReferenceMap(referenceRules);
  return rewritten.split('\n').map((line) => rewriteAssetReferenceLine(line, rulesByFileName)).join('\n');
}

function buildFileNameReferenceMap(referenceRules) {
  const map = new Map();
  for (const rule of referenceRules) {
    const fileName = getUploadFileName(rule.from).toLowerCase();
    if (!fileName) continue;

    const current = map.get(fileName);
    const currentHasPath = current?.includes('/');
    const nextHasPath = rule.to.includes('/');
    if (!current || (nextHasPath && !currentHasPath) || rule.to.length > current.length) {
      map.set(fileName, rule.to);
    }
  }
  return map;
}

function rewriteAssetReferenceLine(line, rulesByFileName) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(mtllib|map_[a-z0-9_]+|bump|disp|decal|refl)\s+(.+)$/i);
  if (!match) return line;

  const value = match[2].trim();
  const normalizedValue = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const replacement = Array.from(rulesByFileName.entries()).find(([fileName]) => normalizedValue.includes(fileName))?.[1];
  if (!replacement || value === replacement) return line;

  return `${match[1]} ${replacement}`;
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

function isIgnoredAssetFile(name) {
  return ['.ds_store', 'thumbs.db'].includes(String(name || '').toLowerCase());
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
      dimensions: { width: scene.width_m, depth: scene.depth_m, height: fixedWallHeight },
    })),
  };
}

function dbSalonToSalon(row, offers = [], presets = [], scenes = [], sources = []) {
  const salonOffers = offers.filter((offer) => offer.salon_id === row.id);
  const salonPresets = presets.filter((preset) => preset.salon_id === row.id);
  const salonScenes = scenes.filter((scene) => scene.salon_id === row.id || scene.salon === row.name || scene.event_name === row.name);
  const salonSources = sources.filter((source) => sourceMatchesSalon(source, row));
  return {
    ...row,
    offers: salonOffers.map((offer) => ({
      ...offer,
      monday_source: salonSources.find((source) => sourceMatchesOffer(source, offer)) || null,
      presets: salonPresets.filter((preset) => preset.offer_id === offer.id),
    })),
    presets: salonPresets,
    monday_sources: salonSources,
    scenes: salonScenes.map((scene) => ({
      ...scene,
      dimensions: { width: scene.width_m, depth: scene.depth_m, height: fixedWallHeight },
    })),
  };
}

async function ensurePresetForOffer(salon, offer) {
  const { data: existing, error: findError } = await supabase
    .from('stand_presets')
    .select('*')
    .eq('salon_id', salon.id)
    .eq('offer_id', offer.id)
    .eq('is_active', true);

  if (findError) throw findError;
  const existingByLayout = new Map((existing || []).map((preset) => [preset.layout || 'u', { ...preset, stand_preset_items: [] }]));
  const missingLayouts = layouts.filter((layout) => !existingByLayout.has(layout.id));

  if (missingLayouts.length) {
    const { data: created, error: insertError } = await supabase
      .from('stand_presets')
      .insert(missingLayouts.map((layout) => ({
        salon_id: salon.id,
        offer_id: offer.id,
        name: `Scene de base ${offer.name} - ${salon.name} - ${layout.label}`,
        description: `Objets inclus et placement de base pour ${offer.name} sur ${salon.name} (${layout.label})`,
        width_m: 5,
        depth_m: 5,
        height_m: 2.5,
        layout: layout.id,
        base_config: { price_mode: 'included', layout_reference: layout.id },
        is_active: true,
      })))
      .select('*');

    if (insertError) throw insertError;
    (created || []).forEach((preset) => existingByLayout.set(preset.layout || 'u', { ...preset, stand_preset_items: [] }));
  }

  const presets = layouts.map((layout) => existingByLayout.get(layout.id)).filter(Boolean);
  return attachPresetItems(presets, await fetchPresetItems(presets));
}

async function fetchPresetItems(presets = []) {
  const presetIds = presets.map((preset) => preset.id).filter(Boolean);
  if (!presetIds.length) return [];

  const { data, error } = await supabase
    .from('stand_preset_items')
    .select('*')
    .in('preset_id', presetIds);

  if (error) throw error;
  return data || [];
}

function makeLocalPreset(salon, offer) {
  return layouts.map((layout) => ({
    id: `${offer.id}-preset-${layout.id}`,
    salon_id: salon.id,
    offer_id: offer.id,
    name: `Scene de base ${offer.name} - ${salon.name} - ${layout.label}`,
    width_m: 5,
    depth_m: 5,
    height_m: 2.5,
    layout: layout.id,
    base_config: { layout_reference: layout.id },
    stand_preset_items: [],
  }));
}

async function linkMondaySourceToOffer(salon, offer) {
  const existing = await findMondaySourceForPack(salon, offer.name);
  if (!existing) return null;

  const { data, error } = await supabase
    .from('monday_sources')
    .update({ salon_id: salon.id, offer_id: offer.id })
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function findMondaySourceForPack(salon, packName) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('monday_sources')
    .select('*')
    .eq('offer', packName);
  if (error) throw error;
  return (data || []).find((source) => sourceMatchesSalon(source, salon)) || null;
}

function sourceMatchesSalon(source, salon) {
  if (!source || !salon) return false;
  if (source.salon_id && source.salon_id === salon.id) return true;
  return normalizeKey(source.salon) === normalizeKey(salonSourceLabel(salon));
}

function sourceMatchesOffer(source, offer) {
  if (!source || !offer) return false;
  if (source.offer_id && source.offer_id === offer.id) return true;
  return normalizeKey(source.offer) === normalizeKey(offer.name);
}

function salonSourceLabel(salon) {
  return String(salon?.name || salon?.salon || 'Salon')
    .replace(/\s*20\d{2}\b/, '')
    .split(/[—/-]/)[0]
    .trim() || 'Salon';
}

function normalizeKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function defaultMondayMappingForPack() {
  return {
    client_name: ['texte2', 'texte8'],
    client_email: 'email',
    width_m: 'chiffres',
    depth_m: 'chiffres9',
  };
}

function packDisplayOrder(packName = '') {
  const key = packName.trim().toLowerCase();
  if (key === 'confort') return 10;
  if (key === 'business') return 20;
  if (key === 'siae') return 25;
  if (key === 'prestige') return 30;
  return 99;
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
