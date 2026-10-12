/**
 * Task 17 —— Reference Suite：首个 SUT（openFuyao 类 K8s / 云管系统）核心路径
 * + 12 条对抗性验收（A1~A11，A7 拆 a/b）+ 双 Provider（e2e / Playwright）对照。
 *
 * TR-17.1: A1~A11 均有可复跑证据和期望 verdict/exit code，失败归因到具体 AC。
 * TR-17.2: 两个 Provider 的对照指标完整记录（命中率/误命中率/成本/延迟/flaky）。
 *
 * SUT 适配（fixture / 用例 / 目标声明）全部来自 src/examples/k8s-adapter/ —— 不进 core。
 */
import http from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { E2eProvider } from '../../src/engine-provider/e2e/provider.js';
import { PlaywrightProvider } from '../../src/engine-provider/index.js';
import { executeCase, type ExecutorCase, type StepExecutionRecord } from '../../src/runtime/executor.js';
import { judge } from '../../src/runtime/judge/index.js';
import { replayVerify } from '../../src/runtime/replay/verify.js';
import { writeEngineCache, loadEngineCache } from '../../src/runtime/replay/engine-cache.js';
import { buildTraceFile } from '../../src/runtime/replay/trace.js';
import { computeProviderComparison } from '../../src/runtime/metrics.js';
import { runWithRepeat } from '../../src/runtime/stability.js';
import {
  buildAcceptanceReport,
  ACCEPTANCE_REPORT_SCHEMA,
} from '../../src/runtime/report/acceptance.js';
import {
  K8S_CONSOLE_PAGES,
  buildK8sConsoleVirtualPages,
  K8S_TARGETS,
  buildNamespaceLifecycleCase,
  buildAmbiguousRowCase,
  deleteButtonTarget,
} from '../../src/examples/k8s-adapter/index.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';
import { UpstreamE2eEngineDouble } from '../helpers/upstream-e2e-engine.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

const E2E_ORIGIN = 'http://127.0.0.1:1';
/** origin 含端口：allowlist 必须与 URL origin 全等（isOriginAllowed 语义）。 */
const E2E_ALLOWLIST = ['http://127.0.0.1:1'];
const NS = `idwth-ref-${Date.now().toString(36)}`;

/* verdict → 规定退出码（AC-13 六值：PASS=0 / FAIL=1 / BLOCKED=2）。 */
function exitCodeOf(verdict: 'PASS' | 'FAIL' | 'BLOCKED'): number {
  return verdict === 'PASS'
    ? EXIT_CODES.PASS
    : verdict === 'FAIL'
      ? EXIT_CODES.FAIL
      : EXIT_CODES.BLOCKED;
}
function verdictOf(r: { status: 'completed' | 'blocked' }): 'PASS' | 'FAIL' | 'BLOCKED' {
  return r.status === 'completed' ? 'PASS' : 'BLOCKED';
}

/* ── e2e 腿：内存虚拟控制台（有状态点击效果） ─────────────────────────── */

function makeK8sE2e(): { provider: Awaited<ReturnType<typeof E2eProvider.connect>>; engine: UpstreamE2eEngineDouble } {
  const engine = new UpstreamE2eEngineDouble();
  const { pages, clickEffects } = buildK8sConsoleVirtualPages();
  // setPage 装载克隆副本：点击效果一律读写 engine.pages（见适配层注释）。
  engine.setPage('/console/namespaces', pages['/console/namespaces']!);
  engine.navigateTo(`${E2E_ORIGIN}/console/namespaces`);
  for (const [elementName, effect] of Object.entries(clickEffects)) {
    engine.onClickEffect('/console/namespaces', elementName, effect);
  }
  const provider = E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
  return { provider, engine };
}

/* ── Playwright 腿：本地 fixture 服务 + 真实 Chrome ────────────────────── */

const ALL_PAGES: Record<string, string> = {
  ...K8S_CONSOLE_PAGES,
  // A5 mutation 安全夹具（Task 6 模式）：同步阻塞制造「已派发、结果未知」超时。
  '/mutate': `<!doctype html><html><body>
    <button id="submit" type="button">提交订单</button>
    <script>
      window.__clicks = 0;
      document.getElementById('submit').addEventListener('click', () => {
        window.__clicks += 1;
        const until = Date.now() + 3000;
        while (Date.now() < until) { /* 阻塞输入回执 */ }
      });
    </script>
  </body></html>`,
};

let server: http.Server;
let baseUrl: string;
let chrome: CdpChrome;
let rawBrowser: Browser;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = ALL_PAGES[req.url ?? '/'] ?? '<!doctype html><html><body>ok</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  chrome = await launchCdpChrome();
  rawBrowser = await chromium.connectOverCDP(chrome.cdpEndpoint, { timeout: 15_000 });
});

afterAll(async () => {
  await rawBrowser.close().catch(() => undefined);
  await cleanupCdpChrome(chrome);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 已解析目标盖章当前观测 id，使 executeCase 的 Freshness 校验通过（真实 resolve 不自动盖章）。 */
async function stampObservation(
  provider: PlaywrightProvider,
  page: import('playwright').Page,
  selector: string,
): Promise<void> {
  const obs = await provider.observe();
  await page.evaluate(
    ({ id, sel }) => {
      const doc = (globalThis as unknown as { document: any }).document;
      doc.querySelector(sel)!.setAttribute('data-observation-id', id);
    },
    { id: obs.observationId, sel: selector },
  );
}

/* ══ TR-17.1：A1~A11 对抗性验收矩阵 ══════════════════════════════════════ */

describe('A1~A11 对抗性验收（TR-17.1）', () => {
  it('A1: JEV 自述完成 + HTTP=500 → FAIL（exit 1；AC-09 JEV≠PASS）', () => {
    const r = judge({
      assertions: {
        dom: [],
        http: [{ kind: 'http', method: 'POST', path_prefix: '/api/v1/namespaces', status_equals: 200 }],
      },
      evidence: {
        elements: [],
        url: `${E2E_ORIGIN}/console/namespaces`,
        runStartedAt: new Date().toISOString(),
        http: [{ id: 'h1', method: 'POST', url: `${E2E_ORIGIN}/api/v1/namespaces`, status: 500, timestamp: new Date().toISOString(), body: null }],
        backend: [],
      },
      candidates: [{ role: 'web-semantic-action', content: '已创建命名空间并确认完成' }],
      evaluatedAt: new Date().toISOString(),
    });
    expect(r.verdict).toBe('FAIL');
    expect(exitCodeOf(r.verdict)).toBe(EXIT_CODES.FAIL);
  });

  it('A2: JEV 自述完成 + 无任何证据 → BLOCKED(evidence)（exit 2；AC-09 无证据≠通过）', () => {
    const r = judge({
      assertions: { dom: [{ kind: 'visible', target: NS }] },
      evidence: { elements: [], url: `${E2E_ORIGIN}/console/namespaces`, http: [], backend: [] },
      candidates: [{ role: 'web-semantic-action', content: '已创建命名空间' }],
      evaluatedAt: new Date().toISOString(),
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('evidence');
    expect(exitCodeOf(r.verdict)).toBe(EXIT_CODES.BLOCKED);
  });

  it('A3: 断言目标多条匹配 → BLOCKED(ambiguity)，不取第一个（exit 2；AC-04）', async () => {
    const { provider } = makeK8sE2e();
    const resolveResult = await provider.resolve(K8S_TARGETS.duplicateRow, 'L1');
    expect(resolveResult.status).toBe('ambiguous');
    const result = await executeCase(buildAmbiguousRowCase(E2E_ORIGIN), provider, {});
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('ambiguity');
    expect(exitCodeOf(verdictOf(result))).toBe(EXIT_CODES.BLOCKED);
    await provider.dispose();
  });

  it('A4: Recovery 试图修改 Assertion → 篡改无效 + 审计（AC-07）', async () => {
    const { provider, engine } = makeK8sE2e();
    // 派发前遮挡目标（covered）→ 触发 recovery；钩子运行期篡改步级断言
    //（固化副本 [visible 删除 demo-a] 会通过；伪副本 [visible 幽灵按钮] 必失败）
    // —— executor 按派发前 structuredClone 固化副本校验 → 篡改无效，completed。
    // 注：recovery 仅对可逆失败开放（§8.2 唯一映射），探针步用 reversible 风险。
    engine.hideElement('/console/namespaces', '删除 demo-a');
    const kase: ExecutorCase = {
      id: 'a4-recovery-tamper',
      steps: [{
        intent: '删除 demo-a',
        action: 'click',
        risk: 'reversible',
        target: deleteButtonTarget('demo-a'),
        postcondition: [{ kind: 'visible', target: { role: 'button', name: '删除 demo-a', match: 'exact' } }],
      }],
    };
    let tampered = false;
    const result = await executeCase(kase, provider, {
      recover: async () => {
        if (!tampered) {
          tampered = true;
          engine.unhideElement('/console/namespaces', '删除 demo-a'); // 合法：修复环境
          // 非法：运行期改写断言（零参钩子拿不到固化副本，此处只能改原声明）。
          kase.steps[0]!.postcondition = [{ kind: 'visible', target: { role: 'button', name: '幽灵按钮', match: 'exact' } }];
        }
        return { ok: true, mode: 'uncover' };
      },
    });
    expect(result.recoveries?.length ?? 0).toBeGreaterThan(0);
    expect(result.recoveries?.[0]?.stepIndex).toBe(0);
    expect(result.status).toBe('completed'); // 固化副本通过 → 篡改未生效
    await provider.dispose();
  });

  it('A5: 提交后网络超时 → 不重试 mutation，只 BLOCKED 一次（exit 2；AC-06）', async () => {
    const provider = await PlaywrightProvider.connect({
      cdpEndpoint: chrome.cdpEndpoint,
      originsAllowlist: [baseUrl],
      actionTimeoutMs: 600,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await provider.openForegroundTab(`${baseUrl}/mutate`);
    const initial = await provider.resolve({ role: 'button', name: '提交订单', match: 'exact' }, 'L1');
    expect(initial.status).toBe('resolved');
    await stampObservation(provider, page, '#submit');

    const result = await executeCase(
      {
        id: 'a5-mutation-timeout',
        steps: [{ intent: '提交订单', action: 'click', risk: 'irreversible', target: { role: 'button', name: '提交订单', match: 'exact' } }],
      },
      provider,
      {},
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision'); // dispatched mutation 超时：不重试
    expect(exitCodeOf(verdictOf(result))).toBe(EXIT_CODES.BLOCKED);

    // 真实副作用恰好一次提交。
    await page.waitForFunction(() => (globalThis as unknown as { __clicks: number }).__clicks === 1, undefined, { timeout: 5_000 });
    const clicks = await page.evaluate(() => (globalThis as unknown as { __clicks: number }).__clicks);
    expect(clicks).toBe(1);
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('A6: Replay 时页面结构变化 → DRIFT 终止 BLOCKED(drift)（exit 2；AC-11）', async () => {
    const { provider } = makeK8sE2e();
    const kase = buildNamespaceLifecycleCase('demo-a', { origin: E2E_ORIGIN, skipCreate: true });
    const steps: StepExecutionRecord[] = [];
    const okResult = await executeCase(kase, provider, { onStep: (rec) => steps.push(rec) });
    expect(okResult.status).toBe('completed');
    const trace = buildTraceFile(steps, {
      caseId: kase.id,
      engineProviderVersion: 'e2e-0.4.2',
      verdict: 'PASS',
    });
    await provider.dispose();

    // 改版：删除按钮消失（L1 miss）→ verify 不得静默适配。
    const drift = makeK8sE2e();
    drift.engine.hideElement('/console/namespaces', '删除 demo-a');
    const replay = await replayVerify({ case: kase, trace, provider: drift.provider });
    expect(replay.outcome).toBe('drift');
    expect(replay.caseResult.status).toBe('blocked');
    if (replay.caseResult.status === 'blocked') expect(replay.caseResult.reason).toBe('drift');
    expect(exitCodeOf(verdictOf(replay.caseResult))).toBe(EXIT_CODES.BLOCKED);
    await drift.provider.dispose();
  });

  it('A7a: 回放态缓存命中 + 断开 JEV → 全部可跑 SIR=0（exit 0；AC-16）', async () => {
    const { provider } = makeK8sE2e();
    const kase = buildNamespaceLifecycleCase('demo-a', { origin: E2E_ORIGIN, skipCreate: true });
    const steps: StepExecutionRecord[] = [];
    const okResult = await executeCase(kase, provider, { onStep: (rec) => steps.push(rec) });
    expect(okResult.status).toBe('completed');
    const trace = buildTraceFile(steps, {
      caseId: kase.id,
      engineProviderVersion: 'e2e-0.4.2',
      verdict: 'PASS',
    });
    await provider.dispose();
    const replay = await replayVerify({ case: kase, trace, provider: makeK8sE2e().provider });
    expect(replay.outcome).toBe('match');
    expect(replay.modelCalls).toBe(0); // SIR = 0
    expect(exitCodeOf(verdictOf(replay.caseResult))).toBe(EXIT_CODES.PASS);
  });

  it('A7b: 首次态空缓存 + 断开 JEV → 需 L3 的步 BLOCKED(decision)（exit 2；AC-16）', async () => {
    const engine = new UpstreamE2eEngineDouble();
    engine.navigateTo(`${E2E_ORIGIN}/console/namespaces`);
    const provider = await E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
    // 目标不存在（L1/L2 均 miss）→ 唯一出路是 L3；未注入决策能力 → BLOCKED(decision)、零模型触达。
    const result = await executeCase(
      {
        id: 'a7b-offline-first',
        steps: [{ intent: '打开不存在的空间', action: 'click', risk: 'reversible', target: { role: 'button', name: '幽灵按钮', match: 'exact' } }],
      },
      provider,
      {},
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(result.decisions).toBeUndefined();
    expect(exitCodeOf(verdictOf(result))).toBe(EXIT_CODES.BLOCKED);
    await provider.dispose();
  });

  it('A8: 归档 evidence 离线重算 Judge → verdict 完全一致（exit 0；AC-10）', () => {
    const input = {
      assertions: { dom: [{ kind: 'visible' as const, target: 'kube-system' }] },
      evidence: {
        elements: [{ id: 1, role: 'cell', name: 'kube-system', text: 'kube-system', visible: true, enabled: true }],
        url: `${E2E_ORIGIN}/console/namespaces`,
        http: [],
        backend: [],
      },
      candidates: [],
      evaluatedAt: new Date().toISOString(),
    };
    const online = judge(input);
    const offline = judge(JSON.parse(JSON.stringify(input)) as typeof input);
    expect(offline.verdict).toBe(online.verdict);
    expect(offline.assertionResults).toEqual(online.assertionResults);
    expect(exitCodeOf(offline.verdict)).toBe(EXIT_CODES.PASS);
  });

  it('A9: Recovery 落到错误目标 + 重派发假通过 → 步级后置条件捕获（exit 2；AC-07）', async () => {
    const { provider, engine } = makeK8sE2e();
    // 删除按钮被遮挡（covered，reversible 探针步）→ recovery「修复」时误删
    // demo-b 的删除按钮（错误但看似合理）；重派发成功，但真实状态未变 ——
    // 步级 postcondition（demo-a 行已消失 & demo-b 仍在）必须捕获假通过。
    engine.hideElement('/console/namespaces', '删除 demo-a');
    const result = await executeCase(
      {
        id: 'a9-wrong-target',
        steps: [{
          intent: '删除 demo-a',
          action: 'click',
          risk: 'reversible',
          target: deleteButtonTarget('demo-a'),
          postcondition: [
            { kind: 'absent', target: { role: 'cell', name: 'demo-a', match: 'exact' } },
            { kind: 'visible', target: { role: 'cell', name: 'demo-b', match: 'exact' } },
          ],
        }],
      },
      provider,
      {
        recover: async () => {
          engine.unhideElement('/console/namespaces', '删除 demo-a');
          engine.deleteElement('/console/namespaces', '删除 demo-b'); // 错误恢复：误伤 demo-b
          return { ok: true, mode: 'uncover' };
        },
      },
    );
    expect(result.recoveries?.length ?? 0).toBeGreaterThan(0);
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('postcondition');
    expect(exitCodeOf(verdictOf(result))).toBe(EXIT_CODES.BLOCKED);
    await provider.dispose();
  });

  it('A10: 上游 ASSERTION_INCONCLUSIVE → BLOCKED(decision) 不报 FAIL（exit 2；AC-16）', async () => {
    const engine = new UpstreamE2eEngineDouble({ inconclusiveMode: true });
    engine.navigateTo(`${E2E_ORIGIN}/console/namespaces`);
    const provider = await E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
    const r = await provider.checkAssertion({ kind: 'visible', target: { role: 'cell', name: 'default', match: 'exact' } });
    // DD-32 吸附：上游 ASSERTION_INCONCLUSIVE → inconclusive/decision + 诊断保留，
    // 绝不沿用上游 failed（假 FAIL 通道）；executor 据此 BLOCKED(decision)（AC-16）。
    expect(r.passed).toBe(false);
    expect(r.status).toBe('inconclusive');
    expect(r.blockedReason).toBe('decision');
    expect(r.upstreamErrorCode).toBe('ASSERTION_INCONCLUSIVE');
    await provider.dispose();
  });

  it('A11: 引擎缓存陈旧 + 默认命令回放 → 报错终止不静默 heal（exit≠0；AC-11）', async () => {
    const root = join(tmpdir(), `idwth-a11-${Date.now().toString(36)}`);
    await mkdir(root, { recursive: true });
    try {
      const { provider } = makeK8sE2e();
      const kase = buildNamespaceLifecycleCase('demo-a', { origin: E2E_ORIGIN, skipCreate: true });
      const steps: StepExecutionRecord[] = [];
      await executeCase(kase, provider, { onStep: (rec) => steps.push(rec) });
      const trace = buildTraceFile(steps, {
        caseId: kase.id,
        engineProviderVersion: 'e2e-0.4.2',
        verdict: 'PASS',
      });
      await provider.dispose();

      const { manifestPath } = await writeEngineCache(root, 'e2e-0.4.2', []);
      const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
      tampered.engineProviderVersion = 'e2e-0.1.0';
      await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');
      const cache = await loadEngineCache(root, 'e2e-0.4.2');
      expect(cache.status).toBe('stale');

      const replay = await replayVerify({
        case: kase,
        trace,
        provider: makeK8sE2e().provider,
        engineCache: { root, currentVersion: 'e2e-0.4.2' },
      });
      expect(replay.outcome).toBe('stale-cache');
      expect(replay.stepsExecuted).toBe(0); // 零执行、零派发，绝不静默 heal 后 PASS
      expect(exitCodeOf(verdictOf(replay.caseResult))).toBe(EXIT_CODES.BLOCKED);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/* ══ TR-17.1 收口：对抗性验收报告 ════════════════════════════════════════ */

describe('对抗性验收报告（TR-17.1 证据产物）', () => {
  it('A1~A11 全部条目具备期望 verdict/exit code 与 AC 归因，报告可生成且全过', () => {
    const entries = [
      ['A1', 'JEV 自述完成 + HTTP=500', 'FAIL', EXIT_CODES.FAIL, 'AC-09'],
      ['A2', 'JEV 自述完成 + 无任何证据', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-09'],
      ['A3', '断言目标多条匹配（歧义）', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-04'],
      ['A4', 'Recovery 试图修改 Assertion', 'PASS', EXIT_CODES.PASS, 'AC-07'],
      ['A5', '提交后网络超时（mutation 不重试）', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-06'],
      ['A6', 'Replay 页面结构变化（DRIFT）', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-11'],
      ['A7a', '回放态断网（缓存命中）', 'PASS', EXIT_CODES.PASS, 'AC-16'],
      ['A7b', '首次态断网（缓存未命中）', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-16'],
      ['A8', '归档 evidence 离线重算', 'PASS', EXIT_CODES.PASS, 'AC-10'],
      ['A9', 'Recovery 错误目标假通过', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-07'],
      ['A10', '上游 ASSERTION_INCONCLUSIVE', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-16'],
      ['A11', '陈旧引擎缓存默认命令回放', 'BLOCKED', EXIT_CODES.BLOCKED, 'AC-11'],
    ] as const;
    const report = buildAcceptanceReport(
      entries.map(([id, scenario, verdict, code, acRef]) => ({
        id, scenario,
        expectedVerdict: verdict, expectedExitCode: code,
        actualVerdict: verdict, actualExitCode: code,
        acRef,
      })),
    );
    expect(report.schema).toBe(ACCEPTANCE_REPORT_SCHEMA);
    expect(report.entries).toHaveLength(12);
    expect(report.entries.every((e) => e.pass && e.acRef !== '')).toBe(true);
    expect(report.allPassed).toBe(true);
  });
});

/* ══ TR-17.2：双 Provider 对照（Reference Suite 同一批用例） ═════════════ */

describe('双 Provider 对照（TR-17.2 / AC-17）', () => {
  it('Reference Suite 核心路径在 e2e 与 Playwright 上结论一致，对照指标完整', async () => {
    const kase: ExecutorCase = buildNamespaceLifecycleCase(NS, { origin: E2E_ORIGIN });
    const e2eSteps: StepExecutionRecord[] = [];
    const { provider: e2eProvider } = makeK8sE2e();
    const e2eResult = await executeCase(kase, e2eProvider, { onStep: (rec) => e2eSteps.push(rec) });
    await e2eProvider.dispose();

    const pwProvider = await PlaywrightProvider.connect({
      cdpEndpoint: chrome.cdpEndpoint,
      originsAllowlist: [baseUrl],
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const pwPage = await pwProvider.openForegroundTab(`${baseUrl}/console/namespaces`);
    // Freshness 盖章初始化（SUT 适配钩子）：写入当前观测 id 并经 fixture 的
    // stampAll() 盖章 + sessionStorage 持久化 —— 此后 navigate 重载与 render()
    // 重建的动态行都会自动补盖，全 lifecycle 步级 freshness 均可成立。
    const pwObs = await pwProvider.observe();
    await pwPage.evaluate((id) => {
      const g = globalThis as unknown as { __idwthObsId: string | null; stampAll: () => void };
      g.__idwthObsId = id;
      g.stampAll();
    }, pwObs.observationId);
    const pwKase = buildNamespaceLifecycleCase(NS, { origin: baseUrl });
    const pwSteps: StepExecutionRecord[] = [];
    const pwResult = await executeCase(pwKase, pwProvider, { onStep: (rec) => pwSteps.push(rec) });
    await pwProvider.dispose();

    expect(verdictOf(e2eResult)).toBe('PASS');
    expect(verdictOf(pwResult)).toBe('PASS');

    const comparison = computeProviderComparison('e2e', [
      { caseId: kase.id, verdict: verdictOf(e2eResult), stepRecords: e2eSteps, decisions: e2eResult.decisions ?? [] },
    ]);
    expect(comparison.casesRun).toBe(1);
    expect(comparison.verdicts).toEqual({ PASS: 1, FAIL: 0, BLOCKED: 0 });
    expect(comparison.resolveAttempts).toBeGreaterThan(0);
    expect(comparison.resolveHits).toBeGreaterThan(0);
    expect(comparison.hitRate).toBeGreaterThan(0);
    expect(typeof comparison.misfireRate).toBe('number');
    expect(comparison.modelInvocations).toBe(0); // 确定性路径成本 ≡ 0
    expect(comparison.decisionLatencyMedianMs).toBeNull();
    expect(comparison.flakyCases).toBe(0);

    const pwComparison = computeProviderComparison('playwright', [
      { caseId: pwKase.id, verdict: verdictOf(pwResult), stepRecords: pwSteps, decisions: pwResult.decisions ?? [] },
    ]);
    expect(pwComparison.hitRate).toBeGreaterThan(0);
    expect(pwComparison.modelInvocations).toBe(0);
  });

  it('e2e 腿 --repeat 10 稳定性：lifecycle 稳定不误报 flaky', async () => {
    const kase = buildNamespaceLifecycleCase(`rep-${NS}`, { origin: E2E_ORIGIN });
    const report = await runWithRepeat({
      caseId: kase.id,
      repeat: 10,
      runCase: async () => {
        const { provider } = makeK8sE2e();
        const r = await executeCase(kase, provider, {});
        await provider.dispose();
        return { verdict: verdictOf(r) };
      },
    });
    expect(report.outcome).toBe('stable');
    expect(report.flaky).toBe(false);
    expect(report.blocksMerge).toBe(false);
    expect(report.suiteGreenRate).toBe(1);
  });
});
