// Бизнес-юрист — бот. Один файл для вставки в редактор Cloudflare Workers.
// Сгенерирован из js/lib/tax.js и bot/src/core.js — правьте исходники, а не этот файл.

// Налоговые расчёты и календарь. Все цифры — в одном месте, чтобы раз в год обновлять.
// Источники: НК РФ гл. 26.2 (УСН), ст. 430 (взносы ИП), 422-ФЗ (НПД).

const RATES = {
  year: 2026,
  ipFixed: 57390,          // фиксированные взносы ИП за 2026 (ст. 430 НК)
  ipOnePercentCap: 321818, // максимум 1% взносов за 2026
  ipOnePercentFrom: 300000,
  usnIncomeLimit: 490_500_000, // лимит доходов УСН на 2026 (с индексацией)
  usnVatThreshold: 20_000_000, // порог освобождения от НДС на УСН
  npdLimit: 2_400_000,
};

// Нерабочие праздничные дни (производственный календарь). Обновлять раз в год.
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01','2026-01-02','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09',
  '2026-02-23','2026-03-09','2026-05-01','2026-05-11','2026-06-12','2026-11-04','2026-12-31',
  // 2027 (базовые даты; переносы уточнить после утверждения календаря)
  '2027-01-01','2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08',
  '2027-02-23','2027-03-08','2027-05-03','2027-05-10','2027-06-14','2027-11-04',
]);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function isWorkday(d) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(d));
}

// Срок, выпавший на выходной, переносится на следующий рабочий день (п. 7 ст. 6.1 НК РФ)
function shiftToWorkday(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (!isWorkday(r)) r.setDate(r.getDate() + 1);
  return r;
}

const D = (y, m, day) => new Date(y, m - 1, day);

/**
 * Календарь платежей и отчётов.
 * @param {{entity:'ip'|'ooo', regime:'usn6'|'usn15'|'npd'|'patent'}} profile
 * @param {Date} from — дата отсчёта (сегодня)
 * @param {number} months — горизонт
 */
function buildCalendar(profile, from = new Date(), months = 12) {
  const { entity, regime } = profile;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(start); end.setMonth(end.getMonth() + months);
  const items = [];
  const add = (date, title, note, kind = 'pay') => {
    const due = shiftToWorkday(date);
    if (due >= start && due <= end) items.push({ date: iso(due), title, note, kind });
  };

  for (let y = start.getFullYear() - 1; y <= end.getFullYear() + 1; y++) {
    if (regime === 'usn6' || regime === 'usn15') {
      const q = [['за I квартал', 4], ['за полугодие', 7], ['за 9 месяцев', 10]];
      for (const [label, m] of q) {
        add(D(y, m, 25), `Уведомление об авансе УСН ${label}`, `${y} год · если аванс к уплате`, 'report');
        add(D(y, m, 28), `Аванс по УСН ${label}`, `${y} год`);
      }
      if (entity === 'ooo') {
        add(D(y + 1, 3, 25), 'Декларация по УСН', `за ${y} год`, 'report');
        add(D(y + 1, 3, 28), 'Налог по УСН за год', `за ${y} год`);
      } else {
        add(D(y + 1, 4, 25), 'Декларация по УСН', `за ${y} год`, 'report');
        add(D(y + 1, 4, 28), 'Налог по УСН за год', `за ${y} год`);
      }
    }
    if (regime === 'npd') {
      for (let m = 1; m <= 12; m++) {
        const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y;
        add(D(ny, nm, 28), 'Налог самозанятого', `за ${MONTHS[m - 1]} ${y} · сумма в «Мой налог»`);
      }
    }
    if (entity === 'ip' && regime !== 'npd') {
      add(D(y, 12, 28), 'Фиксированные взносы ИП', y === RATES.year ? `за ${y} год · ${fmt(RATES.ipFixed)}` : `за ${y} год`);
      add(D(y + 1, 7, 1), 'Взносы 1% с дохода свыше 300 000 ₽', `за ${y} год`);
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  return items;
}

const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

function daysUntil(isoDate, from = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / 86400000);
}

function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// --- Калькуляторы ---

/** Взносы ИП за год. base — доход (УСН 6%, патент) или доход минус расходы (УСН 15%). */
function ipContributions(base, rates = RATES) {
  const onePercent = Math.min(Math.max(0, (base - rates.ipOnePercentFrom) * 0.01), rates.ipOnePercentCap);
  return { fixed: rates.ipFixed, onePercent: Math.round(onePercent), total: Math.round(rates.ipFixed + onePercent) };
}

/**
 * УСН «Доходы». Налог уменьшается на уплаченные взносы:
 * ИП без работников — до 100%, с работниками и ООО — не более чем на 50% (п. 3.1 ст. 346.21 НК).
 */
function usn6({ income, rate = 6, contributions = 0, paidAdvances = 0, hasEmployees = false, entity = 'ip' }) {
  const gross = income * rate / 100;
  const maxReduce = entity === 'ip' && !hasEmployees ? gross : gross / 2;
  const reduce = Math.min(contributions, maxReduce);
  const tax = Math.max(0, gross - reduce);
  return { gross: Math.round(gross), reduce: Math.round(reduce), tax: Math.round(tax), toPay: Math.round(Math.max(0, tax - paidAdvances)) };
}

/** УСН «Доходы минус расходы». Минимальный налог за год — 1% от доходов (п. 6 ст. 346.18 НК). */
function usn15({ income, expenses, rate = 15, paidAdvances = 0, annual = true }) {
  const base = Math.max(0, income - expenses);
  const regular = base * rate / 100;
  const minimal = income * 0.01;
  const useMin = annual && minimal > regular;
  const tax = useMin ? minimal : regular;
  return { base: Math.round(base), regular: Math.round(regular), minimal: Math.round(minimal), useMin, tax: Math.round(tax), toPay: Math.round(Math.max(0, tax - paidAdvances)) };
}

/** НПД: 4% с физлиц, 6% с юрлиц и ИП (без учёта вычета 10 000 ₽, его учитывает «Мой налог»). */
function npd({ fromPersons = 0, fromCompanies = 0 }) {
  const tax = fromPersons * 0.04 + fromCompanies * 0.06;
  const total = fromPersons + fromCompanies;
  return { tax: Math.round(tax), overLimit: total > RATES.npdLimit };
}


// Бот «Бизнес-юрист» на Cloudflare Workers (бесплатный тариф).
// Секрет: BOT_TOKEN (обязательно). Необязательно: WEBHOOK_SECRET, SETUP_KEY, WEBAPP_URL. KV: USERS.

const REMIND_DAYS = [3, 0];
const DEFAULT_WEBAPP_URL = 'https://sinterevav-dotcom.github.io/urist/';

// Секрет вебхука выводится из токена, чтобы не заводить отдельную переменную
async function webhookSecret(env) {
  if (env.WEBHOOK_SECRET) return env.WEBHOOK_SECRET;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webhook:' + env.BOT_TOKEN));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
const withDefaults = (env) => ({ ...env, WEBAPP_URL: env.WEBAPP_URL || DEFAULT_WEBAPP_URL });
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

async function verifyInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
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
function remindersFor(profile, today = new Date()) {
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
    url: `${origin}/webhook`, secret_token: await webhookSecret(env), allowed_updates: ['message'], drop_pending_updates: true,
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

const handler = {
  async fetch(request, rawEnv) {
    const env = withDefaults(rawEnv);
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await webhookSecret(env)) return new Response('forbidden', { status: 403 });
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

    // Разовая настройка. Безопасна при повторных вызовах: ставит вебхук на этот же воркер и кнопку на WEBAPP_URL
    if (url.pathname === '/setup' && (!env.SETUP_KEY || url.searchParams.get('key') === env.SETUP_KEY)) {
      if (!env.BOT_TOKEN) return json({ ok: false, error: 'Добавьте секрет BOT_TOKEN в настройках воркера' }, 500);
      return json(await setup(env, url.origin));
    }

    return new Response('Бизнес-юрист: бот работает', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },

  async scheduled(event, rawEnv, ctx) {
    const env = withDefaults(rawEnv);
    ctx.waitUntil(runReminders(env).then((n) => console.log('reminders sent', n)));
  },
};


export default handler;
