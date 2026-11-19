// 「直近を保存」用ヘルパー pickRecentSolves のテスト
// 実行: node test/test-export-recent.js
const fs = require('fs');
const path = require('path');

const statsSrc = fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8');
const m = statsSrc.match(/function pickRecentSolves\(history, n\) \{[\s\S]*?\n  \}/);
if (!m) { console.error('FAIL: pickRecentSolves not found in stats.js'); process.exit(1); }
const pickRecentSolves = new Function(`${m[0]}\nreturn pickRecentSolves;`)();

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
  if (!cond) failures++;
}

const history = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));

const last20 = pickRecentSolves(history, 20);
check('20件指定で直近20件', last20.length === 20 && last20[0].id === 11 && last20[19].id === 30);

const last5 = pickRecentSolves(history, '5'); // promptは文字列を返す
check('文字列"5"でも直近5件', last5.length === 5 && last5[0].id === 26);

const all = pickRecentSolves(history, 1000);
check('件数が全件を超えたら全件', all.length === 30 && all[0].id === 1);

check('0件はnull（不正）', pickRecentSolves(history, 0) === null);
check('負数はnull（不正）', pickRecentSolves(history, -3) === null);
check('文字はnull（不正）', pickRecentSolves(history, 'abc') === null);
check('空の履歴は空配列', Array.isArray(pickRecentSolves([], 10)) && pickRecentSolves([], 10).length === 0);
check('元の履歴を書き換えない', history.length === 30);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
