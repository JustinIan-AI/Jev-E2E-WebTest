/**
 * Task 8 RED — TR-8.1 / TR-8.2 单元侧。
 * 依据详设 §9.4（观测剔除 password/file/hidden；credential 永不进 evidence）、
 * §5.5.8（文本级已知密钥遮罩）、§4.8.6 constraints（trace 不含明文密码）。
 */
import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  buildTextMaskScript,
  isCredentialKey,
  redactObservation,
  redactSecretsInString,
  redactValue,
  scanFilesForSecrets,
  serializeTraceEvents,
} from '../../src/runtime/redaction.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SECRETS = [
  'sup3r-s3cret-pw',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload0001',
  'c3VwZXItc2VjcmV0LWtleS1kYXRh',
];

describe('isCredentialKey（§9.4：credential 键名识别）', () => {
  it.each([
    'password',
    'passwd',
    'pwd',
    'user_password',
    'clientToken',
    'api_key',
    'api-key',
    'authorization',
    'credentials',
    'secret',
    'client-key-data',
  ])('%s 判定为 credential 键', (key) => {
    expect(isCredentialKey(key)).toBe(true);
  });

  it.each(['username', 'server', 'name', 'apiVersion', 'method', 'url'])(
    '%s 不是 credential 键',
    (key) => {
      expect(isCredentialKey(key)).toBe(false);
    },
  );
});

describe('redactSecretsInString（已知明文替换）', () => {
  it('替换全部已知密钥明文为 [REDACTED]', () => {
    const out = redactSecretsInString(
      `login pw=sup3r-s3cret-pw auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload0001 ok`,
      SECRETS,
    );
    expect(out).not.toContain('sup3r-s3cret-pw');
    expect(out).not.toContain('secretpayload0001');
    expect(out).toContain(REDACTED);
  });

  it('长度 ≤3 的疑似值不替换（避免误杀，§5.5.8 v.length > 3 口径）', () => {
    expect(redactSecretsInString('abc abc abc', ['abc'])).toBe('abc abc abc');
  });

  it('无 secrets 时原样返回', () => {
    expect(redactSecretsInString('hello', [])).toBe('hello');
  });
});

describe('redactValue（深度脱敏：credential 键 + 已知明文）', () => {
  it('任意嵌套层级的 credential 键值被替换', () => {
    const raw = {
      request: {
        url: 'https://sut/login',
        headers: { Authorization: SECRETS[1], 'Content-Type': 'application/json' },
        body: { username: 'admin', password: SECRETS[0] },
      },
      nested: { deep: { client_secret: SECRETS[2] } },
    };
    const out = redactValue(raw, SECRETS) as Record<string, unknown>;
    const req = out.request as Record<string, unknown>;
    const headers = req.headers as Record<string, unknown>;
    const body = req.body as Record<string, unknown>;
    expect(headers.Authorization).toBe(REDACTED);
    expect(body.password).toBe(REDACTED);
    expect((out.nested as { deep: { client_secret: string } }).deep.client_secret).toBe(REDACTED);
    // 非敏感键保留
    expect(req.url).toBe('https://sut/login');
    expect(body.username).toBe('admin');
  });

  it('数组元素递归脱敏', () => {
    const out = redactValue(
      [{ password: SECRETS[0] }, { note: `x=${SECRETS[1]}` }],
      SECRETS,
    ) as unknown[];
    expect((out[0] as Record<string, unknown>).password).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain('secretpayload0001');
  });

  it('明文凭据即使键名不敏感也被替换（值匹配）', () => {
    const out = redactValue({ note: `token=${SECRETS[0]}` }, SECRETS) as Record<string, unknown>;
    expect(out.note).not.toContain(SECRETS[0]);
  });

  it('脱敏结果 JSON 中 grep 不到任何已知明文（TR-8.1）', () => {
    const raw = {
      postData: `username=admin&password=${SECRETS[0]}`,
      text: SECRETS[1],
    };
    for (const s of SECRETS) {
      expect(JSON.stringify(redactValue(raw, SECRETS))).not.toContain(s);
    }
  });
});

describe('redactObservation（§9.4：观测剔除 password/file/hidden 控件）', () => {
  it('password/file/hidden 输入控件不进入观测', () => {
    const obs = {
      url: 'https://sut/login',
      textExcerpt: `sign in ${SECRETS[0]}`,
      elements: [
        { id: 'e1', tag: 'input', inputType: 'text', name: 'username', visible: true },
        { id: 'e2', tag: 'input', inputType: 'password', name: 'password', value: SECRETS[0], visible: true },
        { id: 'e3', tag: 'input', inputType: 'hidden', name: 'csrf', value: 'tok-1234' },
        { id: 'e4', tag: 'input', inputType: 'file', name: 'upload' },
        { id: 'e5', tag: 'button', inputType: undefined, name: '提交', visible: true },
      ],
    };
    const out = redactObservation(obs, SECRETS);
    const ids = (out.elements ?? []).map((e) => e.id);
    expect(ids).toEqual(['e1', 'e5']);
    expect(JSON.stringify(out)).not.toContain(SECRETS[0]);
    expect(out.textExcerpt).not.toContain(SECRETS[0]);
  });

  it('无控件观测也不泄漏 credential 字段', () => {
    const out = redactObservation({ fields: { password: SECRETS[0] } }, SECRETS) as Record<
      string,
      unknown
    >;
    expect((out.fields as Record<string, unknown>).password).toBe(REDACTED);
  });
});

describe('buildTextMaskScript（§5.5.8：TreeWalker 文本级遮罩注入脚本）', () => {
  const script = buildTextMaskScript(SECRETS);

  it('脚本为可 evaluate 的函数表达式，内嵌已知明文', () => {
    expect(script).toContain('secretpayload0001');
    expect(script).toContain(SECRETS[2]);
  });

  it('使用 TreeWalker + SHOW_TEXT 遍历文本节点', () => {
    expect(script).toContain('TreeWalker');
    expect(script).toContain('SHOW_TEXT');
  });

  it('仅遮罩长度 >3 的命中值，并注入 data-redacted 黑色 span', () => {
    expect(script).toContain('length > 3');
    expect(script).toContain('data-redacted');
    expect(script).toMatch(/background:\s*#000/i);
  });

  it('secrets 经 JSON 转义，脚本可被 new Function 解析（只校验语法，不执行 DOM 部分）', () => {
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('serializeTraceEvents（TR-8.1：trace 序列化不含明文）', () => {
  it('网络事件中的密码/凭据被脱敏', () => {
    const events = [
      {
        type: 'request',
        url: 'https://sut/login',
        method: 'POST',
        postData: `username=admin&password=${SECRETS[0]}`,
        headers: { authorization: SECRETS[1] },
      },
      { type: 'response', status: 200, body: `key: ${SECRETS[2]}` },
    ];
    const trace = serializeTraceEvents(events, SECRETS);
    for (const s of SECRETS) expect(trace).not.toContain(s);
    expect(trace).toContain('https://sut/login');
  });
});

describe('scanFilesForSecrets（TR-8.1：产物树 grep 扫描）', () => {
  async function makeTree(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-scan-'));
    await mkdir(path.join(dir, 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'clean.json'), JSON.stringify({ a: 1 }));
    await writeFile(path.join(dir, 'sub', 'trace.txt'), serializeTraceEvents([], []));
    return dir;
  }

  it('干净产物树返回空列表', async () => {
    const dir = await makeTree();
    try {
      expect(await scanFilesForSecrets(dir, SECRETS)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('发现含明文的文件并返回其路径', async () => {
    const dir = await makeTree();
    const leakPath = path.join(dir, 'leak.log');
    try {
      await writeFile(leakPath, `login with ${SECRETS[0]}`);
      const hits = await scanFilesForSecrets(dir, SECRETS);
      expect(hits).toEqual([leakPath]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
