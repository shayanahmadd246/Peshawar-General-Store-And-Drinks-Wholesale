import { GoogleGenAI, type FunctionDeclaration, Type } from '@google/genai';
import { TOOL_DECLARATIONS } from './tools';
import { SYSTEM_PROMPT, buildUserTurn } from './prompts';

/**
 * Prefer lite/latest models that still have free-tier headroom.
 * Avoid hammering gemini-3.8-flash after daily quota exhaustion (separate per-model limits).
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  'gemini-3.5-flash-lite,gemini-3-flash-preview,gemini-2.5-flash'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const MODEL_CANDIDATES = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS])];
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 25000);
const MAX_TOOL_ROUNDS = 4;
const MAX_ATTEMPTS = Number(process.env.GEMINI_RETRIES || 1);

let activeModel = PRIMARY_MODEL;
const skippedModels = new Set<string>();
let lastGeminiError: { status?: number; message: string; model?: string; at: string } | null = null;
let lastGeminiSuccessAt: string | null = null;

let client: GoogleGenAI | null = null;

export function isGeminiConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim());
}

export function getGeminiDiagnostics() {
  return {
    configured: isGeminiConfigured(),
    activeModel,
    primaryModel: PRIMARY_MODEL,
    candidates: MODEL_CANDIDATES,
    skippedModels: [...skippedModels],
    lastError: lastGeminiError,
    lastSuccessAt: lastGeminiSuccessAt,
  };
}

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function toFunctionDeclarations(): FunctionDeclaration[] {
  return TOOL_DECLARATIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(
        Object.entries((t.parameters as any).properties || {}).map(([key, schema]: [string, any]) => [
          key,
          {
            type: schema.type === 'integer' ? Type.INTEGER : Type.STRING,
            description: schema.description,
          },
        ])
      ),
      required: (t.parameters as any).required || [],
    },
  }));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini request timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyError(err: any): { status?: number; modelGone: boolean; retryable: boolean; quota: boolean; message: string } {
  const status = err?.status || err?.code;
  const message = String(err?.message || err);
  return {
    status,
    message,
    modelGone: status === 404 || /no longer available|NOT_FOUND/i.test(message),
    retryable: status === 503 || /timed out|UNAVAILABLE|high demand/i.test(message),
    quota: status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message),
  };
}

export interface GeminiToolRequest {
  name: string;
  args: Record<string, unknown>;
  callId?: string;
}

export interface GeminiRoundResult {
  text: string;
  toolRequests: GeminiToolRequest[];
  model: string;
  raw?: unknown;
}

export async function runGeminiRound(input: {
  history: { role: 'user' | 'model'; text: string }[];
  message: string;
  languageHint?: string;
  toolResults?: { name: string; response: unknown; callId?: string }[];
}): Promise<GeminiRoundResult> {
  const ai = getClient();
  const contents: any[] = [];

  for (const h of input.history.slice(-10)) {
    contents.push({ role: h.role, parts: [{ text: h.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: buildUserTurn(input.message, input.languageHint) }] });

  if (input.toolResults?.length) {
    contents.push({
      role: 'user',
      parts: input.toolResults.map((tr) => ({
        functionResponse: {
          name: tr.name,
          response: tr.response as Record<string, unknown>,
          id: tr.callId,
        },
      })),
    });
  }

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  let lastError: unknown;
  const modelsToTry = [...new Set([activeModel, ...MODEL_CANDIDATES])].filter((m) => !skippedModels.has(m));

  if (modelsToTry.length === 0) {
    const err = new Error(
      'All configured Gemini models are skipped (quota or unavailable). Deterministic agents will be used until models recover.'
    );
    lastGeminiError = { message: err.message, at: new Date().toISOString() };
    throw err;
  }

  outer: for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await withTimeout(
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              temperature: 0.2,
              maxOutputTokens: 1024,
              tools: [{ functionDeclarations: toFunctionDeclarations() }],
            },
          }),
          TIMEOUT_MS
        );
        activeModel = model;
        lastGeminiSuccessAt = new Date().toISOString();
        lastGeminiError = null;
        lastError = undefined;
        break outer;
      } catch (err: any) {
        lastError = err;
        const info = classifyError(err);
        lastGeminiError = {
          status: info.status,
          message: info.message.slice(0, 240),
          model,
          at: new Date().toISOString(),
        };
        if (info.modelGone || info.quota) {
          skippedModels.add(model);
          console.warn(`[gemini] skipping model ${model}: status=${info.status || 'n/a'} quota=${info.quota}`);
          break;
        }
        if (!info.retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }
  if (!response) throw lastError || new Error('Gemini request failed');

  const toolRequests: GeminiToolRequest[] = [];
  let text = '';
  const parts = response.candidates?.[0]?.content?.parts || [];
  for (const part of parts as any[]) {
    if (part.text) text += part.text;
    if (part.functionCall?.name) {
      toolRequests.push({
        name: part.functionCall.name,
        args: (part.functionCall.args || {}) as Record<string, unknown>,
        callId: part.functionCall.id,
      });
    }
  }

  return { text: text.trim(), toolRequests, model: activeModel, raw: response };
}

export function getGeminiModelName(): string {
  return activeModel;
}

export { MAX_TOOL_ROUNDS };
