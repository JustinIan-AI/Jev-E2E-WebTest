/**
 * Task 14 —— e2e EngineProvider 适配器（DD §5.0 默认实现位，id: 'e2e'）。
 *
 * 基于 @e2e-dev/web（引擎）+ @e2e-dev/decision（决策 transport）的契约形状
 * （./upstream.ts，实例经 connect({ engine }) 注入）。四条硬约束写进实现：
 *
 *  ① 恢复触发权（DD-36）：connect 时**显式关闭**上游 autoHeal/autoRetry，
 *    并以 getConfig 回读校验；上游拒绝关闭 → fail-closed 抛错拒绝启动。
 *    之后引擎失败只作为 ActionResult 返回，是否恢复由 Runtime 依 §8.2/§8.3 判定。
 *  ② 错误码吸附（DD-32）：checkAssertion 一律经过 error-adapter ——
 *    ASSERTION_INCONCLUSIVE → inconclusive/decision + upstream_error_code（A10）。
 *  ③ 候选集编号由我们掌控：上游只提供元素表；ObservedElement.id 与
 *    ResolveResult.elementId 都是 adapter 侧编号，派发时经 registry 回译上游 id。
 *  ④ version 必须回传（getVersion，非空），参与六重绑定第⑥项。
 *
 * L2 指纹说明：上游元素表为扁平结构、无法提供 DOM 路径，指纹三件套无法诚实
 * 匹配 —— 依「误命中比不命中更危险」，L2 一律 miss（不伪造命中）。真实上游
 * 提供 DOM 路径后再启用（Task 17 对照时复核）。
 */
import { createHash } from 'node:crypto';
import type {
  Action,
  ActionResult,
  ArtifactRef,
  AssertionKind,
  AssertionResult,
  AssertionSpec,
  EngineProvider,
  ObservedElement,
  Observation,
  ResolveMode,
  ResolveResult,
  ResolvedTarget,
  SemanticTarget,
  ScreenshotOptions,
} from '../types.js';
import { absorbUpstreamAssertion } from './error-adapter.js';
import type {
  UpstreamE2eEngine,
  UpstreamE2eEngineConfig,
  UpstreamLocateRequest,
} from './upstream.js';

export interface E2eProviderConnectOptions {
  /** 上游引擎实例（@e2e-dev/web 契约形状）。 */
  engine: UpstreamE2eEngine;
  originsAllowlist?: string[];
}

function sha1(payload: string): string {
  return `sha1:${createHash('sha1').update(payload, 'utf8').digest('hex')}`;
}

function isOriginAllowed(url: string, allowlist: string[]): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return allowlist.some((allowed) => {
    try {
      return origin === new URL(allowed).origin;
    } catch {
      return false;
    }
  });
}

export class E2eProvider implements EngineProvider {
  readonly id = 'e2e';
  readonly version: string;

  private readonly engine: UpstreamE2eEngine;
  private readonly allowlist: string[];
  /** ③ adapter 侧编号 → 上游 elementId 回译表（编号绝不来自上游/模型）。 */
  private readonly idRegistry = new Map<number, string | number>();
  private nextId = 0;
  private observationSeq = 0;
  private artifactSeq = 0;
  private disposed = false;

  private constructor(engine: UpstreamE2eEngine, allowlist: string[], version: string) {
    this.engine = engine;
    this.allowlist = allowlist;
    this.version = version;
  }

  static connect(options: E2eProviderConnectOptions): E2eProvider {
    const { engine } = options;

    // ④ version 必须回传：六重绑定第⑥项无法计算即拒绝启动。
    const version = engine.getVersion();
    if (typeof version !== 'string' || version.trim() === '') {
      throw new Error(
        'upstream e2e engine did not report a version; engine_provider_version (binding item ⑥) cannot be computed',
      );
    }

    // ① DD-36：显式关闭上游自动恢复，并回读校验（fail-closed）。
    const disable: Partial<UpstreamE2eEngineConfig> = { autoHeal: false, autoRetry: false };
    engine.configure(disable);
    const config = engine.getConfig();
    if (config.autoHeal !== false || config.autoRetry !== false) {
      throw new Error(
        'upstream e2e engine refused to disable auto heal/retry; recovery authority (DD-36) cannot be ceded to the engine',
      );
    }

    return new E2eProvider(engine, options.originsAllowlist ?? [], version);
  }

  /** ③ 登记并返回 adapter 侧编号。 */
  private register(upstreamId: string | number): number {
    const id = this.nextId++;
    this.idRegistry.set(id, upstreamId);
    return id;
  }

  private upstreamIdOf(localId: string | number | undefined): string | number | undefined {
    if (localId === undefined) return undefined;
    return this.idRegistry.get(Number(localId)) ?? localId;
  }

  async observe(): Promise<Observation> {
    const upstream = await this.engine.observe();
    this.observationSeq += 1;
    const elements: ObservedElement[] = upstream.elements.map((el, index) => ({
      id: index,
      role: el.role,
      name: el.name,
      text: el.text ?? el.name,
      visible: el.visible,
      enabled: el.enabled,
      guard: sha1(`guard:${index}:${el.role}:${el.name}:${el.text ?? ''}`),
    }));
    // 上游元素表顺序即 adapter 编号（③）：登记本次观测的回译表。
    this.idRegistry.clear();
    this.nextId = 0;
    for (const el of upstream.elements) {
      this.register(el.elementId);
    }
    return {
      observationId: `obs-${this.observationSeq}`,
      fingerprint: sha1(
        JSON.stringify({ url: upstream.url, title: upstream.title, elements }),
      ),
      url: upstream.url,
      title: upstream.title,
      elements,
      textExcerpt: elements.map((el) => el.text).join('\n').slice(0, 4000),
    };
  }

  async resolve(target: SemanticTarget, mode: ResolveMode): Promise<ResolveResult> {
    if (mode === 'L3') {
      // ③ L3 候选枚举：本层代码对上游元素表做模糊语义匹配，编号由 adapter 分配；
      // 绝不返回 resolved（语义决策只能由编排层发起）。
      const obs = await this.observe();
      const wanted = [target.name, target.text]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .map((v) => v.toLowerCase());
      // 候选附带语义提示（L3CandidateHint 形状，runtime/resolve-l3 消费）。
      const candidates: Array<ResolvedTarget & { role?: string; name?: string; text?: string }> = [];
      if (wanted.length > 0) {
        for (const el of obs.elements) {
          const roleOk = target.role === undefined || el.role === target.role;
          if (!roleOk) continue;
          const haystack = `${el.name}\n${el.text}`.toLowerCase();
          if (!wanted.some((w) => haystack.includes(w))) continue;
          candidates.push({
            elementId: el.id,
            strategy: 'model',
            role: el.role,
            name: el.name,
            text: el.text,
          });
        }
      }
      return { status: 'miss', candidates };
    }

    if (mode === 'L2') {
      // 指纹三件套含 dom_path_hash，上游扁平元素表无法诚实比对 → 一律 miss
      // （误命中比不命中更危险；真实上游提供 DOM 路径后启用）。
      return { status: 'miss' };
    }

    // Issue #25：多通道按序定位（role > label > name > placeholder > text）。
    const located = await this.locateByChannels(target);
    switch (located.status) {
      case 'resolved':
        return {
          status: 'resolved',
          mode: 'L1',
          elementId: this.register(located.elementId),
          strategy: located.strategy,
        };
      case 'missing':
        return { status: 'miss' };
      case 'ambiguous':
        return { status: 'ambiguous', count: located.count };
    }
  }

  async act(action: Action): Promise<ActionResult> {
    if (this.disposed) {
      return { kind: action.kind, status: 'error', dispatched: false, message: 'provider disposed' };
    }

    if (action.kind === 'navigate') {
      if (!isOriginAllowed(action.url, this.allowlist)) {
        return { kind: 'navigate', status: 'nav_blocked', dispatched: false, url: action.url };
      }
      return this.mapActionResult(action.kind, await this.engine.execute({
        kind: 'navigate',
        url: action.url,
      }));
    }

    if (action.kind === 'click' || action.kind === 'fill' || action.kind === 'select') {
      return this.mapActionResult(action.kind, await this.engine.execute({
        kind: action.kind,
        elementId: this.upstreamIdOf(action.target.elementId)!,
        ...(action.kind === 'click' ? {} : { value: action.value }),
      }));
    }

    return this.mapActionResult(action.kind, await this.engine.execute({
      kind: action.kind,
      ...(action.kind === 'scroll' ? { deltaY: action.deltaY } : {}),
      ...(action.kind === 'wait' ? { ms: action.ms } : {}),
    }));
  }

  /** 上游 8 态 → IDWTH 8 态（missing→not_found、blocked→nav_blocked，其余同名）。 */
  private mapActionResult(kind: Action['kind'], upstream: {
    status: string;
    dispatched: boolean;
    message?: string;
    blockedUrl?: string;
  }): ActionResult {
    const status =
      upstream.status === 'missing'
        ? 'not_found'
        : upstream.status === 'blocked'
          ? 'nav_blocked'
          : upstream.status;
    const base = {
      kind,
      status: status as ActionResult['status'],
      dispatched: upstream.dispatched,
      ...(upstream.message !== undefined ? { message: upstream.message } : {}),
    };
    if (status === 'nav_blocked') {
      return { ...base, status: 'nav_blocked', ...(upstream.blockedUrl ? { url: upstream.blockedUrl } : {}) } as ActionResult;
    }
    return base as ActionResult;
  }

  async checkAssertion(spec: AssertionSpec): Promise<AssertionResult> {
    // ② 一律经过吸附器：ASSERTION_INCONCLUSIVE 永不沿用上游的 failed class。
    const upstream = await this.engine.assert({
      kind: spec.kind as Exclude<AssertionKind, 'http' | 'backend' | 'state'>,
      ...(spec.target?.role !== undefined ? { role: spec.target.role } : {}),
      ...(spec.target?.name !== undefined ? { name: spec.target.name } : {}),
      ...(spec.target?.name === undefined && spec.target?.text !== undefined
        ? { text: spec.target.text }
        : {}),
      match: spec.target?.match ?? 'exact',
      ...(spec.expected !== undefined ? { expected: spec.expected } : {}),
      ...(spec.allow_multiple !== undefined ? { allowMultiple: spec.allow_multiple } : {}),
    });
    return absorbUpstreamAssertion(upstream, spec.kind);
  }

  async screenshot(options: ScreenshotOptions): Promise<ArtifactRef> {
    const upstream = await this.engine.screenshot({ mask: options.mask });
    this.artifactSeq += 1;
    return {
      uri: `artifact://e2e/screenshot-${this.artifactSeq}.png`,
      mediaType: upstream.mimeType,
      contentBase64: upstream.data,
    };
  }

  async trace(): Promise<ArtifactRef> {
    const upstream = await this.engine.trace();
    this.artifactSeq += 1;
    return {
      uri: `artifact://e2e/trace-${this.artifactSeq}.zip`,
      mediaType: upstream.mimeType,
      contentBase64: upstream.data,
    };
  }

  /**
   * Issue #25：多通道按序定位（role > label > name > placeholder > text）。
   *
   * - 每通道独立查询上游 `locate`；命中即停（先具体后宽泛）；
   * - **某通道命中多个 → ambiguous 立即返回**：铁律 6——目标歧义即 BLOCKED，
   *   既不取第一个，也不换通道绕过歧义（换通道=静默改变语义）；
   * - 全部通道 missing → miss（上层 BLOCKED(decision)）；
   * - 空目标（所有通道字段都缺省）不查询：无字段的 locate 会命中全部元素。
   *
   * label/name 都走上游 `name`（可访问名）通道——label 关联的 input 其可访问名
   * 就是 label 文本；placeholder 走上游可选能力，未实现时返回 missing 安全退化。
   */
  private async locateByChannels(
    target: SemanticTarget,
  ): Promise<
    | { status: 'resolved'; elementId: string | number; strategy: ResolvedTarget['strategy'] }
    | { status: 'ambiguous'; count: number }
    | { status: 'missing' }
  > {
    const match = target.match ?? 'exact';
    const queries: Array<{
      query: UpstreamLocateRequest;
      strategy: ResolvedTarget['strategy'];
    }> = [];
    const seen = new Set<string>();
    const push = (query: UpstreamLocateRequest, strategy: ResolvedTarget['strategy']): void => {
      const key = JSON.stringify(query);
      if (seen.has(key)) return;
      seen.add(key);
      queries.push({ query, strategy });
    };

    if (target.role !== undefined) {
      const named = target.name ?? target.label ?? target.text;
      push({ role: target.role, ...(named !== undefined ? { name: named } : {}), match }, 'role');
    }
    if (target.label !== undefined) push({ name: target.label, match }, 'label');
    if (target.name !== undefined) push({ name: target.name, match }, 'label');
    if (target.placeholder !== undefined) push({ placeholder: target.placeholder, match }, 'placeholder');
    if (target.text !== undefined) push({ text: target.text, match }, 'text');

    if (queries.length === 0) return { status: 'missing' };

    for (const { query, strategy } of queries) {
      const located = await this.engine.locate(query);
      if (located.status === 'found') {
        return { status: 'resolved', elementId: located.elementId!, strategy };
      }
      if (located.status === 'ambiguous') {
        return { status: 'ambiguous', count: located.count ?? 0 };
      }
    }
    return { status: 'missing' };
  }

  /**
   * Freshness（Runtime 要求的能力）：对目标重新定位，命中同一上游元素才算新鲜。
   * 定位未命中 / 命中不同元素 → 不新鲜（drift 由 Runtime 统一处置）。
   * Issue #25：与 resolve 共用同一多通道逻辑，避免「resolve 走 label 通道、
   * freshness 只走 text 通道」造成的 drift 假阳性。
   */
  async verifyFreshness(
    target: SemanticTarget,
    resolved: ResolveResult,
  ): Promise<boolean> {
    const expected = this.upstreamIdOf(resolved.elementId);
    if (expected === undefined) return false;
    const located = await this.locateByChannels(target);
    return (
      located.status === 'resolved' && String(located.elementId) === String(expected)
    );
  }

  /** ★ 只断连：dispose 上游引擎实例；幂等。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.engine.dispose();
  }
}
