import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('FAIL: DATABASE_URL missing');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 8000 });
try {
  const r = await pool.query('select current_database() as db, current_user as usr, version() as v');
  console.log(`OK connected db=${r.rows[0].db} user=${r.rows[0].usr}`);
  console.log(`version=${String(r.rows[0].v).split(',')[0]}`);
  await pool.end();
} catch (e) {
  console.error('FAIL', e.message);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
}
