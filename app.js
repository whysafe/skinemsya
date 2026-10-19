import {
  CURRENCIES, parseAmount, parseWeight, formatMoney, sharesOf, validateExpense,
  summarize, settle, summaryText, sanitizeEvent, encodeEvent, decodeEvent,
} from './split.js';

const STORAGE_KEY = 'skinemsya:v1';
const COLORS = ['#ff6a3d', '#3d7bff', '#1e9e6a', '#b04dd6', '#e0a100', '#e0457b', '#2bb3c0', '#7a5cff'];

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  },
  save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* приватный режим: работаем без сохранения */ }
  },
};

function demoEvent() {
  const p = { a: uid(), b: uid(), c: uid(), d: uid() };
  return {
    id: uid(),
    name: 'Выходные в Казани',
    currency: 'RUB',
    people: [
      { id: p.a, name: 'Аня' }, { id: p.b, name: 'Борис' }, { id: p.c, name: 'Вика' }, { id: p.d, name: 'Гоша' },
    ],
    expenses: [
      { id: uid(), title: 'Квартира на две ночи', amount: 1240000, payer: p.a, mode: 'equal', split: { [p.a]: 1, [p.b]: 1, [p.c]: 1, [p.d]: 1 } },
      { id: uid(), title: 'Бензин', amount: 386050, payer: p.b, mode: 'equal', split: { [p.a]: 1, [p.b]: 1, [p.c]: 1, [p.d]: 1 } },
      { id: uid(), title: 'Ужин, Гоша ел за двоих', amount: 642000, payer: p.c, mode: 'shares', split: { [p.a]: 1, [p.b]: 1, [p.c]: 1, [p.d]: 2 } },
      { id: uid(), title: 'Музей', amount: 120000, payer: p.d, mode: 'exact', split: { [p.a]: 40000, [p.c]: 40000, [p.d]: 40000 } },
    ],
  };
}

function emptyEvent(name) {
  return { id: uid(), name, currency: 'RUB', people: [], expenses: [] };
}

function loadState() {
  const raw = store.load();
  const events = [];
  if (raw && Array.isArray(raw.events)) {
    for (const e of raw.events) {
      try {
        const clean = sanitizeEvent(e);
        events.push({ ...clean, id: clean.id || uid() });
      } catch { /* повреждённый расчёт пропускаем */ }
    }
  }
  if (events.length === 0) events.push(demoEvent());
  const current = events.some((e) => e.id === raw?.current) ? raw.current : events[0].id;
  return { current, events };
}

let state = loadState();
let draft = freshDraft();

function freshDraft() {
  return { editingId: null, mode: 'equal', excluded: new Set(), values: {} };
}

const ev = () => state.events.find((e) => e.id === state.current);
const money = (cents) => formatMoney(cents, ev().currency);
const personName = (id) => ev().people.find((p) => p.id === id)?.name ?? '?';
const colorOf = (id) => COLORS[ev().people.findIndex((p) => p.id === id) % COLORS.length];

function save() { store.save(state); }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'type' || k === 'title' || k === 'for' || k === 'inputmode') node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function avatar(id) {
  return el('span', { class: 'avatar', text: personName(id).slice(0, 1).toUpperCase(), style: `background:${colorOf(id)}` });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Отрисовка ---------- */

function renderEvents() {
  const sel = $('#event-select');
  sel.replaceChildren(...state.events.map((e) => el('option', { value: e.id, text: e.name })));
  sel.value = state.current;
  const cur = $('#currency-select');
  if (!cur.options.length) {
    cur.append(...Object.entries(CURRENCIES).map(([code, name]) => el('option', { value: code, text: `${code} · ${name}` })));
  }
  cur.value = ev().currency;
  document.title = `${ev().name} · Скинемся`;
}

function renderPeople() {
  const { people, expenses } = ev();
  $('#people-list').replaceChildren(...people.map((p) => {
    const used = expenses.some((e) => e.payer === p.id || p.id in e.split);
    return el('li', { class: 'chip' },
      avatar(p.id),
      el('span', { text: p.name }),
      el('button', {
        class: 'icon', type: 'button', text: '×', 'data-action': 'remove-person', 'data-id': p.id,
        'aria-label': `Удалить ${p.name}`, title: used ? 'Участвует в расходах' : 'Удалить',
      }));
  }));
  $('#people-hint').textContent = people.length < 2
    ? 'Добавьте хотя бы двух человек, чтобы делить расходы.'
    : `${people.length} ${plural(people.length, 'участник', 'участника', 'участников')}`;
}

function renderForm() {
  const { people } = ev();
  const payer = $('#exp-payer');
  const prev = payer.value;
  payer.replaceChildren(...people.map((p) => el('option', { value: p.id, text: p.name })));
  if (people.some((p) => p.id === prev)) payer.value = prev;

  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === draft.mode)));

  $('#split-list').replaceChildren(...people.map((p) => {
    const on = !draft.excluded.has(p.id);
    const box = el('input', { type: 'checkbox', checked: on, 'data-check': p.id });
    const label = el('label', {}, box, avatar(p.id), el('span', { text: p.name }));
    let extra = el('span', { class: 'part', 'data-part': p.id });
    if (draft.mode !== 'equal' && on) {
      extra = el('input', {
        class: 'val', 'data-val': p.id, inputmode: 'decimal', value: draft.values[p.id] ?? (draft.mode === 'shares' ? '1' : ''),
        placeholder: draft.mode === 'shares' ? 'доля' : '0', 'aria-label': `${draft.mode === 'shares' ? 'Доля' : 'Сумма'}: ${p.name}`,
      });
    }
    return el('li', { class: on ? '' : 'off' }, label, extra);
  }));

  $('#exp-submit').textContent = draft.editingId ? 'Сохранить' : 'Добавить расход';
  $('[data-action="cancel-edit"]').hidden = !draft.editingId;
  $('#expense-form').querySelectorAll('input, select, button').forEach((n) => { n.disabled = people.length === 0; });
  updateSplitHint();
}

/** Собирает расход из формы. Возвращает {expense} или {error}. */
function readForm() {
  const amount = parseAmount($('#exp-amount').value);
  const included = ev().people.filter((p) => !draft.excluded.has(p.id));
  const split = {};
  for (const p of included) {
    const rawVal = draft.values[p.id] ?? (draft.mode === 'shares' ? '1' : '');
    if (draft.mode === 'equal') split[p.id] = 1;
    else if (draft.mode === 'shares') {
      const w = parseWeight(rawVal);
      if (w === null) return { error: `Доля для «${p.name}» должна быть положительным числом` };
      split[p.id] = w;
    } else {
      const c = rawVal.trim() === '' ? 0 : parseAmount(rawVal);
      if (c === null) return { error: `Сумма для «${p.name}» указана неверно` };
      split[p.id] = c;
    }
  }
  if ($('#exp-amount').value.trim() === '') return { error: 'Укажите сумму расхода' };
  if (amount === null) return { error: 'Сумма расхода указана неверно, пример: 1500 или 349,90' };
  const expense = {
    id: draft.editingId || uid(),
    title: $('#exp-title').value.trim(),
    amount, payer: $('#exp-payer').value, mode: draft.mode, split,
  };
  const error = validateExpense(expense, ev().people.map((p) => p.id));
  return error ? { error } : { expense };
}

function updateSplitHint() {
  const hint = $('#split-hint');
  hint.className = 'hint';
  const amount = parseAmount($('#exp-amount').value);
  const included = ev().people.filter((p) => !draft.excluded.has(p.id));
  document.querySelectorAll('[data-part]').forEach((n) => { n.textContent = ''; });
  if (!included.length) { hint.textContent = 'Никто не выбран'; hint.classList.add('bad'); return; }
  if (draft.mode === 'exact') {
    let sum = 0;
    for (const p of included) {
      const v = (draft.values[p.id] ?? '').trim();
      const c = v === '' ? 0 : parseAmount(v);
      if (c === null) { hint.textContent = `Неверная сумма у «${p.name}»`; hint.classList.add('bad'); return; }
      sum += c;
    }
    if (amount === null) { hint.textContent = `Распределено ${money(sum)}`; return; }
    const left = amount - sum;
    hint.textContent = left === 0 ? 'Сходится до копейки' : left > 0 ? `Осталось распределить ${money(left)}` : `Лишние ${money(-left)}`;
    hint.classList.add(left === 0 ? 'good' : 'bad');
    return;
  }
  if (amount === null || amount === 0) {
    hint.textContent = draft.mode === 'equal' ? `Делим на ${included.length}` : 'Доли: 2 значит вдвое больше, чем 1';
    return;
  }
  const res = readForm();
  if (res.error) { hint.textContent = ''; return; }
  const parts = sharesOf(res.expense);
  for (const [id, c] of Object.entries(parts)) {
    const node = document.querySelector(`[data-part="${id}"]`);
    if (node) node.textContent = money(c);
  }
  hint.textContent = draft.mode === 'equal'
    ? `По ${money(parts[included[0].id])} с человека`
    : included.map((p) => `${p.name} ${money(parts[p.id])}`).join(' · ');
}

function describeSplit(e) {
  const n = Object.keys(e.split).length;
  const total = ev().people.length;
  const who = n === total ? 'на всех' : `на ${n} из ${total}`;
  const how = e.mode === 'equal' ? 'поровну' : e.mode === 'shares' ? 'по долям' : 'точными суммами';
  return `платил(а) ${personName(e.payer)} · ${who}, ${how}`;
}

function renderExpenses() {
  const list = $('#expense-list');
  const { expenses } = ev();
  if (!expenses.length) {
    list.replaceChildren(el('li', { class: 'empty', text: 'Пока ни одного расхода. Добавьте первый: кто, за что и сколько заплатил.' }));
    list.firstChild.style.display = 'block';
    return;
  }
  list.replaceChildren(...[...expenses].reverse().map((e) => el('li', { class: e.id === draft.editingId ? 'editing' : '' },
    el('span', { class: 't', text: e.title || 'Без названия' }),
    el('span', { class: 'm', text: describeSplit(e) }),
    el('span', { class: 'sum', text: money(e.amount) }),
    el('span', { class: 'tools' },
      el('button', { class: 'icon', type: 'button', text: '✎', 'data-action': 'edit-expense', 'data-id': e.id, 'aria-label': 'Изменить', title: 'Изменить' }),
      el('button', { class: 'icon', type: 'button', text: '×', 'data-action': 'delete-expense', 'data-id': e.id, 'aria-label': 'Удалить', title: 'Удалить' })))));
}

function renderSummary() {
  const event = ev();
  const rows = summarize(event.people, event.expenses);
  const total = event.expenses.reduce((a, e) => a + e.amount, 0);
  $('#total').textContent = money(total);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.balance)));
  $('#balance-list').replaceChildren(...rows.map((r) => {
    const cls = r.balance > 0 ? 'plus' : r.balance < 0 ? 'minus' : '';
    const width = `${(Math.abs(r.balance) / max) * 50}%`;
    return el('li', {},
      avatar(r.id),
      el('span', { class: 'name', text: r.name }),
      el('span', { class: `val ${cls}`, text: (r.balance > 0 ? '+' : '') + money(r.balance) }),
      el('span', { class: 'bar' }, cls ? el('i', { class: cls, style: `width:${width}` }) : null),
      el('span', { class: 'sub', text: `заплатил(а) ${money(r.paid)} · доля ${money(r.share)}` }));
  }));
  if (!rows.length) $('#balance-list').append(el('li', { class: 'empty', text: 'Здесь появится баланс каждого.' }));

  const transfers = settle(rows);
  $('#transfer-list').replaceChildren(...(transfers.length
    ? transfers.map((t) => el('li', {},
      avatar(t.from), el('span', { text: personName(t.from) }),
      el('span', { class: 'arrow', text: '→' }),
      avatar(t.to), el('span', { text: personName(t.to) }),
      el('span', { class: 'amt', text: money(t.amount) })))
    : [el('li', { class: 'done', text: event.expenses.length ? 'Все в расчёте 🎉' : 'Переводов пока нет' })]));
}

function render() {
  renderEvents();
  renderPeople();
  renderForm();
  renderExpenses();
  renderSummary();
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* ---------- Действия ---------- */

function commit() {
  save();
  render();
}

function resetForm() {
  draft = freshDraft();
  $('#exp-title').value = '';
  $('#exp-amount').value = '';
  $('#exp-error').textContent = '';
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function askName(title, value) {
  return new Promise((resolve) => {
    const dlg = $('#name-dialog');
    $('#name-dialog-title').textContent = title;
    $('#name-input').value = value;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => {
      const name = $('#name-input').value.trim();
      resolve(dlg.returnValue === 'ok' && name ? name.slice(0, 80) : null);
    }, { once: true });
    dlg.showModal();
    $('#name-input').select();
  });
}

const actions = {
  async 'new-event'() {
    const name = await askName('Новый расчёт', '');
    if (!name) return;
    const e = emptyEvent(name);
    state.events.push(e);
    state.current = e.id;
    resetForm();
    commit();
    $('#person-name').focus();
  },
  async 'rename-event'() {
    const name = await askName('Переименовать расчёт', ev().name);
    if (!name) return;
    ev().name = name;
    commit();
  },
  'delete-event'() {
    if (!confirm(`Удалить расчёт «${ev().name}» со всеми расходами?`)) return;
    state.events = state.events.filter((e) => e.id !== state.current);
    if (!state.events.length) state.events.push(emptyEvent('Новый расчёт'));
    state.current = state.events[0].id;
    resetForm();
    commit();
    toast('Расчёт удалён');
  },
  'remove-person'(btn) {
    const id = btn.dataset.id;
    const event = ev();
    if (event.expenses.some((e) => e.payer === id || id in e.split)) {
      toast(`${personName(id)} участвует в расходах, сначала измените или удалите их`);
      return;
    }
    event.people = event.people.filter((p) => p.id !== id);
    draft.excluded.delete(id);
    delete draft.values[id];
    commit();
  },
  'check-all'() { draft.excluded.clear(); renderForm(); },
  'check-none'() { draft.excluded = new Set(ev().people.map((p) => p.id)); renderForm(); },
  'cancel-edit'() { resetForm(); render(); },
  'edit-expense'(btn) {
    const e = ev().expenses.find((x) => x.id === btn.dataset.id);
    if (!e) return;
    draft = freshDraft();
    draft.editingId = e.id;
    draft.mode = e.mode;
    draft.excluded = new Set(ev().people.map((p) => p.id).filter((id) => !(id in e.split)));
    for (const [id, v] of Object.entries(e.split)) {
      if (e.mode === 'shares') draft.values[id] = String(v).replace('.', ',');
      if (e.mode === 'exact') draft.values[id] = (v / 100).toFixed(2).replace(/[.,]00$/, '').replace('.', ',');
    }
    $('#exp-title').value = e.title;
    $('#exp-amount').value = (e.amount / 100).toFixed(2).replace(/[.,]00$/, '').replace('.', ',');
    $('#exp-error').textContent = '';
    render();
    $('#exp-payer').value = e.payer;
    $('#exp-title').focus();
  },
  'delete-expense'(btn) {
    const e = ev().expenses.find((x) => x.id === btn.dataset.id);
    if (!e || !confirm(`Удалить расход «${e.title || 'без названия'}» на ${money(e.amount)}?`)) return;
    ev().expenses = ev().expenses.filter((x) => x.id !== e.id);
    if (draft.editingId === e.id) resetForm();
    commit();
  },
  async 'copy-text'() {
    toast(await copy(summaryText(ev())) ? 'Итог скопирован, вставьте его в чат' : 'Не удалось скопировать');
  },
  async 'copy-link'() {
    const url = `${location.origin}${location.pathname}#s=${encodeEvent(ev())}`;
    toast(await copy(url) ? 'Ссылка скопирована: по ней откроется этот расчёт' : 'Не удалось скопировать');
  },
  export() {
    const { name, currency, people, expenses } = ev();
    const blob = new Blob([JSON.stringify({ name, currency, people, expenses }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${name.replace(/[\\/:*?"<>|]+/g, '_')}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import() { $('#import-file').click(); },
};

function addEvent(clean, message) {
  const existing = clean.id && state.events.findIndex((e) => e.id === clean.id);
  const e = { ...clean, id: clean.id || uid() };
  if (existing !== null && existing >= 0) state.events[existing] = e;
  else state.events.push(e);
  state.current = e.id;
  resetForm();
  commit();
  toast(message);
}

/* ---------- События ---------- */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
  const seg = e.target.closest('.seg button');
  if (seg) {
    draft.mode = seg.dataset.mode;
    draft.values = {};
    renderForm();
  }
});

$('#event-select').addEventListener('change', (e) => {
  state.current = e.target.value;
  resetForm();
  commit();
});

$('#currency-select').addEventListener('change', (e) => {
  ev().currency = e.target.value;
  commit();
});

$('#person-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#person-name');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) { input.focus(); return; }
  if (ev().people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    toast(`«${name}» уже есть в списке`);
    input.select();
    return;
  }
  ev().people.push({ id: uid(), name: name.slice(0, 40) });
  input.value = '';
  commit();
  input.focus();
});

$('#expense-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const res = readForm();
  if (res.error) { $('#exp-error').textContent = res.error; return; }
  const list = ev().expenses;
  const i = list.findIndex((x) => x.id === res.expense.id);
  if (i >= 0) list[i] = res.expense;
  else list.push(res.expense);
  const wasEditing = i >= 0;
  const payer = $('#exp-payer').value;
  resetForm();
  commit();
  $('#exp-payer').value = payer;
  toast(wasEditing ? 'Расход обновлён' : 'Расход добавлен');
  $('#exp-title').focus();
});

$('#expense-form').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.check) {
    if (t.checked) draft.excluded.delete(t.dataset.check);
    else draft.excluded.add(t.dataset.check);
    renderForm();
    return;
  }
  if (t.dataset.val) draft.values[t.dataset.val] = t.value;
  $('#exp-error').textContent = '';
  updateSplitHint();
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2_000_000) { toast('Файл слишком большой'); return; }
  try {
    const clean = sanitizeEvent(JSON.parse(await file.text()));
    addEvent({ ...clean, id: null }, `Импортирован расчёт «${clean.name}»`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'Это не JSON-файл' : err.message);
  }
});

window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) { state = loadState(); resetForm(); render(); }
});

function openFromHash() {
  const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const clean = decodeEvent(m[1]);
    addEvent(clean, `Открыт расчёт «${clean.name}» из ссылки`);
  } catch (err) {
    toast(err.message);
  }
}

window.addEventListener('hashchange', openFromHash);
render();
openFromHash();
