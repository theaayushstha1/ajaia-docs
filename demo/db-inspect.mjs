/** Read-only: prints the table + column names the recorder's setup needs. */
import { config } from 'dotenv';
import pg from 'pg';

config({ path: new URL('../.env.local', import.meta.url).pathname });

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
});

const { rows } = await pool.query(
  `select table_name, column_name from information_schema.columns
   where table_schema = 'public' order by table_name, ordinal_position`,
);
const byTable = new Map();
for (const r of rows) {
  if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
  byTable.get(r.table_name).push(r.column_name);
}
for (const [t, cols] of byTable) console.log(t, '->', cols.join(', '));
await pool.end();
