/**
 * 六重绑定哈希与版本计算（详设 §3.7）。
 * ① contract_hash ② strategy_hash ③ judge_impl_hash
 * ④ runner_version ⑤ env_fingerprint ⑥ engine_provider_version
 */
import { createHash } from 'node:crypto';

export type BindingKey =
  | 'contract_hash'
  | 'strategy_hash'
  | 'judge_impl_hash'
  | 'runner_version'
  | 'env_fingerprint'
  | 'engine_provider_version';

export interface Bindings {
  contract_hash: string;
  strategy_hash: string;
  judge_impl_hash: string;
  runner_version: string;
  env_fingerprint: string;
  engine_provider_version: string;
}

/** ⑤ 环境指纹输入：浏览器版本 + 目标域 + 时区/locale。 */
export interface BindingEnv {
  browserVersion: string;
  targetOrigin: string;
  timezone: string;
  locale: string;
}

export interface BindingCheckInput {
  contract: unknown;
  /** Strategy 固化文件内容（含 flows；不含 bindings 自身，避免自引用）。 */
  strategyContent: unknown;
  /** Judge 判定实现源码（参与 verdict_hash 组成）。 */
  judgeImplSource: string;
  /** ④ 自有 Runtime 与工具层版本。 */
  runnerVersion: string;
  env: BindingEnv;
  /** ⑥ 外购执行引擎版本。 */
  engineProviderVersion: string;
}

function sha256Hex(payload: string): string {
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

/**
 * 规范化 JSON：对象键按字典序递归排序后序列化。
 * 键顺序与无关空白不得改变哈希，保证跨加载方式一致。
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}

export function hashContract(contract: unknown): string {
  return sha256Hex(canonicalize(contract));
}

export function hashStrategyContent(strategyContent: unknown): string {
  return sha256Hex(canonicalize(strategyContent));
}

export function hashJudgeImpl(source: string): string {
  // 行尾/尾随空白归一化，避免跨检出平台差异；语义变更仍会改变哈希。
  const normalized = source.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  return sha256Hex(normalized);
}

export function computeEnvFingerprint(env: BindingEnv): string {
  return sha256Hex(
    canonicalize({
      browserVersion: env.browserVersion,
      targetOrigin: env.targetOrigin,
      timezone: env.timezone,
      locale: env.locale,
    }),
  );
}

/** 计算当前环境下的完整六重绑定。 */
export function computeBindings(input: BindingCheckInput): Bindings {
  return {
    contract_hash: hashContract(input.contract),
    strategy_hash: hashStrategyContent(input.strategyContent),
    judge_impl_hash: hashJudgeImpl(input.judgeImplSource),
    runner_version: input.runnerVersion,
    env_fingerprint: computeEnvFingerprint(input.env),
    engine_provider_version: input.engineProviderVersion,
  };
}

export const BINDING_KEYS: readonly BindingKey[] = [
  'contract_hash',
  'strategy_hash',
  'judge_impl_hash',
  'runner_version',
  'env_fingerprint',
  'engine_provider_version',
];
