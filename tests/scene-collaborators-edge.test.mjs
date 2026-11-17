import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../supabase/functions/${path}`, import.meta.url), 'utf8');
const permissions = read('_shared/scenePermissions.ts').replace(/^export /gm, '');
const invitationEmail = read('_shared/sceneInvitationEmail.ts').replace(/^export /gm, '');
const transpile = (name) => ts.transpileModule(
  permissions + '\n' + invitationEmail + '\n' + read(`${name}/index.ts`).replace(/^import .*;\n/gm, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const sources = Object.fromEntries(['scene-collaborators', 'scene-access-request', 'scene-access-verify', 'scene-completion-email', 'scene-config-sync', 'scene-contact-sync']
  .map(name => [name, transpile(name)]));

function fixture() {
  const scene = { id: 'scene', share_token: 'owner-token', client_email: 'owner@example.test', project_name: 'Signature test', status: 'created', client_status: 'draft', source_payload: {} };
  const owner = { id: 'owner', email: scene.client_email, email_confirmed_at: 'now' };
  const guest = { id: 'guest', email: 'guest@example.test', email_confirmed_at: 'now' };
  const admins = [
    { user_id: 'admin', role_label: 'Admin', is_active: true },
    { user_id: 'designer', role_label: 'Dessinateur', is_active: true },
    { user_id: 'inactive', role_label: 'Admin', is_active: false },
  ];
  const invites = [];
  const mails = [];
  const codes = [];
  const authCreations = [];
  const magicLinks = new Map();
  const admin = {
    auth: {
      async getUser(token) {
        const user = token === 'owner' ? owner : token === 'guest' ? guest : admins.some(row => row.user_id === token)
          ? { id: token, email: token + '@example.test', email_confirmed_at: 'now' } : null;
        return { data: { user } };
      },
      admin: {
        async createUser(payload) { authCreations.push(structuredClone(payload)); return { data: { user: guest } }; },
        async generateLink({ type, email }) {
          assert.equal(type, 'magiclink');
          const token = randomBytes(28).toString('hex');
          magicLinks.set(token, email);
          return { data: { properties: { hashed_token: token } } };
        },
      },
      async signInWithOtp({ email }) { codes.push(email); return { error: null }; },
      async verifyOtp({ email, token, token_hash }) {
        if (token_hash) {
          email = magicLinks.get(token_hash);
          magicLinks.delete(token_hash);
        } else if (token !== '123456') email = null;
        if (!email) return { error: new Error('Invalid credential') };
        const user = email === guest.email ? guest : { id: 'other-invitee', email, email_confirmed_at: 'now' };
        return { data: { session: { user, access_token: 'guest-jwt', refresh_token: 'guest-refresh' } } };
      },
    },
    from(table) {
      const rows = table === 'scenes' ? [scene] : table === 'scene_collaborators' ? invites : table === 'admin_users' ? admins : [];
      const filters = [];
      let insert, update, remove;
      const apply = () => {
        if (insert) {
          if (rows.some(row => row.scene_id === insert.scene_id && (row.slot === insert.slot || row.email === insert.email))) {
            return { data: null, error: { code: '23505' } };
          }
          const row = { id: randomUUID(), ...insert, accepted_at: null, expires_at: '2100-01-01', code_requested_at: null };
          rows.push(row);
          return { data: row, error: null };
        }
        const matching = rows.filter(row => filters.every(fn => fn(row)));
        if (remove) matching.forEach(row => rows.splice(rows.indexOf(row), 1));
        if (update) matching.forEach(row => Object.assign(row, update));
        return { data: matching.map(row => ({ ...row, scenes: { share_token: scene.share_token, project_name: scene.project_name } })), error: null };
      };
      return {
        select() { return this; }, limit() { return this; }, order() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        is(key, value) { filters.push(row => row[key] === value); return this; },
        not(key, operator, value) { assert.equal(operator, 'is'); filters.push(row => row[key] !== value); return this; },
        gt(key, value) { filters.push(row => row[key] > value); return this; },
        or() { filters.push(row => !row.code_requested_at); return this; },
        insert(value) { insert = value; return this; },
        update(value) { update = value; return this; },
        delete() { remove = true; return this; },
        then(resolve, reject) { return Promise.resolve(apply()).then(resolve, reject); },
        async maybeSingle() { const { data, error } = apply(); return { data: data?.[0] ?? null, error }; },
        async single() { return apply(); },
      };
    },
  };
  const handlers = Object.fromEntries(Object.entries(sources).map(([name, js]) => {
    let handler;
    vm.runInNewContext(js, {
      Request, Response, AbortSignal, URL, URLSearchParams, console,
      Deno: { env: { get: key => ({ RESEND_API_KEY: 'test', MONDAY_API_TOKEN: 'test', PUBLIC_APP_URL: 'https://standing.example.test/' })[key] }, serve(fn) { handler = fn; } },
      createClient: () => admin,
      fetch: async (_url, options) => { mails.push(JSON.parse(options.body)); return new Response('{}'); },
    });
    return [name, handler];
  }));
  const request = (name, body, actor = '') => handlers[name](new Request('https://test.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` }, body: JSON.stringify(body),
  }));
  return { scene, invites, mails, codes, authCreations, request };
}

const emailLink = (mail) => new URL(mail.text.match(/https:\/\/[^\s]+/)[0]);
const tokenHash = (url) => new URLSearchParams(url.hash.slice(1)).get('invitation_auth');

test('owner sends personal one-click links with a button and fallback; revocation still invalidates access', async () => {
  const h = fixture();
  h.scene.project_name = 'Signature <Salon & stand>';
  const manage = (body, actor = 'owner') => h.request('scene-collaborators', { scene_id: 'scene', ...body }, actor);
  const invited = await manage({ action: 'invite', email: ' Guest@Example.Test ' });
  assert.equal(invited.status, 201);
  const id = (await invited.json()).member.id;
  assert.deepEqual(h.mails[0].to, ['guest@example.test']);
  assert.match(h.mails[0].text, new RegExp(`invite=${id}`));
  assert.doesNotMatch(h.mails[0].text, /owner-token/);
  assert.doesNotMatch(h.mails[0].text, /vérifiez|code/i);
  assert.match(h.mails[0].html, />Ouvrir la scène<\/a>/);
  assert.match(h.mails[0].html, /Si le bouton ne fonctionne pas/);
  assert.match(h.mails[0].html, /Signature &lt;Salon &amp; stand&gt;/);
  const firstLink = emailLink(h.mails[0]);
  assert.equal(firstLink.searchParams.get('access'), 'link');
  assert.equal(firstLink.searchParams.has('invitation_auth'), false);
  assert.equal((await manage({ action: 'invite', email: 'guest@example.test' })).status, 409);
  assert.equal((await manage({ action: 'invite', email: 'second@example.test' })).status, 201);
  assert.equal((await manage({ action: 'invite', email: 'third@example.test' })).status, 409);
  assert.equal((await manage({ action: 'list' }, 'guest')).status, 403);
  assert.equal(h.invites[0].accepted_at, null);

  assert.equal((await h.request('scene-access-verify', { invitation_token: id, use_session: true }, 'guest')).status, 401);
  assert.equal((await h.request('scene-access-verify', { invitation_token: id, token_hash: tokenHash(emailLink(h.mails[1])) })).status, 403, 'A link for another email cannot accept this invite');
  assert.equal(h.invites[0].accepted_at, null);
  const credentials = { invitation_token: id, token_hash: tokenHash(firstLink) };
  const verified = await h.request('scene-access-verify', credentials);
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).scene_token, 'owner-token');
  assert.equal(h.invites[0].user_id, 'guest');
  assert.ok(h.invites[0].accepted_at);
  assert.deepEqual(h.codes, [], 'No second email or code for a direct link');
  assert.equal((await h.request('scene-access-verify', credentials)).status, 401, 'Magic link is single use');
  const reused = await h.request('scene-access-verify', { invitation_token: id, use_session: true }, 'guest');
  assert.deepEqual(await reused.json(), { scene_token: 'owner-token' });

  const sceneRequest = { sceneId: 'scene', shareToken: 'owner-token' };
  const delivery = (mode) => h.request('scene-completion-email', { ...sceneRequest, mode }, 'guest');
  for (const actor of ['owner', 'guest']) {
    assert.equal((await h.request('scene-contact-sync', sceneRequest, actor)).status, 200, 'Both exhibitors can sync draft details');
    assert.equal((await h.request('scene-completion-email', sceneRequest, actor)).status, 403, 'Neither can deliver a draft');
  }
  assert.equal((await delivery()).status, 403, 'Cannot send confirmation for a draft');
  Object.assign(h.scene, { status: 'configured', client_status: 'configured', source_payload: { configuration_submitted_by: 'owner' } });
  assert.equal((await delivery()).status, 403, 'Cannot deliver someone else’s submission');
  h.scene.source_payload.configuration_submitted_by = 'guest';
  assert.equal((await h.request('scene-config-sync', sceneRequest, 'guest')).status, 200);
  assert.equal((await delivery()).status, 200);
  assert.deepEqual(h.mails[2].to, ['owner@example.test'], 'Confirmation still goes to the main contact');
  for (const actor of ['owner', 'guest']) {
    assert.equal((await h.request('scene-contact-sync', sceneRequest, actor)).status, 403, 'Neither exhibitor can sync changes after submission');
  }
  assert.equal((await delivery('special_request_completed')).status, 403, 'Cannot send admin approval');
  h.scene.status = 'bat_pending';
  assert.equal((await delivery('special_request_received')).status, 200);

  assert.equal((await manage({ action: 'remove', invitation_id: id })).status, 200);
  assert.equal((await delivery('special_request_received')).status, 403, 'Revoked collaborator cannot send confirmation');
  assert.equal((await h.request('scene-access-request', { invitation_token: id })).status, 404);
  const pending = h.invites[0];
  pending.expires_at = '2000-01-01';
  assert.equal((await h.request('scene-access-verify', { invitation_token: pending.id, code: '123456' })).status, 404);
});

test('expired sign-in links can be resent to the same address, while old code-based invitations still work', async () => {
  const h = fixture();
  const response = await h.request('scene-collaborators', { action: 'invite', scene_id: 'scene', email: 'guest@example.test' }, 'owner');
  const { member: { id } } = await response.json();
  const sent = await h.request('scene-access-request', { invitation_token: id, delivery: 'link', language: 'en' });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).delivery, 'link');
  assert.deepEqual(h.mails[1].to, ['guest@example.test']);
  assert.match(h.mails[1].html, />Open the stand<\/a>/);
  assert.notEqual(tokenHash(emailLink(h.mails[1])), tokenHash(emailLink(h.mails[0])));
  assert.equal((await h.request('scene-access-request', { invitation_token: id, delivery: 'link' })).status, 429);
  h.invites[0].code_requested_at = null;
  assert.equal((await h.request('scene-access-request', { invitation_token: id })).status, 200);
  assert.deepEqual(h.codes, ['guest@example.test']);
  assert.deepEqual(h.authCreations, [{ email: 'guest@example.test' }]);
  assert.equal((await h.request('scene-access-verify', { invitation_token: id, code: '123456' })).status, 200);
});

test('an active admin can invite and revoke on a submitted scene without granting access management to guests', async () => {
  const h = fixture();
  Object.assign(h.scene, { status: 'configured', client_status: 'configured' });
  const manage = (body, actor) => h.request('scene-collaborators', { scene_id: 'scene', ...body }, actor);
  const invited = await manage({ action: 'invite', email: 'guest@example.test' }, 'admin');
  assert.equal(invited.status, 201);
  const member = (await invited.json()).member;
  assert.equal((await manage({ action: 'list' }, 'admin')).status, 200);
  for (const actor of ['designer', 'inactive', 'guest']) {
    assert.equal((await manage({ action: 'list' }, actor)).status, 403);
    assert.equal((await manage({ action: 'invite', email: 'new@example.test' }, actor)).status, 403);
    assert.equal((await manage({ action: 'remove', invitation_id: member.id }, actor)).status, 403);
  }
  assert.equal(h.invites.length, 1);
  assert.equal((await manage({ action: 'remove', invitation_id: member.id }, 'admin')).status, 200);
  assert.equal(h.invites.length, 0);
});
