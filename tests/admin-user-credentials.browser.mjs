import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const appId = resolve('src/__admin-credentials-app.jsx');
const pageId = resolve('src/__admin-credentials-page.jsx');
const source = await readFile('src/App.jsx', 'utf8');
const initialUsers = [
  { id: 'self', auth_user_id: 'self', display_name: 'Admin actuel', email: 'admin@example.com', role: 'Admin', kind: 'admin', is_active: true },
  { id: 'staff', auth_user_id: 'staff', display_name: 'Compte historique', email: 'staff@example.com', role: 'Super admin', kind: 'admin', is_active: true },
  { id: 'designer', auth_user_id: 'designer', display_name: 'Dessinateur test', email: 'designer@example.com', role: 'Dessinateur', kind: 'admin', is_active: true },
];
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminUsersView } from '/src/__admin-credentials-app.jsx';
window.adminSaves = [];
function Test() {
  const [users, setUsers] = useState(${JSON.stringify(initialUsers)});
  const [canManage, setCanManage] = useState(true);
  return <main style={{ padding:20 }}><button onClick={() => setCanManage(false)}>Droits dessinateur test</button><AdminUsersView
    users={users} currentUserId="self" canManage={canManage} onAuditFiltersChange={() => {}}
    onSaveUser={async input => {
      window.adminSaves.push(input);
      if (window.adminSaveError) throw new Error('Enregistrement indisponible.');
      const row = { id:input.userId || 'created', auth_user_id:input.userId || 'created', display_name:input.fullName, email:input.email, role:input.role, is_active:input.isActive, kind:'admin' };
      setUsers(current => input.userId ? current.map(user => user.auth_user_id === input.userId ? row : user) : [...current, row]);
      return { created:!input.userId, updated:Boolean(input.userId), passwordUpdated:Boolean(input.password) };
    }} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Test />);
`;
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'admin-credentials-regression',
  resolveId(id) {
    if (id === '/src/__admin-credentials-app.jsx') return appId;
    if (id === '/src/__admin-credentials-page.jsx') return pageId;
  },
  load(id) {
    if (id === appId) return source.replace("createRoot(document.getElementById('root')).render(<App />);", 'export { AdminUsersView };');
    if (id === pageId) return harness;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/__admin-credentials__') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><div id="root"></div><script type="module" src="/src/__admin-credentials-page.jsx"></script>');
  }); },
}] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__admin-credentials__`);
  await page.getByRole('button', { name: 'Ajouter un utilisateur', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const password = dialog.getByLabel('Mot de passe', { exact: true });
  const confirmation = dialog.getByLabel('Confirmer le mot de passe', { exact: true });
  assert.equal(await password.getAttribute('type'), 'password');
  assert.equal(await password.getAttribute('autocomplete'), 'new-password');
  assert.equal(await password.getAttribute('minlength'), '8');
  assert.deepEqual(await dialog.getByRole('combobox').locator('option:not([disabled])').allTextContents(), ['Admin', 'Prestataire', 'Dessinateur']);
  assert.equal(await page.getByText('Super admin', { exact: true }).count(), 0);
  await dialog.getByLabel('Nom complet').fill('Nouvel admin');
  await dialog.getByLabel('E-mail', { exact: true }).fill('new@example.com');
  await dialog.getByRole('combobox').selectOption('Admin');
  await password.fill('New-password#123');
  await confirmation.fill('Other-password#123');
  await dialog.getByRole('button', { name: 'Créer l’utilisateur' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'ne correspondent pas' }).waitFor();
  assert.equal(await page.evaluate(() => window.adminSaves.length), 0, 'A mismatched confirmation never sends credentials');
  await confirmation.fill('New-password#123');
  await page.screenshot({ path: '/tmp/standing-admin-create-password.png' });
  await dialog.getByRole('button', { name: 'Créer l’utilisateur' }).click();
  await page.waitForFunction(() => window.adminSaves.length === 1);
  await page.getByRole('status').filter({ hasText: 'Utilisateur créé' }).waitFor();
  const created = await page.evaluate(() => window.adminSaves[0]);
  assert.equal(created.password, 'New-password#123');
  assert.equal(created.role, 'Admin');
  assert.equal('passwordConfirmation' in created, false);
  assert.equal('original' in created, false);

  const staffRow = page.locator('.admin-users-v2-row').filter({ hasText: 'staff@example.com' });
  await staffRow.getByRole('button', { name: 'Modifier', exact: true }).click();
  assert.equal(await dialog.getByRole('combobox').inputValue(), 'Admin');
  assert.equal(await dialog.getByLabel('Nouveau mot de passe', { exact: true }).inputValue(), '');
  await dialog.getByText('Laissez vide pour conserver', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForFunction(() => window.adminSaves.length === 2);
  assert.equal(await page.evaluate(() => 'password' in window.adminSaves[1]), false);
  await staffRow.getByRole('button', { name: 'Modifier', exact: true }).click();
  await dialog.getByLabel('Nouveau mot de passe', { exact: true }).fill('Replacement#123');
  await confirmation.fill('Replacement#123');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'mot de passe enregistrés' }).waitFor();
  assert.equal(await page.evaluate(() => window.adminSaves[2].password), 'Replacement#123');
  await staffRow.getByRole('button', { name: 'Modifier', exact: true }).click();
  assert.equal(await dialog.getByLabel('Nouveau mot de passe', { exact: true }).inputValue(), '', 'The previous password is never redisplayed');
  assert.equal(await confirmation.inputValue(), '');
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ajouter un utilisateur', exact: true }).click();
  await page.screenshot({ path: '/tmp/standing-admin-password-mobile.png' });
  assert.ok(await dialog.evaluate(form => form.scrollWidth <= form.clientWidth + 1), 'The user editor fits narrow screens');
  await dialog.getByRole('button', { name: 'Créer l’utilisateur' }).scrollIntoViewIfNeeded();
  assert.ok(await dialog.getByRole('button', { name: 'Créer l’utilisateur' }).isVisible());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Droits dessinateur test' }).click();
  assert.equal(await page.getByRole('button', { name: 'Ajouter un utilisateur', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Admin user editor: create/set/change/unchanged passwords, confirmation, legacy Admin roles, clean drafts, permissions and mobile layout OK.');
} finally {
  await browser?.close();
  await server.close();
}
