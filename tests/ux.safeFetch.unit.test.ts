import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkError, friendlyNetworkMessage, safeFetch } from '../src/ux/safeFetch.ts';

describe('safeFetch helpers', () => {
  it('maps NetworkError and fetch failures to friendly copy', () => {
    assert.match(friendlyNetworkMessage(new NetworkError('offline now', 'offline')), /offline/i);
    assert.match(friendlyNetworkMessage(new Error('Failed to fetch')), /unable to reach|connection/i);
    assert.equal(friendlyNetworkMessage(new Error('x'), 'fallback'), 'fallback');
  });

  it('does not retry mutations even when retry is requested', async () => {
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    await assert.rejects(
      () =>
        safeFetch('http://127.0.0.1:9/api/orders', {
          method: 'POST',
          body: '{}',
          retry: 3,
          timeoutMs: 500,
        }),
      (err: unknown) => err instanceof NetworkError && err.code === 'unreachable'
    );
    assert.equal(calls, 1);
    globalThis.fetch = original;
  });
});
