import type { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const identity = `${req.ip}:${req.body?.email || req.body?.phone || 'anon'}`;
  const now = Date.now();
  const current = attempts.get(identity);

  if (!current || current.resetAt < now) {
    attempts.set(identity, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  next();
}
