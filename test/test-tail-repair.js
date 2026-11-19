// Verification for Plan A (tail-difference repair in postProcessSolve):
//  1) a stream missing its last move is repaired by appending the BFS
//     difference (marked recovered, timestamp anchored to the last move)
//  2) a stream whose end state is far from solved (>6 moves) is NOT
//     repaired and stays honestly unsolved
//  3) an intact stream is untouched by the repair path
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
  exports.findRecoveryPath = findRecoveryPath;
  exports.FACE_NAMES = FACE_NAMES;
  exports.OPPOSITE_FACE = OPPOSITE_FACE;
`)(engine);

// ---------- load cfop.js with DOM stubs ----------
global.window = global;
global.document = {
  getElementById: () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, textContent: '', innerHTML: ''
  })
};
global.App = { cube: engine };
eval(fs.readFileSync(__dirname + '/../cfop.js', 'utf8'));
const cfop = global.App.cfop;

function initialFromScramble(scramble) {
  const s = new Uint8Array(54);
  engine.resetStateArray(s);
  for (const tok of scramble.split(' ')) engine.applyMoveToArray(s, tok);
  return s;
}
const mkRaw = (moves, gapMs = 300) => moves.map((move, i) => ({
  move, time: (i * gapMs) / 1000, timeMs: i * gapMs
}));
function timelineSolves(initial, cleanedTimeline) {
  const st = new Uint8Array(initial);
  for (const item of cleanedTimeline) engine.applyMoveToArray(st, item.move);
  return engine.isCubeSolvedArray(st);
}
const SCRAMBLE = "R U R' U' F' B";
const SOLVE = ["B'", 'F', 'U', 'R', "U'", "R'"];

// ---------- 1) missing last move -> repaired ----------
{
  const missingLast = SOLVE.slice(0, -1);
  const post = cfop.postProcessSolve(mkRaw(missingLast), initialFromScramble(SCRAMBLE), 9.99);
  check('stream itself did not solve', post.reachedSolved === false);
  check('exactly one tail move recovered', post.tailRecoveredMoves === 1, `tail=${post.tailRecoveredMoves}`);
  const appended = post.cleanedTimeline[post.cleanedTimeline.length - 1];
  check('appended move is the missing R\'', appended.move === "R'", appended.move);
  check('appended move is marked recovered', appended.recovered === true);
  check('appended move time anchored to last recorded move',
    appended.time === post.cleanedTimeline[post.cleanedTimeline.length - 2].time,
    `appended=${appended.time}`);
  check('repaired timeline solves end-to-end',
    timelineSolves(initialFromScramble(SCRAMBLE), post.cleanedTimeline));
  check('trueTime is the last move time, not the fallback', post.trueTime !== 9.99 && post.trueTime > 0);
}

// ---------- 2) far-from-solved end state -> NOT repaired ----------
{
  const junk = "F2 D R B' L2 D U' F2 B2 U' L' R2 F' D F2 B' R' B2 D' B2".split(' ');
  const post = cfop.postProcessSolve(mkRaw(junk, 100), initialFromScramble(SCRAMBLE), 9.99);
  check('far stream stays unsolved', post.reachedSolved === false);
  check('far stream gets no tail repair', post.tailRecoveredMoves === 0);
  check('far stream keeps fallback time', post.trueTime === 9.99);
}

// ---------- 3) intact stream untouched ----------
{
  const post = cfop.postProcessSolve(mkRaw(SOLVE), initialFromScramble(SCRAMBLE), 9.99);
  check('intact stream solves by itself', post.reachedSolved === true);
  check('intact stream has no tail repair', post.tailRecoveredMoves === 0);
  check('intact stream has no recovered entries',
    post.cleanedTimeline.every((s) => !s.recovered));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
