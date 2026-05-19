import { describe, expect, it } from 'vitest';
import { buildMagnificTargetUrl } from './[...path]';
import { dataUrlToFile } from '../upload';

describe('Magnific proxy path safety', () => {
  it('keeps slash-separated API paths unescaped for upstream calls', () => {
    expect(buildMagnificTargetUrl(['v1', 'ai', 'video', 'kling-v3-omni-std']).toString()).toBe(
      'https://api.magnific.com/v1/ai/video/kling-v3-omni-std',
    );
  });
});

describe('Device upload conversion', () => {
  it('decodes browser data URLs into uploadable files', () => {
    const file = dataUrlToFile('data:image/png;base64,aGVsbG8=', 'cat face.png');

    expect(file?.contentType).toBe('image/png');
    expect(file?.filename).toBe('cat_face.png');
    expect(file?.bytes.toString('utf8')).toBe('hello');
  });

  it('rejects invalid data URLs before calling the host', () => {
    expect(dataUrlToFile('https://example.com/cat.png', 'cat.png')).toBeNull();
  });
});
