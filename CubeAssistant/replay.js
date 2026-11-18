window.App = window.App || {};

(function () {
  const scrambleBox = document.getElementById('scramble-box');
  const timerBox = document.getElementById('timer-box');
  const replayScrambleBox = document.getElementById('replay-scramble-box');
  const replayPanel = document.getElementById('replay-panel');
  const replayPhaseEl = document.getElementById('replay-phase');
  const replayMoveEl = document.getElementById('replay-move');
  const replayTimeEl = document.getElementById('replay-time');
  const seekbarWrapper = document.getElementById('seekbar-wrapper');
  const seekbarTrack = document.getElementById('seekbar-track');
  const seekbarThumb = document.getElementById('seekbar-thumb');
  const replayPlayBtn = document.getElementById('replay-play-btn');
  const replaySpeedBtn = document.getElementById('replay-speed-btn');
  const replayExitBtn = document.getElementById('replay-exit-btn');
  const tableWrapper = document.getElementById('table-wrapper');

  let replayData = null;
  let replayBaseState = null;
  let replayPlaying = false;
  let replaySpeed = 1.0;
  let replayCurrentTime = 0;
  let replayMoveIndex = 0;
  let replayRafId = null;
  let replayLastFrameTime = 0;
  let replayReturnTarget = 'timer';
  let replayHistoryScrollTop = 0;

  function buildSeekbarSegments(cfop, totalTime) {
    seekbarTrack.innerHTML = '';
    if (totalTime <= 0) return;

    const pllTotal = cfop.pll + cfop.auf;
    const segments = [
      { dur: cfop.cross, color: '#2196f3' },
      { dur: cfop.f2lTotal, color: '#4caf50' },
      { dur: cfop.oll, color: '#ffc107' },
      { dur: pllTotal, color: '#f44336' }
    ];

    segments.forEach((seg) => {
      const pct = (seg.dur / totalTime) * 100;
      const div = document.createElement('div');
      div.style.width = `${pct}%`;
      div.style.height = '100%';
      div.style.backgroundColor = seg.color;
      seekbarTrack.appendChild(div);
    });
  }

  function getPhaseAtTime(t, cfop) {
    if (t <= cfop.cross) return { name: 'Cross', color: '#2196f3' };
    if (t <= cfop.cross + cfop.f2lTotal) return { name: 'F2L', color: '#4caf50' };
    if (t <= cfop.cross + cfop.f2lTotal + cfop.oll) return { name: 'OLL', color: '#ffc107' };
    return { name: 'PLL', color: '#f44336' };
  }

  function seekReplayTo(targetTime) {
    if (!replayData) return;
    const { finishAnimationNow, setCubeState, applyMoveToArray, syncCubieColors } = window.App.cube;
    finishAnimationNow();

    replayCurrentTime = Math.max(0, Math.min(targetTime, replayData.time));
    const state = new Uint8Array(replayBaseState);
    replayMoveIndex = 0;

    const tl = replayData.timeline;
    while (replayMoveIndex < tl.length && tl[replayMoveIndex].time <= replayCurrentTime) {
      applyMoveToArray(state, tl[replayMoveIndex].move);
      replayMoveIndex++;
    }

    setCubeState(state);
    syncCubieColors();
    updateReplayUI();
  }

  function updateReplayUI() {
    if (!replayData) return;
    const total = replayData.time;
    const pct = total > 0 ? (replayCurrentTime / total) * 100 : 0;
    seekbarThumb.style.left = `${pct}%`;
    replayTimeEl.textContent = `${replayCurrentTime.toFixed(2)} / ${total.toFixed(2)}s`;

    const phase = getPhaseAtTime(replayCurrentTime, replayData.cfop);
    replayPhaseEl.textContent = phase.name;
    replayPhaseEl.style.backgroundColor = phase.color;
    replayPhaseEl.style.color = phase.name === 'OLL' ? '#000' : '#fff';

    const lastMove = replayMoveIndex > 0 ? replayData.timeline[replayMoveIndex - 1].move : '-';
    replayMoveEl.textContent = lastMove;
  }

  function replayLoop(now) {
    if (!replayPlaying) return;
    const { getCubeState, applyMoveToArray, animateMove3D } = window.App.cube;
    const dt = ((now - replayLastFrameTime) / 1000) * replaySpeed;
    replayLastFrameTime = now;
    replayCurrentTime += dt;

    const tl = replayData.timeline;
    const state = getCubeState();
    while (replayMoveIndex < tl.length && tl[replayMoveIndex].time <= replayCurrentTime) {
      const m = tl[replayMoveIndex].move;
      applyMoveToArray(state, m);

      let durMs = 70;
      if (replayMoveIndex + 1 < tl.length) {
        const nextGapMs = ((tl[replayMoveIndex + 1].time - tl[replayMoveIndex].time) * 1000) / replaySpeed;
        durMs = Math.max(20, Math.min(70, Math.floor(nextGapMs * 0.7)));
      }
      animateMove3D(m, durMs);
      replayMoveIndex++;
    }

    if (replayCurrentTime >= replayData.time) {
      replayCurrentTime = replayData.time;
      replayPlaying = false;
      replayPlayBtn.textContent = '▶ 再生';
      updateReplayUI();
      return;
    }

    updateReplayUI();
    replayRafId = requestAnimationFrame(replayLoop);
  }

  function toggleReplayPlay() {
    if (!replayData) return;
    if (replayPlaying) {
      replayPlaying = false;
      if (replayRafId) cancelAnimationFrame(replayRafId);
      replayPlayBtn.textContent = '▶ 再生';
    } else {
      if (replayCurrentTime >= replayData.time) {
        seekReplayTo(0);
      }
      replayPlaying = true;
      replayPlayBtn.textContent = '❚❚ 一時停止';
      replayLastFrameTime = performance.now();
      replayRafId = requestAnimationFrame(replayLoop);
    }
  }

  function startReplay(solveData, source = 'timer') {
    if (!solveData.timeline || solveData.timeline.length === 0) return;
    const { switchTab, setAppState, resetStateArray, applyMoveToArray, setCrossOrientation } = window.App.cube;

    replayReturnTarget = source;
    if (source === 'history') {
      replayHistoryScrollTop = tableWrapper.scrollTop;
    }

    switchTab('timer');
    setAppState('REPLAY');
    replayData = solveData;
    replayPlaying = false;
    if (replayRafId) cancelAnimationFrame(replayRafId);

    replayBaseState = new Uint8Array(54);
    resetStateArray(replayBaseState);
    const sMoves = solveData.scramble.split(' ').filter(Boolean);
    for (const m of sMoves) {
      applyMoveToArray(replayBaseState, m);
    }

    setCrossOrientation(solveData.cfop.crossFace);
    buildSeekbarSegments(solveData.cfop, solveData.time);

    scrambleBox.style.display = 'none';
    timerBox.style.display = 'none';
    replayScrambleBox.textContent = `Scramble: ${solveData.scramble}`;
    replayScrambleBox.style.display = 'block';
    replayPanel.style.display = 'block';
    replayPlayBtn.textContent = '▶ 再生';

    seekReplayTo(0);
  }

  function exitReplay() {
    const { setCrossOrientation, resetCubeState, generateNewScramble, switchTab } = window.App.cube;

    replayPlaying = false;
    if (replayRafId) cancelAnimationFrame(replayRafId);
    setCrossOrientation('D');
    replayPanel.style.display = 'none';
    replayScrambleBox.style.display = 'none';
    scrambleBox.style.display = 'block';
    timerBox.style.display = 'block';
    resetCubeState();
    generateNewScramble();

    if (replayReturnTarget === 'history') {
      switchTab('history');
      tableWrapper.scrollTop = replayHistoryScrollTop;
    }
  }

  let isSeeking = false;
  function handleSeekPointer(e) {
    const rect = seekbarWrapper.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekReplayTo(ratio * replayData.time);
  }

  seekbarWrapper.addEventListener('pointerdown', (e) => {
    if (!replayData) return;
    isSeeking = true;
    if (replayPlaying) toggleReplayPlay();
    handleSeekPointer(e);
  });

  window.addEventListener('pointermove', (e) => {
    if (isSeeking) handleSeekPointer(e);
  });

  window.addEventListener('pointerup', () => {
    isSeeking = false;
  });

  replayPlayBtn.addEventListener('click', toggleReplayPlay);

  const SPEEDS = [1.0, 0.5, 0.25];
  let speedIdx = 0;
  replaySpeedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    replaySpeed = SPEEDS[speedIdx];
    replaySpeedBtn.textContent = `${replaySpeed.toFixed(replaySpeed === 0.25 ? 2 : 1)}x`;
  });

  replayExitBtn.addEventListener('click', exitReplay);

  window.App.replay = {
    startReplay,
    exitReplay
  };
})();