import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; resetAt: number }>();

export function aiChatRateLimit(req: Request, res: Response, next: NextFunction) {
  const identity = `${req.ip}:${req.user?.id || 'anon'}`;
  const now = Date.now();
  const current = hits.get(identity);

  if (!current || current.resetAt < now) {
    hits.set(identity, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many AI chat requests. Please wait a moment.' });
  }
  next();
}
