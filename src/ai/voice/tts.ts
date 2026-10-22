import { GoogleGenAI } from '@google/genai';
import { isGeminiConfigured } from '../gemini';
import type { ChatLanguage } from '../types';

const TTS_MODELS = (process.env.GEMINI_TTS_MODELS || 'gemini-3.8-flash-tts,gemini-2.5-flash-preview-tts')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const TIMEOUT_MS = Number(process.env.GEMINI_TTS_TIMEOUT_MS || 30000);

export interface TtsResult {
  ok: boolean;
  mimeType?: string;
  audioBase64?: string;
  model?: string;
  language: ChatLanguage;
  fallbackReason?: string;
  nativeLanguageReliable: boolean;
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  return new GoogleGenAI({ apiKey });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TTS timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function languageCode(language: ChatLanguage): string | undefined {
  if (language === 'en') return 'en-US';
  if (language === 'ur') return 'ur-PK';
  if (language === 'ps') return undefined; // do not claim native Pashto TTS
  return 'en-US';
}

/**
 * Optional Gemini TTS. Pashto (and unreliable Urdu) must not be claimed as native-quality.
 * Failures return a text-only fallback descriptor — never throw into order flow.
 */
export async function synthesizeSpeech(input: {
  text: string;
  language: ChatLanguage;
}): Promise<TtsResult> {
  const text = String(input.text || '').trim().slice(0, 1200);
  if (!text) {
    return {
      ok: false,
      language: input.language,
      nativeLanguageReliable: false,
      fallbackReason: 'Empty text.',
    };
  }

  if (!isGeminiConfigured()) {
    return {
      ok: false,
      language: input.language,
      nativeLanguageReliable: false,
      fallbackReason: 'Gemini is not configured for TTS.',
    };
  }

  // Pashto: explicit text-only fallback — do not claim native synthesis works
  if (input.language === 'ps') {
    return {
      ok: false,
      language: 'ps',
      nativeLanguageReliable: false,
      fallbackReason:
        'Pashto text-to-speech is not verified on this deployment. Showing text only; ordering still works.',
    };
  }

  const ai = getClient();
  const langCode = languageCode(input.language);
  let lastError = '';

  for (const model of TTS_MODELS) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
              ...(langCode ? { languageCode: langCode } : {}),
            },
          } as any,
        }),
        TIMEOUT_MS
      );

      const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data) as any;
      const data = part?.inlineData?.data;
      const mime = part?.inlineData?.mimeType || 'audio/wav';
      if (!data) {
        lastError = 'No audio returned';
        continue;
      }

      const reliable = input.language === 'en';
      return {
        ok: true,
        mimeType: mime,
        audioBase64: typeof data === 'string' ? data : Buffer.from(data).toString('base64'),
        model,
        language: input.language,
        nativeLanguageReliable: reliable,
        fallbackReason:
          input.language === 'ur'
            ? 'Urdu speech may be approximate; prefer reading the on-screen text if pronunciation sounds wrong.'
            : undefined,
      };
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 200);
      continue;
    }
  }

  return {
    ok: false,
    language: input.language,
    nativeLanguageReliable: false,
    fallbackReason: `Voice playback unavailable (${lastError || 'TTS failed'}). Text reply is still available.`,
  };
}
