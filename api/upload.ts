import type { VercelRequest, VercelResponse } from '@vercel/node';

const FILEDITCH_UPLOAD_URL = 'https://new.fileditch.com/upload.php';
const DATA_URL_PATTERN = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s;

export type HostedUpload = {
  url: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const dataUrl = typeof request.body?.dataUrl === 'string' ? request.body.dataUrl : '';
  const filename = typeof request.body?.filename === 'string' ? request.body.filename : 'meowversee-upload';
  const file = dataUrlToFile(dataUrl, filename);

  if (!file) {
    response.status(400).json({ message: 'Upload dari device tidak valid.' });
    return;
  }

  try {
    const upstream = await fetch(`${FILEDITCH_UPLOAD_URL}?filename=${encodeURIComponent(file.filename)}`, {
      method: 'POST',
      headers: {
        'content-type': file.contentType,
        'x-filename': file.filename,
      },
      body: new Uint8Array(file.bytes),
    });
    const text = await upstream.text();
    const json = parseJson(text);

    if (!upstream.ok) {
      response.status(upstream.status).json({ message: readString(asRecord(json)?.error) ?? readString(asRecord(json)?.message) ?? 'Upload file gagal.' });
      return;
    }

    const uploadedUrl = readString(asRecord(json)?.url);
    if (!uploadedUrl) {
      response.status(502).json({ message: 'Upload file tidak mengembalikan URL publik.' });
      return;
    }

    response.status(200).json({ url: uploadedUrl } satisfies HostedUpload);
  } catch (error) {
    response.status(502).json({ message: error instanceof Error ? error.message : 'Upload file gagal.' });
  }
}

export function dataUrlToFile(dataUrl: string, filename: string): { bytes: Buffer; contentType: string; filename: string } | null {
  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) return null;

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) return null;

  return {
    bytes,
    contentType: match[1].toLowerCase(),
    filename: safeFilename(filename, match[1]),
  };
}

function safeFilename(filename: string, contentType: string): string {
  const trimmed = filename.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const fallback = `meowversee-upload.${extensionForContentType(contentType)}`;
  return trimmed || fallback;
}

function extensionForContentType(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  return 'bin';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
