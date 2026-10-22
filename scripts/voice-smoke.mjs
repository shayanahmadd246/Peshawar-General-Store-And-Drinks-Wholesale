import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const phone = process.env.SEED_CLIENT_PHONE || '03009876543';
const password = process.env.SEED_CLIENT_PASSWORD || 'password123';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildSilentWav(durationMs = 500, sampleRate = 8000) {
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44);
  return buffer;
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
const headers = { Authorization: `Bearer ${signin.token}` };

const status = await json(await fetch(`${BASE}/api/ai/status`, { headers }));
console.log('voice status:', status.voice);
console.log('geminiConfigured=', status.geminiConfigured);

const samplePath = path.join(__dirname, '../fixtures/sample-voice.wav');
const wav = fs.existsSync(samplePath) ? fs.readFileSync(samplePath) : buildSilentWav(700);
if (!fs.existsSync(samplePath)) {
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  fs.writeFileSync(samplePath, wav);
  console.log('wrote synthetic fixture', samplePath);
}

// WhatsApp-style auto: one upload → STT → AI when transcript succeeds
const autoForm = new FormData();
autoForm.append('audio', new Blob([wav], { type: 'audio/wav' }), 'sample-voice.wav');
autoForm.append('durationMs', '700');
autoForm.append('language', 'en');
autoForm.append('submissionKey', `SMOKE-AUTO-${Date.now()}`);

const auto = await json(
  await fetch(`${BASE}/api/ai/voice/auto`, {
    method: 'POST',
    headers,
    body: autoForm,
  })
);
console.log('auto:', {
  autoSent: auto.autoSent,
  transcriptId: auto.transcriptId,
  geminiUsed: auto.geminiUsed,
  transcriptionSucceeded: auto.transcriptionSucceeded,
  errorCode: auto.errorCode || null,
  orderPlaced: auto.orderPlaced,
  transcriptPreview: String(auto.userText || auto.transcript || '').slice(0, 80),
  replyPreview: String(auto.reply || '').slice(0, 120) || null,
  error: auto.error || null,
});

let submitted = auto;
let submissionKey = autoForm.get('submissionKey');
let transcriptId = auto.transcriptId;

if (auto.autoSent) {
  console.log('NOTE: WhatsApp auto-send succeeded (STT + AI in one step).');
} else {
  console.log('NOTE: auto STT did not succeed — manual typed transcript (expected under quota/silence).');
  const edited = 'Show me available cold drinks.';
  submissionKey = `SMOKE-MANUAL-${transcriptId}`;
  submitted = await json(
    await fetch(`${BASE}/api/ai/voice/submit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptId,
        editedTranscript: edited,
        language: auto.detectedLanguage || 'en',
        conversationId: auto.conversationId,
        submissionKey,
      }),
    })
  );
  console.log('manual submit:', {
    duplicate: submitted.duplicate || false,
    orderPlaced: submitted.orderPlaced,
    geminiUsed: submitted.geminiUsed,
    replyPreview: String(submitted.reply || submitted.message || '').slice(0, 160),
  });
}

const dup = await json(
  await fetch(`${BASE}/api/ai/voice/submit`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcriptId,
      editedTranscript: auto.userText || auto.transcript || 'Show me available cold drinks.',
      language: 'en',
      submissionKey,
    }),
  })
);
console.log('duplicate submit:', { duplicate: dup.duplicate, orderPlaced: dup.orderPlaced });

if (dup.orderPlaced || submitted.orderPlaced || auto.orderPlaced) {
  console.error('FAIL: voice flow placed an order');
  process.exit(1);
}
if (auto.autoSent) {
  // Already submitted via auto — re-submit same key must be duplicate
  if (!dup.duplicate) {
    console.error('FAIL: expected duplicate prevention after auto-send');
    process.exit(1);
  }
} else if (!dup.duplicate) {
  console.error('FAIL: expected duplicate prevention');
  process.exit(1);
}

console.log('\nVoice smoke OK (auto / manual fallback → AI → no auto-order).');
console.log(
  'Live STT note:',
  auto.transcriptionSucceeded
    ? 'Live Gemini transcription succeeded and auto-sent (or would have with speech).'
    : auto.geminiUsed
      ? 'Gemini STT path ran but empty/failed transcript (silence fixture or quota).'
      : 'Gemini STT not used — unavailable/quota path; text fallback OK.'
);
process.exit(0);
