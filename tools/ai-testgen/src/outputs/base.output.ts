import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../core/types';
import { logger } from '../utils/logger';

export abstract class BaseOutput {
  abstract format: string;
  abstract extension: string;

  write(files: GeneratedFile[], outputDir: string): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const file of files) {
      const fullPath = path.join(outputDir, file.path);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, file.content, 'utf-8');
      logger.info(`Written: ${fullPath}`);
    }
  }

  createFile(name: string, content: string): GeneratedFile {
    return { path: `${name}${this.extension}`, content };
  }
}
