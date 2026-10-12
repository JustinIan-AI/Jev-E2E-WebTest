/**
 * Task 14 / DD-32 —— 上游错误码吸附器单测。
 *
 * 上游 @e2e-dev/decision 实录：`ASSERTION_INCONCLUSIVE` 以
 * `{ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' }` 返回（class=test、
 * exit 1）。吸附器必须：错误码保留为附加诊断，但判定改判为
 * inconclusive + decision，绝不沿用上游的 failed class（假 FAIL 通道封死）。
 */
import { describe, expect, it } from 'vitest';
import {
  UPSTREAM_ASSERTION_INCONCLUSIVE,
  absorbUpstreamAssertion,
} from '../../src/engine-provider/e2e/error-adapter.js';

describe('absorbUpstreamAssertion —— 上游错误码吸附（DD-32 / A10）', () => {
  it('failed + ASSERTION_INCONCLUSIVE → inconclusive/decision，保留 upstreamErrorCode 诊断', () => {
    const r = absorbUpstreamAssertion(
      { status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE', message: 'insufficient evidence' },
      'visible',
    );
    expect(r.passed).toBe(false);
    expect(r.status).toBe('inconclusive');
    expect(r.blockedReason).toBe('decision');
    expect(r.upstreamErrorCode).toBe(UPSTREAM_ASSERTION_INCONCLUSIVE);
    expect(r.message).toBe('insufficient evidence');
    // 吸附后绝不能携带上游的 failed class。
    expect(r.status).not.toBe('failed');
  });

  it('inconclusive（无论是否带码）→ inconclusive/decision + 错误码保留', () => {
    const r = absorbUpstreamAssertion(
      { status: 'inconclusive', errorCode: 'ASSERTION_INCONCLUSIVE' },
      'count',
    );
    expect(r.status).toBe('inconclusive');
    expect(r.blockedReason).toBe('decision');
    expect(r.upstreamErrorCode).toBe('ASSERTION_INCONCLUSIVE');
  });

  it('普通 failed（无错误码）→ failed，不吸附、不带 upstreamErrorCode', () => {
    const r = absorbUpstreamAssertion({ status: 'failed' }, 'visible');
    expect(r.passed).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.upstreamErrorCode).toBeUndefined();
  });

  it('failed + 其他错误码 → 仍 failed，但错误码保留为附加诊断', () => {
    const r = absorbUpstreamAssertion(
      { status: 'failed', errorCode: 'ELEMENT_DETACHED' },
      'value',
    );
    expect(r.passed).toBe(false);
    expect(r.status).toBe('failed');
    expect(r.upstreamErrorCode).toBe('ELEMENT_DETACHED');
  });

  it('passed → passed，不带 upstreamErrorCode（正常路径零污染）', () => {
    const r = absorbUpstreamAssertion(
      { status: 'passed', actual: 'x' },
      'value',
    );
    expect(r.passed).toBe(true);
    expect(r.status).toBe('passed');
    expect(r.upstreamErrorCode).toBeUndefined();
    expect(r.actual).toBe('x');
  });

  it('inconclusive + actual 透传（诊断不丢）', () => {
    const r = absorbUpstreamAssertion(
      { status: 'inconclusive', actual: 2, message: 'count unclear' },
      'count',
    );
    expect(r.status).toBe('inconclusive');
    expect(r.actual).toBe(2);
    expect(r.message).toBe('count unclear');
  });
});
