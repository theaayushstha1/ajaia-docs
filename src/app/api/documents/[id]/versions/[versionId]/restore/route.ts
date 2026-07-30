import { NextResponse } from 'next/server';

import { HttpError, isValidUuid } from '@/db/dal';
import { restoreVersion } from '@/db/versions';
import { getApiUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id/versions/:versionId/restore]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/**
 * POST /api/documents/[id]/versions/[versionId]/restore — put an old version
 * back. Owner only because a stored version includes the title as well as the
 * body; the current state is snapshotted first so the restore can itself be
 * undone.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<'/api/documents/[id]/versions/[versionId]/restore'>,
) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id, versionId } = await ctx.params;
  // Both ids are guarded: either one reaching Postgres as a non-uuid is a cast
  // error, which would surface as a 500 instead of a 404.
  if (!isValidUuid(id) || !isValidUuid(versionId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const updated = await restoreVersion(versionId, id, user.id);
    return NextResponse.json({
      id: updated.id,
      title: updated.title,
      content: updated.content,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
