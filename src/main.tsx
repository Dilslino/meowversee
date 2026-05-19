import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Cat, CheckCircle2, ExternalLink, Film, ImagePlus, KeyRound, Loader2 } from 'lucide-react';
import './styles.css';
import {
  CachedHistoryItem,
  GeneratePayload,
  MagnificTask,
  ModelId,
  cacheHistoryItem,
  formatElapsedTime,
  generateVideo,
  getAutoPollDelay,
  getCachedHistory,
  getStoredApiKey,
  getTaskStatus,
  storeApiKey,
  updateCachedHistoryTask,
} from './api';

const modelCopy: Record<ModelId, { title: string }> = {
  omni: { title: 'Kling 3 Omni' },
  motion: { title: 'Kling Motion v3' },
};
const MAX_AUTO_POLL_ATTEMPTS = 240;
const FINAL_STATUSES = new Set<MagnificTask['status']>(['COMPLETED', 'FAILED']);


export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<ModelId>('omni');
  const [prompt, setPrompt] = useState('A tiny white cat astronaut drifts through a pastel pink nebula, cinematic soft light');
  const [imageUrl, setImageUrl] = useState('');
  const [startImageUrl, setStartImageUrl] = useState('');
  const [endImageUrl, setEndImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState<GeneratePayload['aspectRatio']>('16:9');
  const [duration, setDuration] = useState('5');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [characterOrientation, setCharacterOrientation] = useState<'video' | 'image'>('video');
  const [cfgScale, setCfgScale] = useState(0.5);
  const [taskId, setTaskId] = useState('');
  const [task, setTask] = useState<MagnificTask | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<CachedHistoryItem[]>([]);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setApiKey(getStoredApiKey());
    setHistory(getCachedHistory());
  }, []);

  useEffect(() => {
    if (generationStartedAt === null || task?.status === 'COMPLETED' || task?.status === 'FAILED') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, task?.status]);

  const maskedKey = useMemo(() => (apiKey ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}` : 'Belum tersimpan'), [apiKey]);
  const imagePreviewCount = referenceImageUrls.length + (imageUrl ? 1 : 0) + (startImageUrl ? 1 : 0) + (endImageUrl ? 1 : 0);

  function handleKeySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    storeApiKey(apiKey);
    setApiKey(getStoredApiKey());
    setMessage(apiKey.trim() ? 'API key tersimpan di cache browser.' : 'API key dihapus dari cache browser.');
  }

  async function handleImageUpload(target: 'image' | 'start' | 'end' | 'reference' | 'video', files: FileList | null) {
    if (!files?.length) return;
    const urls = await Promise.all(Array.from(files).slice(0, target === 'reference' ? 4 : 1).map(readFileAsDataUrl));

    if (target === 'image') setImageUrl(urls[0]);
    if (target === 'start') setStartImageUrl(urls[0]);
    if (target === 'end') setEndImageUrl(urls[0]);
    if (target === 'video') setVideoUrl(urls[0]);
    if (target === 'reference') setReferenceImageUrls(urls.slice(0, 4));
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
      reader.addEventListener('error', () => reject(reader.error ?? new Error('Gagal membaca file.')));
      reader.readAsDataURL(file);
    });
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    const payload: GeneratePayload = {
      prompt,
      imageUrl,
      startImageUrl,
      endImageUrl,
      videoUrl,
      referenceImageUrls,
      aspectRatio,
      duration,
      generateAudio,
      characterOrientation,
      cfgScale,
    };

    const result = await generateVideo(apiKey, model, payload);
    setLoading(false);

    if (!result.ok || !result.data) {
      setMessage(result.message ?? 'Gagal membuat task video.');
      return;
    }

    const startedAt = Date.now();
    setGenerationStartedAt(startedAt);
    setNow(startedAt);
    setTask(result.data);
    void pollTaskUntilFinished(result.data.task_id, model, startedAt);
    setTaskId(result.data.task_id);
    setHistory(cacheHistoryItem(model, result.data, prompt));
    setMessage('Task dibuat. Timer berjalan, Meowversee cek otomatis.');
  }

  async function pollTaskUntilFinished(nextTaskId: string, nextModel: ModelId, startedAt: number) {
    for (let attempt = 0; attempt < MAX_AUTO_POLL_ATTEMPTS; attempt += 1) {
      const delay = getAutoPollDelay(attempt);
      if (delay > 0) await wait(delay);
      const result = await getTaskStatus(apiKey, nextModel, nextTaskId);
      if (!result.ok || !result.data) {
        setMessage(result.message ?? 'Task sudah dibuat, tapi status otomatis belum bisa dibaca. Meowversee akan coba lagi otomatis.');
        continue;
      }

      setTask(result.data);
      setTaskId(result.data.task_id);
      setHistory(updateCachedHistoryTask(nextModel, result.data));

      if (result.data.generated?.length) {
        setNow(Date.now());
        setMessage('Video selesai. Hasil muncul di history.');
        return;
      }

      if (FINAL_STATUSES.has(result.data.status)) {
        setMessage(result.data.status === 'FAILED' ? 'Generate gagal di Magnific. Limit tidak akan diklik ulang otomatis.' : 'Video selesai, tapi URL hasil belum dikirim Magnific.');
        return;
      }

      setMessage(`Status terbaru: ${result.data.status}. Sudah berjalan ${formatElapsedTime(Date.now() - startedAt)}. Meowversee masih cek otomatis.`);
    }

    setMessage('Task masih diproses lama oleh Magnific. Buka lagi nanti, history tetap tersimpan 24 jam.');
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function renderImagePreview(label: string, url: string) {
    if (!url) return null;
    return (
      <figure className="preview-card">
        <img src={url} alt={`${label} preview`} />
        <figcaption>{label}</figcaption>
      </figure>
    );
  }

  function renderVideoPreview(label: string, url: string) {
    if (!url) return null;
    return (
      <figure className="preview-card video-preview">
        <video src={url} controls muted playsInline />
        <figcaption>{label}</figcaption>
      </figure>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="brand-pill"><Cat size={18} /> meowversee</div>
        <div className="hero-grid">
          <div className="hero-center">
            <h1 id="hero-title">meowversee studio</h1>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Generator video">
        <aside className="panel key-panel">
          <div className="section-title"><KeyRound size={20} /> API Key</div>
          <p className="muted">Key hanya disimpan di localStorage browser ini. Tidak ada server backend di Meowversee.</p>
          <form onSubmit={handleKeySave} className="stack">
            <label>
              API key Magnific
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="mgf_..."
                autoComplete="off"
              />
            </label>
            <button type="submit" className="secondary-button">Simpan ke cache</button>
          </form>
          <div className="cache-note"><CheckCircle2 size={18} /> {maskedKey}</div>
          <div className="tutorial-card" aria-label="Tutorial ambil API key Magnific">
            <strong>Cara ambil API key</strong>
            <ol>
              <li>Buka <a href="https://www.magnific.com/developers/dashboard/limits" target="_blank" rel="noreferrer">halaman API Magnific</a>.</li>
              <li>Login ke akun Magnific kamu.</li>
              <li>Masuk ke bagian developer / limits.</li>
              <li>Copy API key yang muncul di dashboard.</li>
              <li>Paste di kolom ini, lalu tekan <b>Simpan ke cache</b>.</li>
            </ol>
            <p>Key tersimpan hanya di browser device ini. Kalau ganti HP/browser, paste lagi.</p>
          </div>
        </aside>

        <section className="panel generator-panel">
          <div className="tabs" role="tablist" aria-label="Pilih model Kling">
            {(Object.keys(modelCopy) as ModelId[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={model === item}
                className={model === item ? 'tab active' : 'tab'}
                onClick={() => setModel(item)}
              >
                {modelCopy[item].title}
              </button>
            ))}
          </div>

          <form onSubmit={handleGenerate} className="form-grid">
            <label className="wide">
              Prompt
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2500} rows={5} />
            </label>

            {model === 'omni' ? (
              <>
                <label className="upload-card">
                  <ImagePlus size={18} />
                  Upload image utama
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImageUpload('image', event.target.files)} />
                </label>
                {renderImagePreview('Image utama', imageUrl)}
                <label className="upload-card">
                  <ImagePlus size={18} />
                  Upload start frame
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImageUpload('start', event.target.files)} />
                </label>
                {renderImagePreview('Start frame', startImageUrl)}
                <label className="upload-card">
                  <ImagePlus size={18} />
                  Upload end frame
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImageUpload('end', event.target.files)} />
                </label>
                {renderImagePreview('End frame', endImageUrl)}
                <label className="upload-card wide">
                  <ImagePlus size={18} />
                  Foto referensi style / karakter (maks 4)
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void handleImageUpload('reference', event.target.files)} />
                </label>
                {referenceImageUrls.length > 0 && (
                  <div className="preview-grid wide" aria-label="Preview foto referensi">
                    {referenceImageUrls.map((url, index) => renderImagePreview(`Referensi ${index + 1}`, url))}
                  </div>
                )}
                <div className="upload-note wide">{imagePreviewCount} image siap dipakai dari device.</div>
                <label>
                  Aspect ratio
                  <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as GeneratePayload['aspectRatio'])}>
                    <option value="16:9">16:9 Landscape</option>
                    <option value="9:16">9:16 Portrait</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="auto">Auto</option>
                  </select>
                </label>
                <label>
                  Durasi
                  <select value={duration} onChange={(event) => setDuration(event.target.value)}>
                    {Array.from({ length: 13 }, (_, index) => String(index + 3)).map((item) => (
                      <option key={item} value={item}>{item} detik</option>
                    ))}
                  </select>
                </label>
                <label className="switch-row">
                  <input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} />
                  Generate audio native
                </label>
              </>
            ) : (
              <>
                <label className="upload-card">
                  <ImagePlus size={18} />
                  Upload character image
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleImageUpload('image', event.target.files)} />
                </label>
                {renderImagePreview('Character image', imageUrl)}
                <label className="upload-card">
                  <ImagePlus size={18} />
                  Upload motion video
                  <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => void handleImageUpload('video', event.target.files)} />
                </label>
                {renderVideoPreview('Motion video', videoUrl)}
                <label>
                  Orientasi karakter
                  <select value={characterOrientation} onChange={(event) => setCharacterOrientation(event.target.value as 'video' | 'image')}>
                    <option value="video">Ikuti video</option>
                    <option value="image">Ikuti gambar</option>
                  </select>
                </label>
                <label>
                  CFG scale: {cfgScale.toFixed(1)}
                  <input type="range" min="0" max="1" step="0.1" value={cfgScale} onChange={(event) => setCfgScale(Number(event.target.value))} />
                </label>
              </>
            )}

            <button type="submit" className="primary-button wide" disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Film size={18} />}
              Generate video <ArrowRight size={18} />
            </button>
          </form>
        </section>

        <aside className="panel result-panel">
          <div className="section-title"><Film size={20} /> History hasil</div>
          {message && <p className="message" role="status">{message}</p>}
          {task && (
            <div className="task-card">
              <span className={`status ${task.status.toLowerCase()}`}>{task.status}</span>
              <code>{task.task_id}</code>
              {generationStartedAt !== null && (
                <span className="elapsed-time">Berjalan {formatElapsedTime(now - generationStartedAt)}</span>
              )}
              {task.generated?.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="video-link">Buka hasil video <ExternalLink size={15} /></a>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="history-list" aria-label="History generate 24 jam">
              <strong>History 24 jam</strong>
              {history.map((item) => (
                <button
                  key={item.task.task_id}
                  type="button"
                  className="history-item"
                  onClick={() => {
                    setModel(item.model);
                    setTask(item.task);
                    setTaskId(item.task.task_id);
                    setPrompt(item.prompt);
                  }}
                >
                  <span>{modelCopy[item.model].title}</span>
                  <code>{item.task.task_id}</code>
                  <em>{item.task.status}</em>
                </button>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
