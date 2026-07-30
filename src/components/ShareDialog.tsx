'use client';

import { useEffect, useRef, useState } from 'react';

export type Collaborator = {
  userId: string;
  name: string;
  email: string;
};

export default function ShareDialog({
  docId,
  initialCollaborators,
  onClose,
}: {
  docId: string;
  initialCollaborators: Collaborator[];
  onClose: () => void;
}) {
  const [collaborators, setCollaborators] = useState(initialCollaborators);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
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
      previouslyFocused?.focus();
    };
  }, [onClose]);

  async function handleShare(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    try {
      const response = await fetch(`/api/documents/${docId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not share this document.');
        return;
      }

      // The API upserts, so re-sharing an existing collaborator must not
      // duplicate the row in the list.
      setCollaborators((current) =>
        current.some((c) => c.userId === body.userId) ? current : [...current, body],
      );
      setEmail('');
    } catch {
      setError('Could not share this document. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(userId: string) {
    if (revokingUserId) return;
    setError(null);
    setRevokingUserId(userId);
    try {
      const response = await fetch(`/api/documents/${docId}/shares`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        setCollaborators((current) => current.filter((c) => c.userId !== userId));
        return;
      }
      setError('Could not remove access.');
    } catch {
      setError('Could not remove access. Check your connection and try again.');
    } finally {
      setRevokingUserId(null);
    }
  }

  return (
    <div
      className="scrim-in fixed inset-0 z-50 flex items-center justify-center bg-[rgb(28_26_22/45%)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-description"
        className="dialog-in w-full max-w-md rounded-xl border border-rule bg-sheet p-6 shadow-[var(--shadow-raised)]"
      >
        <h2 id="share-dialog-title" className="font-serif text-[1.375rem] tracking-[-0.015em] text-ink">
          Share this document
        </h2>
        <p id="share-dialog-description" className="mt-1.5 text-sm leading-relaxed text-ink-secondary">
          Anyone you add can read and edit it. Only you can share it or delete it.
        </p>

        <form onSubmit={handleShare} className="mt-4 flex gap-2">
          <input
            ref={inputRef}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="grace@ajaia.demo"
            aria-label="Email address"
            className="flex-1 rounded-lg border border-rule bg-canvas px-3 py-2 text-sm text-ink transition-colors duration-200 placeholder:text-ink-muted hover:border-rule-strong"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-all duration-200 hover:bg-accent-hover disabled:opacity-40"
          >
            {busy ? 'Sharing…' : 'Share'}
          </button>
        </form>

        {error && (
          <p role="alert" className="status-in mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6">
          <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-ink-secondary">
            People with access
          </h3>

          {collaborators.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">
              Only you, for now.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-rule">
              {collaborators.map((collaborator) => (
                <li key={collaborator.userId} className="flex items-center justify-between py-2">
                  <span className="text-sm text-ink">
                    {collaborator.name}
                    <span className="ml-2 text-ink-muted">{collaborator.email}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(collaborator.userId)}
                    disabled={revokingUserId !== null}
                    className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors duration-200 hover:bg-danger-soft hover:text-danger"
                  >
                    {revokingUserId === collaborator.userId ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-rule px-4 py-2 text-sm text-ink-secondary transition-colors duration-200 hover:border-rule-strong hover:text-ink"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
