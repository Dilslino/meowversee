import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Cat, CheckCircle2, ExternalLink, Film, KeyRound, Loader2, Sparkles } from 'lucide-react';
import './styles.css';
import {
  GeneratePayload,
  MagnificTask,
  ModelId,
  generateVideo,
  getStoredApiKey,
  getTaskStatus,
  storeApiKey,
} from './api';

const modelCopy: Record<ModelId, { title: string; eyebrow: string; description: string }> = {
  omni: {
    title: 'Kling 3 Omni',
    eyebrow: 'Text / image to video',
    description: 'Cocok untuk prompt sinematik, start frame, end frame, aspek rasio, durasi, dan audio native.',
  },
  motion: {
    title: 'Kling Motion v3',
    eyebrow: 'Motion transfer',
    description: 'Masukkan gambar karakter dan video referensi untuk memindahkan gerakan ke subjek utama.',
  },
};

function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<ModelId>('omni');
  const [prompt, setPrompt] = useState('A tiny white cat astronaut drifts through a pastel pink nebula, cinematic soft light');
  const [imageUrl, setImageUrl] = useState('');
  const [startImageUrl, setStartImageUrl] = useState('');
  const [endImageUrl, setEndImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [aspectRatio, setAspectRatio] = useState<GeneratePayload['aspectRatio']>('16:9');
  const [duration, setDuration] = useState('5');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [characterOrientation, setCharacterOrientation] = useState<'video' | 'image'>('video');
  const [cfgScale, setCfgScale] = useState(0.5);
  const [taskId, setTaskId] = useState('');
  const [task, setTask] = useState<MagnificTask | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setApiKey(getStoredApiKey());
  }, []);

  const current = modelCopy[model];
  const maskedKey = useMemo(() => (apiKey ? `${apiKey.slice(0, 6)}••••${apiKey.slice(-4)}` : 'Belum tersimpan'), [apiKey]);

  function handleKeySave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    storeApiKey(apiKey);
    setApiKey(getStoredApiKey());
    setMessage(apiKey.trim() ? 'API key tersimpan di cache browser.' : 'API key dihapus dari cache browser.');
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

    setTask(result.data);
    setTaskId(result.data.task_id);
    setMessage('Task berhasil dibuat. Gunakan cek status untuk melihat hasil video.');
  }

  async function handleCheckStatus() {
    setLoading(true);
    setMessage('');
    const result = await getTaskStatus(apiKey, model, taskId);
    setLoading(false);

    if (!result.ok || !result.data) {
      setMessage(result.message ?? 'Gagal membaca status task.');
      return;
    }

    setTask(result.data);
    setMessage(`Status terbaru: ${result.data.status}.`);
  }

  return (
    <main className="page-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="brand-pill"><Cat size={18} /> meowversee</div>
        <div className="hero-grid">
          <div>
            <p className="kicker">meowversee studio</p>
            <h1 id="hero-title">Kling video, soft and simple.</h1>
            <div className="hero-actions">
              <a className="doc-link" href="https://www.magnific.com/developers/dashboard/limits" target="_blank" rel="noreferrer">
                API limits <ExternalLink size={16} />
              </a>
            </div>
          </div>
          <div className="hero-card" aria-label="Ringkasan model aktif">
            <Sparkles className="hero-spark" size={30} />
            <span>{current.eyebrow}</span>
            <strong>{current.title}</strong>
            <p>{current.description}</p>
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
                <label>
                  Image URL opsional
                  <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://.../start.png" />
                </label>
                <label>
                  Start image URL opsional
                  <input value={startImageUrl} onChange={(event) => setStartImageUrl(event.target.value)} placeholder="https://.../first.png" />
                </label>
                <label>
                  End image URL opsional
                  <input value={endImageUrl} onChange={(event) => setEndImageUrl(event.target.value)} placeholder="https://.../last.png" />
                </label>
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
                <label>
                  Character image URL
                  <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://.../character.webp" />
                </label>
                <label>
                  Motion video URL
                  <input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://.../motion.mp4" />
                </label>
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
          <div className="section-title"><Film size={20} /> Hasil task</div>
          <label>
            Task ID
            <input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="Task ID dari Magnific" />
          </label>
          <button type="button" className="secondary-button" onClick={handleCheckStatus} disabled={loading}>Cek status</button>
          {message && <p className="message" role="status">{message}</p>}
          {task && (
            <div className="task-card">
              <span className={`status ${task.status.toLowerCase()}`}>{task.status}</span>
              <code>{task.task_id}</code>
              {task.generated?.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="video-link">Buka hasil video <ExternalLink size={15} /></a>
              ))}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
