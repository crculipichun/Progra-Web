import {
  toLocal, distance, polygonArea, pathLength, segments, polarToPoint, floorDistance,
  scalePoints, bounds, formatLength, formatArea,
} from './geo.js';
import { PlanView } from './plan-view.js';
import { GpsCapture } from './gps.js';
import { CameraCapture } from './camera.js';
import * as store from './storage.js';
import { planToSVG, svgToPNGBlob, planToGeoJSON, fileName, deliver } from './export.js';

const $ = (sel) => document.querySelector(sel);
const MODE_LABEL = { gps: 'GPS', camera: 'Cámara', manual: 'Manual' };

// ---------- utilidades de UI ----------

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function vibrate(ms = 30) {
  navigator.vibrate?.(ms);
}

let wakeLock = null;
async function keepAwake(on) {
  // Dentro de la app Android el puente nativo mantiene la pantalla encendida.
  if (window.AndroidBridge) return window.AndroidBridge.keepAwake(!!on);
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* no soportado o denegado */ }
}

function statsHTML(points, closed) {
  const isClosed = closed && points.length >= 3;
  const items = [];
  if (isClosed) items.push(`Área <b>${formatArea(polygonArea(points))}</b>`);
  items.push(`${isClosed ? 'Perímetro' : 'Longitud'} <b>${formatLength(pathLength(points, closed))}</b>`);
  items.push(`Vértices <b>${points.length}</b>`);
  return items.map((s) => `<span>${s}</span>`).join('');
}

function thumbnail(plan) {
  const b = bounds(plan.points);
  if (!b || plan.points.length < 2) return '<svg viewBox="0 0 1 1"></svg>';
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 0.1);
  const pad = size * 0.08;
  const pts = plan.points.map((p) => `${(p.x - b.minX).toFixed(3)},${(b.maxY - p.y).toFixed(3)}`).join(' ');
  const vb = `${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`;
  const tag = plan.closed && plan.points.length >= 3 ? 'polygon' : 'polyline';
  return `<svg viewBox="${vb}" aria-hidden="true"><${tag} points="${pts}"/></svg>`;
}

// ---------- navegación ----------

let current = null; // pantalla activa
const leaveHandlers = { gps: leaveGps, camera: leaveCamera, editor: leaveEditor };

function navigate(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  route();
}

function route() {
  const [, screen = 'home', id] = location.hash.match(/^#\/?([^/]*)\/?(.*)$/) || [];
  const target = ['gps', 'camera', 'plan'].includes(screen) ? screen : 'home';
  const screenId = target === 'plan' ? 'editor' : target;
  if (current && current !== screenId) leaveHandlers[current]?.();

  if (target === 'gps' && !gpsState.active) return navigate('#/', true);
  if (target === 'camera' && !camState.active) return navigate('#/', true);
  if (target === 'plan' && !openEditor(decodeURIComponent(id))) return navigate('#/', true);

  document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.id !== screenId; });
  current = screenId;
  $('#back').hidden = screenId === 'home';
  $('#title').textContent = {
    home: 'Planos',
    gps: 'Plano con GPS',
    camera: 'Plano con cámara',
    editor: 'Editar plano',
  }[screenId] || 'Planos';
  if (screenId === 'home') renderHome();
}

$('#back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else navigate('#/', true);
});
window.addEventListener('popstate', route);

// ---------- inicio ----------

function renderHome() {
  const plans = store.listPlans();
  $('#empty-list').hidden = plans.length > 0;
  const list = $('#plan-list');
  list.innerHTML = '';
  for (const plan of plans) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const closed = plan.closed && plan.points.length >= 3;
    const measure = closed ? formatArea(polygonArea(plan.points)) : formatLength(pathLength(plan.points, false));
    btn.innerHTML = `${thumbnail(plan)}<span class="meta"><strong></strong><small>${MODE_LABEL[plan.mode] || ''} · ${measure} · ${new Date(plan.updatedAt).toLocaleDateString()}</small></span>`;
    btn.querySelector('strong').textContent = plan.name || 'Sin nombre';
    btn.addEventListener('click', () => navigate(`#/plan/${encodeURIComponent(plan.id)}`));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

document.querySelectorAll('[data-new]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.new;
    if (mode === 'gps') startGps();
    else if (mode === 'camera') startCamera();
    else {
      const plan = newPlan('manual');
      store.savePlan(plan);
      editorAddModeOnOpen = true;
      navigate(`#/plan/${plan.id}`);
    }
  });
});

function newPlan(mode, extra = {}) {
  const count = store.listPlans().length + 1;
  return {
    id: store.newId(),
    name: `Plano ${count}`,
    mode,
    points: [],
    closed: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

/** Guarda lo capturado al salir de una pantalla de captura para no perder trabajo. */
function saveCapture(mode, points, extra) {
  if (points.length < 2) return null;
  const plan = newPlan(mode, { points: points.map((p) => ({ x: p.x, y: p.y })), closed: points.length >= 3, ...extra });
  store.savePlan(plan);
  return plan;
}

// ---------- captura GPS ----------

const gpsState = { active: false, origin: null, points: [], recording: false, busy: false, lastFix: null };
const gpsView = new PlanView($('#gps-view'), { autoFit: true, interactive: false });
const gps = new GpsCapture({
  onFix: onGpsFix,
  onError: (err) => {
    const msg = err.code === 1 ? 'Permiso de ubicación denegado.' : err.code === 3 ? 'El GPS tarda en responder…' : err.message;
    toast(msg);
  },
});

function startGps() {
  Object.assign(gpsState, { active: true, origin: null, points: [], recording: false, busy: false, lastFix: null });
  gps.start();
  keepAwake(true);
  updateGpsUI();
  navigate('#/gps');
}

function leaveGps() {
  if (!gpsState.active) return;
  gps.stop();
  keepAwake(false);
  gpsState.active = false;
  const plan = saveCapture('gps', gpsState.points, { origin: gpsState.origin });
  if (plan && !gpsState.finished) toast('Recorrido guardado en "Mis planos"');
  gpsState.finished = false;
}

function onGpsFix(fix) {
  gpsState.lastFix = fix;
  const s = store.getSettings();
  if (gpsState.recording && fix.accuracy <= s.gpsMaxAccuracy) {
    if (!gpsState.origin) gpsState.origin = { lat: fix.lat, lon: fix.lon };
    const p = toLocal(gpsState.origin, fix);
    const last = gpsState.points.at(-1);
    if (!last || distance(last, p) >= Math.max(s.gpsMinStep, fix.accuracy / 2)) {
      gpsState.points.push(p);
      vibrate(15);
    }
  }
  updateGpsUI();
}

function updateGpsUI() {
  const fix = gpsState.lastFix;
  const badge = $('#gps-accuracy');
  if (fix) {
    badge.textContent = `Precisión ±${fix.accuracy.toFixed(fix.accuracy < 10 ? 1 : 0)} m`;
    badge.className = `badge ${fix.accuracy <= 5 ? 'good' : fix.accuracy <= 15 ? 'ok' : 'bad'}`;
  } else {
    badge.textContent = 'Buscando GPS…';
    badge.className = 'badge';
  }
  const n = gpsState.points.length;
  $('#gps-count').textContent = `${n} ${n === 1 ? 'punto' : 'puntos'}`;
  $('#gps-stats').innerHTML = statsHTML(gpsState.points, true);
  const rec = $('#gps-record');
  rec.classList.toggle('active', gpsState.recording);
  rec.textContent = gpsState.recording ? '■ Parar' : '● Grabar';
  $('#gps-mark').disabled = gpsState.busy || gpsState.recording;
  $('#gps-undo').disabled = n === 0;

  const extras = {};
  if (fix) {
    extras.marker = gpsState.origin ? toLocal(gpsState.origin, fix) : { x: 0, y: 0 };
    extras.accuracy = fix.accuracy;
  }
  gpsView.setExtras(extras);
  gpsView.setPoints(gpsState.points, true);
}

$('#gps-mark').addEventListener('click', async () => {
  if (gpsState.busy) return;
  gpsState.busy = true;
  const btn = $('#gps-mark');
  const secs = store.getSettings().gpsSampleSeconds;
  updateGpsUI();
  const avg = await gps.sampleAverage(secs * 1000, (progress, n) => {
    btn.textContent = `Midiendo… ${Math.ceil(secs * (1 - progress))} s (${n})`;
  });
  btn.textContent = 'Marcar punto';
  gpsState.busy = false;
  if (!gpsState.active) return;
  if (!avg) {
    toast('Aún no hay señal GPS. Sal al exterior y espera unos segundos.');
  } else {
    if (!gpsState.origin) gpsState.origin = { lat: avg.lat, lon: avg.lon };
    gpsState.points.push(toLocal(gpsState.origin, avg));
    vibrate();
    toast(`Punto ${gpsState.points.length} marcado (±${avg.accuracy.toFixed(1)} m)`);
  }
  updateGpsUI();
});

$('#gps-record').addEventListener('click', () => {
  gpsState.recording = !gpsState.recording;
  if (gpsState.recording) toast('Grabando: camina por el borde del terreno');
  updateGpsUI();
});

$('#gps-undo').addEventListener('click', () => {
  gpsState.points.pop();
  updateGpsUI();
});

$('#gps-done').addEventListener('click', () => {
  if (gpsState.points.length < 2) return toast('Marca al menos 2 puntos.');
  const plan = saveCapture('gps', gpsState.points, { origin: gpsState.origin });
  gpsState.points = []; // ya guardado: que leaveGps no lo duplique
  gpsState.finished = true;
  navigate(`#/plan/${plan.id}`, true);
});

// ---------- captura con cámara ----------

const camState = { active: false, raw: [], reading: null, height: 1.4, frame: 0 };
const camView = new PlanView($('#cam-view'), { autoFit: true, interactive: false });
const camera = new CameraCapture($('#cam-video'), {
  onReading: (r) => {
    camState.reading = r;
    if (!camState.frame) camState.frame = requestAnimationFrame(updateCameraUI);
  },
  onError: (err) => toast(err.message, 4000),
});

const MIN_PITCH = -5; // por encima de esto la distancia es demasiado imprecisa
const MAX_DIST = 40;

function camPoints() {
  return camState.raw.map((r) => polarToPoint(floorDistance(camState.height, r.pitch), r.bearing));
}

function startCamera() {
  Object.assign(camState, { active: true, raw: [], reading: null, height: store.getSettings().phoneHeight });
  $('#cam-height').value = camState.height;
  camera.start(); // dentro del gesto del usuario (iOS)
  keepAwake(true);
  updateCameraUI();
  navigate('#/camera');
  setTimeout(() => {
    if (camState.active && !camState.reading) toast('No se detectan sensores de orientación en este dispositivo.', 4000);
  }, 2500);
}

function leaveCamera() {
  if (!camState.active) return;
  camera.stop();
  keepAwake(false);
  camState.active = false;
  const plan = saveCapture('camera', camPoints(), { height: camState.height });
  if (plan) toast('Medición guardada en "Mis planos"');
}

function updateCameraUI() {
  camState.frame = 0;
  const r = camState.reading;
  const tip = $('#cam-tip');
  let rayEnd = null;
  if (r) {
    const d = floorDistance(camState.height, r.pitch);
    const valid = r.pitch < MIN_PITCH && d <= MAX_DIST;
    $('#cam-dist').textContent = valid ? formatLength(d) : '—';
    $('#cam-pitch').textContent = `${r.pitch.toFixed(0)}°`;
    $('#cam-bearing').textContent = `${r.bearing.toFixed(0)}°`;
    tip.classList.toggle('warn', !valid);
    tip.textContent = valid
      ? 'Apunta la cruz al punto donde la esquina toca el suelo'
      : 'Inclina el teléfono hacia el suelo';
    rayEnd = polarToPoint(valid ? d : 1.5, r.bearing);
  }
  const pts = camPoints();
  camView.setExtras({ origin: { x: 0, y: 0 }, ray: rayEnd });
  camView.setPoints(pts, true);
  $('#cam-undo').disabled = pts.length === 0;
  $('#cam-mark').textContent = `Marcar esquina ${pts.length + 1}`;
}

$('#cam-mark').addEventListener('click', () => {
  const r = camState.reading;
  if (!r) return toast('Sin datos del sensor de orientación.');
  const d = floorDistance(camState.height, r.pitch);
  if (r.pitch >= MIN_PITCH || d > MAX_DIST) return toast('Apunta más abajo, al pie de la esquina.');
  camState.raw.push({ bearing: r.bearing, pitch: r.pitch });
  vibrate();
  updateCameraUI();
});

$('#cam-undo').addEventListener('click', () => {
  camState.raw.pop();
  updateCameraUI();
});

$('#cam-height').addEventListener('change', (e) => {
  const h = parseFloat(String(e.target.value).replace(',', '.'));
  if (!(h >= 0.3 && h <= 3)) {
    e.target.value = camState.height;
    return toast('Altura entre 0.3 y 3 m');
  }
  camState.height = h;
  store.saveSettings({ phoneHeight: h });
  updateCameraUI();
});

$('#cam-done').addEventListener('click', () => {
  if (camState.raw.length < 3) return toast('Marca al menos 3 esquinas.');
  const plan = saveCapture('camera', camPoints(), { height: camState.height });
  camState.raw = [];
  navigate(`#/plan/${plan.id}`, true);
});

// ---------- editor ----------

let plan = null;
let addMode = false;
let editorAddModeOnOpen = false;

const editorView = new PlanView($('#editor-view'), {
  editable: true,
  onChange: (points, { live }) => {
    plan.points = points;
    updateEditorInfo();
    if (!live) persist();
  },
  onSelect: () => updateEditorInfo(),
  onTap: (w) => {
    if (addMode) {
      plan.points.push({ x: w.x, y: w.y });
      editorView.userMoved = true; // no reencuadrar mientras se dibuja
      editorView.selected = plan.points.length - 1;
      editorView.setPoints(plan.points, plan.closed);
      persist();
      updateEditorInfo();
    } else {
      editorView.select(-1);
    }
  },
});

function persist() {
  if (plan) store.savePlan(plan);
}

function openEditor(id) {
  if (plan?.id === id) return true;
  const p = store.getPlan(id);
  if (!p) return false;
  plan = p;
  addMode = editorAddModeOnOpen;
  editorAddModeOnOpen = false;
  $('#plan-name').value = plan.name;
  $('#ed-geojson').hidden = !plan.origin;
  editorView.points = plan.points;
  editorView.closed = plan.closed;
  // Esperar a que la pantalla sea visible para medir el SVG.
  requestAnimationFrame(() => editorView.reset());
  updateEditorInfo();
  return true;
}

function leaveEditor() {
  if (!plan) return;
  if (plan.points.length === 0) store.deletePlan(plan.id);
  else persist();
  plan = null;
}

function selectedSegment() {
  const i = editorView.selected;
  if (i < 0 || !plan) return null;
  return segments(plan.points, plan.closed).find((s) => s.index === i) || null;
}

function updateEditorInfo() {
  if (!plan) return;
  $('#editor-stats').innerHTML = statsHTML(plan.points, plan.closed);
  const sel = editorView.selected;
  const seg = selectedSegment();
  $('#ed-delete').disabled = sel < 0;
  $('#ed-scale').disabled = !seg;
  const add = $('#ed-add');
  add.setAttribute('aria-pressed', String(addMode));
  $('#editor-hint').textContent = addMode
    ? 'Toca el plano para añadir vértices. Arrastra un vértice para moverlo.'
    : sel >= 0
      ? `Vértice ${sel + 1} seleccionado${seg ? ` · lado ${sel + 1}→${(sel + 1) % plan.points.length + 1}: ${formatLength(seg.length)}` : ''}`
      : 'Arrastra los vértices para ajustarlos. Toca uno para seleccionarlo.';
  $('#segment-list').innerHTML = segments(plan.points, plan.closed)
    .map((s) => `<li>${s.index + 1} → ${(s.index + 1) % plan.points.length + 1}: <b>${formatLength(s.length)}</b></li>`)
    .join('');
}

$('#plan-name').addEventListener('input', (e) => {
  plan.name = e.target.value;
  persist();
});

$('#ed-add').addEventListener('click', () => {
  addMode = !addMode;
  updateEditorInfo();
});

$('#ed-delete').addEventListener('click', () => {
  const i = editorView.selected;
  if (i < 0) return;
  plan.points.splice(i, 1);
  editorView.selected = -1;
  editorView.setPoints(plan.points, plan.closed);
  persist();
  updateEditorInfo();
});

$('#ed-scale').addEventListener('click', () => {
  const seg = selectedSegment();
  if (!seg || seg.length === 0) return;
  const answer = prompt(`Medida real del lado ${seg.index + 1} en metros\n(el plano completo se escalará):`, seg.length.toFixed(2));
  if (answer === null) return;
  const real = parseFloat(answer.replace(',', '.'));
  if (!(real > 0)) return toast('Introduce una medida válida.');
  plan.points = scalePoints(plan.points, real / seg.length);
  editorView.setPoints(plan.points, plan.closed);
  editorView.reset();
  persist();
  updateEditorInfo();
  toast('Plano escalado');
});

$('#ed-close').addEventListener('click', () => {
  plan.closed = !plan.closed;
  editorView.setPoints(plan.points, plan.closed);
  persist();
  updateEditorInfo();
});

$('#ed-fit').addEventListener('click', () => editorView.reset());

$('#ed-svg').addEventListener('click', () => {
  deliver(new Blob([planToSVG(plan)], { type: 'image/svg+xml' }), fileName(plan, 'svg'));
});

$('#ed-png').addEventListener('click', async () => {
  try {
    const blob = await svgToPNGBlob(planToSVG(plan, 2000));
    await deliver(blob, fileName(plan, 'png'));
  } catch {
    toast('No se pudo generar la imagen.');
  }
});

$('#ed-json').addEventListener('click', () => {
  deliver(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), fileName(plan, 'json'));
});

$('#ed-geojson').addEventListener('click', () => {
  const gj = planToGeoJSON(plan);
  if (gj) deliver(new Blob([JSON.stringify(gj, null, 2)], { type: 'application/geo+json' }), fileName(plan, 'geojson'));
});

$('#ed-remove').addEventListener('click', () => {
  if (!confirm(`¿Eliminar "${plan.name}"?`)) return;
  store.deletePlan(plan.id);
  plan = null;
  navigate('#/', true);
});

// ---------- arranque ----------

$('#secure-warning').hidden = window.isSecureContext;
if ('serviceWorker' in navigator && window.isSecureContext && !window.AndroidBridge) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (gpsState.active || camState.active)) keepAwake(true);
});
route();
