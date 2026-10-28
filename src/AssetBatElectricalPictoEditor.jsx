import React, { useRef, useState } from 'react';
import { normalizeBatElectricalPicto } from './batElectricalPicto.js';

export default function AssetBatElectricalPictoEditor({ primaryUrl = '', metadata = {}, modelSize = [1, 1, .5], disabled = false, onUpload, onChange, onRemove }) {
  const icon = normalizeBatElectricalPicto(metadata);
  const preview = useRef(null);
  const [iconRatio, setIconRatio] = useState(1);
  const grabOffset = useRef({ x: 0, y: 0 });
  const width = Math.max(.05, Number(modelSize[0]) || 1);
  const depth = Math.max(.05, Number(modelSize[2]) || .5);
  const scale = Math.min(100, 220 / width, 130 / depth);
  const position = (x, y) => onChange?.({ batElectricalPictoX: x, batElectricalPictoY: y });
  const move = event => {
    const rect = preview.current?.getBoundingClientRect();
    if (!rect) return;
    const next = normalizeBatElectricalPicto({ ...metadata, batElectricalPictoX: (event.clientX - rect.left) / rect.width - grabOffset.current.x, batElectricalPictoY: (event.clientY - rect.top) / rect.height - grabOffset.current.y });
    position(next.x, next.y);
  };
  return <section className="bat-electrical-editor" aria-label="Second picto électrique BAT">
    <strong>Picto électrique superposé</strong>
    <p>Annotation indépendante : taille de référence 20 cm, identique sur tous les objets du BAT. Glissez-la, y compris en dehors de l'objet. Elle ne modifie ni ses dimensions ni son placement.</p>
    <label className="bat-electrical-upload">{icon.url ? 'Remplacer le picto électrique' : 'Importer un picto électrique'}
      <input type="file" aria-label="Importer le picto électrique" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) onUpload?.(file); event.target.value = ''; }} />
    </label>
    {icon.url && primaryUrl && <>
      <div className="bat-electrical-workspace"><div ref={preview} className="bat-electrical-preview" style={{ width: `${width * scale}px`, height: `${depth * scale}px` }}>
        <img src={primaryUrl} alt="Picto principal de l'objet" />
        <button type="button" disabled={disabled} aria-label="Déplacer le picto électrique" style={{ left: `${icon.x * 100}%`, top: `${icon.y * 100}%`, width: `${icon.size * scale}px`, height: `${icon.size * scale / iconRatio}px` }}
          onPointerDown={event => { if (disabled) return; event.preventDefault(); const rect = preview.current.getBoundingClientRect(); grabOffset.current = { x: (event.clientX - rect.left) / rect.width - icon.x, y: (event.clientY - rect.top) / rect.height - icon.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) move(event); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onKeyDown={event => { const steps = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }; const step = steps[event.key]; if (step) { event.preventDefault(); const next = normalizeBatElectricalPicto({ ...metadata, batElectricalPictoX: icon.x + step[0], batElectricalPictoY: icon.y + step[1] }); position(next.x, next.y); } }}>
          <img src={icon.url} alt="Picto électrique" draggable="false" onLoad={event => setIconRatio((event.currentTarget.naturalWidth || 1) / (event.currentTarget.naturalHeight || 1))} />
        </button>
      </div></div>
      <label>Taille du picto électrique (cm) <input type="range" aria-label="Taille du picto électrique" min="5" max="100" value={Math.round(icon.size * 100)} disabled={disabled} onChange={event => onChange?.({ batElectricalPictoSizeMeters: Number(event.target.value) / 100 })} /><span>{Math.round(icon.size * 100)} cm</span></label>
      <div className="bat-electrical-coordinates">{[['X', 'batElectricalPictoX', icon.x], ['Y', 'batElectricalPictoY', icon.y]].map(([axis, key, value]) => <label key={axis}>{axis} (%)<input type="number" aria-label={`Position électrique ${axis}`} min="-400" max="500" step="1" value={Math.round(value * 100)} disabled={disabled} onChange={event => onChange?.({ [key]: Number(event.target.value) / 100 })} /></label>)}</div>
      <button type="button" disabled={disabled} onClick={() => position(.5, .5)}>Recentrer le picto électrique</button>
    </>}
    {icon.url && !primaryUrl && <p>Importez d'abord le picto principal de l'objet pour régler la position de la superposition.</p>}
    {icon.url && <button type="button" disabled={disabled} onClick={onRemove}>Supprimer uniquement le picto électrique</button>}
  </section>;
}
