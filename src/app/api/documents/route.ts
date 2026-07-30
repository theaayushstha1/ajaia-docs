import { NextResponse } from 'next/server';

import { createDocument } from '@/db/dal';
import { EMPTY_DOC } from '@/db/schema';
import { getApiUser } from '@/lib/current-user';
import { MAX_IMPORT_BYTES, textToTipTapDoc, titleFromFilename } from '@/lib/import-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TITLE_LENGTH = 200;

/**
 * POST /api/documents
 *
 * Two ways in, one document out:
 *   - multipart/form-data with a `file` field  -> import a .txt
 *   - application/json { title? }              -> blank document
 */
export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Malformed upload' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was included' }, { status: 400 });
    }

    // Only .txt is supported. Word documents are a deliberate scope cut —
    // see the README; parsing them safely is its own project.
    // MIME values are supplied by the client and browsers commonly report
    // Markdown and other text files as text/plain. The product contract is
    // specifically .txt, so the filename suffix is the authoritative gate.
    if (!file.name.toLowerCase().endsWith('.txt')) {
      return NextResponse.json(
        { error: 'Only plain-text .txt files can be imported.' },
        { status: 415 },
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: `That file is too large. The limit is ${MAX_IMPORT_BYTES / 1024} KB.` },
        { status: 413 },
      );
    }

    const text = await file.text();
    // textToTipTapDoc puts every character into a TipTap text node, so markup
    // in the upload stays literal text and can never become live markup.
    const content = textToTipTapDoc(text);
    const title = titleFromFilename(file.name);

    const doc = await createDocument(user.id, title, content);
    return NextResponse.json({ id: doc.id, title: doc.title }, { status: 201 });
  }

  let title = 'Untitled document';
  try {
    const body = await request.json();
    if (typeof body?.title === 'string' && body.title.trim()) {
      title = body.title.trim().slice(0, MAX_TITLE_LENGTH);
    }
  } catch {
    // No body is fine — that's just "create me a blank document".
  }

  const doc = await createDocument(user.id, title, EMPTY_DOC);
  return NextResponse.json({ id: doc.id, title: doc.title }, { status: 201 });
}
