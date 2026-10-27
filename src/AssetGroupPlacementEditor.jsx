import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Box3, Box3Helper, MOUSE, Plane, TOUCH, Vector3 } from 'three';
import { groupDragPosition, groupMillimeter, groupNudge, groupPlacementBounds, groupStructuralAsset } from './groupPlacement.js';

function PlacementCamera({ items, view, fitRevision, controls, actions }) {
  const { camera, size, scene, invalidate } = useThree();
  const latestItems = useRef(items);
  latestItems.current = items;
  useEffect(() => {
    const fit = (uid = null) => {
      const box = new Box3();
      scene.children.filter(child => child.name === 'group-placement-model' && (!uid || child.userData.uid === uid)).forEach(child => box.union(new Box3().setFromObject(child)));
      const fallback = groupPlacementBounds(latestItems.current);
      const center = box.isEmpty() ? new Vector3((fallback.minX + fallback.maxX) / 2, 0, (fallback.minZ + fallback.maxZ) / 2) : box.getCenter(new Vector3());
      const extent = box.isEmpty() ? new Vector3(fallback.maxX - fallback.minX, 2.5, fallback.maxZ - fallback.minZ) : box.getSize(new Vector3());
      const top = view === 'top';
      const minimum = uid ? .15 : 2;
      const span = Math.max(2, extent.x, extent.z, top ? 0 : extent.y);
      camera.up.set(0, top ? 0 : 1, top ? -1 : 0);
      camera.position.copy(center).add(top ? new Vector3(0, 30, 0) : new Vector3(span * 1.5, span * 2, span * 1.5));
      camera.zoom = Math.min(10000, size.width / (Math.max(minimum, extent.x) * (top ? 1.4 : 2)), size.height / (Math.max(minimum, extent.z, top ? 0 : extent.y) * (top ? 1.4 : 2)));
      camera.lookAt(center); camera.updateProjectionMatrix();
      if (controls.current) { controls.current.target.copy(center); controls.current.update(); }
      invalidate();
    };
    actions.current = { fit, focus: uid => fit(uid), zoom: factor => { camera.zoom = Math.max(5, Math.min(10000, camera.zoom * factor)); camera.updateProjectionMatrix(); invalidate(); } };
    fit();
    return () => { actions.current = null; };
  }, [camera, controls, actions, invalidate, scene, size.width, size.height, view, fitRevision]);
  return null;
}

function SelectionOutline({ objectRef, selected, item }) {
  const { scene, invalidate } = useThree();
  const currentHelper = useRef(null);
  useFrame(() => {
    if (currentHelper.current && objectRef.current) currentHelper.current.box.setFromObject(objectRef.current);
  });
  useEffect(() => {
    if (!selected || !objectRef.current) return;
    const box = new Box3().setFromObject(objectRef.current);
    const helper = new Box3Helper(box, '#315fa2');
    currentHelper.current = helper;
    helper.material.depthTest = false; helper.renderOrder = 100;
    scene.add(helper); invalidate();
    return () => { currentHelper.current = null; scene.remove(helper); helper.geometry.dispose(); helper.material.dispose(); invalidate(); };
  }, [scene, selected, objectRef, item, invalidate]);
  return null;
}

function PlacementControls({ view, controls }) {
  const { camera } = useThree();
  // OrbitControls captures the up vector in its constructor.
  camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
  return <OrbitControls key={view} ref={controls} makeDefault enableRotate={view !== 'top'} minPolarAngle={0} maxPolarAngle={Math.PI / 2} minZoom={5} maxZoom={10000} screenSpacePanning enableDamping={false} mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.PAN, RIGHT: view === 'top' ? MOUSE.PAN : MOUSE.ROTATE }} touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }} />;
}

function PlacementModel({ item, selected, Model, onDown, onMove, onUp }) {
  const object = useRef(null);
  return <Suspense fallback={<Html position={[Number(item.x || 0), 0, Number(item.z || 0)]} center><span className="group-placement-loading">Chargement du modèle…</span></Html>}>
    <group ref={object} name="group-placement-model" userData={{ uid: item.uid }} position={[Number(item.x || 0), item.renderY || 0, Number(item.z || 0)]} rotation={[0, Number(item.rotation || 0) * Math.PI / 180, 0]}
      onPointerDown={event => onDown(event, item)} onPointerMove={event => onMove(event, item.uid)} onPointerUp={event => onUp(event, item.uid)}>
      <Model item={item} />
    </group>
    <SelectionOutline objectRef={object} selected={selected} item={item} />
  </Suspense>;
}

export default function AssetGroupPlacementEditor({ rows, items, selectedUid, onSelect, onMove, Model }) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState('top');
  const [free, setFree] = useState(false);
  const [fineStep, setFineStep] = useState(.06);
  const [fitRevision, setFitRevision] = useState(0);
  const viewport = useRef(null), controls = useRef(null), actions = useRef(null), drag = useRef(null);
  const editor = useRef(null);
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const row = rows.find(candidate => candidate.uid === selectedUid);
  const selected = items.find(candidate => candidate.uid === selectedUid);
  const structural = groupStructuralAsset(selected);
  const step = structural && !free ? 1 : .001;
  const endDrag = () => { drag.current = null; if (controls.current) controls.current.enabled = true; };
  useEffect(() => {
    window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag); window.addEventListener('blur', endDrag);
    return () => { window.removeEventListener('pointerup', endDrag); window.removeEventListener('pointercancel', endDrag); window.removeEventListener('blur', endDrag); };
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    viewport.current?.focus({ preventScroll: true });
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
      if (event.key === 'Tab') {
        const fields = [...editor.current.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]')];
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', escape); };
  }, [expanded]);
  const nudge = (axis, amount) => { if (row) onMove(row.uid, groupNudge(row, axis, amount)); };
  const onDown = (event, item) => {
    if (event.button !== 0) return;
    const point = event.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    onSelect(item.uid); viewport.current?.focus({ preventScroll: true });
    drag.current = { uid: item.uid, origin: { x: Number(item.x || 0), z: Number(item.z || 0) }, start: { x: point.x, z: point.z }, step: groupStructuralAsset(item) && !free ? 1 : .001 };
    if (controls.current) controls.current.enabled = false;
  };
  const onDragMove = (event, uid) => {
    if (drag.current?.uid !== uid) return;
    const point = event.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    event.stopPropagation();
    onMove(uid, groupDragPosition(drag.current.origin, drag.current.start, { x: point.x, z: point.z }, event.shiftKey ? .001 : drag.current.step));
  };
  const onUp = (event, uid) => {
    if (drag.current?.uid !== uid) return;
    event.stopPropagation();
    if (event.target.hasPointerCapture(event.pointerId)) event.target.releasePointerCapture(event.pointerId);
    endDrag();
  };
  const content = <section ref={editor} className={`group-placement-editor${expanded ? ' is-expanded' : ''}`} aria-label="Placement précis des objets" {...(expanded ? { role: 'dialog', 'aria-modal': true } : {})}>
    <header><div><strong>Assemblage de la réserve</strong><small>Modèles réels · coordonnées en mètres</small></div><button type="button" onClick={() => { endDrag(); setExpanded(value => !value); }}>{expanded ? 'Réduire' : 'Agrandir'}</button></header>
    <div className="group-placement-toolbar">
      <div role="group" aria-label="Vue du groupe">{[['top', 'Dessus'], ['perspective', '3D']].map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => { endDrag(); setView(id); }}>{label}</button>)}</div>
      <button type="button" onClick={() => setFitRevision(value => value + 1)}>Recentrer la vue</button>
      <button type="button" disabled={!selectedUid} onClick={() => actions.current?.focus(selectedUid)}>Voir la sélection</button>
      <button type="button" aria-label="Zoom avant" onClick={() => actions.current?.zoom(1.35)}>+</button><button type="button" aria-label="Zoom arrière" onClick={() => actions.current?.zoom(1 / 1.35)}>−</button>
    </div>
    <div ref={viewport} className="group-placement-viewport" tabIndex={0} role="group" aria-label="Vue réelle des objets, flèches pour ajuster la sélection" onContextMenu={event => event.preventDefault()} onLostPointerCapture={endDrag}
      onKeyDown={event => {
        const directions = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['z', -1], ArrowDown: ['z', 1] };
        if (!directions[event.key]) return;
        event.preventDefault(); const [axis, sign] = directions[event.key]; nudge(axis, sign * (event.shiftKey || !structural ? .001 : fineStep));
      }}>
      <Canvas orthographic frameloop="demand" dpr={[1, 2]} camera={{ position: [0, 30, 0], up: [0, 0, -1], zoom: 70, near: .01, far: 500 }} fallback={<p role="alert">La vue réelle nécessite WebGL. Les coordonnées précises restent disponibles.</p>}>
        <color attach="background" args={['#f4f6f9']} /><ambientLight intensity={1.6} /><directionalLight position={[5, 15, 8]} intensity={2.5} />
        <gridHelper args={[100, 1000, '#d7dfe9', '#e6ebf1']} position={[0, -.025, 0]} /><gridHelper args={[100, 100, '#8496ae', '#bbc8d9']} position={[0, -.02, 0]} />
        {items.map(item => <PlacementModel key={item.uid} item={item} selected={item.uid === selectedUid} Model={Model} onDown={onDown} onMove={onDragMove} onUp={onUp} />)}
        <PlacementControls view={view} controls={controls} />
        <PlacementCamera items={items} view={view} controls={controls} actions={actions} fitRevision={fitRevision} />
      </Canvas>
      <span className="group-placement-axes" aria-hidden="true">X → · Z ↓</span>
    </div>
    <p className="group-placement-help">Grille : 1 m · molette : zoom · clic droit : {view === 'top' ? 'déplacer la vue' : 'incliner la vue'}. Maj pendant le déplacement : précision 1 mm.</p>
    <div className="group-placement-properties">
      <label className="group-placement-selection">Objet à positionner<select aria-label="Objet à positionner" value={selectedUid || ''} onChange={event => onSelect(event.target.value)}>{rows.map((candidate, index) => <option key={candidate.uid} value={candidate.uid}>{index + 1}. {items.find(item => item.uid === candidate.uid)?.label || candidate.label || candidate.type}</option>)}</select></label>
      {row && <>
        <div className="group-placement-mode"><span>{step === 1 ? 'Cloison / porte · pas de 1 m' : 'Placement libre · précision 1 mm'}</span>{structural && <label><input type="checkbox" checked={free} onChange={event => setFree(event.target.checked)} />Placement libre</label>}</div>
        <div className="group-placement-coordinates">{[['x', 'X (m)'], ['y', 'Hauteur Y (m)'], ['z', 'Z (m)'], ['rotation', 'Rotation (°)']].map(([axis, label]) => <label key={axis}>{label}<input aria-label={label} type="number" step={axis === 'rotation' ? .1 : .001} value={row[axis] ?? (axis === 'y' ? selected?.renderY || 0 : 0)} onChange={event => onMove(row.uid, { [axis]: event.target.value })} /></label>)}</div>
        <div className="group-placement-adjustments"><label>Ajustement<select aria-label="Pas d'ajustement" value={structural ? fineStep : .001} onChange={event => setFineStep(Number(event.target.value))} disabled={!structural}><option value={.06}>6 cm</option><option value={.01}>1 cm</option><option value={.001}>1 mm</option></select></label>
          <div role="group" aria-label="Décaler l'objet">{[['x', -1, '← X'], ['x', 1, 'X →'], ['z', -1, '↑ Z'], ['z', 1, 'Z ↓']].map(([axis, sign, text]) => <button key={`${axis}${sign}`} type="button" aria-label={`Décaler ${axis.toUpperCase()} ${sign < 0 ? 'moins' : 'plus'}`} onClick={() => nudge(axis, sign * (structural ? fineStep : .001))}>{text}</button>)}</div>
          <div role="group" aria-label="Tourner l'objet"><button type="button" aria-label="Tourner de moins 90 degrés" onClick={() => onMove(row.uid, { rotation: groupMillimeter(Number(row.rotation || 0) - 90) })}>−90°</button><button type="button" aria-label="Tourner de plus 90 degrés" onClick={() => onMove(row.uid, { rotation: groupMillimeter(Number(row.rotation || 0) + 90) })}>+90°</button></div>
        </div>
        <small>Les ajustements déplacent l'objet sans modifier ses dimensions. Les positions existantes sont conservées. Pour un objet mural, une hauteur à 0 conserve sa hauteur automatique.</small>
      </>}
    </div>
  </section>;
  return expanded ? createPortal(content, document.body) : content;
}
