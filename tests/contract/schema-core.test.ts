import { describe, expect, it } from 'vitest';
import { validate } from '../../src/schema/loader.js';

const resolvedTarget = { elementId: 'e1', strategy: 'role' as const };

describe('action schema', () => {
  it('accepts a click action with target', () => {
    const r = validate('action', { kind: 'click', target: resolvedTarget, risk: 'reversible' });
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
  });

  it('requires value for fill', () => {
    const r = validate('action', { kind: 'fill', target: resolvedTarget, risk: 'reversible' });
    expect(r.valid).toBe(false);
  });

  it('rejects unknown kind', () => {
    const r = validate('action', { kind: 'hover', risk: 'reversible' });
    expect(r.valid).toBe(false);
  });

  it('rejects invalid risk', () => {
    const r = validate('action', { kind: 'done', risk: 'maybe' });
    expect(r.valid).toBe(false);
  });
});

describe('strategy schema', () => {
  const bindings = {
    contract_hash: 'sha256:0'.padEnd(71, '0'),
    strategy_hash: 'sha256:1'.padEnd(71, '1'),
    judge_impl_hash: 'sha256:2'.padEnd(71, '2'),
    runner_version: '1.0.0',
    env_fingerprint: 'sha256:3'.padEnd(71, '3'),
    engine_provider_version: 'e2e@0.18.0',
  };

  it('accepts a valid frozen strategy with six bindings', () => {
    const r = validate('strategy', {
      schema: 'idwth.strategy.v1',
      contract_id: 'workload.create',
      version: 3,
      bindings,
      flows: [{ step_index: 0, intent: '进入工作负载', strategy: 'role' }],
    });
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
  });

  it('rejects strategy missing engine_provider_version binding', () => {
    const { engine_provider_version: _e, ...b } = bindings;
    const r = validate('strategy', {
      schema: 'idwth.strategy.v1',
      contract_id: 'workload.create',
      version: 1,
      bindings: b,
      flows: [],
    });
    expect(r.valid).toBe(false);
  });
});

describe('trace schema', () => {
  const baseTrace = {
    schema: 'idwth.trace.v1',
    run_id: 'a7f3c9e1',
    test_id: 'workload.create',
    bindings: {
      contract_hash: 'sha256:0'.padEnd(71, '0'),
      strategy_hash: 'sha256:1'.padEnd(71, '1'),
      judge_impl_hash: 'sha256:2'.padEnd(71, '2'),
      runner_version: '1.0.0',
      env_fingerprint: 'sha256:3'.padEnd(71, '3'),
      engine_provider_version: 'e2e@0.18.0',
    },
    started_at: '2026-10-10T00:00:00Z',
    execution_policy: 'deterministic' as const,
    runtime: 'ci' as const,
    judge_result: {
      verdict: 'PASS' as const,
      blocked_reason: null,
      assertions: [],
      evaluated_at: '2026-10-10T00:01:00Z',
      judge_version: '1.0',
    },
    verdict_hash: 'sha256:4'.padEnd(71, '4'),
    episodes: [],
    evidence: { judgement_set: [], archived: [] },
    cleanup: { executed: true },
  };

  it('accepts a valid trace', () => {
    const r = validate('trace', baseTrace);
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
  });

  it('rejects trace with unknown verdict', () => {
    const r = validate('trace', {
      ...baseTrace,
      judge_result: { ...baseTrace.judge_result, verdict: 'PARTIAL' },
    });
    expect(r.valid).toBe(false);
  });

  it('rejects trace missing judgement_set', () => {
    const r = validate('trace', { ...baseTrace, evidence: { archived: [] } });
    expect(r.valid).toBe(false);
  });
});
