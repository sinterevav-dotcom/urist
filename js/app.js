import { ARTICLES, CATEGORIES, findArticle, searchArticles } from './data/articles.js';
import { TEMPLATES } from './data/templates.js';
import { buildDocx } from './lib/docx.js';
import {
  RATES, buildCalendar, daysUntil, fmt, plural, MONTHS_SHORT,
  ipContributions, usn6, usn15, npd,
} from './lib/tax.js';
import {
  initPlatform, userName, setBack, haptic, hapticOk, loadLocal, saveLocal, loadCloud,
  deliverDocument, saveReminders, botAvailable,
} from './platform.js';

// ---------- утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const dateLong = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };
const num = (v) => Number(String(v ?? '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
const inDays = (n) => n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;

const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  contract: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M8 18h2M12 18h2"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  book: '<path d="M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
};
const icon = (name, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const REGIMES = { usn6: 'УСН 6%', usn15: 'УСН 15%', npd: 'НПД', patent: 'Патент' };
const ENTITIES = { ip: 'ИП', ooo: 'ООО' };

// ---------- состояние ----------
const defaults = {
  tab: 'home',
  view: null,
  profile: { entity: 'ip', regime: 'usn6', employees: false, onboarded: false, remind: false },
  guide: { q: '', cat: 'all' },
  drafts: {},
  docsMade: 0,
  calc: {},
  calShowAll: false,
};
const saved = loadLocal();
const state = { ...defaults, ...saved, tab: 'home', view: null, guide: { q: '', cat: 'all' }, calShowAll: false,
  profile: { ...defaults.profile, ...(saved.profile || {}) } };

function persist() {
  const { profile, drafts, docsMade, calc } = state;
  saveLocal({ profile, drafts, docsMade, calc });
}

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 3200);
}

// ---------- экраны ----------
function calendar() { return buildCalendar(state.profile, new Date(), 12); }

function onboardingScreen() {
  const p = state.profile;
  const regimes = p.entity === 'ooo' ? ['usn6', 'usn15'] : ['usn6', 'usn15', 'npd', 'patent'];
  return `<main class="screen no-nav">
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <span class="badge soft" style="align-self:flex-start">Бесплатно</span>
      <h1 style="font-size:28px;line-height:1.2">Юрист и налоговый помощник для бизнеса</h1>
      <p class="muted" style="margin:0;line-height:1.5">Ответы со ссылками на законы, договоры за пару минут и напоминания о налогах.</p>
    </div>
    <div class="card">
      <span class="label-caps">Ваша форма бизнеса</span>
      <div class="segmented">${Object.entries(ENTITIES).map(([k, v]) => `<button type="button" data-a="entity" data-v="${k}" aria-pressed="${p.entity === k}">${v}</button>`).join('')}</div>
      <span class="label-caps">Налоговый режим</span>
      <div class="chip-row">${regimes.map((r) => `<button type="button" class="chip" data-a="regime" data-v="${r}" aria-pressed="${p.regime === r}">${REGIMES[r]}</button>`).join('')}</div>
      <span class="small muted">Это можно поменять в любой момент в разделе «Налоги».</span>
    </div>
    <div class="note warn">${icon('info', 22)}<span>Приложение даёт справочную информацию, а не юридическую консультацию. В сложной ситуации обратитесь к юристу.</span></div>
    <button type="button" class="btn primary block" data-a="onboard">Начать</button>
  </main>`;
}

function homeScreen() {
  const p = state.profile;
  const cal = calendar();
  const next = cal[0];
  const name = userName();
  let hero = '';
  if (next) {
    const d = daysUntil(next.date);
    const fill = Math.max(4, Math.min(100, 100 - (d / 30) * 100));
    hero = `<section class="card" aria-label="Ближайший срок">
      <div class="row between"><span class="label-caps">Ближайший срок</span><span class="badge">${inDays(d)}</span></div>
      <div class="big-num">${dateLong(next.date)}</div>
      <div style="font-size:14px;color:var(--text-2);line-height:1.45">${esc(next.title)} · ${esc(next.note)}</div>
      <div class="progress"><span style="width:${fill}%"></span></div>
      <div class="btn-row"><button type="button" class="btn primary" data-a="tab" data-v="taxes">Рассчитать</button><button type="button" class="btn secondary" data-a="tab" data-v="taxes" data-scroll="calendar">Все сроки</button></div>
    </section>`;
  }
  const drafts = Object.keys(state.drafts).length;
  const stat1 = p.entity === 'ip' && p.regime !== 'npd'
    ? `<span class="small muted">Фикс. взносы ИП ${RATES.year}</span><span class="mid-num">${fmt(RATES.ipFixed)}</span><span class="small" style="color:var(--ok)">до 28 декабря</span>`
    : p.regime === 'npd'
      ? `<span class="small muted">Лимит дохода НПД</span><span class="mid-num">2,4 млн ₽</span><span class="small muted">в год</span>`
      : `<span class="small muted">Лимит доходов УСН</span><span class="mid-num">490,5 млн ₽</span><span class="small muted">в ${RATES.year} году</span>`;
  const popular = ['debt', 'first-employee', 'usn-choice'].map(findArticle);
  return `<main class="screen">
    <div class="row between">
      <div style="display:flex;flex-direction:column;gap:2px"><span class="small muted" style="font-size:13px">Добрый день</span><span style="font-size:20px;font-weight:700">${esc(name || 'Ваш бизнес')}</span></div>
      <button type="button" class="chip" data-a="tab" data-v="taxes" style="min-height:44px;display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:4px;background:var(--ok)"></span>${ENTITIES[p.entity]} · ${REGIMES[p.regime]}</button>
    </div>
    ${hero}
    <div class="grid2">
      <div class="card tight">${stat1}</div>
      <button type="button" class="card tight" data-a="tab" data-v="docs" style="text-align:left;color:var(--text)"><span class="small muted">Мои документы</span><span class="mid-num">${state.docsMade}</span><span class="small muted">${drafts ? `${drafts} ${plural(drafts, 'черновик', 'черновика', 'черновиков')}` : 'создано'}</span></button>
    </div>
    <section style="display:flex;flex-direction:column;gap:12px">
      <span class="section-title">Быстрые действия</span>
      <div class="grid4">
        <button type="button" class="quick" data-a="tab" data-v="guide" data-focus="1"><span class="ico">${icon('search')}</span>Найти ответ</button>
        <button type="button" class="quick" data-a="wizard" data-v="services"><span class="ico">${icon('contract')}</span>Договор</button>
        <button type="button" class="quick" data-a="wizard" data-v="claim"><span class="ico">${icon('warning')}</span>Претензия</button>
        <button type="button" class="quick" data-a="tab" data-v="taxes"><span class="ico">${icon('calc')}</span>Калькулятор</button>
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:4px">
      <div class="section-title">Популярное в справочнике<button type="button" data-a="tab" data-v="guide">Все</button></div>
      <div class="list">${popular.map(articleItem).join('')}</div>
    </section>
  </main>`;
}

const catName = (id) => (CATEGORIES.find(([k]) => k === id) || [, ''])[1];
function articleItem(a) {
  return `<button type="button" class="list-item" data-a="article" data-v="${a.id}"><span class="grow"><span class="t">${esc(a.title)}</span><span class="s">${catName(a.cat)} · ${esc(a.refs)}</span></span><span class="chev">${icon('chev', 18)}</span></button>`;
}

function guideScreen() {
  const results = searchArticles(state.guide.q, state.guide.cat);
  return `<main class="screen">
    <h1>Справочник</h1>
    <label class="search">${icon('search', 20)}<span class="sr">Поиск по справочнику</span>
      <input type="search" id="guide-q" data-f="guide-q" value="${esc(state.guide.q)}" placeholder="Например: уволить сотрудника" autocomplete="off" enterkeyhint="search"></label>
    <div class="chip-row" role="group" aria-label="Категории">${CATEGORIES.map(([k, v]) => `<button type="button" class="chip" data-a="cat" data-v="${k}" aria-pressed="${state.guide.cat === k}">${v}</button>`).join('')}</div>
    <div id="guide-results">${guideResults(results)}</div>
    <p class="small muted" style="margin:0">Справочная информация, не юридическая консультация. Нормы проверены в октябре 2026 г.</p>
  </main>`;
}
function guideResults(results) {
  if (!results.length) return `<div class="card tight"><strong>Ничего не нашли</strong><span class="small muted">Попробуйте другое слово. Мы постоянно добавляем новые темы.</span></div>`;
  return `<div class="list">${results.map(articleItem).join('')}</div>`;
}

function articleScreen(id) {
  const a = findArticle(id);
  if (!a) return guideScreen();
  const cta = a.cta ? `<button type="button" class="btn primary" data-a="${a.cta.template ? 'wizard' : 'tab'}" data-v="${a.cta.template || a.cta.tab}">${esc(a.cta.label)}</button>` : '';
  return `<main class="screen">
    <article class="card">
      <div class="row"><span class="badge soft">${catName(a.cat)}</span><span class="small muted">${a.minutes} мин чтения</span></div>
      <h2>${esc(a.title)}</h2>
      <p style="margin:0;font-size:15px;line-height:1.5;color:var(--text-2)"><strong style="color:var(--text)">Коротко:</strong> ${esc(a.summary)}</p>
      <ol class="steps">${a.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span class="b"><strong>${esc(s.title)}</strong><p>${esc(s.text)}</p><span>${esc(s.ref)}</span></span></li>`).join('')}</ol>
      ${cta}
    </article>
    ${a.related?.length ? `<section style="display:flex;flex-direction:column;gap:12px"><span class="section-title">Ещё по теме</span><div class="list">${a.related.map(findArticle).filter(Boolean).map(articleItem).join('')}</div></section>` : ''}
    <p class="small muted" style="margin:0">Справочная информация, не юридическая консультация. Если ситуация нестандартная или на кону крупная сумма — покажите её юристу.</p>
  </main>`;
}

function docsScreen() {
  const draftIds = Object.keys(state.drafts).filter((id) => TEMPLATES.some((t) => t.id === id));
  const draft = draftIds.length ? TEMPLATES.find((t) => t.id === draftIds[draftIds.length - 1]) : null;
  let draftCard = '';
  if (draft) {
    const d = state.drafts[draft.id];
    const total = draft.steps.length;
    const step = Math.min(d.step || 0, total - 1);
    draftCard = `<section class="card">
      <div class="row between"><span class="label-caps">Черновик</span><span style="font-size:13px;font-weight:700;color:var(--accent)">Шаг ${step + 1} из ${total}</span></div>
      <span style="font-size:18px;font-weight:700">${esc(draft.title)}</span>
      <div class="stepbar">${draft.steps.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
      <div class="btn-row"><button type="button" class="btn secondary" data-a="drop-draft" data-v="${draft.id}">Удалить</button><button type="button" class="btn primary" data-a="wizard" data-v="${draft.id}" style="flex:2">Продолжить</button></div>
    </section>`;
  }
  return `<main class="screen">
    <h1>Документы</h1>
    ${draftCard}
    <section style="display:flex;flex-direction:column;gap:12px">
      <span class="section-title">Шаблоны</span>
      <div class="grid2">${TEMPLATES.map((t) => `<button type="button" class="tpl" data-a="wizard" data-v="${t.id}"><span class="ico">${icon(t.icon)}</span><strong>${esc(t.short)}</strong><span>${t.steps.length} ${plural(t.steps.length, 'шаг', 'шага', 'шагов')} · ${t.minutes} мин</span></button>`).join('')}
      <div class="tpl" style="opacity:.6"><span class="ico">${icon('doc')}</span><strong>Скоро</strong><span>Трудовой договор, расписка, уведомления</span></div></div>
    </section>
    <div class="note">${icon('down', 22)}<span>${botAvailable() ? 'Готовый документ в формате Word придёт в чат с ботом.' : 'Готовый документ скачивается в формате Word.'} Перед подписанием проверьте данные.</span></div>
  </main>`;
}

function fieldValue(tpl, f) {
  const d = state.drafts[tpl.id]?.values || {};
  if (d[f.id] !== undefined) return d[f.id];
  return typeof f.default === 'function' ? f.default() : '';
}

function wizardScreen(tplId) {
  const tpl = TEMPLATES.find((t) => t.id === tplId);
  const draft = state.drafts[tpl.id] || (state.drafts[tpl.id] = { values: {}, step: 0 });
  const total = tpl.steps.length;
  if (draft.step >= total) return previewScreen(tpl);
  const step = tpl.steps[draft.step];
  const fields = step.fields.map((f) => {
    const v = fieldValue(tpl, f);
    const id = `f-${f.id}`;
    let input;
    if (f.type === 'textarea') input = `<textarea id="${id}" data-f="field" data-k="${f.id}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    else if (f.type === 'select') input = `<select id="${id}" data-f="field" data-k="${f.id}">${f.options.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else input = `<input id="${id}" data-f="field" data-k="${f.id}" type="${f.type === 'number' ? 'text' : f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">`;
    return `<div class="field" data-field="${f.id}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
  }).join('');
  const last = draft.step === total - 1;
  return `<main class="screen no-nav">
    <div class="row between"><span class="label-caps">${esc(tpl.title)}</span><span style="font-size:13px;font-weight:700;color:var(--accent)">${draft.step + 1} / ${total}</span></div>
    <div class="stepbar">${tpl.steps.map((_, i) => `<span class="${i <= draft.step ? 'on' : ''}"></span>`).join('')}</div>
    <h1>${esc(step.title)}</h1>
    <form class="card" data-form="wizard" novalidate>${fields}
      <div class="btn-row">${draft.step > 0 ? '<button type="button" class="btn secondary" data-a="step-back">Назад</button>' : ''}<button type="submit" class="btn primary" style="flex:2">${last ? 'Проверить документ' : 'Далее'}</button></div>
    </form>
    <p class="small muted" style="margin:0">Данные хранятся только на вашем устройстве и в вашем Telegram.</p>
  </main>`;
}

function blocksToHtml(blocks) {
  return blocks.map((b) => {
    if (b.t === 'gap') return '<p>&nbsp;</p>';
    if (b.t === 'sign') return `<p style="display:flex;justify-content:space-between;gap:12px"><span>${esc(b.text[0])}</span><span>${esc(b.text[1])}</span></p>`;
    const cls = { title: 'c', center: 'c', right: 'r', h: 'h' }[b.t] || '';
    return `<p class="${cls}"${b.bold ? ' style="font-weight:700"' : ''}>${esc(b.text).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function draftValues(tpl) {
  const values = {};
  for (const s of tpl.steps) for (const f of s.fields) values[f.id] = fieldValue(tpl, f);
  return values;
}

function previewScreen(tpl) {
  const blocks = tpl.build(draftValues(tpl));
  return `<main class="screen no-nav">
    <span class="label-caps">${esc(tpl.title)}</span>
    <h1>Проверьте документ</h1>
    <div class="preview" aria-label="Предпросмотр документа">${blocksToHtml(blocks)}</div>
    <div class="note warn">${icon('info', 22)}<span>Это типовой шаблон. Сверьте реквизиты и условия перед подписанием.</span></div>
    <div class="btn-row"><button type="button" class="btn secondary" data-a="step-back">Изменить</button><button type="button" class="btn primary" data-a="make-doc" data-v="${tpl.id}" style="flex:2">${icon(botAvailable() ? 'send' : 'down', 20)}${botAvailable() ? 'Отправить в чат' : 'Скачать Word'}</button></div>
  </main>`;
}

function doneScreen(tplId, how) {
  const tpl = TEMPLATES.find((t) => t.id === tplId);
  return `<main class="screen no-nav" style="justify-content:center">
    <div class="card" style="align-items:center;text-align:center;gap:12px">
      <span style="width:64px;height:64px;border-radius:32px;background:var(--ok-bg);color:var(--ok);display:flex;align-items:center;justify-content:center">${icon('check', 32)}</span>
      <h2>${how === 'chat' ? 'Документ в чате с ботом' : 'Документ скачан'}</h2>
      <p class="muted" style="margin:0;line-height:1.5">${esc(tpl.title)} в формате Word. Откройте, проверьте и подпишите.</p>
    </div>
    <div class="btn-row"><button type="button" class="btn secondary" data-a="close-view" data-v="docs">К документам</button><button type="button" class="btn primary" data-a="close-view" data-v="home">На главную</button></div>
  </main>`;
}

function calcBlock() {
  const p = state.profile, c = state.calc;
  const input = (k, label, ph = '0') => `<div class="field"><label for="c-${k}">${label}</label><input id="c-${k}" data-f="calc" data-k="${k}" type="text" inputmode="decimal" value="${esc(c[k] || '')}" placeholder="${ph}" autocomplete="off"></div>`;
  let fields = '', title = '';
  if (p.regime === 'usn6') {
    title = 'Калькулятор УСН 6%';
    fields = input('income', 'Доход с начала года, ₽', 'Введите сумму') + input('contrib', 'Уплаченные взносы с начала года, ₽') + input('advances', 'Уже уплаченные авансы, ₽');
  } else if (p.regime === 'usn15') {
    title = 'Калькулятор УСН 15%';
    fields = input('income', 'Доход с начала года, ₽', 'Введите сумму') + input('expenses', 'Расходы с начала года, ₽ (включая взносы)') + input('advances', 'Уже уплаченные авансы, ₽');
  } else if (p.regime === 'npd') {
    title = 'Калькулятор НПД';
    fields = input('persons', 'Доход от физлиц за месяц, ₽') + input('companies', 'Доход от компаний и ИП за месяц, ₽');
  } else {
    title = 'Патент';
    fields = `<p class="small muted" style="margin:0">Стоимость патента зависит от региона и вида деятельности — точно её считает калькулятор ФНС на patent.nalog.gov.ru. Ниже — расчёт взносов, на которые можно уменьшить патент.</p>` + input('income', 'Потенциальный доход по патенту за год, ₽', 'Из калькулятора ФНС');
  }
  return `<section class="card" aria-label="${title}">
    <span class="label-caps">${title}</span>
    ${fields}
    <div id="calc-result" aria-live="polite">${calcResult()}</div>
  </section>`;
}

function calcResult() {
  const p = state.profile, c = state.calc;
  const ip = p.entity === 'ip';
  const contribLine = (base) => {
    if (!ip) return '';
    const v = ipContributions(base);
    return `<div style="border-top:1px solid var(--line-soft);padding-top:12px;display:flex;flex-direction:column;gap:6px">
      <div class="kv"><span>Фикс. взносы ИП за ${RATES.year}</span><span>${fmt(v.fixed)}</span></div>
      <div class="kv"><span>1% с дохода свыше 300 000 ₽</span><span>${fmt(v.onePercent)}</span></div>
      <div class="kv" style="color:var(--text);font-weight:700"><span>Всего взносов</span><span>${fmt(v.total)}</span></div></div>`;
  };
  if (p.regime === 'usn6') {
    const r = usn6({ income: num(c.income), contributions: num(c.contrib), paidAdvances: num(c.advances), hasEmployees: p.employees, entity: p.entity });
    return `<div style="display:flex;flex-direction:column;gap:8px">
      <div class="kv"><span>Налог 6%</span><span>${fmt(r.gross)}</span></div>
      <div class="kv"><span>Уменьшение на взносы${ip && !p.employees ? '' : ' (до 50%)'}</span><span>− ${fmt(r.reduce)}</span></div>
      <div class="result"><span style="font-size:14px;color:var(--text-2)">К уплате сейчас</span><span class="mid-num">${fmt(r.toPay)}</span></div></div>
      <p class="small muted" style="margin:6px 0 0">Ставка в вашем регионе может быть ниже 6% — проверьте региональный закон.</p>${contribLine(num(c.income))}`;
  }
  if (p.regime === 'usn15') {
    const r = usn15({ income: num(c.income), expenses: num(c.expenses), paidAdvances: num(c.advances), annual: false });
    const yearMin = usn15({ income: num(c.income), expenses: num(c.expenses) });
    return `<div style="display:flex;flex-direction:column;gap:8px">
      <div class="kv"><span>База (доходы − расходы)</span><span>${fmt(r.base)}</span></div>
      <div class="kv"><span>Налог 15%</span><span>${fmt(r.regular)}</span></div>
      <div class="result"><span style="font-size:14px;color:var(--text-2)">К уплате сейчас</span><span class="mid-num">${fmt(r.toPay)}</span></div></div>
      ${yearMin.useMin && num(c.income) ? `<p class="small" style="margin:6px 0 0;color:var(--accent)">По итогам года действует минимальный налог 1% — ${fmt(yearMin.minimal)}.</p>` : ''}
      ${contribLine(Math.max(0, num(c.income) - num(c.expenses)))}`;
  }
  if (p.regime === 'npd') {
    const r = npd({ fromPersons: num(c.persons), fromCompanies: num(c.companies) });
    return `<div class="result"><span style="font-size:14px;color:var(--text-2)">Налог за месяц</span><span class="mid-num">${fmt(r.tax)}</span></div>
      <p class="small muted" style="margin:6px 0 0">Без учёта вычета 10 000 ₽ — его применит «Мой налог». Платить до 28 числа следующего месяца.</p>`;
  }
  return contribLine(num(c.income)) || '<p class="small muted" style="margin:0">Для ООО на патенте расчёт недоступен.</p>';
}

function taxesScreen() {
  const p = state.profile;
  const regimes = p.entity === 'ooo' ? ['usn6', 'usn15'] : ['usn6', 'usn15', 'npd', 'patent'];
  const cal = calendar();
  const shown = state.calShowAll ? cal : cal.slice(0, 6);
  const calHtml = shown.map((it, i) => {
    const [, m, d] = it.date.split('-').map(Number);
    const days = daysUntil(it.date);
    return `<div class="list-item"><span class="date-tile${i === 0 ? ' hot' : ''}"><b>${d}</b><small>${MONTHS_SHORT[m - 1]}</small></span>
      <span class="grow"><span class="t">${esc(it.title)}</span><span class="s"${i === 0 ? ' style="color:var(--accent)"' : ''}>${esc(it.note)} · ${inDays(days)}</span></span></div>`;
  }).join('');
  const remind = botAvailable()
    ? `<label class="switch"><span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:14px;font-weight:600">Напоминать в Telegram</span><span class="small muted">за 3 дня и в день срока</span></span><input type="checkbox" data-f="remind" ${p.remind ? 'checked' : ''}></label>`
    : `<div class="note">${icon('info', 22)}<span>Напоминания о сроках приходят от бота, когда приложение открыто через Telegram.</span></div>`;
  return `<main class="screen">
    <h1>Налоги</h1>
    <div class="segmented" role="group" aria-label="Форма бизнеса">${Object.entries(ENTITIES).map(([k, v]) => `<button type="button" data-a="entity" data-v="${k}" aria-pressed="${p.entity === k}">${v}</button>`).join('')}</div>
    <div class="chip-row" role="group" aria-label="Налоговый режим">${regimes.map((r) => `<button type="button" class="chip" data-a="regime" data-v="${r}" aria-pressed="${p.regime === r}">${REGIMES[r]}</button>`).join('')}</div>
    ${p.entity === 'ip' && p.regime === 'usn6' ? `<label class="switch"><span style="flex:1;font-size:14px;font-weight:600">Есть сотрудники</span><input type="checkbox" data-f="employees" ${p.employees ? 'checked' : ''}></label>` : ''}
    ${calcBlock()}
    <section id="calendar" style="display:flex;flex-direction:column;gap:4px">
      <div class="section-title">Календарь сроков${cal.length > 6 ? `<button type="button" data-a="cal-all">${state.calShowAll ? 'Свернуть' : 'Все'}</button>` : ''}</div>
      <div class="list">${calHtml || '<div class="list-item"><span class="grow"><span class="t">Нет сроков</span></span></div>'}</div>
      <p class="small muted" style="margin:6px 0 0">Сроки с учётом переноса с выходных. Платежи за сотрудников (НДФЛ, взносы) в календарь пока не входят.</p>
    </section>
    ${p.regime !== 'patent' ? remind : ''}
  </main>`;
}

function navBar() {
  const items = [['home', 'Главная', 'home'], ['guide', 'Справочник', 'book'], ['docs', 'Документы', 'doc'], ['taxes', 'Налоги', 'cal']];
  return `<nav class="nav" aria-label="Разделы"><div class="nav-inner">${items.map(([k, label, ic]) =>
    `<button type="button" data-a="tab" data-v="${k}"${state.tab === k ? ' aria-current="page"' : ''}>${icon(ic, 22)}${label}</button>`).join('')}</div></nav>`;
}

// ---------- рендер ----------
const root = document.getElementById('root');
function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  document.querySelector('.toast')?.remove();
  let html;
  if (!state.profile.onboarded) html = onboardingScreen();
  else if (state.view?.name === 'article') html = articleScreen(state.view.id);
  else if (state.view?.name === 'wizard') html = wizardScreen(state.view.id);
  else if (state.view?.name === 'done') html = doneScreen(state.view.id, state.view.how);
  else html = { home: homeScreen, guide: guideScreen, docs: docsScreen, taxes: taxesScreen }[state.tab]();
  const showNav = state.profile.onboarded && (!state.view || state.view.name === 'article');
  root.innerHTML = `<div class="app">${html}${showNav ? navBar() : ''}</div>`;
  setBack(state.view ? goBack : null);
  if (!keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, y);
}

function goBack() {
  const v = state.view;
  if (v?.name === 'wizard') {
    const d = state.drafts[v.id];
    if (d && d.step > 0) { d.step--; persist(); return render(); }
  }
  state.view = null; render();
}

function openView(view) { state.view = view; haptic(); render(); }

function setProfile(patch) {
  Object.assign(state.profile, patch);
  if (state.profile.entity === 'ooo' && !['usn6', 'usn15'].includes(state.profile.regime)) state.profile.regime = 'usn6';
  persist();
  if (state.profile.remind && botAvailable()) saveReminders(state.profile, true).catch(() => {});
}

function collectWizard(form, tpl) {
  const draft = state.drafts[tpl.id];
  form.querySelectorAll('[data-f="field"]').forEach((el) => { draft.values[el.dataset.k] = el.value; });
  persist();
}

// ---------- события ----------
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, v = el.dataset.v;
  switch (a) {
    case 'tab':
      state.view = null; state.tab = v; haptic(); render();
      if (el.dataset.scroll) document.getElementById(el.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
      if (el.dataset.focus) document.getElementById('guide-q')?.focus();
      break;
    case 'entity': setProfile({ entity: v }); render({ keepScroll: true }); break;
    case 'regime': setProfile({ regime: v }); render({ keepScroll: true }); break;
    case 'onboard': setProfile({ onboarded: true }); hapticOk(); render(); break;
    case 'cat': state.guide.cat = v; render({ keepScroll: true }); break;
    case 'article': openView({ name: 'article', id: v }); break;
    case 'wizard': openView({ name: 'wizard', id: v }); break;
    case 'cal-all': state.calShowAll = !state.calShowAll; render({ keepScroll: true }); break;
    case 'drop-draft': delete state.drafts[v]; persist(); render({ keepScroll: true }); break;
    case 'step-back': {
      const form = root.querySelector('[data-form="wizard"]');
      const tpl = TEMPLATES.find((t) => t.id === state.view.id);
      if (form) collectWizard(form, tpl);
      state.drafts[tpl.id].step = Math.max(0, state.drafts[tpl.id].step - 1); persist(); render();
      break;
    }
    case 'make-doc': {
      const tpl = TEMPLATES.find((t) => t.id === v);
      const values = draftValues(tpl);
      el.disabled = true;
      try {
        const bytes = buildDocx(tpl.build(values));
        const how = await deliverDocument(tpl.filename(values), bytes);
        state.docsMade += 1; delete state.drafts[tpl.id]; persist(); hapticOk();
        state.view = { name: 'done', id: tpl.id, how }; render();
      } catch (err) {
        el.disabled = false;
        toast('Не удалось отправить документ. Проверьте интернет и попробуйте ещё раз.');
      }
      break;
    }
    case 'close-view': state.view = null; state.tab = v; render(); break;
  }
});

root.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="wizard"]');
  if (!form) return;
  e.preventDefault();
  const tpl = TEMPLATES.find((t) => t.id === state.view.id);
  collectWizard(form, tpl);
  const draft = state.drafts[tpl.id];
  const missing = tpl.steps[draft.step].fields.filter((f) => f.required && !String(fieldValue(tpl, f)).trim());
  form.querySelectorAll('.field').forEach((el) => el.classList.toggle('invalid', missing.some((f) => f.id === el.dataset.field)));
  if (missing.length) { toast('Заполните обязательные поля'); form.querySelector('.invalid input, .invalid textarea')?.focus(); return; }
  draft.step += 1; persist(); haptic(); render();
});

root.addEventListener('input', (e) => {
  const el = e.target;
  const f = el.dataset.f;
  if (f === 'guide-q') {
    state.guide.q = el.value;
    document.getElementById('guide-results').innerHTML = guideResults(searchArticles(state.guide.q, state.guide.cat));
  } else if (f === 'calc') {
    state.calc[el.dataset.k] = el.value; persist();
    document.getElementById('calc-result').innerHTML = calcResult();
  } else if (f === 'field' && state.view?.name === 'wizard') {
    const d = state.drafts[state.view.id]; d.values[el.dataset.k] = el.value; persist();
    el.closest('.field')?.classList.remove('invalid');
  }
});

root.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.f === 'employees') { setProfile({ employees: el.checked }); document.getElementById('calc-result').innerHTML = calcResult(); }
  if (el.dataset.f === 'remind') {
    try {
      await saveReminders(state.profile, el.checked);
      setProfile({ remind: el.checked }); hapticOk();
      toast(el.checked ? 'Готово: бот напомнит о сроках' : 'Напоминания выключены');
    } catch {
      el.checked = !el.checked;
      toast('Не получилось сохранить. Попробуйте позже.');
    }
  }
});

// ---------- старт ----------
initPlatform();
render();
loadCloud().then((cloud) => {
  if (!cloud) return;
  // Данные из Telegram CloudStorage — для синхронизации между устройствами
  if (!saved.profile?.onboarded && cloud.profile?.onboarded) {
    Object.assign(state.profile, cloud.profile);
    state.drafts = cloud.drafts || state.drafts;
    state.docsMade = cloud.docsMade || state.docsMade;
    state.calc = cloud.calc || state.calc;
    persist(); render();
  }
});
