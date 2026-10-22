import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const phone = process.env.SEED_CLIENT_PHONE || '03009876543';
const password = process.env.SEED_CLIENT_PASSWORD || 'password123';

const key = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
if (!key.trim()) {
  console.error('BLOCKER: GEMINI_API_KEY is not configured.');
  process.exit(2);
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error || res.statusText}`);
  return data;
}

const signin = await json(
  await fetch(`${BASE}/api/auth/client/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  })
);

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${signin.token}`,
};

const status = await json(await fetch(`${BASE}/api/ai/status`, { headers }));
console.log('status.mode=', status.mode);
console.log('status.geminiConfigured=', status.geminiConfigured);
if (!status.geminiConfigured) {
  console.error('FAIL: server reports Gemini not configured.');
  process.exit(1);
}

// One read-only multilingual turn to conserve free-tier quota
const message =
  'Please answer briefly in English, then one short Urdu line, then one short Pashto line. ' +
  'Only use tools to search the live catalog for cold drinks / cola. Do not add to cart or checkout. ' +
  'Say clearly that this is a live Gemini catalog check.';

const data = await json(
  await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, language: 'mixed' }),
  })
);

const replyPreview = String(data.reply || '').slice(0, 320).replace(/\s+/g, ' ');
console.log('\ngeminiUsed=', data.geminiUsed);
console.log('orderPlaced=', data.orderPlaced);
console.log('tools=', (data.toolCalls || []).map((t) => `${t.name}:${t.ok ? 'ok' : 'err'}`).join(',') || '(none)');
console.log('suggestedCount=', (data.suggestedProducts || []).length);
console.log('reply:', replyPreview + (String(data.reply || '').length > 320 ? '…' : ''));

if (data.orderPlaced) {
  console.error('FAIL: AI unexpectedly reported orderPlaced=true');
  process.exit(1);
}
if (!data.geminiUsed) {
  console.error('FAIL: deterministic fallback used (geminiUsed=false).');
  process.exit(1);
}
if (!/gemini|catalog|drink|cola|کولا|څښاک/i.test(String(data.reply || ''))) {
  console.error('FAIL: reply did not look like a live catalog/Gemini response.');
  process.exit(1);
}

console.log('\nPASS: live Gemini responded on multilingual read-only chat; no orders placed.');
process.exit(0);
