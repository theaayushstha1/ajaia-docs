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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentShare = typeof documentShares.$inferSelect;
export type NewDocumentShare = typeof documentShares.$inferInsert;
