// 「揃った」判定のserialで、配送中の手を待ってから確定することの検証。
// 実測（2026-11-21、18.52秒のUa×2の回）：2回目のUa約15手が配送
// 遅延している間にFACELETSの「揃った」判定が先に届いて確定して
// しまい、記録から丸ごと抜け落ちた。判定に付いているserial（判定
// 時点のキューブの手数）に記録側が追いつくまで確定を待ち、確定時
// はバッファ内の判定までの手を取り込むようにした（v2026.11.21.5、
// 本人の承認済み）。
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}`); }
}

check('判定serialを保持する変数がある', /let solvedVerdictSerial = null;/.test(cubeSrc));
check('FACELETSの「揃った」で判定serialを取り込む', /if \(typeof event\.serial === 'number'\) solvedVerdictSerial = event\.serial;/.test(cubeSrc));
check('追いつき判定の関数がある', /function isVerdictSerialCaughtUp\(\)/.test(cubeSrc));
check('バッファ取り込みの関数がある', /function adoptBufferMovesUpToVerdict\(\)/.test(cubeSrc));
check('取り込みは solveTimeline へ積む', /solveTimeline\.push\(\{ move: b\.move, time: bElapsed, timeMs: b\.nowMs, \.\.\.b\.meta \}\)/.test(cubeSrc));
check('ポーリング確定が追いつき判定と上限3秒を見る', /isVerdictSerialCaughtUp\(\) \|\| now - solvedBufferAt >= 3000/.test(cubeSrc));
check('ポーリング確定前にバッファを取り込む', /adoptBufferMovesUpToVerdict\(\);\s*\n\s*solvedBuffer = null;\s*\n\s*const fallbackTime = parseFloat\(\(\(now - startTime\) \/ 1000\)\.toFixed\(2\)\);/.test(cubeSrc));
check('12手見切りも追いつき判定を尊重する', /if \(isVerdictSerialCaughtUp\(\)\) \{\s*\n\s*adoptBufferMovesUpToVerdict\(\)/.test(cubeSrc));
check('finalizeSolve で判定serialを消す', /function finalizeSolve[\s\S]{0,200}solvedVerdictSerial = null;/.test(cubeSrc));

// 追いつき判定そのものの動作（cube.js から関数を取り出して評価する）
const fnStart = cubeSrc.indexOf('function isVerdictSerialCaughtUp()');
const fnEnd = cubeSrc.indexOf('}', fnStart);
const fnSrc = cubeSrc.slice(fnStart, fnEnd + 1);
function caughtUp(verdict, last) {
  let solvedVerdictSerial = verdict;
  let lastMoveSerial = last;
  return eval(`(${fnSrc})`)();
}
check('serial未設定なら追いつき扱い', caughtUp(null, 100) === true);
check('未接続相当（last=-1）なら追いつき扱い', caughtUp(50, -1) === true);
check('一致すれば追いつき', caughtUp(145, 145) === true);
check('15手後ろなら未追いつき', caughtUp(160, 145) === false);
check('3手追い越したら追いつき', caughtUp(145, 148) === true);
check('循環：判定5・記録250は11手後ろで未追いつき', caughtUp(5, 250) === false);
check('循環：判定250・記録5は11手追い越しで追いつき', caughtUp(250, 5) === true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
