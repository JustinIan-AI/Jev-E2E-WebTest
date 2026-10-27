/**
 * Task 18 / TR-18.3 / AC-18 —— 最终合规审计。
 *
 * 审计型测试：直接断言当前仓库状态——
 *  - 文件布局：单体 src/ + tests/，无 backend//frontend/，测试只放 tests/；
 *  - 无 server/daemon 入口：src 无 createServer/.listen(；
 *  - 依赖合规：无服务端/GUI 框架依赖，全部依赖许可证可识别且在允许集；
 *  - 无遥测：src 无遥测/埋点 SDK；
 *  - 脱敏：src/ 与构建产物无明文凭据模式；
 *  - 任务流转：tasks.md 早期任务全部 completed【✅】。
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFilesForSecrets } from '../../src/runtime/redaction.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const SECRET_PATTERNS = [
  'sk-ant-api03-',
  'sk-proj-',
  'ghp_AbCdEf',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
  'AKIAIOSFODNN7',
  'xoxb-',
  'xoxp-',
  'password: hunter2',
];

const FORBIDDEN_DEPS = [
  'express', 'koa', 'fastify', 'hapi', '@nestjs/core', 'electron', 'tauri',
  'next', 'react', 'vue', '@angular/core', 'svelte',
];

const ALLOWED_LICENSES = [
  'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'BlueOak-1.0.0', 'Unlicense', 'CC0-1.0', '(MIT OR Apache-2.0)',
];

async function listSrcTsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(join(entry.parentPath ?? dir, entry.name));
    }
  }
  return out;
}

interface PkgJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('TR-18.3：文件布局审计（单体 src/ + tests/）', () => {
  it('根目录无 backend/ frontend/ 分层目录', () => {
    expect(existsSync(join(REPO_ROOT, 'backend'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, 'frontend'))).toBe(false);
  });

  it('src/ 与 tests/ 存在；src 内无 *.test.* 测试文件', async () => {
    expect(existsSync(join(REPO_ROOT, 'src'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'tests'))).toBe(true);
    const srcFiles = await listSrcTsFiles(join(REPO_ROOT, 'src'));
    const testFiles = srcFiles.filter((f) => /\.test\.ts$/.test(f));
    expect(testFiles).toEqual([]);
  });
});

describe('TR-18.3：无 server / daemon 入口', () => {
  it('src 全部 TS 文件无 createServer / .listen( 调用', async () => {
    const srcFiles = await listSrcTsFiles(join(REPO_ROOT, 'src'));
    expect(srcFiles.length).toBeGreaterThan(0);
    for (const file of srcFiles) {
      const text = await readFile(file, 'utf8');
      expect(text).not.toMatch(/createServer\s*\(/);
      expect(text).not.toMatch(/\.listen\s*\(/);
    }
  });
});

describe('TR-18.3：依赖与许可证审计', () => {
  it('无服务端 / GUI 框架依赖', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as PkgJson;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const hits = Object.keys(all).filter((k) => FORBIDDEN_DEPS.includes(k));
    expect(hits).toEqual([]);
  });

  it('全部直接依赖的许可证可识别且在允许集内', async () => {
    const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as PkgJson;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const names = Object.keys(all);
    expect(names.length).toBeGreaterThan(0);

    const report: Array<{ pkg: string; license: string }> = [];
    for (const name of names) {
      const metaPath = join(REPO_ROOT, 'node_modules', name, 'package.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { license?: unknown };
      const license = typeof meta.license === 'string' ? meta.license : undefined;
      expect(license, `${name} 缺少许可证字段`).toBeDefined();
      expect(ALLOWED_LICENSES, `${name} 许可证 ${license} 不在允许集`).toContain(license);
      report.push({ pkg: name, license: license! });
    }
    // 许可证清单即审计证据（写入测试输出）。
    process.stdout.write(
      `license audit: ${report.map((r) => `${r.pkg}@${r.license}`).join(', ')}\n`,
    );
  });
});

describe('TR-18.3：无遥测与脱敏审计', () => {
  it('src 无遥测 / 埋点 SDK 引用', async () => {
    const srcFiles = await listSrcTsFiles(join(REPO_ROOT, 'src'));
    for (const file of srcFiles) {
      const text = await readFile(file, 'utf8');
      expect(text).not.toMatch(/telemetry|posthog|mixpanel|\bgtag\b|amplitude/i);
    }
  });

  it('src/ 无明文凭据模式', async () => {
    expect(await scanFilesForSecrets(join(REPO_ROOT, 'src'), SECRET_PATTERNS)).toEqual([]);
  });

  it('构建产物（存在时）无明文凭据模式', async () => {
    const dist = join(REPO_ROOT, 'dist');
    if (!existsSync(dist)) return; // CI 中 build 先行；本地允许缺省
    expect(await scanFilesForSecrets(dist, SECRET_PATTERNS)).toEqual([]);
  });
});

describe('TR-18.3：任务流转审计', () => {
  it('tasks.md 中 Task 1~19 均为 completed【✅】', async () => {
    const tasksPath = join(REPO_ROOT, '.trae', 'specs', 'idwth-v1-development-baseline', 'tasks.md');
    if (!existsSync(tasksPath)) return; // 开发过程文件本地保留、不上传 GitHub；CI 中允许缺省
    const tasksMd = await readFile(tasksPath, 'utf8');
    for (let n = 1; n <= 19; n += 1) {
      const section = tasksMd.split(`## Task ${n}:`)[1]?.split('## Task')[0] ?? '';
      // 实质口径：Status 行为 completed（【✅】后缀为可选格式差异，Task 6/7 在标题行）。
      expect(section, `Task ${n} 未标记 completed`).toMatch(/\*\*Status\*\*:\s*`completed/);
    }
  });
});
