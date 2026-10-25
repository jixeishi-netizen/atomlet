import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: 'up', ts: new Date().toISOString() });
  } catch (err) {
    return Response.json(
      { ok: false, db: 'down', error: (err as Error).message },
      { status: 503 },
    );
  }
}
