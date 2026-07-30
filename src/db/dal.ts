import "server-only";

import { and, desc, eq, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  documentShares,
  documents,
  users,
  type Document,
  type TipTapDoc,
  type User,
} from "@/db/schema";
import { can, roleFor, type Action, type Role } from "@/lib/authz";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface AccessibleDocument {
  doc: Document;
  role: Role;
  ownerName: string;
}

export interface DashboardDocument {
  id: string;
  title: string;
  updatedAt: Date;
  isOwner: boolean;
  ownerName: string;
}

export interface Collaborator {
  userId: string;
  name: string;
  email: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Return a document only when the caller owns it or has an explicit share.
 * The join is scoped to the acting user, so another person's share row can
 * never be mistaken for the caller's access.
 */
export async function getDocumentForUser(
  documentId: string,
  userId: string,
): Promise<AccessibleDocument | null> {
  const [row] = await db
    .select({
      doc: documents,
      ownerName: users.name,
      collaboratorId: documentShares.userId,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .leftJoin(
      documentShares,
      and(
        eq(documentShares.documentId, documents.id),
        eq(documentShares.userId, userId),
      ),
    )
    .where(
      and(
        eq(documents.id, documentId),
        or(eq(documents.ownerId, userId), eq(documentShares.userId, userId)),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    doc: row.doc,
    role: roleFor(userId, row.doc, row.collaboratorId === userId),
    ownerName: row.ownerName,
  };
}

/**
 * Unauthorized callers receive 404 so the API does not reveal existence.
 * An authorized collaborator attempting an owner-only action receives 403.
 */
export async function requireDocument(
  documentId: string,
  userId: string,
  action: Action,
): Promise<AccessibleDocument> {
  const found = await getDocumentForUser(documentId, userId);
  if (!found) throw new HttpError(404, "Not found");
  if (!can(found.role, action)) throw new HttpError(403, "You do not have permission");
  return found;
}

export async function listDashboardDocuments(
  userId: string,
): Promise<DashboardDocument[]> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      ownerId: documents.ownerId,
      ownerName: users.name,
      updatedAt: documents.updatedAt,
      collaboratorId: documentShares.userId,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .leftJoin(
      documentShares,
      and(
        eq(documentShares.documentId, documents.id),
        eq(documentShares.userId, userId),
      ),
    )
    .where(or(eq(documents.ownerId, userId), eq(documentShares.userId, userId)))
    .orderBy(desc(documents.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    isOwner: row.ownerId === userId,
    ownerName: row.ownerName,
  }));
}

export async function createDocument(
  ownerId: string,
  title: string,
  content: TipTapDoc,
): Promise<Document> {
  const [created] = await db
    .insert(documents)
    .values({ ownerId, title, content })
    .returning();

  if (!created) throw new HttpError(500, "Could not create document");
  return created;
}

export async function updateDocument(
  documentId: string,
  patch: { title?: string; content?: TipTapDoc },
): Promise<Document> {
  const [updated] = await db
    .update(documents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .returning();

  if (!updated) throw new HttpError(404, "Not found");
  return updated;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await db.delete(documents).where(eq(documents.id, documentId));
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  return user ?? null;
}

export async function shareDocument(
  documentId: string,
  userId: string,
): Promise<void> {
  await db
    .insert(documentShares)
    .values({ documentId, userId })
    .onConflictDoNothing({
      target: [documentShares.documentId, documentShares.userId],
    });
}

export async function unshareDocument(
  documentId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(documentShares)
    .where(
      and(
        eq(documentShares.documentId, documentId),
        eq(documentShares.userId, userId),
      ),
    );
}

export async function listCollaborators(
  documentId: string,
  actingUserId: string,
): Promise<Collaborator[]> {
  await requireDocument(documentId, actingUserId, "share");

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(documentShares)
    .innerJoin(users, eq(users.id, documentShares.userId))
    .where(eq(documentShares.documentId, documentId))
    .orderBy(users.name);
}
