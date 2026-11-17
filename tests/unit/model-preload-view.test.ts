import { describe, expect, it } from 'vitest';
import { describeVoiceModel } from '../../src/ui/setup-page/model-preload-view.js';

describe('describeVoiceModel', () => {
  it('shows bytes and percent while downloading', () => {
    const view = describeVoiceModel({ status: 'downloading', loadedBytes: 10 * 1024 * 1024, totalBytes: 40 * 1024 * 1024 }, 0);
    expect(view.text).toContain('10.0 of 40.0 MB (25%)');
    expect(view.progress).toBeCloseTo(0.25);
    expect(view.showRetry).toBe(false);
  });

  it('uses an indeterminate bar when the server sent no length', () => {
    const view = describeVoiceModel({ status: 'downloading', loadedBytes: 1024 * 1024, totalBytes: undefined }, 0);
    expect(view.progress).toBeUndefined();
    expect(view.text).toContain('1.0 MB');
  });

  it('shows elapsed seconds while unpacking, and says it is first time only when not cached', () => {
    const view = describeVoiceModel({ status: 'loading', fromCache: false }, 12);
    expect(view.text).toContain('first time only');
    expect(view.text).toContain('12 s');
    expect(describeVoiceModel({ status: 'loading', fromCache: true }, 3).text).toContain('from this device');
  });

  it('says "Voice model ready" when ready', () => {
    expect(describeVoiceModel({ status: 'ready', loadMs: 5 }, 0).text).toBe('Voice model ready.');
  });

  it('names the failure, offers Retry, and says Enter AR still works', () => {
    const view = describeVoiceModel({ status: 'failed', message: 'HTTP 404.' }, 0);
    expect(view.text).toContain('HTTP 404.');
    expect(view.text).toContain('You can still enter AR');
    expect(view.showRetry).toBe(true);
  });
});
