import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';

const orbitAxis = new Vector3(0, 1, 0);
const introAngle = Math.PI * 16 / 180;
const introDuration = 1050;
// A delayed frame should not skip most of the animation.
const motionStep = (delta) => Math.min(delta * 1000, 100);

export function SceneFirstFrame({ onReady }) {
  const cancel = useRef(null);
  useLayoutEffect(() => () => {
    cancel.current?.();
    cancel.current = null;
  }, []);

  useFrame(({ gl }) => {
    if (cancel.current) return;
    cancel.current = afterSceneRender(gl.getContext(), () => onReady(true));
  });
  return null;
}

function afterSceneRender(context, onReady) {
  let cancelled = false;
  let fence = null;
  let frameId;

  // Fiber renders after its frame callbacks. Let the GPU finish that hidden
  // render (including texture uploads and shadows) without blocking the UI.
  queueMicrotask(() => {
    if (cancelled) return;
    fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      onReady();
      return;
    }
    context.flush();
    const deadline = performance.now() + 4000;
    const check = () => {
      if (context.clientWaitSync(fence, 0, 0) === context.TIMEOUT_EXPIRED && performance.now() < deadline) {
        frameId = requestAnimationFrame(check);
        return;
      }
      context.deleteSync(fence);
      fence = null;
      onReady();
    };
    frameId = requestAnimationFrame(check);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frameId);
    if (fence) context.deleteSync(fence);
  };
}

export function SceneOpeningOrbit({ controlsRef, ready }) {
  const canvas = useThree((state) => state.gl.domElement);
  const motion = useRef(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const stop = () => { done.current = true; };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) stop();
    controls?.addEventListener('start', stop);
    canvas.addEventListener('pointerdown', stop, { capture: true, passive: true });
    canvas.addEventListener('wheel', stop, { capture: true, passive: true });
    return () => {
      controls?.removeEventListener('start', stop);
      canvas.removeEventListener('pointerdown', stop, true);
      canvas.removeEventListener('wheel', stop, true);
    };
  }, [canvas, controlsRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (done.current || !ready || !controls?.enabled) return;
    const camera = controls.object;
    if (!motion.current) motion.current = { elapsed: 0, offset: camera.position.clone().sub(controls.target) };
    else motion.current.elapsed += motionStep(delta);

    // Orbit the existing target without changing zoom, elevation or stand coordinates.
    const progress = Math.min(1, motion.current.elapsed / introDuration);
    const ease = progress * progress * (3 - 2 * progress);
    camera.position.copy(motion.current.offset).applyAxisAngle(orbitAxis, introAngle * (1 - ease)).add(controls.target);
    controls.update();
    if (progress === 1) done.current = true;
  });
  return null;
}

export function useSceneDepartures(items, canAnimate) {
  const previous = useRef(items);
  const [departures, setDepartures] = useState([]);

  useLayoutEffect(() => {
    const oldItems = previous.current;
    previous.current = items;
    if (oldItems === items || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ids = new Set(items.map((item) => item.id));
    const removed = oldItems.filter((item) => !ids.has(item.id) && canAnimate(item));
    setDepartures((current) => {
      if (!removed.length && !current.some((item) => ids.has(item.id))) return current;
      return [...current.filter((item) => !ids.has(item.id)), ...removed];
    });
  }, [items, canAnimate]);

  const finishDeparture = useCallback((id) => setDepartures((current) => current.filter((item) => item.id !== id)), []);
  return { departures, finishDeparture };
}

export default function SceneAssembly({ children, phase = 'item', delay = 0, ready = true, immediate = false, onComplete }) {
  const group = useRef(null);
  const motion = useRef(null);

  useLayoutEffect(() => {
    if (!ready || motion.current || !group.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    motion.current = {
      elapsed: -delay,
      duration: phase === 'departure' ? 270 : phase === 'walls' ? 430 : 490,
      done: reduced,
    };
    if (!reduced) applyPose(group.current, phase, 0);
    else onComplete?.();
  }, [delay, phase, ready, onComplete]);

  useFrame((_, delta) => {
    if (!group.current || !motion.current || motion.current.done) return;
    motion.current.elapsed += motionStep(delta);
    const { elapsed, duration } = motion.current;
    const progress = immediate ? 1 : Math.max(0, Math.min(1, elapsed / duration));
    applyPose(group.current, phase, progress);
    if (progress === 1) {
      motion.current.done = true;
      onComplete?.();
    }
  });

  return <group ref={group} userData={{ assemblyPhase: phase }}>{children}</group>;
}

function applyPose(object, phase, progress) {
  if (phase === 'departure') {
    const lift = progress * progress;
    const anchor = object.children[0]?.position;
    // Offset the wrapper so the model shrinks around its own position.
    if (anchor) object.position.copy(anchor).multiplyScalar(lift);
    else object.position.set(0, 0, 0);
    object.position.y += .35 * lift;
    object.scale.setScalar(1 - lift);
    object.visible = progress < 1;
    return;
  }
  const eased = 1 - (1 - progress) ** 3;
  object.visible = phase === 'floor' || progress > 0;
  if (phase === 'walls') object.scale.y = .03 + .97 * eased;
  else if (phase === 'floor') object.position.y = .09 * (1 - eased);
  else {
    object.position.y = .55 * (1 - eased);
    object.scale.setScalar(.9 + .1 * eased);
  }
}
