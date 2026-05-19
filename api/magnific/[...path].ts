import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAGNIFIC_BASE_URL = 'https://api.magnific.com';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const target = buildMagnificTargetUrl(Array.isArray(request.query.path) ? request.query.path : [String(request.query.path ?? '')]);

  for (const [key, value] of Object.entries(request.query)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      for (const item of value) target.searchParams.append(key, item);
    } else if (typeof value === 'string') {
      target.searchParams.set(key, value);
    }
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: buildHeaders(request),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body ?? {}),
    });

    response.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) response.setHeader(key, value);
    });

    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.status(502).json({
      message: error instanceof Error ? error.message : 'Magnific proxy gagal menghubungi upstream.',
    });
  }
}

export function buildMagnificTargetUrl(segments: string[]): URL {
  const cleanPath = segments
    .filter(Boolean)
    .map((segment) => segment.split('/').filter(Boolean).map(encodeURIComponent).join('/'))
    .join('/');

  return new URL(`/${cleanPath}`, MAGNIFIC_BASE_URL);
}

function buildHeaders(request: VercelRequest): Headers {
  const headers = new Headers();
  const apiKey = process.env.MAGNIFIC_API_KEY;

  headers.set('content-type', 'application/json');
  if (apiKey) headers.set('x-magnific-api-key', apiKey);

  return headers;
}
