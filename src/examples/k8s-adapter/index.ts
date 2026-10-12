/**
 * Task 17 —— K8s reference adapter（首个 SUT：openFuyao 类 K8s / 云管系统）。
 *
 * ★ SUT 适配项不进 core（DD §12）：本目录只放「特定 SUT」的 fixture / 目标声明 /
 *   Reference Suite 用例构建器；core（runtime / engine-provider）不 import 本目录。
 *
 * 双形态 fixture（同一套元素语义，保证双 Provider 跑同一批用例）：
 *  - K8S_CONSOLE_PAGES：真实 DOM + 原生 JS（Playwright 腿，本地 http 服务）；
 *  - buildK8sConsoleVirtualPages()：内存虚拟元素 + 点击效果（e2e 腿，UpstreamE2eEngineDouble）。
 */
import type { ExecutorCase } from '../../runtime/executor.js';

/* ── 语义目标声明（role/name 与两形态 fixture 严格对齐） ────────────────── */

export interface SemanticTargetSpec {
  role: string;
  name: string;
  match: 'exact' | 'substring';
}

export const K8S_TARGETS = {
  newNamespace: { role: 'button', name: '新建命名空间', match: 'exact' },
  nameInput: { role: 'textbox', name: '名称', match: 'exact' },
  submit: { role: 'button', name: '提交', match: 'exact' },
  confirmDelete: { role: 'button', name: '确认删除', match: 'exact' },
  /** A3 歧义探针：页面上预置两个同名按钮。 */
  duplicateRow: { role: 'button', name: '批量操作', match: 'exact' },
} as const;

export function deleteButtonTarget(ns: string): SemanticTargetSpec {
  return { role: 'button', name: `删除 ${ns}`, match: 'exact' };
}

/* ── Playwright 腿 fixture（真实 DOM；本地 http 服务按路径返回） ─────────── */

export const K8S_CONSOLE_PAGES: Record<string, string> = {
  '/console/namespaces': `<!doctype html><html><body>
    <h1>命名空间</h1>
    <button id="btn-new">新建命名空间</button>
    <div id="ns-form" style="display:none">
      <label>名称 <input id="ns-name" type="text" aria-label="名称" /></label>
      <button id="btn-submit">提交</button>
    </div>
    <table><tbody id="ns-rows"></tbody></table>
    <div id="confirm-layer" style="display:none">
      <button id="btn-confirm">确认删除</button>
    </div>
    <button class="batch">批量操作</button>
    <button class="batch">批量操作</button>
    <script>
      // IDWTH 观测盖章钩子（SUT 适配）：render() 重建行节点后自动补盖当前观测 id，
      // 使 Runtime Freshness（data-observation-id 比对）在动态行上同样成立。
      // 观测 id 经 sessionStorage 持久化：executeCase 的 navigate 步会重载页面，
      // 重载后脚本自动恢复 id 并补盖，freshness 链路不中断。
      window.__idwthObsId = sessionStorage.getItem('__idwth_obs_id');
      function stampAll() {
        if (!window.__idwthObsId) return;
        sessionStorage.setItem('__idwth_obs_id', window.__idwthObsId);
        document.querySelectorAll('button,input').forEach((el) => {
          el.setAttribute('data-observation-id', window.__idwthObsId);
        });
      }
      const state = ['demo-a', 'demo-b'];
      let pending = null;
      function render() {
        const rows = document.getElementById('ns-rows');
        rows.innerHTML = '';
        for (const ns of state) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.textContent = ns;
          td.setAttribute('aria-label', ns);
          const del = document.createElement('button');
          del.textContent = '删除 ' + ns;
          del.setAttribute('aria-label', '删除 ' + ns);
          del.addEventListener('click', () => {
            pending = ns;
            document.getElementById('confirm-layer').style.display = 'block';
          });
          tr.appendChild(td);
          tr.appendChild(del);
          rows.appendChild(tr);
        }
        stampAll();
      }
      document.getElementById('btn-new').addEventListener('click', () => {
        document.getElementById('ns-form').style.display = 'block';
      });
      document.getElementById('btn-submit').addEventListener('click', () => {
        const v = document.getElementById('ns-name').value.trim();
        if (v && !state.includes(v)) state.push(v);
        render();
      });
      document.getElementById('btn-confirm').addEventListener('click', () => {
        if (pending !== null) {
          const i = state.indexOf(pending);
          if (i >= 0) state.splice(i, 1);
          pending = null;
        }
        document.getElementById('confirm-layer').style.display = 'none';
        render();
      });
      render();
    </script>
  </body></html>`,
};

/* ── e2e 腿 fixture（内存虚拟元素 + 有状态点击效果） ───────────────────── */

export interface VirtualElementLike {
  role: string;
  name: string;
  text?: string;
  value?: string;
  visible: boolean;
  enabled: boolean;
}

/** effect 只依赖 pages 的最小结构面（helper 的 Double 是其超集）。 */
export interface VirtualConsoleEngine {
  pages: Record<string, VirtualElementLike[]>;
}

export interface K8sConsoleVirtual {
  /** 初始虚拟页面（含 demo-a / demo-b 预置行与两个「批量操作」歧义探针）。 */
  pages: Record<string, VirtualElementLike[]>;
  /** 按元素名注册的点击效果（'*' 通配兜底；模拟 SPA 状态转换）。 */
  clickEffects: Record<string, (engine: VirtualConsoleEngine, elementName?: string) => void>;
}

export function buildK8sConsoleVirtualPages(): K8sConsoleVirtual {
  const url = '/console/namespaces';
  const rowsOf = (names: string[]): VirtualElementLike[] =>
    names.flatMap((ns) => [
      { role: 'cell', name: ns, text: ns, visible: true, enabled: true },
      { role: 'button', name: `删除 ${ns}`, text: `删除 ${ns}`, visible: true, enabled: true },
    ]);

  const pages: Record<string, VirtualElementLike[]> = {
    [url]: [
      { role: 'button', name: '新建命名空间', text: '新建命名空间', visible: true, enabled: true },
      { role: 'textbox', name: '名称', value: '', visible: true, enabled: true },
      { role: 'button', name: '提交', text: '提交', visible: true, enabled: true },
      ...rowsOf(['demo-a', 'demo-b']),
      { role: 'button', name: '批量操作', text: '批量操作', visible: true, enabled: true },
      { role: 'button', name: '批量操作', text: '批量操作', visible: true, enabled: true },
      { role: 'button', name: '确认删除', text: '确认删除', visible: false, enabled: true },
    ],
  };

  const clickEffects: Record<string, (engine: VirtualConsoleEngine, elementName?: string) => void> = {
    提交: (engine) => {
      const page = engine.pages[url]!;
      const input = page.find((el) => el.role === 'textbox' && el.name === '名称');
      const value = (input?.value ?? '').trim();
      if (value !== '' && !page.some((el) => el.role === 'cell' && el.name === value)) {
        page.push(
          { role: 'cell', name: value, text: value, visible: true, enabled: true },
          { role: 'button', name: `删除 ${value}`, text: `删除 ${value}`, visible: true, enabled: true },
        );
      }
    },
    确认删除: () => undefined, // 由下方按 pendingDelete 闭包重写
  };

  // 删除 → 确认的两段式：任意「删除 X」按钮（含动态新建行）→ pendingDelete=X、
  // 确认弹层可见；确认后移除该行并隐藏弹层。
  // ★ 效果一律读写 engine.pages（harness 经 setPage 装载的是克隆副本，
  //   闭包里的 pages 仅是初始模板）；「删除 X」走 '*' 通配（按钮名动态）。
  let pendingDelete: string | null = null;
  clickEffects['*'] = (engine, elementName) => {
    const m = elementName !== undefined ? /^删除 (.+)$/.exec(elementName) : null;
    if (!m) return;
    pendingDelete = m[1]!;
    const confirm = engine.pages[url]!.find((el) => el.name === '确认删除');
    if (confirm) confirm.visible = true;
  };
  clickEffects['确认删除'] = (engine) => {
    const page = engine.pages[url]!;
    if (pendingDelete !== null) {
      const idx = page.findIndex((el) => el.name === `删除 ${pendingDelete}`);
      if (idx >= 0) {
        // 同时移除该行的 cell（其位于删除按钮前一位）。
        page.splice(idx - 1, 2);
      }
      pendingDelete = null;
    }
    const confirm = page.find((el) => el.name === '确认删除');
    if (confirm) confirm.visible = false;
  };

  return { pages, clickEffects };
}

/* ── Reference Suite 用例构建器 ────────────────────────────────────────── */

/**
 * 命名空间生命周期（Reference Suite 核心路径）：
 * navigate → 新建 → 填名 → 提交（postcondition: 行可见）→ 删除 → 确认（postcondition: 行消失）。
 * skipCreate=true 时退化为删除预置行 demo-a（A4/A6/A7/A11 的短用例）。
 */
export function buildNamespaceLifecycleCase(
  ns: string,
  opts: { origin: string; skipCreate?: boolean },
): ExecutorCase {
  const { origin, skipCreate = false } = opts;
  const navigate = {
    intent: '打开命名空间列表',
    action: 'navigate' as const,
    risk: 'reversible' as const,
    url: `${origin}/console/namespaces`,
  };
  if (skipCreate) {
    return {
      id: `k8s.ns-delete.${ns}`,
      steps: [
        navigate,
        { intent: `删除 ${ns}`, action: 'click', risk: 'irreversible' as const, target: deleteButtonTarget(ns) },
        {
          intent: '确认删除',
          action: 'click',
          risk: 'irreversible' as const,
          target: { ...K8S_TARGETS.confirmDelete },
          // Provider 级断言 target 是 SemanticTarget（对象形态；字符串形态仅 judge 层）。
          postcondition: [{ kind: 'absent', target: { role: 'cell', name: ns, match: 'exact' as const } }],
        },
      ],
    };
  }
  return {
    id: `k8s.ns-lifecycle.${ns}`,
    steps: [
      navigate,
      { intent: '新建命名空间', action: 'click', risk: 'reversible' as const, target: { ...K8S_TARGETS.newNamespace } },
      { intent: '填写名称', action: 'fill', risk: 'reversible' as const, target: { ...K8S_TARGETS.nameInput }, value: ns },
      {
        intent: '提交创建',
        action: 'click',
        risk: 'reversible' as const,
        target: { ...K8S_TARGETS.submit },
        postcondition: [{ kind: 'visible', target: { role: 'cell', name: ns, match: 'exact' as const } }],
      },
      { intent: `删除 ${ns}`, action: 'click', risk: 'irreversible' as const, target: deleteButtonTarget(ns) },
      {
        intent: '确认删除',
        action: 'click',
        risk: 'irreversible' as const,
        target: { ...K8S_TARGETS.confirmDelete },
        postcondition: [{ kind: 'absent', target: { role: 'cell', name: ns, match: 'exact' as const } }],
      },
    ],
  };
}

/** A3 歧义探针用例：目标在页面上有多条匹配 → 歧义短路，绝不取第一个。 */
export function buildAmbiguousRowCase(origin: string): ExecutorCase {
  return {
    id: 'k8s.ambiguity.batch-action',
    steps: [
      { intent: '打开命名空间列表', action: 'navigate', risk: 'reversible' as const, url: `${origin}/console/namespaces` },
      { intent: '批量操作', action: 'click', risk: 'reversible' as const, target: { ...K8S_TARGETS.duplicateRow } },
    ],
  };
}
