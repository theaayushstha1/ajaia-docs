import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * SIMULATED IDENTITY — read this before assuming otherwise.
 *
 * This is not authentication. There is no password, no credential, and no
 * proof of identity: a visitor picks one of three seeded demo users and we
 * issue a signed cookie saying so. Impersonation is the intended behaviour,
 * because it lets a reviewer exercise the sharing flow in two browser
 * windows without creating accounts.
 *
 * What the signature *does* buy is integrity: a client cannot edit the cookie
 * to become a different user, so every authorization decision downstream is
 * made against a value the server issued. That is the property the
 * authorization layer actually depends on.
 *
 * Swapping this for real auth means replacing this file and nothing else.
 */

const COOKIE_NAME = 'ajaia_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Read lazily, never at module scope: a module-scope throw would fail the
 * production build rather than the request, which makes the cause much
 * harder to see in Cloud Build logs.
 */
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  }
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/** Cookie value is `${userId}.${expiresAt}.${hmac}` — the expiry is inside the signed payload, so it cannot be extended by the client. */
export async function createSession(userId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${userId}.${expiresAt}`;

  const store = await cookies();
  store.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Returns the user id from a cookie this server signed, or null. Never trusts the request body. */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const lastDot = raw.lastIndexOf('.');
  if (lastDot < 0) return null;

  const payload = raw.slice(0, lastDot);
  const provided = Buffer.from(raw.slice(lastDot + 1));
  const expected = Buffer.from(sign(payload));

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const [userId, expiresAt] = payload.split('.');
  if (!userId || !expiresAt) return null;
  if (Number(expiresAt) < Date.now() / 1000) return null;

  return userId;
}
