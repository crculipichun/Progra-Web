// Cámara trasera + sensores de orientación.
import { cameraVector, deviceTopVector, deviceRightVector, vectorToAngles, walkBearing } from './geo.js';

const SMOOTH = 0.2;
const smooth = (prev, v) => (prev
  ? { x: prev.x + (v.x - prev.x) * SMOOTH, y: prev.y + (v.y - prev.y) * SMOOTH, z: prev.z + (v.z - prev.z) * SMOOTH }
  : v);

export class CameraCapture {
  constructor(video, { onReading, onError } = {}) {
    this.video = video;
    this.onReading = onReading;
    this.onError = onError;
    this.stream = null;
    this.cam = null; // vector de la cámara suavizado
    this.top = null; // vector superior suavizado
    this.right = null; // vector derecho suavizado
    this.lastRelative = 0;
    this._relative = (e) => this._onOrientation(e, true);
    this._absolute = (e) => this._onOrientation(e, false);
  }

  /** Debe llamarse desde un gesto del usuario (requisito de iOS). */
  async start() {
    // iOS 13+: el permiso de movimiento debe pedirse antes de cualquier otro await.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') throw new Error('denied');
      } catch {
        this.onError?.(new Error('Sin permiso para los sensores de movimiento.'));
      }
    }

    // Se prefiere la orientación relativa (giroscopio): en interiores la brújula
    // se desvía con las estructuras metálicas. La absoluta solo se usa si no hay otra.
    window.addEventListener('deviceorientation', this._relative);
    window.addEventListener('deviceorientationabsolute', this._absolute);

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    } catch {
      this.onError?.(new Error('No se pudo abrir la cámara. Puedes seguir midiendo solo con los sensores.'));
    }
  }

  stop() {
    window.removeEventListener('deviceorientation', this._relative);
    window.removeEventListener('deviceorientationabsolute', this._absolute);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.cam = this.top = this.right = null;
  }

  _onOrientation(e, relative) {
    if (e.alpha === null || e.beta === null) return;
    const now = performance.now();
    if (relative) this.lastRelative = now;
    else if (now - this.lastRelative < 1000) return;
    this.cam = smooth(this.cam, cameraVector(e.alpha, e.beta, e.gamma));
    this.top = smooth(this.top, deviceTopVector(e.alpha, e.beta));
    this.right = smooth(this.right, deviceRightVector(e.alpha, e.beta, e.gamma));
    this.onReading?.({
      ...vectorToAngles(this.cam),
      heading: walkBearing(this.cam, this.top),
      cam: this.cam, top: this.top, right: this.right,
    });
  }
}
