import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { createSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose a demo user · Ajaia Docs',
};

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
}

export default async function LoginPage() {
  const demoUsers = await db.select().from(users).orderBy(asc(users.name));

  async function signIn(formData: FormData) {
    'use server';

    const userId = String(formData.get('userId') ?? '');

    // Even for a demo picker the id must resolve to a real row. Otherwise this
    // endpoint would mint a valid session for any UUID a caller invented, and
    // every downstream permission check would be reasoning about a user that
    // does not exist.
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return;

    await createSession(user.id);
    // Outside any try/catch: redirect() works by throwing.
    redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-16">
      <div className="rise">
        <p className="font-sans text-[0.7rem] font-medium uppercase tracking-[0.18em] text-ink-muted">
          Ajaia
        </p>
        <h1 className="mt-3 font-serif text-[2.75rem] leading-[1.05] tracking-[-0.02em] text-ink">
          Docs
        </h1>
        <p className="mt-4 max-w-sm text-[0.9375rem] leading-relaxed text-ink-secondary">
          Write, import, and share documents. Choose a demo user to continue.
        </p>
      </div>

      <ul className="mt-10 space-y-2.5">
        {demoUsers.map((user, index) => (
          <li
            key={user.id}
            className="rise"
            style={{ animationDelay: `${120 + index * 70}ms` }}
          >
            <form action={signIn}>
              <input type="hidden" name="userId" value={user.id} />
              <button
                type="submit"
                className="group flex w-full items-center gap-4 rounded-lg border border-rule bg-sheet px-4 py-3.5 text-left shadow-[var(--shadow-sheet)] transition duration-200 hover:-translate-y-px hover:border-rule-strong"
              >
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft font-serif text-sm text-accent"
                >
                  {initials(user.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{user.name}</span>
                  <span className="block truncate text-sm text-ink-muted">{user.email}</span>
                </span>
                <span
                  aria-hidden
                  className="translate-x-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-1"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>

      {demoUsers.length === 0 && (
        <p className="mt-8 rounded-lg border border-rule bg-danger-soft px-4 py-3 text-sm text-danger">
          No demo users found. Run <code className="font-mono">npm run db:seed</code> to create them.
        </p>
      )}

      <div
        className="rise mt-10 border-t border-rule pt-5"
        style={{ animationDelay: '360ms' }}
      >
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-secondary">This is simulated identity, not
          authentication.</span>{' '}
          There are no passwords — picking a name issues a signed session cookie so sharing can be
          tested without creating accounts. Open a private window as a second user to see a
          document arrive.
        </p>
      </div>
    </main>
  );
}
