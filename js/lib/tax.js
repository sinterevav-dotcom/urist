// Налоговые расчёты и календарь. Все цифры — в одном месте, чтобы раз в год обновлять.
// Источники: НК РФ гл. 26.2 (УСН), ст. 430 (взносы ИП), 422-ФЗ (НПД).

export const RATES = {
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
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function isWorkday(d) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso(d));
}

// Срок, выпавший на выходной, переносится на следующий рабочий день (п. 7 ст. 6.1 НК РФ)
export function shiftToWorkday(d) {
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
export function buildCalendar(profile, from = new Date(), months = 12) {
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

export const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
export const MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

export function daysUntil(isoDate, from = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / 86400000);
}

export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
}

export const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// --- Калькуляторы ---

/** Взносы ИП за год. base — доход (УСН 6%, патент) или доход минус расходы (УСН 15%). */
export function ipContributions(base, rates = RATES) {
  const onePercent = Math.min(Math.max(0, (base - rates.ipOnePercentFrom) * 0.01), rates.ipOnePercentCap);
  return { fixed: rates.ipFixed, onePercent: Math.round(onePercent), total: Math.round(rates.ipFixed + onePercent) };
}

/**
 * УСН «Доходы». Налог уменьшается на уплаченные взносы:
 * ИП без работников — до 100%, с работниками и ООО — не более чем на 50% (п. 3.1 ст. 346.21 НК).
 */
export function usn6({ income, rate = 6, contributions = 0, paidAdvances = 0, hasEmployees = false, entity = 'ip' }) {
  const gross = income * rate / 100;
  const maxReduce = entity === 'ip' && !hasEmployees ? gross : gross / 2;
  const reduce = Math.min(contributions, maxReduce);
  const tax = Math.max(0, gross - reduce);
  return { gross: Math.round(gross), reduce: Math.round(reduce), tax: Math.round(tax), toPay: Math.round(Math.max(0, tax - paidAdvances)) };
}

/** УСН «Доходы минус расходы». Минимальный налог за год — 1% от доходов (п. 6 ст. 346.18 НК). */
export function usn15({ income, expenses, rate = 15, paidAdvances = 0, annual = true }) {
  const base = Math.max(0, income - expenses);
  const regular = base * rate / 100;
  const minimal = income * 0.01;
  const useMin = annual && minimal > regular;
  const tax = useMin ? minimal : regular;
  return { base: Math.round(base), regular: Math.round(regular), minimal: Math.round(minimal), useMin, tax: Math.round(tax), toPay: Math.round(Math.max(0, tax - paidAdvances)) };
}

/** НПД: 4% с физлиц, 6% с юрлиц и ИП (без учёта вычета 10 000 ₽, его учитывает «Мой налог»). */
export function npd({ fromPersons = 0, fromCompanies = 0 }) {
  const tax = fromPersons * 0.04 + fromCompanies * 0.06;
  const total = fromPersons + fromCompanies;
  return { tax: Math.round(tax), overLimit: total > RATES.npdLimit };
}
