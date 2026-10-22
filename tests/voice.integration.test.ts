import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import dotenv from 'dotenv';
import { buildSilentWav } from '../src/ai/voice/wavFixture';

dotenv.config({ quiet: true });

const hasDatabase = Boolean(process.env.DATABASE_URL);
const liveGemini = Boolean(process.env.GEMINI_API_KEY || process.env.API_KEY);

describe('voice integration', { skip: !hasDatabase }, () => {
  let client: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let wholesaler: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;
  let otherClient: Awaited<ReturnType<typeof import('../src/auth/service').authenticateUser>>;

  before(async () => {
    const { runMigrations } = await import('../src/db/migrate');
    const { seedDevelopmentData } = await import('../src/db/seed');
    const { authenticateUser, registerClient } = await import('../src/auth/service');

    await runMigrations();
    await seedDevelopmentData();

    client = await authenticateUser({
      phone: process.env.SEED_CLIENT_PHONE || '03009876543',
      password: process.env.SEED_CLIENT_PASSWORD || 'password123',
      expectedRole: 'client',
    });
    wholesaler = await authenticateUser({
      email: 'wholesaler1@market.pk',
      password: process.env.SEED_WHOLESALER_PASSWORD || 'password123',
      expectedRole: 'wholesaler',
    });

    const isolationPhone = `0399${String(Date.now()).slice(-7)}`;
    const isolationPassword = process.env.SEED_CLIENT_PASSWORD || 'password123';
    await registerClient({
      name: 'Voice Isolation',
      storeName: 'Voice Mart',
      phone: isolationPhone,
      password: isolationPassword,
    });
    otherClient = await authenticateUser({
      phone: isolationPhone,
      password: isolationPassword,
      expectedRole: 'client',
    });
  });

  it('rejects wholesaler voice access and invalid audio signatures', async () => {
    const { createTranscriptionFromUpload, getOwnedAudio } = await import('../src/ai/voice/service');
    await assert.rejects(
      () =>
        createTranscriptionFromUpload(wholesaler.user, {
          buffer: buildSilentWav(400),
          declaredMime: 'audio/wav',
          durationMs: 400,
        }),
      /shopkeeper/i
    );

    await assert.rejects(
      () =>
        createTranscriptionFromUpload(client.user, {
          buffer: Buffer.from('not-audio'),
          declaredMime: 'audio/wav',
          durationMs: 400,
        }),
      /signature|verify|short|empty/i
    );

    // Cross-user audio isolation placeholder: create then deny other client
    const created = await createTranscriptionFromUpload(client.user, {
      buffer: buildSilentWav(450),
      declaredMime: 'audio/wav',
      durationMs: 450,
      languageHint: 'en',
    });
    await assert.rejects(() => getOwnedAudio(otherClient.user, created.audioAssetId), /not found/i);
  });

  it('requires transcript review and blocks duplicate submission keys', async () => {
    const { createTranscriptionFromUpload, submitReviewedTranscript } = await import('../src/ai/voice/service');

    const created = await createTranscriptionFromUpload(client.user, {
      buffer: buildSilentWav(500),
      declaredMime: 'audio/wav',
      durationMs: 500,
      languageHint: 'en',
    });
    assert.equal(created.requiresReview, true);
    assert.equal(created.autoSubmitted, false);
    assert.equal(created.orderPlaced, false);
    assert.equal(created.status, 'pending_review');

    await assert.rejects(
      () =>
        submitReviewedTranscript(client.user, {
          transcriptId: created.transcriptId,
          editedTranscript: '',
          submissionKey: `dup-${Date.now()}`,
        }),
      /required/i
    );

    const key = `VOICE-TEST-${created.transcriptId}`;
    const first = await submitReviewedTranscript(client.user, {
      transcriptId: created.transcriptId,
      editedTranscript: 'Show me available cold drinks.',
      language: 'en',
      submissionKey: key,
    });
    assert.equal(first.orderPlaced, false);
    assert.equal(first.duplicate, false);
    assert.ok('reply' in first && first.reply);

    const second = await submitReviewedTranscript(client.user, {
      transcriptId: created.transcriptId,
      editedTranscript: 'Show me available cold drinks.',
      language: 'en',
      submissionKey: key,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.orderPlaced, false);
  });

  it('voice → reviewed text → cart path never auto-checkouts', async () => {
    const { submitReviewedTranscript, createTranscriptionFromUpload } = await import('../src/ai/voice/service');
    const { placeOrder } = await import('../src/commerce/orders');

    const created = await createTranscriptionFromUpload(client.user, {
      buffer: buildSilentWav(500),
      declaredMime: 'audio/wav',
      durationMs: 500,
    });

    const result = await submitReviewedTranscript(client.user, {
      transcriptId: created.transcriptId,
      editedTranscript: 'Mujhe Pepsi ki 2 petiyan chahiye.',
      language: 'ur',
      submissionKey: `VOICE-CART-${created.transcriptId}`,
    });

    assert.equal(result.orderPlaced, false);
    await assert.rejects(
      () =>
        placeOrder(client.user, {
          deliveryAddress: 'Voice test address',
          confirmed: false,
          idempotencyKey: `VOICE-NOCONFIRM-${Date.now()}`,
        }),
      /Explicit confirmation/i
    );
  });

  it('marks empty/failed transcription clearly and still allows manual review submit', async () => {
    const { createTranscriptionFromUpload, submitReviewedTranscript } = await import('../src/ai/voice/service');
    const created = await createTranscriptionFromUpload(client.user, {
      buffer: buildSilentWav(500),
      declaredMime: 'audio/wav',
      durationMs: 500,
      languageHint: 'en',
    });
    assert.equal(created.autoSubmitted, false);
    assert.equal(created.orderPlaced, false);
    if (!created.transcript.trim()) {
      assert.equal(created.transcriptionSucceeded, false);
      assert.ok(created.error);
    }
    const submitted = await submitReviewedTranscript(client.user, {
      transcriptId: created.transcriptId,
      editedTranscript: 'Show available cold drinks.',
      language: 'en',
      submissionKey: `VOICE-MANUAL-${created.transcriptId}`,
    });
    assert.equal(submitted.orderPlaced, false);
    assert.equal(submitted.duplicate, false);
  });

  it('WhatsApp auto path does not fabricate or auto-send on empty STT', async () => {
    const { processVoiceMessageAuto } = await import('../src/ai/voice/service');
    const result = await processVoiceMessageAuto(client.user, {
      buffer: buildSilentWav(500),
      declaredMime: 'audio/wav',
      durationMs: 500,
      languageHint: 'en',
      submissionKey: `AUTO-EMPTY-${Date.now()}`,
    });
    assert.equal(result.orderPlaced, false);
    assert.ok(result.transcriptId);
    if (!result.transcriptionSucceeded) {
      assert.equal(result.autoSent, false);
      assert.equal('reply' in result, false);
    }
  });

  it(
    'live Gemini transcription (opt-in only; set GEMINI_LIVE_AUDIO_TEST=1)',
    { skip: !liveGemini || process.env.GEMINI_LIVE_AUDIO_TEST !== '1' },
    async () => {
      const { createTranscriptionFromUpload } = await import('../src/ai/voice/service');
      const created = await createTranscriptionFromUpload(client.user, {
        buffer: buildSilentWav(600),
        declaredMime: 'audio/wav',
        durationMs: 600,
        languageHint: 'en',
      });
      assert.equal(typeof created.transcript, 'string');
      assert.equal(created.autoSubmitted, false);
      // Empty silence must never be reported as a successful transcription
      if (!created.transcript.trim()) {
        assert.equal(created.transcriptionSucceeded, false);
      }
    }
  );
});
