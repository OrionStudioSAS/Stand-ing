import React, { useRef, useState } from 'react';
import { normalizeBatElectricalPicto } from './batElectricalPicto.js';

export default function AssetBatElectricalPictoEditor({ primaryUrl = '', metadata = {}, disabled = false, onUpload, onChange, onRemove }) {
  const icon = normalizeBatElectricalPicto(metadata);
  const preview = useRef(null);
  const [ratio, setRatio] = useState(1);
  const position = (x, y) => onChange?.({ batElectricalPictoX: x, batElectricalPictoY: y });
  const move = event => {
    const rect = preview.current?.getBoundingClientRect();
    if (!rect) return;
    const next = normalizeBatElectricalPicto({ ...metadata, batElectricalPictoX: (event.clientX - rect.left) / rect.width, batElectricalPictoY: (event.clientY - rect.top) / rect.height });
    position(next.x, next.y);
  };
  return <section className="bat-electrical-editor" aria-label="Second picto électrique BAT">
    <strong>Picto électrique superposé</strong>
    <p>Facultatif. Placé au centre du picto de l'objet par défaut. Glissez-le pour modifier sa position. SVG conseillé pour l'impression.</p>
    <label className="bat-electrical-upload">{icon.url ? 'Remplacer le picto électrique' : 'Importer un picto électrique'}
      <input type="file" aria-label="Importer le picto électrique" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload?.(file); event.target.value = ''; }} />
    </label>
    {icon.url && primaryUrl && <>
      <div ref={preview} className="bat-electrical-preview" style={{ width: `${Math.min(260, 220 * ratio)}px`, aspectRatio: ratio }}>
        <img src={primaryUrl} alt="Picto principal de l'objet" onLoad={event => setRatio((event.currentTarget.naturalWidth || 1) / (event.currentTarget.naturalHeight || 1))} />
        <button type="button" disabled={disabled} aria-label="Déplacer le picto électrique" style={{ left: `${icon.x * 100}%`, top: `${icon.y * 100}%`, width: `${icon.size * 100}%`, height: `${icon.size * 100}%` }}
          onPointerDown={event => { if (disabled) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onKeyDown={event => { const steps = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }; const step = steps[event.key]; if (step) { event.preventDefault(); const next = normalizeBatElectricalPicto({ ...metadata, batElectricalPictoX: icon.x + step[0], batElectricalPictoY: icon.y + step[1] }); position(next.x, next.y); } }}>
          <img src={icon.url} alt="Picto électrique" draggable="false" />
        </button>
      </div>
      <label>Taille du picto électrique <input type="range" aria-label="Taille du picto électrique" min="10" max="60" value={Math.round(icon.size * 100)} disabled={disabled} onChange={event => onChange?.({ batElectricalPictoSize: Number(event.target.value) / 100 })} /></label>
      <button type="button" disabled={disabled} onClick={() => position(.5, .5)}>Recentrer le picto électrique</button>
    </>}
    {icon.url && !primaryUrl && <p>Importez d'abord le picto principal de l'objet pour régler la position de la superposition.</p>}
    {icon.url && <button type="button" disabled={disabled} onClick={onRemove}>Supprimer uniquement le picto électrique</button>}
  </section>;
}
