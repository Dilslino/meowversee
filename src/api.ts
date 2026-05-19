export type StudioMode = 'video' | 'motion' | 'image' | 'upscale';
export type ModelId =
  | 'kling-v3-omni-std'
  | 'kling-v3-motion-control-std'
  | 'mystic'
  | 'flux-2-turbo'
  | 'image-upscaler'
  | 'image-upscaler-precision';
export type TaskStatus = 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type GeneratePayload = {
  prompt?: string;
  imageUrl?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  videoUrl?: string;
  referenceImageUrls?: string[];
  aspectRatio?: 'auto' | '16:9' | '9:16' | '1:1' | 'square_1_1' | 'social_story_9_16' | 'widescreen_16_9';
  duration?: string;
  generateAudio?: boolean;
  characterOrientation?: 'video' | 'image';
  cfgScale?: number;
  upscaleFactor?: '2x' | '4x' | '8x' | '16x';
  upscaleEngine?: 'automatic' | 'magnific_illusio' | 'magnific_sharpy' | 'magnific_sparkle';
};

export type MagnificTask = {
  task_id: string;
  status: TaskStatus;
  generated?: string[];
};

export type CachedHistoryItem = {
  task: MagnificTask;
  model: ModelId;
  prompt: string;
  createdAt: number;
  expiresAt: number;
};
type PendingGenerate = {
  key: string;
  createdAt: number;
  expiresAt: number;
};


export type ApiResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
};

const BASE_URL = '/api/magnific';
const HISTORY_KEY = 'meowversee:generate-history';
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 12;
const PENDING_GENERATE_KEY = 'meowversee:pending-generate';
const PENDING_GENERATE_TTL_MS = 10 * 60 * 1000;
const PENDING_GENERATE_MESSAGE = 'Generate yang sama baru saja dikirim dan statusnya belum pasti. Jangan klik ulang karena bisa memotong limit lagi. Tunggu beberapa menit, lalu cek history/task di dashboard Magnific.';
const FETCH_FAILURE_MESSAGE = 'Browser tidak bisa menghubungi Magnific API. Ini biasanya karena koneksi, CORS, atau API Magnific menolak request langsung dari browser. Coba lagi; kalau tetap gagal, app perlu backend proxy.';
const AUTO_POLL_DELAYS_MS = [0, 1000, 3000, 7000, 15000, 30000] as const;


export type MagnificModel = {
  id: ModelId;
  mode: StudioMode;
  title: string;
  create: string;
  status: string;
};

export const MAGNIFIC_MODE_COPY: Record<StudioMode, { title: string; button: string }> = {
  video: { title: 'Generate video', button: 'Generate video' },
  motion: { title: 'Motion control', button: 'Generate motion' },
  image: { title: 'Generate image', button: 'Generate image' },
  upscale: { title: 'Upscale image', button: 'Upscale image' },
};

export const MAGNIFIC_MODELS: readonly MagnificModel[] = [
  {
    id: 'kling-v3-omni-std',
    mode: 'video',
    title: 'Kling 3 Omni Standard',
    create: '/v1/ai/video/kling-v3-omni-std',
    status: '/v1/ai/video/kling-v3-omni',
  },
  {
    id: 'kling-v3-motion-control-std',
    mode: 'motion',
    title: 'Kling 3 Standard Motion Control',
    create: '/v1/ai/video/kling-v3-motion-control-std',
    status: '/v1/ai/video/kling-v3-motion-control-std',
  },
  {
    id: 'mystic',
    mode: 'image',
    title: 'Mystic',
    create: '/v1/ai/mystic',
    status: '/v1/ai/mystic',
  },
  {
    id: 'flux-2-turbo',
    mode: 'image',
    title: 'Flux 2 Turbo',
    create: '/v1/ai/text-to-image/flux-2-turbo',
    status: '/v1/ai/text-to-image/flux-2-turbo',
  },
  {
    id: 'image-upscaler',
    mode: 'upscale',
    title: 'Upscaler Creative',
    create: '/v1/ai/image-upscaler',
    status: '/v1/ai/image-upscaler',
  },
  {
    id: 'image-upscaler-precision',
    mode: 'upscale',
    title: 'Upscaler Precision',
    create: '/v1/ai/image-upscaler-precision',
    status: '/v1/ai/image-upscaler-precision',
  },
] as const;

const endpoints: Record<ModelId, { create: string; status: string }> = Object.fromEntries(
  MAGNIFIC_MODELS.map((model) => [model.id, { create: model.create, status: model.status }]),
) as Record<ModelId, { create: string; status: string }>;

export function getMagnificModelsForMode(mode: StudioMode): MagnificModel[] {
  return MAGNIFIC_MODELS.filter((model) => model.mode === mode);
}

export function getDefaultModelForMode(mode: StudioMode): ModelId {
  return getMagnificModelsForMode(mode)[0].id;
}


export function getCachedHistory(now = Date.now()): CachedHistoryItem[] {
  const raw = window.localStorage.getItem(HISTORY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const items = parsed.filter(isCachedHistoryItem).filter((item) => item.expiresAt > now);
    if (items.length !== parsed.length) writeCachedHistory(items);
    return items;
  } catch {
    window.localStorage.removeItem(HISTORY_KEY);
    return [];
  }
}

export function cacheHistoryItem(model: ModelId, task: MagnificTask, prompt: string, now = Date.now()): CachedHistoryItem[] {
  const item: CachedHistoryItem = {
    task,
    model,
    prompt: prompt.trim(),
    createdAt: now,
    expiresAt: now + HISTORY_TTL_MS,
  };
  const deduped = getCachedHistory(now).filter((entry) => entry.task.task_id !== task.task_id);
  const next = [item, ...deduped].slice(0, MAX_HISTORY_ITEMS);
  writeCachedHistory(next);
  return next;
}

export function updateCachedHistoryTask(model: ModelId, task: MagnificTask, now = Date.now()): CachedHistoryItem[] {
  const next = getCachedHistory(now).map((entry) =>
    entry.model === model && entry.task.task_id === task.task_id ? { ...entry, task } : entry,
  );
  writeCachedHistory(next);
  return next;
}

function writeCachedHistory(items: CachedHistoryItem[]): void {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

export function buildRequestBody(model: ModelId, payload: GeneratePayload): Record<string, unknown> {
  if (model === 'kling-v3-motion-control-std') {
    const body: Record<string, unknown> = {
      image_url: payload.imageUrl?.trim(),
      video_url: payload.videoUrl?.trim(),
    };

    if (payload.prompt?.trim()) body.prompt = payload.prompt.trim();
    if (payload.characterOrientation) body.character_orientation = payload.characterOrientation;
    if (typeof payload.cfgScale === 'number') body.cfg_scale = payload.cfgScale;

    return compact(body);
  }

  if (model === 'image-upscaler' || model === 'image-upscaler-precision') {
    const body: Record<string, unknown> = { image: stripDataUrlPrefix(payload.imageUrl?.trim() ?? '') };
    if (model === 'image-upscaler') {
      if (payload.prompt?.trim()) body.prompt = payload.prompt.trim();
      if (payload.upscaleFactor) body.scale_factor = payload.upscaleFactor;
      if (payload.upscaleEngine) body.engine = payload.upscaleEngine;
    }

    return compact(body);
  }

  if (model === 'mystic') {
    const body: Record<string, unknown> = {};
    if (payload.prompt?.trim()) body.prompt = payload.prompt.trim();
    if (payload.imageUrl?.trim()) body.structure_reference = stripDataUrlPrefix(payload.imageUrl.trim());
    if (payload.referenceImageUrls?.[0]?.trim()) body.style_reference = stripDataUrlPrefix(payload.referenceImageUrls[0].trim());
    if (payload.aspectRatio) body.aspect_ratio = toMysticAspectRatio(payload.aspectRatio);
    return compact(body);
  }

  if (model === 'flux-2-turbo') {
    const body: Record<string, unknown> = {};
    if (payload.prompt?.trim()) body.prompt = payload.prompt.trim();
    return compact(body);
  }

  const body: Record<string, unknown> = {};
  if (payload.prompt?.trim()) body.prompt = payload.prompt.trim();
  if (payload.imageUrl?.trim()) body.image_url = payload.imageUrl.trim();
  if (payload.startImageUrl?.trim()) body.start_image_url = payload.startImageUrl.trim();
  if (payload.endImageUrl?.trim()) body.end_image_url = payload.endImageUrl.trim();
  if (payload.referenceImageUrls?.length) body.image_urls = payload.referenceImageUrls.filter((url) => url.trim()).map((url) => url.trim()).slice(0, 4);
  if (payload.aspectRatio) body.aspect_ratio = payload.aspectRatio;
  if (payload.duration) body.duration = payload.duration;
  if (typeof payload.generateAudio === 'boolean') body.generate_audio = payload.generateAudio;

  return compact(body);
}

export function validatePayload(model: ModelId, payload: GeneratePayload): string | null {
  if (model === 'kling-v3-motion-control-std') {
    if (!payload.imageUrl?.trim()) return 'Motion control membutuhkan gambar karakter dari device.';
    if (!payload.videoUrl?.trim()) return 'Motion control membutuhkan video gerakan dari device.';
    return null;
  }

  if (model === 'image-upscaler' || model === 'image-upscaler-precision') {
    if (!payload.imageUrl?.trim()) return 'Upscale image membutuhkan gambar dari device.';
    return null;
  }

  if (model === 'mystic' || model === 'flux-2-turbo') {
    if (!payload.prompt?.trim()) return 'Generate image membutuhkan prompt.';
    return null;
  }

  if (!payload.prompt?.trim() && !payload.imageUrl?.trim() && !payload.startImageUrl?.trim()) {
    return 'Generate video membutuhkan prompt atau gambar awal.';
  }

  return null;
}

export function getAutoPollDelay(attemptIndex: number): number {
  return AUTO_POLL_DELAYS_MS[Math.min(Math.max(0, attemptIndex), AUTO_POLL_DELAYS_MS.length - 1)];
}

export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours} jam ${minutes} menit ${seconds} detik`;
  if (minutes > 0) return `${minutes} menit ${seconds} detik`;
  return `${seconds} detik`;
}

export function formatUploadSelection(count = 0): string {
  return count > 0 ? `${count} file dipilih` : 'Belum ada file';
}

export async function generateVideo(
  model: ModelId,
  payload: GeneratePayload,
  now = Date.now(),
): Promise<ApiResult<MagnificTask>> {
  const validation = validatePayload(model, payload);
  if (validation) return { ok: false, message: validation };

  const body = await buildHostedRequestBody(model, payload);
  const pending = getPendingGenerate(model, body, now);
  if (pending) return { ok: false, message: PENDING_GENERATE_MESSAGE };

  writePendingGenerate({ key: buildGenerateKey(model, body), createdAt: now, expiresAt: now + PENDING_GENERATE_TTL_MS });
  const result = await requestTask(endpoints[model].create, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (result.ok) clearPendingGenerate();
  return result;
}

export async function getTaskStatus(
  model: ModelId,
  taskId: string,
): Promise<ApiResult<MagnificTask>> {
  const id = taskId.trim();
  if (!id) return { ok: false, message: 'Masukkan task ID terlebih dahulu.' };
  return requestTask(`${endpoints[model].status}/${encodeURIComponent(id)}`, { method: 'GET' });
}

async function requestTask(
  path: string,
  init: RequestInit,
): Promise<ApiResult<MagnificTask>> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    const json = await readJson(response);
    if (!response.ok) {
      return { ok: false, message: extractMessage(json) || `Request gagal (${response.status}).` };
    }

    const data = normalizeTask(json);
    if (!data) return { ok: false, message: 'Respons API tidak berisi task_id yang valid.' };

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      message: isFetchFailure(error) ? FETCH_FAILURE_MESSAGE : error instanceof Error ? error.message : 'Tidak bisa menghubungi Magnific API.',
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeTask(value: unknown): MagnificTask | null {
  const root = asRecord(value);
  const candidate = asRecord(root?.data) ?? root;
  const taskId = readString(candidate?.task_id ?? candidate?.id);
  const status = readString(candidate?.status) as TaskStatus | undefined;

  if (!taskId || !status) return null;

  return {
    task_id: taskId,
    status,
    generated: readStringArray(candidate?.generated),
  };
}

function extractMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const root = asRecord(value);
  return readString(root?.message) ?? readString(asRecord(root?.problem)?.message) ?? null;
}

export function getPendingGenerate(model: ModelId, payloadOrBody: GeneratePayload | Record<string, unknown>, now = Date.now()): PendingGenerate | null {
  const raw = window.localStorage.getItem(PENDING_GENERATE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const item = asRecord(parsed);
    if (typeof item?.key !== 'string' || typeof item?.createdAt !== 'number' || typeof item?.expiresAt !== 'number') {
      clearPendingGenerate();
      return null;
    }

    if (item.expiresAt <= now) {
      clearPendingGenerate();
      return null;
    }

    return item.key === buildGenerateKey(model, normalizeGenerateKeyBody(model, payloadOrBody))
      ? { key: item.key, createdAt: item.createdAt, expiresAt: item.expiresAt }
      : null;
  } catch {
    clearPendingGenerate();
    return null;
  }
}

function writePendingGenerate(item: PendingGenerate): void {
  window.localStorage.setItem(PENDING_GENERATE_KEY, JSON.stringify(item));
}

function clearPendingGenerate(): void {
  window.localStorage.removeItem(PENDING_GENERATE_KEY);
}

function buildGenerateKey(model: ModelId, body: Record<string, unknown>): string {
  return `${model}:${JSON.stringify(body)}`;
}

function normalizeGenerateKeyBody(model: ModelId, payloadOrBody: GeneratePayload | Record<string, unknown>): Record<string, unknown> {
  if ('imageUrl' in payloadOrBody || 'videoUrl' in payloadOrBody || 'startImageUrl' in payloadOrBody || 'referenceImageUrls' in payloadOrBody) {
    return buildRequestBody(model, payloadOrBody as GeneratePayload);
  }
  return payloadOrBody;
}

async function buildHostedRequestBody(model: ModelId, payload: GeneratePayload): Promise<Record<string, unknown>> {
  return buildRequestBody(model, await hostDeviceUploads(model, payload));
}

async function hostDeviceUploads(model: ModelId, payload: GeneratePayload): Promise<GeneratePayload> {
  const next: GeneratePayload = { ...payload };

  if (usesPublicImageUrl(model) && isDataUrl(next.imageUrl)) next.imageUrl = await uploadDataUrl(next.imageUrl, 'meowversee-image');
  if (model === 'kling-v3-omni-std' && isDataUrl(next.startImageUrl)) next.startImageUrl = await uploadDataUrl(next.startImageUrl, 'meowversee-start-frame');
  if (model === 'kling-v3-omni-std' && isDataUrl(next.endImageUrl)) next.endImageUrl = await uploadDataUrl(next.endImageUrl, 'meowversee-end-frame');
  if (model === 'kling-v3-motion-control-std' && isDataUrl(next.videoUrl)) next.videoUrl = await uploadDataUrl(next.videoUrl, 'meowversee-motion-video');
  if (model === 'kling-v3-omni-std' && next.referenceImageUrls?.length) {
    next.referenceImageUrls = await Promise.all(next.referenceImageUrls.map((url, index) => isDataUrl(url) ? uploadDataUrl(url, `meowversee-reference-${index + 1}`) : url));
  }

  return next;
}

function usesPublicImageUrl(model: ModelId): boolean {
  return model === 'kling-v3-omni-std' || model === 'kling-v3-motion-control-std';
}

function isDataUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().startsWith('data:');
}

async function uploadDataUrl(dataUrl: string, filename: string): Promise<string> {
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, filename }),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(extractMessage(json) ?? 'Upload file dari device gagal.');
  const url = readString(asRecord(json)?.url);
  if (!url) throw new Error('Upload file tidak mengembalikan URL publik.');
  return url;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') output[key] = value;
  }
  return output;
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  return value.startsWith('data:') && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function toMysticAspectRatio(value: GeneratePayload['aspectRatio']): string {
  if (value === '9:16') return 'social_story_9_16';
  if (value === '16:9') return 'widescreen_16_9';
  if (value === '1:1') return 'square_1_1';
  if (!value || value === 'auto') return 'square_1_1';
  return value;
}

function isFetchFailure(error: unknown): boolean {
  return error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function isCachedHistoryItem(value: unknown): value is CachedHistoryItem {
  const item = asRecord(value);
  const task = asRecord(item?.task);
  const model = item?.model;
  const status = task?.status;

  return (
    typeof model === 'string' &&
    typeof item?.prompt === 'string' &&
    typeof item?.createdAt === 'number' &&
    typeof item?.expiresAt === 'number' &&
    typeof task?.task_id === 'string' &&
    typeof status === 'string'
  );
}
