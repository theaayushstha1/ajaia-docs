import { describe, expect, it } from "vitest";

import {
  EMPTY_DOC,
  MAX_IMPORT_BYTES,
  textToTipTapDoc,
  titleFromFilename,
} from "@/lib/import-text";

describe("textToTipTapDoc", () => {
  it.each(["", "   \n\t  "])("returns a fresh empty document for blank input", (input) => {
    const result = textToTipTapDoc(input);

    expect(result).toEqual(EMPTY_DOC);
    expect(result).not.toBe(EMPTY_DOC);
  });

  it("strips a UTF-8 BOM and normalizes CRLF line endings", () => {
    expect(textToTipTapDoc("\uFEFFFirst\r\nSecond")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First" },
            { type: "hardBreak" },
            { type: "text", text: "Second" },
          ],
        },
      ],
    });
  });

  it("preserves single line breaks as hard breaks and blank lines as paragraphs", () => {
    expect(textToTipTapDoc("Line one\nLine two\n\nNext paragraph")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Line one" },
            { type: "hardBreak" },
            { type: "text", text: "Line two" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Next paragraph" }],
        },
      ],
    });
  });

  it("keeps markup-like input as one exact literal text node", () => {
    const script = "<script>alert('x')</script>";

    expect(textToTipTapDoc(script)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: script }],
        },
      ],
    });
  });
});

describe("titleFromFilename", () => {
  it.each([
    ["review-notes.txt", "review notes"],
    ["C:\\fakepath\\Q3_planning-notes.txt", "Q3 planning notes"],
    ["/tmp/archive.notes.txt", "archive.notes"],
    [".txt", "Untitled document"],
  ])("cleans %s into %s", (filename, expected) => {
    expect(titleFromFilename(filename)).toBe(expected);
  });
});

describe("MAX_IMPORT_BYTES", () => {
  it("defines an inclusive 256 KiB boundary", () => {
    expect(MAX_IMPORT_BYTES).toBe(256 * 1024);
    expect(Buffer.alloc(MAX_IMPORT_BYTES).byteLength).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
    expect(Buffer.alloc(MAX_IMPORT_BYTES + 1).byteLength).toBeGreaterThan(MAX_IMPORT_BYTES);
  });
});
