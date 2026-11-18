window.App = window.App || {};

(function () {
  const replayView = document.getElementById('replay-view');
  const replayCubeContainer = document.getElementById('replay-cube-container');
  const replayCube3d = document.getElementById('replay-cube-3d');
  const replayCubeOrientation = document.getElementById('replay-cube-orientation');
  const replayTurnLayer = document.getElementById('replay-turn-layer');
  const replayCfopPanel = document.getElementById('replay-cfop-panel');
  const replayScrambleBox = document.getElementById('replay-scramble-box');
  const replayMovesBox = document.getElementById('replay-moves-box');
  const replayPhaseEl = document.getElementById('replay-phase');
  const replayMoveEl = document.getElementById('replay-move');
  const replayTimeEl = document.getElementById('replay-time');
  const seekbarWrapper = document.getElementById('seekbar-wrapper');
  const seekbarTrack = document.getElementById('seekbar-track');
  const seekbarThumb = document.getElementById('seekbar-thumb');
  const replayPrevBtn = document.getElementById('replay-prev-btn');
  const replayPlayBtn = document.getElementById('replay-play-btn');
  const replayNextBtn = document.getElementById('replay-next-btn');
  const replaySpeedBtn = document.getElementById('replay-speed-btn');
  const replayExitBtn = document.getElementById('replay-exit-btn');

  let replayCube3D = null;
  let replayState = new Uint8Array(54);
  let replayData = null;
  let replayBaseState = null;
  let replayPlaying = false;
  let replaySpeed = 1.0;
  let replayCurrentTime = 0;
  let replayMoveIndex = 0;
  let replayRafId = null;
  let replayLastFrameTime = 0;
  let replayMoveSpans = [];

  function ensureReplayCube3D() {
    if (!replayCube3D) {
      replayCube3D = window.App.cube.createCube3DInstance(
        replayCubeContainer,
        replayCube3d,
        replayCubeOrientation,
        replayTurnLayer
      );
    }
  }

  function isReplayOpen() {
    return replayView.classList.contains('active');
  }

  function buildReplayCfopPanel(cfop, totalTime) {
    const pllTotal = cfop.pll + cfop.auf;
    replayCfopPanel.innerHTML = `
      <div class="rcp-title"><span>Total</span><span>${totalTime.toFixed(2)}s</span></div>
      <div class="rcp-row" id="rcp-cross"><span>Cross</span><span>${cfop.cross.toFixed(2)}s</span></div>
      <div class="rcp-row" id="rcp-f2l"><span>F2L</span><span>${cfop.f2lTotal.toFixed(2)}s</span></div>
      <div class="rcp-row" id="rcp-oll"><span>OLL</span><span>${cfop.ollSkip ? 'Skip' : cfop.oll.toFixed(2) + 's'}</span></div>
      <div class="rcp-row" id="rcp-pll"><span>PLL</span><span>${cfop.pllSkip && cfop.auf < 0.01 ? 'Skip' : pllTotal.toFixed(2) + 's'}</span></div>
    `;
  }

  function buildReplayMovesList(timeline) {
    replayMovesBox.innerHTML = '';
    replayMoveSpans = timeline.map((step) => {
      const span = document.createElement('span');
      span.className = 'r-move';
      span.textContent = step.move;
      replayMovesBox.appendChild(span);
      return span;
    });
  }

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
    if (t <= cfop.cross) return { name: 'Cross', color: '#2196f3', key: 'cross' };
    if (t <= cfop.cross + cfop.f2lTotal) return { name: 'F2L', color: '#4caf50', key: 'f2l' };
    if (t <= cfop.cross + cfop.f2lTotal + cfop.oll) return { name: 'OLL', color: '#ffc107', key: 'oll' };
    return { name: 'PLL', color: '#f44336', key: 'pll' };
  }

  function seekReplayTo(targetTime) {
    if (!replayData) return;
    const { applyMoveToArray } = window.App.cube;
    replayCube3D.finishAnimationNow(replayState);

    replayCurrentTime = Math.max(0, Math.min(targetTime, replayData.time));
    replayState = new Uint8Array(replayBaseState);
    replayMoveIndex = 0;

    const tl = replayData.timeline;
    while (replayMoveIndex < tl.length && tl[replayMoveIndex].time <= replayCurrentTime) {
      applyMoveToArray(replayState, tl[replayMoveIndex].move);
      replayMoveIndex++;
    }

    replayCube3D.syncColors(replayState);
    updateReplayUI();
  }

  function seekToMoveIndex(targetIdx) {
    if (!replayData) return;
    const { applyMoveToArray } = window.App.cube;
    const tl = replayData.timeline;
    const clampedIdx = Math.max(0, Math.min(targetIdx, tl.length));

    replayCube3D.finishAnimationNow(replayState);
    replayState = new Uint8Array(replayBaseState);
    for (let i = 0; i < clampedIdx; i++) {
      applyMoveToArray(replayState, tl[i].move);
    }

    replayMoveIndex = clampedIdx;
    replayCurrentTime = clampedIdx > 0 ? tl[clampedIdx - 1].time : 0;

    replayCube3D.syncColors(replayState);
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

    // CFOPパネルの現在フェーズをハイライト
    ['cross', 'f2l', 'oll', 'pll'].forEach((k) => {
      const el = document.getElementById(`rcp-${k}`);
      if (el) {
        el.className = 'rcp-row' + (k === phase.key ? ` active-${k}` : '');
      }
    });

    // カラオケ字幕風の回転記号ハイライト更新
    const currentIdx = replayMoveIndex - 1;
    for (let i = 0; i < replayMoveSpans.length; i++) {
      const span = replayMoveSpans[i];
      if (i < currentIdx) {
        span.className = 'r-move done';
      } else if (i === currentIdx) {
        span.className = 'r-move current';
      } else {
        span.className = 'r-move';
      }
    }

    const lastMove = replayMoveIndex > 0 ? replayData.timeline[replayMoveIndex - 1].move : '-';
    replayMoveEl.textContent = lastMove;
  }

  function replayLoop(now) {
    if (!replayPlaying) return;
    const { applyMoveToArray } = window.App.cube;
    const dt = ((now - replayLastFrameTime) / 1000) * replaySpeed;
    replayLastFrameTime = now;
    replayCurrentTime += dt;

    const tl = replayData.timeline;
    while (replayMoveIndex < tl.length && tl[replayMoveIndex].time <= replayCurrentTime) {
      const m = tl[replayMoveIndex].move;
      applyMoveToArray(replayState, m);

      let durMs = 70;
      if (replayMoveIndex + 1 < tl.length) {
        const nextGapMs = ((tl[replayMoveIndex + 1].time - tl[replayMoveIndex].time) * 1000) / replaySpeed;
        durMs = Math.max(20, Math.min(70, Math.floor(nextGapMs * 0.7)));
      }
      replayCube3D.animateMove(m, replayState, durMs);
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

  function startReplay(solveData) {
    if (!solveData.timeline || solveData.timeline.length === 0) return;
    const { resetStateArray, applyMoveToArray } = window.App.cube;

    ensureReplayCube3D();
    replayData = solveData;
    replayPlaying = false;
    if (replayRafId) cancelAnimationFrame(replayRafId);

    replayBaseState = new Uint8Array(54);
    resetStateArray(replayBaseState);
    const sMoves = solveData.scramble.split(' ').filter(Boolean);
    for (const m of sMoves) {
      applyMoveToArray(replayBaseState, m);
    }

    replayCube3D.setCrossOrientation(solveData.cfop.crossFace);
    buildReplayCfopPanel(solveData.cfop, solveData.time);
    buildReplayMovesList(solveData.timeline);
    buildSeekbarSegments(solveData.cfop, solveData.time);

    replayScrambleBox.textContent = `Scramble: ${solveData.scramble}`;
    replayPlayBtn.textContent = '▶ 再生';
    replayView.classList.add('active');

    seekReplayTo(0);
  }

  function exitReplay() {
    replayPlaying = false;
    if (replayRafId) cancelAnimationFrame(replayRafId);
    replayView.classList.remove('active');
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

  replayPrevBtn.addEventListener('click', () => {
    if (!replayData) return;
    if (replayPlaying) toggleReplayPlay();
    if (replayMoveIndex > 0) {
      seekToMoveIndex(replayMoveIndex - 1);
    }
  });

  replayNextBtn.addEventListener('click', () => {
    if (!replayData) return;
    if (replayPlaying) toggleReplayPlay();
    if (replayMoveIndex < replayData.timeline.length) {
      seekToMoveIndex(replayMoveIndex + 1);
    }
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
    exitReplay,
    isReplayOpen
  };
})();
