import { supabase } from './supabaseClient.js';
import { normalizeTechnicalPlanEdits } from '../technicalPlanEdits.js';

const localKey = (id) => `standing-bat-edits-${id}`;
const conflict = () => new Error('Ce BAT a été modifié par un autre administrateur. Fermez puis rouvrez-le avant de réessayer.');

export async function loadTechnicalPlanEdits(sceneId) {
  if (!sceneId) return { edits: normalizeTechnicalPlanEdits(), revision: 0 };
  if (!supabase) {
    const value = JSON.parse(window.localStorage.getItem(localKey(sceneId)) || 'null');
    return { edits: normalizeTechnicalPlanEdits(value?.edits), revision: value?.revision || 0 };
  }
  const { data, error } = await supabase.from('scene_bat_edits').select('edits, revision').eq('scene_id', sceneId).maybeSingle();
  if (error) throw error;
  return { edits: normalizeTechnicalPlanEdits(data?.edits), revision: data?.revision || 0 };
}

export async function saveTechnicalPlanEdits(sceneId, input, revision = 0) {
  if (!sceneId) throw new Error('Enregistrez la scène avant de modifier son BAT.');
  const edits = normalizeTechnicalPlanEdits(input);
  if (!supabase) {
    const current = await loadTechnicalPlanEdits(sceneId);
    if (current.revision !== revision) throw conflict();
    const saved = { edits, revision: revision + 1 };
    window.localStorage.setItem(localKey(sceneId), JSON.stringify(saved));
    return saved;
  }
  const query = revision === 0
    ? supabase.from('scene_bat_edits').insert({ scene_id: sceneId, edits })
    : supabase.from('scene_bat_edits').update({ edits }).eq('scene_id', sceneId).eq('revision', revision);
  const { data, error } = await query.select('edits, revision').maybeSingle();
  if (error?.code === '23505' || (!error && !data)) throw conflict();
  if (error) throw error;
  return { edits: normalizeTechnicalPlanEdits(data.edits), revision: data.revision };
}
