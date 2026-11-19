// バージョン表記の検証：
// - cube.js が APP_VERSION を定義し、画面の #app-version に書き込むこと
// - index.html に表示要素があること
// - saveSolve が記録へ appVersion を刻むこと（バックアップから
//   「どの版で測った記録か」を判別できるように）
// 実行: node test/test-app-version.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const statsSrc = fs.readFileSync(path.join(APP, 'stats.js'), 'utf8');

const versionMatch = cubeSrc.match(/const APP_VERSION = '([^']+)'/);
check('cube.js に APP_VERSION の定義がある', !!versionMatch, versionMatch ? versionMatch[1] : 'なし');
const VERSION = versionMatch[1];
check('cube.js が APP_VERSION を公開している', /window\.App\.cube = \{\s*APP_VERSION,/.test(cubeSrc));
check('cube.js が #app-version へ表示を書き込む', cubeSrc.includes("getElementById('app-version')") && cubeSrc.includes('appVersionEl.textContent'));
check('index.html に #app-version の表示要素がある', indexSrc.includes('id="app-version"'));
check('stats.js が記録へ appVersion を刻む', statsSrc.includes('appVersion:'));

// ---------- stats.js をスタブで読み込み、saveSolve の刻印を確認 ----------
const engine = {};
new Function('exports', cubeSrc.slice(cubeSrc.indexOf('const COLORS'), cubeSrc.indexOf('function createCube3DInstance')) + `
  exports.resetStateArray = resetStateArray; exports.applyMoveToArray = applyMoveToArray;
  exports.applyMoveCW = applyMoveCW; exports.isCubeSolvedArray = isCubeSolvedArray;
  exports.countHTM = countHTM; exports.calcTPS = calcTPS; exports.getInverseMove = getInverseMove;
  exports.findRecoveryPath = findRecoveryPath; exports.FACE_NAMES = FACE_NAMES; exports.OPPOSITE_FACE = OPPOSITE_FACE;
`)(engine);

const elements = {};
function makeEl() {
  return {
    style: {}, textContent: '', innerHTML: '', value: '', max: '', disabled: false,
    dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {},
    querySelector() { return makeEl(); },
    getContext() { return {}; }
  };
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
global.Chart = class { constructor() {} destroy() {} resetZoom() {} };
global.App = {
  cube: { ...engine, APP_VERSION: VERSION },
  cfop: { OLL_CASES: [], PLL_ALGS: [], renderOllIcon: () => '', renderPllIcon: () => '', isUniformSolved: () => false }
};
eval(statsSrc);
const stats = global.App.stats;

const saved = stats.saveSolve(12.34, "R U R'", ['U\'', 'R\'', 'R'], [{ move: "U'", time: 1 }, { move: "R'", time: 2 }], null, [], {});
check('保存された記録に appVersion が刻まれている', saved.appVersion === VERSION, `appVersion=${saved.appVersion}`);
const history = stats.getHistory();
check('履歴（バックアップ相当）にも appVersion が残る', history.length === 1 && history[0].appVersion === VERSION);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
