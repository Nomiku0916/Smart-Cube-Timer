// クイック接続の検証（ソースレベルの配線確認）：
// - ⚙メニューに通常接続とは別の「⚡ クイック接続」ボタンがあること
// - getDevices() で許可済みデバイスを取り、ライブラリが呼ぶ
//   requestDevice を接続試行の間だけ差し替えて流用し、必ず元へ
//   戻す（delete）こと
// - 接続後の処理（attachCubeConnection）が通常接続とクイック接続の
//   両方から使われていること
// 実機での接続可否はブラウザの Web Bluetooth 実装に依存するため、
// ここでは配線の退行を防ぐところまでを担う。
// 実行: node test/test-quick-connect.js
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

check('index.html にクイック接続ボタンがある', indexSrc.includes('id="quick-connect-btn"'));
check('通常の接続ボタンも残っている', indexSrc.includes('id="connect-btn"'));
check('cube.js がクイック接続ボタンを取得している', cubeSrc.includes("getElementById('quick-connect-btn')"));

check('getDevices で許可済みデバイスを取得している', cubeSrc.includes('navigator.bluetooth.getDevices()'));
check('未対応ブラウザを判定している', cubeSrc.includes("typeof navigator.bluetooth.getDevices !== 'function'"));
check('デバイス名の接頭辞でキューブを選んでいる', cubeSrc.includes('/^(GAN|MG|AiCube)/'));
check('許可済みが無い場合の案内がある', cubeSrc.includes('許可済みのキューブが見つかりません'));

check('requestDevice を差し替える関数がある', cubeSrc.includes('async function connectGanCubeWithDevice(device)'));
check('差し替えが効いたか確認している', cubeSrc.includes('bt.requestDevice !== stub'));
check('差し替えを必ず元に戻している', cubeSrc.includes('delete bt.requestDevice'));
check('クイック接続もライブラリの connectGanCube を使う', (cubeSrc.match(/connectGanCube\(\)/g) || []).length >= 2);

check('接続後の共通処理 attachCubeConnection がある', cubeSrc.includes('function attachCubeConnection()'));
check('attachCubeConnection が両経路から呼ばれている',
  (cubeSrc.match(/attachCubeConnection\(\);/g) || []).length === 2,
  `呼び出し ${(cubeSrc.match(/attachCubeConnection\(\);/g) || []).length} 箇所`);
check('接続中はクイック接続ボタンを無効化する', cubeSrc.includes('if (quickConnectBtn) quickConnectBtn.disabled = true;'));
check('切断時はクイック接続ボタンを再有効化する', cubeSrc.includes('if (quickConnectBtn) quickConnectBtn.disabled = false;'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
