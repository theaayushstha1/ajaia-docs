import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { createSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose a demo user · Ajaia Docs',
};

export default async function LoginPage() {
  const demoUsers = await db.select().from(users).orderBy(asc(users.name));

  async function signIn(formData: FormData) {
    'use server';

    const userId = String(formData.get('userId') ?? '');

    // Even though this is a demo picker, the id still has to resolve to a real
    // row. Otherwise this endpoint would mint a valid session for any UUID a
    // caller invented, and every downstream permission check would be reasoning
    // about a user that does not exist.
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return;

    await createSession(user.id);
    // Outside any try/catch: redirect() works by throwing.
    redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Ajaia Docs</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Choose a demo user to continue. There are no passwords: this is simulated identity so you
        can test sharing without creating accounts.
      </p>

      <ul className="mt-8 space-y-2">
        {demoUsers.map((user) => (
          <li key={user.id}>
            <form action={signIn}>
              <input type="hidden" name="userId" value={user.id} />
              <button
                type="submit"
                className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left transition hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                <span className="font-medium text-neutral-900">{user.name}</span>
                <span className="text-sm text-neutral-500">{user.email}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>

      {demoUsers.length === 0 && (
        <p className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No demo users found. Run <code className="font-mono">npm run db:seed</code> to create them.
        </p>
      )}

      <p className="mt-8 text-xs text-neutral-500">
        To try sharing, sign in as one user here and open a second private window as another.
      </p>
    </main>
  );
}
