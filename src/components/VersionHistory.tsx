'use client';

import { useEffect, useRef, useState } from 'react';

/** One row of `GET /api/documents/[id]/versions`. Dates arrive as ISO strings. */
export type VersionSummary = {
  id: string;
  title: string;
  createdAt: string;
  authorName: string;
  preview: string;
  byteLength: number;
};

type LoadState = 'loading' | 'ready' | 'error';

export default function VersionHistory({
  docId,
  canEdit,
  onRestored,
  onClose,
}: {
  docId: string;
  canEdit: boolean;
  /** Called after a successful restore so the parent can re-read the document. */
  onRestored: () => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [status, setStatus] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Bumped to re-run the fetch effect. The list is server state, so every path
  // that changes it (save, restore, retry) asks for it again rather than
  // patching a local copy that the server may have pruned out from under.
  const [reloadToken, setReloadToken] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // The panel outlives individual renders of its parent, and the parent is very
  // likely to pass inline callbacks. Holding them in a ref keeps the focus-trap
  // effect on an empty dependency list, so focus is captured and restored
  // exactly once instead of on every parent re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/documents/${docId}/versions`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;

        if (!response.ok) {
          setError(body.error ?? 'Could not load version history.');
          setStatus('error');
          return;
        }

        setVersions(Array.isArray(body.versions) ? body.versions : []);
        setError(null);
        setStatus('ready');
      } catch {
        // An abort lands here too, on unmount and on a re-fetch that
        // superseded this one — neither is an error worth showing.
        if (cancelled) return;
        setError('Could not load version history. Check your connection and try again.');
        setStatus('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [docId, reloadToken]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const busy = saving || restoringId !== null;

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  async function handleSaveVersion() {
    if (busy) return;
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/documents/${docId}/versions`, {
        method: 'POST',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Could not save a version.');
        return;
      }

      // Re-reading is cheaper than trusting the response to reconstruct a row:
      // the POST answers with the new version only, and a snapshot can prune an
      // old one off the end of the list at the same time.
      refresh();
    } catch {
      setError('Could not save a version. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(versionId: string) {
    if (busy) return;
    setError(null);
    setRestoringId(versionId);

    try {
      const response = await fetch(
        `/api/documents/${docId}/versions/${versionId}/restore`,
        { method: 'POST' },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Could not restore this version.');
        return;
      }

      setConfirmingId(null);
      // The restore snapshotted the state it replaced, so the list has a new
      // newest entry. Refresh it, then hand control back so the editor re-reads
      // the document it is now out of step with.
      refresh();
      onRestored();
    } catch {
      setError('Could not restore this version. Check your connection and try again.');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div
      className="scrim-in fixed inset-0 z-50 flex justify-end bg-[rgb(28_26_22/45%)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        aria-describedby="version-history-description"
        className="dialog-in flex h-full w-full max-w-sm flex-col border-l border-rule bg-sheet shadow-[var(--shadow-sheet)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            <h2
              id="version-history-title"
              className="font-serif text-[1.25rem] tracking-[-0.015em] text-ink"
            >
              Version history
            </h2>
            <p
              id="version-history-description"
              className="mt-1 text-sm leading-relaxed text-ink-secondary"
            >
              The last {versions.length === 1 ? 'version' : 'few versions'} of this document.
              Restoring one keeps the current draft in history.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close version history"
            className="-mr-1 rounded-md px-2 py-1 text-sm text-ink-muted transition-colors duration-200 hover:bg-accent-soft hover:text-ink"
          >
            Close
          </button>
        </header>

        {canEdit && (
          <div className="border-b border-rule px-5 py-3">
            <button
              type="button"
              onClick={handleSaveVersion}
              disabled={busy}
              className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-secondary transition-colors duration-200 hover:border-rule-strong hover:text-ink disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save a version now'}
            </button>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="status-in mx-5 mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {status === 'loading' && (
            <p className="text-sm text-ink-muted">Loading history…</p>
          )}

          {status === 'error' && (
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                refresh();
              }}
              className="rounded-lg border border-rule px-3 py-1.5 text-sm text-ink-secondary transition-colors duration-200 hover:border-rule-strong hover:text-ink"
            >
              Try again
            </button>
          )}

          {status === 'ready' && versions.length === 0 && (
            <p className="text-sm leading-relaxed text-ink-muted">
              No earlier versions yet — one is saved automatically when you start editing.
            </p>
          )}

          {status === 'ready' && versions.length > 0 && (
            <ul className="divide-y divide-rule">
              {versions.map((version) => {
                const confirming = confirmingId === version.id;
                const restoring = restoringId === version.id;

                return (
                  <li key={version.id} className="py-3 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink">
                        {relativeTime(version.createdAt)}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {version.authorName}
                      </span>
                    </div>

                    <p className="mt-1 font-serif text-sm leading-relaxed text-ink-secondary">
                      {version.title}
                    </p>

                    {version.preview.length > 0 && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                        {version.preview}
                      </p>
                    )}

                    {canEdit && !confirming && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setConfirmingId(version.id);
                        }}
                        disabled={busy}
                        aria-label={`Restore the version from ${relativeTime(version.createdAt)}`}
                        className="mt-2 rounded-md px-2 py-1 text-xs text-accent transition-colors duration-200 hover:bg-accent-soft disabled:opacity-40"
                      >
                        Restore
                      </button>
                    )}

                    {canEdit && confirming && (
                      <div className="status-in mt-2 flex items-center gap-2">
                        <span className="text-xs text-ink-secondary">
                          Replace the current draft?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRestore(version.id)}
                          disabled={busy}
                          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-contrast transition-all duration-200 hover:bg-accent-hover disabled:opacity-40"
                        >
                          {restoring ? 'Restoring…' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={busy}
                          className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors duration-200 hover:text-ink disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "3 min ago" without a date library.
 *
 * Only ever runs in the browser — the list is fetched on mount, so there is no
 * server render of a clock-dependent string to mismatch on hydration.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Unknown time';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
