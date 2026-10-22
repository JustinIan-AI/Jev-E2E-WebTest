/**
 * `idwth init --from` 编排：读取 ai-testgen 产出的 .feature 文件，
 * 解析并映射为 IDWTH Contract。
 *
 * - 全部步骤可映射 → 写 <id>.contract.yaml（ready，可直接 validate/run）；
 * - 存在未映射步骤 → 写 <id>.draft.yaml（draft，含 _draft 未映射清单，人工补全）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { parseFeature } from './gherkin-parse.js';
import {
  mapFeatureToContracts,
  type Contract,
  type MappedContract,
  type MapFeatureOptions,
} from './feature-to-contract.js';
import { validateContract } from './validate.js';

export interface InitFromOptions extends MapFeatureOptions {
  /** .feature 源文件绝对/相对路径（相对调用方 cwd）。 */
  featurePath: string;
  /** 输出目录（绝对路径），通常为 <cwd>/.idwth/contracts。 */
  outDir: string;
}

export interface InitFromResult {
  /** ready 产物（相对路径由 CLI 负责展示）。 */
  readyFiles: string[];
  /** draft 产物。 */
  draftFiles: string[];
  /** 每个 draft 对应的未映射步骤条数。 */
  unmappedCounts: Record<string, number>;
}

/** ready Contract 写盘前再跑一遍九条校验，任何违规都视为映射器缺陷。 */
function assertReady(contract: Contract): void {
  const result = validateContract(contract);
  if (!result.valid) {
    const first = result.violations[0];
    throw new Error(
      `内部错误：映射产物未通过 Contract 校验 ${first?.rule ?? ''} ${first?.message ?? ''}`.trim(),
    );
  }
}

/** 按未映射原因给出可操作指引：只允许落到封闭动作集 / identity / fixtures 声明，不开放叙述。 */
const REASON_GUIDANCE: Record<string, string> = {
  'unmapped-precondition':
    '前置状态不是可执行动作，请勿改写成点击/填写等步骤；请在 identity（身份与 credentials_ref）'
    + '或 fixtures（仅声明、不触发数据准备）中表达该前置，或删除该叙述句。中期 setup 执行通道见 issue #12。',
  'unmapped-action':
    '请改写为封闭动作集内的步骤：打开/访问（navigate）、点击（click）、'
    + '在“目标”中填写“值”（fill）、选择（select）、滚动（scroll）、等待（wait）；'
    + '目标与值均加引号，目标写在值之前，目标只能是语义短语（不得含 selector/xpath/坐标）。',
  'ambiguous-target':
    '步骤中引号片段过多、目标不唯一；请拆分为单一步骤，仅保留“目标”与“值”两个引号片段，不要让系统猜测目标。',
  'unrecognized-assertion':
    '请改写为封闭 DOM 断言：应该看到“目标”（visible）、不应该看到（absent）、'
    + '看到 <数量> 个（count）、值为（value）、勾选（checked）、URL 为（url）、数量为（number）；目标需加引号。',
};

function guidanceFor(reason: string): string {
  return REASON_GUIDANCE[reason] ?? REASON_GUIDANCE['unmapped-action']!;
}

/** 构造 draft 文件内容：草稿 Contract + _draft 人工补全指引。 */
function draftDocument(mapped: MappedContract, featurePath: string): string {
  const unmappedSteps = mapped.unmappedSteps.map((step) => ({
    ...step,
    guidance: guidanceFor(step.reason),
  }));
  const draftObject: Record<string, unknown> = {
    _draft: {
      status: 'needs-human-completion',
      source_feature: featurePath,
      note: '存在无法自动映射的 Gherkin 步骤：前置状态请用 identity/fixtures 声明表达而非动作，'
        + '动作与断言请改写为封闭集合内带引号的结构；按每条 unmapped_steps 的 guidance 补全后重命名为 .contract.yaml。',
      unmapped_steps: unmappedSteps,
    },
    ...mapped.contract,
  };
  return (
    '# DRAFT — 由 idwth init --from 生成，含未映射步骤，不可直接执行。\n'
    + '# 补全 _draft.unmapped_steps 中列出的步骤后，删除本注释与 _draft 段，\n'
    + '# 并将文件重命名为 *.contract.yaml，再运行 idwth validate。\n'
    + stringifyYaml(draftObject, { lineWidth: 100 })
  );
}

export async function initFromFeature(options: InitFromOptions): Promise<InitFromResult> {
  const raw = await readFile(options.featurePath, 'utf8');
  const feature = parseFeature(raw);
  const mapped = mapFeatureToContracts(feature, {
    baseUrl: options.baseUrl,
    credentialsRef: options.credentialsRef,
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.idPrefix !== undefined ? { idPrefix: options.idPrefix } : {}),
  });

  await mkdir(options.outDir, { recursive: true });

  const readyFiles: string[] = [];
  const draftFiles: string[] = [];
  const unmappedCounts: Record<string, number> = {};

  for (const item of mapped) {
    if (item.status === 'ready') {
      assertReady(item.contract);
      const fileName = `${item.testId}.contract.yaml`;
      await writeFile(
        path.join(options.outDir, fileName),
        stringifyYaml(item.contract, { lineWidth: 100 }),
        'utf8',
      );
      readyFiles.push(fileName);
    } else {
      const fileName = `${item.testId}.draft.yaml`;
      await writeFile(path.join(options.outDir, fileName), draftDocument(item, options.featurePath), 'utf8');
      draftFiles.push(fileName);
      unmappedCounts[fileName] = item.unmappedSteps.length;
    }
  }

  return { readyFiles, draftFiles, unmappedCounts };
}
