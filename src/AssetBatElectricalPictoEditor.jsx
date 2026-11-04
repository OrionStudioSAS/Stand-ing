import React, { useRef, useState } from 'react';
import { batElectricalPictosMetadata, normalizeBatElectricalPictos } from './batElectricalPicto.js';

export default function AssetBatElectricalPictoEditor({ primaryUrl = '', metadata = {}, modelSize = [1, 1, .5], disabled = false, onUpload, onChange, onRemove }) {
  const icons = normalizeBatElectricalPictos(metadata);
  const [selection, setSelection] = useState(0);
  const selected = Math.min(selection, Math.max(0, icons.length - 1));
  const icon = icons[selected];
  const preview = useRef(null);
  const [iconRatios, setIconRatios] = useState({});
  const grabOffset = useRef({ x: 0, y: 0 });
  const width = Math.max(.05, Number(modelSize[0]) || 1);
  const depth = Math.max(.05, Number(modelSize[2]) || .5);
  const scale = Math.min(100, 220 / width, 130 / depth);
  const change = (index, patch) => onChange?.(batElectricalPictosMetadata(icons.map((entry, i) => i === index ? { ...entry, ...patch } : entry)));
  const position = (index, x, y) => change(index, { x, y });
  const move = (event, index) => {
    const rect = preview.current?.getBoundingClientRect();
    if (!rect) return;
    position(index, (event.clientX - rect.left) / rect.width - grabOffset.current.x, (event.clientY - rect.top) / rect.height - grabOffset.current.y);
  };
  const upload = (event, index) => {
    const file = event.target.files?.[0];
    if (file) { setSelection(index ?? icons.length); onUpload?.(file, index); }
    event.target.value = '';
  };
  return <section className="bat-electrical-editor" aria-label="Pictos électriques BAT">
    <strong>Pictos électriques superposés</strong>
    <p>Ajoutez plusieurs pictos et placez chacun indépendamment, même en dehors de l'objet. Taille de référence : 20 cm. Ils ne modifient ni les dimensions ni le placement de l'objet.</p>
    <label className="bat-electrical-upload">Ajouter un picto électrique
      <input type="file" aria-label="Importer le picto électrique" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => upload(event)} />
    </label>
    {icons.length > 0 && <>
      <div className="bat-electrical-selector" aria-label="Sélection du picto électrique">
        {icons.map((entry, index) => <button type="button" key={index} disabled={disabled} aria-pressed={selected === index} onClick={() => setSelection(index)}>Picto {index + 1}</button>)}
      </div>
      <button type="button" disabled={disabled} onClick={() => {
        onChange?.(batElectricalPictosMetadata([...icons, { ...icon, x: icon.x + .25 }]));
        setSelection(icons.length);
      }}>Ajouter un picto identique</button>
      <label className="bat-electrical-upload">Remplacer le picto sélectionné
        <input type="file" aria-label="Remplacer le picto électrique sélectionné" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => upload(event, selected)} />
      </label>
    </>}
    {icons.length > 0 && primaryUrl && <>
      <div className="bat-electrical-workspace"><div ref={preview} className="bat-electrical-preview" style={{ width: `${width * scale}px`, height: `${depth * scale}px` }}>
        <img src={primaryUrl} alt="Picto principal de l'objet" />
        {icons.map((entry, index) => <button type="button" key={index} disabled={disabled} aria-label={`Déplacer le picto électrique${icons.length > 1 ? ` ${index + 1}` : ''}`} aria-pressed={selected === index}
          style={{ left: `${entry.x * 100}%`, top: `${entry.y * 100}%`, width: `${entry.size * scale}px`, height: `${entry.size * scale / (iconRatios[entry.url] || 1)}px` }}
          onClick={() => setSelection(index)}
          onPointerDown={event => { if (disabled) return; event.preventDefault(); setSelection(index); const rect = preview.current.getBoundingClientRect(); grabOffset.current = { x: (event.clientX - rect.left) / rect.width - entry.x, y: (event.clientY - rect.top) / rect.height - entry.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) move(event, index); }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onKeyDown={event => { const steps = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }; const step = steps[event.key]; if (step) { event.preventDefault(); setSelection(index); position(index, entry.x + step[0], entry.y + step[1]); } }}>
          <img src={entry.url} alt={`Picto électrique ${index + 1}`} draggable="false" onLoad={event => { const ratio = (event.currentTarget.naturalWidth || 1) / (event.currentTarget.naturalHeight || 1); setIconRatios(current => current[entry.url] === ratio ? current : { ...current, [entry.url]: ratio }); }} />
        </button>)}
      </div></div>
      <label>Taille du picto sélectionné (cm) <input type="range" aria-label="Taille du picto électrique" min="5" max="100" value={Math.round(icon.size * 100)} disabled={disabled} onChange={event => change(selected, { size: Number(event.target.value) / 100 })} /><span>{Math.round(icon.size * 100)} cm</span></label>
      <div className="bat-electrical-coordinates">{[['X', 'x'], ['Y', 'y']].map(([axis, key]) => <label key={axis}>{axis} (%)<input type="number" aria-label={`Position électrique ${axis}`} min="-400" max="500" step="1" value={Math.round(icon[key] * 100)} disabled={disabled} onChange={event => change(selected, { [key]: Number(event.target.value) / 100 })} /></label>)}</div>
      <button type="button" disabled={disabled} onClick={() => position(selected, .5, .5)}>Recentrer le picto électrique</button>
    </>}
    {icons.length > 0 && !primaryUrl && <p>Importez d'abord le picto principal de l'objet pour régler la position des superpositions.</p>}
    {icons.length > 0 && <button type="button" disabled={disabled} onClick={() => { onRemove?.(selected); setSelection(Math.max(0, selected - 1)); }}>Supprimer uniquement le picto électrique sélectionné</button>}
  </section>;
}
