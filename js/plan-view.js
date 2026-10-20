// Vista SVG de un plano: cuadrícula, lados acotados, vértices arrastrables,
// desplazamiento y zoom con uno/dos dedos o la rueda del ratón.
import { bounds, niceStep, segments, signedArea, formatLength } from './geo.js';

const esc = (n) => n.toFixed(1);

export class PlanView {
  /**
   * @param {SVGSVGElement} svg
   * @param {object} opts
   *   editable   – permite arrastrar vértices
   *   interactive – permite desplazar/hacer zoom (por defecto true)
   *   autoFit    – reencuadra en cada actualización
   *   onChange(points, {live}) – al mover un vértice
   *   onSelect(index)          – al tocar un vértice
   *   onTap(worldPoint)        – al tocar una zona vacía
   *   onDragStart()            – antes de empezar a mover un vértice
   */
  constructor(svg, opts = {}) {
    this.svg = svg;
    this.opts = { editable: false, interactive: true, autoFit: false, ...opts };
    this.points = [];
    this.closed = true;
    this.selected = -1;
    this.extras = {};
    this.scale = 40;
    this.tx = 0;
    this.ty = 0;
    this.userMoved = false;
    this.pointers = new Map();
    this.drag = null;
    if (this.opts.interactive) this._bind();
    new ResizeObserver(() => this.refresh()).observe(svg);
  }

  get width() { return this.svg.clientWidth || 320; }
  get height() { return this.svg.clientHeight || 320; }

  setPoints(points, closed = this.closed) {
    this.points = points;
    this.closed = closed;
    if (this.selected >= points.length) this.selected = -1;
    this.refresh();
  }

  /** Elementos auxiliares: marker {x,y}, accuracy (m), origin {x,y}, ray {x,y}, trail [{x,y}]. */
  setExtras(extras) {
    this.extras = extras || {};
    this.refresh();
  }

  select(i) {
    this.selected = i;
    this.render();
    this.opts.onSelect?.(i);
  }

  reset() {
    this.userMoved = false;
    this.selected = -1;
    this.fit();
  }

  refresh() {
    if (this.opts.autoFit || !this.userMoved) this.fit();
    else this.render();
  }

  fit() {
    const pts = [...this.points];
    for (const k of ['marker', 'origin', 'ray']) if (this.extras[k]) pts.push(this.extras[k]);
    if (this.extras.trail) pts.push(...this.extras.trail);
    const b = bounds(pts) || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const pad = 44;
    const w = Math.max(b.maxX - b.minX, 4);
    const h = Math.max(b.maxY - b.minY, 4);
    this.scale = Math.max(0.01, Math.min((this.width - pad * 2) / w, (this.height - pad * 2) / h));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.tx = this.width / 2 - cx * this.scale;
    this.ty = this.height / 2 + cy * this.scale;
    this.render();
  }

  toScreen(p) {
    return { x: p.x * this.scale + this.tx, y: -p.y * this.scale + this.ty };
  }

  toWorld(sx, sy) {
    return { x: (sx - this.tx) / this.scale, y: -(sy - this.ty) / this.scale };
  }

  render() {
    const W = this.width, H = this.height, s = this.scale;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const parts = [];

    // Cuadrícula: una línea cada ~32 px, línea gruesa cada 5.
    const step = niceStep(32 / s);
    const tl = this.toWorld(0, 0), br = this.toWorld(W, H);
    for (let i = Math.ceil(tl.x / step); i * step <= br.x; i++) {
      const x = esc(i * step * s + this.tx);
      parts.push(`<line class="${i % 5 ? 'grid' : 'grid major'}" x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
    }
    for (let j = Math.ceil(br.y / step); j * step <= tl.y; j++) {
      const y = esc(-j * step * s + this.ty);
      parts.push(`<line class="${j % 5 ? 'grid' : 'grid major'}" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
    }

    const { marker, accuracy, origin, ray, trail } = this.extras;
    if (trail && trail.length > 1) {
      const d = trail.map((p) => this.toScreen(p)).map((p) => `${esc(p.x)},${esc(p.y)}`).join(' ');
      parts.push(`<polyline class="trail" points="${d}"/>`);
    }
    if (marker && accuracy) {
      const m = this.toScreen(marker);
      parts.push(`<circle class="accuracy" cx="${esc(m.x)}" cy="${esc(m.y)}" r="${esc(accuracy * s)}"/>`);
    }

    // Polígono / recorrido
    const pts = this.points.map((p) => this.toScreen(p));
    if (pts.length >= 2) {
      const d = pts.map((p) => `${esc(p.x)},${esc(p.y)}`).join(' ');
      const closed = this.closed && pts.length >= 3;
      parts.push(closed ? `<polygon class="shape" points="${d}"/>` : `<polyline class="shape open" points="${d}"/>`);
    }

    // Cotas de cada lado, desplazadas hacia fuera del polígono.
    const ccw = signedArea(this.points) >= 0;
    for (const seg of segments(this.points, this.closed)) {
      if (seg.length * s < 28) continue;
      const a = this.toScreen(seg.a), b = this.toScreen(seg.b);
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      // En pantalla y crece hacia abajo, así que la normal "exterior" se invierte.
      const sign = ccw ? -1 : 1;
      const nx = (sign * dy) / len, ny = (-sign * dx) / len;
      const mx = (a.x + b.x) / 2 + nx * 14, my = (a.y + b.y) / 2 + ny * 14;
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const cls = seg.index === this.selected ? 'dim selected' : 'dim';
      parts.push(`<text class="${cls}" x="${esc(mx)}" y="${esc(my)}" transform="rotate(${esc(ang)} ${esc(mx)} ${esc(my)})">${formatLength(seg.length)}</text>`);
    }

    // Vértices
    pts.forEach((p, i) => {
      const cls = ['vertex', i === 0 ? 'first' : '', i === this.selected ? 'selected' : ''].join(' ');
      parts.push(`<circle class="${cls}" cx="${esc(p.x)}" cy="${esc(p.y)}" r="${this.opts.editable ? 9 : 5}"/>`);
    });

    if (origin) {
      const o = this.toScreen(origin);
      if (ray) {
        const r = this.toScreen(ray);
        parts.push(`<line class="ray" x1="${esc(o.x)}" y1="${esc(o.y)}" x2="${esc(r.x)}" y2="${esc(r.y)}"/>`);
        parts.push(`<circle class="ray-end" cx="${esc(r.x)}" cy="${esc(r.y)}" r="5"/>`);
      }
      parts.push(`<circle class="observer" cx="${esc(o.x)}" cy="${esc(o.y)}" r="7"/>`);
    }
    if (marker) {
      const m = this.toScreen(marker);
      parts.push(`<circle class="marker" cx="${esc(m.x)}" cy="${esc(m.y)}" r="7"/>`);
    }

    // Barra de escala
    const barM = niceStep(90 / s);
    const barPx = barM * s;
    parts.push(`<g class="scalebar" transform="translate(12 ${H - 14})"><line x1="0" y1="0" x2="${esc(barPx)}" y2="0"/><line x1="0" y1="-5" x2="0" y2="0"/><line x1="${esc(barPx)}" y1="-5" x2="${esc(barPx)}" y2="0"/><text x="${esc(barPx / 2)}" y="-7">${formatLength(barM)}</text></g>`);

    this.svg.innerHTML = parts.join('');
  }

  // ---- interacción ----

  _bind() {
    const el = this.svg;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this._local(e);
      this._zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  _local(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _hit(p) {
    let best = -1, bestD = 24;
    this.points.forEach((pt, i) => {
      const s = this.toScreen(pt);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  _pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  _down(e) {
    this.svg.setPointerCapture?.(e.pointerId);
    const p = this._local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      const hit = this.opts.editable ? this._hit(p) : -1;
      this.drag = { type: hit >= 0 ? 'vertex' : 'pan', index: hit, start: p, last: p, moved: false };
    } else if (this.pointers.size === 2) {
      if (this.drag?.type === 'vertex' && this.drag.moved) this.opts.onChange?.(this.points, { live: false });
      this.drag = { type: 'pinch', moved: true, ...this._pinchState() };
    }
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this._local(e);
    this.pointers.set(e.pointerId, p);
    const d = this.drag;
    if (!d) return;
    if (d.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const now = this._pinchState();
      this.tx += now.mid.x - d.mid.x;
      this.ty += now.mid.y - d.mid.y;
      this._zoomAt(now.mid.x, now.mid.y, now.dist / d.dist);
      Object.assign(d, now);
      return;
    }
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return;
    if (!d.moved && d.type === 'vertex') this.opts.onDragStart?.();
    d.moved = true;
    if (d.type === 'vertex') {
      const w = this.toWorld(p.x, p.y);
      this.points[d.index] = { ...this.points[d.index], x: w.x, y: w.y };
      this.selected = d.index;
      this.render();
      this.opts.onChange?.(this.points, { live: true });
    } else {
      this.tx += p.x - d.last.x;
      this.ty += p.y - d.last.y;
      this.userMoved = true;
      this.render();
    }
    d.last = p;
  }

  _up(e, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (this.pointers.size === 0) {
      this.drag = null;
      if (!d || cancelled) return;
      if (!d.moved) {
        if (d.type === 'vertex') this.select(d.index);
        else this.opts.onTap?.(this.toWorld(d.start.x, d.start.y));
      } else if (d.type === 'vertex') {
        this.opts.onChange?.(this.points, { live: false });
      }
    } else if (this.pointers.size === 1) {
      const p = [...this.pointers.values()][0];
      this.drag = { type: 'pan', start: p, last: p, moved: true };
    }
  }

  _zoomAt(sx, sy, factor) {
    const w = this.toWorld(sx, sy);
    this.scale = Math.min(5000, Math.max(0.01, this.scale * factor));
    this.tx = sx - w.x * this.scale;
    this.ty = sy + w.y * this.scale;
    this.userMoved = true;
    this.render();
  }
}
