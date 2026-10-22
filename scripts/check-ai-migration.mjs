import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const t = await c.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('conversations','chat_messages','ai_tool_calls') ORDER BY tablename`
);
const m = await c.query(`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`);
console.log('tables', t.rows);
console.log('migrations', m.rows);
await c.end();
