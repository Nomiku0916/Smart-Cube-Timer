// Verification for the "分析不可" (analysis unavailable) behavior:
//  1) renderAnalysisUnavailable shows the notice instead of CFOP splits
//  2) the failure criterion: a stream corrupted by a wrong move reaches
//     solved under no interpretation, so its cleaned timeline does not solve
//     (which is what flags isSolvedComplete=false), while an intact stream
//     analyzes normally
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

// ---------- 2) the failure criterion ----------
// isSolvedComplete=false (the flag that triggers the unavailable display) is
// computed by replaying the cleaned timeline. A stream corrupted by a wrong
// move reaches solved under NO interpretation (including the branching
// slice search), so it stays flagged; an intact stream solves normally.
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
const mkRaw = (moves) => moves.map((move, i) => ({
  move, time: (i * 300) / 1000, timeMs: i * 300
}));

const corrupted = [...solveMoves];
corrupted[3] = 'L';
const bad = cfop.postProcessSolve(mkRaw(corrupted), initialFromScramble("R U R' U' F' B"), 1.6);
check('corrupted stream does NOT reach solved (=> 分析不可)',
  bad.reachedSolved === false &&
  !timelineSolves(initialFromScramble("R U R' U' F' B"), bad.cleanedTimeline));

const clean = cfop.postProcessSolve(mkRaw(solveMoves), initialFromScramble("R U R' U' F' B"), 1.6);
check('intact stream reaches solved (=> normal analysis)',
  clean.reachedSolved === true &&
  timelineSolves(initialFromScramble("R U R' U' F' B"), clean.cleanedTimeline));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
