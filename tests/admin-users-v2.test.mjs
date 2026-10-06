import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261006113055_admin_users_audit.sql', import.meta.url), 'utf8');

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
