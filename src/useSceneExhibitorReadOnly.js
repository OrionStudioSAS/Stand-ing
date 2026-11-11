import { useEffect, useRef, useState } from 'react';
import { getSceneExhibitorState } from './data/sceneStore.js';

function configurationLocked(status = 'created', clientStatus = 'not_started') {
  return status !== 'created' || !['not_started', 'draft'].includes(clientStatus);
}

export function useSceneExhibitorReadOnly(scene, isAdminViewer = false, forceReadOnly = false, onReopen) {
  const initialLocked = Boolean(scene.source_payload?.exhibitor_view_only || configurationLocked(scene.status, scene.client_status));
  const initialLockUpdatedAt = scene.source_payload?.exhibitor_view_only_updated_at || '';
  const [locked, setLocked] = useState(initialLocked);
  const lastAccess = useRef({ locked: initialLocked, lockUpdatedAt: initialLockUpdatedAt });

  useEffect(() => {
    setLocked(initialLocked);
    lastAccess.current = { locked: initialLocked, lockUpdatedAt: initialLockUpdatedAt };
  }, [scene.id, initialLocked, initialLockUpdatedAt]);
  useEffect(() => {
    if (isAdminViewer || forceReadOnly || !scene.id) return undefined;
    let cancelled = false;
    let checking = false;
    const refresh = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const state = await getSceneExhibitorState(scene);
        const next = { ...state, locked: state.locked || configurationLocked(state.status, state.clientStatus) };
        if (cancelled) return;
        const previous = lastAccess.current;
        lastAccess.current = next;
        setLocked(next.locked);
        // A tab opened before the admin action must not autosave its old submitted status.
        if (!next.locked && next.clientStatus === 'draft'
          && (previous.locked || previous.lockUpdatedAt !== next.lockUpdatedAt)) onReopen?.();
      } catch (error) {
        if (!cancelled && error.code === 'PGRST116') setLocked(true);
        console.warn('Scene read-only status refresh failed', error);
      } finally {
        checking = false;
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [scene.id, isAdminViewer, forceReadOnly, onReopen]);

  return Boolean(forceReadOnly) || (!isAdminViewer && locked);
}
