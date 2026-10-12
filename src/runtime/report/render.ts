/**
 * Task 11 — 单文件静态 HTML 报告渲染（FR-8 / AC-12 / AC-19，DD-48）。
 *
 * 硬契约：
 *   - 服务端直接把数据渲染成 DOM；最终 HTML 不含任何 <script>、不取数、无运行时依赖；
 *   - CSS 全量内联；截图以 data: URI 内联；不存在 http(s)/相对 URL 资源引用；
 *   - 可在断网环境 file:// 双击打开；
 *   - 状态配色 PASS 中性蓝 / FAIL 红 / BLOCKED 琥珀，不以红绿表达通过与否。
 */
import type {
  ReportAssertionResult,
  ReportData,
  ReportStep,
} from './types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const VERDICT_TEXT: Readonly<Record<ReportData['verdict'], string>> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
};

/** 三态配色：PASS 中性蓝、FAIL 红、BLOCKED 琥珀。 */
function verdictStyles(verdict: ReportData['verdict']): string {
  if (verdict === 'PASS') {
    return ':root{--accent:#2563eb;}';
  }
  if (verdict === 'FAIL') {
    return ':root{--accent:#dc2626;}';
  }
  return ':root{--accent:#d97706;}';
}

function renderStep(step: ReportStep): string {
  const cells = [
    `<td class="num">${step.index}</td>`,
    `<td>${escapeHtml(step.intent)}</td>`,
    `<td><code>${escapeHtml(step.action)}</code></td>`,
    `<td>${step.target === undefined ? '' : escapeHtml(step.target)}</td>`,
    `<td>${step.risk === undefined ? '' : escapeHtml(step.risk)}</td>`,
  ];
  return `      <tr>${cells.join('')}</tr>`;
}

function renderAssertion(item: ReportAssertionResult): string {
  const badge = item.passed ? 'passed' : item.state;
  return [
    '    <li class="assertion">',
    `      <span class="state state-${escapeHtml(badge)}">${escapeHtml(badge)}</span>`,
    `      <code class="kind">${escapeHtml(item.kind)}</code>`,
    `      <span class="desc">${escapeHtml(item.description)}</span>`,
    `      <span class="eref">${escapeHtml(item.evidence_ref)}</span>`,
    '    </li>',
  ].join('\n');
}

interface InlineScreenshot {
  caption?: string;
  mediaType: string;
  base64: string;
}

/**
 * 渲染自包含报告 HTML。
 * @param data report.json 数据
 * @param screenshots 与 data.screenshots 顺序一致的内联截图内容
 */
export function renderReportHtml(
  data: ReportData,
  screenshots: readonly InlineScreenshot[],
): string {
  const verdictText = VERDICT_TEXT[data.verdict];
  const failureBlock =
    data.failure_reason === null
      ? ''
      : [
          '  <section class="block">',
          '    <h2>未通过原因</h2>',
          `    <p class="failure-reason">${escapeHtml(data.failure_reason)}</p>`,
          '  </section>',
        ].join('\n');

  const shots = screenshots
    .map(
      (s) => `    <figure class="shot">
      <img alt="${escapeHtml(s.caption ?? '测试截图')}" src="data:${escapeHtml(s.mediaType)};base64,${s.base64}"/>
      ${s.caption === undefined ? '' : `<figcaption>${escapeHtml(s.caption)}</figcaption>`}
    </figure>`,
    )
    .join('\n');

  const style = `${verdictStyles(data.verdict)}
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
*{box-sizing:border-box;}
body{margin:0;background:#f5f6f8;color:#1f2430;line-height:1.6;}
main{max-width:960px;margin:0 auto;padding:32px 24px 64px;}
h1{font-size:24px;margin:0 0 4px;}
h2{font-size:17px;margin:0 0 12px;color:#111827;}
.sub{color:#5b6472;margin:0 0 20px;}
.badge{display:inline-block;padding:4px 14px;border-radius:999px;color:#fff;background:var(--accent);font-weight:700;letter-spacing:.06em;}
.block{background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:18px 20px;margin:16px 0;}
table{width:100%;border-collapse:collapse;font-size:14px;}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef0f3;vertical-align:top;}
th{color:#5b6472;font-weight:600;font-size:13px;}
td.num{color:var(--accent);font-weight:700;width:36px;}
code{background:#f1f3f6;border-radius:4px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;}
.assertion{list-style:none;padding:10px 0;border-bottom:1px solid #eef0f3;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;}
.assertion:last-child{border-bottom:none;}
.state{font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;color:#fff;}
.state-passed{background:#2563eb;}
.state-failed{background:#dc2626;}
.state-unevaluable,.state-ambiguous{background:#d97706;}
.kind{flex:0 0 auto;}
.desc{flex:1 1 240px;}
.eref{color:#5b6472;font-size:12px;}
.failure-reason{margin:0;color:var(--accent);font-weight:600;}
.rerun{margin:0;}
.rerun code{display:block;padding:12px 14px;white-space:pre-wrap;word-break:break-all;background:#0f172a;color:#e2e8f0;}
dl.meta{display:grid;grid-template-columns:120px 1fr;gap:6px 16px;margin:0;font-size:14px;}
dl.meta dt{color:#5b6472;}
dl.meta dd{margin:0;}
.shot{margin:0 0 16px;}
.shot img{max-width:100%;border:1px solid #e4e7ec;border-radius:8px;background:#fff;}
.shot figcaption{color:#5b6472;font-size:13px;margin-top:6px;}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(data.case.name)} · ${verdictText} · IDWTH 报告</title>
<style>
${style}
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(data.case.name)}</h1>
  <p class="sub">用例 <code>${escapeHtml(data.case.id)}</code> · 运行 <code>${escapeHtml(data.run_id)}</code> · 生成于 ${escapeHtml(data.generated_at)}</p>
  <p><span class="badge">${verdictText}</span></p>

  <section class="block">
    <h2>测试用例</h2>
    <dl class="meta">
      <dt>用例目标</dt><dd>${escapeHtml(data.case.goal)}</dd>
      <dt>目标地址</dt><dd><code>${escapeHtml(data.case.base_url)}</code></dd>
    </dl>
  </section>

  <section class="block">
    <h2>执行步骤</h2>
    <table>
      <thead><tr><th>#</th><th>意图</th><th>动作</th><th>目标</th><th>风险</th></tr></thead>
      <tbody>
${data.steps.map(renderStep).join('\n')}
      </tbody>
    </table>
  </section>

  <section class="block">
    <h2>断言结果</h2>
    <ul>
${data.assertion_results.map(renderAssertion).join('\n')}
    </ul>
  </section>
${failureBlock === '' ? '' : `\n${failureBlock}`}

  <section class="block">
    <h2>测试截图</h2>
${shots}
  </section>

  <section class="block">
    <h2>可复现过程</h2>
    <p>复跑用例（provider：<code>${escapeHtml(data.reproduction.provider)}</code>，契约：<code>${escapeHtml(data.reproduction.contract_path)}</code>）：</p>
    <p class="rerun"><code>${escapeHtml(data.reproduction.rerun_command)}</code></p>
  </section>
</main>
</body>
</html>
`;
}
