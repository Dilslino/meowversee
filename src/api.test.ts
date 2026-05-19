import { beforeEach, describe, expect, it } from 'vitest';
import { buildRequestBody, cacheHistoryItem, getCachedHistory, validatePayload } from './api';

describe('Magnific payload helpers', () => {
  it('maps Kling 3 Omni fields to Magnific API body names', () => {
    expect(
      buildRequestBody('omni', {
        prompt: '  cat walking through a pink moon garden  ',
        imageUrl: 'https://example.com/start.png',
        endImageUrl: 'https://example.com/end.png',
        aspectRatio: '9:16',
        duration: '5',
        generateAudio: true,
        referenceImageUrls: [' data:image/png;base64,a ', 'data:image/png;base64,b'],
      }),
    ).toEqual({
      prompt: 'cat walking through a pink moon garden',
      image_url: 'https://example.com/start.png',
      end_image_url: 'https://example.com/end.png',
      aspect_ratio: '9:16',
      image_urls: ['data:image/png;base64,a', 'data:image/png;base64,b'],
      duration: '5',
      generate_audio: true,
    });
  });

  it('requires motion-control character image and motion video uploads', () => {
    expect(validatePayload('motion', { imageUrl: '', videoUrl: 'data:video/mp4;base64,aaaa' })).toBe(
      'Kling Motion v3 membutuhkan gambar karakter dari device.',
    );
    expect(validatePayload('motion', { imageUrl: 'data:image/png;base64,aaaa', videoUrl: '' })).toBe(
      'Kling Motion v3 membutuhkan video gerakan dari device.',
    );
  });

  it('maps Kling Motion v3 fields to Magnific API body names', () => {
    expect(
      buildRequestBody('motion', {
        imageUrl: 'data:image/webp;base64,cat',
        videoUrl: 'data:video/mp4;base64,dance',
        prompt: 'soft fabric movement',
        characterOrientation: 'image',
        cfgScale: 0.7,
      }),
    ).toEqual({
      image_url: 'data:image/webp;base64,cat',
      video_url: 'data:video/mp4;base64,dance',
      prompt: 'soft fabric movement',
      character_orientation: 'image',
      cfg_scale: 0.7,
    });
  });
});

describe('generate history cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps generated tasks for 24 hours only', () => {
    const now = 1_700_000_000_000;
    cacheHistoryItem('omni', { task_id: 'task-1', status: 'CREATED' }, 'pink cat', now);

    expect(getCachedHistory(now + 23 * 60 * 60 * 1000)).toHaveLength(1);
    expect(getCachedHistory(now + 25 * 60 * 60 * 1000)).toHaveLength(0);
  });
});
