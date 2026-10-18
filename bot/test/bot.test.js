import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, verifyInitData, remindersFor, runReminders } from '../src/core.js';

const TOKEN = '123456:TEST';
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
async function makeInitData(user, authDate = Math.floor(Date.now() / 1000)) {
  const fields = { auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify(user) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const hash = hex(await hmac(await hmac('WebAppData', TOKEN), check));
  return new URLSearchParams({ ...fields, hash }).toString();
}

function mockKV() {
  const m = new Map();
  return {
    m,
    async put(k, v, o) { m.set(k, { v, metadata: o?.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.metadata })), list_complete: true }; },
  };
}
function mockTelegram() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const method = url.split('/').pop();
    calls.push({ method, body: init.body instanceof FormData ? init.body : JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  return calls;
}
const env = () => ({ BOT_TOKEN: TOKEN, WEBHOOK_SECRET: 's3cret', SETUP_KEY: 'k', WEBAPP_URL: 'https://example.github.io/app/', USERS: mockKV() });
const post = (path, body, headers = {}) => new Request(`https://bot.example.workers.dev${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('initData: валидная подпись принимается, поддельная и старая — нет', async () => {
  const user = { id: 42, first_name: 'Алексей' };
  const good = await makeInitData(user);
  assert.equal((await verifyInitData(good, TOKEN)).id, 42);
  assert.equal(await verifyInitData(good.replace('42', '43'), TOKEN), null);
  assert.equal(await verifyInitData(good, '999:OTHER'), null);
  assert.equal(await verifyInitData(await makeInitData(user, 1_000_000), TOKEN), null);
});

test('webhook: /start отвечает кнопкой приложения, без секрета — 403', async () => {
  const calls = mockTelegram(); const e = env();
  const upd = { message: { chat: { id: 7 }, text: '/start' } };
  assert.equal((await handler.fetch(post('/webhook', upd), e)).status, 403);
  const res = await handler.fetch(post('/webhook', upd, { 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }), e);
  assert.equal(res.status, 200);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].web_app.url, e.WEBAPP_URL);
});

test('api/document: отправляет docx в чат пользователя', async () => {
  const calls = mockTelegram(); const e = env();
  const initData = await makeInitData({ id: 42 });
  const file = Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3]).toString('base64');
  const res = await handler.fetch(post('/api/document', { initData, filename: 'Акт.docx', file }), e);
  assert.equal(res.status, 200);
  assert.equal(calls[0].method, 'sendDocument');
  assert.equal(calls[0].body.get('chat_id'), '42');
  const bad = await handler.fetch(post('/api/document', { initData: 'x=1', filename: 'Акт.docx', file }), e);
  assert.equal(bad.status, 401);
});

test('напоминания: подписка, выбор дат и рассылка', async () => {
  const calls = mockTelegram(); const e = env();
  const initData = await makeInitData({ id: 42 });
  await handler.fetch(post('/api/reminders', { initData, enabled: true, profile: { entity: 'ip', regime: 'usn6' } }), e);
  assert.deepEqual(e.USERS.m.get('u:42').metadata, { e: 'ip', r: 'usn6' });

  const day = new Date(2026, 9, 25); // за 3 дня до аванса 28.10
  assert.deepEqual(remindersFor({ entity: 'ip', regime: 'usn6' }, day).map((i) => i.title), ['Аванс по УСН за 9 месяцев']);
  assert.equal(await runReminders(e, day), 1);
  assert.match(calls.at(-1).body.text, /Аванс по УСН за 9 месяцев/);

  assert.equal(await runReminders(e, new Date(2026, 9, 20)), 0); // нет сроков через 0 или 3 дня

  await handler.fetch(post('/api/reminders', { initData, enabled: false }), e);
  assert.equal(e.USERS.m.size, 0);
});
