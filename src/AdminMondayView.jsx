import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { listMondaySyncRuns, saveMondayBoardForPack } from './data/sceneStore.js';
import { mondaySalonRows, mondaySyncDate, mondaySyncDuration, mondaySyncStatus, mondaySyncSummary } from './adminMonday.js';

export default function AdminMondayView({ salons = [], search = '', syncState, runMondaySync, onSalonsChanged }) {
  const [history, setHistory] = useState({ runs: [], hasMore: false, loading: true, error: '' });
  const [editor, setEditor] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const moreLoading = useRef(false);

  useEffect(() => {
    let active = true;
    setHistory((current) => ({ ...current, loading: true }));
    listMondaySyncRuns().then((result) => {
      if (active) setHistory({ ...result, loading: false, error: '' });
    }).catch((error) => { if (active) setHistory((current) => ({ ...current, loading: false, error: error.message })); });
    return () => { active = false; };
  }, [syncState.loading]);

  useEffect(() => {
    if (!syncState.loading) return undefined;
    const update = () => setElapsed(Math.max(0, Date.now() - (syncState.startedAt || Date.now())));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [syncState.loading, syncState.startedAt]);

  const loadMore = async () => {
    if (moreLoading.current) return;
    moreLoading.current = true;
    setHistory((current) => ({ ...current, loading: true }));
    try {
      const result = await listMondaySyncRuns(history.runs.length);
      setHistory((current) => ({ runs: [...current.runs, ...result.runs.filter((run) => !current.runs.some((old) => old.id === run.id))], hasMore: result.hasMore, loading: false, error: '' }));
    } catch (error) {
      setHistory((current) => ({ ...current, loading: false, error: error.message }));
    } finally { moreLoading.current = false; }
  };

  const rows = mondaySalonRows(salons, history.runs, search);
  const latest = history.runs[0];
  const hasSources = mondaySalonRows(salons).some((row) => row.active.length);
  const connection = !hasSources ? { label: 'Non configuré', tone: 'neutral' }
    : latest?.status === 'success' ? { label: 'Connecté', tone: 'success' }
    : latest?.status === 'error' ? { label: 'À vérifier', tone: 'error' }
    : { label: 'Tableaux associés', tone: 'neutral' };

  return (
    <section className="admin-monday-view">
      <div className="admin-monday-banner">
        <span className="admin-monday-icon"><RotateCcw size={18} className={syncState.loading ? 'is-syncing' : ''} /></span>
        <div><h2>Synchronisation Monday <span className={`admin-monday-badge ${connection.tone}`}>{connection.label}</span></h2><p>Dernière synchronisation : {history.loading && !latest ? 'Chargement…' : mondaySyncDate(latest?.finished_at || latest?.created_at)}</p></div>
        <button className="admin-primary-v2" type="button" onClick={runMondaySync} disabled={syncState.loading || !hasSources}>{syncState.loading ? `Synchronisation… ${mondaySyncDuration(elapsed)}` : 'Synchroniser maintenant'}</button>
      </div>
      {syncState.loading && <div className="admin-monday-notice" role="status">Lecture des tableaux et traitement des scènes en cours. Cela peut prendre une minute ou davantage selon le volume et les services externes. Ne relancez pas la synchronisation.</div>}
      {syncState.message && <div className="sync-result success" role="status">{syncState.message}</div>}
      {syncState.error && <div className="sync-result error" role="alert">{syncState.error}</div>}

      <section><header className="admin-monday-heading"><div><h3>Ce que fait la synchronisation</h3><p>Les règles appliquées à chaque synchronisation.</p></div></header>
        <div className="admin-monday-rules"><article><span>1</span><h4>Lecture des tableaux</h4><p>Les tableaux Monday associés aux packs sont lus. Pour un tableau organisé par pack, chaque salon n’utilise que ses groupes.</p></article><article><span>2</span><h4>Création des scènes</h4><p>Quand CONFIGURABLE vaut OUI, une scène est créée et le lien configurateur est rempli dans Monday.</p></article></div>
        <p className="admin-monday-mail-rule">Le premier e-mail est envoyé une seule fois, lorsque ÉTAPE 1 passe à 1ER ENVOI.</p>
      </section>

      <section><header className="admin-monday-heading"><div><h3>Tableaux associés</h3><p>Associations par salon. Chaque pack conserve son tableau et ses règles de groupes.</p></div><button className="admin-outline-v2" type="button" disabled={!salons.some((salon) => salon.offers?.length)} onClick={() => setEditor({})}>Associer un tableau</button></header>
        <div className="admin-monday-table-wrap"><table><thead><tr><th>Tableau</th><th>Organisation</th><th>Packs synchronisés</th><th>Dernière synchro</th><th>Statut</th><th><span className="admin-monday-sr-only">Actions</span></th></tr></thead><tbody>
          {rows.map(({ salon, active, packs, organization, run }) => {
            const state = mondaySyncStatus(run);
            return <tr key={salon.id}><td>{salon.name}</td><td><span className="admin-monday-badge neutral">{organization}</span></td><td><div className="admin-monday-packs">{packs.length ? packs.map((pack) => <span className={`admin-monday-badge ${/signature|prestige/i.test(pack) ? 'blue' : 'neutral'}`} key={pack}>{pack}</span>) : '—'}</div></td><td>{mondaySyncDate(run?.finished_at || run?.created_at)}</td><td><span className={`admin-monday-badge ${active.length ? state.tone : 'neutral'}`}>{!active.length ? 'Non configuré' : run?.status === 'success' ? 'À jour' : state.label}</span></td><td><button className="admin-outline-v2" type="button" disabled={!salon.offers?.length} onClick={() => setEditor({ salonId: salon.id })}>Configurer<span className="admin-monday-sr-only"> {salon.name}</span></button></td></tr>;
          })}
          {!rows.length && <tr><td colSpan={6}>Aucun salon correspondant.</td></tr>}
        </tbody></table></div>
      </section>

      <section><header className="admin-monday-heading"><div><h3>Historique</h3><p>Les dernières synchronisations et leur durée réelle.</p></div></header>
        {history.error && <div className="sync-result error" role="alert">Historique indisponible : {history.error}</div>}
        <div className="admin-monday-table-wrap"><table><thead><tr><th>Date</th><th>Lancée par</th><th>Résultat</th><th>Durée</th><th>Statut</th></tr></thead><tbody>
          {history.runs.map((run) => {
            const state = mondaySyncStatus(run);
            return <tr key={run.id}><td>{mondaySyncDate(run.created_at)}</td><td>{run.actor_name || 'Non renseigné (ancien historique)'}</td><td><div>{mondaySyncSummary(run)}</div>{!!(run.result?.errors?.length || run.result?.warnings?.length) && <details><summary>Détails</summary><ul>{[...(run.result?.errors || []), ...(run.result?.warnings || [])].map((message, index) => <li key={index}>{message}</li>)}</ul></details>}</td><td>{mondaySyncDuration(run.duration_ms)}</td><td><span className={`admin-monday-badge ${state.tone}`}>{state.label}</span></td></tr>;
          })}
          {!history.runs.length && <tr><td colSpan={5}>{history.loading ? 'Chargement de l’historique…' : 'Aucune synchronisation enregistrée.'}</td></tr>}
        </tbody></table></div>
        {history.hasMore && <button className="admin-outline-v2 admin-monday-more" type="button" onClick={loadMore} disabled={history.loading}>{history.loading ? 'Chargement…' : 'Voir les synchronisations précédentes'}</button>}
      </section>
      {editor && <MondayBoardEditor salons={salons} initialSalonId={editor.salonId} onClose={() => setEditor(null)} onSaved={onSalonsChanged} />}
    </section>
  );
}

function MondayBoardEditor({ salons, initialSalonId, onClose, onSaved }) {
  const available = salons.filter((salon) => salon.offers?.length);
  const [salonId, setSalonId] = useState(initialSalonId || available[0]?.id || '');
  const [packName, setPackName] = useState('');
  const [boardId, setBoardId] = useState('');
  const [groupMode, setGroupMode] = useState(false);
  const [state, setState] = useState({ saving: false, error: '' });
  const dialogRef = useRef(null);
  const salon = available.find((item) => item.id === salonId);
  const offers = salon?.offers || [];
  const pack = packName || offers[0]?.name || '';

  useEffect(() => {
    const source = offers.find((offer) => offer.name === pack)?.monday_source
      || salon?.monday_sources?.find((item) => item.offer === pack);
    setBoardId(source?.board_id || '');
    setGroupMode(Boolean(source?.mapping?.salon_from_group));
  }, [salon, pack]);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.showModal();
    return () => { previous?.focus?.(); };
  }, []);

  const save = async (event) => {
    event.preventDefault();
    if (state.saving) return;
    setState({ saving: true, error: '' });
    try {
      await saveMondayBoardForPack(salon, pack, boardId, { salonFromGroup: groupMode });
      await onSaved?.();
      onClose();
    } catch (error) { setState({ saving: false, error: error.message }); }
  };

  return <dialog ref={dialogRef} className="admin-monday-dialog" aria-labelledby="monday-board-title" onCancel={(event) => { event.preventDefault(); if (!state.saving) onClose(); }}>
    <form onSubmit={save}><header><h2 id="monday-board-title">Associer un tableau Monday</h2><button type="button" aria-label="Fermer" disabled={state.saving} onClick={onClose}><X size={18} /></button></header>
      <p>L’association s’applique au pack sélectionné sur ce salon.</p>
      <label>Salon<select aria-label="Salon" value={salonId} disabled={state.saving} onChange={(event) => { setSalonId(event.target.value); setPackName(''); }}>{available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Pack<select aria-label="Pack" value={pack} disabled={state.saving} onChange={(event) => setPackName(event.target.value)}>{offers.map((offer) => <option key={offer.id || offer.name} value={offer.name}>{offer.name}</option>)}</select></label>
      <label>ID du tableau Monday<input required autoFocus inputMode="numeric" pattern="[0-9]+" value={boardId} disabled={state.saving} onChange={(event) => setBoardId(event.target.value)} placeholder="Ex : 18395911999" /></label>
      <label className="admin-monday-group-mode"><input type="checkbox" checked={groupMode} disabled={state.saving} onChange={(event) => setGroupMode(event.target.checked)} />Tableau par pack, groupes par salon</label>
      {groupMode && <p>Seuls les groupes nommés « {salon?.name} » seront synchronisés pour ce pack.</p>}
      {state.error && <div role="alert" className="sync-result error">{state.error}</div>}
      <footer><button className="admin-outline-v2" type="button" disabled={state.saving} onClick={onClose}>Annuler</button><button className="admin-primary-v2" type="submit" disabled={state.saving || !boardId.trim() || !pack}>{state.saving ? 'Enregistrement…' : 'Enregistrer'}</button></footer>
    </form>
  </dialog>;
}
