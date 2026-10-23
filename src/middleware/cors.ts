import type { Request, Response, NextFunction } from 'express';

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || process.env.APP_BASE_URL || '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** Reflect allowed browser origins (Vercel frontend → API host). */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const allowed = allowedOrigins();

  if (origin && (allowed.length === 0 || allowed.includes(origin) || allowed.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}
