import 'server-only';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { users, type User } from '@/db/schema';
import { getSessionUserId } from '@/lib/session';

/**
 * The signed cookie is the only place an actor comes from. Nothing here ever
 * reads a user id out of a request body, query string, or header — those are
 * attacker-controlled, and treating them as identity is how authorization
 * layers get bypassed without anyone noticing.
 */

/** The signed-in user, or null. Re-reads the row so a deleted user can't keep a live session. */
export async function getCurrentUser(): Promise<User | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

/** For pages: bounces to the identity picker when signed out. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  // redirect() signals by throwing, so it must not sit inside a try/catch.
  if (!user) redirect('/login');
  return user;
}

/** For route handlers: they answer with a 401 rather than a redirect. */
export async function getApiUser(): Promise<User | null> {
  return getCurrentUser();
}
