export function mondaySyncDuration(milliseconds) {
  if (milliseconds == null || !Number.isFinite(Number(milliseconds))) return '—';
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

export function mondaySyncDate(value, now = Date.now()) {
  if (!value) return 'Jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  const options = { timeZone: 'Europe/Paris' };
  const day = (d) => d.toLocaleDateString('fr-FR', options);
  const label = day(date) === day(new Date(now)) ? 'Aujourd’hui'
    : day(date) === day(new Date(Number(now) - 86400000)) ? 'Hier' : day(date);
  return `${label}, ${date.toLocaleTimeString('fr-FR', { ...options, hour: '2-digit', minute: '2-digit' })}`;
}

export function mondaySyncStatus(run, now = Date.now()) {
  if (!run) return { label: 'En attente', tone: 'neutral' };
  if (run.status === 'started') {
    const stale = Number(now) - new Date(run.created_at).getTime() > 600000;
    return { label: stale ? 'Interrompue' : 'En cours', tone: stale ? 'error' : 'pending' };
  }
  if (run.status === 'error') return { label: 'Erreur', tone: 'error' };
  if (run.status === 'warning') return { label: 'À vérifier', tone: 'pending' };
  return { label: run.status === 'success' ? 'Succès' : run.status, tone: run.status === 'success' ? 'success' : 'neutral' };
}

export function mondaySyncSummary(run) {
  if (run.error || run.status === 'error') return 'Synchronisation non terminée.';
  if (run.status === 'started') return 'Synchronisation lancée, résultat non disponible.';
  const result = run.result || {};
  const created = Number(result.created ?? run.processed_count ?? 0);
  const emails = result.invite_emails_sent;
  return `${created} scène${created > 1 ? 's' : ''} créée${created > 1 ? 's' : ''}`
    + (emails == null ? '' : ` · ${Number(emails)} e-mail${Number(emails) > 1 ? 's' : ''} envoyé${Number(emails) > 1 ? 's' : ''}`)
    + (result.errors?.length ? ` · ${result.errors.length} anomalie(s)` : '');
}

export function mondaySyncOutcome(result, error = '') {
  if (error) return {
    tone: 'error', title: 'Synchronisation non terminée',
    description: 'Certaines données peuvent ne pas être à jour. Contactez votre administrateur si le problème persiste.',
  };
  if (!result) return null;
  const created = Math.max(0, Number(result.created ?? result.processed) || 0);
  const sent = Math.max(0, Number(result.invite_emails_sent) || 0);
  const missed = Math.max(0, Number(result.invite_emails_skipped) || 0);
  const incomplete = Boolean(result.errors?.length || missed);
  const summary = [
    created ? `${created} nouvelle${created > 1 ? 's' : ''} scène${created > 1 ? 's' : ''}` : 'Aucune nouvelle scène à créer',
    sent ? `${sent} invitation${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');
  return {
    tone: incomplete ? 'warning' : 'success',
    title: incomplete ? 'Synchronisation à vérifier' : 'Synchronisation terminée',
    description: `${summary}.${incomplete ? (missed
      ? ` ${missed} invitation${missed > 1 ? 's n’ont' : ' n’a'} pas pu être envoyée${missed > 1 ? 's' : ''}.`
      : ' Certains éléments n’ont pas pu être synchronisés.') : ''}`,
  };
}

export function mondaySyncDiagnostics(run) {
  return [...new Set([run.error, ...(run.result?.errors || []), ...(run.result?.warnings || [])].filter(Boolean))];
}

export function mondaySalonRows(salons = [], runs = [], search = '') {
  const term = String(search).trim().toLocaleLowerCase('fr');
  return salons.map((salon) => {
    const sources = [...new Map([
      ...(salon.monday_sources || []),
      ...(salon.offers || []).map((offer) => offer.monday_source).filter(Boolean),
    ].map((source) => [source.id || `${source.offer}:${source.board_id}`, source])).values()];
    const active = sources.filter((source) => source.is_active !== false);
    const run = runs.find((entry) => active.some((source) => source.id && (entry.source_id === source.id || entry.source_ids?.includes(source.id))));
    const packs = [...new Set(active.map((source) => source.offer).filter(Boolean))];
    const groupCount = active.filter((source) => source.mapping?.salon_from_group).length;
    const organization = !active.length ? '—' : groupCount === active.length ? 'Par pack' : groupCount ? 'Mixte' : 'Dédié';
    return { salon, sources, active, packs, organization, run };
  }).filter((row) => !term || [row.salon.name, ...row.packs, ...row.sources.map((source) => source.board_id)].join(' ').toLocaleLowerCase('fr').includes(term));
}
