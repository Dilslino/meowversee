import { beforeEach, describe, expect, it } from 'vitest';
import { buildRequestBody, cacheHistoryItem, getAutoPollDelay, generateVideo, getCachedHistory, getPendingGenerate, getTaskStatus, validatePayload } from './api';

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

describe('Magnific network failures', () => {
  it('explains browser fetch failures as a connection/CORS problem', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

    const result = await generateVideo('mgf_test', 'omni', { prompt: 'pink cat' });

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

    await generateVideo('mgf_test', 'omni', { prompt: 'pink cat' });

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

      await generateVideo('mgf_test', 'omni', { prompt: 'pink cat' }, 1_700_000_000_000);
      const result = await generateVideo('mgf_test', 'omni', { prompt: 'pink cat' }, 1_700_000_010_000);

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

      await generateVideo('mgf_test', 'omni', { prompt: 'pink cat' }, 1_700_000_000_000);

      expect(getPendingGenerate('omni', { prompt: 'pink cat' }, 1_700_000_010_000)).toBeNull();
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

      const result = await getTaskStatus('mgf_test', 'omni', 'task-1');

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
