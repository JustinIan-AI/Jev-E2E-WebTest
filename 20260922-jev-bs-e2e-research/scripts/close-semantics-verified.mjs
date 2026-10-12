// 定向复核：connectOverCDP 后调用 browser.close() 的确切语义（跑 3 轮）
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function probe(port, label) {
  const profile = await mkdtemp(join(tmpdir(), `cls-${port}-`));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--no-sandbox',
    '--disable-dev-shm-usage', '--disable-gpu-sandbox',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });
  const up = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return true; } catch {} await delay(250); } return false; };
  try {
    if (!await up()) throw new Error('端口未就绪');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
    const ctx = browser.contexts()[0];
    const p = await ctx.newPage();
    await p.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

    await browser.close();
    await delay(1500);

    let alive = false;
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); alive = r.ok; } catch {}
    // 端点存活时，再看原有页面是否还在（区分"仅断开"与"真关闭"）
    let pagesAfter = null;
    if (alive) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`);
        pagesAfter = (await r.json()).filter(t => t.type === 'page').length;
      } catch {}
    }
    const stillOpen = alive && pagesAfter > 0;
    console.log(`${label}: 端点存活=${alive} | 剩余page数=${pagesAfter} | 用户浏览器${stillOpen ? '仍在运行' : '已终止'}`);
    return stillOpen;
  } finally {
    try { chrome.kill('SIGKILL'); } catch {}
    await delay(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

const results = [];
for (const [i, port] of [9401, 9402, 9403].entries()) {
  results.push(await probe(port, `第${i + 1}轮`));
}
console.log(`\n结论: ${results.every(Boolean) ? 'browser.close() 不会关闭用户浏览器（仅断开连接）' : results.some(Boolean) ? '结果不稳定，需谨慎' : 'browser.close() 会关闭用户浏览器'}`);
console.log(`原始结果: ${JSON.stringify(results)}`);
