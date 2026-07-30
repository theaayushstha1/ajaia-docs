/**
 * The largest serialized TipTap document accepted by the API (512 KiB).
 *
 * This is deliberately separate from the smaller plain-text import cap: an
 * edited document contains JSON structure in addition to the user's text.
 */
export const MAX_CONTENT_BYTES = 512 * 1024;

/** Maximum number of nodes, including the root `doc` node. */
export const MAX_CONTENT_NODES = 10_000;

/** Maximum node depth, with the root `doc` counting as depth one. */
export const MAX_CONTENT_DEPTH = 32;

export type ContentMark = {
  type: "bold" | "italic" | "underline";
};

export type TextNode = {
  type: "text";
  text: string;
  marks?: ContentMark[];
};

export type HardBreakNode = {
  type: "hardBreak";
  marks?: ContentMark[];
};

export type InlineNode = TextNode | HardBreakNode;

export type ParagraphNode = {
  type: "paragraph";
  content?: InlineNode[];
};

export type HeadingNode = {
  type: "heading";
  attrs: { level: 1 | 2 | 3 };
  content?: InlineNode[];
};

export type BulletListNode = {
  type: "bulletList";
  content: ListItemNode[];
};

export type OrderedListNode = {
  type: "orderedList";
  attrs?: {
    start?: number;
    type?: "1" | "a" | "A" | "i" | "I" | null;
  };
  content: ListItemNode[];
};

export type ListItemNode = {
  type: "listItem";
  content: [ParagraphNode, ...BlockNode[]];
};

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode;

export type TipTapContentDocument = {
  type: "doc";
  content: BlockNode[];
};

export type ContentValidationFailure = {
  ok: false;
  status: 400 | 413;
  code: "INVALID_CONTENT" | "CONTENT_TOO_LARGE" | "CONTENT_TOO_COMPLEX";
  message: string;
};

export type ContentValidationResult =
  | {
      ok: true;
      content: TipTapContentDocument;
      byteLength: number;
      nodeCount: number;
    }
  | ContentValidationFailure;

type JsonRecord = Record<string, unknown>;

type ValidationContext = {
  nodeCount: number;
};

type InspectedNode = {
  ok: true;
  node: JsonRecord;
  type: string;
};

const MARK_TYPES = new Set(["bold", "italic", "underline"]);
const ORDERED_LIST_TYPES = new Set(["1", "a", "A", "i", "I"]);

/**
 * Validate untrusted request data as the small TipTap/StarterKit subset used by
 * this application. The function has no framework or editor dependency and is
 * safe to call before passing content to the DAL.
 *
 * `400` means the value is not a permitted TipTap document. `413` means the
 * value crossed a byte or structural-complexity limit.
 */
export function validateTipTapContent(value: unknown): ContentValidationResult {
  const serialized = serializeForMeasurement(value);
  if (!serialized.ok) return serialized;

  if (serialized.byteLength > MAX_CONTENT_BYTES) {
    return tooLarge(
      `Document content exceeds the ${MAX_CONTENT_BYTES}-byte limit.`,
    );
  }

  const context: ValidationContext = { nodeCount: 0 };
  const failure = validateDocument(value, context);
  if (failure) return failure;

  return {
    ok: true,
    content: value as TipTapContentDocument,
    byteLength: serialized.byteLength,
    nodeCount: context.nodeCount,
  };
}

function serializeForMeasurement(
  value: unknown,
): { ok: true; byteLength: number } | ContentValidationFailure {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      return invalid("Content must be a JSON object.");
    }

    return {
      ok: true,
      byteLength: new TextEncoder().encode(serialized).byteLength,
    };
  } catch {
    return invalid("Content must be JSON-serializable.");
  }
}

function validateDocument(
  value: unknown,
  context: ValidationContext,
): ContentValidationFailure | null {
  const inspected = inspectNode(value, "$", 1, context);
  if (!inspected.ok) return inspected;
  const { node, type } = inspected;

  if (type !== "doc") return invalid('Root node type must be "doc".', "$.type");
  if (!hasOnlyKeys(node, ["type", "content"])) {
    return invalid("Document contains an unsupported property.", "$");
  }

  const content = node.content;
  if (!Array.isArray(content) || content.length === 0) {
    return invalid("Document content must be a non-empty array.", "$.content");
  }

  for (let index = 0; index < content.length; index += 1) {
    const failure = validateBlock(
      content[index],
      `$.content[${index}]`,
      2,
      context,
    );
    if (failure) return failure;
  }

  return null;
}

function validateBlock(
  value: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
): ContentValidationFailure | null {
  const inspected = inspectNode(value, path, depth, context);
  if (!inspected.ok) return inspected;

  switch (inspected.type) {
    case "paragraph":
      return validateParagraph(inspected.node, path, depth, context);
    case "heading":
      return validateHeading(inspected.node, path, depth, context);
    case "bulletList":
      return validateList(inspected.node, path, depth, context, false);
    case "orderedList":
      return validateList(inspected.node, path, depth, context, true);
    default:
      return invalid(
        `Node type "${inspected.type}" is not allowed in block content.`,
        `${path}.type`,
      );
  }
}

function validateParagraph(
  node: JsonRecord,
  path: string,
  depth: number,
  context: ValidationContext,
): ContentValidationFailure | null {
  if (!hasOnlyKeys(node, ["type", "content"])) {
    return invalid("Paragraph contains an unsupported property.", path);
  }

  return validateInlineContent(node.content, path, depth, context);
}

function validateHeading(
  node: JsonRecord,
  path: string,
  depth: number,
  context: ValidationContext,
): ContentValidationFailure | null {
  if (!hasOnlyKeys(node, ["type", "attrs", "content"])) {
    return invalid("Heading contains an unsupported property.", path);
  }

  if (!isPlainRecord(node.attrs) || !hasOnlyKeys(node.attrs, ["level"])) {
    return invalid("Heading attrs must contain only level.", `${path}.attrs`);
  }

  if (
    node.attrs.level !== 1 &&
    node.attrs.level !== 2 &&
    node.attrs.level !== 3
  ) {
    return invalid("Heading level must be 1, 2, or 3.", `${path}.attrs.level`);
  }

  return validateInlineContent(node.content, path, depth, context);
}

function validateInlineContent(
  content: unknown,
  parentPath: string,
  parentDepth: number,
  context: ValidationContext,
): ContentValidationFailure | null {
  if (content === undefined) return null;
  if (!Array.isArray(content)) {
    return invalid("Inline content must be an array.", `${parentPath}.content`);
  }

  for (let index = 0; index < content.length; index += 1) {
    const path = `${parentPath}.content[${index}]`;
    const inspected = inspectNode(
      content[index],
      path,
      parentDepth + 1,
      context,
    );
    if (!inspected.ok) return inspected;

    if (inspected.type === "text") {
      const failure = validateText(inspected.node, path);
      if (failure) return failure;
      continue;
    }

    if (inspected.type === "hardBreak") {
      const failure = validateHardBreak(inspected.node, path);
      if (failure) return failure;
      continue;
    }

    return invalid(
      `Node type "${inspected.type}" is not allowed in inline content.`,
      `${path}.type`,
    );
  }

  return null;
}

function validateText(
  node: JsonRecord,
  path: string,
): ContentValidationFailure | null {
  if (!hasOnlyKeys(node, ["type", "text", "marks"])) {
    return invalid("Text node contains an unsupported property.", path);
  }
  if (typeof node.text !== "string" || node.text.length === 0) {
    return invalid("Text node text must be a non-empty string.", `${path}.text`);
  }

  return validateMarks(node.marks, path);
}

function validateHardBreak(
  node: JsonRecord,
  path: string,
): ContentValidationFailure | null {
  if (!hasOnlyKeys(node, ["type", "marks"])) {
    return invalid("Hard break contains an unsupported property.", path);
  }

  return validateMarks(node.marks, path);
}

function validateMarks(
  marks: unknown,
  nodePath: string,
): ContentValidationFailure | null {
  if (marks === undefined) return null;
  if (!Array.isArray(marks)) {
    return invalid("Marks must be an array.", `${nodePath}.marks`);
  }

  const seen = new Set<string>();
  for (let index = 0; index < marks.length; index += 1) {
    const markPath = `${nodePath}.marks[${index}]`;
    const mark = marks[index];
    if (!isPlainRecord(mark) || !hasOnlyKeys(mark, ["type"])) {
      return invalid("Mark contains an unsupported property.", markPath);
    }
    if (typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) {
      return invalid("Mark type is not allowed.", `${markPath}.type`);
    }
    if (seen.has(mark.type)) {
      return invalid("Duplicate marks are not allowed.", markPath);
    }
    seen.add(mark.type);
  }

  return null;
}

function validateList(
  node: JsonRecord,
  path: string,
  depth: number,
  context: ValidationContext,
  ordered: boolean,
): ContentValidationFailure | null {
  const allowedKeys = ordered ? ["type", "attrs", "content"] : ["type", "content"];
  if (!hasOnlyKeys(node, allowedKeys)) {
    return invalid("List contains an unsupported property.", path);
  }

  if (ordered) {
    const attrsFailure = validateOrderedListAttrs(node.attrs, path);
    if (attrsFailure) return attrsFailure;
  }

  if (!Array.isArray(node.content) || node.content.length === 0) {
    return invalid("List content must contain at least one list item.", `${path}.content`);
  }

  for (let index = 0; index < node.content.length; index += 1) {
    const failure = validateListItem(
      node.content[index],
      `${path}.content[${index}]`,
      depth + 1,
      context,
    );
    if (failure) return failure;
  }

  return null;
}

function validateOrderedListAttrs(
  attrs: unknown,
  path: string,
): ContentValidationFailure | null {
  if (attrs === undefined) return null;
  if (!isPlainRecord(attrs) || !hasOnlyKeys(attrs, ["start", "type"])) {
    return invalid(
      "Ordered-list attrs may contain only start and type.",
      `${path}.attrs`,
    );
  }

  if (
    attrs.start !== undefined &&
    (typeof attrs.start !== "number" ||
      !Number.isSafeInteger(attrs.start) ||
      attrs.start < 1 ||
      attrs.start > 1_000_000)
  ) {
    return invalid(
      "Ordered-list start must be an integer from 1 to 1000000.",
      `${path}.attrs.start`,
    );
  }

  if (
    attrs.type !== undefined &&
    attrs.type !== null &&
    (typeof attrs.type !== "string" || !ORDERED_LIST_TYPES.has(attrs.type))
  ) {
    return invalid(
      "Ordered-list type must be 1, a, A, i, I, or null.",
      `${path}.attrs.type`,
    );
  }

  return null;
}

function validateListItem(
  value: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
): ContentValidationFailure | null {
  const inspected = inspectNode(value, path, depth, context);
  if (!inspected.ok) return inspected;
  if (inspected.type !== "listItem") {
    return invalid('List content may contain only "listItem" nodes.', `${path}.type`);
  }

  const node = inspected.node;
  if (!hasOnlyKeys(node, ["type", "content"])) {
    return invalid("List item contains an unsupported property.", path);
  }
  if (!Array.isArray(node.content) || node.content.length === 0) {
    return invalid(
      "List item content must start with a paragraph.",
      `${path}.content`,
    );
  }

  const first = node.content[0];
  if (!isPlainRecord(first) || first.type !== "paragraph") {
    return invalid(
      "List item content must start with a paragraph.",
      `${path}.content[0]`,
    );
  }

  for (let index = 0; index < node.content.length; index += 1) {
    const failure = validateBlock(
      node.content[index],
      `${path}.content[${index}]`,
      depth + 1,
      context,
    );
    if (failure) return failure;
  }

  return null;
}

function inspectNode(
  value: unknown,
  path: string,
  depth: number,
  context: ValidationContext,
): InspectedNode | ContentValidationFailure {
  if (depth > MAX_CONTENT_DEPTH) {
    return tooComplex(
      `Document nesting exceeds the ${MAX_CONTENT_DEPTH}-level limit.`,
    );
  }

  context.nodeCount += 1;
  if (context.nodeCount > MAX_CONTENT_NODES) {
    return tooComplex(
      `Document contains more than ${MAX_CONTENT_NODES} nodes.`,
    );
  }

  if (!isPlainRecord(value)) return invalid("Node must be an object.", path);
  if (typeof value.type !== "string" || value.type.length === 0) {
    return invalid("Node type must be a non-empty string.", `${path}.type`);
  }

  return { ok: true, node: value, type: value.type };
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(node: JsonRecord, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(node).every((key) => allowedSet.has(key));
}

function invalid(message: string, path?: string): ContentValidationFailure {
  return {
    ok: false,
    status: 400,
    code: "INVALID_CONTENT",
    message: path ? `${message} (${path})` : message,
  };
}

function tooLarge(message: string): ContentValidationFailure {
  return {
    ok: false,
    status: 413,
    code: "CONTENT_TOO_LARGE",
    message,
  };
}

function tooComplex(message: string): ContentValidationFailure {
  return {
    ok: false,
    status: 413,
    code: "CONTENT_TOO_COMPLEX",
    message,
  };
}
