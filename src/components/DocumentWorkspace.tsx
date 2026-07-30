'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import DocumentEditor from '@/components/editor/DocumentEditor';
import ShareDialog, { type Collaborator } from '@/components/ShareDialog';

export type WorkspaceProps = {
  docId: string;
  initialTitle: string;
  initialContent: unknown;
  role: 'owner' | 'collaborator';
  ownerName: string;
  currentUserName: string;
  initialCollaborators: Collaborator[];
};

export default function DocumentWorkspace({
  docId,
  initialTitle,
  initialContent,
  role,
  ownerName,
  currentUserName,
  initialCollaborators,
}: WorkspaceProps) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = role === 'owner';

  /**
   * The editor owns debouncing and retry state; this just performs the write.
   * Throwing on a non-OK response is deliberate — the editor surfaces it as
   * "Couldn't save", which is the only honest thing to show when the server
   * rejected the change.
   */
  const handleSave = useCallback(
    async (patch: { title?: string; content?: unknown }) => {
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }

      // Keep the dashboard's "last edited" ordering honest without a refetch here.
      if (patch.title !== undefined) router.refresh();
    },
    [docId, router],
  );

  async function handleDelete() {
    if (deleting) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (response.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      alert('Could not delete this document.');
    } catch {
      alert('Could not delete this document. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-subtle">
      <header className="sticky top-0 z-20 border-b border-rule bg-sheet/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-secondary transition-colors duration-200 hover:text-ink"
          >
            <svg
              aria-hidden
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform duration-200 group-hover:-translate-x-0.5"
            >
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            All documents
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {!isOwner && (
              <span className="rounded-full border border-rule bg-canvas px-2.5 py-1 text-xs text-ink-secondary">
                Shared by {ownerName}
              </span>
            )}
            <span className="hidden text-xs text-ink-muted sm:inline">{currentUserName}</span>

            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-all duration-200 hover:-translate-y-px hover:bg-accent-hover"
                >
                  <svg
                    aria-hidden
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                  </svg>
                  Share
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-muted transition-colors duration-200 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <DocumentEditor
        docId={docId}
        initialTitle={initialTitle}
        initialContent={initialContent}
        editable
        canRename={isOwner}
        onSave={handleSave}
      />

      {isOwner && shareOpen && (
        <ShareDialog
          docId={docId}
          initialCollaborators={initialCollaborators}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
