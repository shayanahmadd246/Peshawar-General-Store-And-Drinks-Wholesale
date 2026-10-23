import 'dotenv/config';
import { runMigrations } from '../src/db/migrate.ts';
import { bootstrapProductionAdmin } from '../src/auth/bootstrapAdmin.ts';

await runMigrations();
const result = await bootstrapProductionAdmin();
console.log(JSON.stringify(result));
process.exit(result.created || result.reason === 'admin_exists' ? 0 : 1);
