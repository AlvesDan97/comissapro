/** Dias úteis no calendário brasileiro (sáb/dom + feriados nacionais). */

function pad(n) {
  return String(n).padStart(2, '0');
}

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function holidaySet(year) {
  const easter = easterDate(year);
  const list = [
    `${year}-01-01`,
    `${year}-04-21`,
    `${year}-05-01`,
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-11-20`,
    `${year}-12-25`,
    iso(addDays(easter, -48)),
    iso(addDays(easter, -47)),
    iso(addDays(easter, -2)),
    iso(addDays(easter, 60)),
  ];
  return new Set(list);
}

function isBusinessDay(date) {
  const d = date instanceof Date ? date : new Date(`${date}T12:00:00`);
  const wd = d.getDay();
  if (wd === 0 || wd === 6) return false;
  return !holidaySet(d.getFullYear()).has(iso(d));
}

function nthBusinessDay(year, monthIndex, n) {
  const d = new Date(year, monthIndex, 1);
  let count = 0;
  for (let i = 0; i < 45; i++) {
    if (isBusinessDay(d)) {
      count += 1;
      if (count === n) return iso(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return iso(d);
}

function fifthBusinessDayNextMonth(saleDate) {
  const base = new Date(`${saleDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) {
    const now = new Date();
    return nthBusinessDay(now.getFullYear(), now.getMonth() + 1, 5);
  }
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  return nthBusinessDay(next.getFullYear(), next.getMonth(), 5);
}

module.exports = {
  isBusinessDay,
  nthBusinessDay,
  fifthBusinessDayNextMonth,
};
