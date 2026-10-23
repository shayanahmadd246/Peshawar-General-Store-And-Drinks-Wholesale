import React from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'motion/react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export { AnimatePresence, motion };

const springSoft = { type: 'spring' as const, stiffness: 320, damping: 28, mass: 0.8 };
const springSnappy = { type: 'spring' as const, stiffness: 420, damping: 32 };

export function FadeIn({
  children,
  className,
  delay = 0,
  y = 12,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springSoft, delay }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className,
  stagger = 0.06,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger } },
      }}
    >
      {React.Children.map(children, (child) =>
        child ? (
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 14 },
              show: { opacity: 1, y: 0, transition: springSoft },
            }}
          >
            {child}
          </motion.div>
        ) : null
      )}
    </motion.div>
  );
}

export function AnimatedCounter({
  value,
  prefix = '',
  className,
}: {
  value: number;
  prefix?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mv = useMotionValue(reduced ? value : 0);
  const spring = useSpring(mv, { stiffness: 90, damping: 22 });
  const display = useTransform(spring, (v) => `${prefix}${Math.round(v).toLocaleString()}`);
  const [text, setText] = React.useState(`${prefix}${Math.round(value).toLocaleString()}`);

  React.useEffect(() => {
    mv.set(value);
  }, [mv, value]);

  React.useEffect(() => {
    if (reduced) {
      setText(`${prefix}${Math.round(value).toLocaleString()}`);
      return;
    }
    return display.on('change', (v) => setText(v));
  }, [display, prefix, reduced, value]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  );
}

export function Pressable({
  children,
  className,
  onClick,
  disabled,
  type = 'button',
  title,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  'aria-label'?: string;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) {
    return (
      <button type={type} className={className} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}>
        {children}
      </button>
    );
  }
  return (
    <motion.button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={springSnappy}
    >
      {children}
    </motion.button>
  );
}

export function ChatMessageMotion({
  children,
  fromUser,
}: {
  children: React.ReactNode;
  fromUser: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96, x: fromUser ? 14 : -14, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, x: 0, filter: 'blur(0px)' }}
      transition={springSoft}
      layout
    >
      {children}
    </motion.div>
  );
}

export function HeroWord({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <span className={className}>{children}</span>;
  return (
    <motion.span
      className={`inline-block ${className || ''}`.trim()}
      initial={{ opacity: 0, y: 28, rotateX: 35 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ ...springSoft, delay }}
      style={{ transformOrigin: '50% 100%' }}
    >
      {children}
    </motion.span>
  );
}

export function FloatOrb({
  className,
  duration = 10,
  x = 18,
  y = 22,
}: {
  className?: string;
  duration?: number;
  x?: number;
  y?: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <div className={className} aria-hidden />;
  return (
    <motion.div
      className={className}
      aria-hidden
      animate={{ x: [0, x, -x * 0.6, 0], y: [0, -y, y * 0.5, 0], rotate: [0, 12, -8, 0] }}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}
