// ケース別グラフ（分析タブの行タップで表示）のテスト
// - 配線：オーバーレイの置き場、行の data-case、クリック委譲
// - calcCaseAo12 の仕様：窓は直近最大12件、5件以上は最速・最遅を
//   除いた平均、未満は単純平均（分析タブの平均Timeと一致する規則）
// - クリックで Chart に「時間」と「Ao12」の2系列が渡ること
// 実行: node test/test-case-chart.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- ソース配線 ----------
const indexSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const statsSrc = fs.readFileSync(path.join(APP, 'stats.js'), 'utf8');

check('index.html にケース別グラフのオーバーレイがある',
  ['case-chart-overlay', 'case-chart-title', 'case-chart-summary', 'case-chart-close', 'case-chart']
    .every((id) => indexSrc.includes(`id="${id}"`)));
check('index.html にタップのヒントがある', indexSrc.includes('ケース名をタップすると'));
check('stats.js が行に data-case を付けている', statsSrc.includes('data-case="${r.name}"'));
check('stats.js が calcCaseAo12 / showCaseChart を持つ',
  statsSrc.includes('function calcCaseAo12(times)') && statsSrc.includes('function showCaseChart(name)'));
check('stats.js が Ao12 系列をオレンジで描く', statsSrc.includes("label: 'Ao12'") && statsSrc.includes("borderColor: '#ff9800'"));
check('stats.js が tbody のクリックで開く', statsSrc.includes("analysisTbody.addEventListener('click'"));

// ---------- DOM / browser stubs ----------
const elements = {};
function makeEl() {
  const classes = new Set();
  const el = {
    style: {}, textContent: '', innerHTML: '', value: '', disabled: false,
    dataset: {}, children: [],
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c) { classes.has(c) ? classes.delete(c) : classes.add(c); },
      contains(c) { return classes.has(c); }
    },
    __listeners: {},
    addEventListener(type, fn) { (el.__listeners[type] = el.__listeners[type] || []).push(fn); },
    appendChild() {},
    querySelector() { return makeEl(); },
    getContext() { return {}; }
  };
  return el;
}

global.window = global;
global.document = {
  getElementById: (id) => (elements[id] = elements[id] || makeEl()),
  querySelectorAll: () => [],
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
  cube: { calcTPS: (moves, time) => (time > 0 ? moves / time : 0), APP_VERSION: 'test' },
  cfop: {
    OLL_CASES: [{ name: 'OLL #21 (H)' }],
    PLL_ALGS: [['Ua-perm', ''], ['Ub-perm', ''], ['Z-perm', '']],
    renderOllIcon: () => '',
    renderPllIcon: () => ''
  }
};
eval(statsSrc);
const stats = global.App.stats;

// ---------- calcCaseAo12 の仕様 ----------
check('calcCaseAo12 が公開されている', typeof stats.calcCaseAo12 === 'function');
const near = (a, b) => Math.abs(a - b) < 1e-9;
check('5件未満は累積の単純平均',
  JSON.stringify(stats.calcCaseAo12([3, 1, 2])) === JSON.stringify([3, 2, 2]));
const five = stats.calcCaseAo12([10, 1, 1, 1, 1]);
check('5件目から最速・最遅を除く', near(five[4], 1) && near(five[3], 3.25), `5件目=${five[4]}`);
const twelve = [5, 3, 4, 2, 6, 3, 4, 5, 3, 4, 2, 3];
check('12件ちょうどでは Ao12（両端を除いた平均）',
  near(stats.calcCaseAo12(twelve)[11], 3.6), `=${stats.calcCaseAo12(twelve)[11]}`);
const thirteen = [...twelve, 100];
const lastOf13 = stats.calcCaseAo12(thirteen)[12];
check('13件目では窓が1つずれる（最初の1件が落ちる）', near(lastOf13, 3.7), `=${lastOf13}`);

// ---------- 行の描画とクリック→グラフ ----------
const rec = (pll, pllName, date) => ({
  date, time: 15, scramble: '', moves: [], isSolvedComplete: true,
  cfop: { pll, pllName, pllSkip: false, pllTps: 5, oll: 2, ollName: 'OLL #21 (H)', ollSkip: false, ollTps: 5 }
});
store['gan_cube_solves_v1'] = JSON.stringify([
  rec(2.5, 'Ua-perm', '2026-11-20T00:00:00.000Z'),
  rec(3.5, 'Ub-perm', '2026-11-21T00:00:00.000Z'),
  rec(3.0, 'Ua-perm', '2026-11-22T00:00:00.000Z'),
  rec(2.0, 'Ua-perm', '2026-11-23T00:00:00.000Z')
]);
stats.renderAnalysisView();
const tbodyHtml = elements['analysis-tbody'].innerHTML;
check('出現のある行に data-case と case-row が付く',
  tbodyHtml.includes('data-case="Ua-perm"') && tbodyHtml.includes('case-row'));
check('出現のない行は case-row にならない',
  tbodyHtml.includes('<tr class="" data-case="Z-perm">'));

// analysisType の初期値は 'pll'。Ua-perm の行をタップしたことにする
const clickListeners = elements['analysis-tbody'].__listeners.click || [];
check('tbody にクリックリスナーがある', clickListeners.length >= 1);
clickListeners.forEach((fn) => fn({ target: { closest: () => ({ dataset: { case: 'Ua-perm' } }) } }));
check('オーバーレイが開く', elements['case-chart-overlay'].classList.contains('active'));
check('タイトルにケース名が出る', elements['case-chart-title'].innerHTML.includes('Ua-perm'));
check('サマリに回数とベストが出る',
  elements['case-chart-summary'].textContent.includes('全3回') &&
  elements['case-chart-summary'].textContent.includes('ベスト 2.00s'),
  elements['case-chart-summary'].textContent);
check('Chart に時間と Ao12 の2系列が渡る',
  !!lastChartConfig && lastChartConfig.data.datasets.length === 2 &&
  JSON.stringify(lastChartConfig.data.datasets[0].data) === JSON.stringify([2.5, 3.0, 2.0]) &&
  JSON.stringify(lastChartConfig.data.datasets[1].data) === JSON.stringify([2.5, 2.75, 2.5]),
  lastChartConfig ? JSON.stringify(lastChartConfig.data.datasets.map((d) => d.data)) : 'なし');
check('ラベルは出現順の #1..#N', !!lastChartConfig && JSON.stringify(lastChartConfig.data.labels) === JSON.stringify(['#1', '#2', '#3']));

// 閉じるボタンで閉じる
(elements['case-chart-close'].__listeners.click || []).forEach((fn) => fn({ target: elements['case-chart-close'] }));
check('閉じるボタンでオーバーレイが閉じる', !elements['case-chart-overlay'].classList.contains('active'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
