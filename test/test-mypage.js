// マイページ（プロフィール／記録表／ペース配分）のテスト
// 実行: node test/test-mypage.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- ソース配線 ----------
const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const statsSrc = fs.readFileSync(path.join(APP, 'stats.js'), 'utf8');

check('index.html にマイページのタブがある', indexSrc.includes('id="tab-mypage"'));
check('index.html にマイページのビューがある', indexSrc.includes('id="view-mypage"'));
check('index.html にプロフィール/記録/ペースの置き場がある',
  ['mypage-profile', 'mypage-records-tbody', 'mypage-pace-bar', 'mypage-pace-tbody', 'mypage-pace-note']
    .every((id) => indexSrc.includes(`id="${id}"`)));
check('cube.js がマイページタブを切り替える',
  cubeSrc.includes("getElementById('tab-mypage')") && cubeSrc.includes("switchTab('mypage')") &&
  cubeSrc.includes('renderMyPageView()'));
check('stats.js が renderMyPageView を公開する', statsSrc.includes('renderMyPageView'));

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

const paceBtns = [makeEl(), makeEl(), makeEl()];
paceBtns[0].dataset.mode = 'today';
paceBtns[1].dataset.mode = 'recent100';
paceBtns[2].dataset.mode = 'all';

global.window = global;
global.document = {
  getElementById: (id) => (elements[id] = elements[id] || makeEl()),
  querySelectorAll: (sel) => (sel === '.btn-mypage-range' ? paceBtns : []),
  createElement: () => makeEl()
};
let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
global.Chart = class { constructor() {} destroy() {} resetZoom() {} };
global.App = {
  cube: { calcTPS: (moves, time) => (time > 0 ? moves / time : 0), APP_VERSION: 'test' },
  cfop: { OLL_CASES: [], PLL_ALGS: [], renderOllIcon: () => '', renderPllIcon: () => '' }
};
eval(statsSrc);
const stats = global.App.stats;
check('renderMyPageView が関数として公開されている', typeof stats.renderMyPageView === 'function');

// ---------- fixture ----------
// 全件今日・同日。フェーズは全件同じ内訳（Cross 2秒7手 / F2L 各2秒8手 /
// OLL 3秒15手 / PLL 3秒14手、合計 16秒68手相当）にし、タイムだけ変える。
// ただし記録タイムは末尾に AUF 等が乗りうる前提で、ペースの合計行は
// 記録タイムの平均を使う仕様なので、タイムは全件 16.00 にそろえる。
function todayIso(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
let nextId = 1;
function rec(hour, time) {
  return {
    id: nextId++, date: todayIso(hour), time, scramble: '',
    isSolvedComplete: true,
    cfop: {
      cross: 2, crossMoves: 7, crossTps: 3.5,
      f2l: [2, 2, 2, 2], f2lMoves: [8, 8, 8, 8], f2lTps: [4, 4, 4, 4],
      oll: 3, ollMoves: 15, ollTps: 5, ollName: '#1',
      pll: 3, pllMoves: 14, pllTps: 4.67, pllName: 'Ua-perm',
      totalMoves: 68, totalTps: 4.25, is2LookOll: false
    }
  };
}
// タイムの異なる5件（Ao5 = 最速・最遅を除いた 17,18,19 の平均 18.00）
const history = [rec(9, 16), rec(10, 20), rec(11, 17), rec(12, 19), rec(13, 18)];
// 分析不可の記録（ペースからは除外、件数と記録表には入る）
history.push({ id: nextId++, date: todayIso(14), time: 30, scramble: '', isSolvedComplete: false, cfop: null });
store['gan_cube_solves_v1'] = JSON.stringify(history);

stats.renderMyPageView();

// --- プロフィール ---
const profile = elements['mypage-profile'].innerHTML;
check('プロフィールに総ソルブ数 6件', profile.includes('6件'));
check('プロフィールに記録日数 1日', profile.includes('1日'));
check('プロフィールに今日のソルブ 6件', profile.includes('今日のソルブ') && profile.includes('6件'));
check('プロフィールに PB Single 16.00s', profile.includes('16.00s'));
check('プロフィールに平均手数 68.0手 / TPS 3.78（平均手数÷平均タイム）', profile.includes('68.0手 / 3.78'), profile);

// --- 記録表 ---
const recs = elements['mypage-records-tbody'].innerHTML;
check('記録表 Single 現在は最新（分析不可の30.00s）', /Single<\/td>\s*<td>30\.00s/.test(recs));
check('記録表 Single 全期間ベスト 16.00s', /Single<\/td>\s*<td>30\.00s<\/td>\s*<td>16\.00s<\/td>\s*<td>16\.00s/.test(recs));
// 記録表は既存画面と同じく全記録のタイムで計算する（分析不可の30秒も窓に入る）
check('記録表 Ao5 現在 19.00s（最新窓 20,17,19,18,30 のトリム平均）', /Ao5<\/td>\s*<td>19\.00s/.test(recs), recs);
check('記録表 Ao5 今日ベスト/全期間ベスト 18.00s', /Ao5<\/td>\s*<td>19\.00s<\/td>\s*<td>18\.00s<\/td>\s*<td>18\.00s/.test(recs));

// --- ペース配分（初期は直近100件） ---
const pace = elements['mypage-pace-tbody'].innerHTML;
check('ペース Cross 2.00s / 7.0手 / TPS 3.50 / 12.5%',
  /Cross<\/td>\s*<td>2\.00s<\/td>\s*<td>7\.0<\/td>\s*<td>3\.50<\/td>\s*<td>12\.5%/.test(pace), pace);
check('ペース F2L 合計 8.00s / 32.0手 / 50.0%',
  /F2L<\/td>\s*<td>8\.00s<\/td>\s*<td>32\.0<\/td>\s*<td>4\.00<\/td>\s*<td>50\.0%/.test(pace));
check('ペース Slot 1 は内訳行として出る', pace.includes('Slot 1') && pace.includes('mp-slot'));
check('ペース OLL 3.00s / 15.0手 / TPS 5.00 / 18.8%',
  /OLL<\/td>\s*<td>3\.00s<\/td>\s*<td>15\.0<\/td>\s*<td>5\.00<\/td>\s*<td>18\.8%/.test(pace));
check('ペース 合計は記録タイム平均 18.00s / 68.0手',
  /合計<\/td>\s*<td>18\.00s<\/td>\s*<td>68\.0<\/td>/.test(pace), pace);
check('ペース注記に対象件数（分析可能な5件）',
  elements['mypage-pace-note'].textContent.includes('分析可能な5件'),
  elements['mypage-pace-note'].textContent);
check('割合バーに4フェーズ分の帯が出る',
  (elements['mypage-pace-bar'].innerHTML.match(/background:/g) || []).length === 4);
check('凡例に F2L 50.0%', elements['mypage-pace-legend'].innerHTML.includes('F2L 50.0%'));

// --- 期間切り替え（今日ボタン） ---
fire(paceBtns[0], 'click');
check('今日ボタンで再描画されても対象は同じ5件',
  elements['mypage-pace-note'].textContent.includes('今日の分析可能な5件'),
  elements['mypage-pace-note'].textContent);

// --- 記録ゼロでも落ちない ---
store['gan_cube_solves_v1'] = JSON.stringify([]);
stats.renderMyPageView();
check('記録ゼロではペースに「分析可能な記録がありません」',
  elements['mypage-pace-tbody'].innerHTML.includes('分析可能な記録がありません'));
check('記録ゼロでもプロフィールは 0件表示', elements['mypage-profile'].innerHTML.includes('0件'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
