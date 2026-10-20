// Captura de posición GPS con watchPosition y promediado de lecturas.
import { averageFixes } from './geo.js';

export class GpsCapture {
  constructor({ onFix, onError } = {}) {
    this.onFix = onFix;
    this.onError = onError;
    this.watchId = null;
    this.last = null;
    this.collectors = new Set();
  }

  get supported() {
    return 'geolocation' in navigator;
  }

  start() {
    if (!this.supported) {
      this.onError?.(new Error('Este dispositivo no tiene GPS disponible en el navegador.'));
      return;
    }
    if (this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          time: pos.timestamp,
        };
        this.last = fix;
        for (const c of this.collectors) c.push(fix);
        this.onFix?.(fix);
      },
      (err) => this.onError?.(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.collectors.clear();
  }

  /** Reúne lecturas durante `ms` milisegundos y devuelve su promedio ponderado. */
  sampleAverage(ms = 4000, onProgress) {
    return new Promise((resolve) => {
      const list = [];
      this.collectors.add(list);
      const t0 = Date.now();
      const tick = setInterval(() => onProgress?.(Math.min(1, (Date.now() - t0) / ms), list.length), 200);
      setTimeout(() => {
        clearInterval(tick);
        this.collectors.delete(list);
        // Si no llegó ninguna lectura nueva, usa la última si es reciente.
        if (!list.length && this.last && Date.now() - this.last.time < 10000) list.push(this.last);
        resolve(averageFixes(list));
      }, ms);
    });
  }
}
