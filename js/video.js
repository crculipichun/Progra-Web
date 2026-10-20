// Grabación del video de la cámara y utilidades para revisarlo fotograma a fotograma.

const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export class VideoRecorder {
  get supported() {
    return typeof window.MediaRecorder === 'function';
  }

  /** Empieza a grabar `stream`. Devuelve el instante de inicio (performance.now()). */
  start(stream) {
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_500_000 });
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(1000);
    return performance.now();
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Detiene la grabación y devuelve el video como Blob. */
  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'video/webm' }));
      this.recorder.stop();
    });
  }
}

/**
 * Los WebM de MediaRecorder no indican su duración y no se pueden recorrer.
 * Buscar un instante enorme obliga al navegador a calcularla.
 */
export function prepareSeekable(video) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('durationchange', check);
      video.currentTime = 0;
      resolve(video.duration);
    };
    const check = () => { if (Number.isFinite(video.duration)) done(); };
    video.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(video.duration)) return done();
      video.addEventListener('durationchange', check);
      video.currentTime = 1e7;
    }, { once: true });
  });
}

/** Busca en `log` (ordenado por t) la muestra más cercana a `t`. */
export function sampleAt(log, t) {
  if (!log.length) return null;
  let lo = 0, hi = log.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(log[lo - 1].t - t) < Math.abs(log[lo].t - t)) lo--;
  return log[lo];
}

export function formatTime(s) {
  if (!Number.isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
