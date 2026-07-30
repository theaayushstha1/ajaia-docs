'use client';

import { useEffect, useState } from 'react';

export type PresenceViewer = {
  userId: string;
  name: string;
  email: string;
};

/**
 * How often the browser asks the server who is here.
 *
 * Deliberately slower than it could be. Presence is ambient information — the
 * difference between learning that Grace opened the document 2 seconds ago and
 * 15 seconds ago changes nothing about how anyone writes. Every second shaved
 * off this number is paid for in requests against a per-request-billed
 * platform, forever, on every open document. 15s sits comfortably inside the
 * server's 45s TTL: three chances to be seen before being declared gone.
 */
const POLL_INTERVAL_MS = 15_000;

/** How many avatars to draw before collapsing the rest into a "+N" chip. */
const MAX_AVATARS = 3;

/**
 * A small fixed palette, one entry chosen per person by hashing their user id.
 *
 * Fixed and hashed rather than random, because the identity of the colour is
 * the point: Grace should be the same green every time you see her, in every
 * document, across reloads. A colour that changes per render is noise wearing
 * the costume of information.
 *
 * These are mid-tone earth colours drawn from the same family as the app's
 * press-green accent, so the avatars sit inside the paper palette rather than
 * importing a generic SaaS rainbow. They are all dark enough that the same
 * near-white initials read against every one of them, which is why the label
 * colour below is a fixed value rather than a theme token: `--accent-contrast`
 * flips to near-black in dark mode, and near-black on a mid-dark avatar would
 * fail contrast.
 */
const AVATAR_COLORS = [
  '#2f5d4f', // press green — the house accent
  '#7a4a3a', // terracotta
  '#4a5a6e', // slate
  '#6b5b3e', // ochre
  '#5c4a63', // plum
  '#3f6b63', // teal
] as const;

const AVATAR_INK = '#fffdf9';

/**
 * djb2, truncated. Any stable string->int would do; what matters is that it is
 * deterministic and spreads adjacent uuids across different buckets.
 */
function colorForUserId(userId: string): string {
  let hash = 5381;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 33) ^ userId.charCodeAt(i);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** "Grace Hopper" -> "GH", "Grace" -> "G". Falls back to "?" for empty names. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

function summarize(viewers: PresenceViewer[]): string {
  if (viewers.length === 1) return `${viewers[0].name} is also here`;
  return `${viewers.length} others here`;
}

/**
 * Live presence indicator: who else currently has this document open.
 *
 * Renders nothing at all when nobody else is here. Presence should be
 * invisible until it is informative — an empty "0 viewers" chip is permanent
 * chrome that tells you nothing, and this app is a writing surface first.
 */
export default function PresenceBar({ docId }: { docId: string }): React.JSX.Element | null {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight: AbortController | null = null;

    async function poll() {
      // Abort any straggler before starting a new one, so a slow response
      // can't land after a fresher one and roll the list backwards.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;

      try {
        const response = await fetch(`/api/documents/${docId}/presence`, {
          method: 'POST',
          signal: controller.signal,
        });
        if (!response.ok) return;

        const body: unknown = await response.json();
        if (stopped || controller.signal.aborted) return;

        const next =
          body !== null &&
          typeof body === 'object' &&
          Array.isArray((body as { viewers?: unknown }).viewers)
            ? (body as { viewers: PresenceViewer[] }).viewers
            : [];
        setViewers(next);
      } catch {
        // Silent, always. A failed poll is not the user's problem: they are
        // writing a document, and an error banner about an avatar row would be
        // a worse interruption than simply showing the last known state. The
        // next tick retries anyway, and AbortError lands here too during
        // unmount and tab-hide, where it is entirely expected.
      }
    }

    function startTimer() {
      if (timer === null) timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    }

    function stopTimer() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    /**
     * Polling stops entirely while the tab is hidden.
     *
     * This is the single most important line in the component from a cost
     * standpoint. People leave documents open in background tabs for days.
     * Without this, every one of those abandoned tabs keeps firing a request
     * every 15 seconds — roughly 5,700 requests a day each — which on Cloud
     * Run means paying to keep a container warm for nobody, and paying it
     * indefinitely. It is also just wrong on the merits: a viewer who cannot
     * see the document is not meaningfully "here", so letting their heartbeat
     * lapse makes the presence list more honest, not less.
     *
     * Becoming visible again polls immediately rather than waiting out the
     * interval, so returning to the tab shows a current list rather than a
     * stale one.
     */
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void poll();
        startTimer();
      } else {
        stopTimer();
        inFlight?.abort();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Mount: poll once straight away so presence appears without a 15s wait —
    // unless the tab was opened in the background, in which case the
    // visibilitychange handler picks it up when it is actually looked at.
    if (document.visibilityState === 'visible') {
      void poll();
      startTimer();
    }

    return () => {
      stopped = true;
      stopTimer();
      // Abort in flight work so a response arriving after unmount cannot call
      // setState on a component that no longer exists.
      inFlight?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [docId]);

  if (viewers.length === 0) return null;

  const shown = viewers.slice(0, MAX_AVATARS);
  const overflow = viewers.length - shown.length;

  return (
    <div
      // polite, not assertive: an arrival is worth announcing once the reader
      // is between thoughts, never worth interrupting them mid-sentence.
      aria-live="polite"
      className="status-in flex items-center gap-2.5"
    >
      {/* Overlapping avatars. `title` serves the sighted hover; `role="img"`
          plus `aria-label` is what actually reaches a screen reader, because
          the initials alone ("GH") are not a name. The ring is drawn in the
          sheet colour so overlapping circles read as separate discs rather
          than one blob. */}
      <span className="flex items-center">
        {shown.map((viewer) => (
          <span
            key={viewer.userId}
            role="img"
            title={`${viewer.name} (${viewer.email})`}
            aria-label={viewer.name}
            style={{ backgroundColor: colorForUserId(viewer.userId), color: AVATAR_INK }}
            className="-ml-1.5 flex h-6 w-6 select-none items-center justify-center rounded-full text-[0.625rem] font-medium leading-none ring-2 ring-sheet first:ml-0"
          >
            {initialsFor(viewer.name)}
          </span>
        ))}

        {overflow > 0 && (
          <span
            role="img"
            aria-label={`${overflow} more`}
            title={viewers
              .slice(MAX_AVATARS)
              .map((viewer) => viewer.name)
              .join(', ')}
            className="-ml-1.5 flex h-6 w-6 select-none items-center justify-center rounded-full bg-accent-soft text-[0.625rem] font-medium leading-none tabular-nums text-ink-secondary ring-2 ring-sheet"
          >
            +{overflow}
          </span>
        )}
      </span>

      {/* Visually hidden rather than `hidden` below the sm breakpoint:
          `display: none` would drop it from the accessibility tree too, and on
          a narrow screen that would leave a screen reader with no announcement
          at all. */}
      <span className="sr-only text-[0.8125rem] text-ink-secondary sm:not-sr-only sm:inline">
        {summarize(viewers)}
      </span>
    </div>
  );
}
