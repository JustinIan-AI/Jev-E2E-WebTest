/**
 * Issue #3 回归 —— 真实 bin shim 子进程冒烟。
 *
 * 根因：package.json bin 指向 bin/idwth.js，但该 shim 仅动态 import
 * dist/cli/index.js 却从不调用 main()；同时 src/cli/index.ts 的入口守卫用
 * `file://${process.argv[1]}` 直接比较，经 shim 执行时 argv[1] 是 shim
 * 路径，与模块自身 URL 不相等。两者叠加导致经 shim 执行任何命令都零输出、
 * exit 0。
 *
 * 本测试不经过 tsx/源码入口，直接执行构建产物上的真实 shim，因此依赖
 * dist/ 已构建。为避免依赖调用方（CI / 开发机）先跑 build，beforeAll 发现
 * 产物缺失时先就地构建一次。
 */
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHIM = path.join(REPO_ROOT, 'bin/idwth.js');
const BUILT_ENTRY = path.join(REPO_ROOT, 'dist/cli/index.js');

beforeAll(async () => {
  try {
    await access(BUILT_ENTRY);
  } catch {
    // 产物缺失（如 CI 在 build 前先跑 test、或 fresh checkout 直跑 npm test）。
    await execFileP('npm', ['run', 'build'], { cwd: REPO_ROOT });
  }
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runShim(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [SHIM, ...args], {
      cwd: REPO_ROOT,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number | null; stdout?: string; stderr?: string };
    return {
      code: e.code ?? -1,
      stdout: (e.stdout ?? '') as string,
      stderr: (e.stderr ?? '') as string,
    };
  }
}

describe('idwth CLI 真实 bin shim（issue #3）', () => {
  it('无参调用输出 USAGE 帮助且 exit 0', async () => {
    const { code, stdout } = await runShim([]);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: idwth <command> [options]');
    expect(stdout).toContain('Commands:');
  });

  it('idwth --version 输出版本且 exit 0', async () => {
    const { code, stdout } = await runShim(['--version']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^idwth \d+\.\d+\.\d+\n$/);
  });

  it('未知命令写入 stderr 且 exit 3（CONFIG_ERROR）', async () => {
    const { code, stderr } = await runShim(['bogus-command']);
    expect(code).toBe(3);
    expect(stderr).toContain("未知命令 'bogus-command'");
  });
});
