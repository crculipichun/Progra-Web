// Geometría y conversiones usadas por toda la app. Sin dependencias del DOM
// para poder probarse con `node --test`.

export const EARTH_RADIUS = 6371008.8; // metros (radio medio)

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Convierte lat/lon a metros locales (x = este, y = norte) respecto a `origin`. */
export function toLocal(origin, p) {
  return {
    x: toRad(p.lon - origin.lon) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS,
    y: toRad(p.lat - origin.lat) * EARTH_RADIUS,
  };
}

/** Inversa de `toLocal`. */
export function toGeo(origin, p) {
  return {
    lat: origin.lat + toDeg(p.y / EARTH_RADIUS),
    lon: origin.lon + toDeg(p.x / (EARTH_RADIUS * Math.cos(toRad(origin.lat)))),
  };
}

/** Distancia geodésica en metros entre dos puntos lat/lon. */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Área con signo (positiva si los vértices van en sentido antihorario). */
export function signedArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(points) {
  return points.length < 3 ? 0 : Math.abs(signedArea(points));
}

/** Lista de lados: [{ index, a, b, length }]. */
export function segments(points, closed = true) {
  const out = [];
  const n = points.length;
  const count = closed && n >= 3 ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({ index: i, a, b, length: distance(a, b) });
  }
  return out;
}

export function pathLength(points, closed = true) {
  return segments(points, closed).reduce((s, seg) => s + seg.length, 0);
}

export function bounds(points) {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Promedia lecturas GPS ponderando por 1/precisión² (las más precisas pesan más).
 * Devuelve { lat, lon, accuracy } o null si no hay lecturas.
 */
export function averageFixes(fixes) {
  if (!fixes.length) return null;
  let wSum = 0, lat = 0, lon = 0;
  for (const f of fixes) {
    const w = 1 / Math.max(f.accuracy, 0.5) ** 2;
    wSum += w;
    lat += f.lat * w;
    lon += f.lon * w;
  }
  return { lat: lat / wSum, lon: lon / wSum, accuracy: 1 / Math.sqrt(wSum) };
}

/** Punto a `dist` metros en el rumbo `bearingDeg` (0 = norte, 90 = este). */
export function polarToPoint(dist, bearingDeg) {
  const b = toRad(bearingDeg);
  return { x: dist * Math.sin(b), y: dist * Math.cos(b) };
}

/**
 * Dirección hacia la que apunta la cámara trasera a partir de los ángulos de
 * DeviceOrientation (alpha, beta, gamma en grados, convención W3C Z-X'-Y'').
 * La cámara mira hacia el eje -Z del dispositivo, así que el resultado no
 * depende de si el teléfono está en vertical u horizontal.
 * Devuelve el vector unitario en el mundo (x = este, y = norte, z = arriba).
 */
export function cameraVector(alpha, beta, gamma) {
  const a = toRad(alpha || 0), b = toRad(beta || 0), g = toRad(gamma || 0);
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  return {
    x: -(cA * sG + sA * sB * cG),
    y: -(sA * sG - cA * sB * cG),
    z: -(cB * cG),
  };
}

/** Rumbo (0–360°, horario desde el norte) e inclinación (° sobre el horizonte) de un vector. */
export function vectorToAngles(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  let bearing = toDeg(Math.atan2(v.x, v.y));
  if (bearing < 0) bearing += 360;
  return { bearing, pitch: toDeg(Math.asin(Math.max(-1, Math.min(1, v.z / len)))) };
}

/**
 * Distancia horizontal hasta el punto del suelo al que apunta la cámara,
 * sostenida a `height` metros y apuntando `pitchDeg` grados (negativo = hacia abajo).
 */
export function floorDistance(height, pitchDeg) {
  if (pitchDeg >= 0) return Infinity;
  return height / Math.tan(toRad(-pitchDeg));
}

/** Escala todos los puntos respecto a su primer vértice. */
export function scalePoints(points, factor) {
  if (!points.length) return [];
  const o = points[0];
  return points.map((p) => ({ ...p, x: o.x + (p.x - o.x) * factor, y: o.y + (p.y - o.y) * factor }));
}

/** Paso "redondo" (1, 2, 5 × 10ⁿ) mayor o igual que `raw`. */
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  for (const m of [1, 2, 5, 10]) if (m * base >= raw) return m * base;
  return 10 * base;
}

export function formatLength(m) {
  if (!Number.isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  if (m >= 10) return `${m.toFixed(1)} m`;
  return `${m.toFixed(2)} m`;
}

export function formatArea(m2) {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha`;
  if (m2 >= 100) return `${m2.toFixed(0)} m²`;
  return `${m2.toFixed(2)} m²`;
}
