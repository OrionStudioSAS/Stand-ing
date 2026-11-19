# Admin account permissions

- Super admin: manages staff accounts, roles, passwords and access.
- Admin: retains existing scene, exhibitor and BAT permissions, but cannot
  create, edit, disable or delete staff accounts, including another Admin.
- Prestataire and Dessinateur: retain their existing scene permissions.

Account authorization reads the active admin_users row on every Edge Function
request. User-editable Auth metadata is never used as a permission source.
Admin and Super admin are separate canonical roles shared by the frontend and
admin-users. The role label is not hardcoded for any email address.

The account manager cannot delete themselves, disable themselves or demote
themselves. The backend also preserves at least one active Super admin.

The previous deployed function rejected the frontend's Admin role value and did
not update Auth passwords. Deploy admin-users with its shared adminRoles module
before publishing the corresponding frontend. Role assignments are audited data
changes, not schema migrations. No existing password is read or displayed.

Verification:
- node --test tests/admin-user-credentials.test.mjs tests/admin-users-v2.test.mjs
- node tests/admin-user-credentials.browser.mjs
