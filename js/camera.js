// Cámara trasera + sensores de orientación para medir esquinas desde un punto.
import { cameraVector, vectorToAngles } from './geo.js';

export class CameraCapture {
  constructor(video, { onReading, onError } = {}) {
    this.video = video;
    this.onReading = onReading;
    this.onError = onError;
    this.stream = null;
    this.vec = null; // vector suavizado
    this.eventName = null;
    this.absolute = false;
    this._handler = (e) => this._onOrientation(e);
  }

  /** Debe llamarse desde un gesto del usuario (requisito de iOS). */
  async start() {
    // iOS 13+: el permiso de orientación debe pedirse antes de cualquier otro await.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') throw new Error('denied');
      } catch {
        this.onError?.(new Error('Sin permiso para los sensores de movimiento.'));
      }
    }

    this.absolute = 'ondeviceorientationabsolute' in window;
    this.eventName = this.absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(this.eventName, this._handler);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    } catch (err) {
      this.onError?.(new Error('No se pudo abrir la cámara. Puedes seguir midiendo solo con los sensores.'));
    }
  }

  stop() {
    if (this.eventName) window.removeEventListener(this.eventName, this._handler);
    this.eventName = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.vec = null;
  }

  _onOrientation(e) {
    if (e.alpha === null && e.beta === null) return;
    // Para un plano solo importan los ángulos relativos entre esquinas, así que
    // basta con que alpha sea coherente durante la sesión (no hace falta el norte real).
    const v = cameraVector(e.alpha, e.beta, e.gamma);
    if (!this.vec) this.vec = v;
    else {
      // Filtro paso bajo sobre el vector (evita saltos de 359° a 0°).
      const k = 0.2;
      this.vec = {
        x: this.vec.x + (v.x - this.vec.x) * k,
        y: this.vec.y + (v.y - this.vec.y) * k,
        z: this.vec.z + (v.z - this.vec.z) * k,
      };
    }
    this.onReading?.({ ...vectorToAngles(this.vec), absolute: this.absolute || e.absolute === true });
  }
}
