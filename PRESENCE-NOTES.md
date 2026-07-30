# Presence indicators

Live "who else is looking at this document" avatars. Additive v2 feature: three new
files, no change to any existing module's behaviour.

| | |
|---|---|
| Endpoint | `POST /api/documents/:id/presence` |
| Poll interval (client) | **15 s** |
| Staleness window (server) | **45 s** (`PRESENCE_TTL_SECONDS`) |
| Transport | HTTP polling. **Not** websockets — see below |
| Storage | `document_presence` table (`documentPresence` in `src/db/schema.ts`) |
| Background tabs | Polling stops entirely while the tab is hidden |

---

## Why polling and not websockets

This is the design decision worth defending, so it is stated plainly.

The app runs on **Cloud Run, scaled to zero and billed per request**. A container there
has nowhere durable to hold a persistent connection: it can be shut down between
requests, and two people viewing the same document are not guaranteed to land on the
same instance. Websocket presence would therefore mean standing up a **second,
always-on service** whose only job is holding sockets open — a permanent cost, a second
thing to deploy and monitor, and a new failure mode for the whole app — in exchange for
a feature that is **cosmetic**. If presence breaks, nobody loses a document; they just
don't see an avatar. That is not a trade worth making.

Postgres is already the one piece of shared state every instance can see, so presence
lives there: a **heartbeat plus a staleness window**.

The quieter advantage is that **there is no cleanup job and no disconnect handler**.
Someone who closes their tab simply stops sending heartbeats, and their row stops
matching the recency filter. Rows go stale on their own; nothing has to notice a
departure. This is precisely the bug that plagues socket-based presence in practice — a
dropped socket that never fires its close event leaves a ghost user visible forever.

The cost is latency: an arrival takes up to one poll interval to appear, a departure up
to the TTL. For "is anyone else in this doc", that is entirely acceptable.

### Two decisions that follow from the above

**The TTL is 3× the poll interval (45 s vs 15 s).** A viewer must miss three consecutive
heartbeats before they disappear, so one dropped request — flaky wifi, a Cloud Run cold
start — cannot make someone flicker out of the avatar row and back in.

**Polling pauses while the tab is hidden** (`visibilitychange`), and fires immediately on
return. This is the most important line in the component from a cost standpoint: people
leave documents open in background tabs for days, and without it each abandoned tab
fires ~5,700 requests a day, paying to keep a container warm for nobody, indefinitely.
It is also more correct — a viewer who cannot see the document is not meaningfully
"here", so letting their heartbeat lapse makes the list more honest.

---

## `src/db/presence.ts`

```ts
export const PRESENCE_TTL_SECONDS = 45;

export interface PresenceViewer {
  userId: string;
  name: string;
  email: string;
}

heartbeat(documentId: string, userId: string): Promise<void>
listActiveViewers(documentId: string, userId: string): Promise<PresenceViewer[]>
touchAndList(documentId: string, userId: string): Promise<PresenceViewer[]>
```

- **`heartbeat`** — access-checked, then a single `INSERT … ON CONFLICT DO UPDATE` on the
  composite PK. One statement, so a user's two tabs cannot race into a duplicate-key
  error the way a select-then-insert would.
- **`listActiveViewers`** — access-checked; everyone inside the TTL, joined to `users`,
  **excluding the caller**, ordered by name (stable, so avatars don't reshuffle between
  polls).
- **`touchAndList`** — heartbeat then list, so the client makes **one** request per
  interval instead of two. On a per-request-billed platform, halving the request count
  of the only endpoint that fires on a timer is the biggest lever this feature has on its
  own running cost. The access check runs once here, not once per sub-call.

All three go through `requireDocument(…, 'read')`. Both directions matter: a stranger
must not be able to write a presence row into a private document's avatar row, and the
viewer list itself leaks who a document is shared with, so only people who can already
read the document may see it.

**The staleness cutoff is computed in SQL**, not JS:

```ts
sql`now() - (${PRESENCE_TTL_SECONDS} * interval '1 second')`
```

Cloud Run instances are ephemeral and their clocks are not guaranteed to agree with the
database's. A JS-computed `Date.now() - ttl` would compare the container's idea of "now"
against timestamps Postgres wrote with `now()`, so a container running slightly fast or
slow would expire viewers early or let them linger. Doing the arithmetic in SQL puts
both sides of the comparison on the same clock.

---

## `POST /api/documents/:id/presence`

`POST`, not `GET`, because it **mutates** — it upserts the caller's row before reading.
A `GET` that writes is wrong on its own terms, and would also be caught by anything that
treats `GET` as safe to retry or prefetch, silently marking someone as present.

**Response `200`**

```json
{ "viewers": [{ "userId": "…", "name": "Grace Hopper", "email": "grace@ajaia.demo" }],
  "ttlSeconds": 45 }
```

`viewers` never contains the caller. Sent with `Cache-Control: no-store` — a stale viewer
list is worse than none.

| Status | When |
|---|---|
| `401` | Not signed in |
| `404` | Not a uuid, or no access — from `requireDocument`, so non-existent and not-yours are indistinguishable |
| `500` | Unexpected |

There is deliberately **no 403 branch**: every role that can read a document can also be
present, so there is no "may read but may not appear" state to express.

---

## `src/components/PresenceBar.tsx`

```tsx
export default function PresenceBar(props: { docId: string }): React.JSX.Element | null
```

> Note: `React.JSX.Element`, not the bare global `JSX.Element` — React 19's types removed
> the global `JSX` namespace.

Already mounted in `DocumentWorkspace.tsx` (header, beside the save status).

- **Renders `null` when nobody else is here.** Presence should be invisible until it is
  informative; a permanent "0 viewers" chip is chrome that tells you nothing, and this is
  a writing surface first.
- Up to 3 overlapping avatars, then a `+N` chip. Each avatar has a `title` (name + email,
  for sighted hover) and `role="img"` + `aria-label` with the full name — the initials
  alone are not a name.
- Beside them: *"Grace Hopper is also here"* / *"2 others here"*, in an `aria-live="polite"`
  region. Polite, never assertive: an arrival is worth announcing when the reader is
  between thoughts, never worth interrupting them mid-sentence. The text is `sr-only`
  below the `sm` breakpoint rather than `hidden`, since `display: none` would drop it out
  of the accessibility tree and leave narrow screens with no announcement at all.
- **Avatar colours are hashed from the user id** (djb2) against a fixed 6-colour palette,
  never random — the *identity* of the colour is the point. Grace is the same green in
  every document, on every reload. The palette is mid-tone earth colours drawn from the
  same family as the app's press-green accent, so avatars stay inside the paper palette
  instead of importing a generic SaaS rainbow. They are all dark enough that one
  near-white initial colour reads on every one of them, which is why that value is
  hardcoded rather than using `--accent-contrast` (which flips to near-black in dark mode
  and would fail contrast on a mid-dark disc).
- **Every fetch has a catch arm, and failure is silent.** A failed poll is not the user's
  problem — an error banner about an avatar row would be a worse interruption than
  showing the last known state, and the next tick retries anyway.
- Cleanup on unmount: clears the interval, removes the `visibilitychange` listener, and
  aborts the in-flight fetch via `AbortController` so a late response cannot `setState` on
  a dead component. A new poll also aborts any straggler, so a slow response can't land
  after a fresher one and roll the list backwards.

---

## Verification

`npx tsc --noEmit` and `npx eslint` are clean for all three files.

The SQL was additionally exercised against the **live Cloud SQL database**, since a type
checker cannot validate an upsert target or an interval expression:

| Check | Result |
|---|---|
| Owner heartbeats alone | sees `[]` |
| Collaborator heartbeats | sees `[Grace Hopper]`, not themselves |
| Owner polls again | sees `[Ada Lovelace]` |
| Repeated heartbeats | still 2 rows — upsert, not append |
| Collaborator backdated 90 s | drops out of the list |
| Test rows | cleaned up, 0 left behind |
