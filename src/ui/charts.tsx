import React from 'react';
import { motion } from '../motion/Motion';
import { usePrefersReducedMotion } from '../motion/usePrefersReducedMotion';

/** Tiny bar sparkline from real numeric series (no fabricated points). */
export function SparkBars({
  values,
  className = '',
  color = 'var(--color-accent)',
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const max = Math.max(...values, 1);
  return (
    <div className={`spark-bars ${className}`.trim()} role="img" aria-label="Activity sparkline from live orders">
      {values.map((v, i) => {
        const h = Math.max(4, Math.round((v / max) * 100));
        if (reduced) {
          return <span key={i} className="spark-bar" style={{ height: `${h}%`, background: color }} />;
        }
        return (
          <motion.span
            key={i}
            className="spark-bar"
            initial={{ height: 4 }}
            animate={{ height: `${h}%` }}
            transition={{ type: 'spring', stiffness: 260, damping: 24, delay: i * 0.03 }}
            style={{ background: color }}
          />
        );
      })}
    </div>
  );
}

export function HealthMeter({
  healthy,
  low,
  out,
}: {
  healthy: number;
  low: number;
  out: number;
}) {
  const total = Math.max(1, healthy + low + out);
  return (
    <div className="health-meter" aria-label={`Inventory health: ${healthy} healthy, ${low} low, ${out} out`}>
      <div className="health-meter-track">
        <span style={{ width: `${(healthy / total) * 100}%` }} className="hm-ok" />
        <span style={{ width: `${(low / total) * 100}%` }} className="hm-low" />
        <span style={{ width: `${(out / total) * 100}%` }} className="hm-out" />
      </div>
      <div className="health-meter-legend">
        <span>Healthy {healthy}</span>
        <span>Low {low}</span>
        <span>Out {out}</span>
      </div>
    </div>
  );
}
