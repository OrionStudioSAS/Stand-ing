export function lastSceneSyncAt(scene = {}) {
  const source = scene.source_payload || {};
  const values = [source.monday_synced_at, source.monday_config_synced_at]
    .filter(value => value && Number.isFinite(Date.parse(value)));
  return values.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || '';
}

export function sceneSyncLabel(scene = {}) {
  const at = lastSceneSyncAt(scene);
  return at ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(at)) : 'Non renseignée';
}
