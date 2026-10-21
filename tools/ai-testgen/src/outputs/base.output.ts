import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile, WrittenFile } from '../core/types';
import { logger } from '../utils/logger';

export abstract class BaseOutput {
  abstract format: string;
  abstract extension: string;

  write(files: GeneratedFile[], outputDir: string): WrittenFile[] {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const written: WrittenFile[] = [];

    for (const file of files) {
      const finalPath = this.resolveNonConflictingPath(file.path, outputDir);
      const fullPath = path.join(outputDir, finalPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, file.content, 'utf-8');
      logger.info(`Written: ${fullPath}`);
      written.push({ ...file, path: finalPath, writtenPath: finalPath });
    }

    return written;
  }

  createFile(name: string, content: string): GeneratedFile {
    return { path: `${name}${this.extension}`, content };
  }

  private resolveNonConflictingPath(relativePath: string, outputDir: string): string {
    if (!fs.existsSync(path.join(outputDir, relativePath))) {
      return relativePath;
    }

    const dir = path.dirname(relativePath);
    const match = path.basename(relativePath).match(/^(.*?)(\.spec\.ts|\.[^.]+)$/);
    const base = match ? match[1] : path.basename(relativePath);
    const suffix = match ? match[2] : '';
    let counter = 2;
    let candidate: string;
    do {
      candidate = path.join(dir, `${base}-${counter}${suffix}`);
      counter++;
    } while (fs.existsSync(path.join(outputDir, candidate)));
    return candidate;
  }
}
