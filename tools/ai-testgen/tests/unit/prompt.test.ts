import { describe, it, expect } from 'vitest';
import { extractCodeBlocks, extractFirstCodeBlock } from '../../src/utils/prompt';

describe('extractCodeBlocks', () => {
  it('should extract code blocks from markdown', () => {
    const text =
      'Here is some code:\n```typescript\nconst x = 1;\n```\nAnd more:\n```js\nlet y = 2;\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe('const x = 1;');
    expect(blocks[1]).toBe('let y = 2;');
  });

  it('should handle code blocks without language tag', () => {
    const text = '```\nhello world\n```';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe('hello world');
  });

  it('should return full text if no code blocks', () => {
    const text = 'just plain text';
    const blocks = extractCodeBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe('just plain text');
  });
});

describe('extractFirstCodeBlock', () => {
  it('should return first code block', () => {
    const text = '```ts\nfirst\n```\n```ts\nsecond\n```';
    expect(extractFirstCodeBlock(text)).toBe('first');
  });

  it('should return trimmed text if no blocks', () => {
    expect(extractFirstCodeBlock('  hello  ')).toBe('hello');
  });
});
