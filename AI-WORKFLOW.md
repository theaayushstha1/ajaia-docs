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
| `next/font/google` (create-next-app's default, and every generated layout kept it) | It downloads font files during `next build`, which makes every production build depend on a third-party network fetch. On Cloud Build that is a failure mode with nothing to do with my code | Removed it from `src/app/layout.tsx` in favor of the system font stack, and left the reasoning in a comment at the top of the file so it does not get re-added |

## What AI got wrong

**The overclaim.** The first draft of the plan asserted that routing all reads through a data-access layer "structurally kills IDOR." That is not true, and it is the kind of sentence that sounds like rigor while replacing it. A DAL is an *architectural boundary*: it centralizes authorization and makes the right thing the obvious thing. It is not a database-enforced guarantee, because nothing stops a future handler from importing the `db` client and querying `documents` directly. Postgres row-level security would make it an actual invariant; a DAL makes it a convention with one obvious place to do it right. I downgraded the claim to what is true and shipped the honest version in ARCHITECTURE.md, including the upgrade path.

I care about this one more than the code bugs. A false security claim in a README is worse than no claim, because it stops the next person from looking.

**The mass-assignment hole.** An early generated `PATCH` handler spread the request body into the update: `set({ ...body })`. That is a straightforward mass-assignment vulnerability — a collaborator with legitimate edit access could have sent `{"ownerId": "<their-own-id>"}` and taken the document from its owner, using an endpoint they were authorized to call. It is exactly the kind of bug that passes review because the authorization check above it is correct. Replaced with a strict `title` / `content` allowlist; the reasoning now lives in a comment beside it so it does not get "simplified" back.

**Smaller ones.** Generated code kept gating the share endpoint on "can edit" instead of "is owner," which would have let anyone a document was shared with pass that access along. And the first `/docs/[id]` page returned `403` for documents the caller could not see, which turns the route into an existence oracle — `404` is the only correct answer when the caller is not allowed to learn whether the id resolves.

## How correctness was verified rather than trusted

`src/lib/authz.ts` and `src/lib/import-text.ts` are pure functions with no I/O — no database, no `next/headers`, no env — and that is a testing decision, not an aesthetic one. It means the permission matrix can be asserted exhaustively in milliseconds with no fixtures, and the same is true of the importer's guarantee that `<script>alert(1)</script>` in a `.txt` survives as literal text.

I wrote the authorization matrix by hand, as the spec, before the tests existed. That ordering matters: a test suite generated from an implementation asserts that the code does what it does.

The caveat I want stated plainly, because it is the one a reviewer should press on: **a passing unit test on a permission function does not prove the route handlers call it.** `can()` returning `false` for `collaborator × share` is worth nothing if `POST /shares` never asks. That gap is not covered by the suite, and closing it properly needs integration tests against a real database, which did not fit the timebox. So it was closed by hand — the sharing, revoking, and 404-not-403 flows were exercised across two browser sessions, which is the manual step that made me trust the automated one.

## What is not in this document

Raw prompt logs. The brief says practical AI usage is being evaluated, not volume, and a 40 KB transcript is evidence of volume. The five overrides above are the actual artifact: the places where the model's output and the shipped code diverge, and why.
