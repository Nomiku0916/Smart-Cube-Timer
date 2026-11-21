// 状態リセットボタンが、アプリ側とキューブ側の両方をリセットすることの検証。
// 実物が揃っているのにキューブ内部の追跡だけがずれている場合
// （例：D2 B' 分のずれ）、アプリ側だけ戻しても直後のFACELETS同期で
// キューブ側の申告に上書きされてしまうため、毎回両方を行う仕様にした
// （2026-11-21 v2026.11.21.4、本人の指示）。
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.log(`  ✗ ${name}`); }
}

// リセットボタンのハンドラ本体を取り出す
const handlerStart = cubeSrc.indexOf("resetBtn.addEventListener('click'");
check('状態リセットボタンのハンドラがある', handlerStart !== -1);
const handlerEnd = cubeSrc.indexOf("nextScrambleBtn.addEventListener", handlerStart);
const handler = handlerStart === -1 ? '' : cubeSrc.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd);

check('キューブ接続時に REQUEST_RESET を送る', /cubeConnection/.test(handler) && /sendCubeCommand\(\{ type: 'REQUEST_RESET' \}\)/.test(handler));
check('アプリ側の状態もリセットする', /resetCubeState\(\)/.test(handler));
check('serial追跡を初期化する（lastMoveSerial = -1）', /lastMoveSerial = -1/.test(handler));
check('スクランブルを変えずに照合を作り直す', /generateNewScramble\(true\)/.test(handler));

// generateNewScramble(true) でスクランブルが保持されること
const genStart = cubeSrc.indexOf('function generateNewScramble(');
const genHead = genStart === -1 ? '' : cubeSrc.slice(genStart, genStart + 400);
check('generateNewScramble が keepMoves 引数を持つ', /function generateNewScramble\(keepMoves = false\)/.test(genHead));
check('keepMoves 時は新規生成をスキップする分岐がある', /if \(!keepMoves \|\| !scrambleMoves \|\| scrambleMoves\.length === 0\)/.test(genHead));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
