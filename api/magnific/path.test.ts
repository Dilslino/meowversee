import { describe, expect, it } from 'vitest';
import { buildMagnificTargetUrl } from './[...path]';

describe('Magnific proxy path safety', () => {
  it('keeps slash-separated API paths unescaped for upstream calls', () => {
    expect(buildMagnificTargetUrl(['v1', 'ai', 'video', 'kling-v3-omni-std']).toString()).toBe(
      'https://api.magnific.com/v1/ai/video/kling-v3-omni-std',
    );
  });
});
