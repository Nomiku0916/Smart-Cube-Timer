// Verification for the accuracy improvements:
//  1) findRecoveryPath (bidirectional BFS) recovers 1..6 missing moves
//  2) fitTimelineTimes reconstructs per-move intervals from batched arrivals
//  3) cleanMoveHistory basic contract (slice branching lives in test-slice-branching.js)
//  4) postProcessSolve end-to-end on a synthetic CFOP solve (names + splits)
const fs = require('fs');
let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- load engine + new helpers from cube.js ----------
const cubeSrc = fs.readFileSync(__dirname + '/../cube.js', 'utf8');
const start = cubeSrc.indexOf('const COLORS');
const end = cubeSrc.indexOf('function createCube3DInstance');
const engine = {};
new Function('exports', cubeSrc.slice(start, end) + `
  exports.resetStateArray = resetStateArray;
  exports.applyMoveToArray = applyMoveToArray;
  exports.applyMoveCW = applyMoveCW;
  exports.isCubeSolvedArray = isCubeSolvedArray;
  exports.statesEqual = statesEqual;
  exports.countHTM = countHTM;
  exports.calcTPS = calcTPS;
  exports.getInverseMove = getInverseMove;
  exports.faceletsToState = faceletsToState;
  exports.findRecoveryPath = findRecoveryPath;
  exports.fitTimelineTimes = fitTimelineTimes;
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

const MOVES18 = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
const rnd = (n) => (Math.random() * n) | 0;

// ---------- 1) findRecoveryPath ----------
{
  let allOk = true;
  for (let trial = 0; trial < 60; trial++) {
    const from = new Uint8Array(54);
    engine.resetStateArray(from);
    for (let i = 0; i < 20; i++) engine.applyMoveToArray(from, MOVES18[rnd(18)]);
    const to = new Uint8Array(from);
    const k = 1 + rnd(6);
    for (let i = 0; i < k; i++) engine.applyMoveToArray(to, MOVES18[rnd(18)]);
    const path = engine.findRecoveryPath(from, to, 6);
    if (!path || path.length > k) { allOk = false; console.log('  recovery failed at k=', k, 'path=', path); break; }
    const verify = new Uint8Array(from);
    for (const m of path) engine.applyMoveToArray(verify, m);
    if (!engine.statesEqual(verify, to)) { allOk = false; console.log('  recovery path does not reach target, k=', k); break; }
  }
  check('findRecoveryPath recovers 1..6 missing moves', allOk);
  const solved = new Uint8Array(54);
  engine.resetStateArray(solved);
  check('findRecoveryPath same state -> []', (engine.findRecoveryPath(solved, solved, 6) || []).length === 0);
}

// ---------- 2) fitTimelineTimes ----------
{
  // true intervals (ms) for 12 moves
  const truth = [0, 95, 210, 285, 430, 520, 640, 760, 830, 990, 1120, 1250];
  // cube clock: 0.2% fast, arbitrary offset; host arrival: batched (groups share arrival), latency jitter
  const entries = truth.map((t, i) => ({
    move: 'U',
    cubeTimestamp: Math.round(5000 + t * 1.002),
    localTimestamp: null
  }));
  // batches of 3 share one arrival timestamp (the batch's last move local time + latency)
  for (let b = 0; b < truth.length; b += 3) {
    const arrival = 9000 + truth[Math.min(b + 2, truth.length - 1)] + 25;
    for (let i = b; i < Math.min(b + 3, truth.length); i++) {
      if (i === Math.min(b + 2, truth.length - 1)) entries[i].localTimestamp = arrival;
    }
  }
  const fitted = engine.fitTimelineTimes(entries);
  let maxErr = -1;
  if (fitted) {
    for (let i = 0; i < truth.length; i++) maxErr = Math.max(maxErr, Math.abs(fitted[i] - truth[i]));
  }
  check('fitTimelineTimes reconstructs intervals from batches', !!fitted && maxErr <= 60, `maxErr=${maxErr}ms`);
  check('fitTimelineTimes insufficient data -> null',
    engine.fitTimelineTimes([{ cubeTimestamp: null, localTimestamp: null }]) === null);
}

// ---------- 3) slice-pair handling (superseded by branching search) ----------
// The 50ms time gate was replaced by a branching search in postProcessSolve:
// both interpretations of an opposite-face pair are tried and the one that
// reaches solved wins. See test/test-slice-branching.js for the full checks.
// Here we only assert the basic contract of cleanMoveHistory without an
// initial state (no completion judgment possible -> plain conversion).
{
  const plain = cfop.cleanMoveHistory([
    { move: 'R', time: 0, timeMs: 0 },
    { move: "L'", time: 0.01, timeMs: 10 },
    { move: 'U', time: 0.3, timeMs: 300 }
  ]);
  check('cleanMoveHistory without initial state passes moves through',
    plain.length === 3 && plain[0].move === 'R' && plain[1].move === "L'" && plain[2].move === 'U',
    JSON.stringify(plain.map(f => f.move)));
}

// ---------- 4a) analyzeCFOP on a canonical CFOP timeline ----------
// timeline[0] = F2L-complete state carrying the Sune case, then Sune, Ua-perm, U.
{
  const inv = (m) => engine.getInverseMove(m);
  const ollSeg = "R U R' U R U2 R'".split(' ');            // Sune (7 tokens)
  const pllSeg = "R U' R U R U R U' R' U' R2".split(' ');  // Ua-perm (11 tokens)

  const P = new Uint8Array(54);
  engine.resetStateArray(P);
  for (const m of [...pllSeg].reverse().map(inv)) engine.applyMoveToArray(P, m);
  for (const m of [...ollSeg].reverse().map(inv)) engine.applyMoveToArray(P, m);

  const solution = [...ollSeg, ...pllSeg, 'U'];
  const timeline = [{ move: 'U', time: 0.1, state: new Uint8Array(P) }];
  const st = new Uint8Array(P);
  solution.forEach((m, i) => {
    engine.applyMoveToArray(st, m);
    timeline.push({ move: m, time: 0.1 * (i + 2), state: new Uint8Array(st) });
  });
  const total = 0.1 * (solution.length + 1); // 2.0s
  const c = cfop.analyzeCFOP(timeline, total);
  const phaseSum = c.cross + c.f2lTotal + c.oll + c.pll + c.auf;
  check('analyze: crossFace is D', c.crossFace === 'D', `crossFace=${c.crossFace}`);
  check('analyze: phase durations sum to total', Math.abs(phaseSum - total) < 0.05, `sum=${phaseSum.toFixed(2)}`);
  check('analyze: OLL duration = Sune segment', Math.abs(c.oll - 0.7) < 0.011, `oll=${c.oll}`);
  check('analyze: PLL duration = Ua segment', Math.abs(c.pll - 1.1) < 0.011, `pll=${c.pll}`);
  check('analyze: AUF duration = final U', Math.abs(c.auf - 0.1) < 0.011, `auf=${c.auf}`);
  check('analyze: OLL detected as Sune', c.ollName === 'OLL #27 (Sune)', `ollName=${c.ollName}`);
  check('analyze: PLL detected as Ua-perm', c.pllName === 'Ua-perm', `pllName=${c.pllName}`);
}

// ---------- 4b) postProcessSolve smoke test: random scramble + inverse ----------
{
  const inv = (m) => engine.getInverseMove(m);
  const scramble = [];
  for (let i = 0; i < 20; i++) scramble.push(MOVES18[rnd(18)]);
  const solution = [...scramble].reverse().map(inv);
  const scrambled = new Uint8Array(54);
  engine.resetStateArray(scrambled);
  for (const m of scramble) engine.applyMoveToArray(scrambled, m);

  const raw = solution.map((m, i) => ({ move: m, time: (i + 1) * 0.1, timeMs: (i + 1) * 100 }));
  const result = cfop.postProcessSolve(raw, scrambled, solution.length * 0.1);
  const c = result.cfop;
  const phaseSum = c.cross + c.f2lTotal + c.oll + c.pll + c.auf;
  check('postProcess: trueTime = last move time', Math.abs(result.trueTime - solution.length * 0.1) < 0.011, `trueTime=${result.trueTime}`);
  check('postProcess: phase durations sum to total', Math.abs(phaseSum - result.trueTime) < 0.05, `sum=${phaseSum.toFixed(2)}`);
  const simEnd = result.cleanedTimeline[result.cleanedTimeline.length - 1];
  check('postProcess: cleaned timeline ends solved', engine.isCubeSolvedArray(simEnd.state));
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
