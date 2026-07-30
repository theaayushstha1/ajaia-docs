import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_BYTES,
  MAX_CONTENT_DEPTH,
  MAX_CONTENT_NODES,
  validateTipTapContent,
  type ContentValidationFailure,
} from './content-validation';

describe('validateTipTapContent', () => {
  it('accepts the rich-text subset emitted by the configured StarterKit', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Release ', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: 'notes',
              marks: [{ type: 'italic' }, { type: 'underline' }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line two' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Bullet' }],
                },
                {
                  type: 'orderedList',
                  attrs: { start: 3, type: 'a' },
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Nested item' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = validateTipTapContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.content).toBe(content);
    expect(result.nodeCount).toBe(16);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('accepts markup-like input only as literal text', () => {
    const scriptText = '<script>alert("not markup")</script>';
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: scriptText }],
        },
      ],
    };

    const result = validateTipTapContent(content);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const paragraph = result.content.content[0];
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: scriptText }],
    });
  });

  it('rejects an unknown block node', () => {
    const failure = expectFailure({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.test/x' } }],
    });

    expect(failure.status).toBe(400);
    expect(failure.code).toBe('INVALID_CONTENT');
  });

  it('rejects an unknown mark', () => {
    const failure = expectFailure({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'linked', marks: [{ type: 'link' }] }],
        },
      ],
    });

    expect(failure.status).toBe(400);
    expect(failure.message).toContain('Mark type');
  });

  it.each([0, 4, '2', null, undefined])('rejects malformed heading level %s', (level) => {
    const failure = expectFailure({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level } }],
    });

    expect(failure.status).toBe(400);
    expect(failure.message).toContain('Heading level');
  });

  it('rejects unknown or malformed attrs', () => {
    const paragraphFailure = expectFailure({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { class: 'admin' } }],
    });
    const orderedListFailure = expectFailure({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 0, type: 'decimal', extra: true },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ],
    });

    expect(paragraphFailure.status).toBe(400);
    expect(orderedListFailure.status).toBe(400);
  });

  it('rejects content deeper than the documented nesting limit', () => {
    let nested: unknown = { type: 'paragraph' };
    for (let index = 0; index < MAX_CONTENT_DEPTH; index += 1) {
      nested = {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph' }, nested],
          },
        ],
      };
    }

    const failure = expectFailure({ type: 'doc', content: [nested] });

    expect(failure.status).toBe(413);
    expect(failure.code).toBe('CONTENT_TOO_COMPLEX');
    expect(failure.message).toContain('nesting');
  });

  it('accepts exactly the node-count limit', () => {
    const result = validateTipTapContent({
      type: 'doc',
      content: Array.from({ length: MAX_CONTENT_NODES - 1 }, () => ({
        type: 'paragraph',
      })),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.nodeCount).toBe(MAX_CONTENT_NODES);
  });

  it('rejects content over the node-count limit', () => {
    const failure = expectFailure({
      type: 'doc',
      content: Array.from({ length: MAX_CONTENT_NODES }, () => ({
        type: 'paragraph',
      })),
    });

    expect(failure.status).toBe(413);
    expect(failure.code).toBe('CONTENT_TOO_COMPLEX');
    expect(failure.message).toContain('nodes');
  });

  it('rejects a serialized payload over 512 KiB', () => {
    const failure = expectFailure({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x'.repeat(MAX_CONTENT_BYTES) }],
        },
      ],
    });

    expect(failure.status).toBe(413);
    expect(failure.code).toBe('CONTENT_TOO_LARGE');
    expect(failure.message).toContain(`${MAX_CONTENT_BYTES}`);
  });

  it('rejects values that are not JSON serializable without throwing', () => {
    const cyclic: Record<string, unknown> = { type: 'doc', content: [] };
    cyclic.self = cyclic;

    const failure = expectFailure(cyclic);

    expect(failure.status).toBe(400);
    expect(failure.message).toContain('JSON-serializable');
  });

  it('rejects invalid document and list structure', () => {
    expect(expectFailure({ type: 'doc', content: [] }).status).toBe(400);
    expect(
      expectFailure({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'heading', attrs: { level: 1 } }],
              },
            ],
          },
        ],
      }).status,
    ).toBe(400);
  });
});

function expectFailure(value: unknown): ContentValidationFailure {
  const result = validateTipTapContent(value);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected validation to fail.');
  return result;
}
