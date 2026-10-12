/**
 * Contract 九条编程式校验（详设 §3.1）。
 * JSON Schema 负责结构；本模块负责 Schema 表达不了的语义规则。
 * 任一违规都属于配置错误，由 CLI 映射为 exit 3（CONFIG_ERROR）。
 */
import { validate as validateSchema } from '../../schema/loader.js';

export const RULE_IDS = [
  'R1-required',
  'R2-no-assertions',
  'R3-credential-literal',
  'R4-irreversible-postcondition',
  'R5-action-set',
  'R6-assertion-primitive',
  'R7-no-selector',
  'R8-id-unique',
  'R9-within-run-window',
  'schema',
] as const;

export interface ContractViolation {
  /** 规则编号，如 R3-credential-literal；结构类问题为 schema。 */
  rule: (typeof RULE_IDS)[number];
  /** 违规定位（点路径），如 steps[0].target。 */
  path: string;
  message: string;
}

export interface ValidateContractOptions {
  /** 批次内已加载的 Contract id，用于规则 8 唯一性。 */
  knownIds?: readonly string[];
  /**
   * 运行期上下文（run 启动校验时传入）。
   * 静态 `validate`（未启动 run）不传本项：run_started_at 由 runner 启动时注入。
   */
  runtimeContext?: {
    runStartedAt?: string;
  };
}

export interface ValidateContractResult {
  valid: boolean;
  violations: ContractViolation[];
  /** 配置错误类别，CLI 据此映射 exit 3。 */
  errorCategory?: 'config';
}

const CLOSED_ACTIONS = ['click', 'fill', 'select', 'scroll', 'wait', 'navigate', 'assert_only'];
const DOM_PRIMITIVES = ['visible', 'absent', 'count', 'value', 'checked', 'url', 'number'];
const ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/;
/** 规则 3：凭据相关键名（jev-e2e 已验证的字面量集合）。 */
const CREDENTIAL_KEY_PATTERN = /password|secret|token|api.?key|email/i;
/** 规则 7：CSS/XPath/JS 语法特征。 */
const SELECTOR_TOKENS = ['#', '.', '//', '>>', '()'];
const REF_PREFIXES = ['cred://', '@fixture'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 规则 3：递归扫描凭据字面量。
 * 键名命中敏感正则、值为非空字符串且不是 cred:// / @fixture 引用即违规。
 */
function findCredentialLiterals(
  node: unknown,
  path: string,
  out: ContractViolation[],
  seen: WeakSet<object>,
): void {
  if (Array.isArray(node)) {
    if (seen.has(node)) return;
    seen.add(node);
    node.forEach((item, i) => findCredentialLiterals(item, `${path}[${i}]`, out, seen));
    return;
  }
  if (!isRecord(node)) return;
  if (seen.has(node)) return;
  seen.add(node);
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (CREDENTIAL_KEY_PATTERN.test(key) && isNonEmptyString(value)) {
      const isRef = REF_PREFIXES.some((prefix) => value.startsWith(prefix));
      if (!isRef) {
        out.push({
          rule: 'R3-credential-literal',
          path: childPath,
          message: `凭据必须通过 credentials_ref（cred://）或 @fixture 引用，禁止字面量写入字段 '${key}'`,
        });
      }
    }
    findCredentialLiterals(value, childPath, out, seen);
  }
}

/** 规则 7：target 禁 CSS/XPath/JS 特征。 */
function checkTarget(target: unknown, path: string, out: ContractViolation[]): void {
  if (typeof target !== 'string' || target.length === 0) return;
  const hit = SELECTOR_TOKENS.find((token) => target.includes(token));
  if (hit) {
    out.push({
      rule: 'R7-no-selector',
      path,
      message: `target 必须是语义目标，禁止 CSS/XPath/JS 特征 '${hit}'：${target}`,
    });
  }
}

/**
 * 对 Contract 执行九条语义校验 + JSON Schema 结构校验。
 */
export function validateContract(
  contract: unknown,
  options: ValidateContractOptions = {},
): ValidateContractResult {
  const violations: ContractViolation[] = [];
  const root = isRecord(contract) ? contract : {};
  const knownIds = options.knownIds ?? [];

  // 规则 1：必需字段 goal / assertions / environment.base_url / identity.credentials_ref
  if (!isNonEmptyString(root.goal)) {
    violations.push({ rule: 'R1-required', path: 'goal', message: 'goal 为必需字段且非空' });
  }
  const environment = isRecord(root.environment) ? root.environment : undefined;
  if (!environment || !isNonEmptyString(environment.base_url)) {
    violations.push({
      rule: 'R1-required',
      path: 'environment.base_url',
      message: 'environment.base_url 为必需字段',
    });
  }
  const identity = isRecord(root.identity) ? root.identity : undefined;
  if (!identity || !isNonEmptyString(identity.credentials_ref)) {
    violations.push({
      rule: 'R1-required',
      path: 'identity.credentials_ref',
      message: 'identity.credentials_ref 为必需字段',
    });
  }
  if (!isRecord(root.assertions)) {
    violations.push({
      rule: 'R1-required',
      path: 'assertions',
      message: 'assertions 为必需字段（dom/http/backend/state 四类至少一项）',
    });
  }

  const assertions = isRecord(root.assertions) ? root.assertions : {};
  const domAssertions = asArray(assertions.dom);
  const httpAssertions = asArray(assertions.http);
  const backendAssertions = asArray(assertions.backend);
  const stateAssertions = asArray(assertions.state);

  // 规则 2：无断言拒绝执行（runner 不自创正确性标准）
  const hasAnyAssertion =
    domAssertions.length + httpAssertions.length + backendAssertions.length + stateAssertions.length > 0;
  if (!hasAnyAssertion) {
    violations.push({
      rule: 'R2-no-assertions',
      path: 'assertions',
      message: 'Contract 必须声明至少一条断言，空断言契约拒绝执行',
    });
  }

  // 规则 3：凭据字面量
  findCredentialLiterals(contract, '', violations, new WeakSet());

  // 规则 4 / 5 / 7（steps）
  const steps = asArray(root.steps);
  steps.forEach((step, i) => {
    const s = isRecord(step) ? step : {};
    const stepPath = `steps[${i}]`;

    if (!CLOSED_ACTIONS.includes(s.action as string)) {
      violations.push({
        rule: 'R5-action-set',
        path: `${stepPath}.action`,
        message: `action '${String(s.action)}' 不在封闭动作集：${CLOSED_ACTIONS.join('/')}`,
      });
    }

    if (s.risk === 'irreversible') {
      if (!Array.isArray(s.postcondition) || s.postcondition.length === 0) {
        violations.push({
          rule: 'R4-irreversible-postcondition',
          path: `${stepPath}.postcondition`,
          message: 'risk=irreversible 的步骤必须声明非空 postcondition（防 Recovery False Positive 逃逸）',
        });
      }
    }

    checkTarget(s.target, `${stepPath}.target`, violations);

    for (const [j, rawPost] of asArray(s.postcondition).entries()) {
      const post = isRecord(rawPost) ? rawPost : {};
      checkTarget(post.target, `${stepPath}.postcondition[${j}].target`, violations);
    }
  });

  // 规则 6 / 7（dom 断言）
  domAssertions.forEach((rawAssertion, i) => {
    const assertion = isRecord(rawAssertion) ? rawAssertion : {};
    if (!DOM_PRIMITIVES.includes(assertion.kind as string)) {
      violations.push({
        rule: 'R6-assertion-primitive',
        path: `assertions.dom[${i}].kind`,
        message: `DOM 断言 kind '${String(assertion.kind)}' 不在 7 个封闭原语：${DOM_PRIMITIVES.join('/')}`,
      });
    }
    checkTarget(assertion.target, `assertions.dom[${i}].target`, violations);
  });

  // 规则 8：id kebab-case 且批次内唯一
  const testMeta = isRecord(root.test) ? root.test : {};
  const id = typeof testMeta.id === 'string' ? testMeta.id : '';
  if (!ID_PATTERN.test(id)) {
    violations.push({
      rule: 'R8-id-unique',
      path: 'test.id',
      message: `test.id '${id}' 必须为 kebab-case（小写字母开头，点分段），如 workload.create`,
    });
  } else if (knownIds.includes(id)) {
    violations.push({
      rule: 'R8-id-unique',
      path: 'test.id',
      message: `test.id '${id}' 在本批次内重复`,
    });
  }

  // 规则 9：http.within_run=true 需要 run_started_at 注入点
  // 未传 runtimeContext 表示静态校验（run 尚未启动），注入点由 runner 保证，不判违规。
  const hasWithinRun = httpAssertions.some(
    (item) => isRecord(item) && item.within_run === true,
  );
  if (hasWithinRun && options.runtimeContext !== undefined) {
    if (!isNonEmptyString(options.runtimeContext.runStartedAt)) {
      violations.push({
        rule: 'R9-within-run-window',
        path: 'assertions.http',
        message: '存在 within_run=true 的 HTTP 断言，但运行上下文缺少 run_started_at，时间窗无法建立',
      });
    }
  }

  // JSON Schema 结构校验（规则 1/4/5/6/8 的结构化部分在此兜底）
  const schemaResult = validateSchema('contract', contract);
  if (!schemaResult.valid) {
    for (const error of schemaResult.errors ?? []) {
      violations.push({
        rule: 'schema',
        path: error,
        message: error,
      });
    }
  }

  if (violations.length === 0) {
    return { valid: true, violations: [] };
  }
  return { valid: false, violations, errorCategory: 'config' };
}
