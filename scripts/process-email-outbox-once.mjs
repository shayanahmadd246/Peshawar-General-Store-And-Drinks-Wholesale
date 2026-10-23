/**
 * One-shot email outbox processor for host cron / external schedulers.
 * Does not start the HTTP server. Safe to run every 1–2 minutes.
 * Honors MAIL_DRY_RUN — never bulk-sends older local pending mail unless SMTP is live
 * and those rows exist in the production database (preview DBs start empty).
 */
import 'dotenv/config';
import { runMigrations } from '../src/db/migrate.ts';
import { processEmailOutbox, getOutboxStats } from '../src/email/outbox.ts';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

await runMigrations();
const result = await processEmailOutbox(40);
const stats = await getOutboxStats();
console.log(JSON.stringify({ ok: true, ...result, stats }));
process.exit(0);
