import { connectGanCube } from 'https://esm.sh/gan-web-bluetooth@3.0.2';

window.App = window.App || {};

// アプリのバージョン（日付＋同日内のリリース番号）。
// 更新のたびに上げ、画面上部と各ソルブの記録（appVersion）に残すことで、
// 「いま動いているのがどの版か」をスクショとバックアップの両方で
// 確認できるようにする
const APP_VERSION = '2026.11.20.1';

// DOM要素
const statusBox = document.getElementById('status-box');
const appVersionEl = document.getElementById('app-version');
if (appVersionEl) appVersionEl.textContent = `v${APP_VERSION}`;
const connectBtn = document.getElementById('connect-btn');
const resetBtn = document.getElementById('reset-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
const tabTimerBtn = document.getElementById('tab-timer');
const tabHistoryBtn = document.getElementById('tab-history');
const tabChartBtn = document.getElementById('tab-chart');
const tabAnalysisBtn = document.getElementById('tab-analysis');
const viewTimer = document.getElementById('view-timer');
const viewHistory = document.getElementById('view-history');
const viewChart = document.getElementById('view-chart');
const viewAnalysis = document.getElementById('view-analysis');

const scrambleMovesEl = document.getElementById('scramble-moves');
const correctionGuideEl = document.getElementById('correction-guide');
const cubeContainer = document.getElementById('cube-container');
const cube3d = document.getElementById('cube-3d');
const cubeOrientation = document.getElementById('cube-orientation');
const turnLayer = document.getElementById('turn-layer');
const timerStateEl = document.getElementById('timer-state');
const timerDisplayEl = document.getElementById('timer-display');
const totalStatsEl = document.getElementById('total-stats');
const gestureHintEl = document.getElementById('gesture-hint');
const cfopPanelEl = document.getElementById('cfop-panel');
const replayStartBtn = document.getElementById('replay-start-btn');
const deleteLastBtn = document.getElementById('delete-last-btn');
const nextScrambleBtn = document.getElementById('next-scramble-btn');

// アプリ状態
let cubeConnection = null;
let appState = 'SCRAMBLE';
let scrambleMoves = [];
let expectedStates = [];
let scrambleIndex = 0;
let halfTurnMove = null;
let isScrambleError = false;
let recoveryGuideText = '';

// ジェスチャー操作用
let gestureMove = null;
let gestureTime = 0;
let gestureInvalid = false;

// タイマー・記録用
let startTime = 0;
let timerInterval = null;
let solveStartState = null;
let solveTimeline = [];
let lastSolveData = null;

// 認識精度改善用（イベントのメタデータ追跡）
let lastMoveSerial = -1;      // 直近に処理したMOVEイベントのserial
let solveHadGap = false;      // ソルブ中にserialの欠落（取りこぼし）を検知したか
let solveRecoveredMoves = 0;  // 旧・FACELETS照合パッチ手数（廃止済み。記録形式の互換のため0で残す）
let lastMoveArrivalMs = 0;    // 最後の手が届いた時刻（アイドル検知用）
let lastFaceletsReqMs = 0;    // 最後にREQUEST_FACELETSを送った時刻
let lastAnimMs = 0;           // 最後に3Dアニメーションを実行した時刻
// FACELETSの「揃った」がMOVEイベントを追い越した場合の保留バッファ。
// null=非保留中。配列の間は「完成見込み」として終了を保留し、届いた手を
// ここに集める。集めた手で完成すれば記録に取り込み、完成しなければ
// （完成後の余計な手など）破棄してFACELETSの判定で終了する。
// 猶予の時計は「揃った」応答の時刻（solvedBufferAt）から数える。
// 以前は最後の手の到着時刻から数えていたため、応答時点で既に経過済みで
// 実質ほとんど待てていなかった（実測で末尾2手を取りこぼした）
let solvedBuffer = null;
let solvedBufferAt = 0;

// ==========================================
// タブ切り替え
// ==========================================
function switchTab(tab) {
  tabTimerBtn.classList.toggle('active', tab === 'timer');
  tabHistoryBtn.classList.toggle('active', tab === 'history');
  tabChartBtn.classList.toggle('active', tab === 'chart');
  tabAnalysisBtn.classList.toggle('active', tab === 'analysis');
  viewTimer.classList.toggle('active', tab === 'timer');
  viewHistory.classList.toggle('active', tab === 'history');
  viewChart.classList.toggle('active', tab === 'chart');
  viewAnalysis.classList.toggle('active', tab === 'analysis');

  if (tab === 'history') window.App.stats.renderHistoryView();
  if (tab === 'chart') window.App.stats.renderChartView();
  if (tab === 'analysis') window.App.stats.renderAnalysisView();
}

tabTimerBtn.addEventListener('click', () => switchTab('timer'));
tabHistoryBtn.addEventListener('click', () => switchTab('history'));
tabChartBtn.addEventListener('click', () => switchTab('chart'));
tabAnalysisBtn.addEventListener('click', () => switchTab('analysis'));

// ==========================================
// 歯車設定メニュー（接続／状態リセット／保存／復元／再解析）
// ==========================================
function closeSettingsMenu() {
  settingsMenu.style.display = 'none';
}

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsMenu.style.display = settingsMenu.style.display === 'none' ? 'flex' : 'none';
});

settingsMenu.addEventListener('click', () => {
  closeSettingsMenu();
});

document.addEventListener('click', (e) => {
  if (settingsMenu.style.display !== 'none' &&
      !settingsMenu.contains(e.target) && e.target !== settingsBtn) {
    closeSettingsMenu();
  }
});

// ==========================================
// 54ステッカー状態管理エンジン
// ==========================================
const COLORS = ['#ffffff', '#d50000', '#00c853', '#ffd600', '#ff6d00', '#2962ff'];
const FACE_NAMES = ['U', 'R', 'F', 'D', 'L', 'B'];
const OPPOSITE_FACE = [3, 4, 5, 0, 1, 2];
const ALL_MOVES = [
  'U', "U'", 'U2', 'D', "D'", 'D2',
  'R', "R'", 'R2', 'L', "L'", 'L2',
  'F', "F'", 'F2', 'B', "B'", 'B2'
];
let cubeState = new Uint8Array(54);

function resetStateArray(arr) {
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 9; i++) {
      arr[f * 9 + i] = f;
    }
  }
}

function statesEqual(a, b) {
  for (let i = 0; i < 54; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function rotateFaceCW(s, offset) {
  const t0 = s[offset], t1 = s[offset + 1], t2 = s[offset + 2];
  const t3 = s[offset + 3], t5 = s[offset + 5];
  const t6 = s[offset + 6], t7 = s[offset + 7], t8 = s[offset + 8];
  s[offset] = t6; s[offset + 1] = t3; s[offset + 2] = t0;
  s[offset + 3] = t7;                     s[offset + 5] = t1;
  s[offset + 6] = t8; s[offset + 7] = t5; s[offset + 8] = t2;
}

function cycle4(s, a, b, c, d) {
  for (let i = 0; i < 3; i++) {
    const tmp = s[d[i]];
    s[d[i]] = s[c[i]];
    s[c[i]] = s[b[i]];
    s[b[i]] = s[a[i]];
    s[a[i]] = tmp;
  }
}

function applyMoveCW(s, face) {
  switch (face) {
    case 'U': rotateFaceCW(s, 0); cycle4(s, [18, 19, 20], [36, 37, 38], [45, 46, 47], [9, 10, 11]); break;
    case 'R': rotateFaceCW(s, 9); cycle4(s, [20, 23, 26], [2, 5, 8], [51, 48, 45], [29, 32, 35]); break;
    case 'F': rotateFaceCW(s, 18); cycle4(s, [6, 7, 8], [9, 12, 15], [29, 28, 27], [44, 41, 38]); break;
    case 'D': rotateFaceCW(s, 27); cycle4(s, [24, 25, 26], [15, 16, 17], [51, 52, 53], [42, 43, 44]); break;
    case 'L': rotateFaceCW(s, 36); cycle4(s, [18, 21, 24], [27, 30, 33], [53, 50, 47], [0, 3, 6]); break;
    case 'B': rotateFaceCW(s, 45); cycle4(s, [2, 1, 0], [36, 39, 42], [33, 34, 35], [17, 14, 11]); break;
    case 'M': cycle4(s, [1, 4, 7], [19, 22, 25], [28, 31, 34], [52, 49, 46]); break;
    case 'E': cycle4(s, [21, 22, 23], [12, 13, 14], [48, 49, 50], [39, 40, 41]); break;
    case 'S': cycle4(s, [3, 4, 5], [10, 13, 16], [32, 31, 30], [43, 40, 37]); break;
    case 'x':
      applyMoveCW(s, 'R');
      applyMoveCW(s, 'M'); applyMoveCW(s, 'M'); applyMoveCW(s, 'M');
      applyMoveCW(s, 'L'); applyMoveCW(s, 'L'); applyMoveCW(s, 'L');
      break;
    case 'y':
      applyMoveCW(s, 'U');
      rotateFaceCW(s, 27); rotateFaceCW(s, 27); rotateFaceCW(s, 27);
      cycle4(s, [21, 22, 23], [39, 40, 41], [48, 49, 50], [12, 13, 14]);
      cycle4(s, [24, 25, 26], [42, 43, 44], [51, 52, 53], [15, 16, 17]);
      break;
    case 'z':
      applyMoveCW(s, 'F');
      rotateFaceCW(s, 45); rotateFaceCW(s, 45); rotateFaceCW(s, 45);
      cycle4(s, [3, 4, 5], [10, 13, 16], [32, 31, 30], [43, 40, 37]);
      cycle4(s, [0, 1, 2], [11, 14, 17], [35, 34, 33], [42, 39, 36]);
      break;
    case 'r':
      applyMoveCW(s, 'R');
      applyMoveCW(s, 'M'); applyMoveCW(s, 'M'); applyMoveCW(s, 'M');
      break;
    case 'f':
      applyMoveCW(s, 'z');
      applyMoveCW(s, 'B');
      break;
  }
}

function applyMoveToArray(s, move) {
  const face = move[0];
  if (move.endsWith("'")) {
    applyMoveCW(s, face); applyMoveCW(s, face); applyMoveCW(s, face);
  } else if (move.endsWith("2")) {
    applyMoveCW(s, face); applyMoveCW(s, face);
  } else {
    applyMoveCW(s, face);
  }
}

function isCubeSolvedArray(s) {
  for (let f = 0; f < 6; f++) {
    const base = f * 9;
    const color = s[base];
    for (let i = 1; i < 9; i++) {
      if (s[base + i] !== color) return false;
    }
  }
  return true;
}

function isFaceletsStringSolved(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return false;
  for (let f = 0; f < 6; f++) {
    const base = f * 9;
    const ch = facelets[base];
    for (let i = 1; i < 9; i++) {
      if (facelets[base + i] !== ch) return false;
    }
  }
  return true;
}

function findShortestRecovery(currentState, targetState) {
  if (statesEqual(currentState, targetState)) return [];
  const queue = [{ state: currentState, path: [], lastFace: '' }];
  const visited = new Set([currentState.join(',')]);
  let head = 0;
  while (head < queue.length) {
    const { state, path, lastFace } = queue[head++];
    if (path.length >= 3) continue;
    for (const move of ALL_MOVES) {
      const face = move[0];
      if (face === lastFace) continue;
      const nextState = new Uint8Array(state);
      applyMoveToArray(nextState, move);
      const nextPath = [...path, move];
      if (statesEqual(nextState, targetState)) return nextPath;
      if (nextPath.length < 3) {
        const key = nextState.join(',');
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ state: nextState, path: nextPath, lastFace: face });
        }
      }
    }
  }
  return null;
}

// FACELETSイベントの文字列（Kociemba表記）を内部の54ステッカー配列へ変換する
const FACELET_FACES = 'URFDLB';
function faceletsToState(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) return null;
  const a = new Uint8Array(54);
  for (let i = 0; i < 54; i++) {
    const v = FACELET_FACES.indexOf(facelets[i]);
    if (v < 0) return null;
    a[i] = v;
  }
  return a;
}

function getInverseMove(move) {
  if (move.endsWith("'")) return move.slice(0, -1);
  if (move.endsWith("2")) return move;
  return move + "'";
}

// 双方向BFSで currentState から targetState への最短手順を探す（最大 maxDepth 手）
// 見つからなければ null。取りこぼした手の補完用。
function findRecoveryPath(currentState, targetState, maxDepth = 6) {
  if (statesEqual(currentState, targetState)) return [];
  const keyOf = (s) => Array.from(s).join('');
  let fwd = new Map([[keyOf(currentState), { state: new Uint8Array(currentState), path: [] }]]);
  let bwd = new Map([[keyOf(targetState), { state: new Uint8Array(targetState), path: [] }]]);
  let fwdDepth = 0;
  let bwdDepth = 0;

  const expandFwd = () => {
    const next = new Map();
    for (const { state, path } of fwd.values()) {
      const lastFace = path.length > 0 ? path[path.length - 1][0] : '';
      for (const move of ALL_MOVES) {
        if (move[0] === lastFace) continue;
        const ns = new Uint8Array(state);
        applyMoveToArray(ns, move);
        const k = keyOf(ns);
        if (!next.has(k)) next.set(k, { state: ns, path: [...path, move] });
      }
    }
    fwd = next;
    fwdDepth++;
  };

  const expandBwd = () => {
    const next = new Map();
    for (const { state, path } of bwd.values()) {
      const firstFace = path.length > 0 ? path[0][0] : '';
      for (const move of ALL_MOVES) {
        if (move[0] === firstFace) continue;
        const ns = new Uint8Array(state);
        applyMoveToArray(ns, getInverseMove(move));
        const k = keyOf(ns);
        if (!next.has(k)) next.set(k, { state: ns, path: [move, ...path] });
      }
    }
    bwd = next;
    bwdDepth++;
  };

  const tryMeet = () => {
    for (const [k, f] of fwd) {
      const b = bwd.get(k);
      if (b) return [...f.path, ...b.path];
    }
    return null;
  };

  while (fwdDepth + bwdDepth < maxDepth) {
    if (fwd.size <= bwd.size) expandFwd(); else expandBwd();
    const met = tryMeet();
    if (met) return met;
    if (fwd.size === 0 || bwd.size === 0) return null;
  }
  return null;
}

// キューブ内蔵時計（cubeTimestamp）をホスト時刻（localTimestamp）へ線形フィットし、
// タイムライン各手の補正済み時刻（ms・初手を0）を返す。材料不足なら null。
// 到着がバッチ化しても、キューブ時刻ベースなら手ごとの間隔が復元できる。
function fitTimelineTimes(entries) {
  const n = entries.length;
  if (n === 0) return null;
  const cube = entries.map((e) => (typeof e.cubeTimestamp === 'number' ? e.cubeTimestamp : null));

  // cubeTimestamp の欠けを前後から線形補間する
  for (let i = 0; i < n; i++) {
    if (cube[i] !== null) continue;
    let prev = i - 1;
    while (prev >= 0 && cube[prev] === null) prev--;
    let next = i + 1;
    while (next < n && cube[next] === null) next++;
    if (prev >= 0 && next < n) {
      cube[i] = cube[prev] + (cube[next] - cube[prev]) * ((i - prev) / (next - prev));
    } else if (prev >= 0) {
      cube[i] = cube[prev] + 50 * (i - prev);
    } else if (next < n) {
      cube[i] = cube[next] - 50 * (next - i);
    }
  }
  if (cube[0] === null) return null;

  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (typeof entries[i].localTimestamp === 'number') pairs.push([cube[i], entries[i].localTimestamp]);
  }
  if (pairs.length < 2) return null;

  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const m = pairs.length;
  for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const denom = m * sxx - sx * sx;
  const a = Math.abs(denom) < 1e-9 ? 1 : (m * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / m;
  if (!(a > 0.5 && a < 2)) return null; // 傾きが異常なら採用しない

  const base = a * cube[0] + b;
  const fitted = cube.map((c) => Math.max(0, Math.round(a * c + b - base)));
  for (let i = 1; i < n; i++) {
    if (fitted[i] < fitted[i - 1]) fitted[i] = fitted[i - 1]; // 単調性を保証
  }
  return fitted;
}

function countHTM(moves) {
  const stack = [];
  for (const m of moves) {
    if (!m) continue;
    const face = m[0];
    const amt = m.endsWith("'") ? 3 : m.endsWith("2") ? 2 : 1;
    if (stack.length > 0 && stack[stack.length - 1].face === face) {
      const combined = (stack[stack.length - 1].amt + amt) % 4;
      if (combined === 0) stack.pop();
      else stack[stack.length - 1].amt = combined;
    } else {
      stack.push({ face, amt });
    }
  }
  return stack.length;
}

function calcTPS(movesCount, timeSec) {
  if (timeSec <= 0.005) return 0;
  return parseFloat((movesCount / timeSec).toFixed(2));
}

// ==========================================
// 27キュービー 3Dパーツ回転アニメーション（インスタンス化）
// ==========================================
function createCube3DInstance(containerEl, cube3dEl, orientationEl, turnLayerEl) {
  const CUBIE_SIZE = 36;
  const cubies = [];
  let animTimeout = null;
  let rotX = -25;
  let rotY = -35;
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const el = document.createElement('div');
        el.className = 'cubie';
        el.style.transform = `translate3d(${x * CUBIE_SIZE}px, ${y * CUBIE_SIZE}px, ${z * CUBIE_SIZE}px)`;

        const faces = {};
        ['U', 'R', 'F', 'D', 'L', 'B'].forEach((dir) => {
          const f = document.createElement('div');
          f.className = `cubie-face cf-${dir}`;
          el.appendChild(f);
          faces[dir] = f;
        });

        orientationEl.appendChild(el);
        cubies.push({ el, x, y, z, faces });
      }
    }
  }

  function syncColors(stateArray) {
    cubies.forEach(({ x, y, z, faces }) => {
      faces.U.style.backgroundColor = y === -1 ? COLORS[stateArray[0 + (z + 1) * 3 + (x + 1)]] : '#111';
      faces.D.style.backgroundColor = y === 1 ? COLORS[stateArray[27 + (1 - z) * 3 + (x + 1)]] : '#111';
      faces.F.style.backgroundColor = z === 1 ? COLORS[stateArray[18 + (y + 1) * 3 + (x + 1)]] : '#111';
      faces.B.style.backgroundColor = z === -1 ? COLORS[stateArray[45 + (y + 1) * 3 + (1 - x)]] : '#111';
      faces.R.style.backgroundColor = x === 1 ? COLORS[stateArray[9 + (y + 1) * 3 + (1 - z)]] : '#111';
      faces.L.style.backgroundColor = x === -1 ? COLORS[stateArray[36 + (y + 1) * 3 + (z + 1)]] : '#111';
    });
  }

  function finishAnimationNow(stateArray) {
    if (animTimeout !== null) {
      clearTimeout(animTimeout);
      animTimeout = null;
    }
    turnLayerEl.style.transition = 'none';
    turnLayerEl.style.transform = 'none';
    while (turnLayerEl.firstChild) {
      orientationEl.appendChild(turnLayerEl.firstChild);
    }
    if (stateArray) syncColors(stateArray);
  }

  // 高速連打時用：アニメーションを省略し、色の同期だけをrAFで間引いて行う
  let rafSyncId = null;
  let rafSyncState = null;
  function fastSync(stateArray) {
    if (animTimeout !== null) {
      clearTimeout(animTimeout);
      animTimeout = null;
    }
    turnLayerEl.style.transition = 'none';
    turnLayerEl.style.transform = 'none';
    while (turnLayerEl.firstChild) {
      orientationEl.appendChild(turnLayerEl.firstChild);
    }
    rafSyncState = stateArray;
    if (rafSyncId === null) {
      rafSyncId = requestAnimationFrame(() => {
        rafSyncId = null;
        if (rafSyncState) syncColors(rafSyncState);
        rafSyncState = null;
      });
    }
  }

  function animateMove(move, stateArray, durationMs = 70) {
    finishAnimationNow(stateArray);
    if (!move) return;

    const face = move[0];
    const isPrime = move.endsWith("'");
    const isDouble = move.endsWith("2");
    const angle = isDouble ? 180 : (isPrime ? 90 : -90);

    let filterFn;
    let transformStr = '';

    switch (face) {
      case 'U': filterFn = (c) => c.y === -1; transformStr = `rotateY(${angle}deg)`; break;
      case 'D': filterFn = (c) => c.y === 1; transformStr = `rotateY(${-angle}deg)`; break;
      case 'R': filterFn = (c) => c.x === 1; transformStr = `rotateX(${-angle}deg)`; break;
      case 'L': filterFn = (c) => c.x === -1; transformStr = `rotateX(${angle}deg)`; break;
      case 'F': filterFn = (c) => c.z === 1; transformStr = `rotateZ(${-angle}deg)`; break;
      case 'B': filterFn = (c) => c.z === -1; transformStr = `rotateZ(${angle}deg)`; break;
      case 'M': filterFn = (c) => c.x === 0; transformStr = `rotateX(${angle}deg)`; break;
      case 'E': filterFn = (c) => c.y === 0; transformStr = `rotateY(${-angle}deg)`; break;
      case 'S': filterFn = (c) => c.z === 0; transformStr = `rotateZ(${-angle}deg)`; break;
      default: return;
    }

    cubies.filter(filterFn).forEach((c) => turnLayerEl.appendChild(c.el));
    void turnLayerEl.offsetWidth;
    turnLayerEl.style.transition = `transform ${durationMs}ms ease-out`;
    turnLayerEl.style.transform = transformStr;

    animTimeout = setTimeout(() => {
      finishAnimationNow(stateArray);
    }, durationMs + 5);
  }

  function resetAngle() {
    rotX = -25;
    rotY = -35;
    cube3dEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  function setCrossOrientation(crossFace) {
    let transform = 'none';
    switch (crossFace) {
      case 'U': transform = 'rotateX(180deg)'; break;
      case 'F': transform = 'rotateX(-90deg)'; break;
      case 'B': transform = 'rotateX(90deg)'; break;
      case 'R': transform = 'rotateZ(90deg)'; break;
      case 'L': transform = 'rotateZ(-90deg)'; break;
      case 'D': default: transform = 'none'; break;
    }
    orientationEl.style.transform = transform;
    resetAngle();
  }

  containerEl.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    rotY += dx * 0.6;
    rotX -= dy * 0.6;
    cube3dEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
  });

  return {
    syncColors,
    finishAnimationNow,
    fastSync,
    animateMove,
    resetAngle,
    setCrossOrientation
  };
}

const timerCube3D = createCube3DInstance(cubeContainer, cube3d, cubeOrientation, turnLayer);

// ==========================================
// メインロジック
// ==========================================
function resetCubeState() {
  resetStateArray(cubeState);
  timerCube3D.finishAnimationNow(cubeState);
  timerCube3D.resetAngle();
}

function generateNewScramble() {
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
  const modifiers = ['', "'", '2'];
  const axis = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 };

  const moves = [];
  let lastFace = '';
  let secondLastFace = '';

  while (moves.length < 20) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    if (face === lastFace) continue;
    if (secondLastFace && axis[face] === axis[lastFace] && face === secondLastFace) continue;

    const mod = modifiers[Math.floor(Math.random() * modifiers.length)];
    moves.push(face + mod);
    secondLastFace = lastFace;
    lastFace = face;
  }

  scrambleMoves = moves;
  scrambleIndex = 0;
  halfTurnMove = null;
  isScrambleError = false;
  recoveryGuideText = '';
  solveHadGap = false;
  solveRecoveredMoves = 0;

  gestureMove = null;
  gestureInvalid = false;

  expectedStates = [new Uint8Array(cubeState)];
  let simState = new Uint8Array(cubeState);
  for (const m of scrambleMoves) {
    applyMoveToArray(simState, m);
    expectedStates.push(new Uint8Array(simState));
  }

  cfopPanelEl.style.display = 'none';
  totalStatsEl.style.display = 'none';
  replayStartBtn.style.display = 'none';
  deleteLastBtn.style.display = 'none';
  gestureHintEl.style.display = 'none';
  setAppState('SCRAMBLE');
  stopTimer();
  timerDisplayEl.textContent = '0.00';
  renderScramble();
}

function renderScramble() {
  scrambleMovesEl.innerHTML = '';
  scrambleMoves.forEach((move, idx) => {
    const span = document.createElement('span');
    span.className = 's-move';
    span.textContent = move;
    if (idx < scrambleIndex) {
      span.classList.add('done');
    } else if (idx === scrambleIndex && !isScrambleError) {
      span.classList.add('current');
    }
    scrambleMovesEl.appendChild(span);
  });

  correctionGuideEl.textContent = isScrambleError ? recoveryGuideText : '';
}

function setAppState(newState) {
  appState = newState;
  timerStateEl.textContent = newState;
  timerStateEl.className = '';
  if (newState === 'READY') timerStateEl.classList.add('state-ready');
  if (newState === 'SOLVING') timerStateEl.classList.add('state-solving');
  if (newState === 'SOLVED') timerStateEl.classList.add('state-solved');
}

function startTimer() {
  startTime = performance.now();
  timerInterval = setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    timerDisplayEl.textContent = elapsed.toFixed(2);
  }, 10);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// 3D表示：ソルブ中の高速連打ではアニメーションを省略して色同期だけにする
function renderMove(move) {
  const now = performance.now();
  if (appState === 'SOLVING' && now - lastAnimMs < 80) {
    timerCube3D.fastSync(cubeState);
  } else {
    lastAnimMs = now;
    timerCube3D.animateMove(move, cubeState);
  }
}

function handleMove(move, ev) {
  if (window.App.replay.isReplayOpen()) return;

  const nowMs = performance.now();
  const wasSolvedBefore = isCubeSolvedArray(cubeState);
  lastMoveArrivalMs = nowMs;

  // イベントのメタデータ（キューブ時刻・serial）を取り込む
  const meta = {
    cubeTimestamp: ev && typeof ev.cubeTimestamp === 'number' ? ev.cubeTimestamp : null,
    localTimestamp: ev && typeof ev.localTimestamp === 'number' ? ev.localTimestamp : null,
    serial: ev && typeof ev.serial === 'number' ? ev.serial : null
  };
  if (meta.serial !== null) {
    if (lastMoveSerial !== -1 && appState === 'SOLVING' &&
        meta.serial !== ((lastMoveSerial + 1) & 0xFF)) {
      solveHadGap = true; // MOVEのserialが飛んだ＝ライブラリ側でも復元しきれなかった手がある
    }
    lastMoveSerial = meta.serial;
  }

  if (appState === 'READY') {
    solveStartState = new Uint8Array(cubeState);
    solveHadGap = false;
    solveRecoveredMoves = 0;
    solvedBuffer = null;
    lastAnimMs = 0;
    applyMoveToArray(cubeState, move);
    solveTimeline = [{ move, time: 0, timeMs: nowMs, ...meta }];
    setAppState('SOLVING');
    startTimer();
    checkSolved();
    renderMove(move);
    return;
  }

  applyMoveToArray(cubeState, move);

  if (appState === 'SOLVED') {
    renderMove(move);

    if (gestureMove === null) {
      if (wasSolvedBefore && !gestureInvalid) {
        gestureMove = move;
        gestureTime = nowMs;
      }
    } else {
      const elapsed = nowMs - gestureTime;
      if (!gestureInvalid && elapsed <= 2000 && move === getInverseMove(gestureMove)) {
        gestureMove = null;
        generateNewScramble();
        return;
      } else {
        gestureMove = null;
        gestureInvalid = true;
      }
    }

    if (isCubeSolvedArray(cubeState)) {
      gestureInvalid = false;
    }
    return;
  }

  if (appState === 'SOLVING') {
    if (solvedBuffer !== null) {
      // 「揃った」信号に追い越された可能性のある手：まず保留バッファへ。
      // cubeState には既に適用済みなので、完成したかどうかで振り分ける
      solvedBuffer.push({ move, nowMs, meta });
      if (isCubeSolvedArray(cubeState)) {
        // 遅れて届いた手で完成した：バッファを正規の記録として取り込む
        for (const b of solvedBuffer) {
          const bElapsed = (b.nowMs - startTime) / 1000;
          solveTimeline.push({ move: b.move, time: bElapsed, timeMs: b.nowMs, ...b.meta });
        }
        solvedBuffer = null;
        checkSolved();
      } else if (solvedBuffer.length >= 12) {
        // 完成しない手が続く場合は完成後の余計な手とみなし、破棄して
        // FACELETSの「揃った」判定で終了する
        solvedBuffer = null;
        const fallbackTime = parseFloat(((nowMs - startTime) / 1000).toFixed(2));
        finalizeSolve(fallbackTime);
      }
    } else {
      const elapsed = (nowMs - startTime) / 1000;
      solveTimeline.push({ move, time: elapsed, timeMs: nowMs, ...meta });
      checkSolved();
    }
  } else if (appState === 'SCRAMBLE') {
    let matchedIdx = -1;
    for (let i = expectedStates.length - 1; i >= 0; i--) {
      if (statesEqual(cubeState, expectedStates[i])) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx !== -1) {
      scrambleIndex = matchedIdx;
      halfTurnMove = null;
      isScrambleError = false;
      recoveryGuideText = '';
      if (scrambleIndex >= scrambleMoves.length) {
        setAppState('READY');
      }
    } else {
      const expectedMove = scrambleMoves[scrambleIndex];
      if (!isScrambleError && expectedMove && expectedMove.endsWith('2') && halfTurnMove === null && (move === expectedMove[0] || move === expectedMove[0] + "'")) {
        halfTurnMove = move;
      } else {
        halfTurnMove = null;
        isScrambleError = true;
        const path = findShortestRecovery(cubeState, expectedStates[scrambleIndex]);
        if (path && path.length > 0) {
          recoveryGuideText = `間違い！戻してください → ${path.join(' ')}`;
        } else {
          recoveryGuideText = '大きくズレました（状態リセット推奨）';
        }
      }
    }
    renderScramble();
  }

  renderMove(move);
}

function finalizeSolve(fallbackTimeSec) {
  stopTimer();
  solvedBuffer = null;
  solvedBufferAt = 0;
  setAppState('SOLVED');

  gestureMove = null;
  gestureInvalid = false;
  gestureHintEl.style.display = 'block';

  // キューブ内蔵時計でタイムラインの時刻を再構築する（到着バッチ化の影響を受けない）
  const fittedMs = fitTimelineTimes(solveTimeline);
  const t0 = solveTimeline.length > 0 ? solveTimeline[0].timeMs : 0;
  const rawMovesSnapshot = solveTimeline.map((s, i) => {
    const relMs = fittedMs ? fittedMs[i] : Math.round(s.timeMs - t0);
    const entry = {
      move: s.move,
      time: parseFloat((relMs / 1000).toFixed(3)),
      timeMs: relMs,
      cubeTimestamp: typeof s.cubeTimestamp === 'number' ? s.cubeTimestamp : null,
      localTimestamp: typeof s.localTimestamp === 'number' ? s.localTimestamp : null,
      serial: typeof s.serial === 'number' ? s.serial : null,
      arrivalTimeMs: s.timeMs
    };
    if (s.recovered) entry.recovered = true;
    return entry;
  });

  const { postProcessSolve } = window.App.cfop;
  const result = postProcessSolve(rawMovesSnapshot, solveStartState, fallbackTimeSec);

  timerDisplayEl.textContent = result.trueTime.toFixed(2);

  const cleanedMoves = result.cleanedTimeline.map((s) => s.move);
  lastSolveData = window.App.stats.saveSolve(
    result.trueTime,
    scrambleMoves.join(' '),
    cleanedMoves,
    result.cleanedTimeline,
    result.cfop,
    rawMovesSnapshot,
    { hadMoveGap: solveHadGap, recoveredMoves: solveRecoveredMoves, sliceFusions: result.sliceFusions, tailRecoveredMoves: result.tailRecoveredMoves || 0 }
  );

  // 記録された手を再生しても完成しない場合は、誤った分割を出さず「分析不可」と表示する
  if (lastSolveData && lastSolveData.isSolvedComplete === false) {
    window.App.cfop.renderAnalysisUnavailable();
  } else {
    window.App.cfop.renderCFOP(result.cfop);
  }

  replayStartBtn.style.display = 'block';
  deleteLastBtn.style.display = 'block';
}

function checkSolved() {
  if (isCubeSolvedArray(cubeState)) {
    const fallbackTime = parseFloat(((performance.now() - startTime) / 1000).toFixed(2));
    finalizeSolve(fallbackTime);
  }
}

// FACELETSイベントによる状態照合：取りこぼした手の検知
// ※ソルブ中のズレを検知しても、記録（solveTimeline）へは絶対に手を
// 書き込まない。以前はBFSで求めたパッチ手を挿入していたが、古い・
// ズレたFACELETSをもとに計算すると実在しない手が記録に入り、その
// ソルブが丸ごと分析不可になる事故が多発した（2026-11-19の実測で、
// パッチが発動した記録は全て分析不可だった）。ここでは表示用の状態
// だけを実状態に同期し、ズレがあった事実を solveHadGap に残す。
// 欠けた手の扱いは解析側（末尾補完・分析不可表示）に任せる。
function handleFaceletsEvent(event) {
  const realState = faceletsToState(event.facelets);
  if (!realState) return;

  if (appState === 'SOLVING') {
    if (isFaceletsStringSolved(event.facelets)) {
      // 「揃った」信号が最後の数手の「動いた」信号を追い越すことがある
      // （実測：末尾3手が未記録のまま終了した）。即終了せず保留バッファを
      // 開き、遅れて届く手を待つ。手で完成すればそちらで終了し、手が
      // 来なければアイドル検知側がこの判定で終了させる
      if (solvedBuffer === null) {
        solvedBuffer = [];
        solvedBufferAt = performance.now();
      }
      return;
    }
    // 保留中は照合しない（届きつつある手と二重にずれるのを避ける）
    if (solvedBuffer !== null) return;
    if (statesEqual(realState, cubeState)) return;

    // まだ届いていない手が混ざっている可能性がある間は判定しない
    // （serialが一致している＝同じ状態のはず、または手の流れが止まって落ち着いた場合のみ）
    const serialSynced = typeof event.serial !== 'number' || lastMoveSerial === -1 ||
      ((event.serial - lastMoveSerial) & 0xFF) === 0;
    const settled = performance.now() - lastMoveArrivalMs > 250;
    if (!serialSynced && !settled) return;

    // ズレを検知：記録には触らず、表示状態だけ実状態に同期する
    solveHadGap = true;
    cubeState.set(realState);
    if (typeof event.serial === 'number') lastMoveSerial = event.serial;
    timerCube3D.finishAnimationNow(cubeState);
  } else if (appState === 'SCRAMBLE' || appState === 'READY') {
    // スクランブル中に手が欠けていた場合は、実状態に同期して照合し直す
    if (!statesEqual(realState, cubeState)) {
      cubeState.set(realState);
      let matchedIdx = -1;
      for (let i = expectedStates.length - 1; i >= 0; i--) {
        if (statesEqual(cubeState, expectedStates[i])) { matchedIdx = i; break; }
      }
      if (matchedIdx !== -1) {
        scrambleIndex = matchedIdx;
        halfTurnMove = null;
        isScrambleError = false;
        recoveryGuideText = '';
        if (scrambleIndex >= scrambleMoves.length) setAppState('READY');
        else if (appState === 'READY') setAppState('SCRAMBLE');
        renderScramble();
        timerCube3D.finishAnimationNow(cubeState);
      }
    }
  }
}

resetBtn.addEventListener('click', () => {
  resetCubeState();
});

nextScrambleBtn.addEventListener('click', () => {
  generateNewScramble();
});

replayStartBtn.addEventListener('click', () => {
  if (lastSolveData) window.App.replay.startReplay(lastSolveData, 'timer');
});

deleteLastBtn.addEventListener('click', () => {
  if (!lastSolveData) return;
  if (confirm('直前の記録を削除します。よろしいですか？')) {
    const updated = window.App.stats.getHistory().filter((h) => h.id !== lastSolveData.id);
    window.App.stats.saveHistoryWithCleanup(updated);
    lastSolveData = null;
    generateNewScramble();
  }
});

function updateStatus(text, type) {
  statusBox.textContent = text;
  statusBox.className = `status-badge status-${type}`;
}

connectBtn.addEventListener('click', async () => {
  if (cubeConnection) {
    try { await cubeConnection.disconnect(); } catch (e) {}
    cubeConnection = null;
    updateStatus('未接続', 'disconnected');
    connectBtn.textContent = '接続';
    connectBtn.classList.remove('btn-disconnect');
    return;
  }

  if (!navigator.bluetooth) {
    updateStatus('Web Bluetooth非対応', 'error');
    return;
  }

  try {
    updateStatus('接続中...', 'connecting');
    connectBtn.disabled = true;

    cubeConnection = await connectGanCube();
    updateStatus(`接続済: ${cubeConnection.deviceName || 'GAN'}`, 'connected');
    connectBtn.textContent = '切断';
    connectBtn.classList.add('btn-disconnect');
    connectBtn.disabled = false;

    lastMoveSerial = -1;
    cubeConnection.events$.subscribe((event) => {
      if (event.type === 'MOVE') {
        handleMove(event.move, event);
      } else if (event.type === 'FACELETS') {
        handleFaceletsEvent(event);
      } else if (event.type === 'DISCONNECT') {
        cubeConnection = null;
        lastMoveSerial = -1;
        updateStatus('切断されました', 'disconnected');
        connectBtn.textContent = '接続';
        connectBtn.classList.remove('btn-disconnect');
      }
    });
  } catch (err) {
    cubeConnection = null;
    updateStatus(`エラー: ${err.message || err}`, 'error');
    connectBtn.textContent = '接続';
    connectBtn.classList.remove('btn-disconnect');
    connectBtn.disabled = false;
  }
});

// ソルブ中に手が止まったらFACELETSを要求して、状態照合（取りこぼし補完）の機会を作る
setInterval(() => {
  if (!cubeConnection) return;
  if (appState !== 'SOLVING') return;
  const now = performance.now();
  // 「揃った」保留中：応答から500ms以上が経ち、かつ手の流れが300ms
  // 止まったら、保留した手は完成に寄与しなかった（または手自体が
  // 来なかった）ものとして破棄し、FACELETSの「揃った」判定で終了する
  if (solvedBuffer !== null && now - solvedBufferAt >= 500 && now - lastMoveArrivalMs > 300) {
    solvedBuffer = null;
    const fallbackTime = parseFloat(((now - startTime) / 1000).toFixed(2));
    finalizeSolve(fallbackTime);
    return;
  }
  if (now - lastMoveArrivalMs > 300 && now - lastFaceletsReqMs > 1000) {
    lastFaceletsReqMs = now;
    cubeConnection.sendCubeCommand({ type: 'REQUEST_FACELETS' }).catch(() => {});
  }
}, 200);

// 公開API
window.App.cube = {
  APP_VERSION,
  FACE_NAMES,
  OPPOSITE_FACE,
  resetStateArray,
  applyMoveCW,
  applyMoveToArray,
  isCubeSolvedArray,
  countHTM,
  calcTPS,
  getInverseMove,
  faceletsToState,
  findRecoveryPath,
  fitTimelineTimes,
  createCube3DInstance,
  switchTab
};

// 初期化
resetCubeState();
window.App.stats.updateSolveCount();
window.App.stats.updateTimerStatsPanel();
generateNewScramble();