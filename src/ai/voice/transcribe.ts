import { GoogleGenAI } from '@google/genai';
import { isGeminiConfigured } from '../gemini';
import { parseIntent } from '../intents';
import type { ChatLanguage } from '../types';

/** Prefer lite/transcribe models; avoid exhausted gemini-3.8-flash by default. */
const TRANSCRIBE_MODELS = (
  process.env.GEMINI_TRANSCRIBE_MODELS ||
  'gemini-flash-lite-latest,gemini-3.5-transcribe,gemini-3.5-flash-lite'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const TIMEOUT_MS = Number(process.env.GEMINI_TRANSCRIBE_TIMEOUT_MS || 45000);
const skippedTranscribeModels = new Set<string>();

export interface TranscriptionResult {
  transcript: string;
  detectedLanguage: ChatLanguage;
  geminiUsed: boolean;
  model?: string;
  confidenceNote?: string;
}

function getClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return new GoogleGenAI({ apiKey });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Transcription timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseStructured(text: string): { transcript: string; language: ChatLanguage } {
  const cleaned = String(text || '').trim();
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const transcript = String(parsed.transcript || parsed.text || '').trim();
      const langRaw = String(parsed.language || parsed.detectedLanguage || 'en').toLowerCase();
      const language: ChatLanguage =
        langRaw.startsWith('ps') || langRaw.includes('pashto')
          ? 'ps'
          : langRaw.startsWith('ur') || langRaw.includes('urdu')
            ? 'ur'
            : langRaw.includes('mix')
              ? 'mixed'
              : 'en';
      if (transcript) return { transcript, language };
    }
  } catch {
    // fall through
  }
  // Plain transcript (non-JSON) from dedicated transcribe models
  if (cleaned && !cleaned.startsWith('{')) {
    const intent = parseIntent(cleaned);
    return { transcript: cleaned.slice(0, 2000), language: intent.language };
  }
  const intent = parseIntent(cleaned);
  return { transcript: cleaned.slice(0, 2000), language: intent.language };
}

const PROMPT = `Transcribe the shopkeeper's speech for a wholesale ordering assistant.
Return ONLY compact JSON:
{"transcript":"...","language":"en"|"ur"|"ps"|"mixed"}
Rules:
- Preserve product names, quantities, and units (carton/peti/bag/kg/piece).
- Support English, Urdu, Pashto, Roman Urdu, and mixed speech.
- Do not invent products or place orders.
- If audio is silent/unintelligible, return {"transcript":"","language":"en"}.`;

export async function transcribeAudioBuffer(input: {
  buffer: Buffer;
  mimeType: string;
  languageHint?: string;
}): Promise<TranscriptionResult> {
  if (!isGeminiConfigured()) {
    return {
      transcript: '',
      detectedLanguage: 'en',
      geminiUsed: false,
      confidenceNote: 'Gemini is not configured; transcription unavailable.',
    };
  }

  const ai = getClient();
  const base64 = input.buffer.toString('base64');
  let lastError: unknown;
  const models = TRANSCRIBE_MODELS.filter((m) => !skippedTranscribeModels.has(m));

  if (models.length === 0) {
    throw Object.assign(new Error('All transcription models skipped due to quota/unavailability'), { status: 429 });
  }

  for (const model of models) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${PROMPT}\nUI language hint: ${input.languageHint || 'auto'}`,
                },
                {
                  inlineData: {
                    mimeType: input.mimeType,
                    data: base64,
                  },
                },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            maxOutputTokens: 512,
          },
        }),
        TIMEOUT_MS
      );

      const text = response.text || '';
      const parsed = parseStructured(text);
      return {
        transcript: parsed.transcript,
        detectedLanguage: parsed.language,
        geminiUsed: true,
        model,
      };
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;
      const msg = String(err?.message || err);
      if (status === 404 || status === 429 || /no longer available|NOT_FOUND|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
        skippedTranscribeModels.add(model);
        console.warn(`[stt] skipping model ${model}: status=${status || 'n/a'}`);
        continue;
      }
      // 503 etc. — try next model once
      continue;
    }
  }

  throw lastError || new Error('Transcription failed');
}
