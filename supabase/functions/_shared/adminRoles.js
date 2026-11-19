export function normalizeAdminRole(role) {
  const value = String(role || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (['super admin', 'super administrateur'].includes(value)) return 'Super admin';
  if (value === 'admin') return 'Admin';
  if (value === 'prestataire') return 'Prestataire';
  return value === 'dessinateur' ? 'Dessinateur' : '';
}

export function isSuperAdmin(role) {
  return normalizeAdminRole(role) === 'Super admin';
}
