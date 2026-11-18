import { connectGanCube } from 'https://esm.sh/gan-web-bluetooth';

window.App = window.App || {};

// DOM要素
const statusBox = document.getElementById('status-box');
const connectBtn = document.getElementById('connect-btn');
const resetBtn = document.getElementById('reset-btn');
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

// ==========================================
// デバッグログ（画面下に表示。確認が終わったら消してOK）
// ==========================================
const debugBox = document.createElement('div');
debugBox.id = 'debug-log';
debugBox.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:110px;overflow-y:auto;background:rgba(0,0,0,0.85);color:#9f9;font:11px monospace;padding:4px 6px;z-index:999;pointer-events:none;';
document.body.appendChild(debugBox);

const debugLines = [];
function debugLog(text) {
  debugLines.push(text);
  if (debugLines.length > 40) debugLines.shift();
  debugBox.textContent = debugLines.join('\n');
  debugBox.scrollTop = debugBox.scrollHeight;
  console.log(text);
}

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

// ==========================================
// 手順の受け取り：連番(serial)で並べ直してから反映する
// ==========================================
const REORDER_WAIT_MS = 80;     // 遅れて届く手順を待つ時間（ms。後で調整）
const STATE_HISTORY_LIMIT = 64; // 連番ごとの盤面を何件まで残すか
let lastAppliedSerial = null;   // 最後に盤面へ反映した連番
let moveQueue = [];             // 届いたけど、まだ反映していない手順
let flushTimerId = null;
const stateBySerial = new Map(); // 連番 → その手順を反映した直後の盤面
let pendingFacelets = null;      // 盤面の保存待ちのFACELETS
let faceletsLogged = false;      // FACELETS文字列を一度だけログに出すためのフラグ

// 連番の差（0〜255の円として計算）。aがbより何手後かを返す
function serialGap(a, b) {
  return (a - b + 256) % 256;
}

function resetMoveSync() {
  lastAppliedSerial = null;
  moveQueue = [];
  stateBySerial.clear();
  pendingFacelets = null;
  if (flushTimerId !== null) {
    clearTimeout(flushTimerId);
    flushTimerId = null;
  }
}

function enqueueMove(event, arrivedMs) {
  moveQueue.push({
    move: event.move,
    serial: event.serial,
    cubeTs: event.timestamp ?? null,
    arrivedMs
  });
  if (flushTimerId === null) {
    flushTimerId = setTimeout(flushMoveQueue, REORDER_WAIT_MS);
  }
}

function flushMoveQueue() {
  flushTimerId = null;
  if (moveQueue.length === 0) return;

  // 次に来るべき連番を基準に、近い順へ並べ替える
  const base = lastAppliedSerial === null
    ? moveQueue[0].serial
    : (lastAppliedSerial + 1) % 256;
  moveQueue.sort((a, b) => serialGap(a.serial, base) - serialGap(b.serial, base));

  for (const item of moveQueue) {
    if (lastAppliedSerial !== null) {
      const gap = serialGap(item.serial, lastAppliedSerial);
      if (gap === 0) {
        debugLog(`重複を無視 serial=${item.serial}`);
        continue;
      }
      if (gap > 128) {
        debugLog(`古い手順を無視 serial=${item.serial}（前回=${lastAppliedSerial}）`);
        continue;
      }
      if (gap > 1) {
        debugLog(`欠け検出: ${lastAppliedSerial} → ${item.serial}（${gap - 1}手分）`);
      }
    }
    lastAppliedSerial = item.serial;
    debugLog(`手順 ${item.move} serial=${item.serial} cubeTs=${item.cubeTs}`);
    handleMove(item.move, item.arrivedMs);

    // この連番の時点の盤面を保存（全面の色との比較に使う）
    stateBySerial.set(item.serial, new Uint8Array(cubeState));
    const oldSerial = (item.serial - STATE_HISTORY_LIMIT + 256) % 256;
    stateBySerial.delete(oldSerial);
  }
  moveQueue = [];
  tryComparePending();
}

// ==========================================
// FACELETS（全面の色）と盤面の比較（今はログ表示のみ）
// ==========================================
const FACE_LETTER_TO_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

function faceletsToState(facelets) {
  const s = new Uint8Array(54);
  for (let i = 0; i < 54; i++) {
    s[i] = FACE_LETTER_TO_INDEX[facelets[i]];
  }
  return s;
}

function handleFacelets(event) {
  if (typeof event.facelets !== 'string' || event.facelets.length !== 54) return;

  if (!faceletsLogged) {
    debugLog(`FACELETS文字列: ${event.facelets}`);
    faceletsLogged = true;
  }

  pendingFacelets = { serial: event.serial, facelets: event.facelets, since: performance.now() };
  tryComparePending();
}

function tryComparePending() {
  if (!pendingFacelets) return;
  const { serial, facelets, since } = pendingFacelets;

  const past = stateBySerial.get(serial);
  if (!past) {
    // まだ盤面が保存されていない → 1秒以上待っても来なければ破棄
    if (performance.now() - since > 1000) {
      debugLog(`FACELETS serial=${serial} 1秒待っても記録なし（破棄）`);
      pendingFacelets = null;
    }
    return;
  }

  pendingFacelets = null;
  const target = faceletsToState(facelets);
  const diffIdx = [];
  for (let i = 0; i < 54; i++) {
    if (target[i] !== past[i]) diffIdx.push(i);
  }
  debugLog(`FACELETS serial=${serial} 盤面ずれ=${diffIdx.length}マス`);
  if (diffIdx.length > 0) {
    debugLog(`ずれの位置: ${diffIdx.join(',')}`);
  }
}

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

function getInverseMove(move) {
  if (move.endsWith("'")) return move.slice(0, -1);
  if (move.endsWith("2")) return move;
  return move + "'";
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

// atMs: 手順が届いた時刻（時間計測に使う）
function handleMove(move, atMs = performance.now()) {
  if (window.App.replay.isReplayOpen()) return;

  const nowMs = atMs;
  const wasSolvedBefore = isCubeSolvedArray(cubeState);

  if (appState === 'READY') {
    solveStartState = new Uint8Array(cubeState);
    applyMoveToArray(cubeState, move);
    solveTimeline = [{ move, time: 0, timeMs: nowMs }];
    setAppState('SOLVING');
    startTimer();
    checkSolved();
    timerCube3D.animateMove(move, cubeState);
    return;
  }

  applyMoveToArray(cubeState, move);

  if (appState === 'SOLVED') {
    timerCube3D.animateMove(move, cubeState);

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
    const elapsed = (nowMs - startTime) / 1000;
    solveTimeline.push({ move, time: elapsed, timeMs: nowMs });
    checkSolved();
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

  timerCube3D.animateMove(move, cubeState);
}

function finalizeSolve(fallbackTimeSec) {
  stopTimer();
  setAppState('SOLVED');

  gestureMove = null;
  gestureInvalid = false;
  gestureHintEl.style.display = 'block';

  const rawMovesSnapshot = solveTimeline.map((s) => ({
    move: s.move,
    time: parseFloat(s.time.toFixed(2)),
    timeMs: s.timeMs
  }));

  const { postProcessSolve } = window.App.cfop;
  const result = postProcessSolve(rawMovesSnapshot, solveStartState, fallbackTimeSec);

  timerDisplayEl.textContent = result.trueTime.toFixed(2);
  window.App.cfop.renderCFOP(result.cfop);

  const cleanedMoves = result.cleanedTimeline.map((s) => s.move);
  lastSolveData = window.App.stats.saveSolve(
    result.trueTime,
    scrambleMoves.join(' '),
    cleanedMoves,
    result.cleanedTimeline,
    result.cfop,
    rawMovesSnapshot
  );

  replayStartBtn.style.display = 'block';
  deleteLastBtn.style.display = 'block';
}

function checkSolved() {
  if (isCubeSolvedArray(cubeState)) {
    const fallbackTime = parseFloat(((performance.now() - startTime) / 1000).toFixed(2));
    finalizeSolve(fallbackTime);
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
    resetMoveSync();
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
    resetMoveSync();
    updateStatus(`接続済: ${cubeConnection.deviceName || 'GAN'}`, 'connected');
    connectBtn.textContent = '切断';
    connectBtn.classList.add('btn-disconnect');
    connectBtn.disabled = false;

    cubeConnection.events$.subscribe((event) => {
      const arrivedMs = performance.now();

      if (event.type === 'MOVE') {
        enqueueMove(event, arrivedMs);
      } else if (event.type === 'FACELETS') {
        handleFacelets(event);
        if (appState === 'SOLVING' && isFaceletsStringSolved(event.facelets)) {
          const fallbackTime = parseFloat(((arrivedMs - startTime) / 1000).toFixed(2));
          finalizeSolve(fallbackTime);
        }
      } else if (event.type === 'DISCONNECT') {
        cubeConnection = null;
        resetMoveSync();
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

// 公開API
window.App.cube = {
  FACE_NAMES,
  OPPOSITE_FACE,
  resetStateArray,
  applyMoveCW,
  applyMoveToArray,
  isCubeSolvedArray,
  countHTM,
  calcTPS,
  getInverseMove,
  createCube3DInstance,
  switchTab
};

// 初期化
resetCubeState();
window.App.stats.updateSolveCount();
window.App.stats.updateTimerStatsPanel();
generateNewScramble();
