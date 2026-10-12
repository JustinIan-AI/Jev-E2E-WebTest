import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

export interface CdpChrome {
  cdpEndpoint: string;
  userDataDir: string;
  process: ChildProcess;
  /** 只断连：不杀用户浏览器语义下的「用户 Chrome」。 */
  dispose: () => Promise<void>;
  /** 测试结束时真正杀掉进程（由测试自身负责，不由 Provider 负责）。 */
  kill: () => Promise<void>;
  /** CDP 端点是否仍可连接（HTTP /json/version）。 */
  endpointAlive: () => Promise<boolean>;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('failed to acquire free port'));
      }
    });
  });
}

function waitForCdp(endpoint: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${endpoint}/json/version`);
        if (res.ok) return resolve();
      } catch {
        // not ready
      }
      if (Date.now() > deadline) return reject(new Error(`CDP endpoint not ready: ${endpoint}`));
      setTimeout(attempt, 100);
    };
    void attempt();
  });
}

/**
 * 以「用户自己启动的 Chrome」方式拉起完整 Chromium：
 *   --remote-debugging-port + 独立 user-data-dir + 一个普通前台标签页。
 * Provider 必须能 attach 到它，且 dispose 时不能杀死它。
 */
export async function launchCdpChrome(): Promise<CdpChrome> {
  const port = await getFreePort();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'idwth-cdp-'));
  const executablePath = chromium.executablePath();
  const cdpEndpoint = `http://127.0.0.1:${port}`;

  const child = spawn(
    executablePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      '--disable-gpu',
      // CI（Ubuntu 24.04）AppArmor 限制 unprivileged userns，Chrome 沙箱
      // 初始化会直接退出；测试 helper 关闭沙箱（本机 macOS 无影响）。
      '--no-sandbox',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitForCdp(cdpEndpoint);

  let alive = true;
  const kill = () =>
    new Promise<void>((resolve) => {
      if (!alive) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3_000);
    });

  return {
    cdpEndpoint,
    userDataDir,
    process: child,
    dispose: kill,
    kill,
    endpointAlive: async () => {
      try {
        const res = await fetch(`${cdpEndpoint}/json/version`);
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export async function cleanupCdpChrome(chrome: CdpChrome | null): Promise<void> {
  if (!chrome) return;
  await chrome.kill();
  await rm(chrome.userDataDir, { recursive: true, force: true });
}

/** 由 ES 模块 URL 推断文件路径（需要读取 fixture html 时用）。 */
export function testDirname(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}
