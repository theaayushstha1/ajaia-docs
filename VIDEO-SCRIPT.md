# Walkthrough script — 3:30

The brief allows 3–5 minutes. Target 3:30. Under-running reads as scope discipline; over-running is the one miss with no upside.

## Before recording

Have all of this already open and warm. Nothing in the video should show a load spinner, a login screen, a terminal, or an IDE.

- **Window A** — signed in as Ada, on a document already containing two or three paragraphs of real-looking text. This is frame one.
- **Window B** — private window, signed in as Grace, sitting on her dashboard.
- **DevTools** in Window A, Network tab, already open on a second monitor or a hidden tab.
- `notes.txt` on the desktop, whose last line is `<script>alert(1)</script>`.
- One document id belonging to Ada copied to the clipboard for the 404 shot.
- Notifications off. Bookmarks bar hidden. Browser zoom at 110% so text is legible at video resolution.

## Script

| Time | What's on screen | What to say |
| --- | --- | --- |
| 0:00–0:12 | Window A, document open, cursor already in the text. Start typing a new sentence immediately. | "This is Ajaia Docs. It's a document editor with autosave, file import, and per-document sharing between users. I'll show it working, then the one decision I'd defend hardest." |
| 0:12–0:35 | Select a line, hit the heading button. Select three lines, make a bulleted list. Bold a phrase. The save indicator ticks Saving → Saved. | "Editing is TipTap. Headings, lists, bold, italic, underline. Every change is debounced and saved automatically — that's the indicator up here going from Saving to Saved." |
| 0:35–0:50 | Hard-refresh the page. Document comes back identical. | "Hard refresh. It's all still there. Content is stored as the editor's own JSON in a Postgres JSONB column, not as HTML — I'll come back to why that matters." |
| 0:50–1:15 | Back to the dashboard. Click **Import .txt**, pick `notes.txt`. New document opens. Scroll to the last line so the `<script>` tag is on screen as literal text. | "Import takes plain text, capped at 256 KB. Note the last line — that's a script tag, and it renders as text, not as markup. The importer puts every character into a text node, so there's no path where an uploaded file becomes live markup." |
| 1:15–1:35 | Window A: open the shared document, click **Share**, type `grace@ajaia.demo`, submit. Grace appears under People with access. | "Sharing is by email against the seeded users. Ada owns this document, and she's giving Grace access." |
| 1:35–2:00 | Snap to Window B. Refresh Grace's dashboard — the document is under **Shared with me**. Open it. Type a word. It saves. Point at the header: no Share button, no Delete button, and the title field is read-only. | "Grace sees it under Shared with me, and she can edit the body. What she doesn't get is Share, Delete, or the title — renaming is owner-only, because the title is how the document is identified on somebody else's dashboard. Owner reads, edits, renames, deletes, shares; collaborator reads and edits. That's the whole matrix, and every cell of it is asserted in a unit test." |
| 2:00–2:30 | Window B, DevTools Network tab. Paste Ada's *unshared* document id into the URL bar as `/docs/<id>`. The 404 page renders; point at the 404 in the Network tab. Then fire the `DELETE /api/documents/<shared-id>` fetch from the console and point at the 403. | "Here's the part I'd want you to poke at. Grace opens a document that was never shared with her — that's a 404, not a 403. A 403 would confirm the document exists, which turns the URL into an existence oracle. But on a document she *can* read, deleting is a 403, because there the existence is already known to her. Different answers on purpose." |
| 2:30–3:00 | Split view: `src/db/schema.ts` next to `src/lib/authz.ts`. Highlight `ownerId` on the `documents` table, then the `document_shares` composite primary key. | "The decision I'd defend hardest: ownership is a column on the document, never a row in the share table. I checked how Outline and Docmost model this before writing any of it, and they both land here. Ownership becomes unrevocable by construction — there's no row you can delete to orphan a document. 'Owned by me' is one index scan instead of a join. And every access resolves through one data-access layer where the permission check lives in the SQL WHERE clause, not in a caller's if-statement." |
| 3:00–3:22 | Back to the running app, dashboard view. | "What I cut, on purpose: real-time co-editing, comments, version history, public links, permission tiers, and .docx import. The two worth explaining — a half-working CRDT loses data, and a document tool that loses data is worse than one that never claimed the feature. And .docx via mammoth is untrusted-input parsing that mammoth's own docs say isn't sanitized; that's the largest attack surface I could have added to an app whose actual subject is access control. Autosave is last-write-wins, and that's the first thing I'd fix." |
| 3:22–3:30 | Dashboard, still. Stop. | "Everything's in the README, including a list of ways to try to break it. Thanks." |

## Common mistakes to avoid

- **Going over time.** Over-running is the one unforgivable miss. Do a timed dry run; if it lands at 3:50, cut words from the 2:30 block, not from the demo.
- **Dead air.** Silence while a page loads reads as a stall. Every click should have narration already covering it — that's why everything is pre-warmed.
- **Reading code line by line.** The only code on screen is two highlighted lines at 2:30, and they illustrate a sentence that was already spoken. Nobody wants a file tour.
- **Apologizing out loud.** No "sorry, this is a bit rough," no "I ran out of time to." Cuts get *explained*, not apologized for — a cut with a reason is a decision, and a cut with an apology is a bug.
- **Starting with yourself.** No name, no agenda, no "so what I built was." Frame one is the working product.
- **Narrating the mouse.** "Now I'm going to click over here" costs four seconds and says nothing.
