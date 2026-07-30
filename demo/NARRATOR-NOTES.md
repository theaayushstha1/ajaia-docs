# Narrator notes

## Budget

155 wpm, 10 percent headroom. Effective budget is `target_seconds * 2.325` words.
All 11 scenes clear it:

| scene | target | budget (words) | actual | est | headroom |
|---|---|---|---|---|---|
| `open` | 14s | 32 | 32 | 12.39s | 11.5% |
| `edit` | 24s | 55 | 49 | 18.97s | 21.0% |
| `persist` | 12s | 27 | 27 | 10.45s | 12.9% |
| `import` | 22s | 51 | 47 | 18.19s | 17.3% |
| `share` | 20s | 46 | 44 | 17.03s | 14.8% |
| `presence` | 30s | 69 | 68 | 26.32s | 12.3% |
| `conflict` | 24s | 55 | 52 | 20.13s | 16.1% |
| `permissions` | 24s | 55 | 55 | 21.29s | 11.3% |
| `history` | 20s | 46 | 45 | 17.42s | 12.9% |
| `export` | 10s | 23 | 22 | 8.52s | 14.8% |
| `close` | 10s | 23 | 23 | 8.90s | 11.0% |

464 words, 179.6s of speech in 210s of video.

Word counts are whitespace-split, which counts `J S O N` as four tokens. That is
the right accounting: TTS spends roughly a word's worth of time per spelled
letter, so the split matches the clock rather than the dictionary.

`permissions` is the tightest at 11.3 percent and it is also the most important
line in the video. If the generated audio runs long there, cut the last sentence
(`Every access goes through one data layer...`) rather than compressing the four
oh four sentence. That sentence is the whole beat.

## Claims verified in code, not taken from the docs

| claim | where |
|---|---|
| autosave debounce is 750ms | `src/components/editor/DocumentEditor.tsx:17` — `AUTOSAVE_DELAY_MS = 750` |
| import cap is 256 KB | `src/lib/import-text.ts:7` — `MAX_IMPORT_BYTES = 256 * 1024`, asserted in `src/lib/import-text.test.ts:98` |
| presence polls every 15s | `src/components/PresenceBar.tsx:21` — `POLL_INTERVAL_MS = 15_000` |
| version snapshots are per session, not per save | `src/db/schema.ts:81` comment, plus ARCHITECTURE D9 |

Everything else (404 vs 403, the `updatedAt` precondition in the UPDATE's WHERE,
ownership as a column, DAL predicate in SQL, Markdown escaping) is stated in
README and ARCHITECTURE and is consistent across both.

## Left out because I could not confirm it inside the timebox

- **The 45-second presence recency window.** ARCHITECTURE D8 states it, but I only
  verified the 15s client poll in code, not the server-side cutoff. It was
  costing words in an already-full scene, so the line says "every fifteen seconds"
  and stops there.
- **"22 out of 22 probe checks against the deployment."** True per README, but
  nothing in the beat sheet puts a terminal or test output on screen, and the
  beat sheet forbids showing one. Narrating a number the viewer cannot see is the
  kind of claim a reviewer discounts.
- **The `403` on a document Grace *can* read** (the delete case from
  `VIDEO-SCRIPT.md`). The `permissions` scene as written by the recorder shows no
  DevTools console, so the contrast has nothing on screen to anchor to. Saying
  "four oh three" twice in one breath also muddies the one sentence that has to
  land. The README's "Try to break it" section covers it for anyone who follows up.
- **The unit-test matrix and the `SESSION_SECRET` trailing-newline story.** Both
  are strong, both are text-only, neither has a frame.
- **Per-field merging, RLS, keyset pagination** and the rest of the "what I'd do
  with two more hours" column. `close` has 23 words. It buys exactly one boundary.

## Choices worth knowing about

- **`open` teases and does not deliver.** "Then the decision I'd defend hardest"
  sets up `permissions`, which is where the payoff lands. Fourteen seconds is not
  enough to both introduce the product and argue an access model.
- **`persist` says "pays off twice later"** — it is pointing forward at `history`
  (snapshotting structured JSON is one value to copy) and `export` (walking JSON
  to Markdown). Neither later line has room to say "because of D1", so the setup
  goes here where there are spare seconds.
- **`presence` never says the word "avatars" as the point.** One clause
  acknowledges what is on screen, the remaining fifty words are the heartbeat
  argument. That is where the seniority signal is.
- **`conflict` closes on "the worst thing about the first version."** Naming your
  own top limitation and then having fixed it reads differently than shipping the
  fix silently.
- **No sign-off.** `close` ends on the boundary sentence. No thanks, no name, no
  "let me know." The last thing in the viewer's ear is a decision.
- **Punctuation.** No em dashes, no parentheses, no semicolons anywhere in the
  lines. Commas and periods only, so the TTS prosody stays predictable.
