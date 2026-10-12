/**
 * Task 12 —— L3 决策预算（DD §7.4）。
 *
 * max_requests / max_cost 每 run；发请求前按最坏情况预留额度
 * （reserve 成功才允许发起 decide；失败 → 零请求零派发 BLOCKED(decision)）。
 * 预留即消耗（失败/异常的请求同样计入），保守不回滚。
 */

export interface DecisionBudgetSpec {
  maxRequests?: number;
  maxCost?: number;
}

export interface DecisionBudgetSnapshot {
  usedRequests: number;
  usedCost: number;
}

export interface DecisionBudget {
  /**
   * 发请求前预留最坏情况额度。
   * @returns false 表示额度不足——调用方绝不能发起请求。
   */
  reserve(requests: number, cost: number): boolean;
  snapshot(): DecisionBudgetSnapshot;
}

export function createDecisionBudget(spec: DecisionBudgetSpec): DecisionBudget {
  let usedRequests = 0;
  let usedCost = 0;

  return {
    reserve(requests: number, cost: number): boolean {
      const nextRequests = usedRequests + requests;
      const nextCost = usedCost + cost;
      if (spec.maxRequests !== undefined && nextRequests > spec.maxRequests) return false;
      if (spec.maxCost !== undefined && nextCost > spec.maxCost) return false;
      usedRequests = nextRequests;
      usedCost = nextCost;
      return true;
    },
    snapshot(): DecisionBudgetSnapshot {
      return { usedRequests, usedCost };
    },
  };
}
