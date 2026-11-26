import 'dotenv/config';
import mysql from 'mysql2/promise';
import fs from 'node:fs';

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL, connectionLimit: 20, timezone: 'Z',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  typeCast: (f, next) => (f.type === 'TINY' && f.length === 1 ? f.string() === '1' : next()),
});
pool.pool.on('connection', (c) => c.query("SET time_zone='+00:00'"));

export async function init() {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
}

// Runs fn inside a transaction on one connection; rolls back on any throw.
export async function tx(fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}
