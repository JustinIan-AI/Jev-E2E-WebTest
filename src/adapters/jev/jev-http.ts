/**
 * Task 12 —— TypeSafe JEV HTTP Adapter（DD §7.1/§7.4 默认实现形态）。
 *
 * 职责限定在传输层：构造请求、计时 latency、透传 usage、对响应做最小结构
 * 收口（answers 记录 + choice/confidence 数值）。完整合法性校验一律由
 * validate.ts 在编排层执行（本模块绝不自行放行动作）。
 * fetch 可注入（测试零网络）；错误统一收口为 JevTransportError。
 */
import type {
  ChoiceAnswer,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  JevDecisionProvider,
} from './types.js';

export interface JevHttpOptions {
  endpoint: string;
  apiKey?: string;
  model?: string;
  /** 单次请求超时；超时/网络异常 → JevTransportError（绝不自动重试）。 */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  id?: string;
}

export class JevTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JevTransportError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class TypeSafeJevProvider implements JevDecisionProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: JevHttpOptions) {
    this.id = options.id ?? 'typesafe-jev';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide(input: DecisionRequest): Promise<DecisionResponse> {
    const startedAt = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(this.options.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            ...(this.options.model ? { model: this.options.model } : {}),
            state: input.state,
            questions: input.questions,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new JevTransportError(
          `JEV request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!res.ok) throw new JevTransportError(`JEV HTTP ${res.status}`);

      const json: unknown = await res.json().catch(() => {
        throw new JevTransportError('JEV response is not valid JSON');
      });
      if (!isPlainObject(json) || !isPlainObject(json.answers)) {
        throw new JevTransportError('malformed JEV response: missing answers record');
      }

      const answers: Record<string, ChoiceAnswer> = {};
      for (const [qid, raw] of Object.entries(json.answers)) {
        if (
          !isPlainObject(raw) ||
          typeof raw.choice !== 'number' ||
          typeof raw.confidence !== 'number'
        ) {
          throw new JevTransportError(`malformed answer for question ${qid}`);
        }
        answers[qid] = raw as unknown as ChoiceAnswer;
      }

      const usage = isPlainObject(json.usage) ? (json.usage as DecisionUsage) : undefined;
      return {
        answers,
        latency_ms: Date.now() - startedAt,
        ...(usage ? { usage } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
