import React, { useEffect, useState } from 'react';
import { deploymentAssetErrorMessage, isDeploymentAssetError } from './deploymentAssets.js';

export default function DeploymentUpdateNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const preloadError = () => setVisible(true);
    const rejectedImport = event => {
      if (!isDeploymentAssetError(event.reason)) return;
      setVisible(true);
      event.preventDefault();
    };
    window.addEventListener('vite:preloadError', preloadError);
    window.addEventListener('unhandledrejection', rejectedImport);
    return () => {
      window.removeEventListener('vite:preloadError', preloadError);
      window.removeEventListener('unhandledrejection', rejectedImport);
    };
  }, []);
  if (!visible) return null;
  return <aside className="deployment-update-notice" role="alert">
    <div><strong>Actualisation de l'application nécessaire</strong><p>{deploymentAssetErrorMessage}</p></div>
    <button type="button" onClick={() => window.location.reload()}>Recharger l'application</button>
    <button className="deployment-update-dismiss" type="button" aria-label="Masquer l'avertissement" onClick={() => setVisible(false)}>×</button>
  </aside>;
}
