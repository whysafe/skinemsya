import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseWeight, formatMoney, splitAmount, sharesOf, validateExpense,
  summarize, settle, summaryText, sanitizeEvent, encodeEvent, decodeEvent,
} from '../split.js';

const people = [
  { id: 'a', name: 'Аня' },
  { id: 'b', name: 'Борис' },
  { id: 'c', name: 'Вика' },
];
const ids = people.map((p) => p.id);
const all = { a: 1, b: 1, c: 1 };

test('parseAmount понимает пробелы, запятую и копейки', () => {
  assert.equal(parseAmount('1500'), 150000);
  assert.equal(parseAmount('1 234,5'), 123450);
  assert.equal(parseAmount('349.90'), 34990);
  assert.equal(parseAmount('12.'), 1200);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount(19.99), 1999);
});

test('parseAmount отклоняет мусор', () => {
  for (const bad of ['', 'abc', '-5', '1,234', '1.999', '1e5', null, undefined, NaN, -1, '99999999999999']) {
    assert.equal(parseAmount(bad), null, String(bad));
  }
});

test('parseWeight принимает только положительные числа', () => {
  assert.equal(parseWeight('2'), 2);
  assert.equal(parseWeight('1,5'), 1.5);
  assert.equal(parseWeight('0'), null);
  assert.equal(parseWeight('-1'), null);
  assert.equal(parseWeight('x'), null);
});

test('formatMoney показывает копейки только когда они есть', () => {
  const norm = (s) => s.replace(/\s/g, ' ');
  assert.equal(norm(formatMoney(150000)), '1 500 ₽');
  assert.equal(norm(formatMoney(123450)), '1 234,50 ₽');
  assert.match(formatMoney(1000, 'USD'), /10/);
});

test('splitAmount делит без потери копеек', () => {
  assert.deepEqual(splitAmount(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(splitAmount(100, [1, 2]), [33, 67]);
  assert.deepEqual(splitAmount(0, [1, 1]), [0, 0]);
  const parts = splitAmount(999_99, [1.5, 2.25, 7, 0.1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 999_99);
});

test('splitAmount отклоняет нулевые и отрицательные веса', () => {
  assert.throws(() => splitAmount(100, [0, 0]), RangeError);
  assert.throws(() => splitAmount(100, [1, -1]), RangeError);
  assert.throws(() => splitAmount(10.5, [1]), RangeError);
});

test('sharesOf учитывает способ деления', () => {
  assert.deepEqual(sharesOf({ amount: 900, mode: 'equal', split: all }), { a: 300, b: 300, c: 300 });
  assert.deepEqual(sharesOf({ amount: 1000, mode: 'shares', split: { a: 1, b: 3 } }), { a: 250, b: 750 });
  assert.deepEqual(sharesOf({ amount: 700, mode: 'exact', split: { a: 200, c: 500 } }), { a: 200, c: 500 });
});

test('validateExpense ловит ошибки ввода', () => {
  const ok = { title: 'Такси', amount: 900, payer: 'a', mode: 'equal', split: all };
  assert.equal(validateExpense(ok, ids), null);
  assert.match(validateExpense({ ...ok, amount: 0 }, ids), /сумму/);
  assert.match(validateExpense({ ...ok, payer: 'z' }, ids), /платил/);
  assert.match(validateExpense({ ...ok, split: {} }, ids), /хотя бы одного/);
  assert.match(validateExpense({ ...ok, split: { a: 1, z: 1 } }, ids), /неизвестный/);
  assert.match(validateExpense({ ...ok, mode: 'shares', split: { a: 0 } }, ids), /Доли/);
  assert.match(validateExpense({ ...ok, mode: 'exact', split: { a: 100, b: 100 } }, ids), /не сходятся/);
  assert.equal(validateExpense({ ...ok, mode: 'exact', split: { a: 400, b: 500 } }, ids), null);
});

test('summarize считает баланс каждого', () => {
  const rows = summarize(people, [
    { amount: 900, payer: 'a', mode: 'equal', split: all },
    { amount: 300, payer: 'b', mode: 'equal', split: all },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.paid, r.share, r.balance]), [
    ['a', 900, 400, 500],
    ['b', 300, 400, -100],
    ['c', 0, 400, -400],
  ]);
  assert.equal(rows.reduce((a, r) => a + r.balance, 0), 0);
});

test('settle гасит все долги не более чем за n-1 переводов', () => {
  const rows = [
    { id: 'a', balance: 500 }, { id: 'b', balance: -100 }, { id: 'c', balance: -400 },
  ];
  assert.deepEqual(settle(rows), [
    { from: 'c', to: 'a', amount: 400 },
    { from: 'b', to: 'a', amount: 100 },
  ]);

  const random = [{ id: 'p0', balance: 0 }];
  let rest = 0;
  for (let i = 1; i < 9; i++) {
    const b = ((i * 7919) % 2001) - 1000;
    random.push({ id: `p${i}`, balance: b });
    rest -= b;
  }
  random[0].balance = rest;
  const transfers = settle(random);
  assert.ok(transfers.length <= random.length - 1);
  const after = Object.fromEntries(random.map((r) => [r.id, r.balance]));
  for (const t of transfers) {
    assert.ok(t.amount > 0);
    after[t.from] += t.amount;
    after[t.to] -= t.amount;
  }
  assert.ok(Object.values(after).every((v) => v === 0));
});

test('settle без долгов возвращает пустой список', () => {
  assert.deepEqual(settle([{ id: 'a', balance: 0 }, { id: 'b', balance: 0 }]), []);
});

test('summaryText готов для отправки в чат', () => {
  const text = summaryText({
    name: 'Ужин', currency: 'RUB', people,
    expenses: [{ id: 'x', title: 'Пицца', amount: 300000, payer: 'a', mode: 'equal', split: all }],
  });
  assert.match(text, /^Ужин\nВсего потрачено: 3 000 ₽/);
  assert.match(text, /Борис → Аня: 1 000 ₽/);
  assert.match(text, /Вика → Аня: 1 000 ₽/);
  assert.match(summaryText({ name: 'Пусто', currency: 'RUB', people, expenses: [] }), /переводы не нужны/);
});

test('sanitizeEvent чистит данные и отвергает некорректные', () => {
  const clean = sanitizeEvent({
    id: 'e1', name: '  Поездка ', currency: 'XXX', people,
    expenses: [{ id: 'x', title: ' Такси ', amount: 900, payer: 'a', mode: 'equal', split: all, extra: true }],
  });
  assert.equal(clean.name, 'Поездка');
  assert.equal(clean.currency, 'RUB');
  assert.equal(clean.expenses[0].title, 'Такси');
  assert.equal('extra' in clean.expenses[0], false);

  assert.throws(() => sanitizeEvent(null), /не похож/);
  assert.throws(() => sanitizeEvent({ people: [], expenses: {} }), /нет участников/);
  assert.throws(() => sanitizeEvent({ people: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], expenses: [] }), /Повторяющийся/);
  assert.throws(() => sanitizeEvent({
    people, expenses: [{ title: 'Х', amount: 100, payer: 'q', mode: 'equal', split: all }],
  }), /кто платил/);
});

test('encodeEvent и decodeEvent переживают кириллицу и эмодзи', () => {
  const event = {
    id: 'e1', name: 'Дача 🌲', currency: 'EUR', people,
    expenses: [{ id: 'x', title: 'Шашлык', amount: 12345, payer: 'c', mode: 'shares', split: { a: 1, c: 2.5 } }],
  };
  const code = encodeEvent(event);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeEvent(code), event);
  assert.throws(() => decodeEvent('!!!'), /повреждена/);
});
