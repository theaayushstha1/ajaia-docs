# Narration — 11 lines, keyed to the beat sheet

Spoken at **155 words per minute**. `est` is `words / 155 * 60`. Every line clears
its scene target with at least 11 percent headroom, so a slightly slow read still
lands inside the scene.

Total spoken: **464 words ≈ 179.6s** across **210s** of video. The gap is
deliberate — silence between beats reads as composure, a line that runs past its
scene reads as a mistake.

| scene | target | words | est | line |
|---|---|---|---|---|
| `open` | 14s | 32 | 12.39s | This is Ajaia Docs. A document editor with autosave, file import, and per document sharing. The dashboard splits what you own from what's shared with you. Then the decision I'd defend hardest. |
| `edit` | 24s | 49 | 18.97s | Editing is TipTap. Bold, italic, underline, three heading levels, and both list types. Every change is debounced and saved automatically, seven hundred fifty milliseconds after you stop typing. That's the indicator up here going from Saving to Saved. This isn't a text area. Underneath it's a structured document model. |
| `persist` | 12s | 27 | 10.45s | Hard refresh. It's all still there. Content lives in Postgres as the editor's structured J S O N, never as markup. That choice pays off twice later. |
| `import` | 22s | 47 | 18.19s | Import takes plain text, capped at two hundred fifty six kilobytes. Look at the last line. That's a script tag, and it renders as text, not as markup. The importer puts every character into a text node. There's no path where an uploaded file becomes live markup. |
| `share` | 20s | 44 | 17.03s | Sharing is by email. Ada owns this document. She's giving Grace access. Two roles. Owner reads, edits, renames, deletes, and shares. Collaborator reads and edits the body. Renaming is owner only, because the title is how this document shows up on someone else's dashboard. |
| `presence` | 30s | 68 | 26.32s | Grace opens the same document. Her avatar appears in Ada's header. This is a heartbeat, not a websocket. Each client writes a row every fifteen seconds. Cloud Run scales to zero, so a container has nowhere to hold a live connection. A socket would mean a second always on service for something decorative. Someone can appear a poll late. The platform makes the cruder design the correct one. |
| `conflict` | 24s | 52 | 20.13s | Grace types and saves. Ada types next, on a copy that's already stale. Her save is refused with a four oh nine, and this banner appears. Every save carries the timestamp it was based on, so a stale write matches zero rows. Silent clobbering was the worst thing about the first version. |
| `permissions` | 24s | 55 | 21.29s | Grace's window. No Share button, no Delete button. Alan, who this was never shared with, opens the document id. He gets a four oh four, not a four oh three. A four oh three would confirm the document exists. Every access goes through one data layer, and the permission check lives in the where clause. |
| `history` | 20s | 45 | 17.42s | History lists every version with an author and a time. Snapshots happen per editing session, not per save, because autosave fires constantly. Restoring takes a snapshot first, so the restore is itself undoable. A restore you can't undo is worse than no history at all. |
| `export` | 10s | 22 | 8.52s | Export walks the J S O N into Markdown, escaping anything Markdown would read as formatting. The mirror of the importer's promise. |
| `close` | 10s | 23 | 8.90s | Real time co editing was cut on purpose. A half working C R D T loses data. That's a boundary, not a backlog. |

## Before you generate audio

- Spelled-out letter runs (`J S O N`, `C R D T`) are intentional. ElevenLabs says
  "jason" and "kerdit" if you write them as words. Keep the spaces.
- Numbers are spelled as spoken words throughout. Do not "fix" them back to
  digits — `409` becomes "four hundred nine", which is not what the banner says.
- If a line reads long in the generated audio, cut the last sentence of that
  line. Every line's last sentence is the most droppable one, on purpose.
