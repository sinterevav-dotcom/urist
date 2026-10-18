// Обёртка над Telegram WebApp + хранилище + запросы к боту.
import { API_URL } from './config.js';
import { toBase64 } from './lib/docx.js';

export const tg = window.Telegram?.WebApp;
export const inTelegram = Boolean(tg && tg.initData);

export function initPlatform() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('#0B0E13'); tg.setBackgroundColor('#0B0E13'); tg.setBottomBarColor?.('#10141B'); } catch {}
  try { tg.disableVerticalSwipes?.(); } catch {}
}

export const userName = () => tg?.initDataUnsafe?.user?.first_name || '';

let backHandler = null;
export function setBack(handler) {
  if (!tg?.BackButton) return;
  if (backHandler) tg.BackButton.offClick(backHandler);
  backHandler = handler;
  if (handler) { tg.BackButton.onClick(handler); tg.BackButton.show(); } else tg.BackButton.hide();
}

export const haptic = (type = 'light') => { try { tg?.HapticFeedback?.impactOccurred(type); } catch {} };
export const hapticOk = () => { try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {} };

// --- Хранилище: localStorage + Telegram CloudStorage (бесплатно, данные у Telegram, не у нас) ---
const KEY = 'bizlawyer:v1';
export function loadLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveLocal(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  try { if (tg?.CloudStorage && inTelegram) tg.CloudStorage.setItem('state', JSON.stringify(data).slice(0, 4000)); } catch {}
}
export function loadCloud() {
  return new Promise((resolve) => {
    if (!tg?.CloudStorage || !inTelegram) return resolve(null);
    try {
      tg.CloudStorage.getItem('state', (err, value) => {
        if (err || !value) return resolve(null);
        try { resolve(JSON.parse(value)); } catch { resolve(null); }
      });
    } catch { resolve(null); }
  });
}

// --- Бот ---
export const botAvailable = () => Boolean(API_URL && inTelegram);

async function post(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Отправить документ: в Telegram — в чат с ботом, иначе — скачать */
export async function deliverDocument(filename, bytes) {
  if (botAvailable()) {
    await post('/api/document', { filename, file: toBase64(bytes) });
    return 'chat';
  }
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'download';
}

export async function saveReminders(profile, enabled) {
  if (!botAvailable()) throw new Error('offline');
  return post('/api/reminders', { profile: { entity: profile.entity, regime: profile.regime }, enabled });
}
