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
      setError(`That file is ${(file.size / 1024).toFixed(0)} KB. The limit is ${MAX_IMPORT_KB} KB.`);
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
          className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          {busy === 'import' ? 'Importing…' : 'Import .txt'}
        </button>

        <button
          type="button"
          onClick={createBlank}
          disabled={busy !== null}
          className="rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
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
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
