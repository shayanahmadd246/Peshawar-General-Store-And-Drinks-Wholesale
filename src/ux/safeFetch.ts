export type SafeFetchOptions = RequestInit & {
  /** Abort after this many ms. Default 20000. */
  timeoutMs?: number;
  /** Retry idempotent GET/HEAD only. Never retries mutations. */
  retry?: number;
  retryDelayMs?: number;
};

export class NetworkError extends Error {
  code: 'offline' | 'timeout' | 'unreachable' | 'http';
  status?: number;
  constructor(message: string, code: NetworkError['code'], status?: number) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isIdempotent(method?: string) {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Fetch with timeout and optional safe retries for reads only.
 * Never auto-retries POST/PATCH/PUT/DELETE (checkout, payments, approvals).
 */
export async function safeFetch(input: RequestInfo | URL, options: SafeFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, retry = 0, retryDelayMs = 600, ...init } = options;
  const method = init.method || 'GET';
  const maxAttempts = isIdempotent(method) ? Math.max(1, retry + 1) : 1;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new NetworkError('You appear to be offline. Check your internet connection.', 'offline');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const signal = init.signal
        ? AbortSignal.any
          ? AbortSignal.any([init.signal, controller.signal])
          : controller.signal
        : controller.signal;

      const res = await fetch(input, { ...init, signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (aborted && attempt >= maxAttempts - 1) {
        throw new NetworkError('The request timed out. Please try again.', 'timeout');
      }
      if (attempt < maxAttempts - 1) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new NetworkError('You appear to be offline. Check your internet connection.', 'offline');
      }
      throw new NetworkError('Unable to reach the server. It may be temporarily unavailable.', 'unreachable');
    }
  }
  throw lastError instanceof Error ? lastError : new NetworkError('Request failed.', 'unreachable');
}

export function friendlyNetworkMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return fallback;
}
