/**
 * Seeds the demo state.
 *
 * This runs outside the Next.js runtime, so it loads `.env.local` itself —
 * and it must do that *before* importing the database client, which reads
 * connection settings at module scope.
 *
 * The seed is idempotent: fixed UUIDs plus upserts mean running it twice is a
 * no-op rather than a pile of duplicates.
 */

import { config } from 'dotenv';

config({ path: '.env.local' });

import type { TipTapDoc } from '@/db/schema';

const ADA = '11111111-1111-4111-8111-111111111111';
const GRACE = '22222222-2222-4222-8222-222222222222';
const ALAN = '33333333-3333-4333-8333-333333333333';

const DOC_PLANNING = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOC_RUNBOOK = 'aaaaaaaa-0000-4000-8000-000000000002';
const DOC_DESIGN_REVIEW = 'bbbbbbbb-0000-4000-8000-000000000001';

const demoUsers = [
  { id: ADA, name: 'Ada Lovelace', email: 'ada@ajaia.demo' },
  { id: GRACE, name: 'Grace Hopper', email: 'grace@ajaia.demo' },
  // Alan deliberately has access to nothing. He exists so the "a signed-in
  // stranger gets a 404, not a 403" behaviour can be demonstrated live.
  { id: ALAN, name: 'Alan Turing', email: 'alan@ajaia.demo' },
] as const;

/** Helpers so the documents below read as prose instead of as a syntax tree. */
const text = (value: string) => ({ type: 'text', text: value });
const bold = (value: string) => ({
  type: 'text',
  marks: [{ type: 'bold' }],
  text: value,
});
const italic = (value: string) => ({
  type: 'text',
  marks: [{ type: 'italic' }],
  text: value,
});
const underline = (value: string) => ({
  type: 'text',
  marks: [{ type: 'underline' }],
  text: value,
});
const heading = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const item = (...content: unknown[]) => ({
  type: 'listItem',
  content: [{ type: 'paragraph', content }],
});
const bulletList = (...items: unknown[]) => ({ type: 'bulletList', content: items });
const orderedList = (...items: unknown[]) => ({ type: 'orderedList', content: items });

const planningDoc: TipTapDoc = {
  type: 'doc',
  content: [
    heading(1, 'Q3 Product Planning'),
    paragraph(
      text('Three things decide the quarter. Everything else is '),
      italic('negotiable'),
      text('.'),
    ),
    heading(2, 'Priorities'),
    orderedList(
      item(
        bold('Import fidelity'),
        text(' — a document that arrives broken is never trusted again.'),
      ),
      item(
        bold('Sharing'),
        text(' — the moment a second person touches a document, it becomes a product.'),
      ),
      item(
        bold('Latency'),
        text(' — under 100ms to first keystroke, or it feels like a form.'),
      ),
    ),
    heading(2, 'Open questions'),
    bulletList(
      item(text('Do we need presence indicators before comments, or after?')),
      item(text('What happens to a shared document when its owner leaves?')),
      item(underline('Decide by Friday'), text(' — this blocks the schema.')),
    ),
    paragraph(
      text('Notes from the last review are in '),
      italic('Onboarding Runbook'),
      text('.'),
    ),
  ],
} as TipTapDoc;

const runbookDoc: TipTapDoc = {
  type: 'doc',
  content: [
    heading(1, 'Onboarding Runbook'),
    paragraph(text('What a new engineer should be able to do on day one.')),
    heading(2, 'Before lunch'),
    bulletList(
      item(text('Clone the repo and get the test suite green locally.')),
      item(text('Read the architecture note. Ask about anything that looks arbitrary.')),
      item(text('Ship something small to production. Anything.')),
    ),
    heading(3, 'A note on the last one'),
    paragraph(
      text('The point is not the change. The point is discovering every place the '),
      bold('deploy path'),
      text(' is undocumented while someone is still around to ask.'),
    ),
  ],
} as TipTapDoc;

const designReviewDoc: TipTapDoc = {
  type: 'doc',
  content: [
    heading(1, 'Design Review Notes'),
    paragraph(
      text('Shared with Ada for comment. '),
      underline('Draft'),
      text(' — do not circulate yet.'),
    ),
    heading(2, 'What works'),
    bulletList(
      item(text('The document sheet reads as a page, not a text box.')),
      item(text('Save status is visible without being loud.')),
    ),
    heading(2, "What doesn't"),
    orderedList(
      item(text('Empty states are an afterthought on the dashboard.')),
      item(italic('Sharing is discoverable only from inside a document.')),
    ),
  ],
} as TipTapDoc;

async function main(): Promise<void> {
  // Imported dynamically so the env above is in place first.
  const { db, pool } = await import('@/db/client');
  const { users, documents, documentShares } = await import('@/db/schema');

  try {
    for (const user of demoUsers) {
      await db
        .insert(users)
        .values(user)
        .onConflictDoUpdate({ target: users.email, set: { name: user.name } });
    }

    const seedDocuments = [
      { id: DOC_PLANNING, ownerId: ADA, title: 'Q3 Product Planning', content: planningDoc },
      { id: DOC_RUNBOOK, ownerId: ADA, title: 'Onboarding Runbook', content: runbookDoc },
      {
        id: DOC_DESIGN_REVIEW,
        ownerId: GRACE,
        title: 'Design Review Notes',
        content: designReviewDoc,
      },
    ];

    for (const doc of seedDocuments) {
      await db
        .insert(documents)
        .values(doc)
        .onConflictDoUpdate({
          target: documents.id,
          set: { title: doc.title, content: doc.content },
        });
    }

    // Grace shares her draft with Ada, so Ada's dashboard has both an
    // "Owned by me" and a "Shared with me" section populated on first load.
    // Without this the reviewer's first screen looks half-built.
    await db
      .insert(documentShares)
      .values({ documentId: DOC_DESIGN_REVIEW, userId: ADA })
      .onConflictDoNothing();

    console.log(
      `Seeded ${demoUsers.length} users, ${seedDocuments.length} documents, 1 share.`,
    );
    console.log('Ada owns 2 documents and can see 1 shared by Grace. Alan can see nothing.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed.', error);
  process.exitCode = 1;
});
