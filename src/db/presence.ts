import 'server-only';

import { and, eq, ne, sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import { requireDocument } from '@/db/dal';
import { users } from '@/db/schema';

/**
 * Presence — "who else is looking at this document right now".
 *
 * ---------------------------------------------------------------------------
 * Why polling and not websockets
 * ---------------------------------------------------------------------------
 * This is a heartbeat written to Postgres plus a staleness window, and that is
 * a deliberate choice rather than a shortcut.
 *
 * The app runs on Cloud Run, scaled to zero and billed per request. A
 * container there has nowhere durable to hold a persistent connection: it can
 * be shut down between requests, and two viewers of the same document are not
 * even guaranteed to land on the same instance. Websockets would therefore
 * mean standing up a second, always-on service purely to hold sockets open —
 * a permanent cost, a second thing to deploy and monitor, and a new failure
 * mode for the whole app — in exchange for a feature that is cosmetic. If
 * presence breaks, nobody loses a document; they just don't see an avatar.
 *
 * Postgres is already the one piece of shared state every instance can see, so
 * it is the natural place to put it.
 *
 * The other quiet advantage: there is no cleanup job and no disconnect
 * handler. A viewer who closes the tab simply stops sending heartbeats, and
 * their row stops matching the recency filter below. Rows go stale on their
 * own. There is no "ghost user" state to reconcile, which is the bug that
 * actually plagues socket-based presence — a dropped socket that never fired
 * its close event leaves someone visible forever.
 *
 * The cost is latency: an arrival takes up to one poll interval to appear, and
 * a departure up to the TTL. For "is anyone else in this doc", that is fine.
 */

/**
 * The Drizzle definition of the presence table.
 *
 * NOTE FOR WHOEVER OWNS src/db/schema.ts: the physical table already exists in
 * the deployed database (verified against information_schema), but schema.ts
 * does not export a `documentPresence` definition, so this file carries one.
 * It mirrors the live columns exactly. When the canonical definition lands in
 * schema.ts, delete this block and import it from there instead — nothing else
 * in this file changes.
 *
 * This matters beyond tidiness: drizzle.config.ts points only at schema.ts, so
 * while the table is absent from that file, a `drizzle-kit push` sees
 * `document_presence` as an unknown table and may offer to drop it.
 */
export const documentPresence = pgTable(
  'document_presence',
  {
    documentId: uuid('document_id').notNull(),
    userId: uuid('user_id').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (document, viewer) — the composite PK is what makes the
    // heartbeat an upsert instead of an ever-growing append log.
    primaryKey({ columns: [t.documentId, t.userId] }),
    // Backs the "recent viewers of this document" lookup.
    index('document_presence_doc_seen_idx').on(t.documentId, t.lastSeenAt),
  ],
);

/**
 * How long a heartbeat counts for. Anyone whose last heartbeat is older than
 * this is treated as gone.
 *
 * Three times the client's 15s poll interval, so a viewer has to miss three
 * consecutive heartbeats before they vanish. A single dropped request — a
 * flaky network, a Cloud Run cold start — must not make someone flicker out of
 * the avatar row and back in.
 */
export const PRESENCE_TTL_SECONDS = 45;

export interface PresenceViewer {
  userId: string;
  name: string;
  email: string;
}

/**
 * The staleness cutoff, computed by Postgres rather than by the container.
 *
 * This is the whole reason presence is trustworthy here. Cloud Run instances
 * are ephemeral and their clocks are not guaranteed to agree with the
 * database's. If the cutoff were `new Date(Date.now() - ttl)` computed in JS,
 * a container running even slightly fast or slow would compare its own idea of
 * "now" against timestamps that Postgres wrote with `now()` — and viewers
 * would expire early or linger. Doing the arithmetic in SQL means both sides
 * of the comparison come from the same clock.
 */
const recencyCutoff = sql`now() - (${PRESENCE_TTL_SECONDS} * interval '1 second')`;

/** Record the heartbeat. Assumes access has already been checked. */
async function touch(documentId: string, userId: string): Promise<void> {
  // One statement, no read-then-write: INSERT ... ON CONFLICT DO UPDATE. A
  // select-then-insert would race against the same user's other tab and throw
  // a duplicate-key error on the composite PK.
  await db
    .insert(documentPresence)
    .values({ documentId, userId, lastSeenAt: sql`now()` })
    .onConflictDoUpdate({
      target: [documentPresence.documentId, documentPresence.userId],
      set: { lastSeenAt: sql`now()` },
    });
}

/** Read the active viewers. Assumes access has already been checked. */
async function activeViewers(
  documentId: string,
  excludeUserId: string,
): Promise<PresenceViewer[]> {
  return (
    db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(documentPresence)
      .innerJoin(users, eq(users.id, documentPresence.userId))
      .where(
        and(
          eq(documentPresence.documentId, documentId),
          // The caller is excluded in SQL, not filtered out in the client. The
          // UI answers "who ELSE is here", and the caller already knows they are
          // here.
          ne(documentPresence.userId, excludeUserId),
          sql`${documentPresence.lastSeenAt} > ${recencyCutoff}`,
        ),
      )
      // Stable ordering, so the avatar row doesn't reshuffle between polls.
      .orderBy(users.name)
  );
}

/**
 * Record that this user is currently viewing this document.
 *
 * Access-checked: someone with no relationship to the document cannot write a
 * presence row for it, which would otherwise let a stranger advertise
 * themselves into a private document's avatar row.
 */
export async function heartbeat(documentId: string, userId: string): Promise<void> {
  await requireDocument(documentId, userId, 'read');
  await touch(documentId, userId);
}

/**
 * Everyone other than the caller whose heartbeat is inside the TTL.
 *
 * Access-checked for the mirror-image reason: the viewer list leaks who a
 * document is shared with, so only people who can already read the document
 * may see it.
 */
export async function listActiveViewers(
  documentId: string,
  userId: string,
): Promise<PresenceViewer[]> {
  await requireDocument(documentId, userId, 'read');
  return activeViewers(documentId, userId);
}

/**
 * Heartbeat and read back, for the polling client.
 *
 * Exists so the browser makes ONE request per interval instead of two. On a
 * scale-to-zero, per-request-billed platform, halving the request count of the
 * only endpoint that fires on a timer is the single biggest lever this feature
 * has on its own running cost.
 *
 * The access check happens once here rather than once inside each of
 * `heartbeat` and `listActiveViewers` — hence the private helpers above.
 */
export async function touchAndList(
  documentId: string,
  userId: string,
): Promise<PresenceViewer[]> {
  await requireDocument(documentId, userId, 'read');
  await touch(documentId, userId);
  // Read after write, in that order, so the caller's own heartbeat is already
  // recorded when a peer polls a moment later.
  return activeViewers(documentId, userId);
}
