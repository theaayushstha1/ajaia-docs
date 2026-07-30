import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * A TipTap document node. We store the editor's own JSON (not HTML) so the
 * content is structured data on the way in and on the way out — there is never
 * a moment where user text is a string of markup we have to trust.
 */
export type TipTapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
  content?: TipTapNode[];
};

export type TipTapDoc = {
  type: "doc";
  content: TipTapNode[];
};

/** The canonical "blank page" — what TipTap itself produces for an empty editor. */
export const EMPTY_DOC: TipTapDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Emails are normalized (trim + lowercase) in app code before insert/lookup,
  // so a plain unique column is enough — no functional index needed.
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled document"),
    content: jsonb("content").$type<TipTapDoc>().notNull().default(EMPTY_DOC),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Backs the dashboard's "my documents, most recently edited first".
    index("documents_owner_updated_idx").on(t.ownerId, t.updatedAt.desc()),
  ],
);

export const documentShares = pgTable(
  "document_shares",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The composite PK is the uniqueness constraint: one row per (doc, user),
    // which is what makes re-sharing idempotent instead of duplicating.
    primaryKey({ columns: [t.documentId, t.userId] }),
    // Backs "shared with me" on the dashboard.
    index("document_shares_user_idx").on(t.userId),
  ],
);

/**
 * A snapshot of a document at a point in time.
 *
 * Written on the transition *into* an editing session, not on every keystroke:
 * autosave fires every 750ms, and a row per autosave would be write
 * amplification wearing a feature's clothes.
 *
 * `createdById` is SET NULL rather than CASCADE — a document's history should
 * survive the departure of the person who wrote it.
 */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: jsonb("content").$type<TipTapDoc>().notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // "History for this document, newest first" is the only read pattern.
    index("document_versions_doc_created_idx").on(
      t.documentId,
      t.createdAt.desc(),
    ),
  ],
);

/**
 * Who is currently looking at a document.
 *
 * Deliberately a table rather than a websocket. Cloud Run scales to zero and
 * bills per request, so a container has nowhere durable to hold a persistent
 * connection — a socket would mean a second always-on service for a feature
 * that is cosmetic. Presence here is a heartbeat plus a staleness window, and
 * nothing has to clean up after a closed tab: stale rows simply stop matching
 * the recency filter.
 */
export const documentPresence = pgTable(
  "document_presence",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.userId] }),
    index("document_presence_seen_idx").on(t.documentId, t.lastSeenAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentShare = typeof documentShares.$inferSelect;
export type NewDocumentShare = typeof documentShares.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentPresence = typeof documentPresence.$inferSelect;
