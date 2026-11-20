// 保持ポリシー（saveHistoryWithCleanup）と簡易リプレイ合成
// （buildSimpleTimeline）のテスト
// 実行: node test/test-retention.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- saveHistoryWithCleanup の抽出 ----------
const statsSrc = fs.readFileSync(path.join(APP, 'stats.js'), 'utf8');
const constMatch = statsSrc.match(/const MAX_REPLAY_COUNT = \d+;/);
const fnMatch = statsSrc.match(/function saveHistoryWithCleanup\(history\) \{[\s\S]*?\n  \}/);
if (!constMatch || !fnMatch) { console.error('FAIL: saveHistoryWithCleanup not found'); process.exit(1); }
const store = {};
const saveHistoryWithCleanup = new Function('localStorage', 'updateSolveCount', 'updateTimerStatsPanel', 'STORAGE_KEY',
  `${constMatch[0]}\n${fnMatch[0]}\nreturn saveHistoryWithCleanup;`)(
  { setItem: (k, v) => { store[k] = v; }, getItem: () => '[]' }, () => {}, () => {}, 'gan_cube_solves_v1');

function mkRecord(i, extra = {}) {
  return {
    id: i, date: '2026-11-20T00:00:00.000Z', time: 15, scramble: "R U R'",
    moves: ['R', 'U'], timeline: [{ move: 'R', time: 0.5 }], rawMoves: [{ move: 'R', timeMs: 500 }],
    cfop: {}, isSolvedComplete: true, ...extra
  };
}

{
  const history = Array.from({ length: 105 }, (_, i) => mkRecord(i));
  history[0].pinned = true; // 最も古い記録を保護
  saveHistoryWithCleanup(history);
  check('保護した最古の記録は全部残る', Array.isArray(history[0].rawMoves) && Array.isArray(history[0].timeline) && Array.isArray(history[0].moves));
  check('100件より古い通常記録は rawMoves と timeline が消える', history[1].rawMoves === null && history[1].timeline === null && history[4].rawMoves === null);
  check('古い記録でも moves は残る', Array.isArray(history[1].moves) && Array.isArray(history[4].moves));
  check('直近100件は全部残る', Array.isArray(history[5].rawMoves) && Array.isArray(history[104].timeline));
  check('localStorageへ保存された', typeof Object.values(store)[0] === 'string');
}

// ---------- buildSimpleTimeline の抽出 ----------
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
const buildSimpleTimeline = global.App.cfop.buildSimpleTimeline;
check('buildSimpleTimeline が公開されている', typeof buildSimpleTimeline === 'function');

{
  const rec = JSON.parse(fs.readFileSync('/home/hatch/workspace/user/files/gan-timer-backup-20261119-recent20_0_wg1f.json', 'utf8'))
    .find((r) => r.isSolvedComplete && Array.isArray(r.moves));
  const tl = buildSimpleTimeline(rec.moves, rec.cfop, rec.time);
  check('実記録から合成できる', Array.isArray(tl) && tl.length === rec.moves.length, `len=${tl && tl.length}`);
  check('手の並びが一致する', tl.every((e, i) => e.move === rec.moves[i]));
  check('時刻が単調非減少', tl.every((e, i) => i === 0 || e.time >= tl[i - 1].time));
  const crossEnd = tl[rec.cfop.crossMoves - 1].time;
  check('Cross境界の時刻が cfop.cross とほぼ一致', Math.abs(crossEnd - rec.cfop.cross) <= 0.06, `crossEnd=${crossEnd} cross=${rec.cfop.cross}`);
  const phaseSum = rec.cfop.cross + rec.cfop.f2lTotal + rec.cfop.oll + rec.cfop.pll + (rec.cfop.auf || 0);
  check('最終時刻がフェーズ合計とほぼ一致', Math.abs(tl[tl.length - 1].time - phaseSum) <= 0.1, `last=${tl[tl.length - 1].time} sum=${phaseSum.toFixed(2)}`);
}

{
  // cfop が無い場合は全体を均等割り
  const tl = buildSimpleTimeline(['R', 'U', "R'", "U'"], null, 8);
  check('cfopなしは均等割り（2,4,6,8）', tl.map((e) => e.time).join(',') === '2,4,6,8', tl.map((e) => e.time).join(','));
  // 手数が合わない cfop は均等割りにフォールバック
  const bad = { cross: 1, crossMoves: 99, f2l: [1, 1, 1, 1], f2lMoves: [1, 1, 1, 1], ollMoves: 1, pllMoves: 1, aufMoves: 0, auf: 0 };
  const tl2 = buildSimpleTimeline(['R', 'U'], bad, 4);
  check('手数不一致は均等割りにフォールバック', tl2.map((e) => e.time).join(',') === '2,4', tl2.map((e) => e.time).join(','));
  check('moves が空なら null', buildSimpleTimeline([], null, 5) === null);
  check('moves が無ければ null', buildSimpleTimeline(null, null, 5) === null);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
