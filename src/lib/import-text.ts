import { EMPTY_DOC, type TipTapDoc, type TipTapNode } from "@/db/schema";

export { EMPTY_DOC };
export type { TipTapDoc };

/** Import cap. Plain text this large is already an unreasonable document. */
export const MAX_IMPORT_BYTES = 256 * 1024;

/**
 * Convert a plain .txt file into TipTap JSON.
 *
 * Every character of the input ends up inside a `text` node. There is no path
 * by which input becomes structure: a line containing `<script>alert(1)</script>`
 * becomes a text node whose `text` is that exact string, and TipTap/ProseMirror
 * renders text nodes as text. Markup in the source file is content, not markup.
 *
 * Blank lines separate paragraphs; a single newline inside a paragraph becomes
 * a hardBreak so the original line layout survives the round trip.
 */
/**
 * Postgres text and jsonb cannot store a NUL byte: passing one through raises
 * "unsupported Unicode escape sequence" and the insert fails as a 500 on what
 * is really a bad-input problem. Other C0 control characters carry no meaning
 * in a rich-text document either, so both are dropped rather than rejected -
 * a file with a stray control byte is still a file the user wanted to import.
 * Tab and newline are deliberately preserved.
 */
function stripControlCharacters(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function textToTipTapDoc(text: string): TipTapDoc {
  const normalized = stripControlCharacters(stripBom(text)).replace(/\r\n?/g, "\n");

  if (normalized.trim() === "") return structuredClone(EMPTY_DOC);

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+$/, ""))
    .filter((block) => block.trim() !== "");

  if (blocks.length === 0) return structuredClone(EMPTY_DOC);

  return {
    type: "doc",
    content: blocks.map(paragraphFromBlock),
  };
}

function paragraphFromBlock(block: string): TipTapNode {
  const lines = block.split("\n");
  const content: TipTapNode[] = [];

  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    // ProseMirror rejects empty text nodes, so skip them — the hardBreak
    // already carries the line's meaning.
    if (line.length > 0) content.push({ type: "text", text: line });
  });

  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * "Q3 planning notes.txt" -> "Q3 planning notes".
 * Falls back to the default title when the filename has nothing usable.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExt.replace(/[_-]+/g, " ").trim().replace(/\s+/g, " ");
  return cleaned === "" ? "Untitled document" : cleaned.slice(0, 200);
}
