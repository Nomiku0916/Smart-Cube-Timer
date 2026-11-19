// 「揃った」信号が「動いた」信号を追い越すケースの検証。
// FACELETS（全面状態）が完成を示しても即終了せず、遅れて届く手を
// 保留バッファで待ち、届いた手で完成すれば正規の記録として取り込む。
// 実データ（2026-11-19 22:29のソルブ、末尾 L' R2 D が未記録だった回）を
// イベント列として再生し、状態遷移ごと検証する。
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const cfopSrc = fs.readFileSync(path.join(APP, 'cfop.js'), 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}`); }
}

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`function ${name} not closed`);
}

// cfop.js（実物）を、エンジン実物と組み合わせて読み込む
function buildCfop() {
  const engine = {};
  new Function('exports', cubeSrc.slice(cubeSrc.indexOf('const COLORS'), cubeSrc.indexOf('function createCube3DInstance')) + `
    exports.resetStateArray = resetStateArray; exports.applyMoveToArray = applyMoveToArray;
    exports.applyMoveCW = applyMoveCW; exports.isCubeSolvedArray = isCubeSolvedArray;
    exports.countHTM = countHTM; exports.calcTPS = calcTPS; exports.getInverseMove = getInverseMove;
    exports.findRecoveryPath = findRecoveryPath; exports.faceletsToState = faceletsToState;
    exports.FACE_NAMES = FACE_NAMES; exports.OPPOSITE_FACE = OPPOSITE_FACE;
  `)(engine);
  const holder = { App: { cube: engine } };
  const docStub = { getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, textContent: '', innerHTML: '' }) };
  new Function('window', 'document', cfopSrc)(holder, docStub);
  return { engine, cfop: holder.App.cfop };
}

// cube.js の状態遷移まわりを、DOM/Bluetooth をスタブして丸ごと再構成する
function buildWorld() {
  const { cfop } = buildCfop();
  let now = 1000000;
  const intervals = new Map();
  let nextIntervalId = 1;
  const savedCalls = [];
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, textContent: '', innerHTML: '' });
  const windowStub = {
    App: {
      replay: { isReplayOpen: () => false },
      cfop: Object.assign(cfop, { renderCFOP() {}, renderAnalysisUnavailable() {} }),
      stats: {
        saveSolve(...args) { savedCalls.push(args); return { id: 4242, isSolvedComplete: true }; }
      }
    }
  };
  const stateDecls = cubeSrc.slice(cubeSrc.indexOf("let appState = 'SCRAMBLE';"), cubeSrc.indexOf('let solvedBuffer = null;') + 'let solvedBuffer = null;'.length);
  const engineSlice = cubeSrc.slice(cubeSrc.indexOf('const COLORS'), cubeSrc.indexOf('function createCube3DInstance'));
  const fnNames = ['setAppState', 'startTimer', 'stopTimer', 'renderMove', 'handleMove', 'finalizeSolve', 'checkSolved', 'handleFaceletsEvent'];
  const fns = fnNames.map((n) => extractFn(cubeSrc, n)).join('\n');
  const pollMatch = cubeSrc.match(/setInterval\(\(\) => \{\n  if \(!cubeConnection\)[\s\S]*?\}, 200\);/);
  if (!pollMatch) throw new Error('poll interval block not found');
  const factory = new Function(
    'window', 'performance', 'setInterval', 'clearInterval',
    'timerStateEl', 'timerDisplayEl', 'gestureHintEl', 'replayStartBtn', 'deleteLastBtn', 'timerCube3D', 'cubeConnection',
    `
    ${stateDecls}
    ${engineSlice}
    ${fns}
    function renderScramble() {}
    function generateNewScramble() {}
    ${pollMatch[0]}
    return {
      handleMove, handleFaceletsEvent,
      applyMoveToArray, resetStateArray, isCubeSolvedArray,
      setupSolve(scrambleStr) {
        scrambleMoves = scrambleStr.trim().split(/\\s+/);
        resetStateArray(cubeState);
        for (const m of scrambleMoves) applyMoveToArray(cubeState, m);
        lastMoveSerial = -1;
        appState = 'READY';
      },
      get appState() { return appState; },
      get timelineLength() { return solveTimeline.length; },
      get buffered() { return solvedBuffer === null ? null : solvedBuffer.length; }
    };
    `
  );
  const world = factory(
    windowStub,
    { now: () => now },
    (cb, ms) => { const id = nextIntervalId++; intervals.set(id, { cb, ms }); return id; },
    (id) => { intervals.delete(id); },
    el(), el(), el(), el(), el(),
    { fastSync() {}, animateMove() {}, finishAnimationNow() {}, resetAngle() {} },
    { sendCubeCommand: async () => {} }
  );
  return {
    world, savedCalls,
    setNow(v) { now = v; },
    getNow() { return now; },
    poll() { for (const { cb, ms } of intervals.values()) if (ms === 200) cb(); }
  };
}

const RECORD_PATH = '/home/hatch/workspace/user/files/gan-timer-backup-20261119-recent1_0_kjf9.json';
const record = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'))[0];
const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const LATE_MOVES = [
  { move: "L'", dt: 90, cubeTimestamp: 245921 },
  { move: 'R2', dt: 85, cubeTimestamp: 246006 },
  { move: 'D', dt: 80, cubeTimestamp: 246086 }
];

function feedRecorded(h, upto) {
  const raw = record.rawMoves.slice(0, upto);
  let prevArrival = null;
  for (const m of raw) {
    if (prevArrival !== null) h.setNow(h.getNow() + Math.max(1, m.arrivalTimeMs - prevArrival));
    prevArrival = m.arrivalTimeMs;
    h.world.handleMove(m.move, { cubeTimestamp: m.cubeTimestamp, localTimestamp: m.localTimestamp, serial: m.serial });
  }
}

console.log('シナリオ1: 「揃った」の後に遅れて3手が届く（今回の実ケース）');
{
  const h = buildWorld();
  h.world.setupSolve(record.scramble);
  feedRecorded(h, 74);
  check('記録済みの74手では未完成・未保存', h.savedCalls.length === 0 && h.world.appState === 'SOLVING');
  h.world.handleFaceletsEvent({ facelets: SOLVED_FACELETS });
  check('「揃った」信号では即終了しない', h.savedCalls.length === 0 && h.world.appState === 'SOLVING');
  check('保留バッファが開いている', h.world.buffered === 0);
  let serial = 208;
  for (const late of LATE_MOVES) {
    h.setNow(h.getNow() + late.dt);
    h.world.handleMove(late.move, { cubeTimestamp: late.cubeTimestamp, localTimestamp: null, serial: serial++ });
  }
  check('遅れた3手で完成し、1回だけ保存された', h.savedCalls.length === 1);
  const [trueTime, , , , , rawSnap, options] = h.savedCalls[0];
  check('保存された手数が77手', rawSnap.length === 77);
  check('末尾が L\' R2 D の順で取り込まれた', rawSnap.slice(-3).map((e) => e.move).join(' ') === "L' R2 D");
  check('末尾補完は使っていない', options.tailRecoveredMoves === 0);
  check('タイムは最後の手の時刻ベース（14.6への膨らみなし）', trueTime > 13.9 && trueTime < 14.4);
}

console.log('シナリオ2: 「揃った」の後に手が来ない（従来どおり終了）');
{
  const h = buildWorld();
  h.world.setupSolve(record.scramble);
  feedRecorded(h, 74);
  h.world.handleFaceletsEvent({ facelets: SOLVED_FACELETS });
  h.setNow(h.getNow() + 400);
  h.poll();
  check('静かになってから終了し、1回だけ保存された', h.savedCalls.length === 1 && h.world.appState === 'SOLVED');
  check('記録は74手のまま（従来動作）', h.savedCalls[0][5].length === 74);
}

console.log('シナリオ3: 「揃った」の後に完成しない手が来る（完成後の余計な手）');
{
  const h = buildWorld();
  h.world.setupSolve(record.scramble);
  feedRecorded(h, 74);
  h.world.handleFaceletsEvent({ facelets: SOLVED_FACELETS });
  h.setNow(h.getNow() + 100);
  h.world.handleMove('U', { cubeTimestamp: 246000, localTimestamp: null, serial: 208 });
  check('余計な手では終了しない', h.savedCalls.length === 0 && h.world.buffered === 1);
  h.setNow(h.getNow() + 400);
  h.poll();
  check('静かになってから終了し、1回だけ保存された', h.savedCalls.length === 1);
  check('余計な手は記録に入っていない', h.savedCalls[0][5].length === 74);
}

console.log('シナリオ4: 通常のソルブ（手の信号だけで完成）への影響なし');
{
  const h = buildWorld();
  h.world.setupSolve(record.scramble);
  feedRecorded(h, 74);
  let serial = 208;
  for (const late of LATE_MOVES) {
    h.setNow(h.getNow() + late.dt);
    h.world.handleMove(late.move, { cubeTimestamp: late.cubeTimestamp, localTimestamp: null, serial: serial++ });
  }
  check('最後の手で即終了し、1回だけ保存された', h.savedCalls.length === 1 && h.world.appState === 'SOLVED');
  check('77手すべて記録された', h.savedCalls[0][5].length === 77);
  h.poll();
  check('終了後のポーリングで二重保存しない', h.savedCalls.length === 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
