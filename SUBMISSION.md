# Submission — Ajaia AI-Native Full Stack Developer Assignment

**Aayush Shrestha**

| | |
| --- | --- |
| Live app | <!-- LIVE_URL --> |
| Repository | <!-- REPO_URL --> |
| Walkthrough video | <!-- VIDEO_URL --> |

## Demo logins

No passwords. Pick a user on the landing screen; open a second private window as another to see sharing.

| Name | Email |
| --- | --- |
| Ada Lovelace | `ada@ajaia.demo` |
| Grace Hopper | `grace@ajaia.demo` |
| Alan Turing | `alan@ajaia.demo` |

## Deliverables

| Deliverable | Where it is | Status |
| --- | --- | --- |
| Deployed application | <!-- LIVE_URL --> (Cloud Run, us-east1) | Complete |
| Source repository | <!-- REPO_URL --> | Complete |
| README — quickstart, scope, limitations, local setup | [README.md](./README.md) | Complete |
| Architecture note — data model and six decision records | [ARCHITECTURE.md](./ARCHITECTURE.md) | Complete |
| AI workflow note — operating model, overrides, what AI got wrong | [AI-WORKFLOW.md](./AI-WORKFLOW.md) | Complete |
| Rich-text editor with 750 ms debounced autosave | `src/components/editor/DocumentEditor.tsx`, `src/components/DocumentWorkspace.tsx` | Complete |
| File upload — `.txt`, 256 KB cap | `src/lib/import-text.ts`, `POST /api/documents` | Complete, `.txt` only by design |
| Sharing and permissions | `src/lib/authz.ts`, `src/db/dal.ts`, `/api/documents/[id]/shares` | Complete, two roles by design |
| Content validation on writes | `src/lib/content-validation.ts` | Complete — node allowlist, depth, node-count, 512 KB ceiling |
| Tests | `authz.test.ts`, `import-text.test.ts`, `content-validation.test.ts` | Unit only; no integration tests |
| Walkthrough video (3–5 min) | <!-- VIDEO_URL --> | Complete |
| Real-time collaboration | — | Deliberately cut, see ARCHITECTURE D5 |

## Time spent

| Phase | Approx. | |
| --- | --- | --- |
| Prior-art research and scope decisions | 25 min | Read the Outline, Docmost, and Papermark schemas before writing anything |
| Schema, DAL, authorization, tests | 55 min | The part everything else depends on |
| Editor, autosave, dashboard, share dialog | 75 min | |
| Import and hardening pass | 25 min | 404-not-403, uuid guard, PATCH allowlist |
| Deployment — Cloud Run, Cloud SQL, Secret Manager | 40 min | Started early on purpose; deploy problems do not compress |
| Documentation and video | 40 min | |

<!-- TODO(verify): these are estimates written before the build closed out. Adjust to the real numbers if they moved. -->

## What I would want a reviewer to look at first

1. `src/lib/authz.ts` and `src/lib/authz.test.ts` — the permission model and its exhaustive matrix.
2. The **Try to break it** section of the README — six adversarial checks that run in about two minutes.
3. ARCHITECTURE.md **D1** and **D4** — the two decisions that changed mid-build, and why the second one caused the first.
