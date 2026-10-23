import React from 'react';
import { Mic, Square } from 'lucide-react';
import { motion } from '../motion/Motion';
import { usePrefersReducedMotion } from '../motion/usePrefersReducedMotion';

export function AiModeChip({ geminiUsed, fallbackReason }: { geminiUsed?: boolean; fallbackReason?: string }) {
  if (geminiUsed === true) {
    return <span className="mode-chip mode-live">Live Gemini</span>;
  }
  if (geminiUsed === false || fallbackReason) {
    return (
      <span className="mode-chip mode-local" title={fallbackReason || 'Deterministic agents'}>
        Local agents
      </span>
    );
  }
  return null;
}

export function TypingDots({ label }: { label?: string }) {
  return (
    <div className="typing-row" aria-live="polite">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
      {label && <span className="typing-label">{label}</span>}
    </div>
  );
}

export function MicOrb({
  recording,
  disabled,
  onClick,
  title,
}: {
  recording: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <button
      type="button"
      className={`mic-orb ${recording ? 'is-recording' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
    >
      {!reduced && recording && (
        <>
          <motion.span
            className="mic-ring"
            animate={{ scale: [1, 1.35, 1], opacity: [0.55, 0.15, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="mic-ring mic-ring-delay"
            animate={{ scale: [1, 1.55, 1], opacity: [0.35, 0.05, 0.35] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.25 }}
          />
        </>
      )}
      {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}

export function WaveformBars({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion();
  const bars = [0.4, 0.7, 1, 0.55, 0.85, 0.45, 0.95, 0.6];
  return (
    <div className="wave-row" aria-hidden>
      {bars.map((b, i) =>
        reduced || !active ? (
          <span key={i} className="wave-bar" style={{ height: `${10 + b * 10}px` }} />
        ) : (
          <motion.span
            key={i}
            className="wave-bar"
            animate={{ height: [`${8 + b * 8}px`, `${14 + b * 16}px`, `${8 + b * 8}px`] }}
            transition={{ duration: 0.7 + i * 0.05, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      )}
    </div>
  );
}
