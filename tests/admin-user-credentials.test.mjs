import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');
const compiled = transformSync(source.replace(/^import .*;\n/gm, ''), { loader: 'ts', format: 'cjs' }).code;
const secret = '  New-secret#123  ';
const input = { email: 'staff@example.com', fullName: 'Staff Test', role: 'Admin', isActive: true, organization: 'Stand-ING' };

function runtime(options = {}) {
  let handler;
  const actor = { user_id: 'actor', role_label: options.role || 'Admin', is_active: options.active !== false, full_name: 'Admin Test' };
  const profiles = new Map([['actor', actor], ...(options.profiles || []).map(profile => [profile.user_id, profile])]);
  const accounts = new Map([['actor', { id: 'actor', email: 'admin@example.com', password: 'existing-password' }], ...(options.accounts || []).map(account => [account.id, account])]);
  const calls = { create: [], password: [], delete: [], profiles: [], audit: [], logs: [] };
  const database = {
    auth: {
      getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: 'actor', user_metadata: { role: 'Admin' } } }, error: null }),
      admin: {
        listUsers: async () => ({ data: { users: [...accounts.values()] }, error: null }),
        createUser: async attributes => {
          calls.create.push(attributes);
          if (options.authError) return { data: {}, error: { message: 'Password rejected' } };
          const account = { ...attributes, id: 'new-user' };
          accounts.set(account.id, account);
          return { data: { user: account }, error: null };
        },
        updateUserById: async (id, attributes) => {
          calls.password.push({ id, attributes });
          if (options.authError) return { error: { message: 'Password rejected' } };
          accounts.set(id, { ...accounts.get(id), ...attributes });
          return { data: { user: accounts.get(id) }, error: null };
        },
        deleteUser: async id => { calls.delete.push(id); accounts.delete(id); profiles.delete(id); return { error: null }; },
        inviteUserByEmail: async () => { throw new Error('Password accounts must not send invitation emails'); },
      },
    },
    from(table) {
      let action = 'select', value;
      const filters = [];
      const run = () => {
        const selected = [...profiles.values()].filter(row => filters.every(filter => filter(row)));
        if (table === 'admin_audit_events') { calls.audit.push(value); return { error: null }; }
        if (table === 'clients') return { data: [], error: null };
        assert.equal(table, 'admin_users');
        if (action === 'insert') {
          if (options.insertError) return { error: { message: 'Profile insert failed' } };
          profiles.set(value.user_id, value); calls.profiles.push({ action, value });
        }
        if (action === 'update') {
          if (options.profileError) return { error: { message: 'Profile update failed' } };
          selected.forEach(row => profiles.set(row.user_id, { ...row, ...value })); calls.profiles.push({ action, value });
        }
        if (action === 'delete') selected.forEach(row => profiles.delete(row.user_id));
        return { data: selected, error: null };
      };
      return {
        select() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        insert(next) { action = 'insert'; value = next; return this; },
        update(next) { action = 'update'; value = next; return this; },
        delete() { action = 'delete'; return this; },
        maybeSingle() { const result = run(); return Promise.resolve({ ...result, data: result.data?.[0] || null }); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
    },
  };
  const context = vm.createContext({
    Deno: { serve: callback => { handler = callback; }, env: { get: key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }[key]) } },
    createClient: () => database, Response,
    console: { error: (...args) => calls.logs.push(args) },
  });
  vm.runInContext(compiled, context);
  const request = async (body, authorized = true) => {
    const response = await handler(new Request('https://test.supabase.co/functions/v1/admin-users', {
      method: 'POST', headers: authorized ? { Authorization: 'Bearer token' } : {}, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { request, calls, profiles, accounts, context };
}

test('admin creation defines a confirmed Auth password without invitations or credential leakage', async () => {
  const api = runtime();
  const result = await api.request({ ...input, action: 'create', password: secret });
  assert.equal(result.status, 200);
  assert.equal(result.body.created, true);
  assert.equal(api.accounts.get('new-user').password, secret, 'Passwords must not be trimmed');
  assert.equal(api.calls.create[0].email_confirm, true, 'The new account can sign in immediately');
  assert.equal(api.profiles.get('new-user').role_label, 'Admin');
  assert.equal(api.calls.password.length, 0);
  for (const value of [result.body, [...api.profiles.values()], api.calls.audit, api.calls.logs]) {
    assert.ok(!JSON.stringify(value).includes(secret), 'Passwords never enter profiles, audit, responses or logs');
  }
  const inactive = runtime();
  assert.equal((await inactive.request({ ...input, action: 'create', password: secret, isActive: false })).status, 200);
  assert.equal(inactive.profiles.get('new-user').is_active, false, 'Creation respects the access toggle');
});

test('password editing uses Auth only; a blank or missing password preserves the existing credential', async () => {
  for (const password of [undefined, '', secret]) {
    const api = runtime();
    const result = await api.request({ ...input, action: 'update', userId: 'actor', password });
    assert.equal(result.status, 200);
    assert.equal(api.accounts.get('actor').password, password || 'existing-password');
    assert.equal(api.calls.password.length, password ? 1 : 0);
    assert.equal(result.body.passwordUpdated, Boolean(password));
    assert.ok(!JSON.stringify(api.calls.audit).includes(secret));
    assert.ok(!JSON.stringify(result.body).includes(secret));
  }
});

test('server rejects missing, short, oversized and non-string passwords before changing any account', async () => {
  for (const action of ['create', 'update']) {
    for (const password of [undefined, '', 'short', 'x'.repeat(129), 123456789, {}]) {
      if (action === 'update' && (password === undefined || password === '')) continue;
      const api = runtime();
      const result = await api.request({ ...input, action, userId: 'actor', password });
      assert.equal(result.status, 400, `${action}: ${typeof password}`);
      assert.equal(api.calls.create.length + api.calls.password.length + api.calls.profiles.length, 0);
    }
  }
});

test('only an authenticated active managing admin can create users or set passwords, regardless of submitted roles', async () => {
  for (const options of [{ role: 'Dessinateur' }, { role: 'Prestataire' }, { active: false }, { unauthenticated: true }]) {
    for (const action of ['create', 'update']) {
      const api = runtime(options);
      const result = await api.request({ ...input, action, userId: 'actor', password: secret, role: 'Admin' });
      assert.ok([401, 403].includes(result.status));
      assert.equal(api.calls.password.length + api.calls.create.length + api.calls.profiles.length, 0);
    }
  }
  assert.equal((await runtime().request({ ...input, action: 'create', password: secret }, false)).status, 401);
});

test('existing Admin and legacy Super admin labels retain the same rights and normalize to Admin', async () => {
  for (const role of ['Admin', 'admin', 'Super admin', 'Super administrateur']) {
    const api = runtime({ role });
    const result = await api.request({ ...input, role, action: 'update', userId: 'actor', password: secret });
    assert.equal(result.status, 200);
    assert.equal(api.profiles.get('actor').role_label, 'Admin');
    const listed = await api.request({ action: 'list' });
    assert.equal(listed.body.users[0].role, 'Admin');
  }
  for (const patch of [{ role: 'Dessinateur' }, { isActive: false }]) {
    const api = runtime();
    const result = await api.request({ ...input, ...patch, action: 'update', userId: 'actor', password: secret });
    assert.equal(result.status, 400, 'Self-demotion cannot be combined with a password change');
    assert.equal(api.calls.password.length, 0);
  }
});

test('creating an existing admin is a conflict and never resets that account password', async () => {
  const api = runtime();
  const result = await api.request({ ...input, email: 'admin@example.com', action: 'create', password: secret });
  assert.equal(result.status, 409);
  assert.equal(api.calls.password.length + api.calls.create.length, 0);
  assert.equal(api.accounts.get('actor').password, 'existing-password');
});

test('an existing non-admin Auth account can be granted staff access with the chosen password', async () => {
  const api = runtime({ accounts: [{ id: 'exhibitor', email: input.email, password: 'old-password' }] });
  const result = await api.request({ ...input, action: 'create', password: secret });
  assert.equal(result.status, 200);
  assert.equal(api.calls.create.length, 0);
  assert.equal(api.accounts.get('exhibitor').password, secret);
  assert.equal(api.accounts.get('exhibitor').email_confirm, true);
  assert.equal(api.profiles.get('exhibitor').role_label, 'Admin');
});

test('failed profile creation cleans up a new Auth account but never changes an existing account password', async () => {
  for (const existing of [false, true]) {
    const api = runtime({ insertError: true, accounts: existing ? [{ id: 'exhibitor', email: input.email, password: 'old-password' }] : [] });
    const result = await api.request({ ...input, action: 'create', password: secret });
    assert.equal(result.status, 500);
    assert.equal(api.calls.password.length, 0);
    assert.equal(api.accounts.has('new-user'), false);
    if (existing) assert.equal(api.accounts.get('exhibitor').password, 'old-password');
  }
});

test('Auth password rejection leaves existing profiles unchanged and rolls back any new staff access', async () => {
  const edit = runtime({ authError: true });
  assert.equal((await edit.request({ ...input, action: 'update', userId: 'actor', password: secret })).status, 400);
  assert.equal(edit.calls.profiles.length, 0);
  assert.equal(edit.accounts.get('actor').password, 'existing-password');
  const create = runtime({ authError: true, accounts: [{ id: 'exhibitor', email: input.email, password: 'old-password' }] });
  assert.equal((await create.request({ ...input, action: 'create', password: secret })).status, 400);
  assert.equal(create.profiles.has('exhibitor'), false);
  assert.equal(create.accounts.get('exhibitor').password, 'old-password');
});

test('a profile save failure after changing a password clearly reports the partial result without exposing credentials', async () => {
  const api = runtime({ profileError: true });
  const result = await api.request({ ...input, action: 'update', userId: 'actor', password: secret });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /mot de passe a été modifié/);
  assert.ok(!JSON.stringify(result.body).includes(secret));
});

test('the frontend transport only forwards a nonempty password to the authenticated Edge Function', async () => {
  const store = readFileSync(new URL('../src/data/sceneStore.js', import.meta.url), 'utf8');
  const start = store.indexOf('export async function saveAdminUser(');
  const calls = [];
  const api = vm.createContext({
    supabase: { functions: { invoke: async (name, options) => { calls.push({ name, ...options }); return { data: { updated: true }, error: null }; } } },
    getFunctionError: async () => null,
  });
  vm.runInContext(store.slice(start, store.indexOf('\n}\n', start) + 2).replace('export ', ''), api);
  await api.saveAdminUser({ ...input, password: secret, passwordConfirmation: secret });
  assert.equal(calls[0].name, 'admin-users');
  assert.equal(calls[0].body.password, secret);
  assert.equal('passwordConfirmation' in calls[0].body, false);
  await api.saveAdminUser({ ...input, userId: 'actor', password: '' });
  assert.equal(calls[1].body.action, 'update');
  assert.equal('password' in calls[1].body, false);
});
