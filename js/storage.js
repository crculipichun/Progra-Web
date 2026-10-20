// Persistencia local de planos y ajustes (localStorage).
const PLANS_KEY = 'planos.v1';
const SETTINGS_KEY = 'planos.settings.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listPlans() {
  return read(PLANS_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPlan(id) {
  return listPlans().find((p) => p.id === id) || null;
}

export function savePlan(plan) {
  const plans = read(PLANS_KEY, []).filter((p) => p.id !== plan.id);
  plan.updatedAt = Date.now();
  plans.push(plan);
  return write(PLANS_KEY, plans);
}

export function deletePlan(id) {
  write(PLANS_KEY, read(PLANS_KEY, []).filter((p) => p.id !== id));
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const DEFAULT_SETTINGS = { phoneHeight: 1.4, gpsMinStep: 2, gpsMaxAccuracy: 20, gpsSampleSeconds: 4 };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
}

export function saveSettings(patch) {
  write(SETTINGS_KEY, { ...getSettings(), ...patch });
}
