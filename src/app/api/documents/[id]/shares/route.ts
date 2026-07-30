import { NextResponse } from 'next/server';

import {
  HttpError,
  findUserByEmail,
  isValidUuid,
  requireDocument,
  shareDocument,
  unshareDocument,
} from '@/db/dal';
import { getApiUser } from '@/lib/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id/shares]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/**
 * POST /api/documents/[id]/shares — grant a user access. Owner only.
 *
 * Gating this on "can edit" instead of "is owner" is the classic mistake here:
 * it would let anyone a document was shared with pass that access along, and
 * the owner would never know.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/documents/[id]/shares'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const { doc } = await requireDocument(id, user.id, 'share');

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

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return NextResponse.json({ error: 'An email is required' }, { status: 400 });

    const target = await findUserByEmail(email);
    if (!target) {
      // This is an account-enumeration oracle, and a real product would avoid
      // it by sending an invitation instead of confirming who exists. With
      // three fixed demo users there is nothing to enumerate, and a vague
      // error would make the feature untestable. Noted in the README.
      return NextResponse.json({ error: 'No user with that email address' }, { status: 404 });
    }

    if (target.id === doc.ownerId) {
      return NextResponse.json({ error: 'They already own this document' }, { status: 400 });
    }

    // Idempotent: sharing twice is a no-op rather than a constraint error.
    await shareDocument(id, target.id);
    return NextResponse.json(
      { userId: target.id, name: target.name, email: target.email },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/documents/[id]/shares — revoke access. Owner only. */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/documents/[id]/shares'>,
) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await requireDocument(id, user.id, 'share');

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

    const targetUserId = typeof body.userId === 'string' ? body.userId : '';
    if (!isValidUuid(targetUserId)) {
      return NextResponse.json({ error: 'A valid userId is required' }, { status: 400 });
    }

    await unshareDocument(id, targetUserId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
