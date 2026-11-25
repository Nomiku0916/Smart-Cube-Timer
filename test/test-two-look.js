// 2Look / 3Look の実行ステップ認識（区間マッチ）のテスト
// 実行: node test/test-two-look.js
// ケース1（実記録）: 22.99秒の 2Look OLL で EOLL が「OLL #33」と認識され、
//   ステップが「#33 + #22 (Pi)」になること。
// ケース2（実記録）: Ga-perm を Gc-perm + Ub-perm の2手順で揃えた記録が
//   pllSteps として認識されること（パターン名 pllName は Ga-perm のまま）。
// ケース3（実記録）: 39手のお手つき Gb は 2Look と誤認されず pllSteps が付かないこと。
// ケース4〜7（合成）: 実記録の F2L までを使い、LL 以降を合成したタイムラインで
//   Ub×2 / Aa+Ua / 1Look の誤分割なし / EOLL 辞書手順 / EOLL バリアント（向きマッチ）/
//   EOLL を2回やる 3Look を検証する。
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
const { applyMoveToArray, resetStateArray, getInverseMove } = engine;

function initialFromScramble(scramble) {
  const s = new Uint8Array(54);
  resetStateArray(s);
  for (const m of scramble.split(' ').filter(Boolean)) applyMoveToArray(s, m);
  return s;
}
function toRawMoves(fx) {
  return fx.raw.map(([move, time]) => ({ move, time, timeMs: Math.round(time * 1000) }));
}

const BASE = { scramble: "R D2 F' D2 U' F B' U2 D B L' F2 L B R2 L2 F' D F2 U'", time: 13.63, raw: [["F'", 0], ["L'", -0.02], ["B", 0.81], ["B", 0.88], ["U'", 2.16], ["B'", 2.32], ["U", 2.65], ["U", 2.77], ["L'", 2.9], ["U'", 3.13], ["R'", 4.86], ["D", 4.97], ["R", 5.06], ["B'", 5.49], ["D'", 5.6], ["B", 5.74], ["D", 6.17], ["D", 6.37], ["R'", 6.5], ["D'", 6.63], ["R", 6.77], ["D", 6.91], ["B", 7.27], ["D", 7.36], ["B'", 7.58], ["D'", 8.46], ["D", 8.82], ["F", 8.89], ["D'", 8.93], ["F'", 9.03], ["D", 9.34], ["F", 9.34], ["D'", 9.34], ["F'", 9.61], ["D", 9.61], ["F", 9.61], ["D'", 9.61], ["F'", 10.37], ["D'", 10.37], ["D'", 10.6], ["F'", 10.73], ["D", 10.96], ["F", 10.96], ["D", 11.45], ["L", 11.45], ["D'", 11.45], ["L'", 12.04], ["D", 12.04], ["F'", 12.08], ["D'", 12.39], ["R'", 12.49], ["D", 12.53], ["R", 12.67], ["F", 12.85], ["D'", 13.63]] };
const GA = { scramble: "B U' B' R D' R2 B2 L' F L' D2 R D' L2 D L2 F L2 B' F2", time: 20.39, raw: [["R", 0], ["U'", 0.166], ["U'", 0.235], ["L", 0.572], ["B", 0.893], ["U'", 1.38], ["D", 2.345], ["L", 2.451], ["D'", 2.513], ["L'", 2.585], ["D", 2.648], ["L", 2.713], ["D'", 2.777], ["L'", 2.855], ["D", 2.921], ["L", 3.003], ["D'", 3.073], ["L'", 3.138], ["R'", 3.403], ["D'", 3.903], ["R", 4.025], ["D'", 4.258], ["D'", 4.466], ["L'", 4.762], ["D", 4.901], ["L", 5.139], ["D", 6.248], ["D", 6.511], ["B'", 6.939], ["D'", 7.073], ["B", 7.266], ["D'", 7.379], ["B'", 7.495], ["D", 7.607], ["B", 7.82], ["R'", 8.305], ["D", 8.375], ["R", 8.515], ["D", 8.676], ["R'", 8.823], ["D", 8.949], ["R", 9.078], ["D'", 9.147], ["F", 9.816], ["D", 9.956], ["F'", 10.086], ["D", 10.377], ["D'", 10.916], ["L", 11.122], ["D", 11.402], ["B", 11.537], ["D'", 11.607], ["B'", 11.772], ["L'", 11.993], ["D", 12.799], ["D", 12.889], ["F'", 13.326], ["D'", 13.512], ["F", 13.621], ["D", 13.798], ["B", 13.957], ["D'", 14.065], ["F'", 14.297], ["D", 14.4], ["F", 14.537], ["B'", 15.31], ["B'", 16.082], ["B'", 16.176], ["U'", 16.27], ["L", 16.498], ["D'", 16.573], ["L", 16.671], ["D", 16.761], ["L'", 16.975], ["U", 17.051], ["B", 17.26], ["B", 17.332], ["R", 17.772], ["D'", 17.857], ["R'", 18.015], ["D", 18.113], ["L", 18.561], ["R'", 18.598], ["L", 18.634], ["R'", 18.681], ["U'", 18.728], ["R", 18.824], ["L'", 18.937], ["B'", 19.05], ["B'", 19.162], ["R'", 19.178], ["L", 19.194], ["U'", 19.345], ["L", 19.427]] };
const GB = { scramble: "U D2 L F L' D' U2 B' D' R B2 R' D2 R' F R F2 D2 F2 R2", time: 20.05, raw: [["B", 0], ["R", 0.115], ["F'", 0.263], ["U", 0.82], ["R", 2.732], ["D", 2.874], ["R'", 2.995], ["D", 3.104], ["B'", 3.399], ["D'", 3.518], ["B", 3.675], ["B", 4.757], ["D", 4.937], ["B'", 5.109], ["B", 5.231], ["D'", 5.311], ["D'", 5.533], ["B'", 5.64], ["F", 5.99], ["D'", 6.189], ["F'", 6.352], ["D'", 7.523], ["F'", 7.846], ["D", 7.919], ["D", 8.17], ["F", 8.246], ["D", 8.513], ["L'", 8.794], ["D", 8.87], ["L", 9.132], ["D", 9.93], ["D", 10.141], ["L", 10.246], ["D'", 10.319], ["L'", 10.408], ["D'", 10.769], ["F'", 11.039], ["D'", 11.304], ["R'", 11.397], ["D", 11.454], ["R", 11.512], ["F", 11.697], ["D", 12.338], ["L", 12.461], ["R'", 12.689], ["D", 12.782], ["L'", 12.901], ["D'", 13.009], ["R", 13.12], ["D", 13.314], ["L", 13.475], ["D'", 13.541], ["L'", 13.617], ["R", 15.755], ["F", 15.886], ["R'", 15.98], ["D'", 16.117], ["R'", 16.314], ["D", 16.368], ["R", 16.472], ["R", 16.544], ["F'", 16.616], ["R'", 16.724], ["D'", 16.848], ["R", 17.009], ["F", 17.165], ["R'", 17.249], ["F'", 17.466], ["D", 17.862], ["L'", 18.195], ["R", 18.247], ["L'", 18.299], ["R", 18.375], ["U'", 18.452], ["L", 18.529], ["R'", 18.629], ["F'", 18.729], ["F'", 18.829], ["R", 18.892], ["L'", 18.956], ["U'", 19.02], ["L'", 19.122], ["R", 19.126], ["L'", 19.169], ["R", 19.289], ["L'", 19.409], ["R", 19.424], ["L'", 19.439], ["R", 19.499], ["U'", 19.56], ["L", 19.621], ["R'", 19.682], ["F'", 19.839], ["F'", 19.996], ["L'", 20.049]] };
const TARGET = { scramble: "L' U L2 F2 U' L2 F2 B U' L' B R F' B R' F' D' R B' F", time: 22.99, raw: [["R\'", 0], ["D\'", 0.24], ["B", 0.437], ["B", 0.529], ["U\'", 0.901], ["R\'", 1.058], ["U\'", 1.296], ["D", 2.807], ["B\'", 2.909], ["D", 3.002], ["B", 3.179], ["D\'", 3.264], ["D\'", 3.504], ["B\'", 3.654], ["B", 3.981], ["U\'", 4.434], ["U\'", 4.497], ["B\'", 4.856], ["D", 5.087], ["B", 5.29], ["B", 6.19], ["D\'", 6.317], ["B\'", 6.491], ["D\'", 6.683], ["L", 6.979], ["D", 7.119], ["D", 7.31], ["L\'", 7.415], ["D", 7.525], ["L", 7.632], ["D\'", 7.84], ["L\'", 8.053], ["B", 8.626], ["D\'", 8.726], ["B\'", 8.845], ["D\'", 8.966], ["L\'", 9.237], ["D\'", 9.326], ["L", 9.438], ["D\'", 9.557], ["L\'", 9.686], ["D", 9.787], ["L", 9.947], ["D", 11.508], ["D", 11.81], ["D", 12.069], ["R\'", 12.199], ["D\'", 12.295], ["R", 12.358], ["D", 12.433], ["R\'", 12.575], ["D\'", 12.686], ["R", 12.762], ["D", 12.983], ["L\'", 13.695], ["R", 13.729], ["L\'", 13.763], ["R", 13.931], ["U", 14.1], ["U", 14.155], ["L\'", 14.505], ["R", 14.684], ["L\'", 14.864], ["R", 15.585], ["L", 16.306], ["D", 16.432], ["L\'", 16.554], ["D\'", 16.676], ["L\'", 16.867], ["F", 16.957], ["L", 17.074], ["F\'", 17.154], ["L", 17.815], ["D", 17.942], ["D", 18.027], ["L", 18.152], ["L", 18.237], ["D\'", 18.303], ["L\'", 18.413], ["L\'", 18.473], ["D\'", 18.569], ["L", 18.64], ["L", 18.712], ["D\'", 18.783], ["D\'", 18.983], ["L", 19.082], ["D\'", 20.533], ["L", 20.635], ["R\'", 20.723], ["B", 20.811], ["L\'", 20.887], ["R", 21.002], ["L\'", 21.117], ["R", 21.157], ["F", 21.197], ["L\'", 21.267], ["R", 21.336], ["R", 21.863], ["L\'", 22.006], ["B", 22.15], ["L", 22.194], ["R\'", 22.239], ["U", 22.493], ["U", 22.709], ["R", 22.781], ["L\'", 22.885], ["L\'", 22.988], ["R", 22.99]] };

// ---------- ケース1: 実記録の 2Look OLL ----------
{
  const res = cfop.postProcessSolve(toRawMoves(TARGET), initialFromScramble(TARGET.scramble), TARGET.time);
  const c = res.cfop;
  check('ケース1: EOLL が OLL #33 と認識される', c.eollName === 'OLL #33', `eollName=${c.eollName}`);
  check('ケース1: ステップは #33 + #22 (Pi)', JSON.stringify((c.ollSteps || []).map((s) => s.name)) === JSON.stringify(['OLL #33', 'OLL #22 (Pi)']), JSON.stringify((c.ollSteps || []).map((s) => s.name)));
  check('ケース1: ステップ手数の合計が OLL 手数と一致', (c.ollSteps || []).reduce((a, s) => a + s.moves, 0) === c.ollMoves);
  check('ケース1: PLL は分割されない', c.pllSteps === null);
}

// ---------- ケース2: 実記録の PLL 2手順（Gc + Ub） ----------
{
  const res = cfop.postProcessSolve(toRawMoves(GA), initialFromScramble(GA.scramble), GA.time);
  const c = res.cfop;
  check('ケース2: パターン名は Ga-perm のまま', c.pllName === 'Ga-perm', c.pllName);
  check('ケース2: pllSteps は Gc-perm + Ub-perm', JSON.stringify((c.pllSteps || []).map((s) => s.name)) === JSON.stringify(['Gc-perm', 'Ub-perm']), JSON.stringify((c.pllSteps || []).map((s) => s.name)));
  check('ケース2: ステップ手数の合計が PLL 手数と一致', (c.pllSteps || []).reduce((a, s) => a + s.moves, 0) === c.pllMoves);
}

// ---------- ケース3: お手つき PLL は誤認しない ----------
{
  const res = cfop.postProcessSolve(toRawMoves(GB), initialFromScramble(GB.scramble), GB.time);
  const c = res.cfop;
  check('ケース3: 39手の Gb に pllSteps が付かない', c.pllSteps === null, `pllName=${c.pllName}`);
}

// ---------- 合成ケースの土台（BASE の F2L まで + 合成 LL） ----------
function plainTimeline(fx) {
  const st = initialFromScramble(fx.scramble);
  return fx.raw.map(([move, time]) => { applyMoveToArray(st, move); return { move, time, state: new Uint8Array(st) }; });
}
const baseTl = plainTimeline(BASE);
const baseAnalysis = cfop.analyzeCFOP(baseTl, BASE.time);
const baseF2lIdx = baseAnalysis.phaseIdx.f2l[3];
const basePrefix = baseTl.slice(0, baseF2lIdx + 1);
const baseTime = basePrefix[basePrefix.length - 1].time;

function solvedState() { const s = new Uint8Array(54); resetStateArray(s); return s; }
function invSeq(moves) { return moves.slice().reverse().map((m) => getInverseMove(m)); }
function applySeq(state, moves) { const s = new Uint8Array(state); for (const m of moves) applyMoveToArray(s, m); return s; }
const pllAlg = (n) => cfop.PLL_ALGS.find(([x]) => x === n)[1];
const ollAlg = (n) => cfop.OLL_CASES.find((c) => c.name === n).moves;
// x2 共役（正規化フレーム → U面クロスのアプリフレーム）。エンジン未実装の
// ワイド b/l/u/d にならない範囲でのみ使う
const X2MAP = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'R', L: 'L', u: 'd', d: 'u', f: 'b', b: 'f', r: 'r', l: 'l' };
const conjX2 = (m) => {
  if (m[0] === 'x') return m;
  if (m[0] === 'y') return m === 'y' ? "y'" : m === "y'" ? 'y' : 'y2';
  if (m[0] === 'z') return m === 'z' ? "z'" : m === "z'" ? 'z' : 'z2';
  return X2MAP[m[0]] + m.slice(1);
};
function buildTimeline(preStateNorm, execNorm) {
  const pre = applySeq(preStateNorm, ['x2']);
  const tl = basePrefix.map((e) => ({ move: e.move, time: e.time, state: new Uint8Array(e.state) }));
  tl[tl.length - 1] = { move: tl[tl.length - 1].move, time: tl[tl.length - 1].time, state: pre };
  const st = new Uint8Array(pre);
  let t = baseTime;
  for (const m of execNorm.map(conjX2)) {
    applyMoveToArray(st, m);
    t += 0.25;
    tl.push({ move: m, time: parseFloat(t.toFixed(2)), state: new Uint8Array(st) });
  }
  return { tl, total: t };
}

// ---------- ケース4: 合成 PLL（Ub×2 / Aa+Ua / 1Look） ----------
for (const [label, patternInv, exec, expected] of [
  ['Ub×2', invSeq(pllAlg('Ua-perm')), [...pllAlg('Ub-perm'), ...pllAlg('Ub-perm')], ['Ub-perm', 'Ub-perm']],
  ['Aa+Ua', [...invSeq(pllAlg('Aa-perm')), ...invSeq(pllAlg('Ua-perm'))], [...pllAlg('Aa-perm'), ...pllAlg('Ua-perm')], ['Aa-perm', 'Ua-perm']],
  ['Ua 1Look', invSeq(pllAlg('Ua-perm')), pllAlg('Ua-perm'), null],
  ['T 1Look', invSeq(pllAlg('T-perm')), pllAlg('T-perm'), null]
]) {
  const pre = applySeq(solvedState(), patternInv);
  const { tl, total } = buildTimeline(pre, exec);
  const a = cfop.analyzeCFOP(tl, total, true);
  const got = a.pllSteps ? a.pllSteps.map((s) => s.name) : null;
  check(`ケース4: ${label}`, JSON.stringify(got) === JSON.stringify(expected), `pllSteps=${JSON.stringify(got)}`);
}

// ---------- OLL 合成の後ろ向き構成 ----------
function edgesOriented(s) { const u = s[4]; return [1, 5, 7, 3].every((i) => s[i] === u); }
function cornersOriented(s) { const u = s[4]; return [[0, 45, 36], [2, 9, 45], [8, 18, 9], [6, 36, 18]].every((c) => s[c[0]] === u); }
// S1（Uaパターン・向き完成）から inv(B) で「エッジ向き完成・コーナー未完成」の
// 中間状態 M が作れる B を辞書順に探す（決定的）
function findCollPartner() {
  const s1 = applySeq(solvedState(), invSeq(pllAlg('Ua-perm')));
  for (const c of cfop.OLL_CASES) {
    const M = applySeq(s1, invSeq(c.moves));
    if (edgesOriented(M) && !cornersOriented(M)) return { B: c, M, s1 };
  }
  return null;
}
const partner = findCollPartner();
check('ケース5準備: COLL パートナーが見つかる', !!partner, partner ? partner.B.name : '');

// ---------- ケース5: EOLL 辞書手順（#45） ----------
{
  const pre = applySeq(partner.M, invSeq(ollAlg('OLL #45')));
  const exec = [...ollAlg('OLL #45'), ...partner.B.moves, ...pllAlg('Ua-perm')];
  const { tl, total } = buildTimeline(pre, exec);
  const a = cfop.analyzeCFOP(tl, total, true);
  check('ケース5: EOLL が OLL #45 と認識される', a.eollName === 'OLL #45', `eollName=${a.eollName}`);
  check('ケース5: ステップは #45 + COLL', JSON.stringify((a.ollSteps || []).map((s) => s.name)) === JSON.stringify(['OLL #45', partner.B.name]), JSON.stringify((a.ollSteps || []).map((s) => s.name)));
}

// ---------- ケース6: EOLL バリアント（向きマッチで #43） ----------
{
  const variant = "R' U' F' U F R".split(' ');
  const pre = applySeq(partner.M, invSeq(variant));
  const exec = [...variant, ...partner.B.moves, ...pllAlg('Ua-perm')];
  const { tl, total } = buildTimeline(pre, exec);
  const a = cfop.analyzeCFOP(tl, total, true);
  check('ケース6: バリアント EOLL が OLL #43 と認識される', a.eollName === 'OLL #43', `eollName=${a.eollName}`);
  check('ケース6: ステップは #43 + COLL', JSON.stringify((a.ollSteps || []).map((s) => s.name)) === JSON.stringify(['OLL #43', partner.B.name]), JSON.stringify((a.ollSteps || []).map((s) => s.name)));
}

// ---------- ケース7: 3Look（EOLL を2回 + COLL） ----------
{
  const M1 = applySeq(partner.M, invSeq(ollAlg('OLL #45')));
  const pre = applySeq(M1, invSeq(ollAlg('OLL #45')));
  const exec = [...ollAlg('OLL #45'), ...ollAlg('OLL #45'), ...partner.B.moves, ...pllAlg('Ua-perm')];
  const { tl, total } = buildTimeline(pre, exec);
  const a = cfop.analyzeCFOP(tl, total, true);
  check('ケース7: 3ステップ認識される', (a.ollSteps || []).length === 3, JSON.stringify((a.ollSteps || []).map((s) => s.name)));
  check('ケース7: eollName は #45 + #45', a.eollName === 'OLL #45 + OLL #45', `eollName=${a.eollName}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
