import {
  toLocal, distance, polygonArea, pathLength, segments, polarToPoint, floorDistance,
  scalePoints, bounds, formatLength, formatArea, orthogonalize, closeLoop, returnsToStart, sortByBearing,
} from './geo.js';
import { MotionTracker } from './motion.js';
import { PlanView } from './plan-view.js';
import { GpsCapture } from './gps.js';
import { CameraCapture } from './camera.js';
import * as store from './storage.js';
import { planToSVG, svgToPNGBlob, planToGeoJSON, fileName, deliver } from './export.js';

const $ = (sel) => document.querySelector(sel);
const MODE_LABEL = { gps: 'GPS', camera: 'Cámara', walk: 'Caminando', manual: 'Manual' };

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
//
// Dos formas de medir:
//  · Caminando: el teléfono cuenta los pasos y sigue el rumbo, así que la posición
//    se mueve contigo. En cada esquina apuntas la cruz a su pie (o te quedas
//    encima) y se marca respecto a donde estás.
//  · Desde un punto: te quedas quieto y solo giras; cada esquina se mide por
//    la inclinación del teléfono y su altura.

const camState = {
  active: false, mode: 'walk', marks: [], reading: null, frame: 0,
  height: 1.4, stepLength: 0.7, square: true, pos: { x: 0, y: 0 }, trail: [], steps: 0,
};
const camView = new PlanView($('#cam-view'), { autoFit: true, interactive: false });
const camera = new CameraCapture($('#cam-video'), {
  onReading: (r) => {
    camState.reading = r;
    scheduleCameraUI();
  },
  onError: (err) => toast(err.message, 4000),
});
const motion = new MotionTracker({ onStep: onCameraStep });

const MIN_PITCH = -5; // por encima de esto la distancia es demasiado imprecisa
const MAX_DIST = 40;
const MAX_WALK_AIM = 8; // caminando, solo se apunta a esquinas cercanas

function scheduleCameraUI() {
  if (!camState.frame) camState.frame = requestAnimationFrame(updateCameraUI);
}

/** Distancia a la que apunta la cruz, o null si no es fiable. */
function aimDistance(r = camState.reading) {
  if (!r || r.pitch >= MIN_PITCH) return null;
  const d = floorDistance(camState.height, r.pitch);
  return d <= (camState.mode === 'walk' ? MAX_WALK_AIM : MAX_DIST) ? d : null;
}

function markToPoint(m) {
  if (m.pitch === null) return { x: m.pos.x, y: m.pos.y };
  const o = polarToPoint(floorDistance(camState.height, m.pitch), m.bearing);
  return { x: m.pos.x + o.x, y: m.pos.y + o.y };
}

const cornerPoints = () => camState.marks.map(markToPoint);

/** Esquinas finales: ordenadas, con el recorrido cerrado y (opcional) a 90°. */
function finalCameraPoints() {
  let pts = cornerPoints();
  if (camState.mode === 'point') pts = sortByBearing(pts);
  else if (returnsToStart(pts)) pts = closeLoop(pts);
  if (camState.square && pts.length >= 3) pts = orthogonalize(pts, true);
  return pts;
}

function startCamera() {
  const s = store.getSettings();
  Object.assign(camState, {
    active: true, marks: [], reading: null, pos: { x: 0, y: 0 }, trail: [{ x: 0, y: 0 }], steps: 0,
    height: s.phoneHeight, stepLength: s.stepLength, square: s.squareCorners, mode: s.cameraMode,
  });
  $('#cam-height').value = camState.height;
  $('#cam-step').value = camState.stepLength;
  $('#cam-square').checked = camState.square;
  camera.start(); // dentro del gesto del usuario (iOS)
  motion.start();
  keepAwake(true);
  updateCameraUI();
  navigate('#/camera');
  setTimeout(() => {
    if (camState.active && !camState.reading) toast('No se detectan sensores de orientación en este dispositivo.', 4000);
  }, 2500);
}

function cameraPlanExtra() {
  return camState.mode === 'walk'
    ? { height: camState.height, stepLength: camState.stepLength }
    : { height: camState.height };
}

function leaveCamera() {
  if (!camState.active) return;
  camera.stop();
  motion.stop();
  keepAwake(false);
  camState.active = false;
  if (camState.marks.length >= 2) {
    saveCapture(camState.mode === 'walk' ? 'walk' : 'camera', finalCameraPoints(), cameraPlanExtra());
    toast('Medición guardada en "Mis planos"');
  }
}

function onCameraStep() {
  if (!camState.active || camState.mode !== 'walk' || !camState.reading) return;
  const d = polarToPoint(camState.stepLength, camState.reading.heading);
  camState.pos = { x: camState.pos.x + d.x, y: camState.pos.y + d.y };
  camState.trail.push(camState.pos);
  camState.steps++;
  scheduleCameraUI();
}

function updateCameraUI() {
  camState.frame = 0;
  const r = camState.reading;
  const walk = camState.mode === 'walk';
  const d = aimDistance();
  const tip = $('#cam-tip');

  $('#cam-mode-walk').setAttribute('aria-checked', String(walk));
  $('#cam-mode-point').setAttribute('aria-checked', String(!walk));
  $('#cam-step-label').hidden = !walk;
  $('#cam-l2').textContent = walk ? 'Pasos' : 'Inclinación';
  $('#cam-l3').textContent = walk ? 'Recorrido' : 'Rumbo';
  $('#cam-dist').textContent = d !== null ? formatLength(d) : '—';
  if (walk) {
    $('#cam-pitch').textContent = String(camState.steps);
    $('#cam-bearing').textContent = formatLength(camState.steps * camState.stepLength);
  } else {
    $('#cam-pitch').textContent = r ? `${r.pitch.toFixed(0)}°` : '—';
    $('#cam-bearing').textContent = r ? `${r.bearing.toFixed(0)}°` : '—';
  }

  let text;
  if (d !== null) text = 'Cruz en el pie de la esquina → Marcar';
  else if (!walk) text = 'Inclina el teléfono hacia el pie de la esquina';
  else if (!camState.marks.length) text = 'Ve a una esquina, apunta la cruz a su pie y pulsa Marcar';
  else text = 'Camina junto a la pared hasta la siguiente esquina, con el teléfono hacia delante';
  tip.textContent = text;
  tip.classList.toggle('warn', d === null && !walk);

  const pos = walk ? camState.pos : { x: 0, y: 0 };
  let ray = null;
  if (r) {
    const o = polarToPoint(d ?? 1.2, r.bearing);
    ray = { x: pos.x + o.x, y: pos.y + o.y };
  }
  camView.setExtras({ origin: pos, ray, trail: walk ? camState.trail : null });
  camView.setPoints(walk ? cornerPoints() : sortByBearing(cornerPoints()), !walk);
  $('#cam-undo').disabled = camState.marks.length === 0;
  $('#cam-mark').textContent = `Marcar esquina ${camState.marks.length + 1}`;
}

$('#cam-mark').addEventListener('click', () => {
  const r = camState.reading;
  if (!r) return toast('Sin datos del sensor de orientación.');
  const d = aimDistance(r);
  if (camState.mode === 'point' && d === null) return toast('Apunta más abajo, al pie de la esquina.');
  camState.marks.push({
    pos: camState.mode === 'walk' ? { ...camState.pos } : { x: 0, y: 0 },
    // Caminando sin apuntar al suelo: la esquina es donde estás.
    pitch: d !== null ? r.pitch : null,
    bearing: r.bearing,
  });
  vibrate();
  if (camState.mode === 'walk' && camState.marks.length >= 4 && returnsToStart(cornerPoints())) {
    toast('Has vuelto al inicio: pulsa Terminar para cerrar el plano');
  }
  updateCameraUI();
});

$('#cam-undo').addEventListener('click', () => {
  camState.marks.pop();
  updateCameraUI();
});

function setCameraMode(mode) {
  if (mode === camState.mode) return;
  if (camState.marks.length) return toast('Deshaz las esquinas marcadas para cambiar de modo.');
  camState.mode = mode;
  camState.pos = { x: 0, y: 0 };
  camState.trail = [{ x: 0, y: 0 }];
  camState.steps = 0;
  store.saveSettings({ cameraMode: mode });
  updateCameraUI();
}
$('#cam-mode-walk').addEventListener('click', () => setCameraMode('walk'));
$('#cam-mode-point').addEventListener('click', () => setCameraMode('point'));

function numberInput(sel, min, max, key, label) {
  $(sel).addEventListener('change', (e) => {
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (!(v >= min && v <= max)) {
      e.target.value = camState[key];
      return toast(`${label} entre ${min} y ${max} m`);
    }
    camState[key] = v;
    store.saveSettings({ [key === 'height' ? 'phoneHeight' : key]: v });
    updateCameraUI();
  });
}
numberInput('#cam-height', 0.3, 3, 'height', 'Altura');
numberInput('#cam-step', 0.3, 1.2, 'stepLength', 'Paso');

$('#cam-square').addEventListener('change', (e) => {
  camState.square = e.target.checked;
  store.saveSettings({ squareCorners: camState.square });
});

$('#cam-done').addEventListener('click', () => {
  if (camState.marks.length < 3) return toast('Marca al menos 3 esquinas.');
  const plan = saveCapture(camState.mode === 'walk' ? 'walk' : 'camera', finalCameraPoints(), cameraPlanExtra());
  camState.marks = [];
  navigate(`#/plan/${plan.id}`, true);
});

// ---------- editor ----------

let plan = null;
let addMode = false;
let editorAddModeOnOpen = false;
let undoStack = [];

/** Guarda el estado actual para poder deshacer el siguiente cambio. */
function snapshot() {
  undoStack.push({ points: plan.points.map((p) => ({ ...p })), closed: plan.closed });
  if (undoStack.length > 50) undoStack.shift();
}

/** Aplica nuevos vértices al plano, refresca la vista y guarda. */
function commitPoints(points, { refit = false } = {}) {
  plan.points = points;
  if (editorView.selected >= points.length) editorView.selected = -1;
  editorView.setPoints(plan.points, plan.closed);
  if (refit) editorView.reset();
  persist();
  updateEditorInfo();
}

const editorView = new PlanView($('#editor-view'), {
  editable: true,
  onChange: (points, { live }) => {
    plan.points = points;
    updateEditorInfo();
    if (!live) persist();
  },
  onSelect: () => updateEditorInfo(),
  onDragStart: () => snapshot(),
  onTap: (w) => {
    if (addMode) {
      snapshot();
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
  undoStack = [];
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
  $('#ed-undo').disabled = undoStack.length === 0;
  $('#ed-square').disabled = plan.points.length < 3;
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
  snapshot();
  editorView.selected = -1;
  commitPoints(plan.points.filter((_, k) => k !== i));
});

$('#ed-scale').addEventListener('click', () => {
  const seg = selectedSegment();
  if (!seg || seg.length === 0) return;
  const answer = prompt(`Medida real del lado ${seg.index + 1} en metros\n(el plano completo se escalará):`, seg.length.toFixed(2));
  if (answer === null) return;
  const real = parseFloat(answer.replace(',', '.'));
  if (!(real > 0)) return toast('Introduce una medida válida.');
  const factor = real / seg.length;
  snapshot();
  commitPoints(scalePoints(plan.points, factor), { refit: true });
  if (plan.mode === 'walk' && plan.stepLength) {
    // La medida real también calibra el largo de paso para las próximas mediciones.
    plan.stepLength = Math.min(1.2, Math.max(0.3, plan.stepLength * factor));
    store.saveSettings({ stepLength: +plan.stepLength.toFixed(3) });
    persist();
    toast(`Plano escalado · paso calibrado a ${plan.stepLength.toFixed(2)} m`, 3500);
  } else {
    toast('Plano escalado');
  }
});

$('#ed-close').addEventListener('click', () => {
  snapshot();
  plan.closed = !plan.closed;
  editorView.setPoints(plan.points, plan.closed);
  persist();
  updateEditorInfo();
});

$('#ed-fit').addEventListener('click', () => editorView.reset());

$('#ed-square').addEventListener('click', () => {
  if (plan.points.length < 3) return;
  snapshot();
  commitPoints(orthogonalize(plan.points, plan.closed));
  toast('Lados enderezados a 90°');
});

$('#ed-undo').addEventListener('click', () => {
  const prev = undoStack.pop();
  if (!prev) return;
  plan.closed = prev.closed;
  commitPoints(prev.points);
});

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
