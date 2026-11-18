// Verification for the "分析不可" (analysis unavailable) behavior:
//  1) renderAnalysisUnavailable shows the notice instead of CFOP splits
//  2) the failure criterion: a slice-pair misfusion makes the cleaned timeline
//     not reach solved (which is what flags isSolvedComplete=false), while the
//     same stream without the misfusion analyzes normally
const fs = require('fs');
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- load engine from cube.js ----------
const cubeSrc = fs.readFileSync(__dirname + '/../cube.js', 'utf8');
const engine = {};
new Function('exports', cubeSrc.slice(cubeSrc.indexOf('const COLORS'), cubeSrc.indexOf('function createCube3DInstance')) + `
  exports.resetStateArray = resetStateArray;
  exports.applyMoveToArray = applyMoveToArray;
  exports.applyMoveCW = applyMoveCW;
  exports.isCubeSolvedArray = isCubeSolvedArray;
  exports.countHTM = countHTM;
  exports.calcTPS = calcTPS;
  exports.getInverseMove = getInverseMove;
  exports.FACE_NAMES = FACE_NAMES;
  exports.OPPOSITE_FACE = OPPOSITE_FACE;
`)(engine);

// ---------- load cfop.js with per-id DOM stubs ----------
const elements = {};
function makeEl() {
  return {
    style: {}, textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}
  };
}
global.window = global;
global.document = { getElementById: (id) => (elements[id] = elements[id] || makeEl()) };
global.App = { cube: engine };
eval(fs.readFileSync(__dirname + '/../cfop.js', 'utf8'));
const cfop = global.App.cfop;

// ---------- 1) renderAnalysisUnavailable ----------
cfop.renderAnalysisUnavailable();
check('total stats shows 分析不可', elements['total-stats'].textContent === '分析不可');
check('summary shows the unavailable notice', elements['cfop-summary'].innerHTML.includes('分析不可'));
check('panel is shown', elements['cfop-panel'].style.display === 'block');
check('detail areas are cleared',
  elements['cfop-detail-f2l'].innerHTML === '' &&
  elements['cfop-detail-oll'].innerHTML === '' &&
  elements['cfop-detail-pll'].innerHTML === '');

// ---------- 2) misfusion criterion ----------
// scramble: R U R' U' F' B  ->  solve (inverse): B' F U R U' R'
// The opening B' F is an opposite-face pair: at a 10ms gap it is (wrongly)
// fused into slice S and the orientation remap garbles the rest.
function initialFromScramble(scramble) {
  const s = new Uint8Array(54);
  engine.resetStateArray(s);
  for (const tok of scramble.split(' ')) engine.applyMoveToArray(s, tok);
  return s;
}
function timelineSolves(initial, cleanedTimeline) {
  const st = new Uint8Array(initial);
  for (const item of cleanedTimeline) engine.applyMoveToArray(st, item.move);
  return engine.isCubeSolvedArray(st);
}
const solveMoves = ["B'", 'F', 'U', 'R', "U'", "R'"];
const mkRaw = (firstGapMs) => solveMoves.map((move, i) => ({
  move,
  time: (i === 0 ? 0 : firstGapMs + (i - 1) * 300) / 1000,
  timeMs: i === 0 ? 0 : firstGapMs + (i - 1) * 300
}));

const fused = cfop.postProcessSolve(mkRaw(10), initialFromScramble("R U R' U' F' B"), 1.6);
check('misfused stream does NOT reach solved (=> 分析不可)',
  !timelineSolves(initialFromScramble("R U R' U' F' B"), fused.cleanedTimeline));

const clean = cfop.postProcessSolve(mkRaw(5000), initialFromScramble("R U R' U' F' B"), 1.6);
check('same stream with wide gaps reaches solved (=> normal analysis)',
  timelineSolves(initialFromScramble("R U R' U' F' B"), clean.cleanedTimeline));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
