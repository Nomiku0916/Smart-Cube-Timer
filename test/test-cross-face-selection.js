// クロス面判定（F2L完成ベース）のテスト
// 実行: node test/test-cross-face-selection.js
// ケース1: 2026-11-24 22.99秒の実記録。クロスを作り間違えた（白青と白緑が
//   逆）ことに気づきながらF2Lを先に入れ、最後にクロスを直したソルブ。
//   途中（45手目）でオレンジのクロスが一瞬完成するため、従来の
//   「最初に完成したクロス」ルールでは crossFace=L に吸われて全フェーズが
//   ずれ、リプレイで上が赤くなった。新ルール（F2L完成が最初に成立した面を
//   クロス面とする）では U面・OLL #51・Z-perm と正しく判定されること。
// ケース2: 通常のソルブ（2026-11-21 18.52秒）では従来と同じ判定のまま。
// ケース3: F2L完成が無い切り詰めた記録では、従来ルール（最初のクロス）に
//   フォールバックすること。
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------- engine ----------
const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
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

// ---------- cfop ----------
global.window = global;
global.document = {
  getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, textContent: '', innerHTML: '' })
};
global.App = { cube: engine };
eval(fs.readFileSync(path.join(APP, 'cfop.js'), 'utf8'));
const cfop = global.App.cfop;

function initialFromScramble(scramble) {
  const s = new Uint8Array(54);
  engine.resetStateArray(s);
  for (const m of scramble.split(' ').filter(Boolean)) engine.applyMoveToArray(s, m);
  return s;
}
function toRawMoves(fx) {
  return fx.raw.map(([move, time]) => ({ move, time, timeMs: Math.round(time * 1000) }));
}

const TARGET = { scramble: "L' U L2 F2 U' L2 F2 B U' L' B R F' B R' F' D' R B' F", time: 22.99, raw: [["R\'", 0], ["D\'", 0.24], ["B", 0.437], ["B", 0.529], ["U\'", 0.901], ["R\'", 1.058], ["U\'", 1.296], ["D", 2.807], ["B\'", 2.909], ["D", 3.002], ["B", 3.179], ["D\'", 3.264], ["D\'", 3.504], ["B\'", 3.654], ["B", 3.981], ["U\'", 4.434], ["U\'", 4.497], ["B\'", 4.856], ["D", 5.087], ["B", 5.29], ["B", 6.19], ["D\'", 6.317], ["B\'", 6.491], ["D\'", 6.683], ["L", 6.979], ["D", 7.119], ["D", 7.31], ["L\'", 7.415], ["D", 7.525], ["L", 7.632], ["D\'", 7.84], ["L\'", 8.053], ["B", 8.626], ["D\'", 8.726], ["B\'", 8.845], ["D\'", 8.966], ["L\'", 9.237], ["D\'", 9.326], ["L", 9.438], ["D\'", 9.557], ["L\'", 9.686], ["D", 9.787], ["L", 9.947], ["D", 11.508], ["D", 11.81], ["D", 12.069], ["R\'", 12.199], ["D\'", 12.295], ["R", 12.358], ["D", 12.433], ["R\'", 12.575], ["D\'", 12.686], ["R", 12.762], ["D", 12.983], ["L\'", 13.695], ["R", 13.729], ["L\'", 13.763], ["R", 13.931], ["U", 14.1], ["U", 14.155], ["L\'", 14.505], ["R", 14.684], ["L\'", 14.864], ["R", 15.585], ["L", 16.306], ["D", 16.432], ["L\'", 16.554], ["D\'", 16.676], ["L\'", 16.867], ["F", 16.957], ["L", 17.074], ["F\'", 17.154], ["L", 17.815], ["D", 17.942], ["D", 18.027], ["L", 18.152], ["L", 18.237], ["D\'", 18.303], ["L\'", 18.413], ["L\'", 18.473], ["D\'", 18.569], ["L", 18.64], ["L", 18.712], ["D\'", 18.783], ["D\'", 18.983], ["L", 19.082], ["D\'", 20.533], ["L", 20.635], ["R\'", 20.723], ["B", 20.811], ["L\'", 20.887], ["R", 21.002], ["L\'", 21.117], ["R", 21.157], ["F", 21.197], ["L\'", 21.267], ["R", 21.336], ["R", 21.863], ["L\'", 22.006], ["B", 22.15], ["L", 22.194], ["R\'", 22.239], ["U", 22.493], ["U", 22.709], ["R", 22.781], ["L\'", 22.885], ["L\'", 22.988], ["R", 22.99]] };
const NORMAL = { scramble: "B' D' F' R B' U' D' R L' D2 R U' F2 R L2 D' L' D' F B2", time: 18.52, raw: [["L", 0], ["B", 0.175], ["R\'", 0.489], ["D\'", 0.766], ["B", 0.963], ["B", 1.091], ["D\'", 1.618], ["D", 1.785], ["F", 2.013], ["D\'", 2.127], ["F\'", 2.215], ["D\'", 2.683], ["R\'", 3.063], ["D\'", 3.145], ["R", 3.32], ["D\'", 3.433], ["R\'", 3.542], ["D", 3.601], ["R", 3.75], ["D", 4.398], ["L", 4.535], ["D\'", 4.633], ["D\'", 4.826], ["L\'", 4.938], ["D", 4.994], ["B", 5.303], ["D\'", 5.468], ["B\'", 5.659], ["D", 6.032], ["D", 6.826], ["D", 7.089], ["L", 7.303], ["D", 7.555], ["L\'", 7.673], ["D\'", 7.896], ["B\'", 8.539], ["D\'", 8.71], ["B", 9.014], ["D", 9.709], ["D", 9.955], ["D", 10.213], ["L", 10.282], ["D\'", 10.341], ["L\'", 10.449], ["D", 10.502], ["L", 10.554], ["D\'", 10.628], ["L\'", 10.682], ["D", 10.735], ["L", 10.806], ["D\'", 10.865], ["L\'", 11.078], ["D", 11.29], ["F\'", 11.496], ["D\'", 11.755], ["R\'", 11.831], ["D", 11.873], ["R", 11.967], ["F", 12.168], ["D\'", 12.594], ["D\'", 12.802], ["L", 12.874], ["R\'", 13.093], ["D", 13.22], ["L\'", 13.357], ["D\'", 13.456], ["R", 13.587], ["D", 13.759], ["L", 13.918], ["D\'", 14.002], ["L\'", 14.156], ["D", 14.753], ["D", 14.966], ["L\'", 15.234], ["R", 15.283], ["L\'", 15.332], ["R", 15.384], ["U\'", 15.436], ["L", 15.536], ["R\'", 15.646], ["F\'", 15.755], ["F\'", 15.865], ["L\'", 15.946], ["R", 15.996], ["U\'", 16.046], ["L\'", 16.157], ["R", 16.19], ["L\'", 16.223], ["R", 16.335], ["L\'", 16.447], ["R", 16.486], ["R", 16.524]] };

// ---------- ケース1: 間違ったクロスを最後に直したソルブ ----------
{
  const res = cfop.postProcessSolve(toRawMoves(TARGET), initialFromScramble(TARGET.scramble), TARGET.time);
  const c = res.cfop;
  check('ケース1: クロス面は U（一瞬完成したオレンジに吸われない）', c.crossFace === 'U', `crossFace=${c.crossFace}`);
  check('ケース1: Cross は 15.59秒（クロスを直し終えた時点）', c.cross === 15.59, `cross=${c.cross}`);
  check('ケース1: F2L は 0秒（クロス完成と同時にスロットも揃っていた）', c.f2lTotal === 0, `f2lTotal=${c.f2lTotal}`);
  check('ケース1: OLL #51 と判定される', c.ollName === 'OLL #51', c.ollName);
  check('ケース1: Z-perm と判定される', c.pllName === 'Z-perm', c.pllName);
  check('ケース1: Z-perm のスライス融合が 8件', res.sliceFusions === 8, `fusions=${res.sliceFusions}`);
  check('ケース1: フェーズ境界が有効', !!(c.phaseIdx && c.phaseIdx.valid));
}

// ---------- ケース2: 通常のソルブは従来通り ----------
{
  const res = cfop.postProcessSolve(toRawMoves(NORMAL), initialFromScramble(NORMAL.scramble), NORMAL.time);
  const c = res.cfop;
  check('ケース2: クロス面は U', c.crossFace === 'U', `crossFace=${c.crossFace}`);
  check('ケース2: OLL #5 のまま', c.ollName === 'OLL #5', c.ollName);
  check('ケース2: Ua-perm のまま', c.pllName === 'Ua-perm', c.pllName);
}

// ---------- ケース3: F2L完成が無ければ従来ルールにフォールバック ----------
{
  const st = initialFromScramble(TARGET.scramble);
  const timeline = toRawMoves(TARGET).slice(0, 51).map((e) => {
    engine.applyMoveToArray(st, e.move);
    return { move: e.move, time: e.time, state: new Uint8Array(st) };
  });
  const c = cfop.analyzeCFOP(timeline, TARGET.time);
  check('ケース3: F2L完成が無い途中までの記録では最初のクロス（L面）が採用される',
    c.crossFace === 'L', `crossFace=${c.crossFace}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
