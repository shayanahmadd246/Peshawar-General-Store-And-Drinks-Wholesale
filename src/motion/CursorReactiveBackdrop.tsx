import React, { useEffect, useRef, useState } from 'react';

/**
 * Professional cursor-reactive backdrop: shop photo + soft light follow + restrained parallax.
 * No particles, dots, constellation lines, or continuous aurora motion.
 */
export function CursorReactiveBackdrop({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const target = useRef({ x: 0.5, y: 0.4 });
  const current = useRef({ x: 0.5, y: 0.4 });
  const [reduced, setReduced] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const sync = () => {
      setReduced(mqReduce.matches);
      setCoarse(mqCoarse.matches);
    };
    sync();
    mqReduce.addEventListener('change', sync);
    mqCoarse.addEventListener('change', sync);
    return () => {
      mqReduce.removeEventListener('change', sync);
      mqCoarse.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (reduced || coarse) return;
    const el = rootRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      target.current = {
        x: Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.min(1, Math.max(0, (e.clientY - rect.top) / Math.max(1, rect.height))),
      };
    };

    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * 0.08;
      current.current.y += (target.current.y - current.current.y) * 0.08;
      const x = current.current.x;
      const y = current.current.y;
      el.style.setProperty('--cx', `${(x * 100).toFixed(2)}%`);
      el.style.setProperty('--cy', `${(y * 100).toFixed(2)}%`);
      el.style.setProperty('--px', `${((x - 0.5) * 18).toFixed(2)}px`);
      el.style.setProperty('--py', `${((y - 0.5) * 12).toFixed(2)}px`);
      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [reduced, coarse]);

  return (
    <div
      ref={rootRef}
      className={`cursor-reactive-backdrop ${reduced || coarse ? 'is-static' : ''} ${className}`.trim()}
      aria-hidden
    >
      <div className="crb-photo" />
      <div className="crb-veil" />
      <div className="crb-cursor-light" />
      <div className="crb-depth" />
    </div>
  );
}
