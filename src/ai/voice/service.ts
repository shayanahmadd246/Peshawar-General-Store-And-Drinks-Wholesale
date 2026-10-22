import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db';
import { audioAssets, voiceTranscripts } from '../../db/schema';
import type { AuthUser } from '../../auth/types';
import { HttpError } from '../../auth/rbac';
import { getOrCreateConversation } from '../conversations';
import { handleShopkeeperChat } from '../orchestrator';
import { validateAudioUpload } from './audioValidate';
import { checksumBuffer, extensionForMime, readVoiceRelative, saveVoiceBuffer } from './storage';
import { transcribeAudioBuffer } from './transcribe';
import { synthesizeSpeech } from './tts';
import type { ChatLanguage } from '../types';

function assertClient(user: AuthUser) {
  if (user.role !== 'client') throw new HttpError(403, 'Only shopkeepers can use voice features.');
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export async function createTranscriptionFromUpload(
  user: AuthUser,
  input: {
    buffer: Buffer;
    declaredMime?: string | null;
    durationMs?: number | null;
    conversationId?: string;
    languageHint?: string;
  }
) {
  assertClient(user);
  const validated = validateAudioUpload({
    buffer: input.buffer,
    declaredMime: input.declaredMime,
    durationMs: input.durationMs,
  });

  const conversation = await getOrCreateConversation(user, input.conversationId, input.languageHint || 'en');
  const assetId = newId('AUD');
  const saved = await saveVoiceBuffer({
    clientId: user.id,
    assetId,
    extension: extensionForMime(validated.mimeType),
    buffer: input.buffer,
  });

  await getDb().insert(audioAssets).values({
    id: assetId,
    clientId: user.id,
    conversationId: conversation.id,
    kind: 'upload',
    mimeType: validated.mimeType,
    byteSize: input.buffer.length,
    durationMs: input.durationMs ?? null,
    storagePath: saved.relativePath,
    checksum: checksumBuffer(input.buffer),
  });

  let transcript = '';
  let detectedLanguage: ChatLanguage = 'en';
  let geminiUsed = false;
  let error: string | null = null;
  let errorCode: 'quota' | 'unavailable' | 'no_speech' | 'failed' | null = null;

  try {
    const result = await transcribeAudioBuffer({
      buffer: input.buffer,
      mimeType: validated.mimeType,
      languageHint: input.languageHint,
    });
    transcript = result.transcript;
    detectedLanguage = result.detectedLanguage;
    geminiUsed = result.geminiUsed;
    if (!geminiUsed) {
      errorCode = 'unavailable';
      error =
        'Speech transcription is unavailable right now. Type what you said below, or use text chat.';
    } else if (!transcript.trim()) {
      errorCode = 'no_speech';
      error =
        'No speech detected in the recording. Type your request below, or re-record with clearer audio.';
    }
  } catch (err: any) {
    const status = err?.status || err?.code;
    const msg = String(err?.message || err);
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      errorCode = 'quota';
      error =
        'Gemini quota reached (HTTP 429). Voice transcription paused — type your message below or use text chat. Ordering still works.';
    } else {
      errorCode = 'failed';
      error = 'Transcription failed. Type your request below, re-record, or use text chat.';
    }
    // Avoid logging transcripts/audio content
    console.error('Voice transcription failed:', status || 'unknown');
  }

  const transcriptionSucceeded = Boolean(geminiUsed && transcript.trim() && !errorCode);

  const transcriptId = newId('VTX');
  await getDb().insert(voiceTranscripts).values({
    id: transcriptId,
    clientId: user.id,
    conversationId: conversation.id,
    audioAssetId: assetId,
    rawTranscript: transcript.slice(0, 4000),
    editedTranscript: null,
    detectedLanguage,
    status: 'pending_review',
    geminiUsed,
    error,
  });

  return {
    transcriptId,
    audioAssetId: assetId,
    conversationId: conversation.id,
    transcript,
    detectedLanguage,
    geminiUsed,
    transcriptionSucceeded,
    status: 'pending_review' as const,
    error,
    errorCode,
    requiresReview: true,
    autoSubmitted: false,
    autoSent: false,
    orderPlaced: false,
  };
}

/** WhatsApp-style: upload → STT → auto-send to orchestrator when transcript succeeds. */
export async function processVoiceMessageAuto(
  user: AuthUser,
  input: {
    buffer: Buffer;
    declaredMime?: string | null;
    durationMs?: number | null;
    conversationId?: string;
    languageHint?: string;
    submissionKey?: string;
  }
) {
  const transcribed = await createTranscriptionFromUpload(user, input);
  if (!transcribed.transcriptionSucceeded || !transcribed.transcript.trim()) {
    return {
      ...transcribed,
      autoSent: false,
      orderPlaced: false,
    };
  }

  const submissionKey =
    String(input.submissionKey || '').trim() || `AUTO-${transcribed.transcriptId}`;
  const submitted = await submitReviewedTranscript(user, {
    transcriptId: transcribed.transcriptId,
    editedTranscript: transcribed.transcript,
    conversationId: transcribed.conversationId,
    language: transcribed.detectedLanguage,
    submissionKey,
  });

  if ('reply' in submitted) {
    return {
      ...transcribed,
      ...submitted,
      autoSent: !submitted.duplicate,
      autoSubmitted: !submitted.duplicate,
      orderPlaced: false,
    };
  }

  return {
    ...transcribed,
    ...submitted,
    autoSent: false,
    orderPlaced: false,
  };
}

export async function submitReviewedTranscript(
  user: AuthUser,
  input: {
    transcriptId: string;
    editedTranscript: string;
    conversationId?: string;
    language?: string;
    submissionKey: string;
  }
) {
  assertClient(user);
  const submissionKey = String(input.submissionKey || '').trim().slice(0, 120);
  if (!submissionKey) throw new HttpError(400, 'submissionKey is required to prevent duplicate voice submits.');

  const edited = String(input.editedTranscript || '').trim().slice(0, 2000);
  if (!edited) throw new HttpError(400, 'Reviewed transcript is required before sending to the assistant.');

  const [existingByKey] = await getDb()
    .select()
    .from(voiceTranscripts)
    .where(and(eq(voiceTranscripts.submissionKey, submissionKey), eq(voiceTranscripts.clientId, user.id)))
    .limit(1);
  if (existingByKey && existingByKey.status === 'submitted') {
    // Idempotent replay — do not re-run AI or place orders
    return {
      duplicate: true,
      transcriptId: existingByKey.id,
      conversationId: existingByKey.conversationId,
      orderPlaced: false,
      alreadySubmitted: true,
    };
  }

  const [row] = await getDb()
    .select()
    .from(voiceTranscripts)
    .where(and(eq(voiceTranscripts.id, input.transcriptId), eq(voiceTranscripts.clientId, user.id)))
    .limit(1);
  if (!row) throw new HttpError(404, 'Transcript not found.');
  if (row.status === 'submitted') {
    throw new HttpError(409, 'This voice transcript was already submitted. Start a new recording.');
  }

  await getDb()
    .update(voiceTranscripts)
    .set({
      editedTranscript: edited,
      status: 'submitted',
      submissionKey,
      submittedAt: new Date(),
      detectedLanguage: input.language || row.detectedLanguage,
    })
    .where(eq(voiceTranscripts.id, row.id));

  const chat = await handleShopkeeperChat(user, {
    message: edited,
    conversationId: input.conversationId || row.conversationId || undefined,
    language: input.language || row.detectedLanguage || 'en',
  });

  return {
    duplicate: false,
    alreadySubmitted: false,
    transcriptId: row.id,
    orderPlaced: false,
    requiresCheckoutConfirmation: chat.needsConfirmation,
    ...chat,
  };
}

export async function synthesizeAssistantReply(
  user: AuthUser,
  input: { text: string; language?: string; conversationId?: string }
) {
  assertClient(user);
  const language = (input.language || 'en') as ChatLanguage;
  const result = await synthesizeSpeech({ text: input.text, language });

  if (!result.ok || !result.audioBase64) {
    return {
      ok: false,
      fallbackReason: result.fallbackReason,
      nativeLanguageReliable: result.nativeLanguageReliable,
      language: result.language,
      orderPlaced: false,
    };
  }

  const buffer = Buffer.from(result.audioBase64, 'base64');
  const assetId = newId('TTS');
  const mimeType = result.mimeType || 'audio/wav';
  const saved = await saveVoiceBuffer({
    clientId: user.id,
    assetId,
    extension: extensionForMime(mimeType),
    buffer,
  });

  let conversationId = input.conversationId || null;
  if (conversationId) {
    // ownership check via conversation get
    try {
      await getOrCreateConversation(user, conversationId);
    } catch {
      conversationId = null;
    }
  }

  await getDb().insert(audioAssets).values({
    id: assetId,
    clientId: user.id,
    conversationId,
    kind: 'tts',
    mimeType,
    byteSize: buffer.length,
    durationMs: null,
    storagePath: saved.relativePath,
    checksum: checksumBuffer(buffer),
  });

  return {
    ok: true,
    audioAssetId: assetId,
    mimeType,
    audioBase64: result.audioBase64,
    model: result.model,
    language: result.language,
    nativeLanguageReliable: result.nativeLanguageReliable,
    fallbackReason: result.fallbackReason,
    orderPlaced: false,
  };
}

export async function getOwnedAudio(user: AuthUser, assetId: string) {
  assertClient(user);
  const [asset] = await getDb()
    .select()
    .from(audioAssets)
    .where(and(eq(audioAssets.id, assetId), eq(audioAssets.clientId, user.id)))
    .limit(1);
  if (!asset) throw new HttpError(404, 'Audio not found.');
  const buffer = await readVoiceRelative(asset.storagePath);
  return { asset, buffer };
}
