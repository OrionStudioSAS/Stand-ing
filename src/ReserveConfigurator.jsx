import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeftRight, Ban, Box, Check, ChevronRight, Copy, DoorOpen, Eye, HelpCircle, Info,
  Layers, Package, Plus, Redo2, RotateCw, Ruler, Search, Send, Trash2, Undo2, X, Zap,
} from 'lucide-react';
import {
  RESERVE_DOOR_LEAF, RESERVE_GRID, boundsOverlap, childFootprint, clampFloorContent, contentCenter, contentFootprint,
  doorDistanceFromLeft, findFreeReserveSpot, footprintBounds, formatReserveCm, formatReserveMetres, isReservePowerSource,
  isWallBuiltin, refitReserveContents, reserveBuiltinChildren, reserveChildSize, reserveContentIssues, reserveDoorSlots,
  reserveDoorState, reserveFreeSurfaceRatio, reserveInterior, reserveSegments, snapToGrid, snapWallContent,
} from './reserveConfigurator.js';
import './reserveConfigurator.css';

/*
 * The reserve configurator is a pure view over a "model" prepared by the configurator:
 * it never touches scene items directly. All changes are kept in a local draft and handed
 * back through onCommit, so cancelling leaves the stand exactly as it was.
 */

const STEPS = [
  { id: 'structure', label: 'Structure' },
  { id: 'door', label: 'Porte' },
  { id: 'layout', label: 'Aménagement' },
];
const SIDE_LABELS = { front: 'Façade', left: 'Côté gauche', right: 'Côté droit', back: 'Fond' };
const PLACEMENT_LABELS = { left: 'Coin arrière gauche', center: 'Centre arrière', right: 'Coin arrière droit' };
// "2,00 × 1,00 m" read the other way round when the reserve runs along its side wall.
const orientedDims = (dims = '', vertical = false) => (vertical ? String(dims).replace(/^([\d,.]+) × ([\d,.]+)/, '$2 × $1') : dims);
const orientationLabel = (orientation = 'horizontal', corner = 'left') => (orientation === 'vertical'
  ? `Le long du mur ${corner === 'right' ? 'droit' : 'gauche'}` : 'Le long du fond');
const CATEGORY_LABELS = { all: 'Tout', storage: 'Rangement', appliance: 'Électroménager', wall: 'Mural', electric: 'Électricité' };
const ISSUE_LABELS = {
  door: 'Bloque l’ouverture de la porte',
  overlap: 'Chevauche un autre objet',
  outside: 'Dépasse de la réserve',
};
const identity = (value) => value;

export function formatReservePrice(value = 0) {
  return `${Math.round(Number(value || 0)).toLocaleString('fr-FR')} €`;
}

export function reservePriceTag(value = 0, included = false) {
  return included || Number(value || 0) <= 0 ? 'Inclus' : `+ ${formatReservePrice(value)}`;
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count > 1 ? pluralLabel : singular}`;
}

function contentSizeLabel(size = []) {
  return `${formatReserveCm(size[0])} × ${formatReserveCm(size[2])} cm`;
}

export function reserveStructure(reserveItem, options = {}) {
  const children = reserveItem?.children || [];
  const interior = reserveInterior(children);
  return {
    children,
    interior,
    door: reserveDoorState(children, { doorOpening: options.doorOpening }),
    slots: reserveDoorSlots(children),
    segments: reserveSegments(children),
    builtins: reserveBuiltinChildren(children),
  };
}

function reserveOuterBounds(reserveItem) {
  const boxes = (reserveItem?.children || []).map(childFootprint);
  if (!boxes.length) return { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    minZ: Math.min(...boxes.map((box) => box.minZ)),
    maxZ: Math.max(...boxes.map((box) => box.maxZ)),
  };
}

function worldBoundsOf(reserveItem, local) {
  const angle = (Number(reserveItem?.rotation || 0) * Math.PI) / 180;
  const corners = [[local.minX, local.minZ], [local.maxX, local.minZ], [local.maxX, local.maxZ], [local.minX, local.maxZ]]
    .map(([x, z]) => ({
      x: Number(reserveItem?.x || 0) + x * Math.cos(angle) + z * Math.sin(angle),
      z: Number(reserveItem?.z || 0) - x * Math.sin(angle) + z * Math.cos(angle),
    }));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minZ: Math.min(...corners.map((point) => point.z)),
    maxZ: Math.max(...corners.map((point) => point.z)),
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function useAnimatedBox(target, duration = 520, resetKey = '') {
  const reduced = usePrefersReducedMotion();
  const [box, setBox] = useState(target);
  const current = useRef(target);
  const lastResetKey = useRef(resetKey);
  const key = target.join(',');
  useEffect(() => {
    const reset = lastResetKey.current !== resetKey;
    lastResetKey.current = resetKey;
    if (reduced || reset) { current.current = target; setBox(target); return undefined; }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = from.map((value, index) => value + (target[index] - value) * ease(progress));
      current.current = next;
      setBox(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, reduced, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return box;
}

function AnimatedPrice({ value = 0, prefix = '+ ', zeroLabel = '0 €' }) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (reduced) { current.current = value; setDisplay(value); return undefined; }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / 420);
      const next = from + (value - from) * (1 - (1 - progress) ** 3);
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  const rounded = Math.round(display);
  return <span className="rsv-animated-price">{rounded <= 0 ? zeroLabel : `${prefix}${formatReservePrice(rounded)}`}</span>;
}

/* ------------------------------------------------------------------ */
/* Small illustrations                                                 */
/* ------------------------------------------------------------------ */

function ReserveSizeIcon({ area = 1 }) {
  const modules = Math.max(1, Math.min(3, Math.round(Number(area || 1))));
  const w = 7 + modules * 7;
  return (
    <svg className="rsv-size-icon" viewBox="0 0 40 30" aria-hidden="true">
      <g transform={`translate(${20 - w / 2 - 4} 4)`}>
        <path d={`M0 7 L${w} 7 L${w} 22 L0 22 Z`} className="rsv-iso-front" />
        <path d={`M0 7 L8 1 L${w + 8} 1 L${w} 7 Z`} className="rsv-iso-top" />
        <path d={`M${w} 7 L${w + 8} 1 L${w + 8} 16 L${w} 22 Z`} className="rsv-iso-side" />
        <path d={`M${w - 6} 22 L${w - 6} 12 L${w - 2} 12 L${w - 2} 22`} className="rsv-iso-door" />
      </g>
    </svg>
  );
}

function PlacementThumb({ placement = 'left', orientation = 'horizontal' }) {
  // Oblique view of the stand floor: back wall on top, aisle at the bottom.
  const corners = { bl: [26, 14], br: [92, 14], fl: [8, 54], fr: [74, 54] };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const point = (x, z) => lerp(lerp(corners.bl, corners.br, x), lerp(corners.fl, corners.fr, x), z);
  const vertical = orientation === 'vertical' && placement !== 'center';
  const footprint = placement === 'center' ? [0.43, 0.57, 0, 0.55]
    : placement === 'right' ? (vertical ? [0.8, 1, 0, 0.62] : [0.56, 1, 0, 0.24])
      : (vertical ? [0, 0.2, 0, 0.62] : [0, 0.44, 0, 0.24]);
  const [x0, x1, z0, z1] = footprint;
  const h = 12;
  const up = ([x, y]) => [x, y - h];
  const p = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const base = [point(x0, z0), point(x1, z0), point(x1, z1), point(x0, z1)];
  const top = base.map(up);
  return (
    <svg className="rsv-placement-thumb" viewBox="0 0 100 64" aria-hidden="true">
      <polygon points={p([corners.bl, corners.br, corners.fr, corners.fl])} className="rsv-thumb-floor" />
      <polygon points={p([corners.bl, corners.br, up(corners.br), up(corners.bl)])} className="rsv-thumb-wall" />
      {placement === 'left' && <polygon points={p([corners.bl, corners.fl, up(corners.fl), up(corners.bl)])} className="rsv-thumb-wall side" />}
      {placement === 'right' && <polygon points={p([corners.br, corners.fr, up(corners.fr), up(corners.br)])} className="rsv-thumb-wall side" />}
      <polygon points={p([base[3], base[2], top[2], top[3]])} className="rsv-thumb-front" />
      <polygon points={p([base[1], base[2], top[2], top[1]])} className="rsv-thumb-side" />
      <polygon points={p(top)} className="rsv-thumb-top" />
    </svg>
  );
}

function DoorWallIcon({ side = 'front' }) {
  return (
    <svg viewBox="0 0 32 22" className="rsv-door-wall-icon" aria-hidden="true">
      <rect x="3" y="3" width="26" height="16" rx="2" className="rsv-dwi-room" />
      {side === 'front' && <line x1="10" y1="19" x2="22" y2="19" className="rsv-dwi-door" />}
      {side === 'left' && <line x1="3" y1="7" x2="3" y2="15" className="rsv-dwi-door" />}
      {side === 'right' && <line x1="29" y1="7" x2="29" y2="15" className="rsv-dwi-door" />}
      {side === 'back' && <line x1="10" y1="3" x2="22" y2="3" className="rsv-dwi-door" />}
    </svg>
  );
}

function OpeningIcon({ inward = true }) {
  return (
    <svg viewBox="0 0 40 30" className="rsv-opening-icon" aria-hidden="true">
      <line x1="2" y1="15" x2="10" y2="15" className="rsv-oi-wall" />
      <line x1="30" y1="15" x2="38" y2="15" className="rsv-oi-wall" />
      {inward ? (
        <>
          <line x1="10" y1="15" x2="10" y2="2" className="rsv-oi-leaf" />
          <path d="M10 2 A13 13 0 0 1 23 15" className="rsv-oi-arc" />
        </>
      ) : (
        <>
          <line x1="10" y1="15" x2="10" y2="28" className="rsv-oi-leaf" />
          <path d="M10 28 A13 13 0 0 0 23 15" className="rsv-oi-arc" />
        </>
      )}
    </svg>
  );
}

function HandleIcon({ side = 'right' }) {
  return (
    <svg viewBox="0 0 26 36" className="rsv-handle-icon" aria-hidden="true">
      <rect x="4" y="2" width="18" height="32" rx="1.5" className="rsv-hi-door" />
      <rect x={side === 'right' ? 16 : 7} y="17" width="3" height="5" rx="1" className="rsv-hi-handle" />
      <line x1={side === 'right' ? 4 : 22} y1="6" x2={side === 'right' ? 4 : 22} y2="12" className="rsv-hi-hinge" />
      <line x1={side === 'right' ? 4 : 22} y1="24" x2={side === 'right' ? 4 : 22} y2="30" className="rsv-hi-hinge" />
    </svg>
  );
}

function ContentThumb({ content }) {
  if (content?.thumbnail) return <img src={content.thumbnail} alt="" loading="lazy" draggable={false} />;
  return content?.category === 'appliance' ? <Zap size={18} /> : content?.mount === 'wall' ? <Layers size={18} /> : <Package size={18} />;
}

/* ------------------------------------------------------------------ */
/* 2D plan                                                             */
/* ------------------------------------------------------------------ */

const contentPalette = {
  storage: { fill: '#f3e3c2', stroke: '#d8b77a' },
  appliance: { fill: '#eef2f8', stroke: '#9aa8bd' },
  wall: { fill: '#f6e9d0', stroke: '#d9b984' },
  electric: { fill: '#e6f2e6', stroke: '#8ebc8e' },
  builtin: { fill: '#f1eadc', stroke: '#cdbb98' },
};

function planItemsFor(structure, contents = []) {
  const interior = structure?.interior;
  const contentItems = (contents || []).map((content) => {
    const center = contentCenter(content, interior);
    return {
      key: content.key,
      kind: 'content',
      label: content.label,
      size: content.size,
      mount: content.mount,
      category: content.category,
      x: center.x,
      z: center.z,
      rotation: content.rotation || 0,
      box: contentFootprint(content, interior),
      needsPower: content.needsPower,
      content,
    };
  });
  const builtinItems = (structure?.builtins || []).map((child) => ({
    key: `builtin:${child.id}`,
    kind: 'builtin',
    label: child.label,
    size: reserveChildSize(child),
    mount: isWallBuiltin(child) ? 'wall' : 'floor',
    category: 'builtin',
    x: Number(child.x || 0),
    z: Number(child.z || 0),
    rotation: Number(child.rotation || 0),
    box: childFootprint(child),
    child,
  }));
  return [...builtinItems, ...contentItems];
}

function shortLabel(label = '', max = 18) {
  const text = String(label || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function ReservePlan({
  tr = identity,
  stand = null,
  others = [],
  reserve,
  structure,
  contents = [],
  focus = 'reserve',
  zoom = 1,
  showDims = true,
  showGrid = true,
  step = 'layout',
  selectedKey = '',
  invalid = {},
  draggingKey = '',
  ghost = null,
  previewReserve = null,
  previewLabel = '',
  hasPower = true,
  interactive = false,
  compact = false,
  groupRef,
  svgRef,
  safeAreas = null,
  onItemPointerDown,
  onBackgroundPointerDown,
  onSlotSelect,
  onDoorPointerDown,
  onDragOver,
  onDrop,
  onDragLeave,
}) {
  const uid = useId().replace(/:/g, '');
  const interior = structure?.interior;
  const door = structure?.door;
  const localOuter = useMemo(() => reserveOuterBounds(reserve), [reserve]);
  const worldOuter = useMemo(() => worldBoundsOf(reserve, localOuter), [reserve, localOuter]);
  const items = useMemo(() => planItemsFor(structure, contents), [structure, contents]);

  const localSvgRef = useRef(null);
  const [svgSize, setSvgSize] = useState(null);
  useLayoutEffect(() => {
    const element = localSvgRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSvgSize((current) => (current && Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1 ? current : { width: rect.width, height: rect.height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const setSvgRef = useCallback((element) => {
    localSvgRef.current = element;
    if (typeof svgRef === 'function') svgRef(element);
    else if (svgRef) svgRef.current = element;
  }, [svgRef]);

  const target = useMemo(() => {
    let box;
    if (focus === 'stand' && stand) {
      box = [-stand.width / 2 - 0.62, -stand.depth / 2 - 0.55, stand.width + 1.24, stand.depth + 1.15];
    } else {
      const margin = compact ? 0.14 : 0.5;
      const doorPad = door && !door.zoneInside ? RESERVE_DOOR_LEAF * 0.6 : 0;
      box = [worldOuter.minX - margin, worldOuter.minZ - margin - (compact ? 0 : 0.18), worldOuter.maxX - worldOuter.minX + margin * 2, worldOuter.maxZ - worldOuter.minZ + margin * 2 + doorPad + (compact ? 0 : 0.36)];
    }
    const z = Math.max(0.4, Math.min(3, Number(zoom || 1)));
    const w = box[2] / z;
    const h = box[3] / z;
    const content = [box[0] + box[2] / 2 - w / 2, box[1] + box[3] / 2 - h / 2, w, h];
    // Fit the content into the largest free area left by the floating panels, then extend to the whole canvas.
    if (!svgSize || !safeAreas?.length) return content;
    let best = null;
    safeAreas.forEach((area) => {
      const freeW = svgSize.width - area.left - area.right;
      const freeH = svgSize.height - area.top - area.bottom;
      if (freeW <= 40 || freeH <= 40) return;
      const scale = Math.min(freeW / content[2], freeH / content[3]);
      if (!best || scale > best.scale) best = { scale, area, freeW, freeH };
    });
    if (!best) return content;
    const { scale, area, freeW, freeH } = best;
    const offsetX = area.left + (freeW - content[2] * scale) / 2;
    const offsetY = area.top + (freeH - content[3] * scale) / 2;
    return [content[0] - offsetX / scale, content[1] - offsetY / scale, svgSize.width / scale, svgSize.height / scale];
  }, [focus, stand, worldOuter, door, zoom, compact, svgSize, safeAreas]);
  // The first measured size snaps into place; later changes (step, zoom, size) animate.
  const viewBox = useAnimatedBox(target, 520, svgSize ? 'measured' : 'pending');
  const unit = Math.max(viewBox[2], viewBox[3]) / (compact ? 34 : 60);
  const fontSize = Math.min(0.16, Math.max(0.065, unit * 0.95));
  const wallLayout = stand?.layout || 'back';
  const selected = items.find((item) => item.key === selectedKey) || null;

  const doorPath = door ? `M ${door.latch.x} ${door.latch.z} A ${RESERVE_DOOR_LEAF} ${RESERVE_DOOR_LEAF} 0 0 ${arcSweep(door)} ${door.open.x} ${door.open.z}` : '';

  return (
    <svg
      ref={setSvgRef}
      className={`rsv-plan rsv-plan-${focus}${compact ? ' rsv-plan-compact' : ''}${interactive ? ' interactive' : ''}`}
      viewBox={viewBox.join(' ')}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onBackgroundPointerDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      role="img"
      aria-label={tr('Plan de la réserve')}
    >
      <defs>
        <pattern id={`rsv-grid-${uid}`} width="0.1" height="0.1" patternUnits="userSpaceOnUse">
          <path d="M 0.1 0 L 0 0 0 0.1" className="rsv-grid-fine" />
        </pattern>
        <pattern id={`rsv-grid-major-${uid}`} width="0.5" height="0.5" patternUnits="userSpaceOnUse">
          <rect width="0.5" height="0.5" fill={`url(#rsv-grid-${uid})`} />
          <path d="M 0.5 0 L 0 0 0 0.5" className="rsv-grid-major" />
        </pattern>
        <pattern id={`rsv-hatch-${uid}`} width="0.12" height="0.12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.12" className="rsv-hatch-line" />
        </pattern>
        <filter id={`rsv-shadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.02" stdDeviation="0.03" floodColor="#1f4378" floodOpacity="0.22" />
        </filter>
      </defs>

      {!compact && <rect x={viewBox[0] - 2} y={viewBox[1] - 2} width={viewBox[2] + 4} height={viewBox[3] + 4} fill={`url(#rsv-hatch-${uid})`} className="rsv-outside" />}

      {stand && !compact && (
        <g className="rsv-stand">
          <rect x={-stand.width / 2} y={-stand.depth / 2} width={stand.width} height={stand.depth} className="rsv-stand-floor" />
          {showGrid && <rect x={-stand.width / 2} y={-stand.depth / 2} width={stand.width} height={stand.depth} fill={`url(#rsv-grid-major-${uid})`} className="rsv-stand-grid" />}
          <line x1={-stand.width / 2} y1={-stand.depth / 2} x2={stand.width / 2} y2={-stand.depth / 2} className="rsv-stand-wall" />
          {(wallLayout === 'left' || wallLayout === 'u') && <line x1={-stand.width / 2} y1={-stand.depth / 2} x2={-stand.width / 2} y2={stand.depth / 2} className="rsv-stand-wall" />}
          {(wallLayout === 'right' || wallLayout === 'u') && <line x1={stand.width / 2} y1={-stand.depth / 2} x2={stand.width / 2} y2={stand.depth / 2} className="rsv-stand-wall" />}
          <line x1={-stand.width / 2} y1={stand.depth / 2 + 0.08} x2={stand.width / 2} y2={stand.depth / 2 + 0.08} className="rsv-aisle-line" />
          <text x={0} y={stand.depth / 2 + 0.32} className="rsv-plan-caption" style={{ fontSize: fontSize * 0.95, letterSpacing: fontSize * 0.35 }} textAnchor="middle">{tr('ALLÉE')}</text>
          {focus === 'stand' && others.map((item) => (
            <g key={item.id} className="rsv-other">
              <rect x={item.box.minX} y={item.box.minZ} width={Math.max(0.05, item.box.maxX - item.box.minX)} height={Math.max(0.05, item.box.maxZ - item.box.minZ)} rx={Math.min(0.08, (item.box.maxX - item.box.minX) / 4)} />
              {(item.box.maxX - item.box.minX) > 0.45 && <text x={(item.box.minX + item.box.maxX) / 2} y={(item.box.minZ + item.box.maxZ) / 2} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: fontSize * 0.85 }}>{tr(shortLabel(item.label, 14))}</text>}
            </g>
          ))}
          {focus === 'stand' && showDims && (
            <>
              <DimensionLine from={{ x: -stand.width / 2, z: -stand.depth / 2 - 0.34 }} to={{ x: stand.width / 2, z: -stand.depth / 2 - 0.34 }} label={`${formatReserveMetres(stand.width)} m`} fontSize={fontSize} />
              <DimensionLine from={{ x: -stand.width / 2 - 0.4, z: -stand.depth / 2 }} to={{ x: -stand.width / 2 - 0.4, z: stand.depth / 2 }} label={`${formatReserveMetres(stand.depth)} m`} fontSize={fontSize} vertical />
            </>
          )}
        </g>
      )}

      {previewReserve && (
        <g className="rsv-preview-outline" transform={`translate(${previewReserve.x || 0} ${previewReserve.z || 0}) rotate(${-Number(previewReserve.rotation || 0)})`}>
          {(() => {
            const previewInterior = reserveInterior(previewReserve.children || []);
            if (!previewInterior) return null;
            return (
              <>
                <rect x={previewInterior.minX} y={previewInterior.minZ} width={previewInterior.width} height={previewInterior.depth} rx="0.03" />
                {previewLabel && (
                  <g transform={`translate(${previewInterior.centerX} ${previewInterior.centerZ})`}>
                    <PlanChip label={previewLabel} fontSize={fontSize * 0.9} tone="ghost" icon="eye" />
                  </g>
                )}
              </>
            );
          })()}
        </g>
      )}

      {reserve && interior && (
        <g ref={groupRef} className={`rsv-reserve ${focus === 'stand' ? 'is-highlighted' : ''}`} transform={`translate(${reserve.x || 0} ${reserve.z || 0}) rotate(${-Number(reserve.rotation || 0)})`}>
          <rect x={interior.minX} y={interior.minZ} width={interior.width} height={interior.depth} className="rsv-interior" key={`interior-${reserve.type}`} />
          {showGrid && <rect x={interior.minX} y={interior.minZ} width={interior.width} height={interior.depth} fill={`url(#rsv-grid-major-${uid})`} className="rsv-interior-grid" />}

          {focus !== 'stand' && !compact && ['left', 'right', 'back', 'front'].filter((side) => !interior.sides?.[side]).map((side) => (
            <StandWallBand key={side} side={side} interior={interior} fontSize={fontSize} tr={tr} />
          ))}

          {door?.zoneInside && (step === 'door' || step === 'layout') && (
            <g className={`rsv-door-zone${invalid.door ? ' alert' : ''}`}>
              <rect x={door.zone.minX} y={door.zone.minZ} width={door.zone.maxX - door.zone.minX} height={door.zone.maxZ - door.zone.minZ} />
              {step === 'layout' && !compact && <text x={(door.zone.minX + door.zone.maxX) / 2} y={(door.zone.minZ + door.zone.maxZ) / 2} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: fontSize * 0.8 }}>{tr('Zone à laisser libre')}</text>}
            </g>
          )}

          {structure.segments.map((segment) => (
            <SegmentShape key={segment.id} segment={segment} door={door} />
          ))}

          {door && (
            <g className={`rsv-door${step === 'door' && interactive ? ' editable' : ''}`} key={`${door.slot.id}-${door.handle}-${door.opening}`} onPointerDown={onDoorPointerDown}>
              <path d={`M ${door.hinge.x} ${door.hinge.z} L ${door.latch.x} ${door.latch.z}`} className="rsv-door-gap" />
              <path d={`M ${door.hinge.x} ${door.hinge.z} L ${door.open.x} ${door.open.z}`} className="rsv-door-leaf" />
              <path d={doorPath} className="rsv-door-arc" />
              <circle cx={door.hinge.x} cy={door.hinge.z} r={0.028} className="rsv-door-hinge" />
              <circle cx={door.open.x} cy={door.open.z} r={0.024} className="rsv-door-handle" />
              {step === 'door' && !compact && (
                <g transform={`translate(${door.center.x + door.slot.normal.x * 0.32} ${door.center.z + door.slot.normal.z * 0.32})`}>
                  <PlanChip label={`${tr('Porte')} ${Math.round(RESERVE_DOOR_LEAF * 100)} cm`} fontSize={fontSize * 0.86} tone="blue" />
                </g>
              )}
            </g>
          )}

          {step === 'door' && interactive && structure.slots.filter((slot) => slot.kind !== 'door').map((slot) => (
            <DoorSlotTarget key={slot.id} slot={slot} fontSize={fontSize} onSelect={() => onSlotSelect?.(slot.id)} tr={tr} />
          ))}

          {items.map((item) => (
            <PlanItem
              key={item.key}
              item={item}
              fontSize={fontSize}
              compact={compact}
              selected={item.key === selectedKey}
              dragging={item.key === draggingKey}
              invalidReason={item.key === draggingKey ? invalid.reason : ''}
              muted={step === 'door' || step === 'structure'}
              hideLabel={focus === 'stand'}
              showPower={item.needsPower && !hasPower}
              interactive={interactive && step === 'layout'}
              onPointerDown={onItemPointerDown}
              filterId={`rsv-shadow-${uid}`}
              tr={tr}
            />
          ))}

          {ghost && (
            <g className={`rsv-ghost ${ghost.valid ? 'valid' : 'invalid'}`}>
              <rect x={ghost.box.minX} y={ghost.box.minZ} width={ghost.box.maxX - ghost.box.minX} height={ghost.box.maxZ - ghost.box.minZ} rx="0.03" />
              <g transform={`translate(${(ghost.box.minX + ghost.box.maxX) / 2} ${(ghost.box.minZ + ghost.box.maxZ) / 2})`}>
                <PlanChip label={ghost.valid ? tr('Place disponible · relâchez ici') : tr(ISSUE_LABELS[ghost.reason] || 'Place indisponible')} fontSize={fontSize * 0.84} tone={ghost.valid ? 'green' : 'red'} icon={ghost.valid ? 'check' : 'ban'} />
              </g>
            </g>
          )}

          {showDims && !compact && focus !== 'stand' && (
            <>
              <DimensionLine from={{ x: interior.minX, z: interior.minZ - 0.22 }} to={{ x: interior.maxX, z: interior.minZ - 0.22 }} label={`${formatReserveCm(interior.width)} cm`} fontSize={fontSize} />
              <DimensionLine from={{ x: interior.maxX + 0.26, z: interior.minZ }} to={{ x: interior.maxX + 0.26, z: interior.maxZ }} label={`${formatReserveCm(interior.depth)} cm`} fontSize={fontSize} vertical />
              {step === 'door' && door && <DoorOffsetDimension door={door} interior={interior} fontSize={fontSize} />}
              {step === 'layout' && selected && selected.kind === 'content' && <ClearanceDimensions box={selected.box} interior={interior} fontSize={fontSize} />}
            </>
          )}

          {focus === 'stand' && !compact && (
            <>
              <rect x={interior.minX - 0.04} y={interior.minZ - 0.04} width={interior.width + 0.08} height={interior.depth + 0.08} rx="0.05" className="rsv-reserve-halo" />
              <g transform={`translate(${interior.minX + Math.min(interior.width / 2, 0.62)} ${interior.maxZ - 0.17})`}>
                <PlanChip label={`${tr('Réserve')} · ${formatAreaLabel(interior)}`} fontSize={fontSize * 0.9} tone="solid" icon="door" />
              </g>
              {showDims && (
                <>
                  <DimensionLine from={{ x: interior.minX, z: interior.maxZ + 0.28 }} to={{ x: interior.maxX, z: interior.maxZ + 0.28 }} label={`${formatReserveMetres(interior.width)} m`} fontSize={fontSize} />
                  <DimensionLine from={{ x: interior.maxX + 0.3, z: interior.minZ }} to={{ x: interior.maxX + 0.3, z: interior.maxZ }} label={`${formatReserveMetres(interior.depth)} m`} fontSize={fontSize} vertical />
                </>
              )}
            </>
          )}
        </g>
      )}

      {focus !== 'stand' && !compact && reserve && (
        <text x={worldOuter.minX + (worldOuter.maxX - worldOuter.minX) / 2} y={worldOuter.maxZ + 0.5 + (door && !door.zoneInside ? RESERVE_DOOR_LEAF * 0.6 : 0)} textAnchor="middle" className="rsv-plan-caption" style={{ fontSize: fontSize * 0.85 }}>{tr('Vers l’allée')} ↓</text>
      )}
    </svg>
  );
}

function formatAreaLabel(interior) {
  const area = Math.round((interior.width * interior.depth) * 2) / 2;
  return `${area.toLocaleString('fr-FR')} m²`;
}

function arcSweep(door) {
  const a = { x: door.latch.x - door.hinge.x, z: door.latch.z - door.hinge.z };
  const b = { x: door.open.x - door.hinge.x, z: door.open.z - door.hinge.z };
  return a.x * b.z - a.z * b.x > 0 ? 1 : 0;
}

function SegmentShape({ segment, door }) {
  const thickness = 0.06;
  if (segment.kind === 'door' && door) {
    const pieces = [];
    const along = segment.orientation === 'x' ? 'x' : 'z';
    const lineCoord = segment.orientation === 'x' ? door.center.z : door.center.x;
    const gapMin = Math.min(door.hinge[along], door.latch[along]);
    const gapMax = Math.max(door.hinge[along], door.latch[along]);
    if (gapMin - segment.min > 0.01) pieces.push([segment.min, gapMin]);
    if (segment.max - gapMax > 0.01) pieces.push([gapMax, segment.max]);
    return (
      <g className="rsv-segment rsv-segment-door">
        {pieces.map(([from, to]) => (segment.orientation === 'x'
          ? <rect key={from} x={from} y={lineCoord - thickness / 2} width={to - from} height={thickness} />
          : <rect key={from} x={lineCoord - thickness / 2} y={from} width={thickness} height={to - from} />))}
      </g>
    );
  }
  return segment.orientation === 'x'
    ? <rect className="rsv-segment" x={segment.min} y={segment.line - thickness / 2} width={segment.max - segment.min} height={thickness} />
    : <rect className="rsv-segment" x={segment.line - thickness / 2} y={segment.min} width={thickness} height={segment.max - segment.min} />;
}

function StandWallBand({ side, interior, fontSize, tr }) {
  const band = 0.12;
  const rect = side === 'back' ? { x: interior.minX - 0.2, y: interior.minZ - band, w: interior.width + 0.4, h: band }
    : side === 'front' ? { x: interior.minX - 0.2, y: interior.maxZ, w: interior.width + 0.4, h: band }
      : side === 'left' ? { x: interior.minX - band, y: interior.minZ - 0.2, w: band, h: interior.depth + 0.4 }
        : { x: interior.maxX, y: interior.minZ - 0.2, w: band, h: interior.depth + 0.4 };
  const horizontal = side === 'back' || side === 'front';
  return (
    <g className="rsv-stand-band">
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      {horizontal && <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fontSize * 0.68 }}>{tr('Cloison du stand')}</text>}
    </g>
  );
}

function DoorSlotTarget({ slot, fontSize, onSelect, tr }) {
  const thickness = 0.16;
  const x = slot.orientation === 'x' ? slot.min + 0.06 : slot.line - thickness / 2;
  const y = slot.orientation === 'x' ? slot.line - thickness / 2 : slot.min + 0.06;
  const w = slot.orientation === 'x' ? slot.length - 0.12 : thickness;
  const h = slot.orientation === 'x' ? thickness : slot.length - 0.12;
  const cx = slot.orientation === 'x' ? slot.center : slot.line + slot.normal.x * 0.14;
  const cy = slot.orientation === 'x' ? slot.line + slot.normal.z * 0.14 : slot.center;
  return (
    <g className="rsv-slot" onPointerDown={(event) => { event.stopPropagation(); onSelect(); }} role="button" aria-label={tr('Placer la porte ici')}>
      <rect x={x} y={y} width={w} height={h} rx="0.03" />
      <circle cx={cx} cy={cy} r={Math.max(0.07, fontSize * 0.75)} />
      <path d={`M ${cx - fontSize * 0.38} ${cy} L ${cx + fontSize * 0.38} ${cy} M ${cx} ${cy - fontSize * 0.38} L ${cx} ${cy + fontSize * 0.38}`} className="rsv-slot-plus" />
    </g>
  );
}

function PlanChip({ label, fontSize = 0.1, tone = 'light', icon = '' }) {
  const width = Math.max(0.3, String(label).length * fontSize * 0.56 + (icon ? fontSize * 1.5 : 0) + fontSize * 1.1);
  const height = fontSize * 1.9;
  return (
    <g className={`rsv-chip rsv-chip-${tone}`}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2.4} />
      {icon && <ChipIcon icon={icon} x={-width / 2 + fontSize * 0.95} size={fontSize} />}
      <text x={icon ? fontSize * 0.65 : 0} y={0} textAnchor="middle" dominantBaseline="central" style={{ fontSize }}>{label}</text>
    </g>
  );
}

function ChipIcon({ icon, x, size }) {
  const s = size * 0.42;
  if (icon === 'check') return <path d={`M ${x - s} 0 L ${x - s * 0.2} ${s * 0.8} L ${x + s} ${-s * 0.7}`} className="rsv-chip-icon" />;
  if (icon === 'ban') return <g className="rsv-chip-icon"><circle cx={x} cy={0} r={s} /><path d={`M ${x - s * 0.7} ${-s * 0.7} L ${x + s * 0.7} ${s * 0.7}`} /></g>;
  if (icon === 'eye') return <g className="rsv-chip-icon"><path d={`M ${x - s * 1.2} 0 Q ${x} ${-s * 1.1} ${x + s * 1.2} 0 Q ${x} ${s * 1.1} ${x - s * 1.2} 0 Z`} /><circle cx={x} cy={0} r={s * 0.35} /></g>;
  if (icon === 'door') return <g className="rsv-chip-icon"><rect x={x - s * 0.7} y={-s} width={s * 1.4} height={s * 2} /><circle cx={x + s * 0.3} cy={0} r={s * 0.12} /></g>;
  return null;
}

function PlanItem({ item, fontSize, compact, selected, dragging, invalidReason, muted, hideLabel = false, showPower, interactive, onPointerDown, filterId, tr }) {
  const palette = contentPalette[item.category] || contentPalette.storage;
  const [w, , d] = item.size || [0.5, 0.5, 0.5];
  const visualW = Math.max(0.04, w);
  const visualD = Math.max(item.mount === 'wall' ? 0.08 : 0.04, d);
  const labelVisible = !compact && !hideLabel && Math.min(item.box.maxX - item.box.minX, item.box.maxZ - item.box.minZ) > 0.18 && (item.box.maxX - item.box.minX) > 0.32;
  const className = [
    'rsv-item', `rsv-item-${item.kind}`, `rsv-item-${item.mount}`,
    selected ? 'selected' : '', dragging ? 'dragging' : '', invalidReason ? 'invalid' : '', muted ? 'muted' : '', interactive ? 'interactive' : '',
  ].filter(Boolean).join(' ');
  return (
    <g
      className={className}
      style={{ transform: `translate(${item.x}px, ${item.z}px)` }}
      onPointerDown={interactive ? (event) => onPointerDown?.(event, item) : undefined}
      data-key={item.key}
    >
      <g transform={`rotate(${-Number(item.rotation || 0)})`} className="rsv-item-shape">
        <rect
          x={-visualW / 2}
          y={-visualD / 2}
          width={visualW}
          height={visualD}
          rx={Math.min(0.03, visualW / 6)}
          fill={palette.fill}
          stroke={palette.stroke}
          filter={selected || dragging ? `url(#${filterId})` : undefined}
        />
        {item.mount === 'wall' && <line x1={-visualW / 2} y1={-visualD / 2} x2={visualW / 2} y2={-visualD / 2} className="rsv-item-wallside" />}
        {item.kind !== 'builtin' && item.mount !== 'wall' && <line x1={-visualW / 2 + 0.03} y1={visualD / 2 - 0.03} x2={visualW / 2 - 0.03} y2={visualD / 2 - 0.03} className="rsv-item-front" />}
      </g>
      {selected && !compact && (
        <g className="rsv-item-handles">
          {[[item.box.minX, item.box.minZ], [item.box.maxX, item.box.minZ], [item.box.minX, item.box.maxZ], [item.box.maxX, item.box.maxZ]].map(([hx, hz]) => (
            <rect key={`${hx}-${hz}`} x={hx - item.x - 0.025} y={hz - item.z - 0.025} width={0.05} height={0.05} />
          ))}
        </g>
      )}
      {labelVisible && (
        <g className="rsv-item-label">
          <PlanChip label={tr(shortLabel(item.label, 16))} fontSize={fontSize * 0.78} tone={selected ? 'blue' : 'light'} />
          {(item.box.maxZ - item.box.minZ) > 0.3 && <text x={0} y={fontSize * 1.45} textAnchor="middle" className="rsv-item-dims" style={{ fontSize: fontSize * 0.62 }}>{`${formatReserveCm(w)} × ${formatReserveCm(d)}${item.mount === 'wall' ? ` · ${tr('mural')}` : ''}`}</text>}
        </g>
      )}
      {showPower && !compact && !hideLabel && (
        <g transform={`translate(0 ${(item.box.maxZ - item.box.minZ) / 2 - fontSize * 1.2})`}>
          <PlanChip label={tr('Prise requise')} fontSize={fontSize * 0.66} tone="amber" />
        </g>
      )}
    </g>
  );
}

function DimensionLine({ from, to, label, fontSize, vertical = false }) {
  const tick = fontSize * 0.45;
  const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
  const width = Math.max(0.22, label.length * fontSize * 0.55 + fontSize * 0.9);
  return (
    <g className="rsv-dim">
      <line x1={from.x} y1={from.z} x2={to.x} y2={to.z} />
      {vertical ? (
        <>
          <line x1={from.x - tick} y1={from.z} x2={from.x + tick} y2={from.z} />
          <line x1={to.x - tick} y1={to.z} x2={to.x + tick} y2={to.z} />
        </>
      ) : (
        <>
          <line x1={from.x} y1={from.z - tick} x2={from.x} y2={from.z + tick} />
          <line x1={to.x} y1={to.z - tick} x2={to.x} y2={to.z + tick} />
        </>
      )}
      <rect x={mid.x - width / 2} y={mid.z - fontSize * 0.85} width={width} height={fontSize * 1.7} rx={fontSize * 0.4} />
      <text x={mid.x} y={mid.z} textAnchor="middle" dominantBaseline="central" style={{ fontSize: fontSize * 0.86 }}>{label}</text>
    </g>
  );
}

function DoorOffsetDimension({ door, interior, fontSize }) {
  const { slot } = door;
  if (slot.side !== 'front' && slot.side !== 'back') {
    const x = slot.side === 'left' ? interior.minX + 0.18 : interior.maxX - 0.18;
    const edge = Math.min(door.hinge.z, door.latch.z);
    if (edge - interior.minZ < 0.05) return null;
    return <DimensionLine from={{ x, z: interior.minZ }} to={{ x, z: edge }} label={`${formatReserveCm(edge - interior.minZ)} cm`} fontSize={fontSize * 0.9} vertical />;
  }
  const z = slot.side === 'front' ? interior.maxZ + 0.42 : interior.minZ - 0.42;
  const edge = Math.min(door.hinge.x, door.latch.x);
  const right = Math.max(door.hinge.x, door.latch.x);
  return (
    <>
      {edge - interior.minX > 0.05 && <DimensionLine from={{ x: interior.minX, z }} to={{ x: edge, z }} label={`${formatReserveCm(edge - interior.minX)} cm`} fontSize={fontSize * 0.9} />}
      {interior.maxX - right > 0.05 && <DimensionLine from={{ x: right, z }} to={{ x: interior.maxX, z }} label={`${formatReserveCm(interior.maxX - right)} cm`} fontSize={fontSize * 0.9} />}
    </>
  );
}

function ClearanceDimensions({ box, interior, fontSize }) {
  const gaps = [
    { key: 'left', value: box.minX - interior.minX, from: { x: interior.minX, z: (box.minZ + box.maxZ) / 2 }, to: { x: box.minX, z: (box.minZ + box.maxZ) / 2 } },
    { key: 'right', value: interior.maxX - box.maxX, from: { x: box.maxX, z: (box.minZ + box.maxZ) / 2 }, to: { x: interior.maxX, z: (box.minZ + box.maxZ) / 2 } },
    { key: 'back', value: box.minZ - interior.minZ, from: { x: (box.minX + box.maxX) / 2, z: interior.minZ }, to: { x: (box.minX + box.maxX) / 2, z: box.minZ }, vertical: true },
    { key: 'front', value: interior.maxZ - box.maxZ, from: { x: (box.minX + box.maxX) / 2, z: box.maxZ }, to: { x: (box.minX + box.maxX) / 2, z: interior.maxZ }, vertical: true },
  ].filter((gap) => gap.value > 0.04);
  const horizontal = gaps.filter((gap) => !gap.vertical).sort((a, b) => a.value - b.value)[0];
  const vertical = gaps.filter((gap) => gap.vertical).sort((a, b) => a.value - b.value)[0];
  return (
    <g className="rsv-clearance">
      {[horizontal, vertical].filter(Boolean).map((gap) => (
        <DimensionLine key={gap.key} from={gap.from} to={gap.to} label={`${formatReserveCm(gap.value)} cm`} fontSize={fontSize * 0.82} vertical={gap.vertical} />
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Quick view (step 2 option panel)                                    */
/* ------------------------------------------------------------------ */

export function ReserveQuickView({
  tr = identity,
  formula = null,
  rows = [],
  selectedOptionType = '',
  removed = false,
  hasRule = true,
  disabled = false,
  summary = {},
  reserve = null,
  contents = [],
  totalPrice = 0,
  totalDetail = '',
  notice = null,
  customRequest = null,
  orientation = null,
  onSelectRow,
  onOrientation,
  onOpenEditor,
  onRemove,
  onRestore,
  onUndoRemove,
  onDismissNotice,
  onUndoNotice,
  onCustomRequest,
  onOpenShop,
  onAskQuestion,
  onApply,
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const structure = useMemo(() => (reserve ? reserveStructure(reserve, summary.doorOptions || {}) : null), [reserve, summary.doorOptions]);
  const noneSelected = removed || selectedOptionType === '__none__';

  if (!hasRule && !rows.length) {
    return (
      <div className="reserve-choice-panel rsv-quick rsv-quick-empty">
        {formula}
        <div className="rsv-quick-info">
          <Ban size={16} />
          <div>
            <strong>{tr('Pas de réserve pour ce stand')}</strong>
            <span>{tr('Votre formule n’en inclut pas pour cette surface et ne permet pas d’en ajouter en option.')}</span>
          </div>
        </div>
        <ReserveAlternatives tr={tr} onOpenShop={onOpenShop} onAskQuestion={onAskQuestion} />
      </div>
    );
  }

  if (noneSelected) {
    return (
      <div className="reserve-choice-panel rsv-quick rsv-quick-removed">
        <div className="rsv-toast-inline" role="status">
          <Check size={14} />
          <span>{tr('Réserve supprimée')}</span>
          {onUndoRemove && <button type="button" onClick={onUndoRemove} disabled={disabled}>{tr('Annuler')}</button>}
        </div>
        <div className="rsv-quick-info">
          <Ban size={16} />
          <div>
            <strong>{tr('Vous avez retiré la réserve')}</strong>
            <span>{tr('Vous pouvez la remettre à tout moment.')}</span>
          </div>
        </div>
        <ReserveAlternatives tr={tr} onOpenShop={onOpenShop} onAskQuestion={onAskQuestion} />
        <button type="button" className="rsv-outline-button" disabled={disabled} onClick={onRestore}>
          <Plus size={15} /> {tr('Remettre une réserve')}
        </button>
        <QuickFooter tr={tr} total={0} detail={tr('Aucune réserve')} onApply={onApply} />
      </div>
    );
  }

  return (
    <div className="reserve-choice-panel reserve-choice-panel-v2 rsv-quick">
      {formula}
      {structure?.interior && (
        <button type="button" className="rsv-quick-plan" onClick={() => onOpenEditor?.('structure')} aria-label={tr('Ouvrir le plan de la réserve')}>
          <ReservePlan tr={tr} reserve={reserve} structure={structure} contents={contents} compact showDims={false} showGrid={false} step="layout" />
          <span className="rsv-quick-plan-cta"><Layers size={13} /> {tr('Personnaliser')}</span>
          <span className="rsv-quick-plan-caption"><DoorOpen size={12} /> {summary.caption}</span>
        </button>
      )}

      <strong className="reserve-choice-title">{tr('Taille')}</strong>
      <div className="reserve-choice-list rsv-size-grid" data-count={rows.length}>
        {rows.map((row, index) => {
          const selected = row.optionType === selectedOptionType;
          return (
            <button
              key={row.key}
              type="button"
              className={`reserve-choice-card rsv-size-card${selected ? ' active' : ''}${row.available === false ? ' unavailable' : ''}`}
              style={{ '--rsv-index': index }}
              disabled={disabled || row.available === false}
              onClick={() => onSelectRow?.(row)}
              title={row.available === false ? tr(row.reason || 'Indisponible') : tr(row.dims || '')}
            >
              <ReserveSizeIcon area={row.area} />
              <span className="reserve-choice-copy">
                <strong><b>{tr(row.areaLabel)}</b></strong>
                <small>{tr(orientedDims(row.dims || '', orientation?.choices?.length > 1 && orientation?.current === 'vertical'))}</small>
              </span>
              <span className={`reserve-choice-price${row.included && !row.price ? ' included' : ''}${row.available === false ? ' unavailable' : ''}`}>
                {row.available === false ? <><Ban size={11} /> {tr('Indisponible')}</> : tr(reservePriceTag(row.price, row.included))}
              </span>
            </button>
          );
        })}
      </div>

      {reserve && orientation?.choices?.length > 1 && (
        <>
          <strong className="reserve-choice-title">{tr('Orientation')}</strong>
          <div className="rsv-quick-orientation" role="radiogroup" aria-label={tr('Orientation')}>
            {orientation.choices.map((choice) => {
              const active = choice.orientation === orientation.current;
              return (
                <button
                  key={choice.orientation}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? 'active' : ''}
                  disabled={disabled || !choice.available}
                  title={choice.available ? '' : tr(choice.reason)}
                  onClick={() => onOrientation?.(choice.orientation)}
                >
                  <PlacementThumb placement={orientation.corner} orientation={choice.orientation} />
                  <span>{tr(orientationLabel(choice.orientation, orientation.corner))}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {rows.some((row) => row.available === false) && (
        <div className="rsv-quick-info subtle">
          <Ban size={15} />
          <div>
            <strong>{tr(rows.filter((row) => row.available === false).map((row) => row.areaLabel).join(', '))} : {tr('espace insuffisant')}</strong>
            <span>{tr(rows.find((row) => row.available === false)?.reason || '')}</span>
          </div>
        </div>
      )}

      {customRequest?.requestedAt && !customOpen ? (
        <div className="rsv-custom-card">
          <header><span className="rsv-pill blue"><Send size={11} /> {tr('Demande envoyée')}</span><small>{tr(`le ${new Date(customRequest.requestedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} · réponse sous 48 h`)}</small></header>
          <strong>{tr('Sur mesure')} : {formatReserveMetres(customRequest.width)} × {formatReserveMetres(customRequest.depth)} m</strong>
          <span>{tr('En attendant le devis, la réserve actuelle reste en place sur votre stand.')}</span>
          <button type="button" className="rsv-link" disabled={disabled} onClick={() => setCustomOpen(true)}>{tr('Modifier ma demande')}</button>
        </div>
      ) : customOpen ? (
        <CustomReserveForm tr={tr} initial={customRequest} disabled={disabled} onCancel={() => setCustomOpen(false)} onSubmit={async (payload) => { await onCustomRequest?.(payload); setCustomOpen(false); }} />
      ) : (
        <button type="button" className="rsv-custom-row" disabled={disabled} onClick={() => setCustomOpen(true)}>
          <Ruler size={14} />
          <span>{tr('Autre dimension ?')}</span>
          <strong>{tr('Sur mesure, sur devis')}</strong>
          <ChevronRight size={14} />
        </button>
      )}

      {notice && (
        <div className="rsv-notice" role="status">
          <AlertTriangle size={15} />
          <div>
            <strong>{tr(notice.title)}</strong>
            <span>{tr(notice.detail)}</span>
            <span className="rsv-notice-actions">
              {onUndoNotice && <button type="button" className="rsv-link" onClick={onUndoNotice}>{tr('Annuler le changement')}</button>}
              <span>{tr('ou')}</span>
              <button type="button" className="rsv-link" onClick={() => { onDismissNotice?.(); onOpenEditor?.('layout'); }}>{tr('ouvrir l’éditeur')}</button>
              <span>{tr('pour réorganiser.')}</span>
            </span>
          </div>
          <button type="button" className="rsv-icon-button" onClick={onDismissNotice} aria-label={tr('Fermer')}><X size={13} /></button>
        </div>
      )}

      {!reserve ? (
        <p className="rsv-quick-hint"><Info size={14} /> {tr('Choisissez une taille pour ajouter une réserve à votre stand.')}</p>
      ) : (
      <>
      <div className="rsv-summary">
        <SummaryRow icon={<PlacementGlyph />} label={tr('Emplacement')} value={tr(summary.placement || '')} onClick={() => onOpenEditor?.('structure')} />
        <SummaryRow icon={<DoorGlyph />} label={tr('Porte')} value={tr(summary.door || '')} onClick={() => onOpenEditor?.('door')} />
        <SummaryRow
          icon={<ContentsGlyph empty={!contents.length} />}
          label={tr('Aménagement')}
          value={tr(contents.length ? plural(contents.length, 'objet') : 'Aucun objet · réserve vide')}
          badge={summary.warning ? <span className="rsv-pill amber"><Zap size={10} /> {tr(summary.warning)}</span>
            : contents.length ? <span className={`rsv-pill ${summary.contentsPrice > 0 ? 'blue' : 'green'}`}>{tr(reservePriceTag(summary.contentsPrice))}</span> : null}
          tone={summary.warning ? 'warning' : ''}
          onClick={() => onOpenEditor?.('layout')}
        />
      </div>

      <button type="button" className="rsv-primary-button rsv-quick-edit" onClick={() => onOpenEditor?.(contents.length ? 'layout' : 'structure')}>
        <Layers size={15} /> {tr(disabled ? 'Voir la réserve' : 'Personnaliser la réserve')}
      </button>

      {!disabled && (confirmRemove ? (
        <div className="rsv-confirm" role="alertdialog">
          <strong>{tr('Supprimer la réserve ?')}</strong>
          <span>{tr(contents.length ? `Ses ${plural(contents.length, 'objet')} seront aussi retirés du panier.` : 'Vous pourrez la remettre à tout moment.')}</span>
          <div>
            <button type="button" className="rsv-ghost-button" onClick={() => setConfirmRemove(false)}>{tr('Annuler')}</button>
            <button type="button" className="rsv-danger-button" onClick={() => { setConfirmRemove(false); onRemove?.(); }}>{tr('Supprimer')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="reserve-remove-button rsv-remove-link" onClick={() => setConfirmRemove(true)}>
          <X size={14} /> {tr('Supprimer la réserve')}
        </button>
      ))}
      </>
      )}

      <QuickFooter tr={tr} total={totalPrice} detail={totalDetail} onApply={onApply} />
    </div>
  );
}

function ReserveAlternatives({ tr, onOpenShop, onAskQuestion }) {
  return (
    <div className="rsv-alternatives">
      <small>{tr('Besoin de plus de rangement ?')}</small>
      <button type="button" onClick={onOpenShop}>
        <Package size={16} />
        <span><strong>{tr('Étagères, meubles de rangement…')}</strong><em>{tr('À ajouter dans la Boutique (étape 3)')}</em></span>
        <ChevronRight size={14} />
      </button>
      <button type="button" onClick={onAskQuestion}>
        <HelpCircle size={16} />
        <span><strong>{tr('Un besoin particulier ?')}</strong><em>{tr('Posez une question à notre équipe')}</em></span>
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function QuickFooter({ tr, total = 0, detail = '', onApply }) {
  return (
    <footer className="rsv-quick-footer">
      <div>
        <span>{tr('Suppléments HT')}</span>
        <small>{tr(detail)}</small>
      </div>
      <strong><AnimatedPrice value={total} /></strong>
      {onApply && <button type="button" className="rsv-primary-button" onClick={onApply}>{tr('Appliquer')}</button>}
    </footer>
  );
}

function SummaryRow({ icon, label, value, badge = null, tone = '', onClick }) {
  return (
    <button type="button" className={`rsv-summary-row${tone ? ` ${tone}` : ''}`} onClick={onClick}>
      <span className="rsv-summary-icon">{icon}</span>
      <span className="rsv-summary-copy"><small>{label}</small><strong>{value}</strong></span>
      {badge}
      <ChevronRight size={14} />
    </button>
  );
}

function PlacementGlyph() {
  return <svg viewBox="0 0 28 20" aria-hidden="true"><path d="M14 2 L26 8 L14 14 L2 8 Z" fill="#e8edf5" stroke="#9aa8bd" strokeWidth="1" /><path d="M5 7.5 L11 4.5 L15 6.5 L9 9.5 Z" fill="#416bb0" /></svg>;
}

function DoorGlyph() {
  return <svg viewBox="0 0 28 20" aria-hidden="true"><path d="M2 14 H10 M18 14 H26" stroke="#2d333d" strokeWidth="2" /><path d="M10 14 V4" stroke="#416bb0" strokeWidth="1.6" /><path d="M10 4 A10 10 0 0 1 18 14" fill="none" stroke="#416bb0" strokeDasharray="2 1.6" /></svg>;
}

function ContentsGlyph({ empty = false }) {
  return empty
    ? <svg viewBox="0 0 28 20" aria-hidden="true"><rect x="7" y="4" width="14" height="12" rx="2" fill="none" stroke="#9aa8bd" /><path d="M7 8 H21" stroke="#9aa8bd" /></svg>
    : <svg viewBox="0 0 28 20" aria-hidden="true"><rect x="3" y="4" width="8" height="12" rx="1" fill="#f3e3c2" stroke="#d8b77a" /><rect x="13" y="7" width="6" height="9" rx="1" fill="#eef2f8" stroke="#9aa8bd" /><rect x="21" y="9" width="4" height="7" rx="1" fill="#6c7a90" /></svg>;
}

function CustomReserveForm({ tr, initial = null, disabled = false, onCancel, onSubmit }) {
  const [width, setWidth] = useState(initial?.width ? String(initial.width) : '');
  const [depth, setDepth] = useState(initial?.depth ? String(initial.depth) : '');
  const [note, setNote] = useState(initial?.note || '');
  const [state, setState] = useState({ loading: false, error: '' });
  const parse = (value) => Number(String(value || '').replace(',', '.'));
  const valid = parse(width) > 0.3 && parse(depth) > 0.3;
  const submit = async (event) => {
    event.preventDefault();
    if (!valid || state.loading) return;
    setState({ loading: true, error: '' });
    try {
      await onSubmit?.({ width: parse(width), depth: parse(depth), note: note.trim() });
      setState({ loading: false, error: '' });
    } catch (error) {
      setState({ loading: false, error: error?.message || 'Envoi impossible pour le moment.' });
    }
  };
  return (
    <form className="rsv-custom-form" onSubmit={submit}>
      <header><Ruler size={14} /><strong>{tr('Réserve sur mesure')}</strong><small>{tr('Devis sous 48 h')}</small></header>
      <div className="rsv-custom-grid">
        <label><span>{tr('Largeur')}</span><input inputMode="decimal" value={width} onChange={(event) => setWidth(event.target.value)} placeholder="2,50" disabled={disabled} /><em>m</em></label>
        <label><span>{tr('Profondeur')}</span><input inputMode="decimal" value={depth} onChange={(event) => setDepth(event.target.value)} placeholder="1,20" disabled={disabled} /><em>m</em></label>
      </div>
      <label className="rsv-custom-note"><span>{tr('Précisions (facultatif)')}</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr('Porte, rangements, contraintes…')} disabled={disabled} /></label>
      {state.error && <p className="rsv-form-error">{tr(state.error)}</p>}
      <div className="rsv-custom-actions">
        <button type="button" className="rsv-ghost-button" onClick={onCancel}>{tr('Annuler')}</button>
        <button type="submit" className="rsv-primary-button" disabled={!valid || disabled || state.loading}><Send size={13} /> {tr(state.loading ? 'Envoi…' : 'Demander un devis')}</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Editor modal                                                        */
/* ------------------------------------------------------------------ */

function useHistory(initial) {
  const [state, setState] = useState({ past: [], present: initial, future: [] });
  const commit = useCallback((updater) => {
    setState((current) => {
      const next = typeof updater === 'function' ? updater(current.present) : updater;
      if (next === current.present) return current;
      return { past: [...current.past.slice(-60), current.present], present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setState((current) => (current.past.length ? {
    past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future],
  } : current)), []);
  const redo = useCallback(() => setState((current) => (current.future.length ? {
    past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1),
  } : current)), []);
  return { draft: state.present, commit, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0, dirty: state.past.length > 0 };
}

let reserveContentSeed = 0;
function newContentKey() {
  reserveContentSeed += 1;
  return `reserve-content-${Date.now().toString(36)}-${reserveContentSeed}`;
}

export function ReserveEditorModal({ model, initialStep = 'structure', initialSelection = '', tr = identity, onClose, onCommit, onCustomRequest }) {
  const readOnly = Boolean(model.readOnly);
  const { draft, commit, undo, redo, canUndo, canRedo, dirty } = useHistory(model.initialDraft);
  const [step, setStep] = useState(initialStep);
  const [visited, setVisited] = useState(() => new Set([initialStep]));
  const [view, setView] = useState('plan');
  // Plan is always fitted to the panel, dimensioned and snapped to a 5 cm grid.
  const zoom = 1;
  const showDims = true;
  const showGrid = true;
  const [selectedKey, setSelectedKey] = useState(initialSelection);
  const [layoutTab, setLayoutTab] = useState(initialSelection ? 'inside' : 'catalog');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null);
  const [toast, setToast] = useState(null);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const svgRef = useRef(null);
  const groupRef = useRef(null);
  const planWrapRef = useRef(null);
  const dragCatalogKey = useRef('');
  const toastTimer = useRef(0);

  const built = useMemo(() => model.build(draft), [model, draft.optionType, draft.placement, draft.orientation, draft.doorByType, draft.handleOrientation, draft.builtinsByType]); // eslint-disable-line react-hooks/exhaustive-deps
  const reserve = built?.reserve || null;
  // Door and built-in choices are kept per geometry (each size, corner and orientation has its own layout).
  const groupType = reserve?.options?.reserveGeometryKey || reserve?.type || '';
  const structure = useMemo(() => (reserve ? reserveStructure(reserve, { doorOpening: draft.doorOpening }) : null), [reserve, draft.doorOpening]);
  const interior = structure?.interior || null;
  const hasPower = useMemo(() => (structure?.builtins || []).some(isReservePowerSource) || draft.contents.some((content) => content.isPower), [structure, draft.contents]);
  const context = useMemo(() => ({ interior, contents: draft.contents, builtins: structure?.builtins || [], door: structure?.door || null }), [interior, draft.contents, structure]);
  const issuesByKey = useMemo(() => Object.fromEntries(draft.contents.map((content) => [content.key, reserveContentIssues(content, context)])), [draft.contents, context]);
  const pricing = useMemo(() => model.contentPricing(draft.contents), [model, draft.contents]);
  const reservePrice = model.reservePrice(draft.optionType);
  const total = reservePrice + pricing.total;
  const freeRatio = interior ? reserveFreeSurfaceRatio(interior, draft.contents, structure?.builtins || []) : 0;
  const placements = useMemo(() => model.placementsFor(draft.optionType), [model, draft.optionType]);
  const currentRow = model.rows.find((row) => row.optionType === draft.optionType) || model.rows[0] || null;
  const selectedContent = draft.contents.find((content) => content.key === selectedKey) || null;
  const selectedBuiltin = selectedKey.startsWith('builtin:') ? (structure?.builtins || []).find((child) => `builtin:${child.id}` === selectedKey) : null;
  const doorSlotsBySide = useMemo(() => (structure?.slots || []).reduce((acc, slot) => ({ ...acc, [slot.side]: [...(acc[slot.side] || []), slot] }), {}), [structure]);
  const removedBuiltins = useMemo(() => {
    const overrides = draft.builtinsByType?.[groupType] || {};
    return (built?.baseChildren || []).filter((child) => overrides[child.id]?.removed);
  }, [draft.builtinsByType, groupType, built]);

  const showToast = useCallback((message, tone = 'info', action = null) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone, action, id: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 6500 : 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const goStep = (next) => {
    setStep(next);
    setVisited((current) => new Set([...current, next]));
    setHoverPreview(null);
  };

  // Keep contents valid when the structure changes (size, placement, door).
  const applyStructure = useCallback((patch, label = '') => {
    if (readOnly) return;
    commit((current) => {
      const nextDraft = { ...current, ...patch };
      const nextBuilt = model.build(nextDraft);
      const nextStructure = nextBuilt?.reserve ? reserveStructure(nextBuilt.reserve, { doorOpening: nextDraft.doorOpening }) : null;
      if (!nextStructure?.interior) return nextDraft;
      const { kept, removed } = refitReserveContents(current.contents, { interior: nextStructure.interior, builtins: nextStructure.builtins, door: nextStructure.door });
      if (removed.length) {
        window.setTimeout(() => showToast(`${plural(removed.length, 'objet ne tient', 'objets ne tiennent')} plus : ${removed.map((item) => item.label).join(', ')}`, 'warning', { label: 'Annuler', run: undo }), 0);
      } else if (label) {
        window.setTimeout(() => showToast(label, 'success'), 0);
      }
      return { ...nextDraft, contents: kept };
    });
  }, [commit, model, readOnly, showToast, undo]);

  const updateContent = useCallback((key, updater) => {
    if (readOnly) return;
    commit((current) => ({ ...current, contents: current.contents.map((content) => (content.key === key ? updater(content) : content)) }));
  }, [commit, readOnly]);

  const updateBuiltin = useCallback((childId, patch) => {
    if (readOnly || !groupType) return;
    commit((current) => {
      const byType = current.builtinsByType || {};
      const overrides = byType[groupType] || {};
      return { ...current, builtinsByType: { ...byType, [groupType]: { ...overrides, [childId]: { ...(overrides[childId] || {}), ...patch } } } };
    });
  }, [commit, groupType, readOnly]);

  const addCatalogEntry = useCallback((entry, center = null) => {
    if (readOnly || !interior) return null;
    const base = {
      key: newContentKey(),
      sourceId: '',
      catalogKey: entry.key,
      type: entry.type,
      label: entry.label,
      detail: entry.detail,
      size: entry.size,
      mount: entry.mount,
      category: entry.category,
      thumbnail: entry.thumbnail,
      needsPower: entry.needsPower,
      isPower: entry.isPower,
      rotation: 0,
      u: 0,
      v: 0,
    };
    let placed = null;
    if (center) {
      const candidate = base.mount === 'wall' ? snapWallContent(base, center, interior) : clampFloorContent(base, center, interior);
      if (!reserveContentIssues(candidate, context).length) placed = candidate;
    }
    if (!placed) placed = findFreeReserveSpot(base, context);
    if (!placed) {
      showToast(`Plus de place pour « ${entry.label} » dans cette réserve`, 'warning');
      return null;
    }
    commit((current) => ({ ...current, contents: [...current.contents, placed] }));
    setSelectedKey(placed.key);
    showToast(`${entry.label} ajouté à la réserve`, 'success');
    return placed;
  }, [commit, context, interior, readOnly, showToast]);

  const removeContent = useCallback((key) => {
    if (readOnly) return;
    if (key.startsWith('builtin:')) {
      updateBuiltin(key.slice('builtin:'.length), { removed: true });
      showToast('Élément inclus retiré', 'info', { label: 'Annuler', run: undo });
    } else {
      const content = draft.contents.find((item) => item.key === key);
      commit((current) => ({ ...current, contents: current.contents.filter((item) => item.key !== key) }));
      if (content) showToast(`${content.label} retiré`, 'info', { label: 'Annuler', run: undo });
    }
    setSelectedKey('');
  }, [commit, draft.contents, readOnly, showToast, undo, updateBuiltin]);

  const duplicateContent = useCallback((key) => {
    const content = draft.contents.find((item) => item.key === key);
    if (!content) return;
    const entry = model.catalog.find((item) => item.key === content.catalogKey) || { ...content, key: content.catalogKey };
    const placed = findFreeReserveSpot({ ...content, key: newContentKey(), sourceId: '' }, context);
    if (!placed) { showToast(`Plus de place pour dupliquer « ${content.label} »`, 'warning'); return; }
    commit((current) => ({ ...current, contents: [...current.contents, { ...placed, catalogKey: entry.key }] }));
    setSelectedKey(placed.key);
  }, [commit, context, draft.contents, model.catalog, showToast]);

  const rotateSelected = useCallback(() => {
    if (readOnly) return;
    if (selectedContent) {
      if (selectedContent.mount === 'wall') { showToast('Un objet mural suit l’orientation de son mur', 'info'); return; }
      const rotated = clampFloorContent({ ...selectedContent, rotation: (Number(selectedContent.rotation || 0) + 90) % 360 }, contentCenter(selectedContent, interior), interior);
      const issues = reserveContentIssues(rotated, context);
      if (issues.length) {
        const relocated = findFreeReserveSpot(rotated, context);
        if (!relocated) { showToast(`Rotation impossible : ${ISSUE_LABELS[issues[0]].toLowerCase()}`, 'warning'); return; }
        updateContent(selectedContent.key, () => relocated);
        return;
      }
      updateContent(selectedContent.key, () => rotated);
    } else if (selectedBuiltin && !isWallBuiltin(selectedBuiltin)) {
      updateBuiltin(selectedBuiltin.id, { rotation: (Number(selectedBuiltin.rotation || 0) + 90) % 360 });
    }
  }, [context, interior, readOnly, selectedBuiltin, selectedContent, showToast, updateBuiltin, updateContent]);

  // Pointer helpers.
  const toLocal = useCallback((clientX, clientY) => {
    const group = groupRef.current;
    const svg = svgRef.current;
    if (!group || !svg?.createSVGPoint) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = group.getScreenCTM();
    if (!matrix) return null;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, z: local.y };
  }, []);

  const snap = useCallback((value) => (showGrid ? snapToGrid(value, RESERVE_GRID) : Math.round(value * 100) / 100), [showGrid]);

  const onItemPointerDown = useCallback((event, item) => {
    event.stopPropagation();
    setSelectedKey(item.key);
    if (step !== 'layout') return;
    if (readOnly) return;
    setLayoutTab('inside');
    const local = toLocal(event.clientX, event.clientY);
    if (!local) return;
    event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId);
    setDrag({ key: item.key, kind: item.kind, offset: { x: item.x - local.x, z: item.z - local.z }, origin: { x: item.x, z: item.z }, position: null, valid: true, reason: '', pointerId: event.pointerId, moved: false });
  }, [readOnly, step, toLocal]);

  const dragRef = useRef(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const dragging = Boolean(drag);
  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const local = toLocal(event.clientX, event.clientY);
      if (!local) return;
      const center = { x: snap(local.x + drag.offset.x), z: snap(local.z + drag.offset.z) };
      if (drag.kind === 'builtin') {
        const child = (structure?.builtins || []).find((candidate) => `builtin:${candidate.id}` === drag.key);
        if (!child) return;
        const box = footprintBounds(reserveChildSize(child), center.x, center.z, child.rotation || 0);
        const others = draft.contents.filter((content) => content.mount !== 'wall').map((content) => contentFootprint(content, interior));
        const inside = box.minX >= interior.minX - 0.005 && box.maxX <= interior.maxX + 0.005 && box.minZ >= interior.minZ - 0.005 && box.maxZ <= interior.maxZ + 0.005;
        const blocked = !inside ? 'outside' : structure.door?.zoneInside && boundsOverlap(box, structure.door.zone) ? 'door' : !isWallBuiltin(child) && others.some((other) => boundsOverlap(box, other)) ? 'overlap' : '';
        setDrag((current) => current && ({ ...current, position: center, valid: !blocked, reason: blocked, moved: true }));
        return;
      }
      const content = draft.contents.find((item) => item.key === drag.key);
      if (!content) return;
      const candidate = content.mount === 'wall' ? snapWallContent(content, center, interior) : clampFloorContent(content, center, interior);
      const issues = reserveContentIssues(candidate, context);
      setDrag((current) => current && ({ ...current, candidate, position: contentCenter(candidate, interior), valid: !issues.length, reason: issues[0] || '', moved: true }));
    };
    const up = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current?.moved || !current.position) return;
      if (!current.valid) {
        showToast(`Déplacement annulé : ${ISSUE_LABELS[current.reason]?.toLowerCase() || 'place indisponible'}`, 'warning');
      } else if (current.kind === 'builtin') {
        updateBuiltin(current.key.slice('builtin:'.length), { x: Math.round(current.position.x * 1000) / 1000, z: Math.round(current.position.z * 1000) / 1000 });
      } else if (current.candidate) {
        updateContent(current.key, () => current.candidate);
      }
    };
    const cancel = (event) => { if (event.key === 'Escape') { dragRef.current = null; setDrag(null); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', cancel);
    };
  }, [dragging, context, draft.contents, interior, showToast, snap, structure, toLocal, updateBuiltin, updateContent]);

  // Contents rendered on the plan, with the live drag position.
  const planContents = useMemo(() => {
    if (!drag?.position || drag.kind !== 'content' || !drag.candidate) return draft.contents;
    return draft.contents.map((content) => (content.key === drag.key ? drag.candidate : content));
  }, [draft.contents, drag]);
  const planStructure = useMemo(() => {
    if (!structure || !drag?.position || drag.kind !== 'builtin') return structure;
    return { ...structure, builtins: structure.builtins.map((child) => (`builtin:${child.id}` === drag.key ? { ...child, x: drag.position.x, z: drag.position.z } : child)) };
  }, [structure, drag]);

  // Catalogue drag & drop (HTML5).
  const catalogEntryByKey = useMemo(() => new Map(model.catalog.map((entry) => [entry.key, entry])), [model.catalog]);
  const onPlanDragOver = (event) => {
    const key = dragCatalogKey.current;
    const entry = catalogEntryByKey.get(key);
    if (!entry || readOnly || step !== 'layout' || !interior) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const local = toLocal(event.clientX, event.clientY);
    if (!local) return;
    const base = { key: '__ghost__', size: entry.size, mount: entry.mount, rotation: 0, u: 0, v: 0 };
    const center = { x: snap(local.x), z: snap(local.z) };
    const candidate = entry.mount === 'wall' ? snapWallContent(base, center, interior) : clampFloorContent(base, center, interior);
    const issues = reserveContentIssues(candidate, context);
    setGhost({ box: contentFootprint(candidate, interior), valid: !issues.length, reason: issues[0] || '', center: contentCenter(candidate, interior) });
  };
  const onPlanDrop = (event) => {
    const key = dragCatalogKey.current || event.dataTransfer.getData('text/plain');
    const entry = catalogEntryByKey.get(key);
    event.preventDefault();
    const current = ghost;
    setGhost(null);
    dragCatalogKey.current = '';
    if (!entry || !current) return;
    if (!current.valid) { showToast(`Impossible ici : ${ISSUE_LABELS[current.reason]?.toLowerCase() || 'place indisponible'}`, 'warning'); return; }
    addCatalogEntry(entry, current.center);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if (event.key === 'Escape') {
        if (selectedKey) { setSelectedKey(''); return; }
        requestClose();
        return;
      }
      if (readOnly || step !== 'layout' || !selectedKey) return;
      if (event.key === 'r' || event.key === 'R') { event.preventDefault(); rotateSelected(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeContent(selectedKey); }
      if (event.key.startsWith('Arrow') && selectedContent) {
        event.preventDefault();
        const delta = event.shiftKey ? 0.1 : 0.01;
        const center = contentCenter(selectedContent, interior);
        const next = {
          x: center.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0),
          z: center.z + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0),
        };
        const candidate = selectedContent.mount === 'wall' ? snapWallContent(selectedContent, next, interior) : clampFloorContent(selectedContent, next, interior);
        if (!reserveContentIssues(candidate, context).length) updateContent(selectedContent.key, () => candidate);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render on purpose: handlers read the latest draft

  const requestClose = () => {
    if (dirty && !readOnly) { setConfirmClose(true); return; }
    close();
  };
  const close = () => {
    setClosing(true);
    window.setTimeout(() => onClose?.(), 220);
  };
  const validate = () => {
    if (readOnly) { close(); return; }
    const blockingBuiltin = doorBlockers.find((blocker) => blocker.key.startsWith('builtin:'));
    if (blockingBuiltin) {
      setStep('layout');
      setLayoutTab('inside');
      setSelectedKey(blockingBuiltin.key);
      showToast(`« ${blockingBuiltin.label} » bloque l’ouverture de la porte : déplacez-le ou retirez-le`, 'warning');
      return;
    }
    const blocked = draft.contents.find((content) => (issuesByKey[content.key] || []).length);
    if (blocked) {
      setStep('layout');
      setLayoutTab('inside');
      setSelectedKey(blocked.key);
      showToast(`« ${blocked.label} » ${ISSUE_LABELS[issuesByKey[blocked.key][0]].toLowerCase()}`, 'warning');
      return;
    }
    onCommit?.(draft);
    close();
  };

  // Selected item floating toolbar position.
  const [toolbarPosition, setToolbarPosition] = useState(null);
  useLayoutEffect(() => {
    if (view !== 'plan' || step !== 'layout' || !selectedKey || drag) { setToolbarPosition(null); return; }
    const element = svgRef.current?.querySelector(`[data-key="${CSS.escape(selectedKey)}"] .rsv-item-shape`);
    const wrap = planWrapRef.current;
    if (!element || !wrap) { setToolbarPosition(null); return; }
    const frame = requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      const host = wrap.getBoundingClientRect();
      setToolbarPosition({ left: box.left - host.left + box.width / 2, top: box.bottom - host.top + 10 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKey, draft, view, step, zoom, drag, showDims]);

  // Free canvas areas around the floating 3D preview, toolbar, legend and hint.
  const hasPreview3D = Boolean(model.Preview3D);
  const planSafeAreas = useMemo(() => (hasPreview3D && view === 'plan'
    ? [{ left: 318, top: 66, right: 28, bottom: 62 }, { left: 28, top: 208, right: 28, bottom: 62 }]
    : [{ left: 28, top: 66, right: 28, bottom: 62 }]), [hasPreview3D, view]);
  const doorState = structure?.door || null;
  // Floor objects (included or added) standing where the door leaf swings.
  const doorBlockers = useMemo(() => {
    if (!doorState?.zoneInside || !interior) return [];
    const builtinBlockers = (structure?.builtins || []).filter((child) => !isWallBuiltin(child) && boundsOverlap(childFootprint(child), doorState.zone))
      .map((child) => ({ key: `builtin:${child.id}`, label: child.label }));
    const contentBlockers = draft.contents.filter((content) => (issuesByKey[content.key] || []).includes('door')).map((content) => ({ key: content.key, label: content.label }));
    return [...builtinBlockers, ...contentBlockers];
  }, [doorState, interior, structure, draft.contents, issuesByKey]);
  const doorSideSlots = doorState ? (doorSlotsBySide[doorState.side] || []) : [];
  const doorSlotIndex = doorSideSlots.findIndex((slot) => slot.kind === 'door');
  // The stored slot is the authored partition that swaps places with the authored door.
  // Clicking the partition currently standing in the authored door position restores the original layout.
  const moveDoorToSlot = (slotId, label = 'Porte déplacée') => {
    if (!slotId || readOnly || !groupType) return;
    const currentSlot = draft.doorByType?.[groupType]?.slot || '';
    const nextSlot = slotId === currentSlot ? '' : slotId;
    applyStructure({ doorByType: { ...(draft.doorByType || {}), [groupType]: { slot: nextSlot } } }, label);
  };
  const doorDistance = structure ? doorDistanceFromLeft(structure.children, { doorOpening: draft.doorOpening }) : 0;
  const handleChoices = built?.handleChoices || ['left', 'right'];

  const catalogEntries = useMemo(() => {
    const text = search.trim().toLowerCase();
    return model.catalog.filter((entry) => (category === 'all' || entry.category === category)
      && (!text || `${entry.label} ${entry.detail || ''} ${entry.groupLabel || ''}`.toLowerCase().includes(text)));
  }, [model.catalog, category, search]);
  const categories = useMemo(() => ['all', ...['storage', 'appliance', 'wall', 'electric'].filter((id) => model.catalog.some((entry) => entry.category === id))], [model.catalog]);
  const fitsByKey = useMemo(() => {
    if (!interior) return {};
    return Object.fromEntries(model.catalog.map((entry) => [entry.key, Boolean(findFreeReserveSpot({ key: '__probe__', size: entry.size, mount: entry.mount, rotation: 0, u: 0, v: 0 }, context))]));
  }, [model.catalog, context, interior]);

  const subtitle = step === 'structure'
    ? `${currentRow?.areaLabel || ''} · ${formatReserveMetres(interior?.width || 0)} × ${formatReserveMetres(interior?.depth || 0)} m · ${PLACEMENT_LABELS[built?.placement] || ''}${built?.orientationChoices?.length ? ` · ${orientationLabel(built.orientation, built.orientationCorner)}` : ''}`.toLowerCase().replace(/^./, (c) => c.toUpperCase())
    : step === 'door'
      ? `${currentRow?.areaLabel || ''} · porte en ${(SIDE_LABELS[doorState?.side] || '').toLowerCase()} · ${doorState?.opening === 'pull' ? 'tirante' : 'poussante'} · poignée à ${doorState?.handle === 'left' ? 'gauche' : 'droite'}`
      : `${currentRow?.areaLabel || ''} · ${plural(draft.contents.length, 'objet')} · surface libre ${Math.round(freeRatio * 100)} %`;

  const stepDone = (id) => visited.has(id) && id !== step && STEPS.findIndex((item) => item.id === id) < STEPS.findIndex((item) => item.id === step);
  const Preview3D = model.Preview3D;
  const missingPowerContents = draft.contents.filter((content) => content.needsPower);
  const powerEntry = model.catalog.find((entry) => entry.key === model.powerKey) || null;

  const modal = (
    <div className={`rsv-overlay${closing ? ' closing' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section className="rsv-modal" role="dialog" aria-modal="true" aria-label={tr('Configurateur de réserve')}>
        <header className="rsv-modal-head">
          <span className="rsv-modal-icon"><DoorOpen size={20} /></span>
          <div className="rsv-modal-title">
            <h2>{tr('Réserve')}</h2>
            <p key={subtitle}>{tr(subtitle)}</p>
          </div>
          {readOnly && <span className="rsv-pill light"><Eye size={12} /> {tr('Lecture seule')}</span>}
        </header>

        <div className="rsv-modal-body">
          <div className={`rsv-stage view-${view} step-${step}`} ref={planWrapRef}>
            <div className="rsv-toolbar">
              <button type="button" onClick={undo} disabled={!canUndo || readOnly} aria-label={tr('Annuler')} title={tr('Annuler (⌘Z)')}><Undo2 size={15} /></button>
              <button type="button" onClick={redo} disabled={!canRedo || readOnly} aria-label={tr('Rétablir')} title={tr('Rétablir (⇧⌘Z)')}><Redo2 size={15} /></button>
              <span className="rsv-toolbar-sep" />
              <div className="rsv-segmented" role="tablist">
                <button type="button" role="tab" aria-selected={view === 'plan'} className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')}><Layers size={14} /> {tr('Plan 2D')}</button>
                <button type="button" role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><Box size={14} /> 3D</button>
              </div>
            </div>

            {Preview3D && reserve && (
              <div className={`rsv-preview3d ${view === '3d' ? 'is-full' : 'is-mini'}`}>
                {view !== '3d' && (
                  <button type="button" className="rsv-preview3d-open" onClick={() => setView('3d')} aria-label={tr('Voir en 3D')}>
                    <span><Box size={13} /> {tr('Voir en 3D')}</span>
                  </button>
                )}
                <div className="rsv-preview3d-canvas">
                  <Preview3D
                    reserve={reserve}
                    contents={drag?.candidate ? planContents : draft.contents}
                    selectedKey={selectedKey}
                    full={view === '3d'}
                    onSelect={(key) => { if (key) { setSelectedKey(key); if (step === 'layout') setLayoutTab('inside'); } }}
                  />
                </div>
              </div>
            )}

            {view === 'plan' && structure && (
              <ReservePlan
                tr={tr}
                svgRef={svgRef}
                groupRef={groupRef}
                stand={model.stand}
                others={model.others}
                reserve={reserve}
                structure={planStructure}
                contents={planContents}
                focus={step === 'structure' ? 'stand' : 'reserve'}
                safeAreas={planSafeAreas}
                zoom={zoom}
                showDims={showDims}
                showGrid={showGrid}
                step={step}
                selectedKey={selectedKey}
                draggingKey={drag?.moved ? drag.key : ''}
                invalid={drag?.moved && !drag.valid ? { reason: drag.reason, door: drag.reason === 'door' } : {}}
                ghost={ghost}
                previewReserve={hoverPreview?.reserve || null}
                previewLabel={hoverPreview?.label || ''}
                hasPower={hasPower}
                interactive={!readOnly}
                onItemPointerDown={onItemPointerDown}
                onBackgroundPointerDown={(event) => { if (!event.target.closest?.('.rsv-item, .rsv-slot, .rsv-door')) setSelectedKey(''); }}
                onSlotSelect={(slotId) => moveDoorToSlot(slotId)}
                onDragOver={onPlanDragOver}
                onDrop={onPlanDrop}
                onDragLeave={() => setGhost(null)}
              />
            )}

            {toolbarPosition && (selectedContent || selectedBuiltin) && !readOnly && (
              <div className="rsv-float-toolbar" style={{ left: toolbarPosition.left, top: toolbarPosition.top }}>
                <button type="button" onClick={rotateSelected} title={tr('Pivoter (R)')} aria-label={tr('Pivoter')} disabled={(selectedContent?.mount || (selectedBuiltin && isWallBuiltin(selectedBuiltin) ? 'wall' : 'floor')) === 'wall'}><RotateCw size={14} /></button>
                {selectedContent && <button type="button" onClick={() => duplicateContent(selectedContent.key)} title={tr('Dupliquer')} aria-label={tr('Dupliquer')}><Copy size={14} /></button>}
                <button type="button" className="danger" onClick={() => removeContent(selectedKey)} title={tr('Supprimer (Suppr)')} aria-label={tr('Supprimer')}><Trash2 size={14} /></button>
                <span>{contentSizeLabel(selectedContent?.size || reserveChildSize(selectedBuiltin))}</span>
              </div>
            )}

            <div className="rsv-hint" key={`${step}-${view}-${drag ? 'drag' : ghost ? 'ghost' : ''}`}>
              {view === '3d' ? <><RotateCw size={13} /> <b>{tr('Glisser')}</b> {tr('pour tourner')} · <b>{tr('Molette')}</b> {tr('pour zoomer')} · {tr('cliquez un objet pour le sélectionner')}</>
                : ghost ? <><b>{tr('Relâchez')}</b> {tr('pour déposer')} · <b>{tr('Échap')}</b> {tr('pour annuler')}</>
                  : step === 'structure' ? <><Eye size={13} /> {tr('Survolez une option pour la prévisualiser sur le plan')}</>
                    : step === 'door' ? <><ArrowLeftRight size={13} /> {tr('Cliquez un mur en pointillés pour y déplacer la porte')}</>
                      : <><b>{tr('Glisser')}</b> {tr('déplacer')} · <b>R</b> {tr('pivoter')} · <b>{tr('Suppr')}</b> {tr('supprimer')} · <b>⌘Z</b> {tr('annuler')}</>}
            </div>

            {toast && (
              <div className={`rsv-toast ${toast.tone}`} key={toast.id} role="status">
                {toast.tone === 'warning' ? <AlertTriangle size={14} /> : toast.tone === 'success' ? <Check size={14} /> : <Info size={14} />}
                <span>{tr(toast.message)}</span>
                {toast.action && <button type="button" onClick={() => { toast.action.run(); setToast(null); }}>{tr(toast.action.label)}</button>}
              </div>
            )}
          </div>

          <aside className="rsv-panel">
            <nav className="rsv-steps" style={{ '--rsv-step': STEPS.findIndex((item) => item.id === step) }}>
              <span className="rsv-steps-indicator" aria-hidden="true" />
              {STEPS.map((item, index) => (
                <button key={item.id} type="button" className={`${step === item.id ? 'active' : ''}${stepDone(item.id) ? ' done' : ''}`} onClick={() => goStep(item.id)}>
                  <span className="rsv-step-badge">{stepDone(item.id) ? <Check size={12} /> : index + 1}</span>
                  {tr(item.label)}
                </button>
              ))}
            </nav>

            <div className="rsv-panel-scroll" key={step}>
              {step === 'structure' && (
                <StructureStep
                  tr={tr}
                  model={model}
                  draft={draft}
                  readOnly={readOnly}
                  placements={placements}
                  currentPlacement={built?.placement || ''}
                  currentRow={currentRow}
                  customOpen={customOpen}
                  setCustomOpen={setCustomOpen}
                  onCustomRequest={onCustomRequest}
                  onSize={(row) => { setHoverPreview(null); applyStructure({ optionType: row.optionType }, `Réserve ${row.areaLabel} sélectionnée`); }}
                  onPlacement={(placement) => { setHoverPreview(null); applyStructure({ placement: placement.placement }, `${PLACEMENT_LABELS[placement.placement] || placement.label} sélectionné`); }}
                  orientation={built?.orientation || ''}
                  orientationChoices={built?.orientationChoices || []}
                  orientationCorner={built?.orientationCorner || ''}
                  onOrientation={(orientation) => { setHoverPreview(null); applyStructure({ orientation }, `${orientationLabel(orientation, built?.orientationCorner)} sélectionné`); }}
                  onPreview={(preview) => setHoverPreview(preview)}
                />
              )}
              {step === 'door' && doorState && (
                <DoorStep
                  tr={tr}
                  readOnly={readOnly}
                  doorState={doorState}
                  slotsBySide={doorSlotsBySide}
                  sideSlots={doorSideSlots}
                  slotIndex={doorSlotIndex}
                  distance={doorDistance}
                  handleChoices={handleChoices}
                  blockers={doorBlockers}
                  onArrange={(key) => { goStep('layout'); setLayoutTab('inside'); if (key) setSelectedKey(key); }}
                  onSide={(side) => {
                    const target = (doorSlotsBySide[side] || []).find((slot) => slot.kind !== 'door');
                    if (target) moveDoorToSlot(target.id, `Porte déplacée en ${(SIDE_LABELS[side] || '').toLowerCase()}`);
                  }}
                  onSlotIndex={(index) => { const slot = doorSideSlots[index]; if (slot && slot.kind !== 'door') moveDoorToSlot(slot.id); }}
                  onOpening={(opening) => applyStructure({ doorOpening: opening })}
                  onHandle={(handle) => applyStructure({ handleOrientation: handle })}
                />
              )}
              {step === 'door' && !doorState && <p className="rsv-empty-note">{tr('Cette réserve n’a pas de porte configurable.')}</p>}
              {step === 'layout' && (
                <LayoutStep
                  tr={tr}
                  readOnly={readOnly}
                  tab={layoutTab}
                  setTab={setLayoutTab}
                  categories={categories}
                  category={category}
                  setCategory={setCategory}
                  search={search}
                  setSearch={setSearch}
                  entries={catalogEntries}
                  fitsByKey={fitsByKey}
                  contents={draft.contents}
                  builtins={structure?.builtins || []}
                  removedBuiltins={removedBuiltins}
                  pricing={pricing}
                  issuesByKey={issuesByKey}
                  selectedKey={selectedKey}
                  selectedContent={selectedContent}
                  selectedBuiltin={selectedBuiltin}
                  interior={interior}
                  freeRatio={freeRatio}
                  hasPower={hasPower}
                  missingPower={missingPowerContents}
                  powerEntry={powerEntry}
                  onSelect={setSelectedKey}
                  onAdd={(entry) => addCatalogEntry(entry)}
                  onDragStart={(entry) => { dragCatalogKey.current = entry.key; }}
                  onDragEnd={() => { dragCatalogKey.current = ''; setGhost(null); }}
                  onRemove={removeContent}
                  onDuplicate={duplicateContent}
                  onRotate={rotateSelected}
                  onRestoreBuiltin={(childId) => updateBuiltin(childId, { removed: false })}
                  onPosition={(key, axis, valueCm) => {
                    const content = draft.contents.find((item) => item.key === key);
                    if (!content || !interior) return;
                    const box = contentFootprint(content, interior);
                    const metres = Number(valueCm) / 100;
                    if (!Number.isFinite(metres)) return;
                    const center = contentCenter(content, interior);
                    const next = axis === 'x'
                      ? { x: interior.minX + metres + (center.x - box.minX), z: center.z }
                      : { x: center.x, z: interior.minZ + metres + (center.z - box.minZ) };
                    const candidate = content.mount === 'wall' ? snapWallContent(content, next, interior) : clampFloorContent(content, next, interior);
                    const issues = reserveContentIssues(candidate, context);
                    if (issues.length) showToast(`Position impossible : ${ISSUE_LABELS[issues[0]].toLowerCase()}`, 'warning');
                    else updateContent(key, () => candidate);
                  }}
                  onRotation={(key, rotation) => {
                    const content = draft.contents.find((item) => item.key === key);
                    if (!content || content.mount === 'wall') return;
                    const candidate = clampFloorContent({ ...content, rotation }, contentCenter(content, interior), interior);
                    const issues = reserveContentIssues(candidate, context);
                    if (!issues.length) { updateContent(key, () => candidate); return; }
                    const relocated = findFreeReserveSpot(candidate, context);
                    if (relocated) updateContent(key, () => relocated);
                    else showToast(`Rotation impossible : ${ISSUE_LABELS[issues[0]].toLowerCase()}`, 'warning');
                  }}
                />
              )}
            </div>

            <footer className="rsv-panel-footer">
              <div className="rsv-total">
                <span>{tr('Total réserve HT')}</span>
                <small>{tr(`${currentRow?.areaLabel ? `Réserve ${currentRow.areaLabel}` : 'Réserve'} · ${plural(draft.contents.length, 'objet')}`)}</small>
              </div>
              <strong className="rsv-total-value"><AnimatedPrice value={total} zeroLabel={tr('Inclus')} /></strong>
              <div className="rsv-footer-actions">
                {!readOnly && step !== 'layout' ? (
                  <>
                    <button type="button" className="rsv-ghost-button" onClick={validate}>{tr('Valider')}</button>
                    <button type="button" className="rsv-primary-button" onClick={() => goStep(step === 'structure' ? 'door' : 'layout')}>
                      {tr(step === 'structure' ? 'Suivant : la porte' : 'Suivant : l’aménagement')} <ChevronRight size={15} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="rsv-primary-button" onClick={validate}><Check size={15} /> {tr(readOnly ? 'Fermer' : 'Valider la réserve')}</button>
                )}
              </div>
            </footer>
          </aside>
        </div>

        {confirmClose && (
          <div className="rsv-confirm-close" role="alertdialog">
            <div>
              <strong>{tr('Quitter sans enregistrer ?')}</strong>
              <span>{tr('Les modifications de la réserve seront perdues.')}</span>
              <div>
                <button type="button" className="rsv-ghost-button" onClick={() => setConfirmClose(false)}>{tr('Continuer l’édition')}</button>
                <button type="button" className="rsv-danger-button" onClick={() => { setConfirmClose(false); close(); }}>{tr('Quitter')}</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(modal, document.body);
}

function StructureStep({ tr, model, draft, readOnly, placements, currentPlacement, currentRow, customOpen, setCustomOpen, onCustomRequest, onSize, onPlacement, onPreview,
  orientation = '', orientationChoices = [], orientationCorner = '', onOrientation }) {
  const previewFor = (patch, label) => {
    const built = model.build({ ...draft, ...patch });
    if (!built?.reserve) return null;
    return { reserve: built.reserve, label };
  };
  return (
    <div className="rsv-step-body">
      <section className="rsv-section">
        <header><h3>{tr('Taille')}</h3><span className="rsv-section-value">{tr(currentRow?.areaLabel || '')}</span></header>
        <div className="rsv-size-list">
          {model.rows.map((row, index) => {
            const active = row.optionType === draft.optionType;
            return (
              <button
                key={row.key}
                type="button"
                className={`rsv-size-row${active ? ' active' : ''}${row.available === false ? ' unavailable' : ''}`}
                style={{ '--rsv-index': index }}
                disabled={readOnly || row.available === false}
                onClick={() => onSize(row)}
                onMouseEnter={() => !active && row.available !== false && onPreview(previewFor({ optionType: row.optionType }, `Aperçu · ${row.areaLabel}`))}
                onMouseLeave={() => onPreview(null)}
              >
                <span className="rsv-radio" aria-hidden="true" />
                <span className="rsv-size-copy"><strong>{tr(`Réserve ${row.areaLabel}`)}</strong><small>{tr(row.available === false ? row.reason : orientedDims(row.dims, orientationChoices.length > 1 && orientation === 'vertical'))}</small></span>
                <ReserveSizeIcon area={row.area} />
                <span className={`rsv-pill ${row.available === false ? 'muted' : row.included && !row.price ? 'green' : 'blue'}`}>{tr(row.available === false ? 'Indisponible' : reservePriceTag(row.price, row.included))}</span>
              </button>
            );
          })}
        </div>
      </section>

      {placements.length > 1 && (
      <section className="rsv-section">
        <header><h3>{tr('Emplacement')}</h3><span className="rsv-section-value">{tr(PLACEMENT_LABELS[currentPlacement] || '')}</span></header>
        <div className="rsv-placement-grid">
          {placements.map((placement) => {
            const active = placement.placement === currentPlacement;
            return (
              <button
                key={placement.type}
                type="button"
                className={`rsv-placement-card${active ? ' active' : ''}${placement.available ? '' : ' unavailable'}`}
                disabled={readOnly || !placement.available}
                onClick={() => onPlacement(placement)}
                onMouseEnter={() => !active && placement.available && onPreview(previewFor({ placement: placement.placement }, `Aperçu · ${(PLACEMENT_LABELS[placement.placement] || '').toLowerCase()}`))}
                onMouseLeave={() => onPreview(null)}
                title={placement.available ? '' : tr(placement.reason)}
              >
                {active && <span className="rsv-check"><Check size={11} /></span>}
                <PlacementThumb placement={placement.placement} orientation={active ? orientation : 'horizontal'} />
                <strong>{tr(PLACEMENT_LABELS[placement.placement] || placement.label)}</strong>
                {!placement.available && <small>{tr(placement.reason)}</small>}
              </button>
            );
          })}
        </div>
      </section>
      )}

      {orientationChoices.length > 1 && (
        <section className="rsv-section">
          <header><h3>{tr('Orientation')}</h3><span className="rsv-section-value">{tr(orientationLabel(orientation, orientationCorner))}</span></header>
          <div className="rsv-orientation-grid">
            {orientationChoices.map((choice) => {
              const active = choice.orientation === orientation;
              return (
                <button
                  key={choice.orientation}
                  type="button"
                  className={`rsv-placement-card rsv-orientation-card${active ? ' active' : ''}${choice.available ? '' : ' unavailable'}`}
                  disabled={readOnly || !choice.available}
                  onClick={() => onOrientation?.(choice.orientation)}
                  onMouseEnter={() => !active && choice.available && onPreview(previewFor({ orientation: choice.orientation }, `Aperçu · ${orientationLabel(choice.orientation, orientationCorner).toLowerCase()}`))}
                  onMouseLeave={() => onPreview(null)}
                  title={choice.available ? '' : tr(choice.reason)}
                >
                  {active && <span className="rsv-check"><Check size={11} /></span>}
                  <PlacementThumb placement={orientationCorner} orientation={choice.orientation} />
                  <strong>{tr(orientationLabel(choice.orientation, orientationCorner))}</strong>
                  <small>{tr(choice.available ? (choice.orientation === 'vertical' ? 'Dans la profondeur du stand' : 'Dans la largeur du stand') : choice.reason)}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {customOpen ? (
        <CustomReserveForm tr={tr} disabled={readOnly} onCancel={() => setCustomOpen(false)} onSubmit={async (payload) => { await onCustomRequest?.(payload); setCustomOpen(false); }} />
      ) : (
        <button type="button" className="rsv-custom-row" disabled={readOnly} onClick={() => setCustomOpen(true)}>
          <Ruler size={14} /><span>{tr('Une autre dimension ?')}</span><strong>{tr('Sur mesure, sur devis')}</strong><ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}

function DoorStep({ tr, readOnly, doorState, slotsBySide, sideSlots, slotIndex, distance, handleChoices, blockers = [], onArrange, onSide, onSlotIndex, onOpening, onHandle }) {
  const sides = ['front', 'left', 'right', 'back'].filter((side) => (slotsBySide[side] || []).length);
  const positionLabels = sideSlots.length === 3 ? ['À gauche', 'Centrée', 'À droite'] : sideSlots.length === 2 ? ['À gauche', 'À droite'] : [];
  return (
    <div className="rsv-step-body">
      <section className="rsv-section">
        <header><h3>{tr('Mur de la porte')}</h3><span className="rsv-section-value">{tr(SIDE_LABELS[doorState.side])}</span></header>
        <div className="rsv-segmented-cards">
          {sides.map((side) => (
            <button key={side} type="button" className={doorState.side === side ? 'active' : ''} disabled={readOnly || doorState.side === side} onClick={() => onSide(side)}>
              <DoorWallIcon side={side} /> {tr(SIDE_LABELS[side])}
            </button>
          ))}
        </div>
      </section>

      {sideSlots.length > 1 && (
        <section className="rsv-section">
          <header><h3>{tr('Position sur le mur')}</h3><span className="rsv-section-value">{tr(`à ${formatReserveCm(distance)} cm du coin gauche`)}</span></header>
          <div className="rsv-slider-row">
            <input
              type="range"
              min={0}
              max={sideSlots.length - 1}
              step={1}
              value={Math.max(0, slotIndex)}
              disabled={readOnly}
              onChange={(event) => onSlotIndex(Number(event.target.value))}
              style={{ '--rsv-range': `${(Math.max(0, slotIndex) / Math.max(1, sideSlots.length - 1)) * 100}%` }}
              aria-label={tr('Position de la porte')}
            />
            <span className="rsv-slider-value">{formatReserveCm(distance)} <em>cm</em></span>
          </div>
          {positionLabels.length > 0 && (
            <div className="rsv-chips">
              {positionLabels.map((label, index) => (
                <button key={label} type="button" className={slotIndex === index ? 'active' : ''} disabled={readOnly} onClick={() => onSlotIndex(index)}>{tr(label)}</button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="rsv-section">
        <header><h3>{tr('Ouverture')}</h3><span className="rsv-section-value">{tr(doorState.opening === 'pull' ? 'Vers l’extérieur' : 'Vers l’intérieur')}</span></header>
        <div className="rsv-choice-grid">
          {[{ id: 'push', label: 'Vers l’intérieur', detail: 'Poussante' }, { id: 'pull', label: 'Vers l’extérieur', detail: 'Tirante' }].map((choice) => (
            <button key={choice.id} type="button" className={`rsv-choice-card${doorState.opening === choice.id ? ' active' : ''}`} disabled={readOnly} onClick={() => onOpening(choice.id)}>
              {doorState.opening === choice.id && <span className="rsv-check"><Check size={11} /></span>}
              <OpeningIcon inward={choice.id === 'push'} />
              <span><strong>{tr(choice.label)}</strong><small>{tr(choice.detail)}</small></span>
            </button>
          ))}
        </div>
        {blockers.length > 0 && (
          <div className="rsv-notice compact" role="status">
            <AlertTriangle size={15} />
            <div>
              <strong>{tr(`${blockers.map((blocker) => blocker.label).join(', ')} ${blockers.length > 1 ? 'bloquent' : 'bloque'} l’ouverture`)}</strong>
              <span className="rsv-notice-actions">
                <button type="button" className="rsv-link" onClick={() => onArrange?.(blockers[0].key)}>{tr('Réorganiser la réserve')}</button>
                <span>{tr('ou ouvrez la porte vers l’extérieur.')}</span>
              </span>
            </div>
          </div>
        )}
        <p className={`rsv-inline-note ${doorState.opening === 'push' ? 'warning' : ''}`}>
          <Info size={13} /> {tr(doorState.opening === 'push'
            ? `La zone bleue (${Math.round(RESERVE_DOOR_LEAF * 100)} cm) doit rester libre : aucun objet ne peut y être posé.`
            : 'La porte s’ouvre côté stand : gardez le passage libre devant la réserve.')}
        </p>
      </section>

      <section className="rsv-section">
        <header><h3>{tr('Poignée')}</h3><span className="rsv-section-value">{tr(doorState.handle === 'left' ? 'À gauche' : 'À droite')}</span></header>
        <div className="rsv-choice-grid">
          {[{ id: 'left', label: 'À gauche', detail: 'Charnières à droite' }, { id: 'right', label: 'À droite', detail: 'Charnières à gauche' }].map((choice) => {
            const available = handleChoices.includes(choice.id);
            return (
              <button key={choice.id} type="button" className={`rsv-choice-card${doorState.handle === choice.id ? ' active' : ''}`} disabled={readOnly || !available} onClick={() => onHandle(choice.id)} title={available ? '' : tr('Non disponible pour ce modèle de porte')}>
                {doorState.handle === choice.id && <span className="rsv-check"><Check size={11} /></span>}
                <HandleIcon side={choice.id} />
                <span><strong>{tr(choice.label)}</strong><small>{tr(available ? choice.detail : 'Non disponible')}</small></span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function LayoutStep({
  tr, readOnly, tab, setTab, categories, category, setCategory, search, setSearch, entries, fitsByKey, contents, builtins, removedBuiltins,
  pricing, issuesByKey, selectedKey, selectedContent, selectedBuiltin, interior, freeRatio, hasPower, missingPower, powerEntry,
  onSelect, onAdd, onDragStart, onDragEnd, onRemove, onDuplicate, onRotate, onRestoreBuiltin, onPosition, onRotation,
}) {
  const totalCount = contents.length;
  const priceFor = (key) => pricing.lines.find((line) => line.key === key) || { price: 0, included: true };
  return (
    <div className="rsv-step-body">
      <div className="rsv-subtabs" style={{ '--rsv-sub': tab === 'catalog' ? 0 : 1 }}>
        <span className="rsv-subtabs-indicator" aria-hidden="true" />
        <button type="button" className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>{tr('Catalogue')}</button>
        <button type="button" className={tab === 'inside' ? 'active' : ''} onClick={() => setTab('inside')}>{tr('Dans la réserve')} <em>{totalCount + builtins.length}</em></button>
      </div>

      {tab === 'catalog' ? (
        <>
          <label className="rsv-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('Rechercher un objet…')} /></label>
          <div className="rsv-chips">
            {categories.map((id) => <button key={id} type="button" className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{tr(CATEGORY_LABELS[id])}</button>)}
          </div>
          <p className="rsv-info-box"><Info size={14} /> {tr('Glissez un objet sur le plan, ou cliquez sur + pour le placer automatiquement à un endroit libre.')}</p>
          <div className="rsv-catalog-grid">
            {entries.map((entry, index) => {
              const fits = fitsByKey[entry.key] !== false;
              return (
                <article
                  key={entry.key}
                  className={`rsv-catalog-card${fits ? '' : ' no-room'}`}
                  style={{ '--rsv-index': Math.min(index, 12) }}
                  draggable={!readOnly && fits}
                  title={fits ? undefined : tr('Plus de place libre : déplacez ou retirez un objet, ou faites ouvrir la porte vers l’extérieur.')}
                  onDragStart={(event) => { event.dataTransfer.setData('text/plain', entry.key); event.dataTransfer.effectAllowed = 'copy'; onDragStart(entry); }}
                  onDragEnd={onDragEnd}
                >
                  {entry.mount === 'wall' && <span className="rsv-catalog-tag">{tr('Mural')}</span>}
                  <div className="rsv-catalog-thumb"><ContentThumb content={entry} /></div>
                  <strong title={entry.groupLabel ? `${entry.groupLabel} · ${entry.label}` : entry.label}>{tr(entry.label)}</strong>
                  <small>{entry.groupLabel ? `${tr(entry.groupLabel)} · ` : ''}{contentSizeLabel(entry.size)}</small>
                  <footer>
                    <span className={entry.price > 0 ? 'price' : 'price included'}>{tr(fits ? reservePriceTag(entry.price) : 'Plus de place')}</span>
                    <button type="button" disabled={readOnly || !fits} onClick={() => onAdd(entry)} aria-label={`${tr('Ajouter')} ${entry.label}`}><Plus size={15} /></button>
                  </footer>
                </article>
              );
            })}
            {!entries.length && <p className="rsv-empty-note">{tr('Aucun objet ne correspond à votre recherche.')}</p>}
          </div>
        </>
      ) : (
        <>
          {selectedContent && (
            <SelectedContentCard
              tr={tr}
              readOnly={readOnly}
              content={selectedContent}
              interior={interior}
              price={priceFor(selectedContent.key)}
              issues={issuesByKey[selectedContent.key] || []}
              onRemove={() => onRemove(selectedContent.key)}
              onDuplicate={() => onDuplicate(selectedContent.key)}
              onPosition={(axis, value) => onPosition(selectedContent.key, axis, value)}
              onRotation={(rotation) => onRotation(selectedContent.key, rotation)}
            />
          )}
          {selectedBuiltin && (
            <div className="rsv-selected-card builtin">
              <header>
                <div className="rsv-selected-thumb"><Package size={22} /></div>
                <div><strong>{tr(selectedBuiltin.label)}</strong><small>{tr('Fourni avec la réserve')}</small></div>
                <span className="rsv-pill green">{tr('Inclus')}</span>
              </header>
              {!readOnly && (
                <div className="rsv-selected-actions">
                  <button type="button" className="rsv-secondary-button" onClick={onRotate} disabled={isWallBuiltin(selectedBuiltin)}><RotateCw size={14} /> {tr('Pivoter')}</button>
                  <button type="button" className="rsv-danger-outline" onClick={() => onRemove(`builtin:${selectedBuiltin.id}`)}><Trash2 size={14} /> {tr('Retirer')}</button>
                </div>
              )}
            </div>
          )}

          {missingPower.length > 0 && !hasPower && (
            <div className="rsv-power-alert">
              <Zap size={18} />
              <div>
                <strong>{tr(`${missingPower[0].label} a besoin d’une prise`)}</strong>
                <span>{tr('Ajoutez-la maintenant pour éviter un oubli.')}</span>
              </div>
              {powerEntry && <button type="button" disabled={readOnly} onClick={() => onAdd(powerEntry)}>{tr(reservePriceTag(powerEntry.price))}</button>}
            </div>
          )}

          <p className="rsv-list-caption">{tr(`${plural(totalCount, 'objet')} · surface libre ${Math.round(freeRatio * 100)} %`)}</p>
          <ul className="rsv-content-list">
            {contents.map((content) => {
              const price = priceFor(content.key);
              const issues = issuesByKey[content.key] || [];
              return (
                <li key={content.key} className={`${selectedKey === content.key ? 'active' : ''}${issues.length ? ' has-issue' : ''}`}>
                  <button type="button" className="rsv-content-main" onClick={() => onSelect(content.key)}>
                    <span className="rsv-content-thumb"><ContentThumb content={content} /></span>
                    <span className="rsv-content-copy">
                      <strong>{tr(content.label)} {content.needsPower && !hasPower && <em className="rsv-pill amber"><Zap size={9} /> {tr('Prise requise')}</em>}</strong>
                      <small>{issues.length ? tr(ISSUE_LABELS[issues[0]]) : contentSizeLabel(content.size)}</small>
                    </span>
                    <span className={price.included ? 'rsv-content-price included' : 'rsv-content-price'}>{tr(reservePriceTag(price.price, price.included))}</span>
                  </button>
                  <button type="button" className="rsv-icon-button" onClick={() => onSelect(content.key)} aria-label={tr('Localiser')}><Eye size={14} /></button>
                  {!readOnly && <button type="button" className="rsv-icon-button danger" onClick={() => onRemove(content.key)} aria-label={tr('Supprimer')}><Trash2 size={14} /></button>}
                </li>
              );
            })}
            {builtins.map((child) => (
              <li key={child.id} className={`builtin${selectedKey === `builtin:${child.id}` ? ' active' : ''}`}>
                <button type="button" className="rsv-content-main" onClick={() => onSelect(`builtin:${child.id}`)}>
                  <span className="rsv-content-thumb"><Package size={16} /></span>
                  <span className="rsv-content-copy"><strong>{tr(child.label)}</strong><small>{tr('Fourni avec la réserve')}</small></span>
                  <span className="rsv-content-price included">{tr('Inclus')}</span>
                </button>
                {!readOnly && <button type="button" className="rsv-icon-button danger" onClick={() => onRemove(`builtin:${child.id}`)} aria-label={tr('Retirer')}><Trash2 size={14} /></button>}
              </li>
            ))}
            {removedBuiltins.map((child) => (
              <li key={`removed-${child.id}`} className="removed">
                <span className="rsv-content-main static">
                  <span className="rsv-content-thumb"><Package size={16} /></span>
                  <span className="rsv-content-copy"><strong>{tr(child.label)}</strong><small>{tr('Retiré de la réserve')}</small></span>
                </span>
                {!readOnly && <button type="button" className="rsv-link" onClick={() => onRestoreBuiltin(child.id)}>{tr('Remettre')}</button>}
              </li>
            ))}
          </ul>
          {!contents.length && !builtins.length && (
            <div className="rsv-empty-state">
              <Package size={26} />
              <strong>{tr('Réserve vide')}</strong>
              <span>{tr('Ajoutez des étagères, un réfrigérateur ou une poubelle depuis le catalogue.')}</span>
              <button type="button" className="rsv-outline-button" onClick={() => setTab('catalog')}>{tr('Voir le catalogue')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SelectedContentCard({ tr, readOnly, content, interior, price, issues, onRemove, onDuplicate, onPosition, onRotation }) {
  const box = interior ? contentFootprint(content, interior) : null;
  const x = box ? Math.round((box.minX - interior.minX) * 100) : 0;
  const z = box ? Math.round((box.minZ - interior.minZ) * 100) : 0;
  const [fields, setFields] = useState({ x: String(x), z: String(z) });
  useEffect(() => { setFields({ x: String(x), z: String(z) }); }, [x, z, content.key]);
  const commitField = (axis) => {
    const value = Number(String(fields[axis]).replace(',', '.'));
    if (Number.isFinite(value) && value !== (axis === 'x' ? x : z)) onPosition(axis, value);
    else setFields({ x: String(x), z: String(z) });
  };
  const rotation = ((Number(content.rotation || 0) % 360) + 360) % 360;
  return (
    <div className={`rsv-selected-card${issues.length ? ' has-issue' : ''}`}>
      <header>
        <div className="rsv-selected-thumb"><ContentThumb content={content} /></div>
        <div><strong>{tr(content.label)}</strong><small>{content.detail ? `${tr(content.detail)} · ` : ''}{contentSizeLabel(content.size)}{content.mount === 'wall' ? ` · ${tr('mural')}` : ''}</small></div>
        <span className={`rsv-pill ${price.included ? 'green' : 'blue'}`}>{tr(reservePriceTag(price.price, price.included))}</span>
      </header>
      {issues.length > 0 && <p className="rsv-inline-note warning"><AlertTriangle size={13} /> {tr(ISSUE_LABELS[issues[0]])}</p>}
      <div className="rsv-selected-fields">
        <label><span>{tr('Position X')}</span><input value={fields.x} disabled={readOnly} onChange={(event) => setFields((current) => ({ ...current, x: event.target.value }))} onBlur={() => commitField('x')} onKeyDown={(event) => { if (event.key === 'Enter') commitField('x'); }} inputMode="numeric" /><em>cm</em></label>
        <label><span>{tr('Position Y')}</span><input value={fields.z} disabled={readOnly} onChange={(event) => setFields((current) => ({ ...current, z: event.target.value }))} onBlur={() => commitField('z')} onKeyDown={(event) => { if (event.key === 'Enter') commitField('z'); }} inputMode="numeric" /><em>cm</em></label>
        <div className="rsv-rotation-field">
          <span>{tr('Rotation')}</span>
          <div className="rsv-segmented small">
            {(content.mount === 'wall' ? [rotation] : [0, 90]).map((value) => (
              <button key={value} type="button" disabled={readOnly || content.mount === 'wall'} className={(content.mount === 'wall' || rotation % 180 === value % 180) ? 'active' : ''} onClick={() => onRotation(value)}>{value}°</button>
            ))}
          </div>
        </div>
      </div>
      {!readOnly && (
        <div className="rsv-selected-actions">
          <button type="button" className="rsv-secondary-button" onClick={onDuplicate}><Copy size={14} /> {tr('Dupliquer')}</button>
          <button type="button" className="rsv-danger-outline" onClick={onRemove}><Trash2 size={14} /> {tr('Supprimer')}</button>
        </div>
      )}
    </div>
  );
}
