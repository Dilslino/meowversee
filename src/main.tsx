import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Cat, ExternalLink, Film, ImagePlus, Loader2 } from 'lucide-react';
import './styles.css';
import {
  CachedHistoryItem,
  GeneratePayload,
  MagnificTask,
  ModelId,
  StudioMode,
  cacheHistoryItem,
  formatElapsedTime,
  formatUploadSelection,
  getDefaultModelForMode,
  generateVideo,
  getAutoPollDelay,
  getCachedHistory,
  getMagnificModelsForMode,
  MAGNIFIC_MODELS,
  MAGNIFIC_MODE_COPY,
  getTaskStatus,
  updateCachedHistoryTask,
} from './api';

const modeOrder: StudioMode[] = ['video', 'motion', 'image', 'upscale'];
const MAX_AUTO_POLL_ATTEMPTS = 240;
const FINAL_STATUSES = new Set<MagnificTask['status']>(['COMPLETED', 'FAILED']);


export default function App() {
  const [mode, setMode] = useState<StudioMode>('video');
  const [model, setModel] = useState<ModelId>(getDefaultModelForMode('video'));
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
  const [upscaleFactor, setUpscaleFactor] = useState<GeneratePayload['upscaleFactor']>('2x');
  const [upscaleEngine, setUpscaleEngine] = useState<GeneratePayload['upscaleEngine']>('automatic');
  const [taskId, setTaskId] = useState('');
  const [task, setTask] = useState<MagnificTask | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<CachedHistoryItem[]>([]);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [uploadCounts, setUploadCounts] = useState<Record<'image' | 'start' | 'end' | 'reference' | 'video', number>>({
    image: 0,
    start: 0,
    end: 0,
    reference: 0,
    video: 0,
  });

  useEffect(() => {
    setHistory(getCachedHistory());
  }, []);

  useEffect(() => {
    if (generationStartedAt === null || task?.status === 'COMPLETED' || task?.status === 'FAILED') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generationStartedAt, task?.status]);

  const imagePreviewCount = referenceImageUrls.length + (imageUrl ? 1 : 0) + (startImageUrl ? 1 : 0) + (endImageUrl ? 1 : 0);
  const availableModels = getMagnificModelsForMode(mode);
  const selectedModeCopy = MAGNIFIC_MODE_COPY[mode];

  function handleModeChange(nextMode: StudioMode) {
    setMode(nextMode);
    setModel(getDefaultModelForMode(nextMode));
    setTask(null);
    setTaskId('');
    setMessage('');
  }



  async function handleImageUpload(target: 'image' | 'start' | 'end' | 'reference' | 'video', files: FileList | null) {
    if (!files?.length) return;
    const urls = await Promise.all(Array.from(files).slice(0, target === 'reference' ? 4 : 1).map(readFileAsDataUrl));

    setUploadCounts((counts) => ({ ...counts, [target]: files.length }));
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
      upscaleFactor,
      upscaleEngine,
    };

    const result = await generateVideo(model, payload);
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
      const result = await getTaskStatus(nextModel, nextTaskId);
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

  function getResultKind(itemModel: ModelId): 'video' | 'image' {
    return itemModel === 'kling-v3-omni-std' || itemModel === 'kling-v3-motion-control-std' ? 'video' : 'image';
  }

  function getBeforeImageForHistory(itemModel: ModelId): string {
    return itemModel === 'image-upscaler' || itemModel === 'image-upscaler-precision' ? imageUrl : '';
  }

  function renderResultPreview(url: string, itemModel: ModelId, label: string) {
    return getResultKind(itemModel) === 'video' ? (
      <video src={url} controls muted playsInline />
    ) : (
      <img src={url} alt={label} />
    );
  }

  function renderUpscaleCompare(beforeUrl: string, afterUrl: string) {
    if (!beforeUrl) return <img src={afterUrl} alt="Hasil upscale" />;
    return (
      <div className="compare-card">
        <img src={beforeUrl} alt="Before upscale" />
        <img className="compare-after" src={afterUrl} alt="After upscale" />
        <input className="compare-slider" type="range" min="0" max="100" defaultValue="50" aria-label="Geser before after upscale" onInput={(event) => {
          event.currentTarget.parentElement?.style.setProperty('--split', `${event.currentTarget.value}%`);
        }} />
      </div>
    );
  }

  function renderUploadControl(
    target: 'image' | 'start' | 'end' | 'reference' | 'video',
    label: string,
    accept: string,
    multiple = false,
    wide = false,
  ) {
    return (
      <label className={wide ? 'upload-card wide' : 'upload-card'}>
        <ImagePlus size={18} aria-hidden="true" />
        <span className="upload-title">{label}</span>
        <span className="upload-pill">Pilih dari device</span>
        <span className="upload-selected">{formatUploadSelection(uploadCounts[target])}</span>
        <input type="file" accept={accept} multiple={multiple} onChange={(event) => void handleImageUpload(target, event.target.files)} />
      </label>
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

        <section className="panel generator-panel">
          <div className="tabs" role="tablist" aria-label="Pilih fitur Magnific">
            {modeOrder.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={mode === item ? 'tab active' : 'tab'}
                onClick={() => handleModeChange(item)}
              >
                {MAGNIFIC_MODE_COPY[item].title}
              </button>
            ))}
          </div>

          <label className="wide">
            Model AI Magnific
            <select value={model} onChange={(event) => setModel(event.target.value as ModelId)}>
              {availableModels.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>

          <form onSubmit={handleGenerate} className="form-grid">
            <label className="wide">
              Prompt
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2500} rows={5} />
            </label>

            {mode === 'video' ? (
              <>
                {renderUploadControl('image', 'Upload image utama', 'image/png,image/jpeg,image/webp')}
                {renderImagePreview('Image utama', imageUrl)}
                {renderUploadControl('start', 'Upload start frame', 'image/png,image/jpeg,image/webp')}
                {renderImagePreview('Start frame', startImageUrl)}
                {renderUploadControl('end', 'Upload end frame', 'image/png,image/jpeg,image/webp')}
                {renderImagePreview('End frame', endImageUrl)}
                {renderUploadControl('reference', 'Foto referensi style / karakter (maks 4)', 'image/png,image/jpeg,image/webp', true, true)}
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
            ) : mode === 'motion' ? (
              <>
                {renderUploadControl('image', 'Upload character image', 'image/png,image/jpeg,image/webp')}
                {renderImagePreview('Character image', imageUrl)}
                {renderUploadControl('video', 'Upload motion video', 'video/mp4,video/webm,video/quicktime')}
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
            ) : mode === 'image' ? (
              <>
                {model === 'mystic' && renderUploadControl('image', 'Upload structure reference (opsional)', 'image/png,image/jpeg,image/webp')}
                {model === 'mystic' && renderImagePreview('Structure reference', imageUrl)}
                {model === 'mystic' && renderUploadControl('reference', 'Upload style reference (opsional)', 'image/png,image/jpeg,image/webp')}
                {model === 'mystic' && referenceImageUrls[0] && renderImagePreview('Style reference', referenceImageUrls[0])}
                {model === 'mystic' && (
                  <label>
                    Aspect ratio
                    <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as GeneratePayload['aspectRatio'])}>
                      <option value="square_1_1">Square 1:1</option>
                      <option value="social_story_9_16">Story 9:16</option>
                      <option value="widescreen_16_9">Widescreen 16:9</option>
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                {renderUploadControl('image', 'Upload image untuk upscale', 'image/png,image/jpeg,image/webp')}
                {renderImagePreview('Image untuk upscale', imageUrl)}
                {model === 'image-upscaler' && (
                  <>
                    <label>
                      Scale factor
                      <select value={upscaleFactor} onChange={(event) => setUpscaleFactor(event.target.value as GeneratePayload['upscaleFactor'])}>
                        <option value="2x">2x</option>
                        <option value="4x">4x</option>
                        <option value="8x">8x</option>
                        <option value="16x">16x</option>
                      </select>
                    </label>
                    <label>
                      Engine
                      <select value={upscaleEngine} onChange={(event) => setUpscaleEngine(event.target.value as GeneratePayload['upscaleEngine'])}>
                        <option value="automatic">Automatic</option>
                        <option value="magnific_illusio">Magnific Illusio</option>
                        <option value="magnific_sharpy">Magnific Sharpy</option>
                        <option value="magnific_sparkle">Magnific Sparkle</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}

            <button type="submit" className="primary-button wide" disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Film size={18} />}
              {selectedModeCopy.button} <ArrowRight size={18} />
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
                <div key={url} className="result-preview">
                  {model === 'image-upscaler' || model === 'image-upscaler-precision'
                    ? renderUpscaleCompare(getBeforeImageForHistory(model), url)
                    : renderResultPreview(url, model, 'Preview hasil')}
                  <a href={url} download target="_blank" rel="noreferrer" className="download-button">Download hasil <ExternalLink size={15} /></a>
                </div>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="history-list" aria-label="History generate 24 jam">
              <strong>History 24 jam</strong>
              {history.map((item) => {
                const resultUrl = item.task.generated?.[0];
                return (
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
                    {resultUrl && (
                      <div className="history-preview">
                        {item.model === 'image-upscaler' || item.model === 'image-upscaler-precision'
                          ? renderUpscaleCompare(getBeforeImageForHistory(item.model), resultUrl)
                          : renderResultPreview(resultUrl, item.model, `Preview ${item.task.task_id}`)}
                      </div>
                    )}
                    <span>{MAGNIFIC_MODELS.find((modelItem) => modelItem.id === item.model)?.title ?? item.model}</span>
                    <code>{item.task.task_id}</code>
                    <em>{item.task.status}</em>
                    {resultUrl && <a href={resultUrl} download target="_blank" rel="noreferrer" className="download-button" onClick={(event) => event.stopPropagation()}>Download</a>}
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
