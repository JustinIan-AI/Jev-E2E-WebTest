/**
 * Contract 文件加载器：YAML / JSON 读取、解析 + 九条校验。
 * 加载或校验失败统一抛 ContractConfigError，由 CLI 映射为 exit 3。
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  validateContract,
  type ContractViolation,
  type ValidateContractOptions,
} from './validate.js';

export class ContractConfigError extends Error {
  readonly filePath: string;
  readonly violations: ContractViolation[];

  constructor(message: string, filePath: string, violations: ContractViolation[] = []) {
    super(message);
    this.name = 'ContractConfigError';
    this.filePath = filePath;
    this.violations = violations;
  }
}

export interface LoadedContract {
  /** 文件绝对路径。 */
  filePath: string;
  /** 解析后的 Contract 原文（模板未替换；实例值在 run 启动时另存）。 */
  contract: Record<string, unknown>;
  /** Contract id（test.id）。 */
  id: string;
  sourceFormat: 'yaml' | 'json';
}

/**
 * 从磁盘加载 Contract 并立即执行九条校验。
 * @param options 批次唯一性、运行上下文等校验选项。
 */
export async function loadContractFile(
  filePath: string,
  options: ValidateContractOptions = {},
): Promise<LoadedContract> {
  const extension = extname(filePath).toLowerCase();
  if (extension !== '.yaml' && extension !== '.yml' && extension !== '.json') {
    throw new ContractConfigError(
      `不支持的 Contract 文件类型 '${extension}'，仅支持 .yaml/.yml/.json`,
      filePath,
    );
  }

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    throw new ContractConfigError(`Contract 文件无法读取：${filePath}`, filePath);
  }

  let parsed: unknown;
  try {
    parsed = extension === '.json' ? JSON.parse(raw) : parseYaml(raw);
  } catch (cause) {
    throw new ContractConfigError(
      `Contract 解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
      filePath,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ContractConfigError('Contract 顶层必须是对象（mapping）', filePath);
  }

  const result = validateContract(parsed, options);
  if (!result.valid) {
    const first = result.violations[0];
    throw new ContractConfigError(
      `Contract 校验未通过（${result.violations.length} 条违规）：${first?.rule ?? ''} ${first?.message ?? ''}`,
      filePath,
      result.violations,
    );
  }

  const contract = parsed as Record<string, unknown>;
  const test = contract.test;
  const id =
    typeof test === 'object' && test !== null && 'id' in test && typeof test.id === 'string'
      ? test.id
      : '';

  return {
    filePath,
    contract,
    id,
    sourceFormat: extension === '.json' ? 'json' : 'yaml',
  };
}
