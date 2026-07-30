# Architecture

## System shape

```
Browser
  TipTap editor (client component)
    debounced autosave -> PATCH /api/documents/:id
        |
Next.js 16 App Router  (single service on Cloud Run)
  Server Components ------> src/db/dal.ts ------> Cloud SQL Postgres 16
  Route Handlers    ------>   (all document access)      (Unix socket)
        |
  src/lib/authz.ts  (pure permission rules, no I/O)
```

One deployable. The dashboard and editor pages read through the data-access
layer directly as Server Components; only mutations go through route handlers.
That halves the number of endpoints without giving anything up, because a
read-only GET endpoint would have been a second copy of a check the page
already performs.

## Data model

Five tables. The first three implement the core product; the last two are
bounded enhancements that use Postgres as the shared state already available
to every Cloud Run instance.

```
users            id · name · email (unique) · created_at
documents        id · owner_id -> users · title · content JSONB · created_at · updated_at
                 index (owner_id, updated_at desc)
document_shares  document_id -> documents · user_id -> users · created_at
                 PRIMARY KEY (document_id, user_id)
                 index (user_id)
document_versions id · document_id -> documents · title · content JSONB
                  created_by_id -> users (SET NULL) · created_at
                  index (document_id, created_at desc)
document_presence document_id -> documents · user_id -> users · last_seen_at
                  PRIMARY KEY (document_id, user_id)
                  index (document_id, last_seen_at)
```

The one non-obvious choice: **ownership is a column on `documents`, not a row in
`document_shares`.** This is the shape Outline and Docmost both converge on, and
the reasons hold at any size. Ownership becomes unrevocable by construction —
there is no row you can delete to orphan a document. "Owned by me" is a single
index scan rather than a join. And owner-versus-collaborator stops being a
computed property that every query has to remember to derive.

The composite primary key on `document_shares` is doing real work too: it _is_
the uniqueness constraint, so sharing the same document with the same person
twice is an idempotent no-op instead of a duplicate row or a constraint error
surfaced to the user.

## Decision log

### D1 — Store TipTap JSON in a JSONB column, not HTML

**Context.** The editor is TipTap, which speaks both ProseMirror JSON and HTML.
**Decision.** Persist `editor.getJSON()` into `jsonb`.
**Rejected alternative.** Storing rendered HTML in a `text` column. That is
genuinely simpler, and it was the original plan — it made sense while `.docx`
import was in scope, because the Word converter emits HTML and storing HTML
meant zero conversion. Once `.docx` was cut (D4), the only argument for HTML
disappeared and the argument against it remained: HTML in the database is a
string you have to decide whether to trust on every read.
**Cost accepted.** Rendering a document outside the editor now needs a JSON
walk rather than `dangerouslySetInnerHTML` — which is a cost I want to pay.

### D2 — TipTap for the editor

**Context.** Needed bold, italic, underline, headings, and both list types
inside a 4-hour build.
**Decision.** TipTap v3 with `StarterKit`, which covers that entire list with no
additional extensions.
**Rejected alternatives.** Lexical needs a few hundred lines of command
dispatch and selection plumbing for the same toolbar. BlockNote ships its own
component layer, so the look would have been its design rather than ours, and
its extended packages carry a different license from its MPL-2.0 core — worth
knowing before adopting, even though the core alone would have sufficed. Novel
is close to this use case, but I checked its commit history and release cadence
and preferred something more actively maintained for code I cannot revisit.
**Cost accepted.** TipTap is headless, so all the toolbar and typography CSS is
ours to write — see the note on Preflight below.

### D3 — Signed-cookie demo identity instead of real authentication

**Context.** Sharing cannot be demonstrated without at least two identities.
**Decision.** Three seeded users and a picker that issues an HMAC-signed
session cookie.
**Rejected alternative.** Real auth (Auth.js, or email plus password). It would
have cost roughly an hour and made the reviewer create two accounts before they
could see the feature the assignment actually asks about.
**What this is and is not.** This is _simulated identity_, not authentication.
There is no credential; impersonation is the intended behaviour. What the
signature buys is integrity — a client cannot edit the cookie to become someone
else — and integrity is the only property the authorization layer depends on.
Replacing it with real auth means replacing the login, session, and
current-user boundary. The document DAL and permission model stay unchanged.

### D4 — Plain-text import only, capped at 256 KB

**Context.** The brief asks for at least one file type to enter the workflow.
**Decision.** `.txt`, converted into TipTap text nodes.
**Rejected alternative.** `.docx` via mammoth, which was in the plan and got
cut. Mammoth's own documentation is explicit that it does not sanitize its
output and warns about JavaScript links and pathological documents. Accepting
untrusted Word files would have made document conversion the largest piece of
attack surface in an application whose actual subject is access control.
**Why the cheaper path is also the safer one.** `textToTipTapDoc` puts every
character of the upload into a TipTap _text node_. There is no code path where
uploaded bytes are interpreted as markup, which is why the accompanying test
asserts that `<script>alert(1)</script>` in a `.txt` survives as literal text.

### D5 — Presence and conflict detection, not real-time text merging

**Decision.** Documents are shared and independently editable. A Postgres
heartbeat shows who else is viewing the document, while an `updatedAt`
precondition rejects a stale save with `409`. Text is not merged keystroke by
keystroke.
**Reasoning.** A partially-working CRDT can lose data, and a document tool that
loses data is worse than one that never claimed the feature. Presence answers
the useful awareness question without pretending to be co-editing; optimistic
concurrency protects the work when two editors do collide. A CRDT is the honest
next step, not something to fake inside this timebox.

### D6 — Cloud Run with a Cloud SQL Unix socket

**Decision.** One container, `--add-cloudsql-instances`, `pg` over the
`/cloudsql/...` socket, secrets from Secret Manager.
**Rejected alternative.** SQLite on the container filesystem. Cloud Run's
filesystem is ephemeral and per-instance, so it would have failed the
"documents survive a refresh" requirement the moment a second instance started.

## Authorization

Every document access resolves through `src/db/dal.ts`. The access predicate
lives inside the SQL `WHERE` clause rather than in application code:

```sql
WHERE documents.id = $docId
  AND (documents.owner_id = $userId OR document_shares.user_id = $userId)
```

The share table is joined on `document_id AND user_id = $userId`, so the query
can only ever attach the _caller's own_ share row — joining on `document_id`
alone and then reading the role is a subtle way to inherit somebody else's
access.

`requireDocument()` then delegates to `can()` in `src/lib/authz.ts`, which is a
pure function with no I/O. That indirection is the reason the unit tests are
worth anything: the matrix they exercise is the same code the route handlers
run, not a parallel reimplementation that can drift.

**What this is honestly worth.** Centralizing access in a DAL is an
architectural boundary, not a database-enforced guarantee. Nothing stops a
future handler from importing `db` and querying `documents` directly; the
protection is a convention plus the fact that there is exactly one obvious
place to do it right. Row-level security in Postgres would make it an actual
invariant. That is the upgrade path, and it is not what ships here.

Also handled deliberately:

- **Mass assignment.** `PATCH` allowlists `title` and `content`. Spreading the
  request body would let a collaborator set `owner_id` and take the document.
- **Existence oracles.** A caller with no access gets `404`, never `403`. A
  `403` confirms the document exists.
- **Malformed ids.** `/docs/not-a-uuid` is rejected before it reaches Postgres,
  where a failed uuid cast would surface as a `500` on a URL that should simply
  not exist.
- **Actor provenance.** The acting user is read only from the signed cookie,
  never from a request body, query parameter, or header.
- **Share escalation.** Sharing requires `owner`, not `edit`. Gating it on edit
  would let anyone a document was shared with pass that access along.

## Styling note worth recording

Tailwind v4's Preflight resets headings and lists to look like body text. In a
headless editor that means an `H1` and a bulleted list render identically to a
paragraph, and the toolbar appears broken while working perfectly. The
`.ProseMirror` typography rules in `src/components/editor/editor.css` exist
specifically to undo that inside the document canvas and nowhere else.

## What would break at scale

- **Conflicts are detected, not merged.** Every save echoes back the
  `updatedAt` it last saw; if the row has moved on, `PATCH` answers `409` and
  the editor shows a banner instead of overwriting the other person. That
  closes the silent-data-loss hole, but the loser of the race still has to
  reconcile by hand — real merging is what a CRDT would buy, and that is D5.
- **No pagination.** The dashboard loads every document a user can reach.
- **No rate limiting** on the share endpoint.
- **Document size is capped, not streamed.** `validateTipTapContent` enforces a
  512 KiB / 10,000-node / 32-deep ceiling on every write, so a runaway paste is
  rejected rather than stored — but a genuinely large document has no path at
  all, where a real product would chunk it.
