// Probe: does the app's 54-sticker engine align with Kociemba facelets order?
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../cube.js', 'utf8');
const start = src.indexOf('const COLORS');
const end = src.indexOf('function createCube3DInstance');
if (start < 0 || end < 0) { console.error('slice markers not found', start, end); process.exit(1); }
const engineSrc = src.slice(start, end);
const sandbox = {};
new Function('exports', engineSrc + `
  exports.resetStateArray = resetStateArray;
  exports.applyMoveToArray = applyMoveToArray;
  exports.isCubeSolvedArray = isCubeSolvedArray;
  exports.statesEqual = statesEqual;
  exports.findShortestRecovery = findShortestRecovery;
  exports.cubeState = cubeState;
`)(sandbox);

const { resetStateArray, applyMoveToArray, isCubeSolvedArray } = sandbox;

function stateToFacelets(s) {
  const F = 'URFDLB';
  let out = '';
  for (let i = 0; i < 54; i++) out += F[s[i]];
  return out;
}

// Reference from gan-web-bluetooth utils.ts docs: state after F R
const s = new Uint8Array(54);
resetStateArray(s);
applyMoveToArray(s, 'F');
applyMoveToArray(s, 'R');
const got = stateToFacelets(s);
const expected = 'UUFUUFLLFUUURRRRRRFFRFFDFFDRRBDDBDDBLLDLLDLLDLBBUBBUBB';
console.log('after F R:', got);
console.log('expected :', expected);
console.log(got === expected ? 'MATCH ✓' : 'MISMATCH ✗');

// Roundtrip: random scrambles -> string -> parse -> compare arrays
function faceletsToState(str) {
  const F = 'URFDLB';
  const a = new Uint8Array(54);
  for (let i = 0; i < 54; i++) a[i] = F.indexOf(str[i]);
  return a;
}
const MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
let ok = true;
for (let t = 0; t < 200; t++) {
  const st = new Uint8Array(54);
  resetStateArray(st);
  for (let i = 0; i < 25; i++) applyMoveToArray(st, MOVES[(Math.random() * 18) | 0]);
  const back = faceletsToState(stateToFacelets(st));
  for (let i = 0; i < 54; i++) if (back[i] !== st[i]) { ok = false; break; }
  if (!ok) break;
}
console.log('roundtrip x200:', ok ? 'OK ✓' : 'FAIL ✗');

// Solved check consistency
const s2 = new Uint8Array(54);
resetStateArray(s2);
console.log('solved state is solved:', isCubeSolvedArray(s2) === true ? 'OK ✓' : 'FAIL ✗');
