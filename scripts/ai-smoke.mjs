import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const phone = process.env.SEED_CLIENT_PHONE || '03009876543';
const password = process.env.SEED_CLIENT_PASSWORD || 'password123';

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error || res.statusText}`);
  return data;
}

async function main() {
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
  console.log('AI mode:', status.mode, 'geminiConfigured=', status.geminiConfigured);

  const turns = [
    'Show me available cold drinks.',
    'Mujhe Pepsi ki 5 petiyan chahiye.',
    'Show my cart and propose checkout',
  ];

  let conversationId;
  for (const message of turns) {
    const data = await json(
      await fetch(`${BASE}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message, language: 'en', conversationId }),
      })
    );
    conversationId = data.conversationId;
    console.log('\n> ' + message);
    console.log(data.reply.slice(0, 400));
    console.log(
      'tools=',
      (data.toolCalls || []).map((t) => `${t.name}:${t.ok ? 'ok' : 'err'}`).join(','),
      'cartItems=',
      data.cart?.itemCount ?? 0,
      'needsConfirmation=',
      data.needsConfirmation,
      'orderPlaced=',
      data.orderPlaced
    );
  }

  const cart = await json(await fetch(`${BASE}/api/cart`, { headers }));
  console.log('\nPersistent cart itemCount=', cart.cart?.itemCount ?? cart.itemCount);

  console.log('\nAI smoke OK');
}

main().catch((err) => {
  console.error('AI smoke failed:', err.message);
  process.exit(1);
});
