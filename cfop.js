window.App = window.App || {};

(function () {
  const totalStatsEl = document.getElementById('total-stats');
  const cfopPanelEl = document.getElementById('cfop-panel');
  const cfopSummaryEl = document.getElementById('cfop-summary');
  const cfopDetailF2lEl = document.getElementById('cfop-detail-f2l');
  const cfopDetailOllEl = document.getElementById('cfop-detail-oll');
  const cfopDetailPllEl = document.getElementById('cfop-detail-pll');

  // ==========================================
  // オリエンテーション追跡＆座標変換エンジン
  // ==========================================
  // ペア→スライスの対応と、融合後の座標変換（改名表）。
  // 「両側を回す」動きは「スライス＋全体回転」と物理的に等しく、対応と
  // 変換表はその関係が全ての後続手で成り立つよう、エンジンから機械的に
  // 導出して検証したもの（以前の手書き表は向きが逆で、1/4回転の融合が
  // 物理と一致せず、180°の融合だけが偶然動いていた）。
  const SLICE_PAIR_MAP = {
    "R|L'": "M",  "L'|R": "M",
    "R'|L": "M'", "L|R'": "M'",
    "U|D'": "E",  "D'|U": "E",
    "U'|D": "E'", "D|U'": "E'",
    "F|B'": "S'", "B'|F": "S'",
    "F'|B": "S",  "B|F'": "S"
  };

  function detectSlicePair(m1, m2) {
    return SLICE_PAIR_MAP[`${m1}|${m2}`] || null;
  }

  // スライス融合後の改名表：融合した解釈での後続の生の手を、仮想フレームの
  // 手に読み替えるための面の対応（π）。map[F] に π を合成して更新する。
  const SLICE_MAP_UPDATE = {
    M:  { U: 'F', D: 'B', F: 'D', B: 'U', L: 'L', R: 'R' },
    "M'": { U: 'B', D: 'F', F: 'U', B: 'D', L: 'L', R: 'R' },
    E:  { U: 'U', D: 'D', F: 'R', B: 'L', L: 'F', R: 'B' },
    "E'": { U: 'U', D: 'D', F: 'L', B: 'R', L: 'B', R: 'F' },
    S:  { U: 'R', D: 'L', F: 'F', B: 'B', L: 'U', R: 'D' },
    "S'": { U: 'L', D: 'R', F: 'F', B: 'B', L: 'D', R: 'U' }
  };

  function updateOrientationMap(map, sliceMove) {
    const quarter = SLICE_MAP_UPDATE[sliceMove[0]];
    const prime = SLICE_MAP_UPDATE[sliceMove[0] + "'"];
    const applyPi = (p) => {
      for (const k of Object.keys(map)) map[k] = p[map[k]] || map[k];
    };
    if (sliceMove.endsWith('2')) {
      applyPi(quarter);
      applyPi(quarter);
    } else {
      applyPi(sliceMove.endsWith("'") ? prime : quarter);
    }
  }

  function mapMoveWithOrientation(rawMove, map) {
    const face = rawMove[0];
    const suffix = rawMove.slice(1);
    const mappedFace = map[face] || face;
    return mappedFace + suffix;
  }

  // 同面の連続手をまとめる。spans[k] は、まとまった k 番目の手が
  // 元リストの [開始idx, 終了idx] の範囲を占めるか（境界対応づけ用）
  function mergeWithSpans(movesList) {
    const stack = [];
    const spans = [];
    movesList.forEach((item, idx) => {
      const face = item.move[0];
      const amt = item.move.endsWith("'") ? 3 : item.move.endsWith("2") ? 2 : 1;
      if (stack.length > 0 && stack[stack.length - 1].move[0] === face) {
        const prev = stack[stack.length - 1];
        const prevAmt = prev.move.endsWith("'") ? 3 : prev.move.endsWith("2") ? 2 : 1;
        const combined = (prevAmt + amt) % 4;
        if (combined === 0) {
          stack.pop();
          spans.pop();
        } else {
          const suffix = combined === 1 ? '' : combined === 2 ? '2' : "'";
          prev.move = face + suffix;
          prev.time = item.time;
          prev.timeMs = item.timeMs;
          spans[spans.length - 1][1] = idx;
        }
      } else {
        stack.push({ ...item });
        spans.push([idx, idx]);
      }
    });
    return { merged: stack, spans };
  }

  function mergeSameFaceMoves(movesList) {
    return mergeWithSpans(movesList).merged;
  }

  // スライスペアの解釈は時間間隔では決めない。実測では、本物のスライスと
  // ただの速い連続ターンの間隔が完全に重なっており、何msで線を引いても
  // 誤融合が起きた（例：開始直後の F→B' 48ms を S と誤判定）。
  //
  // 正しい座標変換のもとでは、融合の組み合わせによらず最終状態は
  // 「全体回転を除いて完成」になる（融合＋改名は共役変換なので、素の解釈の
  // 最終状態を回転させたものに必ず一致する）。つまり完成可否では解釈を
  // 選べない。そこで解釈の候補を列挙し、次の優先順位で選ぶ：
  //   1. CFOPとして筋が通っているか（OLL・PLLが実在ケースとして認識できるか）
  //   2. 同点なら融合が多い方（狙ったスライスの方が多いという本人の判断）
  // また融合候補はLL（OLL/PLL）区間の中だけで、フェーズ境界を跨がない
  // ペアに限る（CFではスライスを使わず、使うのはLLという本人の使い分け。
  // F2L側の偶然の対面ペアを巻き込まないための制限）。境界は素の解釈を
  // マージ前のタイムラインで切り分けて求める。境界が取れない記録では
  // 従来の真ん中案（後半のみ）にフォールバックする。
  const MAX_SLICE_BRANCH_PAIRS = 12;
  const MAX_SEARCH_NODES = 8192;

  // 全体回転を除いて完成しているか（各面が単色か）
  function isUniformSolved(state) {
    for (let f = 0; f < 6; f++) {
      const c = state[f * 9 + 4];
      for (let i = 0; i < 9; i++) {
        if (state[f * 9 + i] !== c) return false;
      }
    }
    return true;
  }

  // 解釈の探索：候補を列挙し、筋の良さ→融合数で最良のものを返す。
  // どの候補も回転込みで完成しない場合は、融合なし解釈（素の変換）を返す。
  function searchInterpretation(rawMoves, baseState) {
    const { applyMoveToArray, isCubeSolvedArray } = window.App.cube;

    const plainConverted = () => {
      const map = { U: 'U', D: 'D', F: 'F', B: 'B', R: 'R', L: 'L' };
      return rawMoves.map((m) => ({
        move: mapMoveWithOrientation(m.move, map),
        time: m.time,
        timeMs: m.timeMs
      }));
    };

    if (!rawMoves || rawMoves.length === 0) {
      return { converted: [], fusions: 0, reachedSolved: false };
    }
    if (!baseState) {
      // 初期状態が分からなければ完成判定ができないので、素の変換だけを行う
      return { converted: plainConverted(), fusions: 0, reachedSolved: false };
    }

    // 融合ゲート：素の解釈をマージ前タイムラインで切り分け、OLL/PLL
    // 区間の中で境界を跨がないペアだけを融合候補にする
    const fusionGate = (() => {
      const st = new Uint8Array(baseState);
      const timeline = plainConverted().map((e) => {
        applyMoveToArray(st, e.move);
        return { move: e.move, time: e.time, state: new Uint8Array(st) };
      });
      const total = timeline.length > 0 ? timeline[timeline.length - 1].time : 0;
      const p = analyzeCFOP(timeline, total).phaseIdx;
      if (!p || !p.valid) return null;
      const segOf = (idx) => (idx <= p.cross ? 0 : idx <= p.f2l[3] ? 1 : idx <= p.oll ? 2 : idx <= p.pll ? 3 : 4);
      return (i) => {
        const s = segOf(i);
        return s === segOf(i + 1) && (s === 2 || s === 3);
      };
    })();
    // 境界が取れない場合のフォールバック（真ん中案：後半のペアのみ）
    const fusionStart = Math.floor(rawMoves.length / 2);
    let best = null;
    let nodes = 0;

    function coherenceScore(convertedList) {
      const st = new Uint8Array(baseState);
      const timeline = convertedList.map((e) => {
        applyMoveToArray(st, e.move);
        return { move: e.move, time: e.time, state: new Uint8Array(st) };
      });
      const total = timeline.length > 0 ? timeline[timeline.length - 1].time : 0;
      const c = analyzeCFOP(timeline, total);
      let score = 0;
      if (/#\d+/.test(c.ollName || '') || /\((?!Skip)/.test(c.ollName || '')) score++;
      if (/perm/.test(c.pllName || '')) score++;
      return score;
    }

    function dfs(i, map, converted, fusions, state, branchPoints) {
      if (nodes > MAX_SEARCH_NODES) return;
      nodes++;
      if (i >= rawMoves.length) {
        if (isCubeSolvedArray(state) || isUniformSolved(state)) {
          // 境界検出はマージ前の並びで行う（マージすると境界の状態が
          // 消えてSkip誤判定や境界の遅れが起きるため）
          const score = coherenceScore(converted);
          if (!best || score > best.score || (score === best.score && fusions > best.fusions)) {
            best = { converted: converted.slice(), fusions, score, reachedSolved: true };
          }
        }
        return;
      }
      const curr = rawMoves[i];
      const mappedCurr = mapMoveWithOrientation(curr.move, map);

      // 解釈A：スライスとして融合し、座標マップを回す（LL区間内のみ）
      const fusable = fusionGate ? fusionGate(i) : i >= fusionStart;
      if (branchPoints < MAX_SLICE_BRANCH_PAIRS && fusable && i + 1 < rawMoves.length) {
        const next = rawMoves[i + 1];
        const mappedNext = mapMoveWithOrientation(next.move, map);
        const sliceMove = detectSlicePair(mappedCurr, mappedNext);
        if (sliceMove) {
          const st = new Uint8Array(state);
          applyMoveToArray(st, sliceMove);
          const newMap = { ...map };
          updateOrientationMap(newMap, sliceMove);
          converted.push({ move: sliceMove, time: next.time, timeMs: next.timeMs });
          dfs(i + 2, newMap, converted, fusions + 1, st, branchPoints + 1);
          converted.pop();
        }
      }

      // 解釈B：融合しない（通常の連続ターン）
      {
        const st = new Uint8Array(state);
        applyMoveToArray(st, mappedCurr);
        converted.push({ move: mappedCurr, time: curr.time, timeMs: curr.timeMs });
        dfs(i + 1, map, converted, fusions, st, branchPoints);
        converted.pop();
      }
    }

    dfs(0, { U: 'U', D: 'D', F: 'F', B: 'B', R: 'R', L: 'L' }, [], 0, new Uint8Array(baseState), 0);
    if (best) return best;
    return { converted: plainConverted(), fusions: 0, reachedSolved: false };
  }

  function cleanMoveHistory(rawMoves, initialState) {
    if (!rawMoves || rawMoves.length === 0) return [];
    const baseState = initialState ? new Uint8Array(initialState) : null;
    return mergeSameFaceMoves(searchInterpretation(rawMoves, baseState).converted);
  }

  // フェーズの手数・TPSを、マージ後の手で数え直す。
  // spanStarts[k] は表示用（マージ後）タイムラインの k 番目の手が、
  // マージ前タイムラインの何番目の手から始まるか。境界を跨いで
  // マージされた手は、従来の数え方に合わせて「その手で完成する
  // フェーズ」側に数える。境界はマージ前で検出したもの
  // （cfop.phaseIdx）を使う。
  function remapCountsToMerged(cfop, mergedMoves, spanStarts, lastIdx, totalTime, countHTM, calcTPS) {
    const p = cfop.phaseIdx;
    if (!p) return;
    const countIn = (fromIdx, toIdx) => {
      let n = 0;
      for (let k = 0; k < mergedMoves.length; k++) {
        if (spanStarts[k] > fromIdx && spanStarts[k] <= toIdx) n += countHTM([mergedMoves[k]]);
      }
      return n;
    };
    cfop.crossMoves = countIn(-1, p.cross);
    cfop.f2lMoves = [
      countIn(p.cross, p.f2l[0]),
      countIn(p.f2l[0], p.f2l[1]),
      countIn(p.f2l[1], p.f2l[2]),
      countIn(p.f2l[2], p.f2l[3])
    ];
    cfop.f2lTotalMoves = countIn(p.cross, p.f2l[3]);
    cfop.eollMoves = countIn(p.f2l[3], p.eoll);
    cfop.collMoves = countIn(p.eoll, p.oll);
    cfop.ollMoves = countIn(p.f2l[3], p.oll);
    cfop.pllMoves = countIn(p.oll, p.pll);
    cfop.aufMoves = countIn(p.pll, lastIdx);
    cfop.totalMoves = countHTM(mergedMoves);
    cfop.crossTps = calcTPS(cfop.crossMoves, cfop.cross);
    cfop.f2lTps = cfop.f2lMoves.map((n, k) => calcTPS(n, cfop.f2l[k]));
    cfop.f2lTotalTps = calcTPS(cfop.f2lTotalMoves, cfop.f2lTotal);
    cfop.eollTps = calcTPS(cfop.eollMoves, cfop.eoll);
    cfop.collTps = calcTPS(cfop.collMoves, cfop.coll);
    cfop.ollTps = calcTPS(cfop.ollMoves, cfop.oll);
    cfop.pllTps = calcTPS(cfop.pllMoves, cfop.pll);
    cfop.aufTps = calcTPS(cfop.aufMoves, cfop.auf);
    cfop.totalTps = calcTPS(cfop.totalMoves, totalTime);
    cfop.ollSkip = cfop.ollName === 'OLL Skip' || (cfop.oll < 0.01 && cfop.ollMoves === 0);
    cfop.pllSkip = cfop.pllName === 'PLL Skip' || (cfop.pll < 0.01 && cfop.pllMoves === 0);
    cfop.is2LookOll = p.oll > p.eoll && cfop.coll >= 0.01 && cfop.eollMoves > 0;
  }

  function postProcessSolve(rawMoves, initialState, fallbackTimeSec) {
    const { applyMoveToArray, isCubeSolvedArray, countHTM, calcTPS } = window.App.cube;
    const baseState = initialState ? new Uint8Array(initialState) : new Uint8Array(54);
    const search = searchInterpretation(rawMoves, initialState ? baseState : null);
    const unmerged = search.converted.slice();
    const { merged: cleaned, spans } = mergeWithSpans(unmerged);
    const spanStarts = spans.map((s) => s[0]);

    const simState = new Uint8Array(baseState);
    const cleanedTimeline = [];
    let trueTime = null;

    for (const item of cleaned) {
      applyMoveToArray(simState, item.move);
      const t = parseFloat(item.time.toFixed(2));
      cleanedTimeline.push({ move: item.move, time: t, state: new Uint8Array(simState) });
      if (trueTime === null && (isCubeSolvedArray(simState) || isUniformSolved(simState))) {
        trueTime = t;
      }
    }

    // 最後の手の欠落などへの対策（A案）：記録された並びだけでは完成しない
    // 場合、再生末尾の状態から完成形までの差分を双方向BFS（最大6手）で
    // 求め、末尾に補完してから分割し直す。計測が止まった時点の実状態は
    // 必ず完成なので、差分の目標は完成形でよい。補完した手の時刻は
    // 「タイマー停止直前」としか分からないため、最終手の時刻に寄せる
    // （PLL末尾／AUF側に倒れる）。
    // 安全弁：末尾の欠落なら再生末尾の状態でもF2Lは完成しているはずで、
    // それが崩れている場合は途中のズレとみなして補完しない。また差分が
    // 6手を超える場合も複数箇所のズレとして分析不可のままにする。
    let tailRecoveredMoves = 0;
    const { findRecoveryPath, resetStateArray } = window.App.cube;
    if (trueTime === null && typeof findRecoveryPath === 'function' && typeof resetStateArray === 'function' && isF2LComplete(simState)) {
      const solvedState = new Uint8Array(54);
      resetStateArray(solvedState);
      const path = findRecoveryPath(simState, solvedState, 6);
      if (path && path.length > 0) {
        const lastTime = cleanedTimeline.length > 0
          ? cleanedTimeline[cleanedTimeline.length - 1].time
          : parseFloat(fallbackTimeSec.toFixed(2));
        for (const m of path) {
          applyMoveToArray(simState, m);
          cleanedTimeline.push({ move: m, time: lastTime, state: new Uint8Array(simState), recovered: true });
          unmerged.push({ move: m, time: lastTime, timeMs: null });
          spanStarts.push(unmerged.length - 1);
        }
        if (isCubeSolvedArray(simState)) {
          tailRecoveredMoves = path.length;
          trueTime = lastTime;
        }
      }
    }

    const reachedSolved = tailRecoveredMoves === 0 && trueTime !== null;
    const finalTime = trueTime !== null ? trueTime : fallbackTimeSec;

    // 境界検出はマージ前のタイムラインで行う（マージで境界の状態が
    // 消えると、Skip誤判定やF2L完了検出の遅れが起きる）。表示・
    // リプレイ用の cleanedTimeline は従来どおりマージ後のまま
    const convState = new Uint8Array(baseState);
    const convertedTimeline = unmerged.map((item) => {
      applyMoveToArray(convState, item.move);
      return { move: item.move, time: parseFloat(item.time.toFixed(2)), state: new Uint8Array(convState) };
    });
    const cfop = analyzeCFOP(convertedTimeline, finalTime);
    remapCountsToMerged(cfop, cleanedTimeline.map((e) => e.move), spanStarts, convertedTimeline.length - 1, finalTime, countHTM, calcTPS);

    return {
      trueTime: finalTime,
      reachedSolved,
      tailRecoveredMoves,
      sliceFusions: search.fusions,
      cleanedTimeline,
      cfop
    };
  }

  // ==========================================
  // OLL 57パターン & PLL 21パターン辞書
  // ==========================================
  const OLL_CASES = [
    { name: "OLL #1", alg: "R U2 R2 F R F' U2 R' F R F'" },
    { name: "OLL #2", alg: "F R U R' U' F' f R U R' U' f'" },
    { name: "OLL #3", alg: "f R U R' U' f' U' F R U R' U' F'" },
    { name: "OLL #4", alg: "f R U R' U' f' U F R U R' U' F'" },
    { name: "OLL #5", alg: "r' U2 R U R' U r" },
    { name: "OLL #6", alg: "r U2 R' U' R U' r'" },
    { name: "OLL #7", alg: "r U R' U R U2 r'" },
    { name: "OLL #8", alg: "r' U' R U' R' U2 r" },
    { name: "OLL #9", alg: "R U R' U' R' F R2 U R' U' F'" },
    { name: "OLL #10", alg: "R U R' U R' F R F' R U2 R'" },
    { name: "OLL #11", alg: "r' R2 U R' U R U2 R' U M'" },
    { name: "OLL #12", alg: "M' R' U' R U' R' U2 R U' M" },
    { name: "OLL #13", alg: "F U R U' R2 F' R U R U' R'" },
    { name: "OLL #14", alg: "R' F R U R' F' R F U' F'" },
    { name: "OLL #15", alg: "r' U' r R' U' R U r' U r" },
    { name: "OLL #16", alg: "r U r' R U R' U' r U' r'" },
    { name: "OLL #17", alg: "R U R' U R' F R F' U2 R' F R F'" },
    { name: "OLL #18", alg: "r U R' U R U2 r2 U' R U' R' U2 r" },
    { name: "OLL #19", alg: "r' R U R U R' U' r R2 F R F'" },
    { name: "OLL #20", alg: "r U R' U' M2 U R U' R' U' M'" },
    { name: "OLL #21 (H)", alg: "R U2 R' U' R U R' U' R U' R'" },
    { name: "OLL #22 (Pi)", alg: "R U2 R2 U' R2 U' R2 U2 R" },
    { name: "OLL #23 (U)", alg: "R2 D' R U2 R' D R U2 R" },
    { name: "OLL #24 (T)", alg: "r U R' U' r' F R F'" },
    { name: "OLL #25 (L)", alg: "F' r U R' U' r' F R" },
    { name: "OLL #26 (Anti-Sune)", alg: "R U2 R' U' R U' R'" },
    { name: "OLL #27 (Sune)", alg: "R U R' U R U2 R'" },
    { name: "OLL #28", alg: "r U R' U' M U R U' R'" },
    { name: "OLL #29", alg: "R U R' U' R U' R' F' U' F R U R'" },
    { name: "OLL #30", alg: "F U R U2 R' U' R U2 R' U' F'" },
    { name: "OLL #31", alg: "R' U' F U R U' R' F' R" },
    { name: "OLL #32", alg: "R U B' U' R' U R B R'" },
    { name: "OLL #33", alg: "R U R' U' R' F R F'" },
    { name: "OLL #34", alg: "R U R2 U' R' F R U R U' F'" },
    { name: "OLL #35", alg: "R U2 R2 F R F' R U2 R'" },
    { name: "OLL #36", alg: "R' U' R U' R' U R U R B' R' B" },
    { name: "OLL #37", alg: "F R' F' R U R U' R'" },
    { name: "OLL #38", alg: "R U R' U R U' R' U' R' F R F'" },
    { name: "OLL #39", alg: "L F' L' U' L U F U' L'" },
    { name: "OLL #40", alg: "R' F R U R' U' F' U R" },
    { name: "OLL #41", alg: "R U R' U R U2 R' F R U R' U' F'" },
    { name: "OLL #42", alg: "R' U' R U' R' U2 R F R U R' U' F'" },
    { name: "OLL #43", alg: "f' L' U' L U f" },
    { name: "OLL #44", alg: "f R U R' U' f'" },
    { name: "OLL #45", alg: "F R U R' U' F'" },
    { name: "OLL #46", alg: "R' U' R' F R F' U R" },
    { name: "OLL #47", alg: "R' U' R' F R F' R' F R F' U R" },
    { name: "OLL #48", alg: "F R U R' U' R U R' U' F'" },
    { name: "OLL #49", alg: "r U' r2 U r2 U r2 U' r" },
    { name: "OLL #50", alg: "r' U r2 U' r2 U' r2 U r'" },
    { name: "OLL #51", alg: "f R U R' U' R U R' U' f'" },
    { name: "OLL #52", alg: "R' F' U' F U' R U R' U R" },
    { name: "OLL #53", alg: "r' U' R U' R' U R U' R' U2 r" },
    { name: "OLL #54", alg: "r U R' U R U' R' U R U2 r'" },
    { name: "OLL #55", alg: "R' F R U R U' R2 F' R2 U' R' U R U R'" },
    { name: "OLL #56", alg: "r U r' U R U' R' U R U' R' r U' r'" },
    { name: "OLL #57", alg: "R U R' U' M' U R U' r'" }
  ].map((c) => ({ name: c.name, moves: c.alg.split(' ') }));

  const PLL_ALGS = [
    ['Aa-perm', "x R' U R' D2 R U' R' D2 R2 x'"],
    ['Ab-perm', "x R2 D2 R U R' D2 R U' R x'"],
    ['E-perm',  "x' R U' R' D R U R' D' R U R' D R U' R' D' x"],
    ['F-perm',  "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
    ['Ga-perm', "R2 U R' U R' U' R U' R2 D U' R' U R D'"],
    ['Gb-perm', "R' U' R U D' R2 U R' U R U' R U' R2 D"],
    ['Gc-perm', "R2 U' R U' R U R' U R2 D' U R U' R' D"],
    ['Gd-perm', "R U R' U' D R2 U' R U' R' U R' U R2 D'"],
    ['H-perm',  "M2 U M2 U2 M2 U M2"],
    ['Ja-perm', "x R2 F R F' R U2 r' U r U2 x'"],
    ['Jb-perm', "R U R' F' R U R' U' R' F R2 U' R'"],
    ['Na-perm', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
    ['Nb-perm', "R' U R U' R' F' U' F R U R' F R' F' R U' R"],
    ['Ra-perm', "R U' R' U' R U R D R' U' R D' R' U2 R'"],
    ['Rb-perm', "R' U2 R U2 R' F R U R' U' R' F' R2"],
    ['T-perm',  "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['Ua-perm', "R U' R U R U R U' R' U' R2"],
    ['Ub-perm', "R2 U R U R' U' R' U' R' U R'"],
    ['V-perm',  "R' U R' U' y R' F' R2 U' R' U R' F R F"],
    ['Y-perm',  "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
    ['Z-perm',  "M' U M2 U M2 U M' U2 M2"]
  ].map(([name, alg]) => [name, alg.split(' ')]);

  const AUF_MOVES = ['', 'U', "U'", 'U2'];

  // ==========================================
  // OLL / PLL SVG展開図アイコン自動生成
  // ==========================================
  const iconCache = new Map();

  function renderOllIcon(ollName, size = 32) {
    const cacheKey = `oll:${ollName}:${size}`;
    if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

    const c = OLL_CASES.find((x) => x.name === ollName);
    if (!c) return '';

    const { resetStateArray, applyMoveToArray, getInverseMove } = window.App.cube;
    const s = new Uint8Array(54);
    resetStateArray(s);
    for (let i = c.moves.length - 1; i >= 0; i--) {
      applyMoveToArray(s, getInverseMove(c.moves[i]));
    }

    const Y = '#ffd600';
    const G = '#333333';
    const col = (idx) => (s[idx] === 0 ? Y : G);

    let rects = '';
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        rects += `<rect x="${5 + k * 9}" y="${5 + r * 9}" width="8" height="8" rx="1" fill="${col(r * 3 + k)}"/>`;
      }
    }
    [47, 46, 45].forEach((idx, k) => {
      rects += `<rect x="${5 + k * 9}" y="1" width="8" height="3" rx="0.8" fill="${col(idx)}"/>`;
    });
    [18, 19, 20].forEach((idx, k) => {
      rects += `<rect x="${5 + k * 9}" y="32" width="8" height="3" rx="0.8" fill="${col(idx)}"/>`;
    });
    [36, 37, 38].forEach((idx, r) => {
      rects += `<rect x="1" y="${5 + r * 9}" width="3" height="8" rx="0.8" fill="${col(idx)}"/>`;
    });
    [11, 10, 9].forEach((idx, r) => {
      rects += `<rect x="32" y="${5 + r * 9}" width="3" height="8" rx="0.8" fill="${col(idx)}"/>`;
    });

    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 36 36" style="flex-shrink:0; display:block;">${rects}</svg>`;
    iconCache.set(cacheKey, svg);
    return svg;
  }

  function renderPllIcon(pllName, size = 32) {
    const cacheKey = `pll:${pllName}:${size}`;
    if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);

    const entry = PLL_ALGS.find(([name]) => name === pllName);
    if (!entry) return '';

    const { resetStateArray, applyMoveToArray, getInverseMove } = window.App.cube;
    const s = new Uint8Array(54);
    resetStateArray(s);
    const moves = entry[1];
    for (let i = moves.length - 1; i >= 0; i--) {
      applyMoveToArray(s, getInverseMove(moves[i]));
    }

    const SIDE_COLORS = { 1: '#d50000', 2: '#00c853', 4: '#ff6d00', 5: '#2962ff' };
    const scol = (idx) => SIDE_COLORS[s[idx]] || '#555';

    let rects = '';
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        rects += `<rect x="${5 + k * 9}" y="${5 + r * 9}" width="8" height="8" rx="1" fill="#ffd600"/>`;
      }
    }
    [47, 46, 45].forEach((idx, k) => {
      rects += `<rect x="${5 + k * 9}" y="1" width="8" height="3" rx="0.8" fill="${scol(idx)}"/>`;
    });
    [18, 19, 20].forEach((idx, k) => {
      rects += `<rect x="${5 + k * 9}" y="32" width="8" height="3" rx="0.8" fill="${scol(idx)}"/>`;
    });
    [36, 37, 38].forEach((idx, r) => {
      rects += `<rect x="1" y="${5 + r * 9}" width="3" height="8" rx="0.8" fill="${scol(idx)}"/>`;
    });
    [11, 10, 9].forEach((idx, r) => {
      rects += `<rect x="32" y="${5 + r * 9}" width="3" height="8" rx="0.8" fill="${scol(idx)}"/>`;
    });

    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 36 36" style="flex-shrink:0; display:block;">${rects}</svg>`;
    iconCache.set(cacheKey, svg);
    return svg;
  }

  function normalizeToCrossD(s, crossFace) {
    const { applyMoveToArray } = window.App.cube;
    const norm = new Uint8Array(s);
    if (crossFace === 0) { applyMoveToArray(norm, 'x2'); }
    else if (crossFace === 1) { applyMoveToArray(norm, "z'"); }
    else if (crossFace === 2) { applyMoveToArray(norm, 'x'); }
    else if (crossFace === 4) { applyMoveToArray(norm, 'z'); }
    else if (crossFace === 5) { applyMoveToArray(norm, "x'"); }
    return norm;
  }

  function isUFaceSolved(s) {
    const c = s[4];
    for (let i = 0; i < 9; i++) {
      if (s[i] !== c) return false;
    }
    return true;
  }

  function detectOLLName(s, crossFace) {
    const { applyMoveToArray } = window.App.cube;
    const norm = normalizeToCrossD(s, crossFace);
    if (isUFaceSolved(norm)) return 'OLL Skip';

    for (const c of OLL_CASES) {
      for (const preAuf of AUF_MOVES) {
        const test = new Uint8Array(norm);
        if (preAuf) applyMoveToArray(test, preAuf);
        for (const m of c.moves) applyMoveToArray(test, m);
        if (isUFaceSolved(test)) return c.name;
      }
    }
    return 'OLL';
  }

  function detectPLLName(s, crossFace) {
    const { applyMoveToArray, isCubeSolvedArray } = window.App.cube;
    const norm = normalizeToCrossD(s, crossFace);

    for (const auf of AUF_MOVES) {
      const test = new Uint8Array(norm);
      if (auf) applyMoveToArray(test, auf);
      if (isCubeSolvedArray(test)) return 'PLL Skip';
    }

    for (const [name, moves] of PLL_ALGS) {
      for (const preAuf of AUF_MOVES) {
        const base = new Uint8Array(norm);
        if (preAuf) applyMoveToArray(base, preAuf);
        for (const m of moves) applyMoveToArray(base, m);

        for (const postAuf of AUF_MOVES) {
          const test = new Uint8Array(base);
          if (postAuf) applyMoveToArray(test, postAuf);
          if (isCubeSolvedArray(test)) return name;
        }
      }
    }

    return 'PLL';
  }

  // ==========================================
  // CFOP法 ステップ別タイム＆手数/TPS分析エンジン
  // ==========================================
  const CROSS_DEFS = [
    [[1, 46, 49], [5, 10, 13], [7, 19, 22], [3, 37, 40]],
    [[10, 5, 4], [14, 48, 49], [16, 32, 31], [12, 23, 22]],
    [[19, 7, 4], [23, 12, 13], [25, 28, 31], [21, 41, 40]],
    [[28, 25, 22], [32, 16, 13], [34, 52, 49], [30, 43, 40]],
    [[37, 3, 4], [41, 21, 22], [43, 30, 31], [39, 50, 49]],
    [[46, 1, 4], [50, 39, 40], [52, 34, 31], [48, 14, 13]]
  ];

  const F2L_DEFS = [
    [[8, 4, 20, 23, 22, 9, 12, 13], [2, 4, 11, 14, 13, 45, 48, 49], [0, 4, 47, 50, 49, 36, 39, 40], [6, 4, 38, 41, 40, 18, 21, 22]],
    [[9, 13, 8, 7, 4, 20, 19, 22], [11, 13, 45, 46, 49, 2, 1, 4], [17, 13, 35, 34, 31, 51, 52, 49], [15, 13, 26, 25, 22, 29, 28, 31]],
    [[20, 22, 8, 5, 4, 9, 10, 13], [26, 22, 15, 16, 13, 29, 32, 31], [24, 22, 27, 30, 31, 44, 43, 40], [18, 22, 38, 37, 40, 6, 3, 4]],
    [[29, 31, 26, 23, 22, 15, 12, 13], [35, 31, 17, 14, 13, 51, 48, 49], [33, 31, 53, 50, 49, 42, 39, 40], [27, 31, 44, 41, 40, 24, 21, 22]],
    [[38, 40, 18, 19, 22, 6, 7, 4], [36, 40, 0, 1, 4, 47, 46, 49], [42, 40, 53, 52, 49, 33, 34, 31], [44, 40, 27, 28, 31, 24, 25, 22]],
    [[45, 49, 2, 5, 4, 11, 10, 13], [51, 49, 17, 16, 13, 35, 32, 31], [53, 49, 33, 30, 31, 42, 43, 40], [47, 49, 36, 37, 40, 0, 3, 4]]
  ];

  // 末尾補完（A案）の安全弁用：いずれかの面でクロスと4スロットが完成しているか
  function isF2LComplete(s) {
    for (let f = 0; f < 6; f++) {
      if (isCrossSolved(s, f) && countSolvedF2LSlots(s, f) === 4) return true;
    }
    return false;
  }

  function isCrossSolved(s, f) {
    const centerColor = s[f * 9 + 4];
    for (const [dIdx, sIdx, cIdx] of CROSS_DEFS[f]) {
      if (s[dIdx] !== centerColor || s[sIdx] !== s[cIdx]) return false;
    }
    return true;
  }

  function countSolvedF2LSlots(s, f) {
    let count = 0;
    for (const [dc, dcen, s1c, s1e, s1cen, s2c, s2e, s2cen] of F2L_DEFS[f]) {
      if (s[dc] === s[dcen] && s[s1c] === s[s1cen] && s[s1e] === s[s1cen] && s[s2c] === s[s2cen] && s[s2e] === s[s2cen]) {
        count++;
      }
    }
    return count;
  }

  function isEOLLSolved(s, crossFace) {
    const llFace = window.App.cube.OPPOSITE_FACE[crossFace];
    const base = llFace * 9;
    const color = s[base + 4];
    return s[base + 1] === color && s[base + 3] === color && s[base + 5] === color && s[base + 7] === color;
  }

  function isOLLSolved(s, crossFace) {
    const llFace = window.App.cube.OPPOSITE_FACE[crossFace];
    const base = llFace * 9;
    const color = s[base + 4];
    for (let i = 0; i < 9; i++) {
      if (s[base + i] !== color) return false;
    }
    return true;
  }

  function isPLLSolved(s, crossFace) {
    const { FACE_NAMES, OPPOSITE_FACE, isCubeSolvedArray, applyMoveCW } = window.App.cube;
    const llFaceName = FACE_NAMES[OPPOSITE_FACE[crossFace]];
    const testState = new Uint8Array(s);
    for (let k = 0; k < 4; k++) {
      if (isCubeSolvedArray(testState)) return true;
      applyMoveCW(testState, llFaceName);
    }
    return false;
  }

  function analyzeCFOP(timeline, totalTime) {
    const { FACE_NAMES, countHTM, calcTPS } = window.App.cube;
    let crossFace = -1;
    let crossIdx = -1;
    const f2lIdxs = [];
    let eollIdx = -1;
    let ollIdx = -1;
    let pllIdx = -1;

    for (let i = 0; i < timeline.length; i++) {
      const { state } = timeline[i];
      if (crossFace === -1) {
        for (let f = 0; f < 6; f++) {
          if (isCrossSolved(state, f)) {
            crossFace = f;
            crossIdx = i;
            break;
          }
        }
        if (crossFace === -1) continue;
      }
      if (f2lIdxs.length < 4) {
        const solvedSlots = countSolvedF2LSlots(state, crossFace);
        while (f2lIdxs.length < solvedSlots) f2lIdxs.push(i);
        if (f2lIdxs.length < 4) continue;
      }
      if (eollIdx === -1) {
        if (isEOLLSolved(state, crossFace)) eollIdx = i;
      }
      if (ollIdx === -1) {
        if (isOLLSolved(state, crossFace)) ollIdx = i;
        else continue;
      }
      if (pllIdx === -1) {
        if (isPLLSolved(state, crossFace)) pllIdx = i;
      }
    }

    // フォールバックで埋める前に「本当に検出できたか」を残す（融合ゲート用）
    const phaseValid = crossIdx !== -1 && f2lIdxs.length === 4;

    const lastIdx = timeline.length - 1;
    if (crossIdx === -1) crossIdx = lastIdx;
    while (f2lIdxs.length < 4) f2lIdxs.push(lastIdx);
    if (ollIdx === -1) ollIdx = lastIdx;
    if (eollIdx === -1 || eollIdx > ollIdx) eollIdx = ollIdx;
    if (pllIdx === -1) pllIdx = lastIdx;

    const getTimeAt = (idx) => (idx >= 0 && idx < timeline.length ? timeline[idx].time : totalTime);
    const getMovesSlice = (fromIdx, toIdx) => {
      if (toIdx <= fromIdx) return [];
      return timeline.slice(fromIdx + 1, toIdx + 1).map((s) => s.move);
    };

    const crossTime = getTimeAt(crossIdx);
    const f2lTimes = f2lIdxs.map(getTimeAt);
    const eollTime = getTimeAt(eollIdx);
    const ollTime = getTimeAt(ollIdx);
    const pllTime = getTimeAt(pllIdx);

    const crossDur = Math.max(0, crossTime);
    const f2l1Dur = Math.max(0, f2lTimes[0] - crossTime);
    const f2l2Dur = Math.max(0, f2lTimes[1] - f2lTimes[0]);
    const f2l3Dur = Math.max(0, f2lTimes[2] - f2lTimes[1]);
    const f2l4Dur = Math.max(0, f2lTimes[3] - f2lTimes[2]);
    const f2lTotal = Math.max(0, f2lTimes[3] - crossTime);
    const eollDur = Math.max(0, eollTime - f2lTimes[3]);
    const collDur = Math.max(0, ollTime - eollTime);
    const ollDur = Math.max(0, ollTime - f2lTimes[3]);
    const pllDur = Math.max(0, pllTime - ollTime);
    const aufDur = Math.max(0, totalTime - pllTime);

    const crossMoves = countHTM(getMovesSlice(-1, crossIdx));
    const f2l1Moves = countHTM(getMovesSlice(crossIdx, f2lIdxs[0]));
    const f2l2Moves = countHTM(getMovesSlice(f2lIdxs[0], f2lIdxs[1]));
    const f2l3Moves = countHTM(getMovesSlice(f2lIdxs[1], f2lIdxs[2]));
    const f2l4Moves = countHTM(getMovesSlice(f2lIdxs[2], f2lIdxs[3]));
    const f2lTotalMoves = countHTM(getMovesSlice(crossIdx, f2lIdxs[3]));
    const eollMoves = countHTM(getMovesSlice(f2lIdxs[3], eollIdx));
    const collMoves = countHTM(getMovesSlice(eollIdx, ollIdx));
    const ollMoves = countHTM(getMovesSlice(f2lIdxs[3], ollIdx));
    const pllMoves = countHTM(getMovesSlice(ollIdx, pllIdx));
    const aufMoves = countHTM(getMovesSlice(pllIdx, lastIdx));
    const totalMoves = countHTM(timeline.map((s) => s.move));

    const is2LookOll = ollIdx > eollIdx && collDur >= 0.01 && eollMoves > 0;
    const ollName = crossFace !== -1 ? detectOLLName(timeline[f2lIdxs[3]].state, crossFace) : 'OLL';
    const collName = is2LookOll && crossFace !== -1 ? detectOLLName(timeline[eollIdx].state, crossFace) : null;
    const pllName = crossFace !== -1 ? detectPLLName(timeline[ollIdx].state, crossFace) : 'PLL';

    return {
      crossFace: crossFace !== -1 ? FACE_NAMES[crossFace] : 'D',
      totalMoves,
      totalTps: calcTPS(totalMoves, totalTime),
      cross: parseFloat(crossDur.toFixed(2)),
      crossMoves,
      crossTps: calcTPS(crossMoves, crossDur),
      f2l: [
        parseFloat(f2l1Dur.toFixed(2)),
        parseFloat(f2l2Dur.toFixed(2)),
        parseFloat(f2l3Dur.toFixed(2)),
        parseFloat(f2l4Dur.toFixed(2))
      ],
      f2lMoves: [f2l1Moves, f2l2Moves, f2l3Moves, f2l4Moves],
      f2lTps: [
        calcTPS(f2l1Moves, f2l1Dur),
        calcTPS(f2l2Moves, f2l2Dur),
        calcTPS(f2l3Moves, f2l3Dur),
        calcTPS(f2l4Moves, f2l4Dur)
      ],
      f2lTotal: parseFloat(f2lTotal.toFixed(2)),
      f2lTotalMoves,
      f2lTotalTps: calcTPS(f2lTotalMoves, f2lTotal),
      ollName,
      collName,
      oll: parseFloat(ollDur.toFixed(2)),
      ollMoves,
      ollTps: calcTPS(ollMoves, ollDur),
      ollSkip: ollName === 'OLL Skip' || (ollDur < 0.01 && ollMoves === 0),
      is2LookOll,
      eoll: parseFloat(eollDur.toFixed(2)),
      eollMoves,
      eollTps: calcTPS(eollMoves, eollDur),
      coll: parseFloat(collDur.toFixed(2)),
      collMoves,
      collTps: calcTPS(collMoves, collDur),
      pllName,
      pll: parseFloat(pllDur.toFixed(2)),
      pllMoves,
      pllTps: calcTPS(pllMoves, pllDur),
      pllSkip: pllName === 'PLL Skip' || (pllDur < 0.01 && pllMoves === 0),
      auf: parseFloat(aufDur.toFixed(2)),
      aufMoves,
      aufTps: calcTPS(aufMoves, aufDur),
      phaseIdx: { cross: crossIdx, f2l: [...f2lIdxs], eoll: eollIdx, oll: ollIdx, pll: pllIdx, valid: phaseValid }
    };
  }

  function renderCFOP(cfop) {
    const { calcTPS } = window.App.cube;
    totalStatsEl.textContent = `${cfop.totalMoves}手 / ${cfop.totalTps.toFixed(2)} TPS`;
    totalStatsEl.style.display = 'block';

    const pllTotalTime = cfop.pll + cfop.auf;
    const pllTotalMoves = cfop.pllMoves + cfop.aufMoves;
    const pllTotalTps = calcTPS(pllTotalMoves, pllTotalTime);

    const ollIconHtml = renderOllIcon(cfop.ollName, 16);
    const pllIconHtml = renderPllIcon(cfop.pllName, 16);

    cfopSummaryEl.innerHTML = `
      <div class="cfop-card">
        <span class="cfop-label">Cross(${cfop.crossFace})</span>
        <span class="cfop-val">${cfop.cross.toFixed(2)}s</span>
        <span class="cfop-sub">${cfop.crossMoves}手/${cfop.crossTps.toFixed(1)}</span>
      </div>
      <div class="cfop-card clickable" id="btn-toggle-f2l">
        <span class="cfop-label">F2L <span id="arrow-f2l">▼</span></span>
        <span class="cfop-val">${cfop.f2lTotal.toFixed(2)}s</span>
        <span class="cfop-sub">${cfop.f2lTotalMoves}手/${cfop.f2lTotalTps.toFixed(1)}</span>
      </div>
      <div class="cfop-card ${cfop.is2LookOll ? 'clickable' : ''}" id="btn-toggle-oll">
        <span class="cfop-label">${ollIconHtml} OLL ${cfop.is2LookOll ? '<span id="arrow-oll">▼</span>' : ''}</span>
        <span class="cfop-val ${cfop.ollSkip ? 'cfop-skip' : ''}">${cfop.ollSkip ? 'Skip' : cfop.oll.toFixed(2) + 's'}</span>
        <span class="cfop-sub">${cfop.ollSkip ? '-' : `${cfop.ollMoves}手/${cfop.ollTps.toFixed(1)}`}</span>
      </div>
      <div class="cfop-card clickable" id="btn-toggle-pll">
        <span class="cfop-label">${pllIconHtml} PLL <span id="arrow-pll">▼</span></span>
        <span class="cfop-val ${cfop.pllSkip && cfop.auf < 0.01 ? 'cfop-skip' : ''}">${cfop.pllSkip && cfop.auf < 0.01 ? 'Skip' : pllTotalTime.toFixed(2) + 's'}</span>
        <span class="cfop-sub">${cfop.pllSkip && cfop.auf < 0.01 ? '-' : `${pllTotalMoves}手/${pllTotalTps.toFixed(1)}`}</span>
      </div>
    `;

    cfopDetailF2lEl.innerHTML = [0, 1, 2, 3].map((i) => `
      <div class="detail-row">
        <span>F2L Slot ${i + 1}</span>
        <span>${cfop.f2l[i].toFixed(2)}s (${cfop.f2lMoves[i]}手 / ${cfop.f2lTps[i].toFixed(2)} TPS)</span>
      </div>
    `).join('');

    cfopDetailOllEl.innerHTML = cfop.is2LookOll ? `
      <div class="detail-row">
        <span>エッジ (EOLL)</span>
        <span>${cfop.eoll.toFixed(2)}s (${cfop.eollMoves}手 / ${cfop.eollTps.toFixed(2)} TPS)</span>
      </div>
      <div class="detail-row">
        <span style="display:flex;align-items:center;gap:6px;">${renderOllIcon(cfop.collName, 18)} ${cfop.collName || 'コーナー (COLL)'}</span>
        <span>${cfop.coll.toFixed(2)}s (${cfop.collMoves}手 / ${cfop.collTps.toFixed(2)} TPS)</span>
      </div>
    ` : '';

    cfopDetailPllEl.innerHTML = `
      <div class="detail-row">
        <span style="display:flex;align-items:center;gap:6px;">${renderPllIcon(cfop.pllName, 18)} ${cfop.pllName || 'PLL実行'}</span>
        <span class="${cfop.pllSkip ? 'cfop-skip' : ''}">${cfop.pllSkip ? '0.00s (Skip)' : `${cfop.pll.toFixed(2)}s (${cfop.pllMoves}手 / ${cfop.pllTps.toFixed(2)} TPS)`}</span>
      </div>
      <div class="detail-row">
        <span>AUF</span>
        <span>${cfop.auf.toFixed(2)}s (${cfop.aufMoves}手 / ${cfop.aufTps.toFixed(2)} TPS)</span>
      </div>
    `;

    cfopDetailF2lEl.classList.remove('open');
    cfopDetailOllEl.classList.remove('open');
    cfopDetailPllEl.classList.remove('open');

    const btnF2l = document.getElementById('btn-toggle-f2l');
    const btnOll = document.getElementById('btn-toggle-oll');
    const btnPll = document.getElementById('btn-toggle-pll');
    const arrowF2l = document.getElementById('arrow-f2l');
    const arrowOll = document.getElementById('arrow-oll');
    const arrowPll = document.getElementById('arrow-pll');

    function closeAllDetails() {
      cfopDetailF2lEl.classList.remove('open');
      cfopDetailOllEl.classList.remove('open');
      cfopDetailPllEl.classList.remove('open');
      btnF2l.classList.remove('active');
      btnOll.classList.remove('active');
      btnPll.classList.remove('active');
      arrowF2l.textContent = '▼';
      if (arrowOll) arrowOll.textContent = '▼';
      arrowPll.textContent = '▼';
    }

    btnF2l.addEventListener('click', () => {
      const wasOpen = cfopDetailF2lEl.classList.contains('open');
      closeAllDetails();
      if (!wasOpen) {
        cfopDetailF2lEl.classList.add('open');
        btnF2l.classList.add('active');
        arrowF2l.textContent = '▲';
      }
    });

    if (cfop.is2LookOll) {
      btnOll.addEventListener('click', () => {
        const wasOpen = cfopDetailOllEl.classList.contains('open');
        closeAllDetails();
        if (!wasOpen) {
          cfopDetailOllEl.classList.add('open');
          btnOll.classList.add('active');
          arrowOll.textContent = '▲';
        }
      });
    }

    btnPll.addEventListener('click', () => {
      const wasOpen = cfopDetailPllEl.classList.contains('open');
      closeAllDetails();
      if (!wasOpen) {
        cfopDetailPllEl.classList.add('open');
        btnPll.classList.add('active');
        arrowPll.textContent = '▲';
      }
    });

    cfopPanelEl.style.display = 'block';
  }

  // 記録された手を再生しても完成しない場合の表示。
  // 誤った分割（全部Crossなど）を出すくらいなら、分析不可と明示する。
  function renderAnalysisUnavailable() {
    totalStatsEl.textContent = '分析不可';
    totalStatsEl.style.display = 'block';

    cfopSummaryEl.innerHTML = `
      <div class="cfop-unavailable">
        <div class="cfop-unavailable-title">⚠ 分析不可</div>
        <div class="cfop-unavailable-text">記録された手を再生しても完成しませんでした。手の取りこぼし等が起きた可能性があります（タイムは有効です）。</div>
      </div>
    `;
    cfopDetailF2lEl.innerHTML = '';
    cfopDetailOllEl.innerHTML = '';
    cfopDetailPllEl.innerHTML = '';
    cfopDetailF2lEl.classList.remove('open');
    cfopDetailOllEl.classList.remove('open');
    cfopDetailPllEl.classList.remove('open');

    cfopPanelEl.style.display = 'block';
  }

  window.App.cfop = {
    OLL_CASES,
    PLL_ALGS,
    MAX_SLICE_BRANCH_PAIRS,
    detectSlicePair,
    isUniformSolved,
    renderOllIcon,
    renderPllIcon,
    cleanMoveHistory,
    postProcessSolve,
    analyzeCFOP,
    renderCFOP,
    renderAnalysisUnavailable
  };
})();