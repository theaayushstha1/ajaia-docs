import Link from 'next/link';

import DocumentActions from '@/components/DocumentActions';

export type DashboardRow = {
  id: string;
  title: string;
  updatedAt: Date;
  isOwner: boolean;
  ownerName: string;
};

function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function PageIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function DocumentRow({ row, index }: { row: DashboardRow; index: number }) {
  return (
    <li className="rise" style={{ animationDelay: `${80 + index * 55}ms` }}>
      <Link
        href={`/docs/${row.id}`}
        className="group relative flex items-center gap-3.5 overflow-hidden rounded-lg border border-rule bg-sheet px-4 py-3.5 shadow-[var(--shadow-sheet)] transition-all duration-200 hover:-translate-y-px hover:border-rule-strong"
      >
        {/* Accent rule sweeps in from the left on hover — the only decoration
            on the row, and it reads as a page edge rather than a highlight. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-300 ease-[cubic-bezier(0.2,0.7,0.3,1)] group-hover:scale-y-100"
        />

        <span
          aria-hidden
          className="shrink-0 text-ink-muted transition-colors duration-200 group-hover:text-accent"
        >
          <PageIcon />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[1.0625rem] leading-snug text-ink">
            {row.title}
          </span>
          {!row.isOwner && (
            <span className="mt-0.5 block truncate text-[0.8125rem] text-ink-muted">
              Shared by {row.ownerName}
            </span>
          )}
        </span>

        <span className="shrink-0 text-[0.8125rem] tabular-nums text-ink-muted">
          {relativeTime(row.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

function Section({
  title,
  rows,
  emptyMessage,
  offset,
}: {
  title: string;
  rows: DashboardRow[];
  emptyMessage: string;
  offset: number;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline gap-2.5 border-b border-rule pb-2.5">
        <h2 className="font-sans text-[0.7rem] font-medium uppercase tracking-[0.16em] text-ink-secondary">
          {title}
        </h2>
        <span className="font-sans text-[0.7rem] tabular-nums text-ink-muted">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-rule-strong px-5 py-8 text-center text-sm leading-relaxed text-ink-muted">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {rows.map((row, index) => (
            <DocumentRow key={row.id} row={row} index={offset + index} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Dashboard({
  rows,
  currentUserName,
}: {
  rows: DashboardRow[];
  currentUserName: string;
}) {
  const owned = rows.filter((row) => row.isOwner);
  const shared = rows.filter((row) => !row.isOwner);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-sans text-[0.7rem] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Ajaia
          </p>
          <h1 className="mt-2 font-serif text-[2.5rem] leading-none tracking-[-0.02em] text-ink">
            Documents
          </h1>
          <p className="mt-3 text-sm text-ink-secondary">
            {currentUserName}
            <span aria-hidden className="mx-2 text-ink-muted">
              ·
            </span>
            <Link
              href="/login"
              className="text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
            >
              switch user
            </Link>
          </p>
        </div>

        <DocumentActions />
      </header>

      <Section
        title="Owned by me"
        rows={owned}
        offset={0}
        emptyMessage="Nothing here yet. Create a document, or import a .txt file to turn it into one."
        />
      <Section
        title="Shared with me"
        rows={shared}
        offset={owned.length}
        emptyMessage="No one has shared a document with you yet."
      />
    </main>
  );
}
