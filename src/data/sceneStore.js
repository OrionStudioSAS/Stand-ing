import { demoScenes } from './seed.js';
import { supabase } from './supabaseClient.js';

const storageKey = 'standing-scenes-v1';

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
    })),
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
    return readLocalScenes().find((scene) => scene.share_token === token || scene.id === token) || readLocalScenes()[0];
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
    width_m: scene.dimensions.width,
    depth_m: scene.dimensions.depth,
    height_m: scene.dimensions.height,
    layout: scene.layout,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('scenes').upsert(payload);
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

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export function sceneShareUrl(scene) {
  return `${window.location.origin}${window.location.pathname}?scene=${scene.share_token}`;
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
