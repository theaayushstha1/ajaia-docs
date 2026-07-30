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
    if (!confirm('Delete this document? This cannot be undone.')) return;

    setDeleting(true);
    const response = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
    if (response.ok) {
      router.push('/');
      router.refresh();
    } else {
      setDeleting(false);
      alert('Could not delete this document.');
    }
  }

  return (
    <div className="min-h-dvh bg-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
          <Link
            href="/"
            className="rounded px-2 py-1 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            ← All documents
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {!isOwner && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">
                Shared by {ownerName}
              </span>
            )}
            <span className="hidden text-xs text-neutral-500 sm:inline">{currentUserName}</span>

            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-md px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
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
