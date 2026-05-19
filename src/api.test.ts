import { describe, expect, it } from 'vitest';
import { buildRequestBody, validatePayload } from './api';

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
      }),
    ).toEqual({
      prompt: 'cat walking through a pink moon garden',
      image_url: 'https://example.com/start.png',
      end_image_url: 'https://example.com/end.png',
      aspect_ratio: '9:16',
      duration: '5',
      generate_audio: true,
    });
  });

  it('requires motion-control image and video URLs', () => {
    expect(validatePayload('motion', { imageUrl: '', videoUrl: 'https://example.com/move.mp4' })).toBe(
      'Kling Motion v3 membutuhkan URL gambar karakter.',
    );
    expect(validatePayload('motion', { imageUrl: 'https://example.com/cat.png', videoUrl: '' })).toBe(
      'Kling Motion v3 membutuhkan URL video referensi gerakan.',
    );
  });

  it('maps Kling Motion v3 fields to Magnific API body names', () => {
    expect(
      buildRequestBody('motion', {
        imageUrl: 'https://example.com/cat.webp',
        videoUrl: 'https://example.com/dance.mp4',
        prompt: 'soft fabric movement',
        characterOrientation: 'image',
        cfgScale: 0.7,
      }),
    ).toEqual({
      image_url: 'https://example.com/cat.webp',
      video_url: 'https://example.com/dance.mp4',
      prompt: 'soft fabric movement',
      character_orientation: 'image',
      cfg_scale: 0.7,
    });
  });
});
