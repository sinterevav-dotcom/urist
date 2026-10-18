import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, shiftToWorkday, iso, ipContributions, usn6, usn15, npd, daysUntil, fmt } from './tax.js';

const today = new Date(2026, 9, 18); // 18 октября 2026

test('перенос с воскресенья на понедельник', () => {
  assert.equal(iso(shiftToWorkday(new Date(2026, 9, 25))), '2026-10-26');
  assert.equal(iso(shiftToWorkday(new Date(2027, 3, 25))), '2027-04-26');
  assert.equal(iso(shiftToWorkday(new Date(2027, 2, 28))), '2027-03-29');
});

test('календарь ИП на УСН 6% с 18.10.2026', () => {
  const cal = buildCalendar({ entity: 'ip', regime: 'usn6' }, today, 9);
  const s = cal.map((i) => `${i.date} ${i.title}`);
  assert.equal(cal[0].date, '2026-10-26'); // уведомление за 9 месяцев
  assert.ok(s.includes('2026-10-28 Аванс по УСН за 9 месяцев'));
  assert.ok(s.includes('2026-12-28 Фиксированные взносы ИП'));
  assert.ok(s.includes('2027-04-26 Декларация по УСН'));
  assert.ok(s.includes('2027-04-28 Налог по УСН за год'));
  assert.ok(s.includes('2027-07-01 Взносы 1% с дохода свыше 300 000 ₽'));
});

test('ООО на УСН — годовые сроки в марте, без взносов ИП', () => {
  const cal = buildCalendar({ entity: 'ooo', regime: 'usn15' }, today, 6);
  const s = cal.map((i) => `${i.date} ${i.title}`);
  assert.ok(s.includes('2027-03-25 Декларация по УСН'));
  assert.ok(s.includes('2027-03-29 Налог по УСН за год'));
  assert.ok(!s.some((x) => x.includes('взносы ИП')));
});

test('НПД — ежемесячно 28 числа', () => {
  const cal = buildCalendar({ entity: 'ip', regime: 'npd' }, today, 3);
  assert.equal(cal[0].date, '2026-10-28');
  assert.ok(cal.every((i) => !i.title.includes('взносы')));
});

test('взносы ИП', () => {
  assert.deepEqual(ipContributions(200000), { fixed: 57390, onePercent: 0, total: 57390 });
  assert.equal(ipContributions(1_300_000).onePercent, 10000);
  assert.equal(ipContributions(1e12).onePercent, 321818);
});

test('УСН 6%: ИП без работников уменьшает до нуля, с работниками — на 50%', () => {
  assert.equal(usn6({ income: 500000, contributions: 57390 }).tax, 0);
  assert.equal(usn6({ income: 2_000_000, contributions: 57390 }).tax, 62610);
  assert.equal(usn6({ income: 1_000_000, contributions: 100000, hasEmployees: true }).tax, 30000);
});

test('УСН 15%: минимальный налог 1%', () => {
  const r = usn15({ income: 1_000_000, expenses: 980_000 });
  assert.equal(r.useMin, true);
  assert.equal(r.tax, 10000);
  assert.equal(usn15({ income: 1_000_000, expenses: 600_000 }).tax, 60000);
});

test('НПД и форматирование', () => {
  assert.equal(npd({ fromPersons: 100000, fromCompanies: 100000 }).tax, 10000);
  assert.equal(daysUntil('2026-10-28', today), 10);
  assert.equal(fmt(18400), '18 400 ₽');
});
