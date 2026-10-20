import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toLocal, toGeo, haversine, polygonArea, pathLength, segments, averageFixes,
  polarToPoint, cameraVector, vectorToAngles, floorDistance, scalePoints, niceStep,
  formatLength, formatArea,
} from '../js/geo.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('toLocal/toGeo son inversas y coinciden con haversine', () => {
  const origin = { lat: -12.0464, lon: -77.0428 };
  const p = { lat: -12.0455, lon: -77.0419 };
  const local = toLocal(origin, p);
  near(Math.hypot(local.x, local.y), haversine(origin, p), 0.01);
  const back = toGeo(origin, local);
  near(back.lat, p.lat, 1e-9);
  near(back.lon, p.lon, 1e-9);
});

test('área y perímetro de un rectángulo de 10 × 5 m', () => {
  const r = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
  near(polygonArea(r), 50);
  near(pathLength(r, true), 30);
  near(pathLength(r, false), 25);
  assert.equal(segments(r, true).length, 4);
  assert.equal(polygonArea(r.slice(0, 2)), 0);
});

test('averageFixes da más peso a las lecturas precisas', () => {
  const avg = averageFixes([
    { lat: 0, lon: 0, accuracy: 1 },
    { lat: 1, lon: 1, accuracy: 100 },
  ]);
  assert.ok(avg.lat < 0.001 && avg.lon < 0.001);
  assert.ok(avg.accuracy < 1);
  assert.equal(averageFixes([]), null);
});

test('polarToPoint usa rumbos de brújula', () => {
  const n = polarToPoint(2, 0);
  near(n.x, 0); near(n.y, 2);
  const e = polarToPoint(2, 90);
  near(e.x, 2); near(e.y, 0);
});

test('cameraVector: teléfono vertical mirando al norte apunta al horizonte norte', () => {
  const a = vectorToAngles(cameraVector(0, 90, 0));
  near(a.pitch, 0, 1e-9);
  near(a.bearing % 360, 0, 1e-9);
});

test('cameraVector: teléfono plano boca arriba apunta al suelo', () => {
  near(vectorToAngles(cameraVector(0, 0, 0)).pitch, -90, 1e-9);
});

test('cameraVector: inclinar hacia delante baja la cámara', () => {
  near(vectorToAngles(cameraVector(0, 60, 0)).pitch, -30, 1e-9);
});

test('cameraVector: girar alpha cambia el rumbo en sentido contrario', () => {
  // alpha crece en sentido antihorario visto desde arriba.
  near(vectorToAngles(cameraVector(90, 90, 0)).bearing, 270, 1e-9);
});

test('floorDistance: a 45° hacia abajo la distancia es igual a la altura', () => {
  near(floorDistance(1.4, -45), 1.4, 1e-9);
  assert.equal(floorDistance(1.4, 5), Infinity);
});

test('scalePoints conserva el primer vértice', () => {
  const s = scalePoints([{ x: 1, y: 1 }, { x: 3, y: 1 }], 2);
  assert.deepEqual(s, [{ x: 1, y: 1 }, { x: 5, y: 1 }]);
});

test('niceStep y formatos', () => {
  assert.equal(niceStep(0.7), 1);
  assert.equal(niceStep(1.3), 2);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(42), 50);
  assert.equal(formatLength(3.456), '3.46 m');
  assert.equal(formatLength(1500), '1.50 km');
  assert.equal(formatArea(12.345), '12.35 m²');
  assert.equal(formatArea(25000), '2.50 ha');
});
