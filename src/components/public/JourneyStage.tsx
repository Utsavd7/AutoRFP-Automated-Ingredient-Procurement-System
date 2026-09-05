'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './journey-stage.module.css';

const steps = ['Menu', 'Suppliers', 'Request', 'Compare', 'Decision'];

export function JourneyStage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const selected = useRef(0);
  const scrollRange = useRef({ enabled: false, top: 88, travel: 800 });
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = root.current!;
    const surface = stage.current!;
    const media = window.matchMedia('(min-width: 1000px) and (min-height: 760px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    let frame = 0;

    function updateFromScroll() {
      frame = 0;
      const range = scrollRange.current;
      if (!range.enabled) return;
      const progress = Math.max(0, Math.min(1, (range.top - element.getBoundingClientRect().top) / range.travel));
      const next = Math.round(progress * (steps.length - 1));
      if (next === selected.current) return;
      const panels = element.querySelectorAll<HTMLElement>('.story-scene');
      if (panels[selected.current]?.contains(document.activeElement)) {
        element.querySelectorAll<HTMLButtonElement>('nav button')[next]?.focus({ preventScroll: true });
      }
      element.dataset.input = 'scroll';
      selected.current = next;
      setActive(next);
    }

    function scheduleScroll() {
      if (!frame) frame = requestAnimationFrame(updateFromScroll);
    }

    function measure() {
      const top = (document.querySelector('.public-header')?.getBoundingClientRect().height ?? 76) + 12;
      const height = surface.getBoundingClientRect().height;
      const travel = Math.min(900, window.innerHeight * 0.85);
      const enabled = media.matches && height <= window.innerHeight - top - 20;
      scrollRange.current = { enabled, top, travel };
      element.style.setProperty('--stage-height', `${height}px`);
      element.style.setProperty('--stage-top', `${top}px`);
      element.style.setProperty('--scroll-travel', `${travel}px`);
      setPinned(enabled);
      scheduleScroll();
    }

    // The server renders the complete list; only an enhanced, fitting stage is pinned.
    const observer = new ResizeObserver(() => {
      setReady(true);
      measure();
    });
    observer.observe(surface);
    media.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', scheduleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', scheduleScroll);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const panels = root.current!.querySelectorAll<HTMLElement>('.story-scene');
    panels.forEach((panel, index) => {
      panel.inert = index !== active;
      if (index !== active) panel.setAttribute('aria-hidden', 'true');
      else panel.removeAttribute('aria-hidden');
    });
    return () => panels.forEach((panel) => {
      panel.inert = false;
      panel.removeAttribute('aria-hidden');
    });
  }, [active, ready]);

  function choose(index: number, keyboard: boolean) {
    const element = root.current!;
    element.dataset.input = keyboard ? 'keyboard' : 'pointer';
    selected.current = index;
    setActive(index);
    if (keyboard) element.querySelectorAll<HTMLButtonElement>('nav button')[index]?.focus({ preventScroll: true });
    const range = scrollRange.current;
    if (range.enabled) {
      const start = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: start - range.top + range.travel * index / (steps.length - 1), behavior: 'instant' });
    }
  }

  return (
    <div ref={root} className={styles.root} data-enhanced={ready} data-pinned={pinned}
      style={{ '--active-step': active } as CSSProperties}>
      <div ref={stage} className={styles.stage}>
        <nav className={styles.steps} aria-label="Buying journey steps">
          {steps.map((step, index) => (
            <button key={step} type="button" aria-current={active === index ? 'step' : undefined}
              aria-controls={`journey-step-${index + 1}`} onClick={(event) => choose(index, event.detail === 0)}
              onKeyDown={(event) => {
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? steps.length - 1
                  : event.key === 'ArrowRight' ? (index + 1) % steps.length
                    : event.key === 'ArrowLeft' ? (index + steps.length - 1) % steps.length : null;
                if (target !== null) { event.preventDefault(); choose(target, true); }
              }}>
              <span aria-hidden="true">0{index + 1}</span>{step}
            </button>
          ))}
        </nav>
        <div className={styles.viewport}>{children}</div>
        <div className={styles.footer}>
          <span>{pinned ? 'Scroll or choose a step' : 'Choose a step'} · {active + 1} / {steps.length}</span>
          <a href="#benefits">Skip journey <span aria-hidden="true">↓</span></a>
        </div>
      </div>
    </div>
  );
}
