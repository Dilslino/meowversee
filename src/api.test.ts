import { beforeEach, describe, expect, it } from 'vitest';
import { buildRequestBody, cacheHistoryItem, formatElapsedTime, formatUploadSelection, getAutoPollDelay, getDefaultModelForMode, generateVideo, getCachedHistory, getMagnificModelsForMode, getPendingGenerate, getTaskStatus, validatePayload } from './api';

describe('Magnific payload helpers', () => {
  it('maps Kling 3 Omni fields to Magnific API body names', () => {
    expect(
      buildRequestBody('kling-v3-omni-std', {
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
    expect(validatePayload('kling-v3-motion-control-std', { imageUrl: '', videoUrl: 'data:video/mp4;base64,aaaa' })).toBe(
      'Motion control membutuhkan gambar karakter dari device.',
    );
    expect(validatePayload('kling-v3-motion-control-std', { imageUrl: 'data:image/png;base64,aaaa', videoUrl: '' })).toBe(
      'Motion control membutuhkan video gerakan dari device.',
    );
  });

  it('maps Kling Motion v3 fields to Magnific API body names', () => {
    expect(
      buildRequestBody('kling-v3-motion-control-std', {
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

describe('Magnific mode and model catalog', () => {
  it('groups studio modes into video, motion control, image generation, and image upscale', () => {
    expect(getMagnificModelsForMode('video').map((model) => model.id)).toContain('kling-v3-omni-std');
    expect(getMagnificModelsForMode('motion').map((model) => model.id)).toContain('kling-v3-motion-control-std');
    expect(getMagnificModelsForMode('image').map((model) => model.id)).toEqual(expect.arrayContaining(['mystic', 'flux-2-turbo']));
    expect(getMagnificModelsForMode('upscale').map((model) => model.id)).toEqual(expect.arrayContaining(['image-upscaler', 'image-upscaler-precision']));
  });

  it('maps selected Magnific model endpoints into request routes', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    try {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return Promise.resolve(new Response(JSON.stringify({ task_id: 'task-1', status: 'CREATED' }), { status: 200 }));
      }) as typeof fetch;

      await generateVideo('mystic', { prompt: 'pink cat' });
      await generateVideo('image-upscaler-precision', { imageUrl: 'data:image/png;base64,aaaa' });
      await getTaskStatus('flux-2-turbo', 'task-2');

      expect(requestedUrls).toEqual([
        '/api/magnific/v1/ai/mystic',
        '/api/magnific/v1/ai/image-upscaler-precision',
        '/api/magnific/v1/ai/text-to-image/flux-2-turbo/task-2',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('chooses the first Magnific model available for a mode', () => {
    expect(getDefaultModelForMode('video')).toBe('kling-v3-omni-std');
    expect(getDefaultModelForMode('motion')).toBe('kling-v3-motion-control-std');
    expect(getDefaultModelForMode('image')).toBe('mystic');
    expect(getDefaultModelForMode('upscale')).toBe('image-upscaler');
  });
});

describe('generate history cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps generated tasks for 24 hours only', () => {
    const now = 1_700_000_000_000;
    cacheHistoryItem('kling-v3-omni-std', { task_id: 'task-1', status: 'CREATED' }, 'pink cat', now);

    expect(getCachedHistory(now + 23 * 60 * 60 * 1000)).toHaveLength(1);
    expect(getCachedHistory(now + 25 * 60 * 60 * 1000)).toHaveLength(0);
  });
});

describe('Magnific network failures', () => {
  it('explains browser fetch failures as a connection/CORS problem', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

    const result = await generateVideo('kling-v3-omni-std', { prompt: 'pink cat' });

    expect(result).toEqual({
      ok: false,
      message: 'Browser tidak bisa menghubungi Magnific API. Ini biasanya karena koneksi, CORS, atau API Magnific menolak request langsung dari browser. Coba lagi; kalau tetap gagal, app perlu backend proxy.',
    });

    globalThis.fetch = originalFetch;
  });
});

describe('Magnific request routing', () => {
  it('uses the local proxy path so browser requests are same-origin', async () => {
    localStorage.clear();
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Promise.resolve(new Response(JSON.stringify({ task_id: 'task-1', status: 'CREATED' }), { status: 200 }));
    }) as typeof fetch;

    await generateVideo('kling-v3-omni-std', { prompt: 'pink cat' });

    expect(requestedUrl).toBe('/api/magnific/v1/ai/video/kling-v3-omni-std');

    globalThis.fetch = originalFetch;
  });
});

describe('Generate retry protection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('blocks repeated identical generate attempts after an uncertain network failure', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

      await generateVideo('kling-v3-omni-std', { prompt: 'pink cat' }, 1_700_000_000_000);
      const result = await generateVideo('kling-v3-omni-std', { prompt: 'pink cat' }, 1_700_000_010_000);

      expect(result).toEqual({
        ok: false,
        message: 'Generate yang sama baru saja dikirim dan statusnya belum pasti. Jangan klik ulang karena bisa memotong limit lagi. Tunggu beberapa menit, lalu cek history/task di dashboard Magnific.',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clears retry protection when Magnific returns a task id', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ task_id: 'task-1', status: 'CREATED' }), { status: 200 }))) as typeof fetch;

      await generateVideo('kling-v3-omni-std', { prompt: 'pink cat' }, 1_700_000_000_000);

      expect(getPendingGenerate('kling-v3-omni-std', { prompt: 'pink cat' }, 1_700_000_010_000)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Automatic status polling helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads completed task video URLs from Magnific through the proxy', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
        data: { task_id: 'task-1', status: 'COMPLETED', generated: ['https://cdn.example.com/video.mp4'] },
      }), { status: 200 }))) as typeof fetch;

      const result = await getTaskStatus('kling-v3-omni-std', 'task-1');

      expect(result).toEqual({
        ok: true,
        data: { task_id: 'task-1', status: 'COMPLETED', generated: ['https://cdn.example.com/video.mp4'] },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Automatic polling cadence', () => {
  it('keeps polling after the first minute without stopping early', () => {
    expect(getAutoPollDelay(0)).toBe(0);
    expect(getAutoPollDelay(1)).toBe(1_000);
    expect(getAutoPollDelay(2)).toBe(3_000);
    expect(getAutoPollDelay(3)).toBe(7_000);
    expect(getAutoPollDelay(4)).toBe(15_000);
    expect(getAutoPollDelay(5)).toBe(30_000);
    expect(getAutoPollDelay(6)).toBe(30_000);
    expect(getAutoPollDelay(25)).toBe(30_000);
  });
});

describe('Elapsed time formatting', () => {
  it('formats seconds minutes and hours for generated tasks', () => {
    expect(formatElapsedTime(0)).toBe('0 detik');
    expect(formatElapsedTime(59_000)).toBe('59 detik');
    expect(formatElapsedTime(60_000)).toBe('1 menit 0 detik');
    expect(formatElapsedTime(125_000)).toBe('2 menit 5 detik');
    expect(formatElapsedTime(3_725_000)).toBe('1 jam 2 menit 5 detik');
  });
});

describe('Upload selection labels', () => {
  it('shows a friendly empty upload state', () => {
    expect(formatUploadSelection()).toBe('Belum ada file');
    expect(formatUploadSelection(0)).toBe('Belum ada file');
  });

  it('shows the selected file count without browser choose-file copy', () => {
    expect(formatUploadSelection(1)).toBe('1 file dipilih');
    expect(formatUploadSelection(4)).toBe('4 file dipilih');
  });
});
