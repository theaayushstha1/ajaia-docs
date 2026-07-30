# Submission — Ajaia AI-Native Full Stack Developer Assignment

**Aayush Shrestha**

|                   |                                                 |
| ----------------- | ----------------------------------------------- |
| Live app          | https://ajaia-docs-yc6d6jarwq-ue.a.run.app      |
| Repository        | https://github.com/theaayushstha1/ajaia-docs    |
| Walkthrough video | See `WALKTHROUGH-VIDEO.txt` in the Drive folder |

## Exact Drive folder contents

- `ajaia-docs-source.zip` — clean source archive from the submitted Git revision
- `README.md` — reviewer quickstart, scope, local setup, tests, and limitations
- `ARCHITECTURE.md` — system shape, data model, authorization model, and decision log
- `AI-WORKFLOW.md` — tools used, material acceleration, rejected output, and verification
- `SUBMISSION.md` — this exact contents index
- `PORTAL-SUBMISSION.md` — concise Markdown prepared for the assessment portal
- `LIVE-PRODUCT-URL.txt` — deployed Cloud Run URL and review entry point
- `WALKTHROUGH-VIDEO.txt` — public walkthrough URL
- `Aayush-Shrestha-Ajaia-Docs-Walkthrough.mp4` — 4K, 3:09 walkthrough video
- `screenshots/` — editor, dashboard, conflict, collaborator, unauthorized, and verification views
- `CHECKSUMS.txt` — SHA-256 checksums for the source archive and walkthrough video

## Demo logins

No passwords. Pick a user on the landing screen; open a second private window as another to see sharing.

| Name         | Email              |
| ------------ | ------------------ |
| Ada Lovelace | `ada@ajaia.demo`   |
| Grace Hopper | `grace@ajaia.demo` |
| Alan Turing  | `alan@ajaia.demo`  |

## Deliverables

| Deliverable                                                             | Where it is                                                                        | Status                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Deployed application                                                    | https://ajaia-docs-yc6d6jarwq-ue.a.run.app (Cloud Run, us-east1)                   | Complete                                                                                      |
| Source repository                                                       | https://github.com/theaayushstha1/ajaia-docs                                       | Complete                                                                                      |
| README — quickstart, scope, limitations, local setup                    | [README.md](./README.md)                                                           | Complete                                                                                      |
| Architecture note — data model and six decision records                 | [ARCHITECTURE.md](./ARCHITECTURE.md)                                               | Complete                                                                                      |
| AI workflow note — operating model, overrides, what AI got wrong        | [AI-WORKFLOW.md](./AI-WORKFLOW.md)                                                 | Complete                                                                                      |
| Rich-text editor with 750 ms debounced autosave                         | `src/components/editor/DocumentEditor.tsx`, `src/components/DocumentWorkspace.tsx` | Complete                                                                                      |
| File upload — `.txt`, 256 KB cap                                        | `src/lib/import-text.ts`, `POST /api/documents`                                    | Complete, `.txt` only by design                                                               |
| Sharing and permissions                                                 | `src/lib/authz.ts`, `src/db/dal.ts`, `/api/documents/[id]/shares`                  | Complete, two roles by design                                                                 |
| Content validation on writes                                            | `src/lib/content-validation.ts`                                                    | Complete — node allowlist, depth, node-count, 512 KB ceiling                                  |
| Presence, safe concurrent editing, version checkpoints, Markdown export | `PresenceBar.tsx`, `VersionHistory.tsx`, export/version routes                     | Complete; no CRDT text merging by design                                                      |
| Tests                                                                   | `src/lib/*.test.ts`                                                                | 104/104 across authorization, import, validation, and Markdown export                         |
| Live authorization probe                                                | `scripts/probe-authz.mjs` — `npm run probe -- <url>`                               | 25/25 against the deployed URL, including stale-write and revocation checks                   |
| Walkthrough video (3–5 min)                                             | `WALKTHROUGH-VIDEO.txt` and the included MP4                                       | Complete                                                                                      |
| Real-time text merging                                                  | —                                                                                  | Deliberately cut; presence and `409` conflict protection shipped instead, see ARCHITECTURE D5 |

## Time spent

| Phase                                              | Elapsed     |                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prior-art research, scope decisions, plan          | 0:00–0:36   | Read the Outline, Docmost, and Papermark schemas before writing a line. The plan was rewritten twice before any code — once to fix an unrealistic schedule, once to cut `.docx`, the role enum, and an overclaim about IDOR |
| Scaffold, schema, DAL, authorization, tests        | 0:36–0:55   | The part everything else depends on, written before any route handler                                                                                                                                                       |
| Editor, dashboard, share dialog, API routes        | 0:36–0:55   | Built in parallel with the above against a fixed interface contract                                                                                                                                                         |
| Cloud SQL, Secret Manager, Cloud Run, first deploy | 0:36–0:55   | Deployed a database-backed page, not a hello world, so the whole path was proven at once                                                                                                                                    |
| Verification and the secret-newline fix            | 0:55–1:01   | Wrote the HTTP probe; it found a production-only bug on its first run                                                                                                                                                       |
| Design system pass                                 | 1:01–1:08   | Tokens, the document serif, `.ProseMirror` typography                                                                                                                                                                       |
| Documentation, screenshots, video                  | 1:08 onward |                                                                                                                                                                                                                             |

The core application was feature-complete and deployed early in the timebox. The remaining time went to the design pass, bounded enhancements, adversarial verification, written deliverables, and the walkthrough. The final build passes **104/104 automated tests** and **25/25 production HTTP checks**.

The honest reason it was fast: the first 36 minutes were spent deciding what _not_ to build, and the schema came from three production systems rather than from a blank page.

## What I would want a reviewer to look at first

1. `src/lib/authz.ts` and `src/lib/authz.test.ts` — the permission model and its exhaustive matrix.
2. The **Try to break it** section of the README — eight adversarial checks that run in about two minutes.
3. ARCHITECTURE.md **D1** and **D4** — the two decisions that changed mid-build, and why the second one caused the first.
