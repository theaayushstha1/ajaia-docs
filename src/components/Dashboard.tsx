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
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function DocumentRow({ row }: { row: DashboardRow }) {
  return (
    <li>
      <Link
        href={`/docs/${row.id}`}
        className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 transition hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">{row.title}</span>
        {!row.isOwner && (
          <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
            Shared by {row.ownerName}
          </span>
        )}
        <span className="shrink-0 text-sm text-neutral-500">{relativeTime(row.updatedAt)}</span>
      </Link>
    </li>
  );
}

function Section({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: DashboardRow[];
  emptyMessage: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
        <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
          {rows.length}
        </span>
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <DocumentRow key={row.id} row={row} />
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Documents</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as {currentUserName} ·{' '}
            <Link
              href="/login"
              className="underline underline-offset-2 transition hover:text-neutral-900"
            >
              switch user
            </Link>
          </p>
        </div>
        <DocumentActions />
      </div>

      <Section
        title="Owned by me"
        rows={owned}
        emptyMessage="Nothing here yet. Create a document or import a .txt file to get started."
      />
      <Section
        title="Shared with me"
        rows={shared}
        emptyMessage="No one has shared a document with you yet."
      />
    </main>
  );
}
