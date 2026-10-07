import { useEffect, useState } from 'react';
import { getSceneExhibitorReadOnly } from './data/sceneStore.js';

export function useSceneExhibitorReadOnly(scene, isAdminViewer = false, forceReadOnly = false) {
  const initialLocked = Boolean(scene.source_payload?.exhibitor_view_only);
  const [locked, setLocked] = useState(initialLocked);

  useEffect(() => setLocked(initialLocked), [scene.id, initialLocked]);
  useEffect(() => {
    if (isAdminViewer || forceReadOnly || !scene.id) return undefined;
    let cancelled = false;
    let checking = false;
    const refresh = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const next = await getSceneExhibitorReadOnly(scene);
        if (!cancelled) setLocked(next);
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
  }, [scene.id, isAdminViewer, forceReadOnly]);

  return Boolean(forceReadOnly) || (!isAdminViewer && locked);
}
