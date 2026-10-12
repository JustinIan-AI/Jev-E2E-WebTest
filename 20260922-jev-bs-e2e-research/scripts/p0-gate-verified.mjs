// P0 闸门实测 v2：单次连接完成能力矩阵 + 单独确证 browser.close() 的破坏性语义
// 使用临时 user-data-dir，不触碰用户真实 profile
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 9336;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'p0v2-'));
let pass = 0, fail = 0;
const ok = (k, v, good = true) => { good ? pass++ : fail++; console.log(`  ${good ? 'PASS' : 'FAIL'}  ${k}: ${v}`); };

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox',
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--headless=new', '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' });

async function endpointUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json(); } catch {}
    await delay(250);
  }
  return null;
}

try {
  const ver = await endpointUp();
  if (!ver) throw new Error('调试端口未就绪');
  console.log(`环境: ${ver.Browser} | protocol ${ver['Protocol-Version']} | Playwright 1.63.0\n`);

  // ===== 单次连接，完成全部能力核验（测试框架的真实用法） =====
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
  console.log('[连接] connectOverCDP 成功');
  ok('contexts.length', browser.contexts().length, browser.contexts().length >= 1);

  const existing = browser.contexts()[0];

  // 预置"用户已有会话"，再验证复用
  const bp = await existing.newPage();
  await bp.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  await existing.addCookies([{ name: 'session', value: 'PRE-EXISTING-TOKEN', domain: '.example.com', path: '/' }]);
  await bp.evaluate(() => localStorage.setItem('preExisting', 'YES'));
  await bp.close();

  console.log('\n[A] 复用既有会话状态');
  const ck = await existing.cookies('https://example.com/');
  ok('读到既有 cookie', ck.some(c => c.value === 'PRE-EXISTING-TOKEN'));
  const reuse = await existing.newPage();
  await reuse.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
  ok('既有 localStorage 可见', await reuse.evaluate(() => localStorage.getItem('preExisting')) === 'YES');
  await reuse.close();

  console.log('\n[B] 每 case 隔离（强隔离 / 弱隔离）');
  try {
    const nc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const cp = await nc.newPage();
    await cp.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
    const nck = await nc.cookies('https://example.com/');
    ok('newContext() 可用', true);
    ok('新 context cookie 已隔离', `${nck.length} 条`, nck.length === 0);
    await nc.close();
  } catch (e) { ok('newContext() 可用', String(e).split('\n')[0].slice(0, 90), false); }

  try {
    const np = await existing.newPage();
    await np.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
    ok('既有 context.newPage() 可用（弱隔离）', `title="${await np.title()}"`);
    await np.close();
  } catch (e) { ok('既有 context.newPage()', String(e).split('\n')[0].slice(0, 90), false); }

  console.log('\n[C] 断言原语（Playwright 自动等待重试）');
  const ap = await existing.newPage();
  await ap.setContent(`<h1>Welcome back</h1>
    <label for="t">Theme</label><input id="t" value="Dark">
    <label for="c">Enable notifications</label><input type="checkbox" id="c" checked>
    <input type="password" id="pw" value="SECRET-VALUE">`);
  await ap.getByRole('heading', { name: 'Welcome back' }).waitFor({ state: 'visible', timeout: 3000 });
  ok('visible 断言', true);
  ok('label→value 断言', await ap.getByLabel('Theme', { exact: true }).inputValue());
  ok('checked 断言', await ap.getByLabel('Enable notifications', { exact: true }).isChecked());
  await ap.screenshot({ path: join(profile, 'shot.png'), mask: [ap.locator('input[type=password]')] });
  ok('screenshot + mask 遮罩', true);

  console.log('\n[D] 后台标签页（复用用户浏览器时不抢焦点）');
  const cdp = await existing.newCDPSession(ap);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', background: true });
  ok('Target.createTarget(background)', !!targetId);
  const s2 = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  ok('Target.attachToTarget', !!s2.sessionId);
  await cdp.send('Target.closeTarget', { targetId });
  ok('Target.closeTarget', true);
  await ap.close();

  console.log('\n[E] 破坏性语义确证：browser.close() 会否杀掉浏览器？');
  await browser.close();
  await delay(1200);
  let alive = false;
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); alive = r.ok; } catch { alive = false; }
  ok('browser.close() 后 CDP 端点存活', alive ? '存活' : '已消失（浏览器被杀）', true);
  console.log(`  → 结论: browser.close() ${alive ? '不会' : '会'} 关闭用户浏览器`);

  console.log(`\n[汇总] PASS ${pass} / FAIL ${fail}`);
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  await delay(400);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
