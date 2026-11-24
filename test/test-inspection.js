// インスペクション（スクランブル完成→ソルブ開始）のテスト
// 実行: node test/test-inspection.js
// cube.js のインスペクション一式（セクション）を切り出してサンドボックスで
// 動かし、カウントダウン表示・警告色・ビープ・自動スタート・制限の
// 入り切りを、フェイク時計で確認する。配線はソース確認で担保する。
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const cubeSrc = fs.readFileSync(path.join(APP, 'cube.js'), 'utf8');
const statsSrc = fs.readFileSync(path.join(APP, 'stats.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

// ---------- セクションの切り出し ----------
const secStart = cubeSrc.indexOf('// インスペクション（スクランブル完成');
const secEnd = cubeSrc.indexOf('// タブ切り替え');
check('インスペクションのセクションが cube.js にある', secStart !== -1 && secEnd > secStart);
const sectionSrc = cubeSrc.slice(secStart, secEnd);

// ---------- サンドボックス ----------
function makeEnv(storageInit) {
  const beeps = [];
  class FakeAC {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { this.state = 'running'; }
    createOscillator() {
      const osc = { type: '', frequency: { value: 0 }, connect() {}, start() { beeps.push(osc.frequency.value); }, stop() {} };
      return osc;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  let fakeNow = 0;
  let intervalCb = null;
  const classes = new Set();
  const display = {
    textContent: '0.00',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); }
    }
  };
  const storage = new Map(Object.entries(storageInit || {}));
  const prelude = `
    let appState = 'SCRAMBLE';
    const transitions = [];
    function setAppState(s) { transitions.push([appState, s]); appState = s; }
    let timerStarted = 0;
    function startTimer() { timerStarted++; }
    const cubeState = new Uint8Array(54);
    let solveStartState = null, solveHadGap = false, solveRecoveredMoves = 0;
    let solvedBuffer = null, solvedVerdictSerial = null, readySerial = null, lastAnimMs = 0;
    let solveTimeline = [{ move: 'X' }];
  `;
  const factory = new Function('window', 'localStorage', 'timerDisplayEl', 'performance', 'setInterval', 'clearInterval',
    prelude + sectionSrc + `
    return { startInspection, stopInspection, updateInspection, startSolveFromInspection, applyInspectionLimitSetting,
             state: () => ({ readyAtMs, solveInspectionTime, inspectionLimitEnabled, hasTimer: inspectionTimerId !== null, appState, transitions, timerStarted, solveTimeline }),
             setAppStateRaw: (s) => { appState = s; } };`);
  const api = factory(
    { AudioContext: FakeAC, App: { replay: { isReplayOpen: () => false } } },
    { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    display,
    { now: () => fakeNow },
    (cb) => { intervalCb = cb; return 1; },
    () => { intervalCb = null; }
  );
  return {
    api, beeps, display, classes, storage,
    setNow: (ms) => { fakeNow = ms; },
    tick: () => { if (intervalCb) intervalCb(); },
    hasInterval: () => intervalCb !== null
  };
}

// ---------- シナリオ1: 制限ありのカウントダウン一巡 ----------
{
  const env = makeEnv({});
  check('既定は制限あり', env.api.state().inspectionLimitEnabled === true);
  env.setNow(1000);
  env.api.setAppStateRaw('READY');
  env.api.startInspection();
  check('READYで表示が15になる', env.display.textContent === '15', env.display.textContent);
  check('カウントダウンのタイマーが動く', env.hasInterval());

  env.setNow(1000 + 6900); env.tick();
  check('残り8.1秒では表示9・警告色なし', env.display.textContent === '9' && !env.classes.has('inspection-warning'),
    `${env.display.textContent}/${[...env.classes]}`);
  env.setNow(1000 + 7100); env.tick();
  check('残り7.9秒で表示8・警告色が付く', env.display.textContent === '8' && env.classes.has('inspection-warning'));

  env.setNow(1000 + 12000); env.tick();
  check('残り3秒で表示3・ビープ1回', env.display.textContent === '3' && env.beeps.length === 1, `beeps=${env.beeps}`);
  env.setNow(1000 + 12500); env.tick();
  check('同じ秒ではビープを繰り返さない', env.beeps.length === 1);
  env.setNow(1000 + 13100); env.tick();
  check('残り1.9秒で表示2・ビープ2回', env.display.textContent === '2' && env.beeps.length === 2);
  env.setNow(1000 + 14100); env.tick();
  check('残り0.9秒で表示1・ビープ3回', env.display.textContent === '1' && env.beeps.length === 3);

  env.setNow(1000 + 15050); env.tick();
  const st = env.api.state();
  check('0秒でSOLVINGへ自動スタート', st.transitions.some(([a, b]) => a === 'READY' && b === 'SOLVING') && st.timerStarted === 1,
    JSON.stringify(st.transitions));
  check('自動スタート時のインスペクションは約15秒で記録される',
    typeof st.solveInspectionTime === 'number' && Math.abs(st.solveInspectionTime - 15.05) < 0.001,
    `inspection=${st.solveInspectionTime}`);
  check('自動スタートでは記録は空から始まる', Array.isArray(st.solveTimeline) && st.solveTimeline.length === 0);
  check('自動スタートで開始ビープ（高音）が鳴る', env.beeps[env.beeps.length - 1] === 1318, `beeps=${env.beeps}`);
}

// ---------- シナリオ2: 制限なし（保存済み設定） ----------
{
  const env = makeEnv({ gan_cube_inspection_limit: '0' });
  check('保存済み設定で制限なしになる', env.api.state().inspectionLimitEnabled === false);
  env.setNow(2000);
  env.api.setAppStateRaw('READY');
  env.api.startInspection();
  check('制限なしではカウントダウン表示もタイマーも始まらない',
    env.display.textContent === '0.00' && !env.hasInterval());
  check('制限なしでも計測の開始時刻は控えられる', env.api.state().readyAtMs === 2000);
}

// ---------- シナリオ3: READYの最中に設定を切り替える ----------
{
  const env = makeEnv({});
  env.setNow(1000);
  env.api.setAppStateRaw('READY');
  env.api.startInspection();
  env.setNow(6000); env.tick();
  check('開始5秒で表示10', env.display.textContent === '10', env.display.textContent);
  env.api.applyInspectionLimitSetting(false);
  check('オフにすると表示が戻りタイマーが止まる', env.display.textContent === '0.00' && !env.hasInterval());
  check('オフにしても計測は続く（開始時刻は保持）', env.api.state().readyAtMs === 1000);
  check('オフが保存される', env.storage.get('gan_cube_inspection_limit') === '0');
  env.api.applyInspectionLimitSetting(true);
  check('オンに戻すと残り時間から再開する', env.display.textContent === '10' && env.hasInterval(),
    env.display.textContent);
  check('オンが保存される', env.storage.get('gan_cube_inspection_limit') === '1');
}

// ---------- シナリオ4: stopInspection の表示リセット ----------
{
  const env = makeEnv({});
  env.setNow(0);
  env.api.setAppStateRaw('READY');
  env.api.startInspection();
  env.setNow(9000); env.tick();
  check('残り6秒で警告色', env.classes.has('inspection-warning'));
  env.api.stopInspection('SCRAMBLE');
  check('SCRAMBLEへ戻ると表示0.00・警告色が消える',
    env.display.textContent === '0.00' && !env.classes.has('inspection-warning') && env.api.state().readyAtMs === null);
}

// ---------- 配線のソース確認 ----------
check('setAppState が READY の出入りで開始・停止する',
  cubeSrc.includes("if (newState === 'READY' && prevState !== 'READY') startInspection();") &&
  cubeSrc.includes('stopInspection(newState)'));
check('READYの最初の手でインスペクション秒数が確定する',
  cubeSrc.includes('solveInspectionTime = readyAtMs !== null'));
check('記録に inspectionTime が含まれる', cubeSrc.includes('inspectionTime: solveInspectionTime'));
check('記録の0点をタイマー開始時刻に合わせる補正がある', cubeSrc.includes('const startOffsetMs'));
check('設定メニューに「インスペクションタイム制限」がある',
  indexSrc.includes('インスペクションタイム制限') && indexSrc.includes('id="inspection-select"'));
check('警告色のCSSがある', indexSrc.includes('#timer-display.inspection-warning'));
check('グラフの頂点の丸（pointRadius: 2.5）が無くなっている', !statsSrc.includes('pointRadius: 2.5'));
check('履歴の詳細にインスペクション表示がある', statsSrc.includes('item.inspectionTime'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
