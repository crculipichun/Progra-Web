// Contador de pasos con el acelerómetro (para seguir el recorrido caminando).

/**
 * Detecta pasos en la magnitud de la aceleración (incluida la gravedad).
 * Compara una media rápida con una lenta: cada pico que supera el umbral,
 * separado al menos `minInterval` ms del anterior, cuenta como un paso.
 */
export class StepCounter {
  constructor({ threshold = 1.1, minInterval = 300 } = {}) {
    this.threshold = threshold;
    this.minInterval = minInterval;
    this.reset();
  }

  reset() {
    this.fast = null;
    this.slow = null;
    this.armed = true;
    this.last = -Infinity;
    this.count = 0;
  }

  /** Devuelve true si esta muestra completa un paso. */
  feed(magnitude, t) {
    if (this.fast === null) {
      this.fast = this.slow = magnitude;
      return false;
    }
    this.fast += (magnitude - this.fast) * 0.3;
    this.slow += (magnitude - this.slow) * 0.02;
    const d = this.fast - this.slow;
    if (this.armed && d > this.threshold && t - this.last >= this.minInterval) {
      this.armed = false;
      this.last = t;
      this.count++;
      return true;
    }
    if (d < 0) this.armed = true;
    return false;
  }
}

export class MotionTracker {
  constructor({ onStep } = {}) {
    this.onStep = onStep;
    this.counter = new StepCounter();
    this.running = false;
    this._handler = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      if (this.counter.feed(Math.hypot(a.x, a.y, a.z), e.timeStamp || performance.now())) {
        this.onStep?.(this.counter.count);
      }
    };
  }

  get supported() {
    return 'DeviceMotionEvent' in window;
  }

  start() {
    if (this.running) return;
    this.counter.reset();
    window.addEventListener('devicemotion', this._handler);
    this.running = true;
  }

  stop() {
    window.removeEventListener('devicemotion', this._handler);
    this.running = false;
  }
}
