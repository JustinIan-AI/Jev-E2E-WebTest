import * as path from 'path';

const MAX_SLUG_LENGTH = 40;

export function slugify(input: string): string {
  const normalized = input.normalize('NFKC').toLowerCase();
  const collapsed = normalized.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  const truncated = Array.from(collapsed).slice(0, MAX_SLUG_LENGTH).join('');
  return truncated.replace(/-+$/g, '');
}

export function safeSlug(title: string, sourceFilePath?: string, now: Date = new Date()): string {
  const fromTitle = slugify(title);
  if (fromTitle) return fromTitle;

  if (sourceFilePath) {
    const fromFile = slugify(path.parse(sourceFilePath).name);
    if (fromFile) return fromFile;
  }

  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return slugify(`untitled-${stamp}`);
}
