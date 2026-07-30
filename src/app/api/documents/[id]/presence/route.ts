import { NextResponse } from 'next/server';

import { HttpError, isValidUuid } from '@/db/dal';
import { PRESENCE_TTL_SECONDS, touchAndList } from '@/db/presence';
import { getApiUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id/presence]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/**
 * POST /api/documents/[id]/presence — heartbeat, and read back who else is here.
 *
 * POST rather than GET because it writes: it upserts the caller's presence row
 * before reading. A GET that mutates would be wrong on its own terms, and it
 * would also be caught by anything that treats GET as safe to retry or cache —
 * a proxy or a prefetch could silently mark someone as present.
 *
 * One endpoint does both halves so the client needs a single request per poll
 * rather than two. See src/db/presence.ts for why this is polled at all.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/documents/[id]/presence'>,
) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  // Same guard as the other document routes: a non-uuid reaching Postgres
  // throws a cast error, which would surface as a 500 instead of a 404.
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    // No 403 branch here on purpose. `requireDocument(..., 'read')` inside
    // touchAndList already 404s anyone without access, and every role that can
    // read can also be present — there is no "can read but may not appear"
    // state to express.
    const viewers = await touchAndList(id, user.id);
    return NextResponse.json(
      { viewers, ttlSeconds: PRESENCE_TTL_SECONDS },
      {
        // Belt and braces against an intermediary caching a presence read:
        // a stale viewer list is worse than no viewer list.
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
