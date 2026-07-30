#!/usr/bin/env node
/**
 * build-voiceover.mjs — narration script -> ElevenLabs voice track -> muxed demo video.
 *
 * Inputs (see demo/BEAT-SHEET.md for the shared contract):
 *   demo/out/timeline.json  measured startMs/endMs per scene id  (from the recorder)
 *   demo/narration.json     one line of text per scene id        (from the narrator)
 *
 * Outputs:
 *   demo/out/audio/<sceneId>.mp3   per-scene synthesis, content-hash cached
 *   demo/out/voiceover.mp3         one continuous track, clips placed at their startMs
 *   demo/out/captions.srt          subtitles built from timeline + narration
 *   demo/out/demo-final.mp4        demo.mp4 with the voice track muxed on (video stream copied)
 *
 * ElevenLabs bills per character. Run --dry-run first.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DEMO_DIR, '..');

const TTS_ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const SAMPLE_RATE = 44100;

// atempo outside this window stops sounding like a person talking and starts
// sounding like a person being compressed. Refuse rather than mangle.
const TEMPO_MIN = 0.9;
const TEMPO_MAX = 1.15;

// Rough narration rate used only by --offline to size placeholder tones.
const CHARS_PER_SECOND = 14.5;

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// tiny output helpers
// ---------------------------------------------------------------------------

const C = process.stdout.isTTY
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    }
  : {
      dim: (s) => s,
      bold: (s) => s,
      red: (s) => s,
      yellow: (s) => s,
      green: (s) => s,
      cyan: (s) => s,
    };

const log = (...a) => console.log(...a);
const warn = (...a) => console.log(C.yellow('WARN '), ...a);

class BuildError extends Error {}

function die(message, hint) {
  throw new BuildError(hint ? `${message}\n\n${hint}` : message);
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    fit: false,
    offline: false,
    only: null,
    timeline: null,
    narration: null,
    video: null,
    outDir: null,
    help: false,
  };
  const takesValue = new Set(['--only', '--timeline', '--narration', '--video', '--out-dir']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value = null;
    let flag = arg;
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq !== -1) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (takesValue.has(arg)) {
      value = argv[++i];
      if (value === undefined) die(`${arg} needs a value.`);
    }

    switch (flag) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--fit':
        opts.fit = true;
        break;
      case '--offline':
        opts.offline = true;
        break;
      case '--only':
        opts.only = value;
        break;
      case '--timeline':
        opts.timeline = value;
        break;
      case '--narration':
        opts.narration = value;
        break;
      case '--video':
        opts.video = value;
        break;
      case '--out-dir':
        opts.outDir = value;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        die(`Unknown flag: ${arg}`, 'Run with --help to see the supported flags.');
    }
  }
  return opts;
}

const HELP = `
build-voiceover.mjs — synthesize narration and mux it onto the demo video.

  node demo/build-voiceover.mjs [flags]

Flags
  --dry-run            Validate inputs, write captions.srt, print the plan. No API calls, no credits spent.
  --only <sceneId>     Re-synthesize a single scene (still assembles the whole track).
  --fit                Speed up any clip that overruns its scene, within ${TEMPO_MIN}x-${TEMPO_MAX}x. Refuses beyond that.
  --offline            Generate placeholder tones with ffmpeg instead of calling ElevenLabs.
                       Exercises assembly + mux without credentials or credits. Dev/test only.
  --timeline <path>    Override demo/out/timeline.json
  --narration <path>   Override demo/narration.json
  --video <path>       Override demo/out/demo.mp4
  --out-dir <path>     Override demo/out
  -h, --help           This.

Environment (from the shell or .env.local; both values are trimmed)
  ELEVENLABS_API_KEY   required unless --dry-run / --offline
  ELEVENLABS_VOICE_ID  required unless --dry-run / --offline
  ELEVENLABS_MODEL_ID  optional, defaults to ${DEFAULT_MODEL_ID}

ElevenLabs bills per character. Always --dry-run first.
`;

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

async function loadDotEnvLocal() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  try {
    const dotenv = await import('dotenv');
    // Shell env wins over the file; that is dotenv's default (override: false).
    dotenv.config({ path: envPath, quiet: true });
  } catch {
    warn(`could not load dotenv, reading ${envPath} manually`);
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      if (process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

/** A trailing newline on a secret costs an hour. Trim everything. */
function readCredentials() {
  const apiKey = (process.env.ELEVENLABS_API_KEY ?? '').trim();
  const voiceId = (process.env.ELEVENLABS_VOICE_ID ?? '').trim();
  const modelId = (process.env.ELEVENLABS_MODEL_ID ?? '').trim() || DEFAULT_MODEL_ID;

  const missing = [];
  if (!apiKey) missing.push('ELEVENLABS_API_KEY');
  if (!voiceId) missing.push('ELEVENLABS_VOICE_ID');

  if (missing.length) {
    die(
      `Missing required credential(s): ${missing.join(', ')}`,
      [
        'Set them in your shell:',
        ...missing.map((k) => `  export ${k}=...`),
        '',
        `or add them to ${path.join(REPO_ROOT, '.env.local')}:`,
        ...missing.map((k) => `  ${k}=...`),
        '',
        'ELEVENLABS_VOICE_ID is the id of the voice you picked in the ElevenLabs',
        'dashboard (Voices -> your voice -> ID). There is no safe default and this',
        'script will not guess one.',
        '',
        'To validate everything else without credentials, run with --dry-run.',
      ].join('\n'),
    );
  }
  return { apiKey, voiceId, modelId };
}

// ---------------------------------------------------------------------------
// input loading + normalization
// ---------------------------------------------------------------------------

function readJson(file, label, hint) {
  if (!fs.existsSync(file)) die(`${label} not found: ${file}`, hint);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    die(`${label} could not be read: ${file}\n${err.message}`);
  }
  if (!raw.trim()) die(`${label} is empty: ${file}`, hint);
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(`${label} is not valid JSON: ${file}\n${err.message}`);
  }
}

function asFiniteMs(value, sceneId, field) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    die(`timeline.json: scene "${sceneId}" has a non-numeric ${field} (${JSON.stringify(value)}).`);
  }
  return Math.round(n);
}

/**
 * Accepts any of:
 *   { scenes: [ { id, startMs, endMs } ], durationMs? }
 *   [ { id, startMs, endMs } ]
 *   { "<id>": { startMs, endMs } }
 * `scene` / `sceneId` / `name` / `key` are all accepted as the id field.
 */
function normalizeTimeline(doc, file) {
  let rows;
  let declaredDurationMs = null;

  if (Array.isArray(doc)) {
    rows = doc;
  } else if (doc && typeof doc === 'object') {
    declaredDurationMs =
      typeof doc.durationMs === 'number'
        ? doc.durationMs
        : typeof doc.totalMs === 'number'
          ? doc.totalMs
          : null;
    const list = doc.scenes ?? doc.timeline ?? doc.beats;
    if (Array.isArray(list)) {
      rows = list;
    } else {
      rows = Object.entries(doc)
        .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
        .map(([id, v]) => ({ id, ...v }));
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    die(
      `timeline.json has no scenes: ${file}`,
      'Expected { "scenes": [ { "id": "...", "startMs": 0, "endMs": 12000 }, ... ] }\n' +
        '(a bare array, or an object keyed by scene id, also work).',
    );
  }

  const scenes = [];
  const seen = new Set();
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      die(`timeline.json: entry ${i} is not an object.`);
    }
    const id = row.id ?? row.sceneId ?? row.scene ?? row.name ?? row.key;
    if (typeof id !== 'string' || !id.trim()) {
      die(`timeline.json: entry ${i} has no usable scene id.`, 'Each scene needs a string "id".');
    }
    if (seen.has(id)) die(`timeline.json: duplicate scene id "${id}".`);
    seen.add(id);

    const startMs = asFiniteMs(row.startMs ?? row.start ?? row.tStartMs, id, 'startMs');
    const endMs = asFiniteMs(row.endMs ?? row.end ?? row.tEndMs, id, 'endMs');
    if (startMs < 0) die(`timeline.json: scene "${id}" has a negative startMs (${startMs}).`);
    if (endMs <= startMs) {
      die(`timeline.json: scene "${id}" ends at or before it starts (${startMs} -> ${endMs}).`);
    }
    scenes.push({ id, startMs, endMs, durationMs: endMs - startMs });
  }

  scenes.sort((a, b) => a.startMs - b.startMs);
  const maxEnd = Math.max(...scenes.map((s) => s.endMs));
  return { scenes, durationMs: Math.max(declaredDurationMs ?? 0, maxEnd) };
}

/**
 * Accepts any of:
 *   { voiceSettings?, lines: [ { id, text, voiceSettings? } ] }
 *   { voiceSettings?, lines: { "<id>": "text" | { text, voiceSettings? } } }
 *   [ { id, text } ]
 *   { "<id>": "text" }
 */
function normalizeNarration(doc, file) {
  const RESERVED = new Set([
    'voiceSettings',
    'voice_settings',
    'modelId',
    'model_id',
    'voiceId',
    'voice_id',
    'lines',
    'scenes',
    'narration',
    'meta',
    'notes',
    'version',
  ]);

  const globalSettings = doc && !Array.isArray(doc) ? (doc.voiceSettings ?? doc.voice_settings) : null;
  const globalModelId = doc && !Array.isArray(doc) ? (doc.modelId ?? doc.model_id) : null;

  let rows;
  if (Array.isArray(doc)) {
    rows = doc;
  } else if (doc && typeof doc === 'object') {
    const container = doc.lines ?? doc.scenes ?? doc.narration;
    if (Array.isArray(container)) {
      rows = container;
    } else if (container && typeof container === 'object') {
      rows = Object.entries(container).map(([id, v]) => ({ id, ...coerceLine(v) }));
    } else {
      rows = Object.entries(doc)
        .filter(([k]) => !RESERVED.has(k))
        .map(([id, v]) => ({ id, ...coerceLine(v) }));
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    die(
      `narration.json has no lines: ${file}`,
      'Expected { "lines": [ { "id": "...", "text": "..." }, ... ] }\n' +
        '(a bare array, or an object mapping scene id -> text, also work).',
    );
  }

  const lines = new Map();
  for (const [i, row] of rows.entries()) {
    const norm = row && typeof row === 'object' && 'text' in row ? row : coerceLine(row);
    const id = row?.id ?? row?.sceneId ?? row?.scene ?? norm?.id;
    if (typeof id !== 'string' || !id.trim()) {
      die(`narration.json: entry ${i} has no usable scene id.`);
    }
    const text = typeof norm?.text === 'string' ? norm.text.trim() : null;
    if (!text) {
      die(`narration.json: scene "${id}" has no non-empty "text".`);
    }
    if (lines.has(id)) die(`narration.json: duplicate scene id "${id}".`);
    lines.set(id, {
      id,
      text,
      voiceSettings: row?.voiceSettings ?? row?.voice_settings ?? globalSettings ?? null,
      modelId: row?.modelId ?? row?.model_id ?? globalModelId ?? null,
    });
  }
  return lines;
}

function coerceLine(v) {
  if (typeof v === 'string') return { text: v };
  if (v && typeof v === 'object') return { text: v.text ?? v.line ?? v.narration, ...v };
  return { text: undefined };
}

function crossCheck(timeline, narrationLines) {
  const timelineIds = timeline.scenes.map((s) => s.id);
  const narrationIds = [...narrationLines.keys()];
  const missingNarration = timelineIds.filter((id) => !narrationLines.has(id));
  const orphanNarration = narrationIds.filter((id) => !timelineIds.includes(id));

  if (missingNarration.length || orphanNarration.length) {
    const parts = ['timeline.json and narration.json do not agree on scene ids.'];
    if (missingNarration.length) {
      parts.push('', 'In timeline.json but missing from narration.json:');
      parts.push(...missingNarration.map((id) => `  - ${id}`));
    }
    if (orphanNarration.length) {
      parts.push('', 'In narration.json but missing from timeline.json:');
      parts.push(...orphanNarration.map((id) => `  - ${id}`));
    }
    parts.push('', 'Every scene id must appear in both files. Fix the mismatch and re-run.');
    die(parts.join('\n'));
  }
}

// ---------------------------------------------------------------------------
// ffmpeg / ffprobe
// ---------------------------------------------------------------------------

function run(bin, args, { capture = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'pipe'] });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      reject(
        new BuildError(
          err.code === 'ENOENT'
            ? `${bin} not found on PATH. Install it (brew install ffmpeg) and re-run.`
            : `${bin} failed to start: ${err.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new BuildError(`${bin} exited ${code}\n${args.join(' ')}\n\n${stderr.trim()}`));
    });
  });
}

async function probeDurationSec(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const sec = Number(stdout.trim());
  if (!Number.isFinite(sec)) {
    die(`ffprobe could not read a duration from ${file}. The file may be truncated or not audio.`);
  }
  return sec;
}

// ---------------------------------------------------------------------------
// synthesis
// ---------------------------------------------------------------------------

function hashSource({ text, voiceId, modelId, voiceSettings, outputFormat }) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        text,
        voiceId,
        modelId,
        voiceSettings: voiceSettings ?? null,
        outputFormat,
      }),
    )
    .digest('hex');
}

function sidecarPath(mp3Path) {
  return mp3Path.replace(/\.mp3$/, '.json');
}

function isCached(mp3Path, hash) {
  if (!fs.existsSync(mp3Path)) return false;
  if (fs.statSync(mp3Path).size === 0) return false;
  const side = sidecarPath(mp3Path);
  if (!fs.existsSync(side)) return false;
  try {
    return JSON.parse(fs.readFileSync(side, 'utf8')).hash === hash;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synthesize({ apiKey, voiceId, modelId, text, voiceSettings }) {
  const url = `${TTS_ENDPOINT}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
  const body = { text, model_id: modelId };
  if (voiceSettings) body.voice_settings = voiceSettings;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) die(`Network error calling ElevenLabs: ${err.message}`);
      const backoff = 1000 * 2 ** (attempt - 1);
      warn(`network error (${err.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }

    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) die('ElevenLabs returned a 200 with an empty body.');
      return buf;
    }

    const detail = (await res.text().catch(() => '')).slice(0, 2000);

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2000 * 2 ** (attempt - 1);
      warn(
        `ElevenLabs ${res.status} ${res.statusText}; backing off ${backoff}ms ` +
          `(attempt ${attempt}/${MAX_RETRIES})\n${C.dim(detail)}`,
      );
      await sleep(backoff);
      continue;
    }

    const hints = {
      401: 'ELEVENLABS_API_KEY is wrong, revoked, or has a stray newline. Regenerate it in the ElevenLabs dashboard.',
      403: 'The key is valid but not allowed to use this voice or model. Check the voice belongs to your account.',
      404: 'ELEVENLABS_VOICE_ID does not exist on this account. Copy it from Voices -> your voice -> ID.',
      422: 'ElevenLabs rejected the request body — usually an unknown model_id or an out-of-range voice_settings value.',
      429: 'Rate limited or out of quota. Check your character balance.',
    };
    die(
      `ElevenLabs returned ${res.status} ${res.statusText}\n${detail}`,
      hints[res.status] ?? 'See https://elevenlabs.io/docs/api-reference/text-to-speech',
    );
  }
  return null; // unreachable
}

/** Placeholder tone sized to the text, so --offline exercises the real assembly path. */
async function synthesizeTone(text, outPath) {
  const seconds = Math.max(0.8, text.length / CHARS_PER_SECOND);
  const freq = 180 + (text.length % 7) * 40;
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:sample_rate=${SAMPLE_RATE}:duration=${seconds.toFixed(3)}`,
    '-ac',
    '2',
    '-b:a',
    '128k',
    outPath,
  ]);
}

// ---------------------------------------------------------------------------
// captions
// ---------------------------------------------------------------------------

function srtTime(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const msPart = clamped % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(msPart, 3)}`;
}

/** Pack a line into readable cues of at most ~84 chars, breaking at sentences then words. */
function splitIntoCues(text, maxChars = 84) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const pieces = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      pieces.push(sentence);
      continue;
    }
    let current = '';
    for (const word of sentence.split(/\s+/)) {
      if (current && `${current} ${word}`.length > maxChars) {
        pieces.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) pieces.push(current);
  }

  const cues = [];
  for (const piece of pieces) {
    const last = cues[cues.length - 1];
    if (last && `${last} ${piece}`.length <= maxChars) cues[cues.length - 1] = `${last} ${piece}`;
    else cues.push(piece);
  }
  return cues.length ? cues : [text];
}

/** Wrap a cue onto at most two balanced lines. */
function wrapCue(cue, maxLineChars = 42) {
  if (cue.length <= maxLineChars) return cue;
  const words = cue.split(/\s+/);
  const target = Math.ceil(cue.length / 2);
  let first = '';
  let i = 0;
  while (i < words.length && (first.length + words[i].length + 1 <= target || !first)) {
    first = first ? `${first} ${words[i]}` : words[i];
    i++;
  }
  const second = words.slice(i).join(' ');
  return second ? `${first}\n${second}` : first;
}

function buildSrt(timeline, narrationLines) {
  const blocks = [];
  let index = 1;
  for (const scene of timeline.scenes) {
    const text = narrationLines.get(scene.id).text;
    const cues = splitIntoCues(text);
    const totalChars = cues.reduce((sum, c) => sum + c.length, 0) || 1;
    let cursor = scene.startMs;
    for (const [i, cue] of cues.entries()) {
      const share = (cue.length / totalChars) * scene.durationMs;
      const start = cursor;
      const end = i === cues.length - 1 ? scene.endMs : Math.min(scene.endMs, Math.round(cursor + share));
      cursor = end;
      if (end <= start) continue;
      blocks.push(`${index++}\n${srtTime(start)} --> ${srtTime(end)}\n${wrapCue(cue)}\n`);
    }
  }
  return `${blocks.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// assembly + mux
// ---------------------------------------------------------------------------

/**
 * One continuous track: a silent bed the full length of the video, with each clip
 * adelay'd to its scene's startMs and mixed in at unity gain.
 */
async function assembleTrack(placements, totalMs, outPath) {
  const totalSec = (totalMs / 1000).toFixed(3);
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-t',
    totalSec,
    '-i',
    `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`,
  ];
  for (const p of placements) args.push('-i', p.file);

  const chains = placements.map(
    (p, i) =>
      `[${i + 1}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `adelay=${p.startMs}:all=1[d${i}]`,
  );
  const mixIn = ['[0:a]', ...placements.map((_, i) => `[d${i}]`)].join('');
  const filter =
    `${chains.join(';')}${chains.length ? ';' : ''}` +
    `${mixIn}amix=inputs=${placements.length + 1}:duration=longest:normalize=0:dropout_transition=0[out]`;

  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-t',
    totalSec,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    '-ar',
    String(SAMPLE_RATE),
    outPath,
  );
  await run('ffmpeg', args);
}

async function mux(videoPath, audioPath, outPath) {
  await run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    outPath,
  ]);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const fmtSec = (sec) => `${sec >= 0 ? '' : '-'}${Math.abs(sec).toFixed(2)}s`;

function printTable(rows) {
  const headers = ['scene', 'scene dur', 'audio dur', 'slack / overrun', 'status'];
  const data = rows.map((r) => [
    r.id,
    fmtSec(r.sceneSec),
    r.audioSec == null ? '—' : fmtSec(r.audioSec),
    r.audioSec == null ? '—' : r.slackSec >= 0 ? `+${r.slackSec.toFixed(2)}s` : `${r.slackSec.toFixed(2)}s`,
    r.status,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => stripAnsi(row[i]).length)),
  );
  const line = (cells) =>
    cells.map((c, i) => c + ' '.repeat(widths[i] - stripAnsi(c).length)).join('  ');

  log('');
  log(C.bold(line(headers)));
  log(C.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const row of data) log(line(row));
}

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    log(HELP.trim());
    return;
  }

  const outDir = path.resolve(opts.outDir ?? path.join(DEMO_DIR, 'out'));
  const audioDir = path.join(outDir, 'audio');
  const timelinePath = path.resolve(opts.timeline ?? path.join(outDir, 'timeline.json'));
  const narrationPath = path.resolve(opts.narration ?? path.join(DEMO_DIR, 'narration.json'));
  const videoPath = path.resolve(opts.video ?? path.join(outDir, 'demo.mp4'));
  const voiceoverPath = path.join(outDir, 'voiceover.mp3');
  const captionsPath = path.join(outDir, 'captions.srt');
  const finalPath = path.join(outDir, 'demo-final.mp4');

  // --- Step 1: validate -----------------------------------------------------
  const timeline = normalizeTimeline(
    readJson(
      timelinePath,
      'timeline.json',
      'The recorder writes this. Run the recorder first, or point at a file with --timeline <path>.',
    ),
    timelinePath,
  );
  const narrationLines = normalizeNarration(
    readJson(
      narrationPath,
      'narration.json',
      'The narrator writes this. Create it, or point at a file with --narration <path>.',
    ),
    narrationPath,
  );
  crossCheck(timeline, narrationLines);

  if (opts.only && !narrationLines.has(opts.only)) {
    die(
      `--only "${opts.only}" is not a known scene id.`,
      `Known ids:\n${timeline.scenes.map((s) => `  - ${s.id}`).join('\n')}`,
    );
  }

  const totalChars = [...narrationLines.values()].reduce((sum, l) => sum + l.text.length, 0);
  log(C.bold('Ajaia Docs — voiceover build'));
  log(`  timeline   ${C.dim(timelinePath)}`);
  log(`  narration  ${C.dim(narrationPath)}`);
  log(
    `  ${timeline.scenes.length} scenes, ${totalChars} characters, ` +
      `video length ${fmtSec(timeline.durationMs / 1000)}`,
  );

  await loadDotEnvLocal();
  const needsApi = !opts.dryRun && !opts.offline;
  const creds = needsApi ? readCredentials() : null;
  const voiceId = creds?.voiceId ?? 'offline-tone';
  const defaultModelId = creds?.modelId ?? (process.env.ELEVENLABS_MODEL_ID ?? '').trim() ?? DEFAULT_MODEL_ID;

  if (opts.offline) {
    warn('--offline: generating placeholder tones with ffmpeg. No speech, no API calls.');
  }

  fs.mkdirSync(audioDir, { recursive: true });

  // --- captions are free, always write them --------------------------------
  fs.writeFileSync(captionsPath, buildSrt(timeline, narrationLines), 'utf8');
  log(`  captions   ${C.green(captionsPath)}`);

  // --- Step 2: synthesize ---------------------------------------------------
  const rows = [];
  let charsToSynthesize = 0;

  for (const scene of timeline.scenes) {
    const line = narrationLines.get(scene.id);
    const modelId = line.modelId || defaultModelId || DEFAULT_MODEL_ID;
    const mp3Path = path.join(audioDir, `${scene.id}.mp3`);
    const hash = hashSource({
      text: line.text,
      voiceId,
      modelId,
      voiceSettings: line.voiceSettings,
      outputFormat: opts.offline ? 'tone' : OUTPUT_FORMAT,
    });
    const cached = isCached(mp3Path, hash);
    const targeted = !opts.only || opts.only === scene.id;
    const willSynthesize = targeted && (!cached || opts.only === scene.id);

    if (willSynthesize) charsToSynthesize += line.text.length;

    rows.push({
      ...scene,
      text: line.text,
      voiceSettings: line.voiceSettings,
      modelId,
      mp3Path,
      hash,
      cached,
      willSynthesize,
      sceneSec: scene.durationMs / 1000,
      audioSec: null,
      slackSec: 0,
      status: '',
    });
  }

  if (opts.dryRun) {
    log('');
    log(C.bold('Plan (--dry-run: nothing was sent to ElevenLabs)'));
    for (const r of rows) {
      const action = r.willSynthesize
        ? C.yellow(`synthesize ${r.text.length} chars`)
        : r.cached
          ? C.green('cached')
          : C.dim('skipped (--only)');
      log(`  ${r.id.padEnd(18)} ${fmtSec(r.sceneSec).padStart(8)}  ${action}`);
      if (!r.cached && !r.willSynthesize) continue;
    }
    log('');
    log(`  would synthesize ${C.bold(String(charsToSynthesize))} characters ` +
      `(ElevenLabs bills per character — this is the number that costs money)`);
    log(`  model      ${defaultModelId || DEFAULT_MODEL_ID}`);
    log(`  voice      ${needsApi ? voiceId : C.dim('not read in --dry-run')}`);
    log(`  would write ${voiceoverPath}`);
    log(`  would mux   ${videoPath} -> ${finalPath}`);
    if (!fs.existsSync(videoPath)) {
      warn(`${videoPath} does not exist yet — the mux step would be skipped.`);
    }
    log('');
    log(C.green('Dry run OK.') + ' Re-run without --dry-run to synthesize.');
    return;
  }

  for (const r of rows) {
    if (!r.willSynthesize) {
      if (!fs.existsSync(r.mp3Path)) {
        die(
          `Scene "${r.id}" has no audio at ${r.mp3Path} and was excluded by --only.`,
          'Run once without --only to generate the full set first.',
        );
      }
      log(`  ${C.dim('cached')}     ${r.id}`);
      continue;
    }
    process.stdout.write(`  ${C.cyan('synth')}      ${r.id} (${r.text.length} chars) ... `);
    if (opts.offline) {
      await synthesizeTone(r.text, r.mp3Path);
    } else {
      const buf = await synthesize({
        apiKey: creds.apiKey,
        voiceId: creds.voiceId,
        modelId: r.modelId,
        text: r.text,
        voiceSettings: r.voiceSettings,
      });
      fs.writeFileSync(r.mp3Path, buf);
    }
    fs.writeFileSync(
      sidecarPath(r.mp3Path),
      `${JSON.stringify(
        {
          hash: r.hash,
          sceneId: r.id,
          text: r.text,
          voiceId,
          modelId: r.modelId,
          voiceSettings: r.voiceSettings ?? null,
          outputFormat: opts.offline ? 'tone' : OUTPUT_FORMAT,
          generatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    log(C.green('ok'));
  }

  // --- Step 3: check the fit ------------------------------------------------
  const overruns = [];
  const placements = [];

  for (const r of rows) {
    const audioSec = await probeDurationSec(r.mp3Path);
    r.audioSec = audioSec;
    r.slackSec = r.sceneSec - audioSec;
    let file = r.mp3Path;

    const fittedPath = path.join(audioDir, `${r.id}.fit.mp3`);
    if (fs.existsSync(fittedPath)) fs.rmSync(fittedPath);

    if (r.slackSec >= 0) {
      r.status = C.green('fits');
    } else {
      const tempo = audioSec / r.sceneSec; // > 1
      if (opts.fit && tempo <= TEMPO_MAX) {
        const applied = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, tempo));
        await run('ffmpeg', [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          r.mp3Path,
          '-filter:a',
          `atempo=${applied.toFixed(4)}`,
          '-b:a',
          '128k',
          fittedPath,
        ]);
        const fittedSec = await probeDurationSec(fittedPath);
        file = fittedPath;
        r.audioSec = fittedSec;
        r.slackSec = r.sceneSec - fittedSec;
        r.status = C.yellow(`fitted @${applied.toFixed(3)}x`);
        warn(
          `"${r.id}" ran ${Math.abs(r.sceneSec - audioSec).toFixed(2)}s long; ` +
            `sped up to ${applied.toFixed(3)}x to fit.`,
        );
      } else {
        r.status = C.red(`OVER ${Math.abs(r.slackSec).toFixed(2)}s`);
        overruns.push({ ...r, overrunSec: Math.abs(r.slackSec), tempo });
        warn(
          C.red(
            `"${r.id}" audio is ${audioSec.toFixed(2)}s but the scene is only ` +
              `${r.sceneSec.toFixed(2)}s — overruns by ${Math.abs(r.slackSec).toFixed(2)}s.`,
          ),
        );
        if (opts.fit) {
          warn(
            `  ...and --fit cannot help: it would need ${tempo.toFixed(3)}x, above the ` +
              `${TEMPO_MAX}x ceiling. Shorten the line for "${r.id}" in narration.json instead.`,
          );
        }
      }
    }
    placements.push({ id: r.id, file, startMs: r.startMs });
  }

  // --- Step 4: assemble -----------------------------------------------------
  const audioEndMs = Math.max(...rows.map((r) => r.startMs + r.audioSec * 1000));
  const totalMs = Math.ceil(Math.max(timeline.durationMs, audioEndMs));
  await assembleTrack(placements, totalMs, voiceoverPath);
  const voiceoverSec = await probeDurationSec(voiceoverPath);
  log('');
  log(`  track      ${C.green(voiceoverPath)} (${fmtSec(voiceoverSec)})`);

  // --- Step 5: mux ----------------------------------------------------------
  let muxed = null;
  if (fs.existsSync(videoPath)) {
    await mux(videoPath, voiceoverPath, finalPath);
    muxed = finalPath;
    log(`  final      ${C.green(finalPath)} (${fmtSec(await probeDurationSec(finalPath))})`);
  } else {
    warn(
      `${videoPath} not found — skipped the mux. The voice track and captions are still written.\n` +
        `       Once the recorder produces demo.mp4, re-run (everything is cached, so it costs nothing).`,
    );
  }

  // --- Step 6: report -------------------------------------------------------
  printTable(rows);

  if (overruns.length) {
    log('');
    log(C.red(C.bold(`${overruns.length} scene(s) overrun their slot:`)));
    for (const o of overruns) {
      log(
        C.red(`  - ${o.id}: audio ${o.audioSec.toFixed(2)}s vs scene ${o.sceneSec.toFixed(2)}s ` +
          `(+${o.overrunSec.toFixed(2)}s, would need ${o.tempo.toFixed(3)}x)`),
      );
    }
    log('');
    log(
      overruns.some((o) => o.tempo <= TEMPO_MAX) && !opts.fit
        ? `  Re-run with --fit to speed these up within ${TEMPO_MIN}x-${TEMPO_MAX}x.`
        : `  These are beyond the ${TEMPO_MAX}x ceiling. Shorten the lines in narration.json ` +
          `rather than compressing them further.`,
    );
  }

  log('');
  log(C.bold('Outputs'));
  log(`  ${voiceoverPath}  ${fmtSec(voiceoverSec)}`);
  log(`  ${captionsPath}`);
  if (muxed) log(`  ${muxed}`);
  log('');
  process.exitCode = overruns.length ? 1 : 0;
}

main().catch((err) => {
  console.error('');
  if (err instanceof BuildError) console.error(C.red('Error: ') + err.message);
  else console.error(C.red('Unexpected error: ') + (err?.stack ?? err));
  console.error('');
  process.exit(1);
});
