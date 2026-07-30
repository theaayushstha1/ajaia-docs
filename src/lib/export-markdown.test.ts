import { describe, expect, it } from "vitest";

import { markdownFilename, tipTapToMarkdown } from "@/lib/export-markdown";

/** Test-local builders, so each case reads as the document it describes. */
type Mark = { type: string };
type Node = Record<string, unknown>;

const doc = (...content: Node[]): Node => ({ type: "doc", content });
const text = (value: string, ...marks: string[]): Node =>
  marks.length === 0
    ? { type: "text", text: value }
    : { type: "text", text: value, marks: marks.map((type): Mark => ({ type })) };
const para = (...content: Node[]): Node => ({ type: "paragraph", content });
const line = (value: string): Node => para(text(value));
const heading = (level: number, value: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const item = (...content: Node[]): Node => ({ type: "listItem", content });
const bullets = (...content: Node[]): Node => ({ type: "bulletList", content });
const ordered = (attrs: Node | null, ...content: Node[]): Node =>
  attrs === null
    ? { type: "orderedList", content }
    : { type: "orderedList", attrs, content };
const hardBreak: Node = { type: "hardBreak" };

describe("tipTapToMarkdown — blocks", () => {
  it("renders a heading as one # per level", () => {
    expect(tipTapToMarkdown(doc(heading(1, "One")))).toBe("# One\n");
    expect(tipTapToMarkdown(doc(heading(2, "Two")))).toBe("## Two\n");
    expect(tipTapToMarkdown(doc(heading(3, "Three")))).toBe("### Three\n");
  });

  it("separates blocks with a blank line", () => {
    expect(tipTapToMarkdown(doc(heading(1, "Title"), line("Body"), line("More")))).toBe(
      "# Title\n\nBody\n\nMore\n",
    );
  });

  it("turns a hard break into two trailing spaces and a newline", () => {
    expect(tipTapToMarkdown(doc(para(text("first"), hardBreak, text("second"))))).toBe(
      "first  \nsecond\n",
    );
  });

  it("flattens a hard break inside a heading to a space", () => {
    const node = { type: "heading", attrs: { level: 2 }, content: [text("Q3"), hardBreak, text("plan")] };

    expect(tipTapToMarkdown(doc(node))).toBe("## Q3 plan\n");
  });

  it("collapses runs of blank lines and ends with exactly one newline", () => {
    const result = tipTapToMarkdown(
      doc(line("a"), para(), para(), para(), line("b")),
    );

    expect(result).toBe("a\n\nb\n");
    expect(result.endsWith("\n\n")).toBe(false);
  });

  it("does not open the file with blank lines from a leading empty paragraph", () => {
    expect(tipTapToMarkdown(doc(para(), para(), line("a")))).toBe("a\n");
  });

  it("leaves no trailing whitespace when the document ends with a hard break", () => {
    const result = tipTapToMarkdown(doc(para(text("done"), hardBreak)));

    expect(result).toBe("done\n");
  });
});

describe("tipTapToMarkdown — lists", () => {
  it("renders a bullet list with - markers", () => {
    expect(tipTapToMarkdown(doc(bullets(item(line("One")), item(line("Two")))))).toBe(
      "- One\n- Two\n",
    );
  });

  it("numbers an ordered list from 1 by default", () => {
    expect(tipTapToMarkdown(doc(ordered(null, item(line("One")), item(line("Two")))))).toBe(
      "1. One\n2. Two\n",
    );
  });

  it("honours attrs.start on an ordered list", () => {
    expect(
      tipTapToMarkdown(doc(ordered({ start: 3 }, item(line("Three")), item(line("Four"))))),
    ).toBe("3. Three\n4. Four\n");
  });

  it("indents a nested list by two spaces per level", () => {
    const nested = doc(
      bullets(
        item(line("Parent"), bullets(item(line("Child"), bullets(item(line("Grandchild")))))),
        item(line("Sibling")),
      ),
    );

    expect(tipTapToMarkdown(nested)).toBe(
      ["- Parent", "  - Child", "    - Grandchild", "- Sibling", ""].join("\n"),
    );
  });

  it("indents an ordered list nested inside a bullet list", () => {
    const nested = doc(
      bullets(item(line("Steps"), ordered({ start: 2 }, item(line("Second")), item(line("Third"))))),
    );

    expect(tipTapToMarkdown(nested)).toBe(["- Steps", "  2. Second", "  3. Third", ""].join("\n"));
  });

  it("aligns a wrapped item line under the item text, not under the marker", () => {
    const wrapped = doc(
      ordered(null, item(para(text("one"), hardBreak, text("still one")))),
      bullets(item(para(text("a"), hardBreak, text("still a")))),
    );

    expect(tipTapToMarkdown(wrapped)).toBe(
      ["1. one  ", "   still one", "", "- a  ", "  still a", ""].join("\n"),
    );
  });

  it("keeps the marker for an empty list item without leaving trailing whitespace", () => {
    expect(tipTapToMarkdown(doc(bullets(item(para()), item(line("Two")))))).toBe("-\n- Two\n");
  });
});

describe("tipTapToMarkdown — marks", () => {
  it("wraps bold in ** and italic in *", () => {
    expect(tipTapToMarkdown(doc(para(text("Bold", "bold"))))).toBe("**Bold**\n");
    expect(tipTapToMarkdown(doc(para(text("Italic", "italic"))))).toBe("*Italic*\n");
  });

  it("composes bold and italic on one text node", () => {
    expect(tipTapToMarkdown(doc(para(text("Both", "bold", "italic"))))).toBe("***Both***\n");
    expect(tipTapToMarkdown(doc(para(text("Both", "italic", "bold"))))).toBe("***Both***\n");
  });

  it("exports underline as <u> because Markdown has no underline", () => {
    expect(tipTapToMarkdown(doc(para(text("Under", "underline"))))).toBe("<u>Under</u>\n");
  });

  it("puts the <u> tag outside the emphasis delimiters", () => {
    expect(tipTapToMarkdown(doc(para(text("All", "bold", "italic", "underline"))))).toBe(
      "<u>***All***</u>\n",
    );
  });

  it("moves surrounding whitespace outside the delimiters so emphasis still renders", () => {
    expect(tipTapToMarkdown(doc(para(text("plain "), text("bold ", "bold"), text("tail"))))).toBe(
      "plain **bold** tail\n",
    );
  });

  it("leaves a whitespace-only text node unwrapped", () => {
    expect(tipTapToMarkdown(doc(para(text("a"), text(" ", "bold"), text("b"))))).toBe("a b\n");
  });

  it("ignores mark types it does not know", () => {
    const node = { type: "text", text: "x", marks: [{ type: "highlight" }] };

    expect(tipTapToMarkdown(doc(para(node)))).toBe("x\n");
  });
});

describe("tipTapToMarkdown — escaping", () => {
  it("escapes a literal * so it does not become emphasis", () => {
    expect(tipTapToMarkdown(doc(line("*not emphasis*")))).toBe("\\*not emphasis\\*\n");
  });

  it("escapes the other inline Markdown characters", () => {
    expect(tipTapToMarkdown(doc(line("a_b `c` [d] e\\f")))).toBe("a\\_b \\`c\\` \\[d\\] e\\\\f\n");
  });

  it("escapes a literal <u> so it cannot be mistaken for the underline escape hatch", () => {
    // `\<` is enough: with the opening angle bracket escaped the tag never
    // starts, so the closing `>` needs no escape of its own.
    expect(tipTapToMarkdown(doc(line("<u>typed by hand</u>")))).toBe(
      "\\<u>typed by hand\\</u>\n",
    );
  });

  it("escapes block markers only at the start of a line", () => {
    expect(tipTapToMarkdown(doc(line("# not a heading")))).toBe("\\# not a heading\n");
    expect(tipTapToMarkdown(doc(line("- not a bullet")))).toBe("\\- not a bullet\n");
    expect(tipTapToMarkdown(doc(line("+ not a bullet")))).toBe("\\+ not a bullet\n");
    expect(tipTapToMarkdown(doc(line("> not a quote")))).toBe("\\> not a quote\n");
    expect(tipTapToMarkdown(doc(line("1. not a list")))).toBe("1\\. not a list\n");
    expect(tipTapToMarkdown(doc(line("2) not a list")))).toBe("2\\) not a list\n");
    expect(tipTapToMarkdown(doc(line("issue #42 and a - dash")))).toBe(
      "issue #42 and a - dash\n",
    );
  });

  it("escapes the line after a hard break as its own line", () => {
    expect(tipTapToMarkdown(doc(para(text("intro"), hardBreak, text("# also not a heading"))))).toBe(
      "intro  \n\\# also not a heading\n",
    );
  });

  it("does not escape the markers it emits itself", () => {
    expect(tipTapToMarkdown(doc(bullets(item(line("- literal dash")))))).toBe(
      "- \\- literal dash\n",
    );
  });
});

describe("tipTapToMarkdown — malformed input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "# hello"],
    ["a number", 42],
    ["an array", [{ type: "paragraph" }]],
    ["a doc with no content", { type: "doc" }],
    ["a doc with empty content", { type: "doc", content: [] }],
    ["a doc with non-array content", { type: "doc", content: "text" }],
    ["the blank editor document", { type: "doc", content: [{ type: "paragraph" }] }],
    ["a node that is not a doc", { type: "paragraph", content: [{ type: "text", text: "x" }] }],
  ])("returns an empty string for %s", (_label, input) => {
    expect(tipTapToMarkdown(input)).toBe("");
  });

  it("does not throw on nulls and non-objects inside content", () => {
    const messy = { type: "doc", content: [null, 7, "x", { type: "paragraph", content: [null, 3] }, line("real")] };

    expect(() => tipTapToMarkdown(messy)).not.toThrow();
    expect(tipTapToMarkdown(messy)).toBe("real\n");
  });

  it("skips an unknown node type but keeps the rest of the document", () => {
    const unknown = doc(line("before"), { type: "image", attrs: { src: "x.png" } }, line("after"));

    expect(tipTapToMarkdown(unknown)).toBe("before\n\nafter\n");
  });

  it("keeps the text inside an unknown wrapper node", () => {
    const legacy = doc({ type: "blockquote", content: [line("quoted")] }, line("after"));

    expect(tipTapToMarkdown(legacy)).toBe("quoted\n\nafter\n");
  });

  it("tolerates a heading with a missing or out-of-range level", () => {
    expect(tipTapToMarkdown(doc({ type: "heading", content: [text("No attrs")] }))).toBe(
      "# No attrs\n",
    );
    expect(
      tipTapToMarkdown(doc({ type: "heading", attrs: { level: 99 }, content: [text("Clamped")] })),
    ).toBe("###### Clamped\n");
  });

  it("ignores a non-numeric ordered-list start", () => {
    expect(tipTapToMarkdown(doc(ordered({ start: "3" }, item(line("One")))))).toBe("1. One\n");
  });
});

describe("markdownFilename", () => {
  it("slugifies a normal title", () => {
    expect(markdownFilename("Q3 Product Planning")).toBe("q3-product-planning.md");
  });

  it("collapses punctuation and runs of separators into single hyphens", () => {
    expect(markdownFilename("  Hello -- World!!  ")).toBe("hello-world.md");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(markdownFilename("Café Naïve Report")).toBe("cafe-naive-report.md");
  });

  it("falls back to document.md when nothing sluggable survives", () => {
    expect(markdownFilename("???")).toBe("document.md");
    expect(markdownFilename("")).toBe("document.md");
    expect(markdownFilename("   ")).toBe("document.md");
    expect(markdownFilename("日本語")).toBe("document.md");
  });

  it("caps the slug and never ends it with a hyphen", () => {
    const long = markdownFilename("word ".repeat(30));

    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-.md")).toBe(false);
    expect(long).toBe("word-word-word-word-word-word-word-word-word-word-word-word.md");
  });

  it("produces a name safe to place in a Content-Disposition header", () => {
    expect(markdownFilename('ev"il\r\n; name=x')).toBe("ev-il-name-x.md");
    expect(markdownFilename("../../etc/passwd")).toBe("etc-passwd.md");
  });
});
