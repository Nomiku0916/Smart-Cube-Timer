// Verification for slice-interpretation selection:
//  - the pair->slice table and orientation remapping are derived from the
//    engine so that "pair" === "slice + whole-cube rotation" physically
//  - fusion candidates are limited to the LL (OLL/PLL) segments of the
//    plain reading and may not straddle a phase boundary (the phase
//    gate: slices belong to LL, not to Cross/F2L). When no boundary can
//    be detected, the search falls back to the second-half rule.
//  - among interpretations that finish (up to rotation), the winner is
//    chosen by CFOP coherence first, then by fusion count
// Cases:
//  1) an opposite pair outside the LL segments is never fused (gate)
//  2) a slice-shaped pair in a micro-solve whose plain reading has no
//     LL segment containing it stays unfused; the stream still solves.
//     (Genuine LL slices on real records are covered by
//     test-phase-boundaries.js.)
//  3) an ambiguous stream whose pairs fall outside the LL segments
//     stays unfused and still solves
//  4) an unsolvable stream stays unsolved with the plain fallback
//  5) the search stays bounded on pair-heavy unsolvable streams
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

function initialFromMoves(moves) {
  const s = new Uint8Array(54);
  engine.resetStateArray(s);
  for (const m of moves) engine.applyMoveToArray(s, m);
  return s;
}
const initialFromScramble = (scr) => initialFromMoves(scr.split(' '));
const mkRaw = (moves, gapMs = 300) => moves.map((move, i) => ({
  move, time: (i * gapMs) / 1000, timeMs: i * gapMs
}));
function endState(initial, cleanedTimeline) {
  const st = new Uint8Array(initial);
  for (const item of cleanedTimeline) engine.applyMoveToArray(st, item.move);
  return st;
}

// ---------- 1) first-half pair is never fused ----------
{
  const post = cfop.postProcessSolve(
    mkRaw(["B'", 'F', 'U', 'R', "U'", "R'"]),
    initialFromScramble("R U R' U' F' B"),
    9.99
  );
  check('healthy solve reaches solved', post.reachedSolved === true);
  check('first-half pair stays unfused', post.sliceFusions === 0, `sliceFusions=${post.sliceFusions}`);
}

// ---------- 2) slice-shaped pair outside the LL segments ----------
// Virtual solution: R U M' F, reported as R U L R' D. This micro-solve
// has no CFOP phase structure whose LL segment would contain the pair,
// so the phase gate keeps it unfused (real LL slices: see
// test-phase-boundaries.js, the Z-perm record).
{
  const initial = initialFromMoves(["F'", 'M', "U'", "R'"]); // inverse of the solution
  const raw = mkRaw(['R', 'U', 'L', "R'", 'D']);
  const post = cfop.postProcessSolve(raw, initial, 9.99);
  check('slice-shaped solve reaches solved', post.reachedSolved === true);
  check('pair outside LL stays unfused', post.sliceFusions === 0, `sliceFusions=${post.sliceFusions}`);
  check('timeline finishes up to rotation',
    cfop.isUniformSolved(endState(initial, post.cleanedTimeline)));
  check('trueTime comes from the timeline', post.trueTime !== 9.99 && post.trueTime > 0);
}

// ---------- 3) ambiguous stream outside the LL segments ----------
// Stream R L' L R' U2 from a U2 state: both opposite pairs fall outside
// the LL segments of the plain reading, so nothing fuses.
{
  const initial = initialFromMoves(['U2']);
  const raw = mkRaw(['R', "L'", 'L', "R'", 'U2']);
  const post = cfop.postProcessSolve(raw, initial, 9.99);
  check('ambiguous stream reaches solved', post.reachedSolved === true);
  check('pairs outside LL stay unfused', post.sliceFusions === 0, `sliceFusions=${post.sliceFusions}`);
}

// ---------- 4) unsolvable stream stays unsolved ----------
{
  const raw = mkRaw(["B'", 'F', 'U', 'R', "R'"]); // not a solve of the scramble
  const post = cfop.postProcessSolve(raw, initialFromScramble("R U R' U' F' B"), 9.99);
  check('unsolvable stream reports reachedSolved=false', post.reachedSolved === false);
  check('unsolvable stream falls back to fallback time', post.trueTime === 9.99);
  check('unsolvable stream uses no fusions', post.sliceFusions === 0);
}

// ---------- 5) bounded on pair-heavy streams ----------
{
  const moves = [];
  for (let k = 0; k < 12; k++) moves.push('L', "R'");
  const t0 = Date.now();
  const post = cfop.postProcessSolve(mkRaw(moves, 40), initialFromScramble("R U R' U' F' B"), 9.99);
  const elapsed = Date.now() - t0;
  check('pair-heavy unsolvable stream finishes quickly', elapsed < 3000, `${elapsed}ms`);
  check('pair-heavy unsolvable stream reports reachedSolved=false', post.reachedSolved === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
