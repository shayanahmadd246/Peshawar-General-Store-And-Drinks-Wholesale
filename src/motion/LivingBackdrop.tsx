import React, { useEffect, useRef } from 'react';
import { type AmbientIntensity, useAmbientBudget } from './useAmbientBudget';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  hue: number;
};

const PALETTES = {
  hot: { base: '#060b14', accents: [35, 28, 175] },
  cool: { base: '#070d18', accents: [175, 38, 210] },
  warm: { base: '#eef2f6', accents: [35, 25, 170] },
  soft: { base: '#eef2f6', accents: [210, 35, 180] },
  static: { base: '#0b1324', accents: [35] },
} as const;

function spawn(w: number, h: number, hues: number[]): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: 0.8 + Math.random() * 2.2,
    a: 0.25 + Math.random() * 0.55,
    hue: hues[Math.floor(Math.random() * hues.length)] || 35,
  };
}

/**
 * Layered living background: CSS aurora + canvas particles/constellations.
 * Always `pointer-events: none` so it never blocks UI.
 */
export function LivingBackdrop({
  intensity = 'commerce',
  className = '',
  reactive = false,
}: {
  intensity?: AmbientIntensity;
  className?: string;
  /** Boost glow when AI is thinking / recording */
  reactive?: boolean;
}) {
  const budget = useAmbientBudget(intensity);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999, active: false });
  const dark = intensity === 'landing' || intensity === 'chat';

  useEffect(() => {
    if (budget.paused || budget.particles <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const palette = PALETTES[budget.aurora] || PALETTES.soft;
    let particles: Particle[] = [];
    let raf = 0;
    let w = 0;
    let h = 0;
    let running = true;

    const resize = () => {
      const parent = canvas.parentElement;
      const rect = parent?.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect?.width || window.innerWidth));
      h = Math.max(1, Math.floor(rect?.height || window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, budget.dprCap);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particles.length !== budget.particles) {
        particles = Array.from({ length: budget.particles }, () => spawn(w, h, [...palette.accents]));
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!budget.mouse) return;
      const rect = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => {
      mouse.current.active = false;
    };

    resize();
    window.addEventListener('resize', resize);
    if (budget.mouse) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
    }

    const linkDist = intensity === 'landing' ? 140 : intensity === 'chat' ? 110 : 80;
    const speed = intensity === 'landing' ? 1.35 : intensity === 'chat' ? 1.1 : 0.75;
    const particleBoost = intensity === 'landing' ? 1.55 : intensity === 'chat' ? 1.25 : 1;

    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);

      const mx = mouse.current.active ? mouse.current.x : w * 0.55;
      const my = mouse.current.active ? mouse.current.y : h * 0.4;
      const pull = mouse.current.active ? 0.0009 : 0.00025;

      if (budget.beams) {
        const t = performance.now() * 0.00022;
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(240,162,2,0)');
        g.addColorStop(0.4 + Math.sin(t) * 0.1, dark ? 'rgba(240,162,2,0.14)' : 'rgba(240,162,2,0.05)');
        g.addColorStop(0.7 + Math.cos(t * 0.8) * 0.08, dark ? 'rgba(20,184,166,0.1)' : 'rgba(20,184,166,0.04)');
        g.addColorStop(1, 'rgba(20,184,166,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        // sweeping light beam
        ctx.save();
        ctx.translate(w * (0.3 + Math.sin(t * 1.4) * 0.35), h * 0.2);
        ctx.rotate(Math.sin(t) * 0.4);
        const beam = ctx.createLinearGradient(0, 0, w * 0.55, 0);
        beam.addColorStop(0, 'rgba(240,162,2,0)');
        beam.addColorStop(0.5, dark ? 'rgba(240,162,2,0.12)' : 'rgba(240,162,2,0.05)');
        beam.addColorStop(1, 'rgba(240,162,2,0)');
        ctx.fillStyle = beam;
        ctx.fillRect(0, 0, w * 0.55, h * 0.7);
        ctx.restore();
      }

      if (mouse.current.active || intensity === 'landing' || reactive) {
        const glow = ctx.createRadialGradient(mx, my, 0, mx, my, reactive ? 320 : intensity === 'landing' ? 300 : 220);
        glow.addColorStop(0, reactive ? 'rgba(20,184,166,0.22)' : dark ? 'rgba(240,162,2,0.22)' : 'rgba(240,162,2,0.1)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }

      for (const p of particles) {
        p.vx += (mx - p.x) * pull * speed;
        p.vy += (my - p.y) * pull * speed;
        p.vx *= 0.992;
        p.vy *= 0.992;
        p.x += p.vx * speed;
        p.y += p.vy * speed;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      if (budget.links) {
        ctx.lineWidth = intensity === 'landing' ? 1.25 : 1;
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const a = particles[i];
            const b = particles[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > linkDist * linkDist) continue;
            const alpha = (1 - Math.sqrt(d2) / linkDist) * (dark ? 0.38 : 0.14) * particleBoost;
            ctx.strokeStyle = `hsla(${a.hue}, 90%, ${dark ? 70 : 45}%, ${Math.min(0.55, alpha)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx.beginPath();
        const glowR = p.r * particleBoost * (reactive ? 1.35 : 1.1);
        ctx.fillStyle = `hsla(${p.hue}, 95%, ${dark ? 72 : 48}%, ${Math.min(0.95, p.a * particleBoost * (reactive ? 1.35 : 1))})`;
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
        if (intensity === 'landing' || intensity === 'chat') {
          ctx.beginPath();
          ctx.fillStyle = `hsla(${p.hue}, 100%, 80%, 0.18)`;
          ctx.arc(p.x, p.y, glowR * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [budget, dark, intensity, reactive]);

  const auroraClass =
    budget.aurora === 'hot'
      ? 'lb-aurora lb-aurora-hot'
      : budget.aurora === 'cool'
        ? 'lb-aurora lb-aurora-cool'
        : budget.aurora === 'warm'
          ? 'lb-aurora lb-aurora-warm'
          : 'lb-aurora lb-aurora-soft';

  const overPhoto = className.includes('over-photo') || className.includes('!absolute');

  return (
    <div
      className={`living-backdrop ${dark && !overPhoto ? 'is-dark' : ''} ${!dark ? 'is-light' : ''} ${overPhoto ? 'is-over-photo' : ''} ${reactive ? 'is-reactive' : ''} ${className}`.trim()}
      aria-hidden
    >
      <div className={`lb-mesh ${budget.reduced ? 'is-static' : ''}`} />
      <div className={`${auroraClass} ${budget.reduced || budget.paused ? 'is-static' : ''}`} />
      <div className={`lb-orb lb-orb-a ${budget.reduced || budget.paused ? 'is-static' : ''}`} />
      <div className={`lb-orb lb-orb-b ${budget.reduced || budget.paused ? 'is-static' : ''}`} />
      <div className={`lb-orb lb-orb-c ${budget.reduced || budget.paused ? 'is-static' : ''}`} />
      <div className={`lb-grid ${budget.reduced || budget.paused ? 'is-static' : ''}`} />
      {!budget.reduced && budget.particles > 0 && !budget.paused && (
        <canvas ref={canvasRef} className="lb-canvas" />
      )}
      <div className="lb-vignette" />
    </div>
  );
}

export function AmbientShell({
  intensity,
  reactive,
  className = '',
  children,
}: {
  intensity: AmbientIntensity;
  reactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`ambient-shell ${className}`.trim()}>
      <LivingBackdrop intensity={intensity} reactive={reactive} />
      <div className="ambient-shell-content">{children}</div>
    </div>
  );
}
