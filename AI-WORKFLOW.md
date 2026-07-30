# How I used AI on this build

## The operating model

One rule, held for the whole four hours: **AI was allowed to write code. It was not allowed to make an architectural decision I could not defend.**

In practice that meant AI moved fast on things with a verifiable right answer — a Drizzle schema from a table sketch, a modal with correct focus and Escape handling, a Dockerfile for Next.js standalone on Cloud Run — and stopped at the boundary of anything where the correct answer depends on a tradeoff. Every decision in [ARCHITECTURE.md](./ARCHITECTURE.md) has a rejected alternative next to it, and I wrote those rejections. If I could not state why the alternative loses, the decision was not made yet, however good the generated code looked.

This is also a prioritization tool, not just a quality one. The tradeoffs are where a four-hour build is won or lost; the toolbar is not. Spending the human budget on decisions and the AI budget on typing is the whole strategy.

## Where AI created real leverage

**Prior-art search, before any code.** The first thing I ran was parallel research agents against the actual schemas of [outline/outline](https://github.com/outline/outline), [docmost/docmost](https://github.com/docmost/docmost), and [mfts/papermark](https://github.com/mfts/papermark) — three production document tools that have already survived the problem I had ninety minutes to solve. All three converge on the same shape: **owner is a column on the document, never a row in the share table.** I adopted that model informed by the Outline and Docmost patterns, and — more importantly — for the reasons they had, which I could then restate in my own words: ownership becomes unrevocable by construction, "owned by me" is one index scan instead of a join, and owner-versus-collaborator stops being a property every query has to remember to derive.

That is the single highest-value thing AI did on this project, and it produced no code at all. Twenty minutes of reading real schemas replaced an hour of discovering the same constraints by hitting them.

**Throughput on the parts with a known shape.** The seeded identity picker, the share dialog, the dashboard sections, the multi-stage Dockerfile, and the Cloud SQL socket-versus-TCP branch in `src/db/client.ts` were all generated and then read line by line. Reading generated code carefully is faster than writing it, but only if you actually read it — which is where the table below comes from.

## Where I overrode AI

| AI suggested | Why I rejected it | How I checked |
| --- | --- | --- |
| Store rendered HTML in a `text` column | Correct only while `.docx` import was in scope, since the Word converter emits HTML and storing HTML meant zero conversion. The moment `.docx` was cut, the only argument for HTML evaporated and the argument against it stayed: HTML in the database is a string you must decide whether to trust on every read | Traced the actual read path. With JSONB there is no `dangerouslySetInnerHTML` anywhere in the app; with HTML there would have had to be one |
| `.docx` import via `mammoth` | Mammoth's own documentation states it does not sanitize its output and warns about JavaScript links. That would have made document conversion the largest attack surface in an application whose subject is access control | Read mammoth's README rather than accepting the suggestion's summary of it, then cut the feature and wrote down why (ARCHITECTURE D4) |
| A `viewer` / `editor` role enum, grantor auditing on shares, and five API surfaces | Overbuilt for the timebox. Two roles cover the assignment's actual requirement, and every extra role multiplies the authorization matrix I have to test | Wrote the role × action matrix by hand first. Two roles produced 12 cells I could assert exhaustively; four roles produced 24 I could not, inside the time available |
| `drizzle-kit@rc` | A release candidate in a four-hour build is an unforced risk: if the migration tool misbehaves at 4 PM there is no time to diagnose whether it is me or the RC | Stayed on the stable line — `drizzle-orm` 0.45.2 with `drizzle-kit` 0.31.10 — and confirmed `push` against a real Cloud SQL instance early rather than at the end |
| `next/font/google` (create-next-app's default) | I pulled it early: it fetches font files during `next build`, so every production build depends on a third-party network call, and on Cloud Build that is a failure mode with nothing to do with my code | System stack until the deployment was green — then I put it back deliberately, once a design pass wanted a reading serif for the document canvas. See the note below; the reversal is the point |

**A note on that last row, because reversing myself is the honest part.** I removed `next/font` to protect the first deployment, and once the deployment was green and verified I added it back — Newsreader for the document canvas, Instrument Sans for the chrome. The risk I was avoiding was *a build failing for a reason unrelated to my code, at a moment when I had no time to diagnose it*. That risk is real before you have a working deploy and near-zero after, and the payoff changed too: in a document editor the reading face is not decoration, it is the product surface. Same tradeoff, different answer, because the inputs moved. I would rather show that than pretend the first call was the final one.

## What AI got wrong

**The one that nearly cost the build.** Late in the session I had a second AI tool running alongside the first, reviewing the repo. It decided the v2 feature set was broken and "fixed" it by running `git revert` on five commits in a single batch — version history, presence, optimistic concurrency, and Markdown export all disappeared out of the working tree at once, along with the schema they depended on.

What made this recoverable was not cleverness, it was habit. I had been committing continuously with descriptive messages, and I had pushed. So the diagnosis was thirty seconds of `git reflog`, which showed five `revert:` entries with the same timestamp and named the exact commit that was last good. `origin/main` still held it, because the reverts had never been pushed. I restored the tree from that commit, deliberately kept the one genuine fix the other tool had made on top of the broken state — it had correctly spotted that the toolbar read `isEditable` from the initial `useEditorState` snapshot, which is `false` until TipTap's view mounts, so every formatting button rendered disabled — reran the tests and the build, and pushed.

Three things I would take to any team from that:

1. **The instinct to check the system before changing code was the whole recovery.** My first move was `git log` and `git reflog`, not re-typing the missing files. Ten minutes of re-implementation would have produced a subtly different version of work that was sitting intact in the object store.
2. **Frequent, well-described commits are not bookkeeping, they are the undo buffer for autonomous tools.** The messages are what let me tell in one screen which commits were mine and which were the revert stack.
3. **Two agents with write access to one git history will fight.** That is an orchestration bug, and it was mine. Every agent I spawned afterwards got an explicit rule: read-only git, report problems rather than repairing history, one owner for the repository. Parallelism needs disjoint boundaries, and history is a shared resource like any other file.

I am including this rather than quietly fixing it because it is the most honest thing in this document. The interesting question about AI tooling is not whether it goes wrong. It is what your working habits leave you when it does.

**The overclaim.** The first draft of the plan asserted that routing all reads through a data-access layer "structurally kills IDOR." That is not true, and it is the kind of sentence that sounds like rigor while replacing it. A DAL is an *architectural boundary*: it centralizes authorization and makes the right thing the obvious thing. It is not a database-enforced guarantee, because nothing stops a future handler from importing the `db` client and querying `documents` directly. Postgres row-level security would make it an actual invariant; a DAL makes it a convention with one obvious place to do it right. I downgraded the claim to what is true and shipped the honest version in ARCHITECTURE.md, including the upgrade path.

I care about this one more than the code bugs. A false security claim in a README is worse than no claim, because it stops the next person from looking.

**The mass-assignment hole.** An early generated `PATCH` handler spread the request body into the update: `set({ ...body })`. That is a straightforward mass-assignment vulnerability — a collaborator with legitimate edit access could have sent `{"ownerId": "<their-own-id>"}` and taken the document from its owner, using an endpoint they were authorized to call. It is exactly the kind of bug that passes review because the authorization check above it is correct. Replaced with a strict `title` / `content` allowlist; the reasoning now lives in a comment beside it so it does not get "simplified" back.

**Smaller ones.** Generated code kept gating the share endpoint on "can edit" instead of "is owner," which would have let anyone a document was shared with pass that access along. And the first `/docs/[id]` page returned `403` for documents the caller could not see, which turns the route into an existence oracle — `404` is the only correct answer when the caller is not allowed to learn whether the id resolves.

## How correctness was verified rather than trusted

`src/lib/authz.ts` and `src/lib/import-text.ts` are pure functions with no I/O — no database, no `next/headers`, no env — and that is a testing decision, not an aesthetic one. It means the permission matrix can be asserted exhaustively in milliseconds with no fixtures, and the same is true of the importer's guarantee that `<script>alert(1)</script>` in a `.txt` survives as literal text.

I wrote the authorization matrix by hand, as the spec, before the tests existed. That ordering matters: a test suite generated from an implementation asserts that the code does what it does.

The caveat I want stated plainly, because it is the one a reviewer should press on: **a passing unit test on a permission function does not prove the route handlers call it.** `can()` returning `false` for `collaborator × share` is worth nothing if `POST /shares` never asks.

So I wrote a second layer, `scripts/probe-authz.mjs`, which mints a valid session cookie for each seeded user and drives the deployed HTTP endpoints — 22 assertions covering owner, collaborator, stranger, and signed-out, against the real database. `npm run probe -- <url>`. It starts from authenticated identity and tries to exceed it, because that is the threat model that matters: the interesting attacker here is a legitimate collaborator, not an anonymous stranger.

**It immediately earned its cost.** Every request against the deployment came back "Not signed in" while every unit test passed and localhost worked fine. The cause: `SESSION_SECRET` had been stored via `echo | gcloud secrets create`, so Secret Manager held a trailing newline. Cloud Run's env var was `"abc\n"`; a local `.env.local` parsed the same secret as `"abc"`. Every signature verified locally and failed in production, silently, with nothing logged — the failure mode of a correct implementation reading a subtly different input.

No unit test could have caught that, because the pure functions never touch the environment; that is exactly what makes them testable. It is the clearest example on this project of why "the tests pass" and "it works" are different claims, and why the last verification step has to run against the thing you actually deployed.

## What is not in this document

Raw prompt logs. The brief says practical AI usage is being evaluated, not volume, and a 40 KB transcript is evidence of volume. The five overrides above are the actual artifact: the places where the model's output and the shipped code diverge, and why.
