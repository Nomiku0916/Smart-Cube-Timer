window.App = window.App || {};

(function () {
  const STORAGE_KEY = 'gan_cube_solves_v1';
  const MAX_REPLAY_COUNT = 100;

  const tabHistoryBtn = document.getElementById('tab-history');
  const timerStatsPanel = document.getElementById('timer-stats-panel');
  const historyTbody = document.getElementById('history-tbody');
  const btnExport = document.getElementById('btn-export');
  const btnImport = document.getElementById('btn-import');
  const btnReanalyze = document.getElementById('btn-reanalyze');
  const importFileInput = document.getElementById('import-file-input');
  const chartStatsTbody = document.getElementById('chart-stats-tbody');
  const analysisTbody = document.getElementById('analysis-tbody');

  let sortKey = 'date';
  let sortAsc = false;
  let expandedSolveId = null;
  let chartInstance = null;
  let chartMode = 'all';
  let analysisType = 'pll';
  let analysisSortKey = 'tps';
  let analysisSortAsc = true;

  // ==========================================
  // localStorage 保存・軽量化・統計計算
  // ==========================================
  function getHistory() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }

  function updateSolveCount() {
    const history = getHistory();
    tabHistoryBtn.textContent = `履歴 (${history.length}件)`;
  }

  function buildInitialState(scrambleStr) {
    const { resetStateArray, applyMoveToArray } = window.App.cube;
    const s = new Uint8Array(54);
    resetStateArray(s);
    const sMoves = (scrambleStr || '').split(' ').filter(Boolean);
    for (const m of sMoves) {
      applyMoveToArray(s, m);
    }
    return s;
  }

  function checkTimelineSolved(scrambleStr, timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return true;
    const { applyMoveToArray, isCubeSolvedArray } = window.App.cube;
    const s = buildInitialState(scrambleStr);
    for (const step of timeline) {
      applyMoveToArray(s, step.move);
    }
    return isCubeSolvedArray(s);
  }

  function saveHistoryWithCleanup(history) {
    const cutoff = history.length - MAX_REPLAY_COUNT;
    for (let i = 0; i < cutoff; i++) {
      if (history[i].timeline !== null) history[i].timeline = null;
      if (history[i].moves !== null) history[i].moves = null;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    updateSolveCount();
    updateTimerStatsPanel();
  }

  function saveSolve(timeSec, scrambleStr, solveMoves, solveTimeline, cfopResult) {
    const solveObj = {
      id: Date.now(),
      date: new Date().toISOString(),
      time: timeSec,
      scramble: scrambleStr,
      moves: solveMoves,
      timeline: solveTimeline.map((s) => ({ move: s.move, time: s.time })),
      cfop: cfopResult,
      isSolvedComplete: checkTimelineSolved(scrambleStr, solveTimeline)
    };

    const history = getHistory();
    history.push(solveObj);
    saveHistoryWithCleanup(history);
    return solveObj;
  }

  function calcAoNWindow(slice) {
    const sorted = [...slice].sort((a, b) => a - b);
    const trimmed = sorted.slice(1, -1);
    return trimmed.reduce((acc, v) => acc + v, 0) / trimmed.length;
  }

  function calcAoStats(times, n) {
    if (times.length < n) return { current: null, best: null };
    let best = Infinity;
    let current = null;
    for (let i = 0; i <= times.length - n; i++) {
      const val = calcAoNWindow(times.slice(i, i + n));
      if (val < best) best = val;
      if (i === times.length - n) current = val;
    }
    return { current, best };
  }

  function updateTimerStatsPanel() {
    const history = getHistory();
    const times = history.map((h) => h.time);
    const fmt = (val) => (val !== null ? `${val.toFixed(2)}s` : '-');

    const pb = times.length > 0 ? Math.min(...times) : null;
    const ao5 = calcAoStats(times, 5);
    const ao12 = calcAoStats(times, 12);
    const ao50 = calcAoStats(times, 50);
    const ao100 = calcAoStats(times, 100);

    timerStatsPanel.innerHTML = `
      <div class="tsp-title">Current</div>
      <div class="tsp-row"><span>Ao5</span><span>${fmt(ao5.current)}</span></div>
      <div class="tsp-row"><span>Ao12</span><span>${fmt(ao12.current)}</span></div>
      <div class="tsp-row"><span>Ao50</span><span>${fmt(ao50.current)}</span></div>
      <div class="tsp-row"><span>Ao100</span><span>${fmt(ao100.current)}</span></div>
      <div class="tsp-title best">Best</div>
      <div class="tsp-row"><span>Single</span><span>${fmt(pb)}</span></div>
      <div class="tsp-row"><span>Ao5</span><span>${fmt(ao5.best)}</span></div>
      <div class="tsp-row"><span>Ao12</span><span>${fmt(ao12.best)}</span></div>
      <div class="tsp-row"><span>Ao50</span><span>${fmt(ao50.best)}</span></div>
      <div class="tsp-row"><span>Ao100</span><span>${fmt(ao100.best)}</span></div>
    `;
  }

  // ==========================================
  // 履歴一覧・ソート・アコーディオン詳細
  // ==========================================
  function formatShortDate(iso) {
    const d = new Date(iso);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  }

  function getSortValue(item, key) {
    const cfop = item.cfop || {};
    switch (key) {
      case 'date': return new Date(item.date).getTime();
      case 'time': return item.time;
      case 'moves': return cfop.totalMoves ?? 0;
      case 'tps': return cfop.totalTps ?? 0;
      default: return 0;
    }
  }

  function makeAccLine(name, time, step, tps, isIndent = false, iconHtml = '') {
    const tStr = time !== undefined ? `${time.toFixed(2)}s` : '-';
    const sStr = step !== undefined ? `${step}` : '-';
    const pStr = tps !== undefined ? `${tps.toFixed(2)}` : '-';
    return `
      <div class="acc-line ${isIndent ? 'indent' : ''}">
        <span class="acc-name">${iconHtml}<span>${name}</span></span>
        <span>Time:<span class="num-time">${tStr}</span></span>
        <span>Step:<span class="num-step">${sStr}</span></span>
        <span>TPS:<span class="num-tps">${pStr}</span></span>
      </div>
    `;
  }

  function renderHistoryView() {
    const { calcTPS } = window.App.cube;
    const { renderOllIcon, renderPllIcon } = window.App.cfop;
    const history = getHistory();
    tabHistoryBtn.textContent = `履歴 (${history.length}件)`;

    if (history.length === 0) {
      historyTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:24px; color:#777;">まだ記録がありません</td></tr>';
      return;
    }

    const sorted = [...history].sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      return sortAsc ? va - vb : vb - va;
    });

    historyTbody.innerHTML = '';
    sorted.forEach((item) => {
      const cfop = item.cfop || {};
      const isExpanded = item.id === expandedSolveId;
      const isIncomplete = item.isSolvedComplete === false;

      const tr = document.createElement('tr');
      tr.className = 'history-row' + (isExpanded ? ' selected' : '') + (isIncomplete ? ' incomplete-solve' : '');
      tr.innerHTML = `
        <td>${formatShortDate(item.date)}</td>
        <td style="font-weight:bold; color:#fff;">${item.time.toFixed(2)}s</td>
        <td>${cfop.totalMoves ?? '-'}手</td>
        <td>${cfop.totalTps !== undefined ? cfop.totalTps.toFixed(2) : '-'}</td>
      `;
      tr.addEventListener('click', () => {
        expandedSolveId = isExpanded ? null : item.id;
        renderHistoryView();
      });
      historyTbody.appendChild(tr);

      if (isExpanded) {
        const accTr = document.createElement('tr');
        accTr.className = 'accordion-row';
        const hasReplay = Array.isArray(item.timeline) && item.timeline.length > 0;

        const pllTotalTime = (cfop.pll ?? 0) + (cfop.auf ?? 0);
        const pllTotalMoves = (cfop.pllMoves ?? 0) + (cfop.aufMoves ?? 0);
        const pllTotalTps = calcTPS(pllTotalMoves, pllTotalTime);

        let linesHtml = '';
        linesHtml += makeAccLine(`Cross(${cfop.crossFace || '-'})`, cfop.cross, cfop.crossMoves, cfop.crossTps, false);
        linesHtml += makeAccLine('F2L', cfop.f2lTotal, cfop.f2lTotalMoves, cfop.f2lTotalTps, false);
        for (let i = 0; i < 4; i++) {
          linesHtml += makeAccLine(`Slot${i + 1}`, cfop.f2l?.[i], cfop.f2lMoves?.[i], cfop.f2lTps?.[i], true);
        }
        linesHtml += makeAccLine(cfop.ollName || 'OLL', cfop.oll, cfop.ollMoves, cfop.ollTps, false, renderOllIcon(cfop.ollName, 16));
        if (cfop.is2LookOll) {
          linesHtml += makeAccLine('EOLL', cfop.eoll, cfop.eollMoves, cfop.eollTps, true);
          linesHtml += makeAccLine(cfop.collName || 'COLL', cfop.coll, cfop.collMoves, cfop.collTps, true, renderOllIcon(cfop.collName, 16));
        }
        linesHtml += makeAccLine('PLL', pllTotalTime, pllTotalMoves, pllTotalTps, false);
        linesHtml += makeAccLine(cfop.pllName || 'PLL実行', cfop.pll, cfop.pllMoves, cfop.pllTps, true, renderPllIcon(cfop.pllName, 16));
        linesHtml += makeAccLine('AUF', cfop.auf, cfop.aufMoves, cfop.aufTps, true);

        accTr.innerHTML = `
          <td colspan="4">
            <div class="acc-content">
              <div class="acc-list">${linesHtml}</div>
              <div class="acc-actions">
                <button class="btn-acc-replay" ${hasReplay ? '' : 'disabled'}>${hasReplay ? '▶ リプレイ再生' : 'リプレイ期限切れ（100件超過）'}</button>
                <button class="btn-acc-delete">🗑 削除</button>
              </div>
            </div>
          </td>
        `;

        if (hasReplay) {
          accTr.querySelector('.btn-acc-replay').addEventListener('click', (e) => {
            e.stopPropagation();
            window.App.replay.startReplay(item, 'history');
          });
        }

        accTr.querySelector('.btn-acc-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('1件の記録を削除します。よろしいですか？')) {
            const updated = getHistory().filter((h) => h.id !== item.id);
            saveHistoryWithCleanup(updated);
            expandedSolveId = null;
            renderHistoryView();
          }
        });

        historyTbody.appendChild(accTr);
      }
    });
  }

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = key !== 'date' && key !== 'tps';
      }

      document.querySelectorAll('th[data-sort]').forEach((el) => {
        el.classList.remove('sort-active');
        el.textContent = el.textContent.replace(/ [▲▼]/g, '');
      });
      th.classList.add('sort-active');
      th.textContent += sortAsc ? ' ▲' : ' ▼';

      renderHistoryView();
    });
  });

  // ==========================================
  // 過去データの一括再解析・修復（4パターン厳密分岐）
  // ==========================================
  btnReanalyze.addEventListener('click', () => {
    if (!confirm('保存されている全ソルブ記録を最新の解析ロジック（Mスライス修復・OLL/PLL再判定）で再計算します。よろしいですか？')) {
      return;
    }

    const { postProcessSolve } = window.App.cfop;
    const history = getHistory();
    let reanalyzedCount = 0;

    for (const item of history) {
      if (!Array.isArray(item.timeline) || item.timeline.length === 0) {
        item.isSolvedComplete = true;
        continue;
      }

      const wasSolved = checkTimelineSolved(item.scramble, item.timeline);
      const initialState = buildInitialState(item.scramble);
      const rawMoves = item.timeline.map((step) => ({
        move: step.move,
        time: step.time,
        timeMs: Math.round(step.time * 1000)
      }));

      const result = postProcessSolve(rawMoves, initialState, item.time);
      const nowSolved = checkTimelineSolved(item.scramble, result.cleanedTimeline);

      if (nowSolved) {
        // パターン1 (wasSolved && nowSolved) & パターン2 (!wasSolved && nowSolved)
        item.time = result.trueTime;
        item.moves = result.cleanedTimeline.map((s) => s.move);
        item.timeline = result.cleanedTimeline.map((s) => ({ move: s.move, time: s.time }));
        item.cfop = result.cfop;
        item.isSolvedComplete = true;
        reanalyzedCount++;
      } else if (wasSolved && !nowSolved) {
        // パターン3: 元々揃っていたのに再解析で揃わなくなった -> 元データを保護し赤背景にしない
        item.isSolvedComplete = true;
      } else {
        // パターン4: 元々揃っておらず、再解析・修復しても揃わなかった -> 元データを残し赤背景マーク
        item.isSolvedComplete = false;
      }
    }

    saveHistoryWithCleanup(history);
    renderHistoryView();
    renderChartView();
    renderAnalysisView();
    alert(`${reanalyzedCount}件の記録を再解析・修復しました！`);
  });

  // ==========================================
  // JSONバックアップ保存・復元
  // ==========================================
  btnExport.addEventListener('click', () => {
    const history = getHistory();
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const filename = `gan-timer-backup-${y}${m}${d}.json`;

    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });

  btnImport.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (!Array.isArray(imported)) throw new Error('Invalid format');

        const merge = confirm('現在のデータに統合しますか？\n\n[OK] ＝ 重複を除外して統合\n[キャンセル] ＝ 現在のデータを上書き復元');
        if (merge) {
          const current = getHistory();
          const existingIds = new Set(current.map((item) => item.id));
          const merged = [...current, ...imported.filter((item) => !existingIds.has(item.id))];
          merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          saveHistoryWithCleanup(merged);
          alert(`${imported.length}件のバックアップを統合しました。`);
        } else {
          if (confirm('本当に現在のデータをすべて上書きしますか？')) {
            saveHistoryWithCleanup(imported);
            alert(`${imported.length}件のデータを復元しました。`);
          }
        }
        renderHistoryView();
      } catch (err) {
        alert('バックアップファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
  });

  // ==========================================
  // タイム推移グラフ (Chart.js) & 詳細統計表
  // ==========================================
  function calcMovingAoN(times, n) {
    return times.map((_, idx) => {
      if (idx < n - 1) return null;
      return parseFloat(calcAoNWindow(times.slice(idx - n + 1, idx + 1)).toFixed(2));
    });
  }

  function renderChartView() {
    const history = getHistory();
    const todayStr = new Date().toDateString();
    const todayHistory = history.filter((h) => new Date(h.date).toDateString() === todayStr);

    const targetData = chartMode === 'today' ? todayHistory : history;
    const labels = targetData.map((_, idx) => `#${idx + 1}`);
    const times = targetData.map((h) => h.time);

    const datasets = [
      {
        label: '単発',
        data: times,
        borderColor: 'rgba(158, 158, 158, 0.5)',
        backgroundColor: 'rgba(158, 158, 158, 0.5)',
        borderWidth: 1.5,
        pointRadius: 2.5,
        tension: 0.1
      }
    ];

    if (chartMode === 'today') {
      datasets.push(
        {
          label: 'Ao5',
          data: calcMovingAoN(times, 5),
          borderColor: '#2196f3',
          backgroundColor: '#2196f3',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.2
        },
        {
          label: 'Ao12',
          data: calcMovingAoN(times, 12),
          borderColor: '#ff9800',
          backgroundColor: '#ff9800',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.2
        }
      );
    } else {
      datasets.push(
        {
          label: 'Ao50',
          data: calcMovingAoN(times, 50),
          borderColor: '#4caf50',
          backgroundColor: '#4caf50',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.2
        },
        {
          label: 'Ao100',
          data: calcMovingAoN(times, 100),
          borderColor: '#e91e63',
          backgroundColor: '#e91e63',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.2
        }
      );
    }

    const ctx = document.getElementById('solve-chart').getContext('2d');
    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#ccc', boxWidth: 12 }
          }
        },
        scales: {
          x: {
            ticks: { color: '#888', maxTicksLimit: 8 },
            grid: { color: '#2a2a2a' }
          },
          y: {
            ticks: { color: '#888' },
            grid: { color: '#2a2a2a' }
          }
        }
      }
    });

    const allTimes = history.map((h) => h.time);
    const todayTimes = todayHistory.map((h) => h.time);
    const fmt = (val) => (val !== null ? `${val.toFixed(2)}s` : '-');

    const singleCurrent = allTimes.length > 0 ? allTimes[allTimes.length - 1] : null;
    const singleToday = todayTimes.length > 0 ? Math.min(...todayTimes) : null;
    const singleAll = allTimes.length > 0 ? Math.min(...allTimes) : null;

    let rowsHtml = `
      <tr>
        <td>Single</td>
        <td>${fmt(singleCurrent)}</td>
        <td>${fmt(singleToday)}</td>
        <td>${fmt(singleAll)}</td>
      </tr>
    `;

    [5, 12, 50, 100].forEach((n) => {
      const allStats = calcAoStats(allTimes, n);
      const todayStats = calcAoStats(todayTimes, n);
      rowsHtml += `
        <tr>
          <td>Ao${n}</td>
          <td>${fmt(allStats.current)}</td>
          <td>${fmt(todayStats.best)}</td>
          <td>${fmt(allStats.best)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr>
        <td>ソルブ数</td>
        <td>-</td>
        <td>${todayTimes.length}</td>
        <td>${allTimes.length}</td>
      </tr>
    `;

    chartStatsTbody.innerHTML = rowsHtml;
  }

  document.querySelectorAll('.btn-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-range').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      chartMode = btn.dataset.mode;
      renderChartView();
    });
  });

  // ==========================================
  // 分析（OLL / PLL 手順別ランキング）ビュー
  // ==========================================
  function renderAnalysisView() {
    const { OLL_CASES, PLL_ALGS, renderOllIcon, renderPllIcon } = window.App.cfop;
    const history = getHistory();
    const caseNames = analysisType === 'pll'
      ? PLL_ALGS.map(([name]) => name)
      : OLL_CASES.map((c) => c.name);

    const map = new Map();
    caseNames.forEach((name) => map.set(name, []));

    history.forEach((item) => {
      const cfop = item.cfop;
      if (!cfop) return;
      if (analysisType === 'pll') {
        const name = cfop.pllName;
        if (name && map.has(name) && !cfop.pllSkip) {
          map.get(name).push({ time: cfop.pll, tps: cfop.pllTps });
        }
      } else {
        const name = cfop.ollName;
        if (name && map.has(name) && !cfop.ollSkip) {
          map.get(name).push({ time: cfop.oll, tps: cfop.ollTps });
        }
      }
    });

    const rows = caseNames.map((name, idx) => {
      const list = map.get(name);
      const totalCount = list.length;
      if (totalCount === 0) {
        return { name, idx, count: 0, avgTime: null, avgTps: null };
      }
      const recent = list.slice(-12);
      const times = recent.map((r) => r.time);
      const avgTime = recent.length >= 5
        ? calcAoNWindow(times)
        : times.reduce((a, b) => a + b, 0) / times.length;
      const avgTps = recent.reduce((a, b) => a + b.tps, 0) / recent.length;
      return { name, idx, count: totalCount, avgTime, avgTps };
    });

    rows.sort((a, b) => {
      if (a.count === 0 && b.count === 0) return a.idx - b.idx;
      if (a.count === 0) return 1;
      if (b.count === 0) return -1;

      let va, vb;
      switch (analysisSortKey) {
        case 'name': return analysisSortAsc ? a.idx - b.idx : b.idx - a.idx;
        case 'count': va = a.count; vb = b.count; break;
        case 'time': va = a.avgTime; vb = b.avgTime; break;
        case 'tps': default: va = a.avgTps; vb = b.avgTps; break;
      }
      return analysisSortAsc ? va - vb : vb - va;
    });

    analysisTbody.innerHTML = rows.map((r) => {
      const iconHtml = analysisType === 'pll' ? renderPllIcon(r.name, 30) : renderOllIcon(r.name, 30);
      return `
        <tr>
          <td>
            <div class="analysis-name-cell">
              ${iconHtml}
              <span style="font-weight:bold; color:${r.count > 0 ? '#fff' : '#666'};">${r.name}</span>
            </div>
          </td>
          <td style="color:${r.count > 0 ? '#ccc' : '#666'};">${r.count > 0 ? r.count + '回' : '-'}</td>
          <td>${r.avgTime !== null ? r.avgTime.toFixed(2) + 's' : '-'}</td>
          <td style="color:${r.avgTps !== null ? 'var(--primary-color)' : '#666'}; font-weight:bold;">${r.avgTps !== null ? r.avgTps.toFixed(2) : '-'}</td>
        </tr>
      `;
    }).join('');
  }

  document.querySelectorAll('.btn-analysis-type').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-analysis-type').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      analysisType = btn.dataset.type;
      renderAnalysisView();
    });
  });

  document.querySelectorAll('th[data-asort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.asort;
      if (analysisSortKey === key) {
        analysisSortAsc = !analysisSortAsc;
      } else {
        analysisSortKey = key;
        analysisSortAsc = key === 'tps' || key === 'name';
      }

      document.querySelectorAll('th[data-asort]').forEach((el) => {
        el.classList.remove('sort-active');
        el.textContent = el.textContent.replace(/ [▲▼]/g, '');
      });
      th.classList.add('sort-active');
      th.textContent += analysisSortAsc ? ' ▲' : ' ▼';

      renderAnalysisView();
    });
  });

  window.App.stats = {
    getHistory,
    updateSolveCount,
    saveHistoryWithCleanup,
    saveSolve,
    updateTimerStatsPanel,
    renderHistoryView,
    renderChartView,
    renderAnalysisView
  };
})();
