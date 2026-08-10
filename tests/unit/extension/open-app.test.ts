import { describe, expect, it, vi } from 'vitest';
import { openApplicationTab } from '../../../src/extension/open-app';

describe('openApplicationTab', () => {
  it('opens the packaged full-page application', async () => {
    const create = vi.fn().mockResolvedValue({ id: 7 });
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      tabs: { create },
    });

    await openApplicationTab();

    expect(create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/app.html',
    });
  });
});
