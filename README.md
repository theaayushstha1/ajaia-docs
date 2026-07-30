# Ajaia Docs

A collaborative document editor: rich-text editing with autosave, `.txt` import, and per-document sharing between users.

**Live:** https://ajaia-docs-yc6d6jarwq-ue.a.run.app

Demo users (no passwords): `ada@ajaia.demo` · `grace@ajaia.demo` · `alan@ajaia.demo`

<!-- SCREENSHOT -->

## Reviewer quickstart (60 seconds)

1. Open the live URL. You land on an identity picker with three seeded users: **Ada Lovelace**, **Grace Hopper**, **Alan Turing**. Pick Ada. There is no password.
2. Click **New document**, type something, apply a heading and a bullet list, then hard-refresh. The content is still there.
3. Click **Share**, enter `grace@ajaia.demo`, and confirm she appears under *People with access*.
4. Open a private window, pick Grace, and find the document under **Shared with me**. She can edit the body. She cannot rename, delete, or re-share it.

## What this is

| Built | Deliberately not built |
| --- | --- |
| TipTap editor: bold, italic, underline, three heading levels, ordered and bulleted lists | Real-time co-editing (CRDT / OT / presence) |
| Autosave debounced at 750 ms, with a Saving / Saved / Couldn't save indicator | Comments, suggestions, version history |
| Create, rename, edit, reopen, delete documents | Public or link-based sharing |
| Import `.txt`, capped at 256 KB | Permission tiers beyond owner and collaborator |
| Share with another user by email; owner can revoke | `.docx` import, any export |
| Dashboard split into *Owned by me* and *Shared with me* | Real authentication |
| Postgres 16 on Cloud SQL, deployed to Cloud Run | Pagination, search, folders |

The cuts are argued in [ARCHITECTURE.md](./ARCHITECTURE.md); the AI process behind them is in [AI-WORKFLOW.md](./AI-WORKFLOW.md).

## The authorization model

- **Identity is simulated, not authenticated.** Picking a user issues an HMAC-signed cookie. There is no credential, so impersonating a demo user is the intended behavior; the signature only buys integrity, which is the one property the rules below depend on.
- **Owner** can read, edit, rename, delete, and share. **Collaborator** can read and edit the body only. **Stranger** can do nothing. Renaming is a separate action from editing because the title is how the document is identified on someone else's dashboard.
- **Ownership is a column on `documents`, never a row in `document_shares`** — so it cannot be revoked by deleting a row.
- **The acting user comes only from the signed cookie** — never from a body, query string, or header.
- **Every document access resolves through `src/db/dal.ts`**, where the access predicate lives inside the SQL `WHERE` clause rather than in a caller's `if`.
- **No access means `404`, never `403`** — a `403` would confirm the document exists.

## Try to break it

- Copy a document id from Ada's URL, sign in as Alan, and open `/docs/<that-id>`. Expect **404**, not 403.
- As Grace, on a document shared with her, run `fetch('/api/documents/<id>', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:'{"ownerId":"<grace-id>"}'})` from DevTools. Expect **400 Nothing to update** — `ownerId` is not on the allowlist, so it is dropped rather than written.
- As Grace, `PATCH` the same document with `{"title":"mine now"}`. Expect **403** — renaming is owner-only, and the request is rejected before either field is written, so a mixed title-plus-content body cannot slip the title through alongside a legal edit.
- As Grace, `POST /api/documents/<id>/shares` with any email. Expect **403**: sharing requires owner, not edit.
- As Grace, `DELETE /api/documents/<id>`. Expect **403**.
- `PATCH` with `{"content":{"type":"doc","content":[{"type":"image","attrs":{"src":"x"}}]}}`. Expect **400** — content is validated against a node allowlist, plus depth, node-count, and byte ceilings, rather than trusted because the editor is the only intended sender.
- Visit `/docs/not-a-uuid`. Expect **404**, not a 500 from a failed Postgres uuid cast.
- Import a `.txt` containing `<script>alert(1)</script>`. It renders as literal text — the importer puts every character into a TipTap text node, so uploaded bytes are never interpreted as markup.

## Known limitations

| Limitation | Why I accepted it | What I'd do with 2 more hours |
| --- | --- | --- |
| Autosave is last-write-wins; two people editing the same document silently clobber each other | The alternative inside the timebox was a partial CRDT, and a document tool that loses data is worse than one that never claimed the feature | Add an `updatedAt` precondition to `PATCH` and surface a "this document changed" reload prompt — cheap, honest, no CRDT |
| Simulated identity, not authentication | The assignment's subject is sharing and access control; real auth would cost an hour and make the reviewer create two accounts before seeing it | Swap `src/lib/session.ts` for Auth.js. Nothing else changes — that is the point of isolating it |
| Sharing an unknown email returns "No user with that email address" — an account-enumeration oracle | With three fixed demo users there is nothing to enumerate, and a vague error would make the feature untestable | Send an invitation and always return 202, so the response stops depending on whether the account exists |
| The DAL is a convention, not a database-enforced guarantee | It centralizes authorization into one obvious place, which is most of the value for a fraction of the cost | Postgres row-level security keyed on a session GUC, which turns the convention into an invariant |
| `.txt` import only | `.docx` conversion is untrusted-input parsing, and mammoth's own docs say it does not sanitize its output | Convert server-side straight into TipTap nodes, never HTML, against the same allowlist |
| Dashboard unpaginated, share endpoint unrated | Neither bites at this size, and both are additive later | Keyset pagination on `updatedAt`; a per-user token bucket on share |

## Running locally

Requires Node 22 and a reachable Postgres 16.

```bash
git clone <repo-url> ajaia-docs && cd ajaia-docs
npm install

cat > .env.local <<'EOF'
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=ajaia
SESSION_SECRET=replace-me-with-at-least-32-characters-long
EOF

npm run db:push   # create the three tables
npm run db:seed   # insert Ada, Grace, and Alan
npm run dev       # http://localhost:3000
```

`SESSION_SECRET` must be at least 32 characters; in production a missing or short one throws on the first request rather than at module load, so the cause lands in request logs instead of failing the build opaquely. On Cloud Run the same code connects over a Unix socket: set `INSTANCE_CONNECTION_NAME` and leave `DB_HOST` unset.

## Tests

```bash
npm test        # vitest
npm run typecheck
```

The suite covers three things: the full role × action matrix in `src/lib/authz.ts`, the `.txt` importer in `src/lib/import-text.ts`, and the document-content validator in `src/lib/content-validation.ts`. All three are pure functions with no I/O, which is what makes them worth testing inside a four-hour build — and all three were chosen because their failures are invisible. A broken toolbar button announces itself in one second. A broken permission check announces itself when it is already a breach.

The honest limit of that coverage: proving `can('collaborator', 'share') === false` does not prove the share route ever calls `can`. So there is a second layer that closes exactly that gap:

```bash
npm run probe                                                # against localhost
npm run probe -- https://ajaia-docs-yc6d6jarwq-ue.a.run.app  # against the deployment
```

`scripts/probe-authz.mjs` mints a valid session cookie for each seeded user and drives the real HTTP endpoints, asserting the status code the rules imply — 22 checks covering every row of the "Try to break it" list above. It starts from authenticated identity and tries to exceed it, which is the threat model that actually matters here.

It passes 22/22 against the deployed URL. It also mutates the demo data, so re-run `npm run db:seed` afterwards.

That probe is what caught the one bug that unit tests structurally could not: `SESSION_SECRET` arrived from Secret Manager with a trailing newline, so every signature verified locally and failed in production. The tests never touch the environment, so they passed either way.

## License

MIT — see [LICENSE](./LICENSE).
