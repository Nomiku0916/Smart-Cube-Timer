// READY確定serialガードの検証。
// 実測の不具合（2026-11-22、21.96秒の回）：スクランブル完成が
// FACELETS照合で先にREADY確定したあと、スクランブル最後の手（F2）の
// 「動いた」信号が配送遅延でインスペクション中に届き、READY分岐が
// それをソルブの最初の手と誤認してタイマーを開始し、記録の先頭に
// 混入した（先頭2手を落とすと記録全体が OLL #34→E-perm で整合する
// ことを切り分け済み）。
// 対策：READY確定時にFACELETS（または照合を完成させた手）のserialを
// readySerial に控え、READY中に届いた手のserialがそれ以下なら
// 「確定済み状態に反映済みの遅延配送」として無視する。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'cube.js'), 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.log('  FAIL', name); }
}

// ---- isStaleReadyMove を実物ソースから取り出して評価する ----
const startMarker = 'let solvedBuffer = null;';
const endMarker = '// バッファ内の手のうち、判定serial以下';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.log('FAIL: 抽出マーカーが見つからない');
  process.exit(1);
}
const stateCode = src.slice(startIdx, endIdx);
const factory = new Function(`
  let lastMoveSerial = -1;
  ${stateCode}
  return {
    isStaleReadyMove,
    setReady(v) { readySerial = v; },
    getReady() { return readySerial; }
  };
`);
const H = factory();

console.log('== 控えがない場合 ==');
H.setReady(null);
check('readySerial=null では何も stale にならない', H.isStaleReadyMove(10) === false);

console.log('== 通常範囲（readySerial=117、実測のF2は116・117） ==');
H.setReady(117);
check('serial 116（控えより前）は stale', H.isStaleReadyMove(116) === true);
check('serial 117（控えと一致）も stale', H.isStaleReadyMove(117) === true);
check('serial 118（次の新しい手）は stale でない', H.isStaleReadyMove(118) === false);
check('serial 130 は stale でない', H.isStaleReadyMove(130) === false);

console.log('== 8bitラップ（readySerial=5） ==');
H.setReady(5);
check('serial 250（ラップして後ろ）は stale', H.isStaleReadyMove(250) === true);
check('serial 200 は stale', H.isStaleReadyMove(200) === true);
check('serial 6（1つ先）は stale でない', H.isStaleReadyMove(6) === false);

console.log('== serialが取れない手は保守側（通常どおり開始する） ==');
H.setReady(117);
check('serial null は stale でない', H.isStaleReadyMove(null) === false);
check('serial undefined は stale でない', H.isStaleReadyMove(undefined) === false);

console.log('== 配線（ソース確認） ==');
check('APP_VERSION は現行版 2026.11.23.3', src.includes("const APP_VERSION = '2026.11.23.3';"));
const readyBranch = src.indexOf("if (appState === 'READY') {");
const guardPos = src.indexOf('if (isStaleReadyMove(meta.serial)) return;');
const startStatePos = src.indexOf('solveStartState = new Uint8Array(cubeState);', readyBranch);
check('READY分岐にガードがある', guardPos > readyBranch);
check('ガードは solveStartState の確定より前', guardPos < startStatePos);
check('FACELETS分岐で event.serial を控える',
  src.includes("readySerial = typeof event.serial === 'number' ? event.serial"));
check('手の照合でREADYに入る分岐でも控える',
  src.includes('readySerial = lastMoveSerial >= 0 ? lastMoveSerial : null;'));
check('ソルブ開始時に控えを消す',
  src.includes('solvedVerdictSerial = null;\r\n    readySerial = null;') ||
  src.includes('solvedVerdictSerial = null;\n    readySerial = null;'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
