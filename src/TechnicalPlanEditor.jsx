import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Download, Save, RotateCcw, Trash2 } from 'lucide-react';
import { createTechnicalPlanSvgPages, exportTechnicalPdf } from './technicalExport.js';
import { moveTechnicalPlanElement, normalizeTechnicalPlanEdits } from './technicalPlanEdits.js';
import { loadTechnicalPlanEdits, saveTechnicalPlanEdits } from './data/technicalPlanStore.js';

export default function TechnicalPlanEditor({ sceneId, options, onClose }) {
  const [edits, setEdits] = useState(() => normalizeTechnicalPlanEdits());
  const [saved, setSaved] = useState(null);
  const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(null);
  const [pictoType, setPictoType] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Chargement…');
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const preview = useRef(null);
  const drag = useRef(null);
  const dirty = saved !== null && JSON.stringify(edits) !== saved;
  const ready = saved !== null;
  const choices = options.catalog.filter((entry) => entry.dimensions?.batPictoUrl);
  const selectedNote = edits.annotations.find((item) => item.id === selection?.id);
  const selectedExtra = edits.extras.find((item) => item.id === selection?.id);

  useEffect(() => {
    let active = true;
    loadTechnicalPlanEdits(sceneId).then((value) => {
      if (!active) return;
      setEdits(value.edits); setRevision(value.revision); setSaved(JSON.stringify(value.edits)); setStatus('');
    }).catch((reason) => { if (active) { setError(reason.message); setStatus(''); } });
    return () => { active = false; };
  }, [sceneId]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setRendering(true);
    const timer = setTimeout(() => {
      createTechnicalPlanSvgPages({ ...options, batEdits: edits }).then((value) => {
        if (active) { setPages(value); setPage((current) => Math.min(current, value.length - 1)); setRendering(false); }
      }).catch((reason) => { if (active) { setError(reason.message); setRendering(false); } });
    }, 100);
    return () => { active = false; clearTimeout(timer); };
  }, [options, edits, ready]);

  useEffect(() => {
    if (!preview.current) return;
    const svg = pages[page]?.cloneNode(true);
    preview.current.replaceChildren(...(svg ? [svg] : []));
    svg?.querySelectorAll('[data-bat-id]:not([display="none"])').forEach((element) => {
      const bounds = element.getBBox();
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      Object.entries({ x: bounds.x - 6, y: bounds.y - 6, width: Math.max(12, bounds.width + 12), height: Math.max(12, bounds.height + 12), fill: 'transparent', 'pointer-events': 'all', 'data-bat-hit': '' })
        .forEach(([key, value]) => hit.setAttribute(key, String(value)));
      element.prepend(hit);
    });
  }, [pages, page]);

  useEffect(() => {
    preview.current?.querySelectorAll('[data-bat-id]').forEach((element) => element.classList.toggle('bat-editor-selected', element.dataset.batId === selection?.id));
  }, [selection, pages, page]);

  useEffect(() => {
    const previous = document.activeElement;
    document.querySelector('.bat-editor > header button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const confirmUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', confirmUnload);
    return () => { document.body.style.overflow = previous; window.removeEventListener('beforeunload', confirmUnload); };
  }, [dirty]);

  const close = () => { if (!busy && (!dirty || window.confirm('Quitter sans enregistrer les modifications du BAT ?'))) onClose(); };
  const patchSelected = (patch) => setEdits((current) => normalizeTechnicalPlanEdits({ ...current,
    [selectedNote ? 'annotations' : 'extras']: current[selectedNote ? 'annotations' : 'extras'].map((item) => item.id === selection?.id ? { ...item, ...patch } : item) }));
  const addNote = () => {
    const id = `note-${crypto.randomUUID()}`;
    setEdits((current) => ({ ...current, annotations: [...current.annotations, { id, page, x: 0.6, y: 0.7, text: 'Nouvelle annotation', size: 20 }] }));
    setSelection({ id, kind: 'annotation', label: 'Annotation' });
  };
  const addPicto = () => {
    if (!pictoType) return;
    const id = `extra-${crypto.randomUUID()}`;
    setEdits((current) => ({ ...current, extras: [...current.extras, { id, type: pictoType, page, x: 0.6, y: 0.5, width: 0.06, height: 0.06, rotation: 0 }] }));
    setSelection({ id, kind: 'extra', label: choices.find((entry) => entry.type === pictoType)?.label });
  };
  const removeSelected = () => {
    if (!selection) return;
    setEdits((current) => selection.kind === 'item'
      ? { ...current, items: { ...current.items, [selection.id]: { ...current.items[selection.id], hidden: true } } }
      : { ...current, annotations: current.annotations.filter((item) => item.id !== selection.id), extras: current.extras.filter((item) => item.id !== selection.id) });
    setSelection(null);
  };
  const run = async (action) => {
    setBusy(true); setError(''); setStatus('');
    try { await action(); } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const result = await saveTechnicalPlanEdits(sceneId, edits, revision);
    setRevision(result.revision); setEdits(result.edits); setSaved(JSON.stringify(result.edits)); setStatus('BAT enregistré.');
  });
  const pagePoint = (event) => {
    const svg = preview.current?.querySelector('svg');
    if (!svg) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: point.x / svg.viewBox.baseVal.width, y: point.y / svg.viewBox.baseVal.height };
  };

  return createPortal(<div className="bat-editor" role="dialog" aria-modal="true" aria-label="Éditeur du BAT" onKeyDown={(event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input, textarea, select')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header><div><small>BAT · A3 paysage</small><h2>{options.documentInfo.title}</h2></div><span>{dirty ? 'Modifications non enregistrées' : 'Plan technique'}</span><button disabled={busy} onClick={close} aria-label="Fermer l'éditeur BAT"><X size={20} /></button></header>
    <div className="bat-editor-layout">
      <main>
        <nav aria-label="Pages du BAT">{pages.map((_, index) => <button key={index} className={page === index ? 'active' : ''} onClick={() => { setPage(index); setSelection(null); }}>Page {index + 1}</button>)}{rendering && <span role="status">Actualisation…</span>}</nav>
        <div className="bat-editor-paper" ref={preview} aria-label="Aperçu BAT : faites glisser un picto ou une annotation" onPointerDown={(event) => {
          if (busy || rendering) return;
          const target = event.target.closest?.('[data-bat-id]');
          const point = pagePoint(event);
          if (!target || !point) { setSelection(null); return; }
          const selected = { id: target.dataset.batId, kind: target.dataset.batKind, label: target.dataset.batLabel };
          setSelection(selected); drag.current = { ...selected, point, start: edits, target };
          event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
        }} onPointerMove={(event) => {
          if (!drag.current) return;
          const point = pagePoint(event); if (!point) return;
          const { target, point: start } = drag.current;
          const svg = preview.current.querySelector('svg');
          const base = drag.current.start.items[drag.current.id] || {};
          target.setAttribute('transform', `translate(${((base.dx || 0) + point.x - start.x) * svg.viewBox.baseVal.width} ${((base.dy || 0) + point.y - start.y) * svg.viewBox.baseVal.height})`);
        }} onPointerUp={(event) => {
          const current = drag.current; if (!current) return;
          const point = pagePoint(event); drag.current = null;
          if (point) setEdits(moveTechnicalPlanElement(current.start, current.id, current.kind, point.x - current.point.x, point.y - current.point.y));
        }} onPointerCancel={() => { drag.current = null; setPages((current) => [...current]); }} />
      </main>
      <aside>
        <fieldset disabled={busy || !ready} aria-label="Retouches du BAT">
        <h3>Personnaliser le BAT</h3><p>Les retouches concernent uniquement le document, jamais la scène ni le panier.</p>
        <button onClick={addNote} disabled={saved === null || busy}><Plus size={15} /> Ajouter une annotation</button>
        <label>Picto du catalogue<select aria-label="Picto du catalogue" value={pictoType} onChange={(event) => setPictoType(event.target.value)}><option value="">Choisir un objet…</option>{choices.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}</select></label>
        <button onClick={addPicto} disabled={!pictoType || saved === null || busy}><Plus size={15} /> Ajouter le picto</button>
        {selection && <section><h3>{selection.label || 'Élément sélectionné'}</h3>
          {selectedNote && <><label>Annotation<textarea aria-label="Texte de l'annotation" value={selectedNote.text} onChange={(event) => patchSelected({ text: event.target.value })} /></label><label>Taille du texte<input aria-label="Taille du texte" type="number" min="12" max="48" value={selectedNote.size} onChange={(event) => patchSelected({ size: event.target.value })} /></label></>}
          {selectedExtra && <><label>Largeur du picto (%)<input type="number" min="1" max="40" value={Math.round(selectedExtra.width * 100)} onChange={(event) => patchSelected({ width: Number(event.target.value) / 100 })} /></label><label>Hauteur du picto (%)<input type="number" min="1" max="40" value={Math.round(selectedExtra.height * 100)} onChange={(event) => patchSelected({ height: Number(event.target.value) / 100 })} /></label><label>Rotation<input type="number" value={selectedExtra.rotation} onChange={(event) => patchSelected({ rotation: event.target.value })} /></label></>}
          <div className="bat-editor-arrows" aria-label="Déplacer l'élément">{[['←', -0.005, 0], ['↑', 0, -0.005], ['↓', 0, 0.005], ['→', 0.005, 0]].map(([label, dx, dy]) => <button key={label} aria-label={`Déplacer ${label}`} onClick={() => setEdits((current) => moveTechnicalPlanElement(current, selection.id, selection.kind, dx, dy))}>{label}</button>)}</div>
          <button onClick={removeSelected}><Trash2 size={15} /> Retirer du BAT</button>
        </section>}
        <button onClick={() => { if (window.confirm('Retirer toutes les retouches du BAT ?')) { setEdits(normalizeTechnicalPlanEdits()); setSelection(null); } }} disabled={saved === null || busy}><RotateCcw size={15} /> Revenir au plan automatique</button>
        </fieldset>
        {error && <p className="bat-editor-error" role="alert">{error}</p>}{status && <p role="status">{status}</p>}
      </aside>
    </div>
    <footer><small>SVG conservés en vectoriel · export A3 multipage</small><button disabled={busy || saved === null} onClick={() => run(() => exportTechnicalPdf({ ...options, batEdits: edits }))}><Download size={16} /> Exporter le PDF</button><button className="primary" disabled={busy || saved === null || !dirty} onClick={save}><Save size={16} /> {busy ? 'En cours…' : 'Enregistrer'}</button></footer>
  </div>, document.body);
}
