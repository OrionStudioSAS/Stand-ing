export function canReopenSceneAsDraft(scene = {}) {
  if (scene.status === 'archived' || scene.status === 'validated'
    || ['bat_review', 'bat_validated'].includes(scene.client_status)) return false;
  const source = scene.source_payload || {};
  const batStatus = String(source.bat_status || source.batStatus || source.bat?.status || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/correction|retour|modification|signe|validated|valide|envoye|sent/.test(batStatus)) return false;
  return ['configured', 'bat_pending'].includes(scene.status) || scene.client_status === 'configured';
}

export function sceneDraftPatch(scene, updatedAt = new Date().toISOString()) {
  if (!canReopenSceneAsDraft(scene)) {
    throw new Error('Seule une scène en BAT à valider peut être repassée en brouillon. Actualisez la liste.');
  }
  return {
    status: 'created',
    client_status: 'draft',
    source_payload: {
      ...(scene.source_payload || {}),
      exhibitor_view_only: false,
      exhibitor_view_only_updated_at: updatedAt,
    },
    updated_at: updatedAt,
  };
}
