'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const MAX_IMPORT_KB = 256;

export default function DocumentActions() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'new' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createBlank() {
    if (busy) return;
    setBusy('new');
    setError(null);

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not create a document.');
        return;
      }
      router.push(`/docs/${body.id}`);
    } catch {
      setError('Could not create a document. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    if (busy) return;
    setError(null);

    // Check client-side as well as server-side: without this the user waits
    // for a full upload only to be rejected, with no useful explanation.
    if (file.size > MAX_IMPORT_KB * 1024) {
      setError(
        `That file is ${(file.size / 1024).toFixed(0)} KB. The limit is ${MAX_IMPORT_KB} KB.`,
      );
      return;
    }

    setBusy('import');
    const form = new FormData();
    form.append('file', file);

    try {
      const response = await fetch('/api/documents', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not import that file.');
        return;
      }
      router.push(`/docs/${body.id}`);
    } catch {
      setError('Could not import that file. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null}
          className="group inline-flex items-center gap-2 rounded-lg border border-rule bg-sheet px-3.5 py-2 text-sm font-medium text-ink-secondary shadow-[var(--shadow-sheet)] transition-all duration-200 hover:-translate-y-px hover:border-rule-strong hover:text-ink disabled:pointer-events-none disabled:opacity-50"
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
            className="transition-transform duration-200 group-hover:-translate-y-0.5"
          >
            <path d="M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          {busy === 'import' ? 'Importing…' : 'Import .txt'}
        </button>

        <button
          type="button"
          onClick={createBlank}
          disabled={busy !== null}
          className="group inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast shadow-[var(--shadow-sheet)] transition-all duration-200 hover:-translate-y-px hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50"
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
            className="transition-transform duration-300 group-hover:rotate-90"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {busy === 'new' ? 'Creating…' : 'New document'}
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".txt,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importFile(file);
          // Reset so picking the same file twice still fires a change event.
          event.target.value = '';
        }}
      />

      {error && (
        <p
          role="alert"
          className="status-in max-w-xs rounded-md bg-danger-soft px-3 py-2 text-right text-[0.8125rem] text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
