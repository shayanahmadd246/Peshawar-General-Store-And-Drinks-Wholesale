import { HttpError } from '../../auth/rbac';

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_DURATION_MS = 60_000;
export const MIN_AUDIO_BYTES = 256;

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/flac',
]);

export type DetectedAudioFormat = 'webm' | 'ogg' | 'wav' | 'mp3' | 'mp4' | 'flac' | 'unknown';

export function normalizeMime(mime?: string | null): string {
  return String(mime || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
}

export function detectAudioFormat(buffer: Buffer): DetectedAudioFormat {
  if (buffer.length < 12) return 'unknown';
  // WebM / Matroska EBML
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm';
  // OGG
  if (buffer.slice(0, 4).toString('ascii') === 'OggS') return 'ogg';
  // WAV RIFF
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WAVE') return 'wav';
  // FLAC
  if (buffer.slice(0, 4).toString('ascii') === 'fLaC') return 'flac';
  // MP3 ID3 or frame sync
  if (buffer.slice(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  // MP4 / M4A ftyp
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  return 'unknown';
}

export function formatToMime(format: DetectedAudioFormat, declared?: string): string {
  switch (format) {
    case 'webm':
      return 'audio/webm';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'mp4':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    default:
      return normalizeMime(declared) || 'application/octet-stream';
  }
}

export function validateAudioUpload(input: {
  buffer: Buffer;
  declaredMime?: string | null;
  durationMs?: number | null;
}): { mimeType: string; format: DetectedAudioFormat } {
  if (!input.buffer?.length || input.buffer.length < MIN_AUDIO_BYTES) {
    throw new HttpError(400, 'Audio recording is empty or too short.');
  }
  if (input.buffer.length > MAX_AUDIO_BYTES) {
    throw new HttpError(400, `Audio exceeds maximum size of ${MAX_AUDIO_BYTES} bytes.`);
  }
  if (input.durationMs != null && (input.durationMs < 200 || input.durationMs > MAX_AUDIO_DURATION_MS)) {
    throw new HttpError(400, `Recording duration must be between 0.2s and ${MAX_AUDIO_DURATION_MS / 1000}s.`);
  }

  const declared = normalizeMime(input.declaredMime);
  if (declared && !ALLOWED_MIME.has(declared) && !ALLOWED_MIME.has(input.declaredMime || '')) {
    // allow codec-suffixed declared values already covered by set; reject others
    const baseOk = [...ALLOWED_MIME].some((m) => declared === m || declared.startsWith(m.split(';')[0]));
    if (!baseOk) {
      throw new HttpError(400, `Unsupported audio type: ${declared}`);
    }
  }

  const format = detectAudioFormat(input.buffer);
  if (format === 'unknown') {
    throw new HttpError(400, 'Could not verify audio file signature. Use WebM, OGG, WAV, MP3, or M4A.');
  }

  // Declared MIME must not contradict signature when both present
  if (declared) {
    const mismatch =
      (format === 'webm' && !declared.includes('webm')) ||
      (format === 'ogg' && !declared.includes('ogg')) ||
      (format === 'wav' && !declared.includes('wav') && !declared.includes('wave')) ||
      (format === 'mp3' && !declared.includes('mpeg') && !declared.includes('mp3')) ||
      (format === 'mp4' && !declared.includes('mp4') && !declared.includes('m4a') && !declared.includes('aac')) ||
      (format === 'flac' && !declared.includes('flac'));
    if (mismatch) {
      throw new HttpError(400, 'Declared MIME type does not match audio file contents.');
    }
  }

  return { mimeType: formatToMime(format, declared), format };
}
