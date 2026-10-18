import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildDocx } from './docx.js';
import { TEMPLATES } from '../data/templates.js';
import { ARTICLES, searchArticles, findArticle } from '../data/articles.js';

const SAMPLE = {
  exName: 'ИП Иванов Иван Иванович', exDetails: 'ИНН 540000000000\nг. Новосибирск',
  clName: 'ООО «Ромашка»', clSigner: 'директора Петрова П.П., действующего на основании Устава', clDetails: 'ИНН 5400000000',
  number: '7', city: 'Новосибирск', date: '2026-10-18', subject: 'Настройка рекламы', deadline: 'до 30 ноября 2026 г.',
  price: '50000', vat: 'none', payment: 'half', payDays: '5', penalty: '0.1',
  fromName: 'ИП Иванов И.И.', fromDetails: 'ИНН 540000000000', toName: 'ООО «Ромашка»', contract: '№ 12 от 01.08.2026',
  debt: '50000', penaltySum: '0', days: '10', attachments: 'Копия договора; Копия акта',
  lines: 'Настройка рекламы — 30000\nВедение кампаний — 20 000 ₽',
};

test('все шаблоны собираются в валидный docx', () => {
  mkdirSync('/tmp/docx-out', { recursive: true });
  for (const tpl of TEMPLATES) {
    const blocks = tpl.build(SAMPLE);
    assert.ok(blocks.length > 5, tpl.id);
    const bytes = buildDocx(blocks);
    assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
    writeFileSync(`/tmp/docx-out/${tpl.id}.docx`, bytes);
    for (const s of tpl.steps) for (const f of s.fields) assert.ok(f.id && f.label, `${tpl.id}.${f.id}`);
  }
});

test('акт считает итог по строкам', () => {
  const act = TEMPLATES.find((t) => t.id === 'act');
  const lines = act.parseLines(SAMPLE.lines);
  assert.deepEqual(lines.map((l) => l.sum), [30000, 20000]);
  const text = act.build(SAMPLE).map((b) => b.text).join('\n');
  assert.ok(text.includes('50 000,00 руб.'));
});

test('справочник: поиск и связи', () => {
  assert.ok(searchArticles('сотрудник').some((a) => a.id === 'first-employee'));
  assert.equal(searchArticles('', 'tax').every((a) => a.cat === 'tax'), true);
  for (const a of ARTICLES) for (const r of a.related || []) assert.ok(findArticle(r), `${a.id} → ${r}`);
  for (const a of ARTICLES) if (a.cta?.template) assert.ok(TEMPLATES.some((t) => t.id === a.cta.template));
});
