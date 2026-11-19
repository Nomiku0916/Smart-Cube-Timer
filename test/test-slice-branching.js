// Verification for the branching slice-pair interpretation:
//  1) a fast opposite-face pair that is NOT a slice (the 2026-11-19 failure:
//     F->B' at 48ms fused as S destroyed the solve) now analyzes correctly
//     via the no-fusion branch
//  2) a genuine slice move reported as an opposite-face pair is recovered
//     via the fusion branch (orientation remap included)
//  3) a stream that no interpretation can solve reports reachedSolved=false
//     and falls back to the plain (no-fusion) interpretation
//  4) the search stays bounded on pair-heavy unsolvable streams
//  5) when BOTH interpretations reach solved, the fusion interpretation
//     wins (deliberate slices are more common than coincidental
//     opposite-face turns, per the user's judgment)
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
const mkRaw = (moves, gapMs = 200) => moves.map((move, i) => ({
  move, time: (i * gapMs) / 1000, timeMs: i * gapMs
}));

// ---------- 1) misfusion case: pair is just two fast turns ----------
{
  // scramble: R U R' U' F' B  ->  solve (inverse): B' F U R U' R'
  const solve = ["B'", 'F', 'U', 'R', "U'", "R'"];
  const raw = mkRaw(solve, 10); // 10ms gaps: the old 50ms gate fused B' F into S'
  const post = cfop.postProcessSolve(raw, initialFromScramble("R U R' U' F' B"), 1.0);
  check('fast non-slice pair reaches solved via no-fusion branch', post.reachedSolved === true);
  check('no fusions were used', post.sliceFusions === 0, `sliceFusions=${post.sliceFusions}`);
  check('trueTime comes from the timeline', typeof post.trueTime === 'number' && post.trueTime > 0);
}

// ---------- 2) genuine slice case: fusion branch required ----------
// Mirror of cfop.js's orientation-map update, used to synthesize the raw
// stream a cube would report for an engine-frame solution containing M'.
function updateMapMirror(map, sliceMove) {
  const face = sliceMove[0];
  const count = sliceMove.endsWith('2') ? 2 : sliceMove.endsWith("'") ? 3 : 1;
  for (let k = 0; k < count; k++) {
    const prev = { ...map };
    if (face === 'M') { map.B = prev.U; map.D = prev.B; map.F = prev.D; map.U = prev.F; }
    else if (face === 'E') { map.L = prev.F; map.B = prev.L; map.R = prev.B; map.F = prev.R; }
    else if (face === 'S') { map.L = prev.U; map.D = prev.L; map.R = prev.D; map.U = prev.R; }
  }
}
const PAIR_FOR_SLICE = { "M'": ['R', "L'"], 'M': ["R'", 'L'], 'E': ['U', "D'"], "E'": ["U'", 'D'], 'S': ['F', "B'"], "S'": ["F'", 'B'] };
{
  const solution = ['R', 'U', "M'", 'F', "U'"]; // engine-frame solution containing M'
  // scramble = inverse(solution) applied to solved
  const scrambleState = new Uint8Array(54);
  engine.resetStateArray(scrambleState);
  for (const m of [...solution].reverse().map((x) => engine.getInverseMove(x))) {
    engine.applyMoveToArray(scrambleState, m);
  }
  // generate the raw stream: walk the solution with the orientation map
  const map = { U: 'U', D: 'D', F: 'F', B: 'B', R: 'R', L: 'L' };
  const invMapFace = (engineFace) => Object.keys(map).find((f) => map[f] === engineFace);
  const rawMoves = [];
  for (const step of solution) {
    if (PAIR_FOR_SLICE[step]) {
      const [p1, p2] = PAIR_FOR_SLICE[step];
      rawMoves.push(invMapFace(p1[0]) + p1.slice(1));
      rawMoves.push(invMapFace(p2[0]) + p2.slice(1));
      updateMapMirror(map, step);
    } else {
      rawMoves.push(invMapFace(step[0]) + step.slice(1));
    }
  }
  const post = cfop.postProcessSolve(mkRaw(rawMoves), scrambleState, 1.2);
  check('genuine slice reaches solved via fusion branch', post.reachedSolved === true);
  check('exactly one fusion was used', post.sliceFusions === 1, `sliceFusions=${post.sliceFusions}`);
  check('cleaned timeline contains the slice move',
    post.cleanedTimeline.some((s) => s.move === "M'"),
    post.cleanedTimeline.map((s) => s.move).join(' '));
}

// ---------- 3) unsolvable stream: honest failure + plain fallback ----------
{
  const solve = ["B'", 'F', 'U', 'R', "U'", "R'"];
  const corrupted = [...solve];
  corrupted[3] = 'L'; // break the solve with a wrong move
  const post = cfop.postProcessSolve(mkRaw(corrupted, 10), initialFromScramble("R U R' U' F' B"), 9.99);
  check('unsolvable stream reports reachedSolved=false', post.reachedSolved === false);
  check('unsolvable stream falls back to fallback time', post.trueTime === 9.99);
  check('unsolvable stream uses the plain interpretation',
    post.sliceFusions === 0 && post.cleanedTimeline.length === corrupted.length);
}

// ---------- 4) bounded search on a pair-heavy unsolvable stream ----------
{
  // (L' R U R' L U') x5: pair-heavy (2 candidate pairs per cycle) but the
  // cycle does not collapse to identity, so no interpretation reaches solved.
  const cycle = ["L'", 'R', 'U', "R'", 'L', "U'"];
  const moves = [];
  for (let i = 0; i < 5; i++) moves.push(...cycle);
  const solved = new Uint8Array(54);
  engine.resetStateArray(solved);
  const t0 = Date.now();
  const post = cfop.postProcessSolve(mkRaw(moves, 100), solved, 4.0);
  const elapsed = Date.now() - t0;
  check('pair-heavy unsolvable stream finishes quickly', elapsed < 2000, `${elapsed}ms`);
  check('pair-heavy unsolvable stream reports reachedSolved=false', post.reachedSolved === false);
}

// ---------- 5) both interpretations solve -> fusion preferred ----------
// Stream R L' L R' U2 from a U2 state: the plain reading solves
// (R L' L R' = identity, then U2), and the fused reading also solves
// (M' M = identity, then U2). The fusion reading must be adopted.
{
  const initial = new Uint8Array(54);
  engine.resetStateArray(initial);
  engine.applyMoveToArray(initial, 'U2');
  const raw = mkRaw(['R', "L'", 'L', "R'", 'U2']);
  const post = cfop.postProcessSolve(raw, initial, 1.0);
  check('ambiguous stream reaches solved', post.reachedSolved === true);
  check('fusion interpretation wins when both solve', post.sliceFusions === 2,
    `sliceFusions=${post.sliceFusions}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
