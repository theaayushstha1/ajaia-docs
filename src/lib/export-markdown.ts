/**
 * TipTap JSON -> Markdown.
 *
 * The mirror image of `import-text.ts`: that module guarantees a byte of the
 * source file can never become structure, and this one guarantees a byte of
 * the document can never become Markdown syntax. A paragraph containing the
 * literal characters `*not emphasis*` must come back out of the file as those
 * same characters, not as emphasis — so every character the reader would
 * interpret is escaped on the way out.
 *
 * Deliberately zero I/O: no database, no `next/headers`, no env, no imports at
 * all. The input is typed `unknown` because the caller hands us a `jsonb`
 * column: it is whatever was written to Postgres, possibly by an older version
 * of the editor. Nothing in here throws — malformed input yields an empty
 * string, and node types we do not recognize are stepped over rather than
 * killing the export of the rest of the document.
 */

/** Two spaces per nesting level, the indentation every Markdown parser agrees on. */
const INDENT = "  ";

/**
 * Characters that change meaning anywhere in a line. `<` is on the list even
 * though the rest of this module never emits raw HTML except for underline
 * (below) — without it a user who literally types `<u>` would be
 * indistinguishable from our own escape hatch.
 */
const INLINE_ESCAPE = /[\\`*_[\]<]/g;

/**
 * Underline has no Markdown equivalent. CommonMark has bold and italic and
 * nothing else, so the options are to drop the formatting silently or to emit
 * the one HTML tag Markdown renderers universally pass through. Losing
 * formatting the user applied is the worse failure, so underline exports as
 * `<u>x</u>` and every other character in the document stays escaped.
 */
const MARK_WRAPPERS: Record<string, readonly [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
};

/**
 * Applied innermost first, so bold + italic composes to `***x***` and the
 * HTML tag always ends up on the outside where it cannot split a delimiter run.
 */
const MARK_ORDER = ["italic", "bold", "underline"] as const;

type JsonRecord = Record<string, unknown>;

/**
 * Render a stored TipTap document as Markdown.
 *
 * Returns `""` for anything that is not a `doc` node with content — null, a
 * string, a number, an empty document.
 */
export function tipTapToMarkdown(doc: unknown): string {
  const blocks = rootBlocks(doc);
  if (blocks.length === 0) return "";

  const lines: string[] = [];
  for (const block of blocks) {
    const rendered = renderBlock(block, 0);
    if (rendered.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(...rendered);
  }

  return finalize(lines.join("\n"));
}

/**
 * `"Q3 Product Planning"` -> `"q3-product-planning.md"`.
 *
 * The result is always `[a-z0-9-]+\.md`, which is what makes it safe to drop
 * into a `Content-Disposition` header. A title with nothing sluggable in it
 * (`"???"`, `"日本語"`, `""`) falls back to `document.md` rather than
 * producing a bare extension.
 */
export function markdownFilename(title: string): string {
  const base = typeof title === "string" ? title : "";
  const slug = base
    // Decompose accents so "Café" slugs to "cafe" instead of losing the vowel.
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    // The slice can land mid-separator; trim again so the name never ends in "-".
    .replace(/-+$/g, "");

  return `${slug === "" ? "document" : slug}.md`;
}

function rootBlocks(doc: unknown): unknown[] {
  if (!isRecord(doc) || doc.type !== "doc") return [];
  return Array.isArray(doc.content) ? doc.content : [];
}

function renderBlock(node: unknown, depth: number): string[] {
  if (!isRecord(node)) return [];

  switch (node.type) {
    case "paragraph":
      return renderParagraph(node);
    case "heading":
      return renderHeading(node);
    case "bulletList":
      return renderList(node, depth, false);
    case "orderedList":
      return renderList(node, depth, true);
    default:
      return renderUnknownBlock(node, depth);
  }
}

/**
 * A node type this version does not know about. Dropping it outright would
 * also drop everything inside it, so a wrapper is unwrapped and a stray inline
 * node is promoted to a paragraph. Only a leaf that carries no text at all
 * disappears.
 */
function renderUnknownBlock(node: JsonRecord, depth: number): string[] {
  const children = childNodes(node);

  if (children.length === 0) {
    return toLines(escapeLineStarts(renderInline([node])));
  }

  if (children.every(isInlineNode)) return renderParagraph(node);

  return children.flatMap((child) => renderBlock(child, depth));
}

function renderParagraph(node: JsonRecord): string[] {
  return toLines(escapeLineStarts(renderInline(childNodes(node))));
}

function renderHeading(node: JsonRecord): string[] {
  const level = headingLevel(node);
  // A heading is a single line by definition, so a hardBreak inside one
  // collapses to a space instead of severing the heading from its text.
  const text = escapeLineStarts(renderInline(childNodes(node)))
    .replace(/\s*\n\s*/g, " ")
    .trim();

  return text === "" ? [] : [`${"#".repeat(level)} ${text}`];
}

function renderList(node: JsonRecord, depth: number, ordered: boolean): string[] {
  const items = childNodes(node);
  if (items.length === 0) return [];

  const start = ordered ? orderedStart(node) : 1;
  const indent = INDENT.repeat(depth);

  return items.flatMap((item, index) =>
    renderListItem(item, ordered ? `${start + index}. ` : "- ", indent, depth),
  );
}

function renderListItem(
  item: unknown,
  marker: string,
  indent: string,
  depth: number,
): string[] {
  const children = isRecord(item) ? childNodes(item) : [];
  const lines: string[] = [];
  // Wrapped text lines up under the item's text, not under its bullet.
  const continuation = indent + " ".repeat(marker.length);
  let markerUsed = false;

  const append = (rendered: string[]) => {
    if (rendered.length === 0) return;
    if (!markerUsed) {
      // An item whose paragraph is empty still needs its marker, but the
      // marker's own trailing space would be trailing whitespace on that line.
      lines.push(rendered[0] === "" ? (indent + marker).trimEnd() : indent + marker + rendered[0]);
      for (const line of rendered.slice(1)) lines.push(prefix(continuation, line));
      markerUsed = true;
      return;
    }
    for (const line of rendered) lines.push(prefix(continuation, line));
  };

  for (const child of children) {
    if (!isRecord(child)) {
      append(renderBlock(child, depth + 1));
      continue;
    }

    const type = child.type;

    if (type === "bulletList" || type === "orderedList") {
      // A nested list belongs to the item above it, so the marker line has to
      // exist first even when the item's own paragraph was empty.
      if (!markerUsed) {
        lines.push((indent + marker).trimEnd());
        markerUsed = true;
      }
      lines.push(...renderList(child, depth + 1, type === "orderedList"));
      continue;
    }

    append(renderBlock(child, depth + 1));
  }

  if (!markerUsed) lines.push((indent + marker).trimEnd());

  return lines;
}

/**
 * Inline content as one string. hardBreak becomes Markdown's line break — two
 * trailing spaces before the newline. Line-start escaping is applied by the
 * caller, once, on the finished string: doing it here would escape characters
 * that are only at the start of a nested fragment, not at the start of a line.
 */
function renderInline(nodes: unknown[]): string {
  let out = "";

  for (const node of nodes) {
    if (!isRecord(node)) continue;

    if (node.type === "hardBreak") {
      out += "  \n";
      continue;
    }

    if (node.type === "text") {
      out += renderText(node);
      continue;
    }

    const children = childNodes(node);
    if (children.length > 0) out += renderInline(children);
  }

  return out;
}

function renderText(node: JsonRecord): string {
  const text = typeof node.text === "string" ? node.text : "";
  if (text === "") return "";
  return applyMarks(text.replace(INLINE_ESCAPE, (char) => `\\${char}`), markNames(node));
}

function applyMarks(text: string, marks: Set<string>): string {
  const active = MARK_ORDER.filter((mark) => marks.has(mark));
  if (active.length === 0) return text;

  // `** bold **` is not emphasis in any Markdown parser: the delimiter has to
  // hug the text, so surrounding whitespace moves outside the wrapper.
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const trailing = /\s*$/.exec(text.slice(leading.length))?.[0] ?? "";
  const core = text.slice(leading.length, text.length - trailing.length);
  if (core === "") return text;

  let wrapped = core;
  for (const mark of active) {
    const [open, close] = MARK_WRAPPERS[mark];
    wrapped = `${open}${wrapped}${close}`;
  }

  return `${leading}${wrapped}${trailing}`;
}

/**
 * Characters that only mean something as the first thing on a line: a heading
 * `#`, a bullet `-`/`+`, a blockquote `>`, or an ordered-list `1.`. Escaping
 * them everywhere would litter ordinary prose with backslashes.
 */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([#+\->])/, "$1\\$2")
        .replace(/^(\s*)(\d{1,9})([.)])/, "$1$2\\$3"),
    )
    .join("\n");
}

function finalize(markdown: string): string {
  const cleaned = markdown
    // Whitespace-only lines count as blank, otherwise the collapse below misses them.
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");

  // Leading blanks come from empty paragraphs at the top of a document, which
  // carry no meaning in a file the way they do on a page.
  const trimmed = cleaned.replace(/^\n+/, "").replace(/\s+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

function toLines(text: string): string[] {
  return text.split("\n");
}

function prefix(indent: string, line: string): string {
  // Never indent a blank line — that would leave trailing whitespace behind.
  return line === "" ? "" : indent + line;
}

function headingLevel(node: JsonRecord): number {
  const level = isRecord(node.attrs) ? node.attrs.level : undefined;
  if (typeof level !== "number" || !Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, Math.trunc(level)));
}

function orderedStart(node: JsonRecord): number {
  const start = isRecord(node.attrs) ? node.attrs.start : undefined;
  if (typeof start !== "number" || !Number.isFinite(start)) return 1;
  return Math.max(0, Math.trunc(start));
}

function markNames(node: JsonRecord): Set<string> {
  const marks = node.marks;
  if (!Array.isArray(marks)) return new Set();

  const names = new Set<string>();
  for (const mark of marks) {
    if (isRecord(mark) && typeof mark.type === "string") names.add(mark.type);
  }
  return names;
}

function childNodes(node: JsonRecord): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

function isInlineNode(node: unknown): boolean {
  return isRecord(node) && (node.type === "text" || node.type === "hardBreak");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
