import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './guidedTour.css';

/*
  Guided tour engine: spotlight on real interface elements, anchored coach mark with arrow,
  numbered annotations pinned on sub-elements, chapters, progress, keyboard control and resume.

  Step shape:
  {
    id, chapter, kind?: 'welcome' | 'finish' | 'step',
    title, body, tips?: string[], keys?: [[key, label]], tryIt?: string,
    target?: selector | () => Element,          // element put in the spotlight
    annotations?: [{ target, label, text }],    // numbered pins + legend
    placement?: 'auto' | 'right' | 'left' | 'top' | 'bottom',
    padding?: number, radius?: number,
    interactive?: boolean,                       // lets the user play inside the spotlight
    enter?: () => (void | () => void),           // prepares the interface (returns a cleanup)
    when?: () => boolean,                        // skipped when false
    optional?: boolean,                          // skipped when its target never shows up
  }
*/

const TARGET_TIMEOUT = 1600;
const GAP = 16;
const MARGIN = 12;

function resolveElement(target) {
  if (!target) return null;
  if (typeof target === 'function') return target() || null;
  try {
    const nodes = [...document.querySelectorAll(target)];
    return nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || null;
  } catch (_) {
    return null;
  }
}

// Visible part of an element: clipped by the viewport and by every scrolling / clipping ancestor
// (the side panel scrolls, so a tall card may be only partly on screen).
function readRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  let top = rect.top;
  let left = rect.left;
  let right = rect.right;
  let bottom = rect.bottom;
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) continue;
    const box = node.getBoundingClientRect();
    top = Math.max(top, box.top);
    left = Math.max(left, box.left);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  top = Math.max(top, 0);
  left = Math.max(left, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  if (right - left < 2 || bottom - top < 2) return null;
  return { top, left, width: right - left, height: bottom - top, right, bottom };
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// Places the coach mark next to the spotlight, on the side with the most room.
function placeBubble(spot, size, viewport, preferred = 'auto') {
  const { width: vw, height: vh } = viewport;
  const w = Math.min(size.width, vw - MARGIN * 2);
  const h = Math.min(size.height, vh - MARGIN * 2);
  if (!spot) return { left: (vw - w) / 2, top: (vh - h) / 2, side: 'center', arrow: null };
  const space = { right: vw - spot.right, left: spot.left, bottom: vh - spot.bottom, top: spot.top };
  const fits = { right: space.right >= w + GAP + MARGIN, left: space.left >= w + GAP + MARGIN, bottom: space.bottom >= h + GAP + MARGIN, top: space.top >= h + GAP + MARGIN };
  const order = preferred !== 'auto' ? [preferred, 'right', 'left', 'bottom', 'top'] : ['right', 'left', 'bottom', 'top'];
  const side = order.find((candidate) => fits[candidate]) || 'inside';
  const cx = spot.left + spot.width / 2;
  const cy = spot.top + spot.height / 2;
  let left;
  let top;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? spot.right + GAP : spot.left - GAP - w;
    top = clamp(cy - h / 2, MARGIN, vh - h - MARGIN);
    return { left, top, side, arrow: clamp(cy - top, 22, h - 22) };
  }
  if (side === 'bottom' || side === 'top') {
    top = side === 'bottom' ? spot.bottom + GAP : spot.top - GAP - h;
    left = clamp(cx - w / 2, MARGIN, vw - w - MARGIN);
    return { left, top, side, arrow: clamp(cx - left, 22, w - 22) };
  }
  // Very large targets (the 3D scene): the coach mark sits inside, in the lower-left corner.
  left = clamp(spot.left + 24, MARGIN, vw - w - MARGIN);
  top = clamp(spot.bottom - h - 24, MARGIN, vh - h - MARGIN);
  return { left, top, side: 'inside', arrow: null };
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

export function GuidedTour({
  steps = [],
  chapters = [],
  startIndex = 0,
  resumeIndex = 0,
  tr = (value) => value,
  labels = {},
  onStepChange,
  onClose,
}) {
  const t = (key, fallback) => tr(labels[key] || fallback);
  const [index, setIndex] = useState(() => clamp(startIndex, 0, Math.max(0, steps.length - 1)));
  const [direction, setDirection] = useState(1);
  const [spot, setSpot] = useState(null);
  const [pins, setPins] = useState([]);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [activePin, setActivePin] = useState(-1);
  const [bubbleSize, setBubbleSize] = useState({ width: 380, height: 280 });
  const [nudge, setNudge] = useState(0);
  const bubbleRef = useRef(null);
  const viewport = useViewport();
  const mobile = viewport.width < 720;
  const step = steps[index] || null;
  const stepTarget = step?.target;
  const kind = step?.kind || 'step';

  // Counted steps: neither the welcome / finish screens nor steps that do not apply to this stand.
  const playable = useMemo(() => steps.map((item) => item.kind !== 'welcome' && item.kind !== 'finish' && (!item.when || item.when())), [steps]);
  const playableIndexes = useMemo(() => steps.map((_, i) => i).filter((i) => playable[i]), [steps, playable]);
  const position = playableIndexes.indexOf(index);

  const go = useCallback((next, dir) => {
    setDirection(dir ?? (next >= index ? 1 : -1));
    setIndex(clamp(next, 0, steps.length - 1));
  }, [index, steps.length]);
  const next = useCallback(() => {
    if (index >= steps.length - 1) { onClose?.({ completed: true, index }); return; }
    go(index + 1, 1);
  }, [go, index, onClose, steps.length]);
  const back = useCallback(() => { if (index > 0) go(index - 1, -1); }, [go, index]);
  const close = useCallback(() => onClose?.({ completed: kind === 'finish', index }), [index, kind, onClose]);

  // Skip steps whose condition is false (in the direction of travel).
  useEffect(() => {
    if (!step) return;
    if (step.when && !step.when()) {
      const target = index + direction;
      if (target >= 0 && target < steps.length) setIndex(target);
      else onClose?.({ completed: true, index });
    }
  }, [index, step, direction, steps.length, onClose]);

  // Prepare the interface for the step, then wait for its target.
  useEffect(() => {
    if (!step || (step.when && !step.when())) return undefined;
    onStepChange?.(index);
    setReady(false);
    setMissing(false);
    setActivePin(-1);
    const cleanup = step.enter?.();
    if (!stepTarget) { setSpot(null); setReady(true); return () => { if (typeof cleanup === 'function') cleanup(); }; }
    const started = Date.now();
    let timer = 0;
    const poll = () => {
      const element = resolveElement(stepTarget);
      if (element) {
        const box = element.getBoundingClientRect();
        const visible = readRect(element);
        if (!visible || visible.height < box.height - 1 || visible.width < box.width - 1) element.scrollIntoView({ block: box.height > window.innerHeight * 0.7 ? 'start' : 'center', inline: 'nearest' });
        // Bring the first annotated element into view when the panel scroll hides it.
        const firstNote = (step.annotations || []).map((note) => resolveElement(note.target)).find(Boolean);
        if (firstNote && !readRect(firstNote)) firstNote.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setReady(true);
        return;
      }
      if (Date.now() - started > TARGET_TIMEOUT) {
        if (step.optional) { setIndex((current) => clamp(current + (direction || 1), 0, steps.length - 1)); return; }
        setMissing(true);
        setSpot(null);
        setReady(true);
        return;
      }
      timer = window.setTimeout(poll, 80);
    };
    timer = window.setTimeout(poll, step.enterDelay ?? 60);
    return () => {
      window.clearTimeout(timer);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the target while the layout moves (accordions, scroll, resize, 3D toolbar).
  useEffect(() => {
    if (!ready || !step) return undefined;
    let frame = 0;
    let last = 0;
    const tick = (time) => {
      if (time - last > 60) {
        last = time;
        const element = missing ? null : resolveElement(stepTarget);
        const rect = readRect(element);
        const pad = step.padding ?? 8;
        const nextSpot = rect ? {
          top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          right: rect.right + pad, bottom: rect.bottom + pad,
        } : null;
        setSpot((current) => (sameRect(current, nextSpot) ? current : nextSpot));
        const nextPins = (step.annotations || []).map((note) => readRect(resolveElement(note.target)));
        setPins((current) => (current.length === nextPins.length && current.every((pin, i) => sameRect(pin, nextPins[i])) ? current : nextPins));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, step, stepTarget, missing]);

  useLayoutEffect(() => {
    const node = bubbleRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setBubbleSize((current) => (Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1 ? current : { width: rect.width, height: rect.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [index, ready]);

  // Keyboard: ← → Entrée Échap, focus kept on the coach mark.
  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowRight' || (event.key === 'Enter' && event.target === document.body)) { event.preventDefault(); next(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [back, close, next]);
  useEffect(() => {
    if (!ready) return;
    const node = bubbleRef.current?.querySelector('[data-autofocus]') || bubbleRef.current;
    node?.focus({ preventScroll: true });
  }, [index, ready]);

  if (!step) return null;
  const isModal = kind === 'welcome' || kind === 'finish' || !stepTarget || missing;
  const placement = isModal || mobile ? null : placeBubble(spot, bubbleSize, viewport, step.placement);
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === step.chapter);
  const chapter = chapters[chapterIndex] || null;
  const blocked = (event) => { event.preventDefault(); event.stopPropagation(); setNudge((value) => value + 1); };
  const spotStyle = spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height, borderRadius: step.radius ?? 14 } : null;

  const progress = (
    <div className="gt-progress" aria-hidden="true">
      {chapters.map((item) => {
        const indexes = playableIndexes.filter((i) => steps[i].chapter === item.id);
        if (!indexes.length) return null;
        const done = indexes.filter((i) => i < index).length + (indexes.includes(index) ? 1 : 0);
        return (
          <span key={item.id} className="gt-progress-seg" style={{ flex: indexes.length }} title={tr(item.label)}>
            <i style={{ width: `${(done / indexes.length) * 100}%` }} />
          </span>
        );
      })}
    </div>
  );

  const bubbleClass = [
    'gt-bubble',
    isModal ? 'gt-modal' : '',
    mobile && !isModal ? 'gt-sheet' : '',
    placement ? `gt-side-${placement.side}` : '',
    `gt-kind-${kind}`,
  ].filter(Boolean).join(' ');
  const bubbleStyle = placement ? { left: placement.left, top: placement.top } : undefined;

  const content = (() => {
    if (kind === 'welcome') {
      return (
        <>
          {step.visual && <div className="gt-visual">{step.visual}</div>}
          <div className="gt-body">
            <span className="gt-eyebrow">{tr(step.eyebrow || t('welcome', 'Visite guidée'))}</span>
            <h2 id="gt-title">{tr(step.title)}</h2>
            <p>{tr(step.body)}</p>
            <ol className="gt-chapters">
              {chapters.map((item, i) => {
                const first = steps.findIndex((s, si) => playable[si] && s.chapter === item.id);
                if (first < 0) return null;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => go(first, 1)}>
                      <span className="gt-chapter-num">{i + 1}</span>
                      <span><b>{tr(item.label)}</b>{item.detail && <small>{tr(item.detail)}</small>}</span>
                      <em>{(labels.stepsCount || ((n) => `${n} étapes`))(playableIndexes.filter((pi) => steps[pi].chapter === item.id).length)}</em>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <footer className="gt-foot">
            <button type="button" className="gt-link" onClick={close}>{t('later', 'Plus tard')}</button>
            <div className="gt-foot-actions">
              {resumeIndex > 0 && playable[resumeIndex] && (
                <button type="button" className="gt-secondary" onClick={() => go(resumeIndex, 1)}>{(labels.resume || ((n) => `Reprendre à l’étape ${n}`))(playableIndexes.indexOf(resumeIndex) + 1)}</button>
              )}
              <button type="button" className="gt-primary" data-autofocus onClick={next}>{t('start', 'Commencer la visite')} <span aria-hidden="true">→</span></button>
            </div>
          </footer>
        </>
      );
    }
    if (kind === 'finish') {
      return (
        <>
          <div className="gt-finish-badge" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          </div>
          <div className="gt-body gt-center">
            <span className="gt-eyebrow">{tr(step.eyebrow || 'Visite terminée')}</span>
            <h2 id="gt-title">{tr(step.title)}</h2>
            <p>{tr(step.body)}</p>
            {step.checklist?.length > 0 && (
              <ul className="gt-checklist">
                {step.checklist.map((item) => <li key={item}>{tr(item)}</li>)}
              </ul>
            )}
            {step.note && <p className="gt-note">{tr(step.note)}</p>}
          </div>
          <footer className="gt-foot">
            <button type="button" className="gt-link" onClick={() => go(0, -1)}>{t('restart', 'Revoir depuis le début')}</button>
            <button type="button" className="gt-primary" data-autofocus onClick={() => onClose?.({ completed: true, index })}>{tr(step.cta || t('finish', 'Terminer'))}</button>
          </footer>
        </>
      );
    }
    return (
      <>
        <header className="gt-head">
          <span className="gt-chapter">{chapter && <><b>{chapterIndex + 1}</b>{tr(chapter.label)}</>}</span>
          <span className="gt-count">{position + 1} / {playableIndexes.length}</span>
          <button type="button" className="gt-close" onClick={close} aria-label={t('close', 'Fermer le tutoriel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        {progress}
        <div className="gt-body" aria-live="polite">
          <h2 id="gt-title">{tr(step.title)}</h2>
          {step.body && <p>{tr(step.body)}</p>}
          {missing && step.missingText && <p className="gt-missing">{tr(step.missingText)}</p>}
          {step.annotations?.length > 0 && (
            <ol className="gt-legend">
              {step.annotations.map((note, i) => (
                <li
                  key={note.label}
                  className={`${activePin === i ? 'active' : ''}${pins[i] ? '' : ' off'}`}
                  onMouseEnter={() => setActivePin(i)}
                  onMouseLeave={() => setActivePin(-1)}
                  onFocus={() => setActivePin(i)}
                  onBlur={() => setActivePin(-1)}
                  tabIndex={0}
                >
                  <span className="gt-pin-num">{i + 1}</span>
                  <span><b>{tr(note.label)}</b>{note.text && <small>{tr(note.text)}</small>}</span>
                </li>
              ))}
            </ol>
          )}
          {step.keys?.length > 0 && (
            <div className="gt-keys">
              {step.keys.map(([key, label]) => <span key={`${key}-${label}`}><kbd>{tr(key)}</kbd>{tr(label)}</span>)}
            </div>
          )}
          {step.tips?.length > 0 && (
            <ul className="gt-tips">
              {step.tips.map((tip) => <li key={tip}>{tr(tip)}</li>)}
            </ul>
          )}
          {step.tryIt && <p className="gt-try"><span>{t('try', 'Essayez')}</span>{tr(step.tryIt)}</p>}
        </div>
        <footer className="gt-foot">
          <button type="button" className="gt-link" onClick={close}>{t('skip', 'Passer la visite')}</button>
          <div className="gt-foot-actions">
            {position > 0 && <button type="button" className="gt-secondary" onClick={back}>{t('back', 'Retour')}</button>}
            <button type="button" className="gt-primary" data-autofocus onClick={next}>
              {tr(position === playableIndexes.length - 1 ? t('last', 'Terminer') : t('next', 'Suivant'))} <span aria-hidden="true">→</span>
            </button>
          </div>
        </footer>
      </>
    );
  })();

  return createPortal(
    <div className={`gt-root${isModal ? ' gt-is-modal' : ''}`} role="dialog" aria-modal="true" aria-label={t('dialog', 'Tutoriel configurateur')} aria-describedby="gt-title">
      {/* Click shield: everything outside the spotlight is inert during the tour. */}
      {(!step.interactive || !spot || isModal) ? (
        <div className="gt-shield" onPointerDown={blocked} onClick={blocked} />
      ) : (
        <>
          <div className="gt-shield" style={{ top: 0, left: 0, right: 0, height: Math.max(0, spot.top) }} onPointerDown={blocked} />
          <div className="gt-shield" style={{ top: spot.bottom, left: 0, right: 0, bottom: 0 }} onPointerDown={blocked} />
          <div className="gt-shield" style={{ top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height }} onPointerDown={blocked} />
          <div className="gt-shield" style={{ top: spot.top, left: spot.right, right: 0, height: spot.height }} onPointerDown={blocked} />
        </>
      )}
      {isModal || !spot ? <div className="gt-dim" /> : <div className={`gt-spot${step.interactive ? ' interactive' : ''}`} style={spotStyle} />}
      {!isModal && ready && (step.annotations || []).map((note, i) => pins[i] && (
        <React.Fragment key={note.label}>
          <span
            className={`gt-ring${activePin === i ? ' active' : ''}`}
            style={{ top: pins[i].top - 3, left: pins[i].left - 3, width: pins[i].width + 6, height: pins[i].height + 6 }}
          />
          <button
            type="button"
            className={`gt-pin${activePin === i ? ' active' : ''}`}
            style={{ top: clamp(pins[i].top - 11, 4, viewport.height - 26), left: clamp(pins[i].left + pins[i].width - 11, 4, viewport.width - 26), animationDelay: `${120 + i * 70}ms` }}
            onMouseEnter={() => setActivePin(i)}
            onMouseLeave={() => setActivePin(-1)}
            onFocus={() => setActivePin(i)}
            onBlur={() => setActivePin(-1)}
            aria-label={tr(note.label)}
          >
            {i + 1}
          </button>
        </React.Fragment>
      ))}
      <section
        ref={bubbleRef}
        key={index}
        className={`${bubbleClass}${nudge ? ' gt-nudge' : ''}${ready ? ' gt-ready' : ''}`}
        style={bubbleStyle}
        tabIndex={-1}
        onAnimationEnd={() => setNudge(0)}
      >
        {(kind === 'welcome' || kind === 'finish') && (
          <button type="button" className="gt-close gt-modal-close" onClick={close} aria-label={t('close', 'Fermer le tutoriel')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        {placement?.arrow != null && (
          <span className="gt-arrow" style={placement.side === 'left' || placement.side === 'right' ? { top: placement.arrow } : { left: placement.arrow }} />
        )}
        {content}
      </section>
    </div>,
    document.body,
  );
}
