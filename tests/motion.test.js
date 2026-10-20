import test from 'node:test';
import assert from 'node:assert/strict';
import { StepCounter } from '../js/motion.js';

function simulate(fn, seconds, hz = 60) {
  const c = new StepCounter();
  for (let i = 0; i < seconds * hz; i++) { const t = (i / hz) * 1000; c.feed(fn(t / 1000, i), t); }
  return c.count;
}

test('cuenta ~1.8 pasos por segundo al caminar', () => {
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.6;
  const n = simulate((t) => 9.81 + 2.5 * Math.sin(2 * Math.PI * 1.8 * t) + noise(), 10);
  assert.ok(n >= 16 && n <= 19, `pasos: ${n}`);
});

test('no cuenta pasos con el teléfono quieto', () => {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
  assert.equal(simulate(() => 9.81 + noise(), 10), 0);
});
