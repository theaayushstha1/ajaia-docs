import { NextResponse } from 'next/server';

import { HttpError, deleteDocument, isValidUuid, requireDocument, updateDocument } from '@/db/dal';
import type { TipTapDoc } from '@/db/schema';
import { validateTipTapContent } from '@/lib/content-validation';
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
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
      }
      body = value as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }

    const hasTitle = Object.hasOwn(body, 'title');
    const hasContent = Object.hasOwn(body, 'content');

    if (hasTitle && typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Title must be a string' }, { status: 400 });
    }
    // A mixed title/content request from a collaborator is rejected before
    // either value is written. Owners may rename and save content together.
    await requireDocument(id, user.id, hasTitle ? 'rename' : 'edit');

    // Strict allowlist, never a spread of the request body. Assigning the
    // whole body would let a collaborator set `ownerId` and take the document.
    const patch: { title?: string; content?: TipTapDoc } = {};
    if (hasTitle) {
      const title = (body.title as string).trim().slice(0, MAX_TITLE_LENGTH);
      patch.title = title.length > 0 ? title : 'Untitled document';
    }
    // The editor is the only intended producer of this value, but it arrives
    // over an open HTTP endpoint, so it gets validated like anything else:
    // node types against an allowlist, plus depth, node-count and byte
    // ceilings. Without the ceilings an unbounded document is a cheap way to
    // exhaust the column and the renderer.
    if (hasContent) {
      const result = validateTipTapContent(body.content);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.message, code: result.code },
          { status: result.status },
        );
      }
      patch.content = result.content as TipTapDoc;
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
