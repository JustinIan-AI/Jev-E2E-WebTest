export function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  if (blocks.length === 0 && text.trim().length > 0) {
    blocks.push(text.trim());
  }

  return blocks;
}

export function extractFirstCodeBlock(text: string): string {
  const blocks = extractCodeBlocks(text);
  return blocks[0] || text.trim();
}
