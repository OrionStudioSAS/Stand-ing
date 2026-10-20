import { useEffect, useRef, useState } from 'react';
import { getSceneExhibitorState } from './data/sceneStore.js';

export function useSceneExhibitorReadOnly(scene, isAdminViewer = false, forceReadOnly = false, onReopen) {
  const initialLocked = Boolean(scene.source_payload?.exhibitor_view_only);
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
        const next = await getSceneExhibitorState(scene);
        if (cancelled) return;
        const previous = lastAccess.current;
        lastAccess.current = next;
        setLocked(next.locked);
        // A tab opened before the admin action must not autosave its old submitted status.
        if (!next.locked && next.clientStatus === 'draft'
          && (previous.locked || previous.lockUpdatedAt !== next.lockUpdatedAt)) onReopen?.();
      } catch (error) {
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
