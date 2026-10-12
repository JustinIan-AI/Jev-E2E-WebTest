/**
 * Task 12 —— Mock Decision Provider（DD §7.4：CI 无密钥环境必须支持）。
 *
 * 完全离线、确定性、零依赖：不持有任何 endpoint/apiKey；
 * 记录全部请求/应答供 TR-12.2 调用审计（decideCalls / requests / responses）。
 */
import type {
  ChoiceAnswer,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  JevDecisionProvider,
} from './types.js';

export type MockDecisionHandler = (
  request: DecisionRequest,
  callIndex: number,
) => { answers: Record<string, ChoiceAnswer>; usage?: DecisionUsage; latency_ms?: number };

export class MockDecisionProvider implements JevDecisionProvider {
  readonly id = 'mock';

  /** 审计：decide 被调用的次数（确定性路径必须为 0）。 */
  decideCalls = 0;
  readonly requests: DecisionRequest[] = [];
  readonly responses: DecisionResponse[] = [];

  constructor(private readonly handler: MockDecisionHandler) {}

  async decide(input: DecisionRequest): Promise<DecisionResponse> {
    const callIndex = this.decideCalls;
    this.decideCalls += 1;
    this.requests.push(input);
    const out = this.handler(input, callIndex);
    const response: DecisionResponse = {
      answers: out.answers,
      latency_ms: out.latency_ms ?? 0,
      ...(out.usage ? { usage: out.usage } : {}),
    };
    this.responses.push(response);
    return response;
  }

  /** 最坏情况成本估计：候选项总数（预算预留演示/测试用）。 */
  estimateCost(input: DecisionRequest): number {
    return Object.values(input.questions).reduce((acc, q) => acc + q.choices.length, 0);
  }
}
