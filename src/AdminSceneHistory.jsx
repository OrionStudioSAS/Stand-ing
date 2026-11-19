import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { listAdminAuditEvents, listSceneLatestActivities } from './data/sceneStore.js';

export function useSceneLatestActivities(sceneIds, version = '') {
  const key = JSON.stringify([...new Set(sceneIds)].sort());
  const [state, setState] = useState({ key: '', activities: new Map(), loading: true, error: '' });
  useEffect(() => {
    let cancelled = false;
    setState({ key, activities: new Map(), loading: true, error: '' });
    listSceneLatestActivities(JSON.parse(key)).then((rows) => {
      if (!cancelled) setState({ key, activities: new Map(rows.map((row) => [row.scene_id, row])), loading: false, error: '' });
    }).catch((error) => {
      if (!cancelled) setState({ key, activities: new Map(), loading: false, error: error.message || 'Historique indisponible.' });
    });
    return () => { cancelled = true; };
  }, [key, version]);
  return state.key === key ? state : { activities: new Map(), loading: true, error: '' };
}

export default function AdminSceneHistoryButton({ scene, renderEvents }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ events: [], loading: false, error: '', hasMore: false });
  const button = useRef(null);
  const dialog = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    listAdminAuditEvents(offset, { sceneId: scene.id }).then((result) => {
      if (!cancelled) setState((current) => ({
        events: offset ? [...current.events, ...result.events.filter((event) => !current.events.some((old) => old.id === event.id))] : result.events,
        loading: false, error: '', hasMore: result.hasMore,
      }));
    }).catch((error) => {
      if (!cancelled) setState((current) => ({ ...current, loading: false, error: error.message || 'Historique indisponible.' }));
    });
    return () => { cancelled = true; };
  }, [open, offset, retry, scene.id]);
  useEffect(() => {
    if (!open) return undefined;
    const keyboard = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const targets = dialog.current?.querySelectorAll('button:not(:disabled), a[href]');
      const first = targets?.[0], last = targets?.[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard);
      button.current?.focus();
    };
  }, [open]);
  return <>
    <button ref={button} type="button" disabled={!scene.id} onClick={() => {
      setState({ events: [], loading: true, error: '', hasMore: false });
      setOffset(0);
      setOpen(true);
    }}><History size={14} /> Historique</button>
    {open && createPortal(
      <div className="admin-exhibitors-profile-backdrop admin-scene-history-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section ref={dialog} className="admin-scene-history" role="dialog" aria-modal="true" aria-label={`Historique de ${scene.project_name || scene.client_name || 'la scène'}`}>
          <header><div><h2>Historique de la scène</h2>
            <p>{scene.project_name || scene.client_name || 'Scène'} · {scene.event_name || scene.salon} · {scene.offer}</p>
            <small>Identifiant : {scene.id}</small></div>
            <button type="button" autoFocus aria-label="Fermer l’historique" onClick={() => setOpen(false)}><X size={18} /></button>
          </header>
          <p>Modifications enregistrées depuis l’activation de l’historique, de la plus récente à la plus ancienne.</p>
          {state.error && <p className="sync-result error" role="alert">{state.error}</p>}
          {state.error && <button className="admin-outline-v2" type="button" onClick={() => setRetry((current) => current + 1)}>Réessayer</button>}
          {state.events.length > 0 && renderEvents(state.events)}
          {!state.loading && !state.error && !state.events.length && <p>Aucune modification enregistrée pour cette scène.</p>}
          {state.loading && <p role="status">Chargement de l’historique…</p>}
          {state.hasMore && !state.error && <button className="admin-outline-v2" type="button" disabled={state.loading} onClick={() => setOffset((current) => current + 100)}>Charger plus d’actions</button>}
        </section>
      </div>, document.body,
    )}
  </>;
}
