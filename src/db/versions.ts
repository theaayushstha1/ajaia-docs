import "server-only";

import { and, desc, eq, notInArray } from "drizzle-orm";

import { db } from "@/db/client";
import { HttpError, requireDocument } from "@/db/dal";
import {
  documentVersions,
  documents,
  users,
  type Document,
  type DocumentVersion,
  type TipTapDoc,
  type TipTapNode,
} from "@/db/schema";

/**
 * Version history, as its own module.
 *
 * Every exported function takes the acting user and runs its own
 * `requireDocument` check before touching a version row. Nothing here trusts a
 * caller to have already authorized the request — a route handler that forgets
 * the check should still get a 404, not someone else's document history.
 */

/** How many versions a document keeps. Anything older is pruned after each snapshot. */
export const VERSION_HISTORY_LIMIT = 20;

/** Characters of plain text sent to the UI as a snippet. */
const PREVIEW_LENGTH = 90;

export interface VersionSummary {
  id: string;
  title: string;
  createdAt: Date;
  /** The author's name, or "Unknown" once their account is gone. */
  authorName: string;
  /** Plain text lifted out of the stored JSON, truncated for display. */
  preview: string;
  byteLength: number;
}

/**
 * Either the pool-backed database or an open transaction. Extracted from
 * `db.transaction` rather than imported so it cannot drift from the driver.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The last {@link VERSION_HISTORY_LIMIT} versions, newest first.
 *
 * The row's content is read here but never returned: the UI gets a short
 * plain-text preview and a byte count, so opening the panel on a document with
 * twenty long revisions doesn't ship twenty documents to the browser.
 */
export async function listVersions(
  documentId: string,
  userId: string,
): Promise<VersionSummary[]> {
  await requireDocument(documentId, userId, "read");

  const rows = await db
    .select({
      id: documentVersions.id,
      title: documentVersions.title,
      createdAt: documentVersions.createdAt,
      content: documentVersions.content,
      authorName: users.name,
    })
    .from(documentVersions)
    // LEFT join: `createdById` is SET NULL when a user is deleted, and their
    // history outlives them. An inner join would silently hide those rows.
    .leftJoin(users, eq(users.id, documentVersions.createdById))
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(VERSION_HISTORY_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    authorName: row.authorName ?? "Unknown",
    preview: previewOf(row.content),
    byteLength: byteLengthOf(row.content),
  }));
}

/**
 * One version, scoped to its document.
 *
 * The `documentId` in the WHERE clause is the access check doing its job: the
 * caller is authorized for *this* document, so a version id belonging to some
 * other document must not resolve, however it was guessed.
 */
export async function getVersion(
  versionId: string,
  documentId: string,
  userId: string,
): Promise<DocumentVersion | null> {
  await requireDocument(documentId, userId, "read");

  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.documentId, documentId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Freeze the document's current title and content as a new version.
 *
 * Requires `edit` rather than `read`: this writes a row, and a reader who
 * cannot change the document should not be able to grow its history either.
 */
export async function snapshotDocument(
  documentId: string,
  userId: string,
): Promise<DocumentVersion> {
  const { doc } = await requireDocument(documentId, userId, "edit");

  const created = await insertSnapshot(db, doc, userId);
  await pruneVersions(documentId);
  return created;
}

/**
 * Restore a version onto the document.
 *
 * The current state is snapshotted first, so restoring is itself undoable — the
 * thing you just overwrote is the newest entry in history when the panel
 * refreshes. Snapshot and overwrite share a transaction: a failure between them
 * would otherwise leave a version row describing a document that no longer
 * exists in that form.
 */
export async function restoreVersion(
  versionId: string,
  documentId: string,
  userId: string,
): Promise<Document> {
  // A version contains the title as well as the body. Restoring it can rename
  // the document, so it must obey the same owner-only rule as a direct rename.
  const { doc } = await requireDocument(documentId, userId, "rename");

  // Read the target *before* snapshotting. The snapshot pushes history over the
  // limit and prunes the oldest row, which can be this very version — reading
  // first means the restore still completes with the content in hand.
  const [target] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.documentId, documentId),
      ),
    )
    .limit(1);

  if (!target) throw new HttpError(404, "Not found");

  return db.transaction(async (tx) => {
    await insertSnapshot(tx, doc, userId);

    const [updated] = await tx
      .update(documents)
      .set({
        title: target.title,
        content: target.content,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
      .returning();

    if (!updated) throw new HttpError(404, "Not found");

    await pruneVersions(documentId, VERSION_HISTORY_LIMIT, tx);
    return updated;
  });
}

/**
 * Drop everything but the newest `keep` versions of a document.
 *
 * One statement with a subquery, not a read-then-delete round trip: fetching
 * ids into JS and deleting them back is two queries racing each other, and a
 * concurrent snapshot between the two can delete a row that had just become a
 * survivor.
 */
export async function pruneVersions(
  documentId: string,
  keep: number = VERSION_HISTORY_LIMIT,
  executor: Executor = db,
): Promise<void> {
  const survivors = executor
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(keep);

  await executor
    .delete(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        notInArray(documentVersions.id, survivors),
      ),
    );
}

async function insertSnapshot(
  executor: Executor,
  doc: Document,
  userId: string,
): Promise<DocumentVersion> {
  const [created] = await executor
    .insert(documentVersions)
    .values({
      documentId: doc.id,
      title: doc.title,
      content: doc.content,
      createdById: userId,
    })
    .returning();

  if (!created) throw new HttpError(500, "Could not save a version");
  return created;
}

/**
 * Flatten a stored document to a short line of plain text.
 *
 * Walks block by block and stops as soon as it has enough characters, so a
 * 512 KiB document costs the same as a one-line one.
 */
function previewOf(content: TipTapDoc | null): string {
  const blocks = content?.content;
  if (!Array.isArray(blocks)) return "";

  let text = "";
  for (const block of blocks) {
    const line = textOf(block).trim();
    if (line.length === 0) continue;
    text = text.length === 0 ? line : `${text} · ${line}`;
    if (text.length > PREVIEW_LENGTH) break;
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_LENGTH
    ? `${collapsed.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : collapsed;
}

function textOf(node: TipTapNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(textOf).join(" ");
}

function byteLengthOf(content: TipTapDoc | null): number {
  if (!content) return 0;
  return new TextEncoder().encode(JSON.stringify(content)).byteLength;
}
