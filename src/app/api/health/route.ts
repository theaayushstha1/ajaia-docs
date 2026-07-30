import { pool } from '@/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await pool.query('SELECT 1');
    return Response.json({ ok: true, db: 'up' });
  } catch (err) {
    console.error('[health] db check failed', err);
    return Response.json({ ok: false, db: 'down' }, { status: 503 });
  }
}
