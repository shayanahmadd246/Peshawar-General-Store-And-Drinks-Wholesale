import React from 'react';
import { Store } from 'lucide-react';
import { Delayed } from './Delayed';

export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <div className="brand-loader-mark" style={{ width: size, height: size }} aria-hidden>
      <span className="brand-loader-ring" />
      <span className="brand-loader-ring brand-loader-ring-delay" />
      <span className="brand-loader-core">
        <Store style={{ width: size * 0.38, height: size * 0.38 }} />
      </span>
    </div>
  );
}

export function BrandLoader({
  title = 'Loading wholesale platform…',
  subtitle = 'Preparing secure portals and live catalog',
  fullscreen = true,
}: {
  title?: string;
  subtitle?: string;
  fullscreen?: boolean;
}) {
  return (
    <div className={fullscreen ? 'brand-loader-screen' : 'brand-loader-inline'} role="status" aria-live="polite">
      <BrandMark />
      <div className="brand-loader-copy">
        <p className="brand-loader-title">{title}</p>
        {subtitle && <p className="brand-loader-sub">{subtitle}</p>}
      </div>
      <div className="brand-loader-bar" aria-hidden>
        <span />
      </div>
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-spinner" role="status" aria-label={label || 'Loading'}>
      <span className="inline-spinner-dot" />
      {label && <span className="inline-spinner-label">{label}</span>}
    </span>
  );
}

export function ButtonBusyLabel({ busy, idle, busyLabel }: { busy: boolean; idle: React.ReactNode; busyLabel: string }) {
  return (
    <>
      <Delayed show={busy} ms={120}>
        <InlineSpinner label={busyLabel} />
      </Delayed>
      {!busy && idle}
      {busy && (
        <span className="sr-only">{busyLabel}</span>
      )}
    </>
  );
}

/** Soft indeterminate bar for long-running in-panel work (AI, voice, etc.). */
export function SoftProgress({ show, label }: { show: boolean; label?: string }) {
  return (
    <Delayed show={show} ms={180}>
      <div className="soft-progress" role="status" aria-live="polite">
        <div className="soft-progress-track">
          <span className="soft-progress-thumb" />
        </div>
        {label && <p className="soft-progress-label">{label}</p>}
      </div>
    </Delayed>
  );
}
