import React from 'react';
import { LogOut, type LucideIcon } from 'lucide-react';

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = String(status || '').toLowerCase();
  if (/(active|approved|delivered|paid|fulfilled|success|available)/.test(s)) return 'success';
  if (/(pending|submitted|assigned|dispatched|intransit|low_stock|partial|unassigned)/.test(s)) return 'warning';
  if (/(reject|fail|suspend|cancel|out_of_stock|overdue|danger)/.test(s)) return 'danger';
  if (/(transit|processing|review)/.test(s)) return 'info';
  return 'neutral';
}

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const tone = statusTone(status);
  return <span className={`status-pill status-${tone} ${className}`.trim()}>{status}</span>;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon className="w-5 h-5" />
      </div>
      <p className="font-serif font-semibold text-brand text-sm">{title}</p>
      {description && <p className="text-xs max-w-sm leading-relaxed">{description}</p>}
    </div>
  );
}

export function PortalHeader({
  icon: Icon,
  title,
  subtitle,
  onLogout,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onLogout?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="portal-header">
      <div className="flex items-center gap-3 min-w-0">
        <div className="portal-brand-mark">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="portal-title truncate">{title}</h1>
          {subtitle && <p className="portal-subtitle truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {onLogout && (
          <button type="button" onClick={onLogout} className="btn btn-ghost btn-sm">
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function TabRail({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; icon?: LucideIcon; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="tab-rail" role="tablist" aria-label="Section navigation">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`tab-btn ${active ? 'is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {Icon && <Icon className="w-3.5 h-3.5 text-accent" />}
            {tab.label}
            {typeof tab.count === 'number' && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/15' : 'bg-canvas'}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function KpiCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'muted';
}) {
  const valueClass =
    tone === 'accent'
      ? 'text-accent'
      : tone === 'success'
        ? 'text-success'
        : tone === 'muted'
          ? 'text-muted'
          : 'text-brand';
  return (
    <div className="kpi-card">
      <span className="kpi-label">{label}</span>
      <div className={`kpi-value ${valueClass}`}>{value}</div>
    </div>
  );
}

export function AlertBanner({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'warn' | 'info';
  children: React.ReactNode;
}) {
  if (!children) return null;
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function ModalFrame({
  open,
  onClose,
  title,
  children,
  zClass = 'z-50',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  zClass?: string;
}) {
  if (!open) return null;
  return (
    <div className={`modal-backdrop ${zClass}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif font-bold text-brand text-lg leading-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm !px-2.5"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthLayout({
  icon: Icon,
  title,
  subtitle,
  error,
  onBack,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  error?: string;
  onBack: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card space-y-5">
        <button type="button" onClick={onBack} className="text-xs font-semibold text-brand hover:text-accent transition inline-flex items-center gap-1.5">
          ← Back to gateway
        </button>
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-brand text-accent mx-auto grid place-items-center shadow-card">
            <Icon className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-brand">{title}</h2>
          <p className="text-xs text-muted leading-relaxed">{subtitle}</p>
        </div>
        {error && <AlertBanner>{error}</AlertBanner>}
        {children}
        {footer}
      </div>
    </div>
  );
}

export function StockMeter({ available, capacity }: { available: number; capacity: number }) {
  const pct = capacity > 0 ? Math.max(0, Math.min(100, Math.round((available / capacity) * 100))) : 0;
  return (
    <div className="space-y-1">
      <div className="stock-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-muted">{available} available · {pct}%</p>
    </div>
  );
}
