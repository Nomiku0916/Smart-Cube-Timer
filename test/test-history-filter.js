// 履歴の複数選択フィルタ matchesFilters のテスト
// 実行: node test/test-history-filter.js
const fs = require('fs');
const path = require('path');

const statsSrc = fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8');
const m = statsSrc.match(/function matchesFilters\(cfop, ollSet, pllSet\) \{[\s\S]*?\n  \}/);
if (!m) { console.error('FAIL: matchesFilters not found in stats.js'); process.exit(1); }
const matchesFilters = new Function(`${m[0]}\nreturn matchesFilters;`)();

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

const S = (...xs) => new Set(xs);
const sune = { ollName: 'OLL #27', collName: 'OLL #27', pllName: 'Ua-perm' };
const anti = { ollName: 'OLL #26', collName: 'OLL #26', pllName: 'Ga-perm' };
const twoLook = { ollName: 'OLL #38', collName: 'OLL #27', pllName: 'Ub-perm' }; // 2Look: 2手目がSune形

check('空の集合は絞らない', matchesFilters(sune, S(), S()) === true);
check('OLL単一選択で一致', matchesFilters(sune, S('OLL #27'), S()) === true);
check('OLL単一選択で不一致', matchesFilters(anti, S('OLL #27'), S()) === false);
check('OLL複数選択はOR（SuneかAnti-Sune）',
  matchesFilters(sune, S('OLL #27', 'OLL #26'), S()) === true &&
  matchesFilters(anti, S('OLL #27', 'OLL #26'), S()) === true &&
  matchesFilters(twoLook, S('OLL #27', 'OLL #26'), S()) === true); // twoLook は collName でも一致
check('OLLはcollName（2Lookの2手目）でも一致する', matchesFilters(twoLook, S('OLL #27'), S()) === true);
check('PLL単一選択', matchesFilters(sune, S(), S('Ua-perm')) === true && matchesFilters(anti, S(), S('Ua-perm')) === false);
check('PLL複数選択はOR', matchesFilters(anti, S(), S('Ua-perm', 'Ga-perm')) === true);
check('OLLとPLLはAND', matchesFilters(sune, S('OLL #27'), S('Ga-perm')) === false &&
  matchesFilters(sune, S('OLL #27'), S('Ua-perm')) === true);
check('cfopが無くても落ちない（集合が空なら通過）', matchesFilters(null, S(), S()) === true);
check('cfopが無いと名前では一致しない', matchesFilters(undefined, S('OLL #27'), S()) === false);
check('Skipも名前として選べる', matchesFilters({ ollName: 'OLL Skip', pllName: 'PLL Skip' }, S('OLL Skip'), S('PLL Skip')) === true);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
