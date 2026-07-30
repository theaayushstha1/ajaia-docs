/**
 * The permission rules, as pure functions.
 *
 * Deliberately zero I/O: no database, no `next/headers`, no env. Everything
 * the decision needs is passed in. That keeps the rules cheap to unit test
 * exhaustively, and means every caller — route handler, server action, page —
 * is asking the same function the same question.
 */

export type Role = 'owner' | 'collaborator' | 'stranger';
export type Action = 'read' | 'edit' | 'rename' | 'delete' | 'share';

/**
 * Resolve the caller's role for a document.
 *
 * `isCollaborator` is supplied by the data layer (it comes from the caller's
 * own share row). Anonymous callers — `userId === null` — are strangers, which
 * is the same as being signed in with no relationship to the document.
 */
export function roleFor(
  userId: string | null,
  doc: { ownerId: string },
  isCollaborator: boolean,
): Role {
  if (!userId) return 'stranger';
  if (doc.ownerId === userId) return 'owner';
  if (isCollaborator) return 'collaborator';
  return 'stranger';
}

const PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: ['read', 'edit', 'rename', 'delete', 'share'],
  // A single "collaborator" level: read and edit the document, but never
  // delete it or hand out access to more people.
  collaborator: ['read', 'edit'],
  stranger: [],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].includes(action);
}
