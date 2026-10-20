// Exportación del plano a SVG, PNG, JSON y GeoJSON.
import { bounds, segments, signedArea, polygonArea, pathLength, niceStep, formatLength, formatArea, toGeo } from './geo.js';

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f = (n) => n.toFixed(1);

/** SVG autónomo e imprimible del plano. */
export function planToSVG(plan, width = 1200) {
  const pts = plan.points;
  const b = bounds(pts) || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = 90, header = 70;
  const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
  const s = (width - pad * 2) / w;
  const height = Math.round(h * s + pad * 2 + header);
  const P = (p) => ({ x: (p.x - b.minX) * s + pad, y: (b.maxY - p.y) * s + pad + header });
  const closed = plan.closed && pts.length >= 3;
  const sp = pts.map(P);
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

  // Cuadrícula de 1 m (o el paso que dé ~30 px)
  const step = niceStep(30 / s);
  out.push('<g stroke="#e3e8ef" stroke-width="1">');
  for (let i = Math.ceil(b.minX / step); i * step <= b.maxX; i++) {
    const x = f((i * step - b.minX) * s + pad);
    out.push(`<line x1="${x}" y1="${pad + header}" x2="${x}" y2="${f(h * s + pad + header)}"/>`);
  }
  for (let j = Math.ceil(b.minY / step); j * step <= b.maxY; j++) {
    const y = f((b.maxY - j * step) * s + pad + header);
    out.push(`<line x1="${pad}" y1="${y}" x2="${f(w * s + pad)}" y2="${y}"/>`);
  }
  out.push('</g>');

  const d = sp.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
  out.push(closed
    ? `<polygon points="${d}" fill="#dbeafe" stroke="#1e3a8a" stroke-width="4" stroke-linejoin="round"/>`
    : `<polyline points="${d}" fill="none" stroke="#1e3a8a" stroke-width="4" stroke-linejoin="round"/>`);

  const ccw = signedArea(pts) >= 0;
  for (const seg of segments(pts, plan.closed)) {
    const a = P(seg.a), c = P(seg.b);
    const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
    const sign = ccw ? -1 : 1;
    const mx = (a.x + c.x) / 2 + ((sign * dy) / len) * 22;
    const my = (a.y + c.y) / 2 + ((-sign * dx) / len) * 22;
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    out.push(`<text x="${f(mx)}" y="${f(my)}" font-size="20" fill="#0f172a" text-anchor="middle" dominant-baseline="middle" transform="rotate(${f(ang)} ${f(mx)} ${f(my)})">${formatLength(seg.length)}</text>`);
  }
  sp.forEach((p, i) => {
    out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="6" fill="#1e3a8a"/>`);
    out.push(`<text x="${f(p.x + 9)}" y="${f(p.y - 9)}" font-size="14" fill="#64748b">${i + 1}</text>`);
  });

  out.push(`<text x="${pad}" y="40" font-size="28" font-weight="700" fill="#0f172a">${xml(plan.name || 'Plano')}</text>`);
  const info = [
    closed ? `Área: ${formatArea(polygonArea(pts))}` : null,
    `${closed ? 'Perímetro' : 'Longitud'}: ${formatLength(pathLength(pts, plan.closed))}`,
    `Método: ${{ gps: 'GPS', camera: 'Cámara', manual: 'Manual' }[plan.mode] || plan.mode}`,
    new Date(plan.updatedAt || Date.now()).toLocaleDateString(),
  ].filter(Boolean).join('   ·   ');
  out.push(`<text x="${pad}" y="68" font-size="17" fill="#475569">${xml(info)}</text>`);

  // Escala gráfica
  const barM = niceStep(150 / s), barPx = barM * s, by = height - 30;
  out.push(`<g stroke="#0f172a" stroke-width="3"><line x1="${pad}" y1="${by}" x2="${f(pad + barPx)}" y2="${by}"/><line x1="${pad}" y1="${by - 8}" x2="${pad}" y2="${by}"/><line x1="${f(pad + barPx)}" y1="${by - 8}" x2="${f(pad + barPx)}" y2="${by}"/></g>`);
  out.push(`<text x="${f(pad + barPx / 2)}" y="${by - 12}" font-size="16" text-anchor="middle" fill="#0f172a">${formatLength(barM)}</text>`);

  // Flecha de norte solo si el plano está georreferenciado (GPS)
  if (plan.origin) {
    const nx = width - pad, ny = header + 20;
    out.push(`<g transform="translate(${nx} ${ny})"><polygon points="0,0 12,34 0,26 -12,34" fill="#0f172a"/><text x="0" y="56" font-size="18" text-anchor="middle" font-weight="700">N</text></g>`);
  }
  out.push('</svg>');
  return out.join('\n');
}

export async function svgToPNGBlob(svgText) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return await new Promise((res) => canvas.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function planToGeoJSON(plan) {
  if (!plan.origin) return null;
  const coords = plan.points.map((p) => {
    const g = toGeo(plan.origin, p);
    return [+g.lon.toFixed(8), +g.lat.toFixed(8)];
  });
  const closed = plan.closed && coords.length >= 3;
  const geometry = closed
    ? { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
    : { type: 'LineString', coordinates: coords };
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        name: plan.name,
        area_m2: closed ? +polygonArea(plan.points).toFixed(2) : null,
        length_m: +pathLength(plan.points, plan.closed).toFixed(2),
      },
      geometry,
    }],
  };
}

export function fileName(plan, ext) {
  const base = (plan.name || 'plano').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'plano'}.${ext}`;
}

/** Comparte el archivo si el sistema lo permite; si no, lo descarga. */
export async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
