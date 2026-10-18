// Бот «Бизнес-юрист» на Cloudflare Workers (бесплатный тариф).
// Секреты: BOT_TOKEN, WEBHOOK_SECRET, SETUP_KEY. Переменные: WEBAPP_URL. KV: USERS.
import { buildCalendar, daysUntil } from '../../js/lib/tax.js';

const REMIND_DAYS = [3, 0];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------- Telegram API ----------
async function tg(env, method, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  return res.json();
}

// ---------- Проверка подписи initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

export async function verifyInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  const sign = hex(await hmac(secret, check));
  if (sign !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

// ---------- Обработчики ----------
async function onUpdate(update, env) {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const openButton = { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: env.WEBAPP_URL } }]] };

  if (text.startsWith('/start')) {
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: 'Привет! Я бизнес-юрист в Telegram.\n\n'
        + '• Справочник: ответы со ссылками на законы\n'
        + '• Договоры, претензии и акты за пару минут\n'
        + '• Калькуляторы и календарь налогов с напоминаниями\n\n'
        + 'Всё бесплатно. Жмите кнопку ниже.',
      reply_markup: openButton,
    });
  } else if (text.startsWith('/stop')) {
    await env.USERS.delete(`u:${chatId}`);
    await tg(env, 'sendMessage', { chat_id: chatId, text: 'Напоминания выключены. Включить снова можно в разделе «Налоги».' });
  } else {
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: 'Я отвечаю через приложение: там справочник, документы и налоги.\n\n/stop — выключить напоминания',
      reply_markup: openButton,
    });
  }
}

async function apiDocument(body, user, env) {
  const filename = String(body.filename || 'Документ.docx').replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
  if (!filename.endsWith('.docx')) return json({ ok: false, error: 'bad_name' }, 400);
  const b64 = String(body.file || '');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return json({ ok: false, error: 'bad_file' }, 400);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ ok: false, error: 'bad_file' }, 400);

  const form = new FormData();
  form.append('chat_id', String(user.id));
  form.append('caption', 'Готово! Проверьте реквизиты и условия перед подписанием.');
  form.append('document', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename);
  const res = await tg(env, 'sendDocument', form);
  if (!res.ok) return json({ ok: false, error: 'telegram' }, 502);
  return json({ ok: true });
}

const ENTITIES = ['ip', 'ooo'];
const REGIMES = ['usn6', 'usn15', 'npd', 'patent'];

async function apiReminders(body, user, env) {
  const key = `u:${user.id}`;
  if (!body.enabled) { await env.USERS.delete(key); return json({ ok: true }); }
  const entity = ENTITIES.includes(body.profile?.entity) ? body.profile.entity : 'ip';
  const regime = REGIMES.includes(body.profile?.regime) ? body.profile.regime : 'usn6';
  // Профиль храним в metadata — чтобы ежедневная рассылка обходилась одним list() без чтений
  await env.USERS.put(key, '1', { metadata: { e: entity, r: regime } });
  return json({ ok: true });
}

// ---------- Ежедневная рассылка ----------
export function remindersFor(profile, today = new Date()) {
  return buildCalendar(profile, today, 1)
    .map((it) => ({ ...it, days: daysUntil(it.date, today) }))
    .filter((it) => REMIND_DAYS.includes(it.days));
}

function reminderText(items) {
  const lines = items.map((it) => `${it.days === 0 ? '🔴 Сегодня' : '🟡 Через 3 дня'}: ${it.title} (${it.note})`);
  return `Напоминание о налоговых сроках\n\n${lines.join('\n')}\n\nВыключить: /stop`;
}

async function runReminders(env, today = new Date()) {
  let cursor; let sent = 0;
  do {
    const page = await env.USERS.list({ prefix: 'u:', cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      const items = remindersFor({ entity: m.e || 'ip', regime: m.r || 'usn6' }, today);
      if (!items.length) continue;
      const chatId = k.name.slice(2);
      const openButton = { inline_keyboard: [[{ text: 'Открыть календарь', web_app: { url: env.WEBAPP_URL } }]] };
      const res = await tg(env, 'sendMessage', { chat_id: chatId, text: reminderText(items), reply_markup: openButton });
      if (!res.ok && res.error_code === 403) await env.USERS.delete(k.name); // пользователь заблокировал бота
      else sent++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return sent;
}

// ---------- Разовая настройка: вебхук, кнопка меню, команды ----------
async function setup(env, origin) {
  const results = {};
  results.webhook = await tg(env, 'setWebhook', {
    url: `${origin}/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message'], drop_pending_updates: true,
  });
  results.menu = await tg(env, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: env.WEBAPP_URL } },
  });
  results.commands = await tg(env, 'setMyCommands', {
    commands: [{ command: 'start', description: 'Открыть приложение' }, { command: 'stop', description: 'Выключить напоминания' }],
  });
  results.description = await tg(env, 'setMyShortDescription', {
    short_description: 'Бесплатный юрист и налоговый помощник для ИП и ООО: справочник, документы, календарь налогов.',
  });
  return results;
}

export const handler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
      const update = await request.json().catch(() => null);
      if (update) await onUpdate(update, env).catch((e) => console.error('update', e));
      return new Response('ok');
    }

    if (url.pathname.startsWith('/api/') && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const user = await verifyInitData(body.initData, env.BOT_TOKEN);
      if (!user?.id) return json({ ok: false, error: 'unauthorized' }, 401);
      if (url.pathname === '/api/document') return apiDocument(body, user, env);
      if (url.pathname === '/api/reminders') return apiReminders(body, user, env);
      return json({ ok: false, error: 'not_found' }, 404);
    }

    if (url.pathname === '/setup' && url.searchParams.get('key') === env.SETUP_KEY && env.SETUP_KEY) {
      return json(await setup(env, url.origin));
    }

    return new Response('Бизнес-юрист: бот работает', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).then((n) => console.log('reminders sent', n)));
  },
};

export { runReminders, onUpdate, apiDocument, apiReminders };
