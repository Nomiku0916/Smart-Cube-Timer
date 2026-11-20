// 「AI分析用に保存」 buildAiCsv のテスト
// 実行: node test/test-ai-export.js
const fs = require('fs');
const path = require('path');

const statsSrc = fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8');
const m = statsSrc.match(/function buildAiCsv\(records, appVersion\) \{[\s\S]*?\n  \}/);
if (!m) { console.error('FAIL: buildAiCsv not found in stats.js'); process.exit(1); }
const buildAiCsv = new Function(`${m[0]}\nreturn buildAiCsv;`)();

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const FILES = '/home/hatch/workspace/user/files';
const recent20 = JSON.parse(fs.readFileSync(path.join(FILES, 'gan-timer-backup-20261119-recent20_0_wg1f.json'), 'utf8'));
const csv = buildAiCsv(recent20, '2026.11.20.1');

check('BOM付きで始まる', csv.charCodeAt(0) === 0xFEFF);
const lines = csv.replace(/^﻿/, '').split('\r\n').filter((l) => l.length > 0);
const commentLines = lines.filter((l) => l.startsWith('#'));
check('説明コメントが8行ある', commentLines.length === 8, `comments=${commentLines.length}`);
check('バージョンと件数がコメントに入る', commentLines[0].includes('2026.11.20.1') && commentLines[1].includes('solves: 20'));

const header = lines[commentLines.length].split(',');
check('列数は30', header.length === 30, `cols=${header.length}`);
check('列名が正しい', header[0] === 'date' && header[13] === 'f2l3_t' && header[19] === 'oll_name' &&
  header[23] === 'oll_2look' && header[24] === 'pll_name' && header[28] === 'incomplete' && header[29] === 'repaired',
  header.join(','));

const rows = lines.slice(commentLines.length + 1);
check('データ行は20行', rows.length === 20, `rows=${rows.length}`);
check('全行が30セル', rows.every((r) => r.split(',').length === 30));

// 完成した記録：値が cfop と一致する
{
  const idx = recent20.findIndex((r) => r.isSolvedComplete);
  const r = recent20[idx];
  const cells = rows[idx].split(',');
  check('日時の形式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cells[0]), cells[0]);
  check('全体タイム', cells[1] === r.time.toFixed(2), cells[1]);
  check('cross_t が cfop.cross と一致', cells[4] === r.cfop.cross.toFixed(2), cells[4]);
  check('f2l3_t が cfop.f2l[2] と一致', cells[13] === r.cfop.f2l[2].toFixed(2), cells[13]);
  check('oll_name / pll_name', cells[19] === r.cfop.ollName && cells[24] === r.cfop.pllName, `${cells[19]} / ${cells[24]}`);
  check('oll_2look', cells[23] === (r.cfop.is2LookOll ? '1' : '0'), cells[23]);
  check('incomplete=0', cells[28] === '0');
}

// 分析不可の記録：フェーズ欄は空、incomplete=1
{
  const idx = recent20.findIndex((r) => !r.isSolvedComplete);
  const cells = rows[idx].split(',');
  check('分析不可は incomplete=1', cells[28] === '1');
  check('分析不可はフェーズ欄が空', cells.slice(2, 28).every((c) => c === ''));
  check('分析不可でも日時と全体タイムはある', cells[0].length === 19 && cells[1] !== '');
}

// 補完された記録（末尾欠けUa）： repaired=1 で値も入る
{
  const rec = JSON.parse(fs.readFileSync(path.join(FILES, 'gan-timer-backup-20261119-recent1_0_kjf9.json'), 'utf8'));
  // この記録は保存時点では未補完（分析不可）。再解析後の形を模して
  // isSolvedComplete と tailRecoveredMoves を立てたコピーで確認する
  const repaired = { ...rec[0], isSolvedComplete: true, tailRecoveredMoves: 3 };
  const out = buildAiCsv([repaired], 'x');
  const row = out.replace(/^﻿/, '').split('\r\n').filter((l) => l && !l.startsWith('#'))[1].split(',');
  check('補完済みは repaired=1', row[29] === '1');
  check('補完済みは incomplete=0 で値が入る', row[28] === '0' && row[4] !== '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
