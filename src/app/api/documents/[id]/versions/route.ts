import { NextResponse } from 'next/server';

import { HttpError, isValidUuid } from '@/db/dal';
import { listVersions, snapshotDocument } from '@/db/versions';
import { getApiUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id/versions]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/**
 * GET /api/documents/[id]/versions — the last 20 versions, newest first.
 *
 * The access check lives in the data layer, so a caller with no relationship to
 * the document gets a 404 from `requireDocument` rather than a 403. That is the
 * same non-disclosure the rest of the API gives: no endpoint confirms that a
 * document id exists to someone who cannot see it.
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/documents/[id]/versions'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  // Guard before the value reaches Postgres: a non-uuid string makes the
  // driver throw a cast error, which surfaces as a 500 instead of a 404.
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const versions = await listVersions(id, user.id);
    return NextResponse.json({ versions });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/documents/[id]/versions — "save a version now". Requires edit. */
export async function POST(_request: Request, ctx: RouteContext<'/api/documents/[id]/versions'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const version = await snapshotDocument(id, user.id);
    // Deliberately not echoing the content back: the caller already has it, and
    // the list endpoint is the only shape the panel renders.
    return NextResponse.json(
      { id: version.id, title: version.title, createdAt: version.createdAt },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
