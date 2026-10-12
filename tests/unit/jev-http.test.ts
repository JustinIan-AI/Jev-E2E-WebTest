/**
 * Task 12 —— TypeSafeJevProvider 传输层（DD §7.1/§7.4）。
 *
 * fetch 注入（零网络）：成功透传 answers/usage/latency、Bearer 头、
 * HTTP 错误 / 非 JSON / 结构缺失 / 网络异常统一收口 JevTransportError。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  TypeSafeJevProvider,
  JevTransportError,
} from '../../src/adapters/jev/jev-http.js';
import type { DecisionRequest } from '../../src/adapters/jev/types.js';

const request: DecisionRequest = {
  state: { url: 'https://sut.example/app' },
  questions: {
    q_resolve: {
      id: 'q_resolve',
      prompt: '请选择目标控件',
      choices: [{ index: 0, elementId: 'el-1', role: 'button', name: '创建' }],
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TypeSafeJevProvider：传输层', () => {
  it('成功：POST JSON（state/questions），透传 answers/usage，latency_ms 计时', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        answers: { q_resolve: { choice: 1, confidence: 0.72 } },
        usage: { inputTokens: 100, outputTokens: 28, totalTokens: 128 },
      }),
    );
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await provider.decide(request);
    expect(res.answers.q_resolve).toEqual({ choice: 1, confidence: 0.72 });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 28, totalTokens: 128 });
    expect(res.latency_ms).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://jev.example/api');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      state: request.state,
      questions: request.questions,
    });
  });

  it('配置 apiKey → 携带 authorization: Bearer 头；未配置则不携带', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answers: {} }));
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await provider.decide(request);
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');

    const anon = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await anon.decide(request);
    const headers2 = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers2.authorization).toBeUndefined();
  });

  it('HTTP 500 → JevTransportError（绝不自动重试）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'boom' }, 500));
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.decide(request)).rejects.toBeInstanceOf(JevTransportError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('非 JSON 响应 → JevTransportError', async () => {
    const fetchImpl = vi.fn(async () => new Response('not-json', { status: 200 }));
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.decide(request)).rejects.toBeInstanceOf(JevTransportError);
  });

  it('响应缺 answers 记录 → JevTransportError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [] }));
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.decide(request)).rejects.toBeInstanceOf(JevTransportError);
  });

  it('answers 内结构缺失（无 choice/confidence）→ JevTransportError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ answers: { q_resolve: { only: 'junk' } } }),
    );
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.decide(request)).rejects.toBeInstanceOf(JevTransportError);
  });

  it('网络异常 → JevTransportError（收口原因，不重试）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = new TypeSafeJevProvider({
      endpoint: 'https://jev.example/api',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.decide(request)).rejects.toBeInstanceOf(JevTransportError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('id 缺省 typesafe-jev，可显式覆盖（审计来源标识）', () => {
    const base = new TypeSafeJevProvider({ endpoint: 'https://jev.example/api' });
    expect(base.id).toBe('typesafe-jev');
    const named = new TypeSafeJevProvider({ endpoint: 'https://jev.example/api', id: 'jev-prod' });
    expect(named.id).toBe('jev-prod');
  });
});
