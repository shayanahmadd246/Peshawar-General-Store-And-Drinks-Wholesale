import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CloudOff, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { BrandMark } from './BrandLoader';
import { safeFetch } from './safeFetch';

export type ConnectivityState = {
  browserOnline: boolean;
  backendReachable: boolean | null;
  checking: boolean;
  toast: null | { kind: 'offline' | 'online' | 'backend_down'; message: string };
  refreshConnectivity: () => Promise<void>;
};

const ConnectivityContext = createContext<ConnectivityState | null>(null);

async function probeBackend(): Promise<boolean> {
  try {
    const res = await safeFetch('/api/health', { method: 'GET', timeoutMs: 8000, retry: 1 });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (data?.status === 'ok') return true;
    if (data?.database === 'connected' || data?.database === true) return true;
    return res.status === 200;
  } catch {
    return false;
  }
}

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<ConnectivityState['toast']>(null);
  const wasOffline = useRef(false);
  const toastTimer = useRef(0);

  const showToast = useCallback((next: ConnectivityState['toast']) => {
    setToast(next);
    window.clearTimeout(toastTimer.current);
    if (next?.kind === 'online') {
      toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    }
  }, []);

  const refreshConnectivity = useCallback(async () => {
    setChecking(true);
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    setBrowserOnline(online);
    if (!online) {
      setBackendReachable(false);
      setChecking(false);
      wasOffline.current = true;
      showToast({ kind: 'offline', message: 'No internet connection. Some actions are paused until you reconnect.' });
      return;
    }
    const ok = await probeBackend();
    setBackendReachable(ok);
    setChecking(false);
    if (!ok) {
      showToast({
        kind: 'backend_down',
        message: 'Connected to the internet, but the wholesale server is not responding.',
      });
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      showToast({ kind: 'online', message: 'Back online. You can continue where you left off.' });
      window.dispatchEvent(new CustomEvent('wholesale:reconnected'));
    } else {
      setToast((t) => (t?.kind === 'backend_down' || t?.kind === 'offline' ? null : t));
    }
  }, [showToast]);

  useEffect(() => {
    void refreshConnectivity();
    const onOnline = () => {
      void refreshConnectivity();
    };
    const onOffline = () => {
      wasOffline.current = true;
      setBrowserOnline(false);
      setBackendReachable(false);
      showToast({ kind: 'offline', message: 'No internet connection. Some actions are paused until you reconnect.' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshConnectivity();
    }, 45_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(interval);
      window.clearTimeout(toastTimer.current);
    };
  }, [refreshConnectivity, showToast]);

  const value = useMemo(
    () => ({ browserOnline, backendReachable, checking, toast, refreshConnectivity }),
    [browserOnline, backendReachable, checking, toast, refreshConnectivity]
  );

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) {
    return {
      browserOnline: true,
      backendReachable: true as boolean | null,
      checking: false,
      toast: null,
      refreshConnectivity: async () => undefined,
    } satisfies ConnectivityState;
  }
  return ctx;
}

export function ConnectivityBanner() {
  const { browserOnline, backendReachable, toast, refreshConnectivity, checking } = useConnectivity();
  const show =
    toast ||
    (!browserOnline
      ? { kind: 'offline' as const, message: 'No internet connection.' }
      : backendReachable === false
        ? { kind: 'backend_down' as const, message: 'Server unreachable.' }
        : null);

  if (!show) return null;

  const onlineToast = show.kind === 'online';
  return (
    <div
      className={`connectivity-banner ${onlineToast ? 'is-online' : show.kind === 'backend_down' ? 'is-backend' : 'is-offline'}`}
      role="status"
      aria-live="polite"
    >
      <div className="connectivity-banner-inner">
        {onlineToast ? <Wifi className="w-4 h-4" /> : show.kind === 'backend_down' ? <CloudOff className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
        <p>{show.message || toast?.message}</p>
        {!onlineToast && (
          <button type="button" className="connectivity-retry" onClick={() => void refreshConnectivity()} disabled={checking}>
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function OfflineScreen({
  reason = 'offline',
  onRetry,
  onHome,
}: {
  reason?: 'offline' | 'backend';
  onRetry: () => void;
  onHome?: () => void;
}) {
  return (
    <div className="offline-screen" role="alert">
      <div className="offline-card">
        <BrandMark size={64} />
        <h1 className="offline-title">
          {reason === 'backend' ? 'Server temporarily unavailable' : 'You’re offline'}
        </h1>
        <p className="offline-lead">
          {reason === 'backend'
            ? 'Your device is online, but we can’t reach the wholesale platform right now. Your work is safe on this screen—try again in a moment.'
            : 'Check your Wi‑Fi or mobile data. You can still read this page, but ordering, payments, and live inventory need a connection.'}
        </p>
        <div className="offline-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <RefreshCw className="w-4 h-4" /> Retry connection
          </button>
          {onHome && (
            <button type="button" className="btn btn-secondary" onClick={onHome}>
              Return to Home
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
