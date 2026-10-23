/** Register shell-only SW in production builds. Safe no-op in tests / unsupported browsers. */
export function registerShellWorker() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  if (import.meta.env.MODE === 'test') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              // Activate new shell promptly so users aren't stuck on an outdated version
              worker.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch(() => {
        /* ignore registration failures */
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
