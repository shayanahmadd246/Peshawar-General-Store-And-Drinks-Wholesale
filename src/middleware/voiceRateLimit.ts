import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60 * 1000;
const MAX_UPLOADS = 10;
const MAX_TTS = 12;
const uploads = new Map<string, { count: number; resetAt: number }>();
const ttsHits = new Map<string, { count: number; resetAt: number }>();

function limit(map: Map<string, { count: number; resetAt: number }>, key: string, max: number, message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const identity = `${req.ip}:${req.user?.id || 'anon'}:${key}`;
    const now = Date.now();
    const current = map.get(identity);
    if (!current || current.resetAt < now) {
      map.set(identity, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

export const voiceUploadRateLimit = limit(
  uploads,
  'upload',
  MAX_UPLOADS,
  'Too many voice uploads. Please wait a moment.'
);

export const voiceTtsRateLimit = limit(ttsHits, 'tts', MAX_TTS, 'Too many voice playback requests. Please wait.');
