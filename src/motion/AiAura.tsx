import React from 'react';
import { motion } from 'motion/react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type AiVisualState = 'idle' | 'listening' | 'thinking' | 'responding' | 'error';

export function deriveAiVisualState(opts: {
  isAiLoading: boolean;
  voiceState: string;
  chatError?: string | null;
  voiceError?: string | null;
}): AiVisualState {
  if (opts.chatError || opts.voiceError) return 'error';
  if (opts.voiceState === 'recording') return 'listening';
  if (opts.voiceState === 'transcribing' || opts.voiceState === 'submitting' || opts.isAiLoading) return 'thinking';
  if (opts.voiceState === 'review' || opts.voiceState === 'preview') return 'responding';
  return 'idle';
}

/** Ambient ring around the AI avatar — driven by real app state. */
export function AiAura({ state }: { state: AiVisualState }) {
  const reduced = usePrefersReducedMotion();
  if (reduced) {
    return <span className={`ai-aura-static ai-aura-${state}`} aria-hidden />;
  }

  const pulse =
    state === 'thinking'
      ? { scale: [1, 1.35, 1], opacity: [0.45, 0.85, 0.45] }
      : state === 'listening'
        ? { scale: [1, 1.5, 1], opacity: [0.5, 0.95, 0.5] }
        : state === 'responding'
          ? { scale: [1, 1.2, 1], opacity: [0.35, 0.7, 0.35] }
          : state === 'error'
            ? { scale: [1, 1.15, 1], opacity: [0.4, 0.75, 0.4] }
            : { scale: [1, 1.12, 1], opacity: [0.25, 0.45, 0.25] };

  const duration = state === 'thinking' ? 1.1 : state === 'listening' ? 0.9 : 2.4;

  return (
    <span className={`ai-aura-wrap ai-aura-${state}`} aria-hidden>
      <motion.span
        className="ai-aura-ring"
        animate={pulse}
        transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
      />
      {(state === 'thinking' || state === 'listening') && (
        <motion.span
          className="ai-aura-ring ai-aura-ring-outer"
          animate={{ scale: [1, 1.65, 1], opacity: [0.35, 0.05, 0.35] }}
          transition={{ duration: duration * 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
        />
      )}
    </span>
  );
}

export function AiStateLabel({ state }: { state: AiVisualState }) {
  const map: Record<AiVisualState, string> = {
    idle: 'Ready',
    listening: 'Listening…',
    thinking: 'Thinking…',
    responding: 'Responding',
    error: 'Needs attention',
  };
  return <span className={`ai-state-pill ai-state-${state}`}>{map[state]}</span>;
}
