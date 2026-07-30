import { NextResponse } from 'next/server';

import { HttpError, deleteDocument, isValidUuid, requireDocument, updateDocument } from '@/db/dal';
import { getApiUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TITLE_LENGTH = 200;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/** PATCH /api/documents/[id] — rename and/or save content. Requires edit. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/documents/[id]'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  // Guard before the value reaches Postgres: a non-uuid string makes the
  // driver throw a cast error, which surfaces as a 500 instead of a 404.
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await requireDocument(id, user.id, 'edit');

    const body = await request.json();

    // Strict allowlist, never a spread of the request body. Assigning the
    // whole body would let a collaborator set `ownerId` and take the document.
    const patch: { title?: string; content?: unknown } = {};
    if (typeof body?.title === 'string') {
      const title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
      patch.title = title.length > 0 ? title : 'Untitled document';
    }
    if (body?.content && typeof body.content === 'object') {
      patch.content = body.content;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const updated = await updateDocument(id, patch);
    return NextResponse.json({ id: updated.id, title: updated.title, updatedAt: updated.updatedAt });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/documents/[id] — owners only; collaborators get a 403. */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/documents/[id]'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await requireDocument(id, user.id, 'delete');
    await deleteDocument(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
