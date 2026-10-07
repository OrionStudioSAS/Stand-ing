import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Armchair, Check, DoorOpen, LockKeyhole, Move, Plus, RotateCw, Search, Square, Trash2, X } from 'lucide-react';
import {
  addReservePart,
  createReserveDraft,
  moveReservePart,
  removeReservePart,
  replaceReservePart,
  reserveCatalogEntries,
  reserveComponentRole,
  reserveCustomizationPricingLines,
  reservePartSize,
  reserveSlots,
  rotateReservePart,
  serializeReserveDraft,
  validateReserveDraft,
} from './reserveConfigurator.js';
import './reserveConfigurator.css';

const EMPTY_CATALOG = [];
const ROLE_LABELS = { door: 'Portes', partition: 'Cloisons', furniture: 'Mobilier' };
const ROLE_ICONS = { door: DoorOpen, partition: Square, furniture: Armchair };
const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const metric = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const nameOf = (asset) => asset?.label || asset?.name || asset?.type || 'Objet';
const categoryOf = (asset) => String(asset.category || asset.dimensions?.businessCategory || asset.dimensions?.category || 'Autres');
const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function AssetThumbnail({ asset, role }) {
  const Icon = ROLE_ICONS[role] || Armchair;
  const image = asset?.thumbnailUrl || asset?.thumbnail_url;
  return <span className="reserve-config-thumbnail">{image ? <img src={image} alt="" loading="lazy" /> : <Icon size={21} aria-hidden="true" />}</span>;
}

export default function ReserveConfiguratorModal({
  entry,
  catalog = EMPTY_CATALOG,
  customization = null,
  parentId = '',
  basePrice = 0,
  priceForEntry,
  referenceForEntry,
  onClose,
  onApply,
  readOnly = false,
}) {
  const editorCatalog = useMemo(() => reserveCatalogEntries(entry, catalog), [entry, catalog]);
  // Initialize once: opening/selection alone must never normalize saved transforms.
  const [draft, setDraft] = useState(() => createReserveDraft(entry, customization, editorCatalog));
  const [originalSerialization] = useState(() => JSON.stringify(serializeReserveDraft(draft)));
  const draftRef = useRef(draft);
  const baselineTypes = useRef(new Set((draft.baseline || draft.parts).map((part) => part.type)));
  const [selectedId, setSelectedId] = useState(() => draft.parts.find((part) => part.role === 'door')?.id || null);
  const [tab, setTab] = useState('structure');
  const [libraryRole, setLibraryRole] = useState('door');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState(null);
  const [heightEdit, setHeightEdit] = useState(null);
  const heightEditRef = useRef(null);
  const applyingRef = useRef(false);
  const mountedRef = useRef(false);
  const dragRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const svgRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const id = useId().replace(/:/g, '');
  const titleId = `${id}-title`;
  const hintId = `${id}-hint`;
  const selected = draft.parts.find((part) => part.id === selectedId);
  const slots = useMemo(() => reserveSlots(draft.frame), [draft.frame]);
  const required = useMemo(() => new Set(draft.requiredSlots), [draft.requiredSlots]);
  const availableSlots = useMemo(() => slots.filter((slot) => required.has(slot.id)), [slots, required]);
  const library = useMemo(() => {
    // The helper owns availability, including baseline children and variant roles.
    return editorCatalog.filter((asset, index) => editorCatalog.findIndex((other) => other.type === asset.type) === index)
      .map((asset) => ({ asset, role: reserveComponentRole(asset) || 'furniture' }));
  }, [editorCatalog]);
  const assetsByType = useMemo(() => new Map(editorCatalog.map((asset) => [asset.type, asset])), [editorCatalog]);
  const categories = useMemo(() => [...new Set(library.filter((item) => item.role === libraryRole).map(({ asset }) => categoryOf(asset)))].sort(), [library, libraryRole]);
  const filteredLibrary = library.filter(({ asset, role }) => role === libraryRole
    && (category === 'all' || categoryOf(asset) === category)
    && normalize(`${nameOf(asset)} ${asset.type} ${asset.reference || ''} ${categoryOf(asset)}`).includes(normalize(search)));
  const validation = useMemo(() => validateReserveDraft(draft, editorCatalog), [draft, editorCatalog]);
  const lines = useMemo(() => reserveCustomizationPricingLines(entry, draft, editorCatalog, { priceForEntry, referenceForEntry, parentId }), [entry, draft, editorCatalog, priceForEntry, referenceForEntry, parentId]);
  const unchanged = useMemo(() => JSON.stringify(serializeReserveDraft(draft)) === originalSerialization, [draft, originalSerialization]);
  const extraTotal = lines.reduce((sum, line) => sum + finite(line.total), 0);
  const disabled = readOnly || applying;
  const isImmutable = (part) => part.role !== 'furniture' && !required.has(part.slotId);
  const selectedAsset = selected && assetsByType.get(selected.type);
  const selectedLocked = selected && isImmutable(selected);
  const replaceStructure = selected && selected.role !== 'furniture' && !selectedLocked;
  const replacements = selected ? library.filter(({ role }) => selected.role === 'furniture' ? role === 'furniture' : role !== 'furniture') : [];
  const maxFurnitureHeight = selected ? Math.max(0, Number((2.5 - reservePartSize(selected, editorCatalog)[1]).toFixed(6))) : 0;
  const width = Math.max(0.2, finite(draft.frame.width));
  const depth = Math.max(0.2, finite(draft.frame.depth));
  const scale = 100;
  const padding = 52;
  const viewWidth = width * scale + padding * 2;
  const viewDepth = depth * scale + padding * 2;
  const planX = (x) => padding + (finite(x) - finite(draft.frame.minX)) * scale;
  const planZ = (z) => padding + (finite(z) - finite(draft.frame.minZ)) * scale;

  useEffect(() => {
    mountedRef.current = true;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const focusable = () => [...(dialogRef.current?.querySelectorAll(focusableSelector) || [])]
      .filter((node) => node.getClientRects().length && node.getAttribute('aria-hidden') !== 'true');
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (applyingRef.current) return;
        dragRef.current = null;
        setPreview(null);
        onCloseRef.current?.();
      } else if (event.key === 'Tab') {
        const nodes = focusable();
        const first = nodes[0] || dialogRef.current;
        const last = nodes[nodes.length - 1] || first;
        if (!dialogRef.current?.contains(document.activeElement)
          || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)
          || document.activeElement === dialogRef.current) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    const onFocusIn = (event) => {
      if (!dialogRef.current?.contains(event.target)) closeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      mountedRef.current = false;
      dragRef.current = null;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      dragRef.current = null;
      setPreview(null);
    }
  }, [disabled]);

  function commit(result, message = 'Brouillon mis à jour.') {
    if (readOnly || applyingRef.current) return false;
    if (result.error) {
      setError(String(result.error));
      return false;
    }
    draftRef.current = result.draft;
    setDraft(result.draft);
    setError('');
    setAnnouncement(message);
    return true;
  }

  function selectPart(part) {
    if (heightEditRef.current?.id !== part.id) {
      heightEditRef.current = null;
      setHeightEdit(null);
    }
    setSelectedId(part.id);
    setTab(part.role === 'furniture' ? 'equipment' : 'structure');
    setLibraryRole(part.role);
    setCategory('all');
  }

  function changeTab(next) {
    setTab(next);
    setLibraryRole(next === 'structure' ? 'partition' : 'furniture');
    setCategory('all');
  }

  function closestSlot(position) {
    return slots.reduce((best, slot) => !best
      || Math.hypot(slot.x - position.x, slot.z - position.z) < Math.hypot(best.x - position.x, best.z - position.z)
      ? slot : best, null);
  }

  function movePart(part, position) {
    if (disabled || isImmutable(part)) return;
    const slot = part.role === 'furniture' ? null : closestSlot(position);
    if (part.role !== 'furniture' && !slot) {
      setError('Aucun emplacement de structure disponible.');
      return;
    }
    commit(moveReservePart(draftRef.current, part.id, slot ? { x: slot.x, z: slot.z } : position, editorCatalog));
  }

  function planPoint(event) {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const point = svgRef.current.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: (local.x - padding) / scale + finite(draft.frame.minX), z: (local.y - padding) / scale + finite(draft.frame.minZ) };
  }

  function beginDrag(event, part) {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    selectPart(part);
    event.currentTarget.focus({ preventScroll: true });
    if (disabled || isImmutable(part)) return;
    const point = planPoint(event);
    if (!point) return;
    event.preventDefault();
    svgRef.current.setPointerCapture(event.pointerId);
    dragRef.current = { id: part.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: point.x - part.x, offsetZ: point.z - part.z, moved: false, position: null };
  }

  function updateDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
    const point = planPoint(event);
    if (!point) return;
    drag.moved = true;
    const position = { x: point.x - drag.offsetX, z: point.z - drag.offsetZ };
    const part = draftRef.current.parts.find((item) => item.id === drag.id);
    const slot = part?.role === 'furniture' ? null : closestSlot(position);
    drag.position = slot ? { x: slot.x, z: slot.z } : position;
    const oldSlot = slots.find((item) => item.id === part?.slotId);
    setPreview({ id: drag.id, ...drag.position, rotation: slot ? finite(part?.rotation) + slot.rotation - finite(oldSlot?.rotation) : part?.rotation, slotId: slot?.id, blocked: slot && !required.has(slot.id) });
  }

  function endDrag(event, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!cancelled) updateDrag(event);
    dragRef.current = null;
    setPreview(null);
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    const part = draftRef.current.parts.find((item) => item.id === drag.id);
    if (!cancelled && drag.moved && drag.position && part) movePart(part, drag.position);
  }

  function partKeyDown(event, part) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPart(part);
      return;
    }
    if (disabled || isImmutable(part)) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    selectPart(part);
    if (part.role !== 'furniture') {
      const target = availableSlots.filter((slot) => (slot.x - part.x) * direction[0] + (slot.z - part.z) * direction[1] > 0.01)
        .sort((a, b) => Math.hypot(a.x - part.x, a.z - part.z) - Math.hypot(b.x - part.x, b.z - part.z))[0];
      if (target) movePart(part, { x: target.x, z: target.z });
    } else {
      const step = event.shiftKey ? 0.25 : 0.05;
      movePart(part, { x: part.x + direction[0] * step, z: part.z + direction[1] * step });
    }
  }

  function addPart(asset) {
    if (disabled) return;
    const current = draftRef.current;
    if (reserveComponentRole(asset) !== 'furniture' && replaceStructure) {
      const result = replaceReservePart(current, selected.id, asset.type, editorCatalog);
      if (commit(result, 'Modèle de structure remplacé.')) selectPart(result.draft.parts.find((part) => part.id === selected.id));
      return;
    }
    const result = addReservePart(current, asset.type, editorCatalog);
    if (commit(result, `${nameOf(asset)} ajouté au brouillon.`)) {
      const added = result.draft.parts.find((part) => !current.parts.some((old) => old.id === part.id));
      if (added) selectPart(added);
    }
  }

  function removeSelected() {
    if (!selected || disabled || selectedLocked) return;
    commit({ draft: removeReservePart(draftRef.current, selected.id) }, 'Objet retiré du brouillon.');
    setSelectedId(null);
    heightEditRef.current = null;
    setHeightEdit(null);
  }

  function commitHeightEdit() {
    const edit = heightEditRef.current;
    if (!edit) return true;
    const part = draftRef.current.parts.find((item) => item.id === edit.id);
    if (!part || disabled) return false;
    const y = Number(edit.value);
    const maximum = Math.max(0, 2.5 - reservePartSize(part, editorCatalog)[1]);
    if (!edit.value.trim() || !Number.isFinite(y) || y < 0 || y > maximum + 0.000001) {
      setError(`Saisissez une hauteur entre 0 et ${metric.format(maximum)} m.`);
      heightEditRef.current = { ...edit, invalid: true };
      setHeightEdit(heightEditRef.current);
      return false;
    }
    // Merely focusing/blurring this field must not reposition an original asset.
    if (y !== part.y && !commit(moveReservePart(draftRef.current, part.id, { x: part.x, y, z: part.z }, editorCatalog))) {
      heightEditRef.current = { ...edit, invalid: true };
      setHeightEdit(heightEditRef.current);
      return false;
    }
    heightEditRef.current = null;
    setHeightEdit(null);
    setError('');
    return true;
  }

  async function apply() {
    if (readOnly || applyingRef.current) return;
    if (!commitHeightEdit()) return;
    const serialized = serializeReserveDraft(draftRef.current);
    if (JSON.stringify(serialized) === originalSerialization) {
      onCloseRef.current?.();
      return;
    }
    if (typeof onApply !== 'function') return;
    const issues = validateReserveDraft(draftRef.current, editorCatalog);
    if (issues.length) {
      setError(issues.join(' '));
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setError('');
    try {
      // Persistence and closing belong to the caller; even a void return is not a save confirmation.
      await onApply(serialized);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Impossible d'appliquer la configuration. Veuillez réessayer.");
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  }

  const displayedParts = draft.parts.filter((part) => tab === 'equipment' ? part.role === 'furniture' : part.role !== 'furniture');

  return createPortal(
    <div className="reserve-config-layer" onPointerDown={(event) => {
      if (!applyingRef.current && event.target === event.currentTarget && event.isPrimary && event.button === 0) onClose?.();
    }}>
      <section className="reserve-config-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={hintId} aria-busy={applying} tabIndex={-1}>
        <header className="reserve-config-header">
          <span className="reserve-config-heading-icon"><DoorOpen size={23} aria-hidden="true" /></span>
          <div className="reserve-config-heading">
            <span className="reserve-config-eyebrow">Mini configurateur / Réserve</span>
            <h2 id={titleId}>{nameOf(entry)}</h2>
            <p>{metric.format(draft.frame.width)}{' \u00d7 '}{metric.format(draft.frame.depth)} m <span aria-hidden="true">/</span> {metric.format(draft.frame.width * draft.frame.depth)} m<sup>2</sup></p>
          </div>
          <span className="reserve-config-draft-badge">{readOnly ? 'Lecture seule' : 'Brouillon'}</span>
          <button ref={closeRef} className="reserve-config-icon-button" type="button" disabled={applying} aria-label="Fermer le configurateur sans enregistrer" onClick={() => onClose?.()}><X size={21} aria-hidden="true" /></button>
        </header>

        <div className="reserve-config-tabs" role="tablist" aria-label="Configuration de la réserve">
          {[['structure', 'Structure', Square], ['equipment', 'Équipements', Armchair]].map(([key, label, Icon], index) => (
            <button key={key} id={`${id}-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`${id}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => changeTab(key)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'structure' : event.key === 'End' ? 'equipment' : index === 0 ? 'equipment' : 'structure';
              changeTab(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}><Icon size={16} aria-hidden="true" />{label}<span>{draft.parts.filter((part) => key === 'equipment' ? part.role === 'furniture' : part.role !== 'furniture').length}</span></button>
          ))}
        </div>

        <div className="reserve-config-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
          <div className="reserve-config-workspace">
            <div className="reserve-config-plan-heading"><div><h3>Plan de la réserve</h3><p>Vue de dessus <span aria-hidden="true">/</span> dimensions en mètres</p></div><span className="reserve-config-plan-tag">2D</span></div>
            <div className={`reserve-config-plan${preview ? ' is-dragging' : ''}`}>
              <svg ref={svgRef} viewBox={`0 0 ${viewWidth} ${viewDepth}`} role="group" aria-label="Plan interactif de la réserve" aria-describedby={hintId} onPointerMove={updateDrag} onPointerUp={(event) => endDrag(event)} onPointerCancel={(event) => endDrag(event, true)} onLostPointerCapture={(event) => endDrag(event, true)}>
                <defs><pattern id={`${id}-grid`} width="25" height="25" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="#dce3ed" /></pattern></defs>
                <rect width={viewWidth} height={viewDepth} fill={`url(#${id}-grid)`} />
                <rect x={padding} y={padding} width={width * scale} height={depth * scale} className="reserve-config-floor" />
                <g className="reserve-config-dimension" aria-hidden="true">
                  <path d={`M ${padding} 25 H ${padding + width * scale} M ${padding} 21 v 8 M ${padding + width * scale} 21 v 8`} />
                  <text x={padding + width * scale / 2} y="18" textAnchor="middle">{metric.format(draft.frame.width)} m</text>
                  <text transform={`translate(20 ${padding + depth * scale / 2}) rotate(-90)`} textAnchor="middle">{metric.format(draft.frame.depth)} m</text>
                  <text x={padding + width * scale / 2} y={padding + depth * scale + 37} textAnchor="middle">FAÇADE / ACCÈS</text>
                </g>
                {slots.map((slot) => {
                  const fixed = !required.has(slot.id);
                  const occupied = draft.parts.some((part) => part.role !== 'furniture' && part.slotId === slot.id);
                  return <g key={slot.id} transform={`translate(${planX(slot.x)} ${planZ(slot.z)}) rotate(${-finite(slot.rotation)})`} className={`reserve-config-slot${fixed ? ' is-fixed' : ''}${preview?.slotId === slot.id && !fixed ? ' is-target' : ''}`}>
                    <title>{slot.label || slot.id} : {fixed ? 'mur du stand, non modifiable' : occupied ? 'emplacement occupé, échange possible' : 'emplacement de 1 m libre'}</title>
                    <rect x="-46" y="-7" width="92" height="14" rx="2" />
                    {!fixed && !occupied && <text x="0" y="3" textAnchor="middle">1 m</text>}
                  </g>;
                })}
                {draft.parts.map((part) => {
                  const [w, , d] = reservePartSize(part, editorCatalog);
                  const furniture = part.role === 'furniture';
                  const locked = isImmutable(part);
                  const asset = assetsByType.get(part.type);
                  const shapeWidth = Math.max(finite(w), 0.1) * scale;
                  const shapeDepth = Math.max(finite(d), furniture ? 0.1 : 0.08) * scale;
                  return <g key={part.id} transform={`translate(${planX(part.x)} ${planZ(part.z)}) rotate(${-finite(part.rotation)})`} role="button" tabIndex={0} aria-label={`${nameOf(asset || part)}, ${ROLE_LABELS[part.role] || 'Objet'}${locked ? ', mur non modifiable' : ', sélectionner et déplacer avec les flèches'}`} aria-pressed={selectedId === part.id} className={`reserve-config-part is-${part.role}${selectedId === part.id ? ' is-selected' : ''}${locked ? ' is-locked' : ''}${preview?.id === part.id ? ' is-origin' : ''}`} onPointerDown={(event) => beginDrag(event, part)} onClick={() => selectPart(part)} onKeyDown={(event) => partKeyDown(event, part)}>
                    <title>{nameOf(asset || part)}</title>
                    <rect className="reserve-config-part-hit" x={-shapeWidth / 2} y={-Math.max(shapeDepth, 28) / 2} width={shapeWidth} height={Math.max(shapeDepth, 28)} />
                    <rect className="reserve-config-part-shape" x={-shapeWidth / 2} y={-shapeDepth / 2} width={shapeWidth} height={shapeDepth} rx={furniture ? 5 : 1} />
                    {part.role === 'door' && <path className="reserve-config-door-swing" d={`M ${-shapeWidth / 2} 0 v ${-shapeWidth * 0.65} A ${shapeWidth * 0.65} ${shapeWidth * 0.65} 0 0 1 ${shapeWidth * 0.15} 0`} />}
                    {furniture && <text textAnchor="middle" dominantBaseline="central" transform={`rotate(${finite(part.rotation)})`}>{draft.parts.filter((item) => item.role === 'furniture').findIndex((item) => item.id === part.id) + 1}</text>}
                  </g>;
                })}
                {preview && selected && (() => {
                  const [w, , d] = reservePartSize(selected, editorCatalog);
                  return <g className={`reserve-config-preview${preview.blocked ? ' is-blocked' : ''}`} aria-hidden="true" transform={`translate(${planX(preview.x)} ${planZ(preview.z)}) rotate(${-finite(preview.rotation)})`}><rect x={-finite(w) * scale / 2} y={-Math.max(finite(d), 0.08) * scale / 2} width={Math.max(finite(w), 0.1) * scale} height={Math.max(finite(d), 0.08) * scale} rx="3" /></g>;
                })()}
              </svg>
            </div>
            <div className="reserve-config-legend"><span><i className="is-structure" />Structure</span><span><i className="is-furniture" />Mobilier</span><span><i className="is-fixed" /><LockKeyhole size={12} aria-hidden="true" />Mur du stand</span></div>
            <p className="reserve-config-hint" id={hintId}><Move size={14} aria-hidden="true" />{readOnly ? 'Sélectionnez un objet pour consulter ses détails.' : 'Glissez un objet ou utilisez les flèches. Les cloisons et portes se placent sur les emplacements de 1 m, avec échange si nécessaire.'}</p>
            <section className="reserve-config-composition" aria-label="Composition actuelle">
              <div className="reserve-config-section-heading"><h3>{tab === 'structure' ? 'Votre structure' : 'Vos équipements'}</h3><span>{displayedParts.length} objet{displayedParts.length !== 1 ? 's' : ''}</span></div>
              <div className="reserve-config-parts-list">{displayedParts.length ? displayedParts.map((part) => <button key={part.id} type="button" className={selectedId === part.id ? 'is-selected' : ''} aria-pressed={selectedId === part.id} onClick={() => selectPart(part)}><AssetThumbnail asset={assetsByType.get(part.type)} role={part.role} /><span>{nameOf(assetsByType.get(part.type) || part)}<small>{isImmutable(part) ? 'Mur du stand / fixe' : part.role === 'furniture' ? 'Placement libre' : 'Emplacement de 1 m'}</small></span></button>) : <p className="reserve-config-empty">Aucun objet dans cette section. Ajoutez-en depuis la bibliothèque.</p>}</div>
            </section>
            <details className="reserve-config-pricing">
              <summary><span>Détail du prix <small>{lines.length} ligne{lines.length !== 1 ? 's' : ''}</small></span><strong>{currency.format(finite(basePrice) + extraTotal)}</strong></summary>
              <div className="reserve-config-price-line"><span>Réserve de base</span><strong>{currency.format(finite(basePrice))}</strong></div>
              {lines.map((line, index) => <div className="reserve-config-price-line" key={`${line.type}-${line.reference}-${index}`}><span>{line.label}<small>{line.reference && `${line.reference} / `}{metric.format(line.quantity)}{' \u00d7 '}{currency.format(finite(line.unitPrice))}</small></span><strong>{currency.format(finite(line.total))}</strong></div>)}
              {!lines.length && <p>Aucun supplément.</p>}
              <div className="reserve-config-price-line is-total"><span>Réserve + options HT</span><strong>{currency.format(finite(basePrice) + extraTotal)}</strong></div>
            </details>
          </div>

          <aside className="reserve-config-sidebar" aria-label="Objets et bibliothèque">
            <section className="reserve-config-inspector" aria-label="Objet sélectionné">
              <div className="reserve-config-section-heading"><h3>Objet sélectionné</h3>{selected && <span>{ROLE_LABELS[selected.role]}</span>}</div>
              {selected ? <>
                <div className="reserve-config-selected-name"><AssetThumbnail asset={selectedAsset} role={selected.role} /><strong>{nameOf(selectedAsset || selected)}</strong></div>
                <label>Modèle<select aria-label="Changer le modèle de l'objet sélectionné" value={selected.type} disabled={disabled || selectedLocked} onChange={(event) => commit(replaceReservePart(draftRef.current, selected.id, event.target.value, editorCatalog))}>
                  {!replacements.some(({ asset }) => asset.type === selected.type) && <option value={selected.type}>{nameOf(selectedAsset || selected)}</option>}
                  {replacements.map(({ asset, role }) => <option key={asset.type} value={asset.type}>{nameOf(asset)}{selected.role !== 'furniture' ? ` / ${ROLE_LABELS[role]}` : ''}</option>)}
                </select></label>
                <div className="reserve-config-transform-readout"><span>Position <strong>{metric.format(selected.x)} / {metric.format(selected.z)} m</strong></span><span>Rotation <strong>{metric.format(selected.rotation)}{'\u00b0'}</strong></span></div>
                {selected.role === 'furniture' && <label className="reserve-config-height">Hauteur au-dessus du sol (m)<input type="number" min="0" max={maxFurnitureHeight} step="0.01" disabled={disabled} aria-label="Hauteur de placement du mobilier en mètres" aria-describedby={`${id}-height-hint`} aria-invalid={heightEdit?.id === selected.id && heightEdit.invalid ? 'true' : undefined} value={heightEdit?.id === selected.id ? heightEdit.value : String(selected.y)} onChange={(event) => {
                  heightEditRef.current = { id: selected.id, value: event.target.value, invalid: false };
                  setHeightEdit(heightEditRef.current);
                }} onBlur={commitHeightEdit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} /><small id={`${id}-height-hint`}>De 0 à {metric.format(maxFurnitureHeight)} m. Permet de placer un accessoire sur une étagère.</small></label>}
                <div className="reserve-config-inspector-actions">
                  <button type="button" disabled={disabled || selectedLocked} aria-label={`Tourner ${nameOf(selectedAsset || selected)} de ${selected.role === 'furniture' ? 90 : 180} degrés`} onClick={() => commit(rotateReservePart(draftRef.current, selected.id, editorCatalog))}><RotateCw size={15} aria-hidden="true" />{selected.role === 'furniture' ? 'Tourner' : 'Inverser'}</button>
                  <button type="button" className="is-danger" disabled={disabled || selectedLocked} aria-label={`Retirer ${nameOf(selectedAsset || selected)} du brouillon`} onClick={removeSelected}><Trash2 size={15} aria-hidden="true" />Retirer</button>
                </div>
                {selectedLocked && <p className="reserve-config-note">Ce mur du stand est fixe et ne peut pas être modifié.</p>}
              </> : <p className="reserve-config-empty">Cliquez sur le plan ou sur un objet de la composition pour le modifier.</p>}
            </section>

            <section className="reserve-config-library" aria-label="Bibliothèque disponible">
              <div className="reserve-config-section-heading"><h3>Bibliothèque</h3><span>{filteredLibrary.length} modèle{filteredLibrary.length !== 1 ? 's' : ''}</span></div>
              <label className="reserve-config-search"><Search size={16} aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un objet..." aria-label="Rechercher dans la bibliothèque de la reserve" /></label>
              <div className="reserve-config-library-filters"><label>Type<select value={libraryRole} aria-label="Filtrer les objets par rôle" onChange={(event) => { setLibraryRole(event.target.value); setCategory('all'); }}>
                {Object.entries(ROLE_LABELS).filter(([role]) => tab === 'equipment' ? role === 'furniture' : role !== 'furniture').map(([role, label]) => <option key={role} value={role}>{label}</option>)}
              </select></label><label>Catégorie<select value={category} aria-label="Filtrer la bibliothèque par catégorie" onChange={(event) => setCategory(event.target.value)}><option value="all">Toutes</option>{categories.map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
              <div className="reserve-config-library-list">{filteredLibrary.length ? filteredLibrary.map(({ asset, role }) => <article key={asset.type}>
                <AssetThumbnail asset={asset} role={role} /><div><strong>{nameOf(asset)}</strong><small>{baselineTypes.current.has(asset.type) ? 'Modèle de la composition initiale' : categoryOf(asset)}</small></div>
                <button type="button" className="reserve-config-add" disabled={disabled} aria-label={role !== 'furniture' && replaceStructure ? `Utiliser ${nameOf(asset)} pour le module sélectionné` : `Ajouter ${nameOf(asset)} à la réserve`} onClick={() => addPart(asset)}>{role !== 'furniture' && replaceStructure ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}</button>
              </article>) : <p className="reserve-config-empty">Aucun modèle disponible pour ces filtres.</p>}</div>
            </section>
          </aside>
        </div>

        {(error || validation.length > 0) && <div className="reserve-config-errors" role="alert">{error && <p>{error}</p>}{validation.length > 0 && <ul>{validation.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}</div>}
        <span className="reserve-config-sr-only" role="status" aria-live="polite">{announcement}</span>
        <footer className="reserve-config-footer">
          <div className="reserve-config-footer-price"><span>Réserve + options HT</span><strong>{currency.format(finite(basePrice) + extraTotal)}</strong><small>{readOnly ? 'Consultation uniquement' : "Avant forfait du pack et éventuelle assurance."}</small></div>
          <div className="reserve-config-footer-actions"><button type="button" className="reserve-config-cancel" disabled={applying} onClick={() => onClose?.()} aria-label="Annuler et fermer sans enregistrer">{readOnly ? 'Fermer' : 'Annuler'}</button>{!readOnly && <button type="button" className="reserve-config-apply" onClick={apply} disabled={applying || Boolean(preview) || (!unchanged && (validation.length > 0 || typeof onApply !== 'function'))} aria-label="Enregistrer et appliquer la configuration de la réserve">{applying ? 'Application...' : 'Enregistrer et appliquer'}</button>}</div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
