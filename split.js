// Чистая логика расчёта: суммы хранятся в копейках (целые числа), без DOM.

export const CURRENCIES = {
  RUB: 'Рубль',
  USD: 'Доллар США',
  EUR: 'Евро',
  KZT: 'Тенге',
  BYN: 'Белорусский рубль',
  TRY: 'Турецкая лира',
  GEL: 'Лари',
  AMD: 'Драм',
};

export const MODES = ['equal', 'shares', 'exact'];

const MAX_CENTS = 1e12;

/** "1 234,5" -> 123450. Возвращает null, если строка не похожа на сумму. */
export function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    const cents = Math.round(input * 100);
    return cents <= MAX_CENTS ? cents : null;
  }
  const s = String(input ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Доля или вес участника: положительное число, допускается запятая. */
export function parseWeight(input) {
  const s = String(input ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1e6 ? n : null;
}

export function formatMoney(cents, currency = 'RUB') {
  const fraction = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Делит целую сумму пропорционально весам методом наибольшего остатка:
 * части всегда целые и в сумме дают ровно total.
 */
export function splitAmount(total, weights) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('Сумма должна быть целым неотрицательным числом');
  const sum = weights.reduce((a, w) => a + w, 0);
  if (!(sum > 0) || weights.some((w) => !(w >= 0))) throw new RangeError('Нужен хотя бы один положительный вес');
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) parts[order[k].i] += 1;
  return parts;
}

/** Сколько каждый участник должен по одному расходу: { personId: копейки }. */
export function sharesOf(expense) {
  const ids = Object.keys(expense.split);
  if (expense.mode === 'exact') return Object.fromEntries(ids.map((id) => [id, expense.split[id]]));
  const weights = ids.map((id) => (expense.mode === 'equal' ? 1 : expense.split[id]));
  const parts = splitAmount(expense.amount, weights);
  return Object.fromEntries(ids.map((id, i) => [id, parts[i]]));
}

/** Проверка расхода. Возвращает текст ошибки или null. */
export function validateExpense(expense, personIds) {
  const known = new Set(personIds);
  if (!expense || typeof expense !== 'object') return 'Некорректный расход';
  if (typeof expense.title !== 'string' || expense.title.length > 120) return 'Название расхода слишком длинное';
  if (!Number.isInteger(expense.amount) || expense.amount <= 0 || expense.amount > MAX_CENTS) return 'Укажите сумму больше нуля';
  if (!known.has(expense.payer)) return 'Выберите, кто платил';
  if (!MODES.includes(expense.mode)) return 'Неизвестный способ деления';
  const split = expense.split;
  if (!split || typeof split !== 'object') return 'Не выбраны участники';
  const ids = Object.keys(split);
  if (ids.length === 0) return 'Отметьте хотя бы одного участника';
  if (ids.some((id) => !known.has(id))) return 'В расходе есть неизвестный участник';
  if (expense.mode === 'equal' && ids.some((id) => split[id] !== 1)) return 'Некорректное деление поровну';
  if (expense.mode === 'shares' && ids.some((id) => !(typeof split[id] === 'number' && split[id] > 0 && split[id] <= 1e6))) {
    return 'Доли должны быть положительными числами';
  }
  if (expense.mode === 'exact') {
    if (ids.some((id) => !Number.isInteger(split[id]) || split[id] < 0)) return 'Суммы участников должны быть неотрицательными';
    const sum = ids.reduce((a, id) => a + split[id], 0);
    if (sum !== expense.amount) return 'Суммы участников не сходятся с суммой расхода';
  }
  return null;
}

/** Итог по каждому участнику: заплатил, его доля, баланс (плюс: ему должны). */
export function summarize(people, expenses) {
  const rows = new Map(people.map((p) => [p.id, { id: p.id, name: p.name, paid: 0, share: 0, balance: 0 }]));
  for (const e of expenses) {
    rows.get(e.payer).paid += e.amount;
    for (const [id, part] of Object.entries(sharesOf(e))) rows.get(id).share += part;
  }
  for (const r of rows.values()) r.balance = r.paid - r.share;
  return [...rows.values()];
}

/**
 * Минимальный по числу набор переводов жадным способом: крупнейший должник
 * платит крупнейшему кредитору. Переводов не больше, чем участников минус один.
 */
export function settle(rows) {
  const byAmount = (a, b) => b.amount - a.amount || String(a.id).localeCompare(String(b.id));
  const debtors = rows.filter((r) => r.balance < 0).map((r) => ({ id: r.id, amount: -r.balance })).sort(byAmount);
  const creditors = rows.filter((r) => r.balance > 0).map((r) => ({ id: r.id, amount: r.balance })).sort(byAmount);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}

/** Текст итога для отправки в чат. */
export function summaryText(event) {
  const rows = summarize(event.people, event.expenses);
  const names = Object.fromEntries(event.people.map((p) => [p.id, p.name]));
  const money = (c) => formatMoney(c, event.currency).replace(/[  ]/g, ' ');
  const total = event.expenses.reduce((a, e) => a + e.amount, 0);
  const lines = [`${event.name}`, `Всего потрачено: ${money(total)}`, ''];
  for (const r of rows) lines.push(`${r.name}: заплатил(а) ${money(r.paid)}, доля ${money(r.share)}`);
  const transfers = settle(rows);
  lines.push('');
  if (transfers.length === 0) lines.push('Все в расчёте, переводы не нужны.');
  else {
    lines.push('Кто кому переводит:');
    for (const t of transfers) lines.push(`${names[t.from]} → ${names[t.to]}: ${money(t.amount)}`);
  }
  return lines.join('\n');
}

/** Проверяет и очищает событие из хранилища, файла или ссылки. Бросает Error. */
export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Файл не похож на расчёт');
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Без названия';
  const currency = Object.hasOwn(CURRENCIES, raw.currency) ? raw.currency : 'RUB';
  if (!Array.isArray(raw.people) || !Array.isArray(raw.expenses)) throw new Error('В расчёте нет участников или расходов');
  const seen = new Set();
  const people = raw.people.map((p) => {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name.trim()) throw new Error('Некорректный участник');
    if (seen.has(p.id)) throw new Error('Повторяющийся участник');
    seen.add(p.id);
    return { id: p.id, name: p.name.trim().slice(0, 40) };
  });
  const ids = people.map((p) => p.id);
  const expenses = raw.expenses.map((e) => {
    const clean = {
      id: typeof e?.id === 'string' && e.id ? e.id : Math.random().toString(36).slice(2, 10),
      title: typeof e?.title === 'string' ? e.title.trim().slice(0, 120) : '',
      amount: e?.amount,
      payer: e?.payer,
      mode: e?.mode,
      split: e?.split && typeof e.split === 'object' ? { ...e.split } : null,
    };
    const err = validateExpense(clean, ids);
    if (err) throw new Error(`Расход «${clean.title || 'без названия'}»: ${err.toLowerCase()}`);
    return clean;
  });
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : null, name, currency, people, expenses };
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Событие -> строка для адреса ссылки. */
export function encodeEvent(event) {
  const { id, name, currency, people, expenses } = event;
  return toBase64Url(new TextEncoder().encode(JSON.stringify({ id, name, currency, people, expenses })));
}

export function decodeEvent(code) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(code)));
  } catch {
    throw new Error('Ссылка повреждена');
  }
  return sanitizeEvent(data);
}
