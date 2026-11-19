// 「一日の記録」モードとタイマー画面 Current（今日基準）のテスト
// 実行: node test/test-day-records.js
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- DOM / browser stubs ----------
const elements = {};
function makeEl() {
  const el = {
    style: {}, textContent: '', innerHTML: '', value: '', max: '', disabled: false,
    dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    __listeners: {},
    addEventListener(type, fn) { (el.__listeners[type] = el.__listeners[type] || []).push(fn); },
    appendChild() {},
    querySelector() { return makeEl(); },
    getContext() { return {}; }
  };
  return el;
}
function fire(el, type) {
  (el.__listeners[type] || []).forEach((fn) => fn({ target: el, stopPropagation() {} }));
}

const rangeBtns = [makeEl(), makeEl()];
rangeBtns[0].dataset.mode = 'all';
rangeBtns[1].dataset.mode = 'day';

global.window = global;
global.document = {
  getElementById: (id) => (elements[id] = elements[id] || makeEl()),
  querySelectorAll: (sel) => (sel === '.btn-range' ? rangeBtns : []),
  createElement: () => makeEl()
};

let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

let lastChartConfig = null;
global.Chart = class {
  constructor(ctx, cfg) { lastChartConfig = cfg; }
  destroy() {}
  resetZoom() {}
};

global.App = {
  cube: { calcTPS: (moves, time) => (time > 0 ? moves / time : 0) },
  cfop: { OLL_CASES: [], PLL_ALGS: [], renderOllIcon: () => '', renderPllIcon: () => '' }
};

// ---------- fixture: 3 days of solves (local midday, chronological) ----------
function dayDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(12, 0, 0, 0);
  return d;
}
function localStr(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}
let nextId = 1;
function rec(offset, time) {
  return { id: nextId++, date: dayDate(offset).toISOString(), time, scramble: '', cfop: {}, isSolvedComplete: true };
}
const history = [
  rec(-2, 30), rec(-2, 31), rec(-2, 32),
  rec(-1, 20), rec(-1, 21), rec(-1, 22), rec(-1, 23), rec(-1, 24),
  rec(0, 10), rec(0, 11), rec(0, 12)
];
store['gan_cube_solves_v1'] = JSON.stringify(history);

// ---------- load stats.js ----------
eval(fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8'));
const stats = global.App.stats;
check('stats module loaded', !!stats);

// ---------- 1) timer panel: Current is today-only, Best stays all-time ----------
stats.updateTimerStatsPanel();
const panel = elements['timer-stats-panel'].innerHTML;
check('Current Ao5 is "-" (only 3 solves today)', panel.includes('<span>Ao5</span><span>-</span>'));
check('Current Ao12 is "-"', panel.includes('<span>Ao12</span><span>-</span>'));
check('Best Single is all-time 10.00s', panel.includes('<span>Single</span><span>10.00s</span>'));
check('Best Ao5 is all-time 15.33s (spans days)', panel.includes('<span>Ao5</span><span>15.33s</span>'));

// ---------- 2) chart: day mode defaults to today ----------
fire(rangeBtns[1], 'click'); // 一日の記録
check('day mode chart has 3 datasets (single + Ao5 + Ao12)', lastChartConfig.data.datasets.length === 3);
check('day mode chart shows today\'s 3 solves', lastChartConfig.data.labels.length === 3);
check('day nav is visible in day mode', elements['chart-day-nav'].style.display === 'flex');
check('next-day button disabled on today', elements['btn-day-next'].disabled === true);
check('date input is set to today', elements['chart-day-input'].value === localStr(dayDate(0)));
check('date input max is today', elements['chart-day-input'].max === localStr(dayDate(0)));
check('column header is 今日', elements['chart-day-col-header'].textContent === '今日');
let tbody = elements['chart-stats-tbody'].innerHTML;
check('Single middle column = today best 10.00s', /<td>Single<\/td>\s*<td>12\.00s<\/td>\s*<td>10\.00s<\/td>/.test(tbody));
check('solve count middle = 3', tbody.includes('<td>3</td>'));

// ---------- 3) navigate to yesterday ----------
fire(elements['btn-day-prev'], 'click');
const y = dayDate(-1);
check('chart shows yesterday\'s 5 solves', lastChartConfig.data.labels.length === 5);
check('column header shows the date', elements['chart-day-col-header'].textContent === `${y.getMonth() + 1}月${y.getDate()}日`);
check('next-day button enabled on yesterday', elements['btn-day-next'].disabled === false);
check('date input follows navigation', elements['chart-day-input'].value === localStr(y));
tbody = elements['chart-stats-tbody'].innerHTML;
check('Single middle = yesterday best 20.00s', tbody.includes('<td>20.00s</td>'));
check('Ao5 middle = yesterday best 22.00s', /<td>Ao5<\/td>\s*<td>-<\/td>\s*<td>22\.00s<\/td>/.test(tbody));
check('Ao5 current column is today-based ("-")', true); // covered by the row check above
check('solve count middle = 5', tbody.includes('<td>5</td>'));
check('day label mentions 5件', elements['chart-day-label'].textContent.includes('5件'));

// ---------- 4) back to today via next, then via date input to D-2 ----------
fire(elements['btn-day-next'], 'click');
check('next returns to today', elements['chart-day-col-header'].textContent === '今日' && lastChartConfig.data.labels.length === 3);

fire(elements['btn-day-prev'], 'click');
fire(elements['btn-day-today'], 'click');
check('today button returns to today', elements['chart-day-input'].value === localStr(dayDate(0)));

elements['chart-day-input'].value = localStr(dayDate(-2));
fire(elements['chart-day-input'], 'change');
check('date input jumps to D-2 (3 solves)', lastChartConfig.data.labels.length === 3);
tbody = elements['chart-stats-tbody'].innerHTML;
check('Single middle = D-2 best 30.00s', tbody.includes('<td>30.00s</td>'));

// future dates are clamped to today
elements['chart-day-input'].value = localStr(dayDate(3));
fire(elements['chart-day-input'], 'change');
check('future date clamps to today', elements['chart-day-input'].value === localStr(dayDate(0)));

// ---------- 5) all mode: nav hidden, middle column is today ----------
fire(rangeBtns[0], 'click');
check('all mode chart shows all 11 solves', lastChartConfig.data.labels.length === 11);
check('all mode datasets are single + Ao50 + Ao100', lastChartConfig.data.datasets.length === 3 && lastChartConfig.data.datasets[1].label === 'Ao50');
check('day nav hidden in all mode', elements['chart-day-nav'].style.display === 'none');
check('header back to 今日 in all mode', elements['chart-day-col-header'].textContent === '今日');
tbody = elements['chart-stats-tbody'].innerHTML;
check('all mode Single middle = today best 10.00s', /<td>Single<\/td>\s*<td>12\.00s<\/td>\s*<td>10\.00s<\/td>/.test(tbody));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
