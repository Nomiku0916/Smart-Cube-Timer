// 末尾補完の安全弁（緩和版）の検証。
// 緩和の条件は「完成まで6手以内」＋「補完後の読みが筋の通った形
// （フェーズ有効・OLL/PLLともに既知のケース名かSkip）」。
// - 2026-11-19夜の末尾欠け3件（Ua/Ga/Ub）が補完されること
// - 直近20件のうち、旧・自動復旧パッチで汚染された6件については
//   16.79秒の1件だけが補完されること（削除修復の解析でも同じ
//   OLL #12／E-perm に一致した記録）。残りは分析不可のまま
// - それ以外の記録の読みが変わらないこと
// 実行: node test/test-tail-gate.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const FILES = '/home/hatch/workspace/user/files';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const engine = {};
new Function('exports', cubeSrc.slice(cubeSrc.indexOf('const COLORS'), cubeSrc.indexOf('function createCube3DInstance')) + `
  exports.resetStateArray = resetStateArray; exports.applyMoveToArray = applyMoveToArray;
  exports.applyMoveCW = applyMoveCW; exports.isCubeSolvedArray = isCubeSolvedArray;
  exports.countHTM = countHTM; exports.calcTPS = calcTPS; exports.getInverseMove = getInverseMove;
  exports.findRecoveryPath = findRecoveryPath; exports.faceletsToState = faceletsToState;
  exports.FACE_NAMES = FACE_NAMES; exports.OPPOSITE_FACE = OPPOSITE_FACE;
`)(engine);
global.window = global;
global.document = { getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, textContent: '', innerHTML: '' }) };
global.App = { cube: engine };
eval(fs.readFileSync(path.join(APP, 'cfop.js'), 'utf8'));
const cfop = global.App.cfop;

function init(scr) { const s = new Uint8Array(54); engine.resetStateArray(s); for (const t of scr.trim().split(/\s+/)) engine.applyMoveToArray(s, t); return s; }
function analyze(r) {
  const raw = r.rawMoves.map((m) => ({ move: m.move, time: m.time, timeMs: m.timeMs }));
  const pp = cfop.postProcessSolve(raw, init(r.scramble), r.time);
  return { solved: pp.reachedSolved || pp.tailRecoveredMoves > 0, tail: pp.tailRecoveredMoves, oll: pp.cfop.ollName, pll: pp.cfop.pllName };
}
function loadRecent(name) {
  return JSON.parse(fs.readFileSync(path.join(FILES, name), 'utf8'))[0];
}

// ---- 末尾欠け3件（2026-11-19夜） ----
const cases = [
  ['gan-timer-backup-20261119-recent1_0_kjf9.json', 3, 'OLL #38', 'Ua-perm'],
  ['gan-timer-backup-20261119-recent1__1__1_o7cr.json', 2, 'OLL #32', 'Ga-perm'],
  ['gan-timer-backup-20261119-recent1__2__3_yvh1.json', 2, 'OLL #50', 'Ub-perm']
];
for (const [file, tail, oll, pll] of cases) {
  const a = analyze(loadRecent(file));
  check(`${file.slice(21)} が補完される`, a.solved && a.tail === tail, `tail=${a.tail}`);
  check(`  読みが ${oll} / ${pll}`, a.oll === oll && a.pll === pll, `${a.oll} / ${a.pll}`);
}

// ---- 直近20件：救済されるのは既知の範囲だけ ----
{
  const data = JSON.parse(fs.readFileSync(path.join(FILES, 'gan-timer-backup-20261119-recent20_0_wg1f.json'), 'utf8'));
  let solvedCount = 0;
  const flipped = [];
  for (const r of data) {
    const a = analyze(r);
    if (a.solved) solvedCount++;
    if (a.solved && r.isSolvedComplete === false) flipped.push({ time: r.time, ...a });
  }
  check('直近20件で表示可能になるのは15件（従来14件＋16.79秒の1件）', solvedCount === 15, `solved=${solvedCount}`);
  check('新たに補完されるのは16.79秒の1件だけ', flipped.length === 1 && flipped[0].time === 16.79, JSON.stringify(flipped));
  check('その読みは OLL #12 / E-perm（削除修復の解析と一致）', flipped.length === 1 && flipped[0].oll === 'OLL #12' && flipped[0].pll === 'E-perm');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
