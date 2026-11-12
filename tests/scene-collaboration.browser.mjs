import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const storeId = resolve('src/data/sceneStore.js');
const clientId = resolve('src/data/supabaseClient.js');
const scene = {
  id: 'collaborative', share_token: 'owner-link', salon: 'SITL', offer: 'Signature', project_name: 'Stand partagé',
  status: 'created', client_status: 'draft', client_email: 'owner@example.test', configuration_revision: 0,
  dimensions: { width: 5, depth: 4 }, layout: 'left', source_payload: {}, items: [], options: { ledRailsEnabled: false },
};

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error', plugins: [{
  name: 'scene-collaboration-test',
  load(id) {
    if (id === clientId) return `
      export const supabase = {
        auth: { async getSession() { return { data: { session: window.testUser ? { user: window.testUser } : null } }; } },
        from(table) { return { select(){return this}, eq(){return this}, async maybeSingle(){
          const role = { admin: 'Admin', designer: 'Dessinateur' }[window.testUser?.id];
          return { data: table === 'admin_users' && role ? { user_id: window.testUser.id, role_label: role } : null };
        } }; },
      };
      export const hasSupabase = true;
    `;
    if (id === storeId) return `
      export * from '/src/data/sceneStore.js?collaboration-original';
      let scene = ${JSON.stringify(scene)};
      if (new URLSearchParams(window.location.search).has('submitted')) {
        scene = { ...scene, status: 'configured', client_status: 'configured' };
      }
      let members = [];
      export async function getSceneByToken(token) {
        if (token !== scene.share_token || !window.testUser) throw new Error('Access denied');
        return structuredClone(scene);
      }
      export async function getSceneExhibitorState() { return { status: scene.status, clientStatus: scene.client_status, locked: false }; }
      export async function listObjectBank() { return []; }
      export async function requestSceneAccessCode(token, invite) {
        window.requestedInvite = invite;
        if (invite !== 'guest-link') throw new Error('Unknown invite');
        return { masked_email: 'gu***@example.test' };
      }
      export async function verifySceneAccessCode(token, code, invite) {
        if (code !== '123456' || invite !== 'guest-link') throw new Error('Code incorrect ou expiré.');
        window.testUser = { id: 'guest', email: 'guest@example.test' };
        return { scene_token: scene.share_token };
      }
      export async function manageSceneCollaborators(id, action, details) {
        if (!['owner', 'admin'].includes(window.testUser?.id) || id !== scene.id) throw new Error('Access denied');
        if (action === 'list') return { members };
        if (action === 'remove') { members = members.filter(entry => entry.id !== details.invitation_id); return { removed: true }; }
        const member = { id: details.email, email: details.email, expires_at: '2100-01-01T00:00:00Z' };
        members = [...members, member];
        return { member };
      }
      export async function saveScene(payload, revisionRef) {
        if (window.testStale) throw Object.assign(new Error('Cette scène a été modifiée ailleurs. Rechargez-la avant de continuer.'), {code:'PT409'});
        window.savedScene = scene = { ...payload, configuration_revision: ++revisionRef.current };
        return scene;
      }
      export async function syncSceneConfigToMonday(confirmed) {
        window.syncedStatus = confirmed.status;
        return { synced: true };
      }
      export async function sendSceneCompletionEmail(confirmed) {
        window.notifiedContact = confirmed.client_email;
        return { sent: true, to: confirmed.client_email };
      }
    `;
  },
}] });

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  const errors = [];
  const open = async (query, role) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(role => {
      localStorage.setItem('standing-config-intro:collaborative', 'started');
      localStorage.setItem('standing-config-tutorial:collaborative', 'done');
      if (role) window.testUser = { id: role, email: role + '@example.test' };
      if (role === 'owner') {
        sessionStorage.setItem('standing-scene-access:owner-link', 'verified');
      }
    }, role);
    await page.goto(url + query);
    return page;
  };

  const owner = await open('?scene=owner-link', 'owner');
  const inviteButton = (page) => page.locator('.configurator-topbar').getByRole('button', { name: 'Inviter un collaborateur' });
  const inviteIcon = inviteButton(owner).locator('img.topbar-tool-icon');
  assert.equal(await inviteIcon.getAttribute('src'), '/icons/account-add.svg');
  await owner.waitForFunction(() => document.querySelector('img[src="/icons/account-add.svg"]')?.naturalWidth === 36);
  const validate = async (page) => {
    await page.locator('.stepper').getByRole('button', { name: /Validation/ }).click();
    const confirm = page.locator('.validation-confirm-button');
    assert.equal(await confirm.isEnabled(), true);
    await confirm.click();
    await page.waitForFunction(() => window.notifiedContact === 'owner@example.test');
    assert.deepEqual(await page.evaluate(() => [window.savedScene.client_status, window.syncedStatus]), ['configured', 'configured']);
    await page.getByText(/Votre scène est confirmée/).waitFor();
    assert.equal(await confirm.isDisabled(), true, 'Exhibitor cannot submit a second time');
    await page.locator('.configurator-shell.readonly-mode').waitFor();
  };
  await inviteButton(owner).click();
  const dialog = owner.getByRole('dialog', { name: 'Collaborateurs du stand' });
  assert.equal(await inviteButton(owner).getAttribute('aria-expanded'), 'true');
  for (const email of ['guest@example.test', 'second@example.test']) {
    await dialog.getByRole('textbox', { name: 'Adresse e-mail du collaborateur' }).fill(email);
    await dialog.getByRole('button', { name: 'Envoyer l’invitation' }).click();
    await dialog.getByText(email, { exact: true }).waitFor();
  }
  await dialog.getByText('Deux collaborateurs maximum par scène.').waitFor();
  assert.equal(await dialog.getByRole('textbox').count(), 0);
  await dialog.getByRole('button', { name: 'Retirer l’accès : second@example.test' }).click();
  await dialog.getByText('Accès retiré.', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('textbox').count(), 1);
  await inviteButton(owner).click();
  await dialog.waitFor({ state: 'hidden' });
  await owner.setViewportSize({ width: 320, height: 740 });
  const headerBounds = await owner.locator('.configurator-topbar-actions').boundingBox();
  assert.ok(headerBounds.x >= 0 && headerBounds.x + headerBounds.width <= 320, 'Header actions fit on mobile');
  await inviteButton(owner).click();
  await dialog.waitFor();
  await inviteButton(owner).click();
  await owner.setViewportSize({ width: 1280, height: 900 });
  await validate(owner);
  assert.equal(await inviteButton(owner).isVisible(), true, 'Owner can still manage access after submission');
  await owner.close();

  const admin = await open('?scene=owner-link&submitted=1', 'admin');
  await inviteButton(admin).click();
  const adminDialog = admin.getByRole('dialog', { name: 'Collaborateurs du stand' });
  await adminDialog.getByRole('textbox', { name: 'Adresse e-mail du collaborateur' }).fill('new@example.test');
  await adminDialog.getByRole('button', { name: 'Envoyer l’invitation' }).click();
  await adminDialog.getByText('new@example.test', { exact: true }).waitFor();
  await adminDialog.getByRole('button', { name: 'Retirer l’accès : new@example.test' }).click();
  await adminDialog.getByText('Accès retiré.', { exact: true }).waitFor();
  await admin.close();

  const designer = await open('?scene=owner-link', 'designer');
  await designer.locator('.user-pill').waitFor();
  assert.equal(await inviteButton(designer).count(), 0, 'Designer in read-only mode cannot manage invitations');
  await designer.close();

  const openGuest = async () => {
    const page = await open('?invite=guest-link', '');
    await page.getByText('gu***@example.test').waitFor();
    assert.equal(await page.evaluate(() => window.requestedInvite), 'guest-link');
    await page.getByRole('textbox', { name: 'Code de connexion' }).fill('123456');
    await page.getByRole('button', { name: 'Accéder à ma configuration' }).click();
    return page;
  };
  const guest = await openGuest();
  await guest.locator('.user-pill').click();
  assert.equal(await inviteButton(guest).count(), 0);
  assert.equal(await guest.getByRole('button', { name: 'Inviter un collaborateur' }).count(), 0);
  assert.equal(await guest.locator('.client-correction-button').isVisible(), true, 'Guest can report incorrect contact details');
  await guest.locator('.client-info-modal .modal-head-actions button').click();
  await guest.getByRole('button', { name: /^Sol/ }).click();
  const thickCarpet = guest.locator('.config-toggle-option').filter({ hasText: 'Moquette épaisse' });
  await thickCarpet.click();
  await guest.waitForFunction(() => window.savedScene?.options.carpetThick);
  assert.equal(await guest.evaluate(() => window.savedScene.status), 'created');
  await guest.evaluate(() => { window.testStale = true; });
  await thickCarpet.click();
  await guest.getByRole('alert').filter({ hasText: 'Cette scène a été modifiée ailleurs' }).waitFor();
  await guest.getByRole('button', { name: 'Recharger la scène' }).waitFor();
  assert.equal(await guest.evaluate(() => window.savedScene.options.carpetThick), true);
  await guest.locator('.stepper').getByRole('button', { name: /Validation/ }).click();
  assert.equal(await guest.locator('.validation-confirm-button').isDisabled(), true, 'Stale draft cannot be submitted');
  await guest.close();

  const submitter = await openGuest();
  await validate(submitter);
  assert.deepEqual(errors, []);
  console.log('Owner and admin manage invitations, including on a submitted scene; owner and guest become read-only after submission.');
} finally {
  await browser?.close();
  await server.close();
}
