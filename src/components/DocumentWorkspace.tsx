'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import DocumentEditor from '@/components/editor/DocumentEditor';
import PresenceBar from '@/components/PresenceBar';
import ShareDialog, { type Collaborator } from '@/components/ShareDialog';

export type WorkspaceProps = {
  docId: string;
  initialTitle: string;
  initialContent: unknown;
  initialUpdatedAt: string;
  role: 'owner' | 'collaborator';
  ownerName: string;
  currentUserName: string;
  initialCollaborators: Collaborator[];
};

export default function DocumentWorkspace({
  docId,
  initialTitle,
  initialContent,
  initialUpdatedAt,
  role,
  ownerName,
  currentUserName,
  initialCollaborators,
}: WorkspaceProps) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [conflict, setConflict] = useState<{ title: string; updatedAt: string } | null>(null);

  /**
   * The last `updatedAt` this client knows about, echoed back on every write.
   * A ref rather than state because it changes on every save and nothing
   * renders from it — putting it in state would re-render the editor mid-typing.
   */
  const lastSeenUpdatedAt = useRef(initialUpdatedAt);

  const isOwner = role === 'owner';

  /**
   * The editor owns debouncing and retry state; this performs the write.
   *
   * Every save carries the `updatedAt` we last saw. If someone else has
   * written in the meantime the server refuses with a 409 instead of letting
   * us overwrite them, and we surface that as a banner rather than a silent
   * success. This is the fix for the last-write-wins hole — two people on one
   * document no longer clobber each other without either of them knowing.
   */
  const handleSave = useCallback(
    async (patch: { title?: string; content?: unknown }) => {
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, expectedUpdatedAt: lastSeenUpdatedAt.current }),
      });

      const body = await response.json().catch(() => ({}));

      if (response.status === 409) {
        setConflict({
          title: body?.conflict?.title ?? 'this document',
          updatedAt: body?.conflict?.updatedAt ?? '',
        });
        // Throw so the editor shows "Couldn't save" rather than pretending the
        // change landed. The banner explains why.
        throw new Error('Changed by someone else');
      }

      if (!response.ok) {
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }

      // Carry the new token forward so the next write is checked against the
      // state we just created, not the one we loaded the page with.
      if (body?.updatedAt) lastSeenUpdatedAt.current = body.updatedAt;
      setConflict(null);

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
      {conflict && (
        <div
          role="alert"
          className="border-b border-rule-strong bg-danger-soft px-4 py-3 text-center text-sm text-danger"
        >
          <span className="font-medium">Someone else edited this document.</span> Your last
          change was not saved, so their work is intact. Reload to see the current version —
          anything you typed since is still on screen, so copy it first if you need it.
          <button
            type="button"
            onClick={() => router.refresh()}
            className="ml-3 rounded-md border border-rule-strong px-2.5 py-1 text-xs font-medium transition-colors hover:bg-sheet"
          >
            Reload
          </button>
        </div>
      )}

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
            {/* Renders nothing when nobody else is here — presence should be
                invisible until it is informative. */}
            <PresenceBar docId={docId} />

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
