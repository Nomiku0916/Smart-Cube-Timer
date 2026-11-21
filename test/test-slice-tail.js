// 末尾欠け（タイマー停止に間に合わなかった手がある）ソルブでも、
// スライス解釈が落ちないことの検証。
// 従来は「並び全体が完成する解釈」だけを採用していたため、末尾が
// 数手欠けただけで融合ごと素の読みに落ちていた（実測2件で確認）。
// 救済パスでは「完成まで5手以内」の解釈も候補に残すが、素の読みで
// 付いたOLL/PLL名を変える解釈は採用しない（名前ガード）。
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
const { engine, cfop } = buildCfop();

function analyze(rec) {
  const start = new Uint8Array(54);
  engine.resetStateArray(start);
  for (const m of rec.scramble.split(' ')) engine.applyMoveToArray(start, m);
  return cfop.postProcessSolve(rec.rawMoves, start, rec.time);
}

const FILES = '/home/hatch/workspace/user/files';
const recent2 = JSON.parse(fs.readFileSync(path.join(FILES, 'gan-timer-backup-20261121-recent2_0_4n0g.json'), 'utf8'));
const gbBackup = JSON.parse(fs.readFileSync(path.join(FILES, 'gan-timer-backup-20261121-recent1_1_31ps.json'), 'utf8'));

console.log('ケース1: 末尾2手欠けのUb（Sスライス主体）');
{
  const rec = recent2.find((r) => r.date === '2026-11-21T04:44:00.133Z');
  const res = analyze(rec);
  check('スライスが融合される', res.sliceFusions === 4);
  check('OLL/PLL名は記録どおり', res.cfop.ollName === 'OLL #51' && res.cfop.pllName === 'Ub-perm');
  check('末尾補完は2手のまま', res.tailRecoveredMoves === 2);
}

console.log('ケース2: 末尾3手欠けのUa（Mスライス主体）');
{
  const rec = recent2.find((r) => r.date === '2026-11-21T04:44:35.126Z');
  const res = analyze(rec);
  check('スライスが融合される', res.sliceFusions === 2);
  check('OLL/PLL名は記録どおり', res.cfop.ollName === 'OLL #31' && res.cfop.pllName === 'Ua-perm');
  check('末尾補完は3手のまま', res.tailRecoveredMoves === 3);
}

console.log('ケース3: M連打のGb（名前ガードでPLL名が変わらない）');
{
  const rec = gbBackup[0];
  const res = analyze(rec);
  check('PLL名がGbのまま変わらない', res.cfop.pllName === 'Gb-perm');
  check('OLL名も変わらない', res.cfop.ollName === 'OLL #29');
  check('末尾補完は5手のまま', res.tailRecoveredMoves === 5);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
