import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260923082618_global_pack_definitions.sql', import.meta.url), 'utf8');
const sceneStore = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');

test('packs are global definitions with salon-specific activations', () => {
  assert.match(migration, /create table if not exists public\.packs/);
  assert.match(migration, /add column if not exists pack_id uuid references public\.packs\(id\) on delete cascade/);
  assert.match(migration, /salon_offers_salon_pack_idx[\s\S]*\(salon_id, pack_id\)/);
  assert.match(migration, /partition by lower\(offer\.slug\)/);
  assert.match(migration, /jsonb_build_object\('presetTemplates'/);
});

test('activating and editing a pack reuse the global configuration', () => {
  assert.match(sceneStore, /export async function createPackDefinition/);
  assert.match(sceneStore, /pack_id: pack\.id/);
  assert.match(sceneStore, /applyPackTemplatesToPresets\(pack, presets\)/);
  assert.match(sceneStore, /\.from\('salon_offers'\)[\s\S]*\.update\(\{ metadata: offerMetadata, updated_at: updatedAt \}\)[\s\S]*\.eq\('pack_id', pack\.id\)/);
  assert.match(sceneStore, /templates\[scene\.layout\]/);
});
