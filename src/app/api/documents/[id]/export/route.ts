import { NextResponse } from 'next/server';

import { HttpError, isValidUuid, requireDocument } from '@/db/dal';
import { getApiUser } from '@/lib/current-user';
import { markdownFilename, tipTapToMarkdown } from '@/lib/export-markdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[documents/:id/export]', error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}

/**
 * A header value is a single line of text, so a title is never interpolated
 * into one unsanitized: a quote would end the quoted filename early and a
 * newline would start a header of the attacker's choosing. `markdownFilename`
 * already returns `[a-z0-9-]+\.md`, and this strips anything outside printable
 * ASCII a second time — the header is the wrong place to trust one function.
 *
 * The `filename*` form carries the same name as percent-encoded UTF-8, which
 * is what browsers prefer when both are present (RFC 6266).
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '');
  const safe = ascii === '' ? 'document.md' : ascii;

  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** GET /api/documents/[id]/export — the document as a Markdown download. Requires read. */
export async function GET(_request: Request, ctx: RouteContext<'/api/documents/[id]/export'>) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await ctx.params;
  // Same guard as the document route: a non-uuid makes the driver throw a cast
  // error, which surfaces as a 500 on what is really a 404.
  if (!isValidUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    // Read is the weakest permission, so collaborators can export too. An
    // unauthorized caller gets 404 from the DAL, not 403 — existence stays private.
    const { doc } = await requireDocument(id, user.id, 'read');

    const markdown = tipTapToMarkdown(doc.content);
    const filename = markdownFilename(doc.title);

    return new NextResponse(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': contentDisposition(filename),
        // The export is a snapshot of a document that changes; a cached copy
        // in a shared proxy would also be a cached copy of private content.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
