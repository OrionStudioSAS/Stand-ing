import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../sftp-gateway/src/server.js', import.meta.url), 'utf8');
const start = source.indexOf('function assertCanUploadToScene(');
const end = source.indexOf('async function nextUploadVersion', start);
const api = vm.createContext({ httpError: (status, message) => Object.assign(new Error(message), { status }) });
vm.runInContext(source.slice(start, end), api);

test('the HD gateway checks the draft lock before writing to SFTP for owner and guest alike', () => {
  assert.ok(source.indexOf('assertCanUploadToScene(auth, scene);') < source.indexOf('await sftp.fastPut'));
  const draft = { status: 'created', client_status: 'draft', client_email: 'owner@example.test', source_payload: {} };
  for (const email of [draft.client_email, 'guest@example.test']) {
    const auth = { mode: 'supabase-user', user: { id: 'user', email }, db: {} };
    assert.doesNotThrow(() => api.assertCanUploadToScene(auth, draft));
    for (const locked of [
      { ...draft, status: 'configured', client_status: 'configured' },
      { ...draft, status: 'bat_pending', client_status: 'configured' },
      { ...draft, status: 'validated', client_status: 'bat_validated' },
      { ...draft, source_payload: { exhibitor_view_only: true } },
    ]) assert.throws(() => api.assertCanUploadToScene(auth, locked), { status: 403 });
    assert.throws(() => api.assertCanUploadToScene({ ...auth, db: null }, draft), { status: 403 });
  }
  assert.doesNotThrow(() => api.assertCanUploadToScene({ admin: true }, { ...draft, status: 'configured' }));
});
