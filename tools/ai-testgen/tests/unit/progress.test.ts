import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Progress } from '../../src/utils/progress';

describe('Progress', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start and stop a spinner phase', () => {
    const progress = new Progress();
    progress.start('Parsing input...');
    progress.stop();
    expect(stderrWrite).toHaveBeenCalled();
  });

  it('should update phase text', () => {
    const progress = new Progress();
    progress.start('Phase 1');
    progress.update('Phase 2');
    progress.stop();
    expect(stderrWrite).toHaveBeenCalled();
  });

  it('should show done message with checkmark', () => {
    const progress = new Progress();
    progress.start('Working...');
    progress.done('Complete');
    const allCalls = stderrWrite.mock.calls.map((c) => String(c[0])).join('');
    expect(allCalls).toContain('Complete');
    expect(allCalls).toContain('✓');
  });

  it('should stream tokens directly', () => {
    const progress = new Progress();
    progress.stream('Hello');
    progress.stream(' world');
    expect(stderrWrite).toHaveBeenCalledWith('Hello');
    expect(stderrWrite).toHaveBeenCalledWith(' world');
  });
});
