import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261006113055_admin_users_audit.sql', import.meta.url), 'utf8');
const sceneAuditMigration = readFileSync(new URL('../supabase/migrations/20261006115432_scene_audit_history.sql', import.meta.url), 'utf8');

test('user directory keeps the design tabs, real access controls and editor', () => {
  assert.match(app, /function AdminUsersView\(/);
  assert.match(app, /Journal d’audit/);
  assert.match(app, /role="switch" aria-checked=\{userRow\.is_active !== false\}/);
  assert.match(app, /onClick=\{\(\) => toggleAccess\(userRow\)\}/);
  assert.match(app, /onSaveUser=\{saveAdminUserProfile\}/);
  assert.match(app, /onDeleteUser=\{deleteAdminUser\}/);
  assert.match(css, /\.admin-users-v2-table/);
  assert.match(css, /\.admin-users-v2-editor/);
});

test('only active superadmins can mutate staff accounts', () => {
  assert.match(api, /\.eq\("is_active", true\)/);
  assert.match(api, /\["create", "update", "delete"\]\.includes\(action\) && !canManage/);
  assert.match(api, /Impossible de retirer tes propres droits super admin/);
  assert.match(api, /Conserve au moins un super admin actif/);
  assert.match(api, /if \(!target\) return json\(\{ error: "Compte admin introuvable\." \}, 404\)/);
  assert.match(api, /inviteUserByEmail/);
});

test('audit is persisted, private, and access revocation reaches RLS', () => {
  assert.match(migration, /create table if not exists public\.admin_audit_events/);
  assert.match(migration, /revoke all on public\.admin_audit_events from anon, authenticated/);
  assert.match(migration, /and is_active = true/);
  assert.match(migration, /create trigger audit_scene_status/);
  assert.match(migration, /create trigger audit_object_bank/);
  assert.match(migration, /create trigger audit_stand_presets/);
  assert.match(api, /\.from\("admin_audit_events"\)/);
});

test('user directory includes exhibitors and opens each linked scene history', () => {
  assert.match(app, /Exposants · \$\{users\.filter\(\(row\) => row\.kind === 'exposant'\)\.length\}/);
  assert.match(app, /setSelectedExhibitor\(userRow\)/);
  assert.match(app, /showHistory\(\{ sceneId: scene\.id \}\)/);
  assert.match(api, /scenes\(id, share_token, project_name, client_name, salon, event_name, status, client_status, updated_at\)/);
  assert.match(api, /scenes: linkedScenes/);
  assert.match(api, /scenes: client\.scenes \|\| \[\]/);
});

test('audit attributes scene and object edits to authenticated exhibitors without logging image payloads', () => {
  assert.match(sceneAuditMigration, /actor_id uuid := auth\.uid\(\)/);
  assert.match(sceneAuditMigration, /from auth\.users u/);
  assert.match(sceneAuditMigration, /when actor_role is not null then 'admin' else 'exposant'/);
  assert.match(sceneAuditMigration, /create trigger audit_scene_history after update on public\.scenes/);
  assert.match(sceneAuditMigration, /create trigger audit_scene_item_history after insert or update or delete on public\.scene_items/);
  assert.match(sceneAuditMigration, /'Configuration terminée'/);
  assert.match(sceneAuditMigration, /'Objet ajouté'/);
  assert.match(sceneAuditMigration, /'Objet déplacé'/);
  const auditInsert = sceneAuditMigration.match(/insert into public\.admin_audit_events[\s\S]*?;\nend;/)?.[0];
  assert.ok(auditInsert);
  assert.doesNotMatch(auditInsert, /source_payload/);
});

test('audit history filters are applied server-side before pagination', () => {
  assert.match(api, /query = query\.eq\("scene_id", sceneId\)/);
  assert.match(api, /query = actorId === "system"/);
  assert.match(api, /query = query\.eq\("salon", salon\)/);
  assert.match(api, /if \(search\) query = query\.or\(/);
  assert.match(app, /onAuditFiltersChange=\{setAdminAuditFilters\}/);
  assert.match(app, /Charger plus d’actions/);
  assert.match(app, /Les actions antérieures à l’activation de l’audit ne sont pas reconstituées/);
});
