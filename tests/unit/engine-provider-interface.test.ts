import { describe, expect, it } from 'vitest';
import {
  ENGINE_PROVIDER_CAPABILITIES,
  type EngineProvider,
  type PlaywrightProviderOptions,
  type ResolveMode,
  type ResolveStatus,
} from '../../src/engine-provider/index.js';

/**
 * TR-4.1 / AC-17：EngineProvider 接口形状契约。
 * 接口本身只有方法没有实现 —— 这里用一个最小 fake 验证：
 *  1) 八个能力（id/version + 7 个方法）齐备；
 *  2) 关键类型字面量（ResolveMode / ResolveStatus）稳定，Task 5 与 Task 14 依赖它们。
 */
describe('EngineProvider interface shape (TR-4.1 / AC-17)', () => {
  it('声明的能力清单包含 id/version 与七个运行时方法', () => {
    expect(ENGINE_PROVIDER_CAPABILITIES).toEqual([
      'id',
      'version',
      'observe',
      'resolve',
      'act',
      'checkAssertion',
      'screenshot',
      'trace',
      'dispose',
    ]);
  });

  it('任何 EngineProvider 实现都必须具备全部能力', () => {
    const fake: EngineProvider = {
      id: 'fake',
      version: 'fake-0.0.1',
      observe: async () => ({
        observationId: 'obs-0',
        fingerprint: 'sha1:0000000000000000000000000000000000000000',
        url: 'http://x.test/',
        title: 'x',
        elements: [],
        textExcerpt: '',
      }),
      resolve: async () => ({ status: 'miss' }),
      act: async () => ({ kind: 'assert_only', status: 'skipped', dispatched: false }),
      checkAssertion: async () => ({ kind: 'visible', passed: false, status: 'inconclusive' }),
      screenshot: async () => ({ uri: 'artifact://fake.png', mediaType: 'image/png' }),
      trace: async () => ({ uri: 'artifact://fake.zip', mediaType: 'application/zip' }),
      dispose: async () => {},
    };

    for (const capability of ENGINE_PROVIDER_CAPABILITIES) {
      expect(fake[capability]).toBeDefined();
    }
    expect(typeof fake.observe).toBe('function');
    expect(typeof fake.dispose).toBe('function');
  });

  it('ResolveMode 取值稳定为 L1 / L2（零模型定位两级）', () => {
    const modes: readonly ResolveMode[] = ['L1', 'L2'];
    expect(modes).toHaveLength(2);
  });

  it('ResolveStatus 覆盖 miss/resolved/ambiguous（0/1/>1 三态，Task 5 依赖）', () => {
    const statuses: readonly ResolveStatus[] = ['miss', 'resolved', 'ambiguous'];
    expect(statuses).toHaveLength(3);
  });

  it('PlaywrightProviderOptions 接受 cdpEndpoint/storageSeed/originsAllowlist/viewport/locale/timezoneId', () => {
    // 纯类型级约束：编译通过即说明选项形状被导出且可构造。
    const options: PlaywrightProviderOptions = {
      cdpEndpoint: 'http://127.0.0.1:9222',
      storageSeed: { cluster: 'host' },
      originsAllowlist: ['http://127.0.0.1:0'],
      viewport: { width: 1440, height: 900 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    };
    expect(options.cdpEndpoint).toMatch(/^https?:\/\//);
    // core 不假定任何 storageSeed 键名：键完全由 SUT 适配提供。
    expect(options.storageSeed).toEqual({ cluster: 'host' });
  });
});
