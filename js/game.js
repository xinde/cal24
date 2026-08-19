/* =========================================================
 * 24点 游戏主逻辑 — 分步计算版
 * 玩法: 每次从数字池选 2 个数字 + 1 个运算符, 得出结果
 *       结果自动投入池中继续参与运算, 直到只剩 1 个数,
 *       若等于 24 则提交答案。
 * ========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  const CHALLENGE_SECONDS = 90;
  const Frac = Solver.Frac;

  /* ---------- 持久化 ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  /* ---------- 游戏状态 ---------- */
  let state = {
    pool: [],        // [{id, value: Frac, kind:'card'|'result', suit?, rank?, leaving?}]
    history: [],     // [{a, op, b, result, poolAfter}]  poolAfter = 该步之后的池快照
    sel: [],         // 选中的池项 id 数组 (有序, 最多 2)
    cards: [],       // 本局原始 4 张牌 {value, suit}
    mode: 'timer',
    round: 1,
    streak: 0,
    solved: 0,
    best: Infinity,
    solution: [],
    started: false,
    over: false,     // 已提交/超时/公布 → 本局结束
    elapse: 0,
    timerId: null,
    winTimer: null,      // 胜局结算定时器 (400ms 后 onCorrect)
    overlayTimer: null,  // 成绩浮层定时器 (onCorrect 后 1200ms)
    hintsLeft: 2,
    challengeLeft: CHALLENGE_SECONDS
  };
  let idSeq = 0;

  /* ---------- DOM 引用 ---------- */
  const els = {
    pool: $('pool'), poolHint: $('poolHint'),
    steps: $('steps'),
    timer: $('timer'), best: $('best'), streak: $('streak'),
    roundInfo: $('roundInfo'),
    message: $('message'), answer: $('answer'),
    hintLeft: $('hintLeft'),
    overlay: $('overlay'), overlayBadge: $('overlayBadge'),
    overlayTitle: $('overlayTitle'), overlayRows: $('overlayRows')
  };

  /* =========================================================
   * 工具
   * ========================================================= */
  const fmtFrac = (f) => {
    if (f.d === 1) return String(f.n);
    return `${f.n}/${f.d}`;
  };

  function cloneFrac(f) { return new Frac(f.n, f.d); }
  function cloneItem(it) {
    return { id: it.id, value: cloneFrac(it.value), kind: it.kind, suit: it.suit, rank: it.rank, label: it.label, leaving: false };
  }

  function setMessage(text, kind = '') {
    const el = els.message;
    el.textContent = text;
    el.className = 'message show ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3400);
  }
  function clearMessage() { els.message.className = 'message'; els.message.textContent = ''; }

  function showAnswer(html, kind = 'gold') {
    els.answer.innerHTML = html;
    els.answer.className = 'answer show ' + kind;
  }
  function clearAnswer() { els.answer.className = 'answer'; els.answer.innerHTML = ''; }

  const fmtTime = (sec) => {
    if (!isFinite(sec)) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}′${String(Math.floor(s)).padStart(2, '0')}″` : `${s.toFixed(1)}s`;
  };

  /* =========================================================
   * 数字池渲染
   * ========================================================= */
  function chipSizeClass(label) {
    if (!label) return '';
    if (label.length >= 4) return 'chip-xs';
    if (label.length === 3) return 'chip-sm';
    return '';
  }

  function cardFaceHTML(card) {
    const col = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'dark';
    const r = RANK[card.value] || String(card.value);
    return `
      <div class="corner tl"><b>${r}</b><i>${card.suit}</i></div>
      <div class="corner br"><b>${r}</b><i>${card.suit}</i></div>
      <div class="pips"><span class="big-rank">${r}</span><span class="big-suit">${card.suit}</span></div>`;
  }

  function createChipEl(item, idx) {
    const el = document.createElement('div');
    el.className = 'pchip ' + (item.kind === 'card' ? 'card-chip ' + ((item.suit === '♥' || item.suit === '♦') ? 'red' : 'dark') : 'result-chip');
    el.dataset.id = item.id;
    if (item.kind === 'result') {
      el.innerHTML = `<span class="result-val ${chipSizeClass(item.label)}">${item.label}</span>`;
    } else {
      el.innerHTML = cardFaceHTML(item);
    }
    if (item.leaving) el.classList.add('leaving');
    if (item.entering) el.classList.add('entering');
    if (idx != null) {
      el.style.setProperty('--i', `${idx * 0.12}s`);
      el.style.setProperty('--spin', `${(idx - 1.5) * 7 - 4}deg`);
      if (item.kind === 'card') el.classList.add('dealt');
    }
    return el;
  }

  function renderPool() {
    els.pool.innerHTML = '';
    state.pool.forEach((item, i) => {
      const el = createChipEl(item, state.dealing ? i : null);
      els.pool.appendChild(el);
    });
  }

  function dealAnimPositions() {
    requestAnimationFrame(() => {
      const rect = els.pool.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      Array.from(els.pool.children).forEach((el) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--dx', (r.left + r.width / 2 - cx).toFixed(1));
      });
    });
  }

  /** 更新选中态视觉 */
  function syncSelection() {
    Array.from(els.pool.children).forEach((el) => {
      const id = +el.dataset.id;
      el.classList.remove('sel1', 'sel2');
      const i = state.sel.indexOf(id);
      if (i === 0) el.classList.add('sel1');
      if (i === 1) el.classList.add('sel2');
    });
    // 运算符按钮激活态
    const ready = state.sel.length === 2 && !state.over;
    document.querySelectorAll('.op').forEach(b => b.classList.toggle('ready', ready));
    // 提示文字
    const hint = els.poolHint;
    if (state.over) {
      hint.textContent = '';
    } else if (state.pool.length === 1) {
      hint.textContent = state.pool[0].value.eq(Frac.of(24)) ? '结果 = 24!' : '只剩一个数字, 不等于 24, 撤销重试';
    } else if (state.sel.length === 2) {
      hint.textContent = '请选择运算符 (+ − × ÷)';
    } else if (state.sel.length === 1) {
      hint.textContent = '已选 1 个, 再选 1 个';
    } else {
      hint.textContent = '选择两个数字, 再点运算符得出结果';
    }
  }

  /* =========================================================
   * 步骤历史
   * ========================================================= */
  function renderSteps() {
    els.steps.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.history.forEach((h, i) => {
      const el = document.createElement('button');
      el.className = 'step';
      el.dataset.index = i;
      el.title = '回退到这里';
      el.innerHTML = `
        <span class="st-a">${h.a.label}</span>
        <span class="st-op">${h.op}</span>
        <span class="st-b">${h.b.label}</span>
        <span class="st-eq">=</span>
        <span class="st-res">${h.result.label}</span>`;
      frag.appendChild(el);
    });
    els.steps.appendChild(frag);
  }

  /** 回退到第 index 步之后的状态 (index = -1 回到初始) */
  function rewindTo(index) {
    if (state.over) return;
    if (index < -1 || index >= state.history.length) return;
    if (index === -1) {
      // 回到初始: 只保留原始 4 张牌
      state.pool = state.cards.map(c => ({
        id: ++idSeq, value: Frac.of(c.value), kind: 'card', suit: c.suit, rank: c.value, label: String(c.value)
      }));
      state.history = [];
    } else {
      state.pool = state.history[index].poolAfter.map(cloneItem);
      state.history = state.history.slice(0, index + 1);
    }
    state.sel = [];
    renderPool();
    renderSteps();
    syncSelection();
  }

  function undo() {
    if (state.over) return;
    if (state.history.length === 0) {
      setMessage('没有可撤销的步骤', 'warn');
      return;
    }
    rewindTo(state.history.length - 2);
    Sfx.click();
  }

  /* =========================================================
   * 选择交互
   * ========================================================= */
  function toggleSelect(id) {
    const i = state.sel.indexOf(id);
    if (i !== -1) {
      state.sel.splice(i, 1);
    } else {
      if (state.sel.length >= 2) state.sel.shift(); // 已满 2 个则替换最早选中的
      state.sel.push(id);
    }
    syncSelection();
    Sfx.click();
  }

  /* =========================================================
   * 计算一步
   * ========================================================= */
  function compute(op) {
    if (state.over) return;
    if (state.pool.length <= 1) {
      setMessage(state.pool[0] && state.pool[0].value.eq(Frac.of(24)) ? '已经算出 24 了, 提交答案吧' : '数字不够, 先发牌吧', 'warn');
      return;
    }
    if (state.sel.length < 2) {
      setMessage('先选两个数字, 再点运算符', 'warn');
      return;
    }
    const [idA, idB] = state.sel;
    const a = state.pool.find(i => i.id === idA);
    const b = state.pool.find(i => i.id === idB);
    if (!a || !b) { state.sel = []; syncSelection(); return; }

    let res;
    try {
      switch (op) {
        case '+': res = a.value.add(b.value); break;
        case '-': res = a.value.sub(b.value); break;
        case '*': res = a.value.mul(b.value); break;
        case '/':
          if (b.value.n === 0) throw new Error('div0');
          res = a.value.div(b.value);
          break;
      }
    } catch (e) {
      setMessage('不能除以 0, 换个数字试试', 'error');
      Sfx.wrong();
      shakeOps();
      return;
    }

    // 动画: 两个选中数字飞出, 结果弹出
    const elA = els.pool.querySelector(`.pchip[data-id="${idA}"]`);
    const elB = els.pool.querySelector(`.pchip[data-id="${idB}"]`);
    if (elA) elA.classList.add('leaving');
    if (elB) elB.classList.add('leaving');

    const resultLabel = fmtFrac(res);
    const resultItem = { id: ++idSeq, value: res, kind: 'result', label: resultLabel, entering: true };
    const resultEl = createChipEl(resultItem);
    els.pool.appendChild(resultEl);

    // 逻辑池更新
    state.pool = state.pool.filter(i => i.id !== idA && i.id !== idB);
    state.pool.push(resultItem);

    // 记录历史 (含该步之后的池快照)
    const poolAfter = state.pool.map(cloneItem);
    const historyEntry = {
      a: { label: a.label, value: cloneFrac(a.value) },
      op, b: { label: b.label, value: cloneFrac(b.value) },
      result: { label: resultLabel, value: cloneFrac(res) },
      poolAfter
    };
    state.history.push(historyEntry);
    state.sel = [];

    renderSteps();
    const lastStep = els.steps.lastElementChild;
    if (lastStep) lastStep.classList.add('entering');
    syncSelection();

    // 结果特效: 火花 + 冲击波 + 音效
    const rect = resultEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    Fx.sparks(cx, cy, 16, '#f6c453');
    Fx.sparks(cx, cy, 8, '#3ee6ff');
    Fx.ring(cx, cy, '#f6c453');
    Sfx.click();

    // 清除离场元素
    setTimeout(() => {
      state.pool = state.pool.filter(i => !i.leaving);
      Array.from(els.pool.children).forEach(c => {
        if (c.classList.contains('leaving')) c.remove();
      });
    }, 520);

    // 是否只剩一个数 -> 自动结算
    if (state.pool.length === 1) {
      const v = state.pool[0];
      els.pool.classList.add('done');
      if (v.value.eq(Frac.of(24))) {
        // 等于 24: 立即锁定本局, 防止在结算动画期间撤销/误操作
        state.over = true;
        // 自动结算 (延迟一点让结果弹出动画播完); 存句柄以便 deal 时取消
        state.winTimer = setTimeout(() => {
          state.winTimer = null;
          Fx.flash('#f6c453', 0.16, 420);
          Fx.confettiBurst(cx, cy, { count: 60, power: 1 });
          Sfx.reveal();
          onCorrect();
        }, 400);
      } else {
        setMessage(`结果是 ${v.label}, 不等于 24, 可撤销重试`, 'error');
        Sfx.wrong();
      }
    }
  }

  function shakeOps() {
    const ops = document.querySelector('.ops');
    ops.classList.remove('shake');
    void ops.offsetWidth;
    ops.classList.add('shake');
  }

  /* =========================================================
   * 发牌
   * ========================================================= */
  function randomCard() {
    // 只发 A–10 (1–10), 排除 J/Q/K
    return { value: 1 + ((Math.random() * 10) | 0), suit: SUITS[(Math.random() * 4) | 0] };
  }

  function deal() {
    stopTimer();
    clearWinTimers();   // 取消未触发的胜局结算/浮层, 防止幻影结算
    clearMessage();
    clearAnswer();
    state.over = false;
    state.sel = [];
    state.hintsLeft = 2;
    $('hintLeft').textContent = '×' + state.hintsLeft;
    els.pool.classList.remove('done', 'won', 'answered');

    let cards;
    do {
      cards = [randomCard(), randomCard(), randomCard(), randomCard()];
    } while (!Solver.isSolvable(cards.map(c => c.value)));

    state.cards = cards;
    state.solution = Solver.solve(cards.map(c => c.value));
    state.pool = cards.map(c => ({ id: ++idSeq, value: Frac.of(c.value), kind: 'card', suit: c.suit, rank: c.value, label: String(c.value) }));
    state.history = [];
    state.dealing = true;

    $('roundInfo').textContent = `第 ${state.round} 局`;
    if (state.mode === 'count') {
      els.timer.textContent = fmtTime(CHALLENGE_SECONDS);
      els.timer.classList.remove('urgent');
    } else {
      els.timer.textContent = '00.0s';
    }
    els.timer.classList.remove('win');

    renderPool();
    renderSteps();
    syncSelection();
    dealAnimPositions();
    Sfx.deal();

    // 落地动画: 火花 + 冲击波
    state.pool.forEach((_, i) => {
      setTimeout(() => {
        const el = els.pool.children[i];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        Fx.sparks(cx, cy, 14, '#f6c453');
        Fx.sparks(cx, cy, 6, '#3ee6ff');
        Fx.ring(cx, cy, '#f6c453');
      }, 470 + i * 110);
    });
    state.cards.forEach((_, i) => {
      setTimeout(() => {
        const el = els.pool.children[i];
        if (el) el.classList.remove('dealt');
      }, 580 + i * 110);
    });
    state.dealing = false;

    startTimer();
  }

  /* =========================================================
   * 计时器
   * ========================================================= */
  function tick() {
    state.elapse += 0.1;
    if (state.mode === 'count') {
      state.challengeLeft = Math.max(0, CHALLENGE_SECONDS - state.elapse);
      els.timer.textContent = fmtTime(state.challengeLeft);
      els.timer.classList.toggle('urgent', state.challengeLeft <= 10);
      if (state.challengeLeft <= 5.05 && state.challengeLeft > 0 && Math.abs(state.challengeLeft - Math.round(state.challengeLeft)) < 0.06) {
        Sfx.tick();
      }
      if (state.challengeLeft <= 0) {
        stopTimer();
        onTimeUp();
      }
    } else {
      els.timer.textContent = fmtTime(state.elapse);
    }
  }

  function startTimer() {
    stopTimer();
    state.elapse = 0;
    state.challengeLeft = CHALLENGE_SECONDS;
    if (state.mode === 'count') els.timer.textContent = fmtTime(state.challengeLeft);
    else els.timer.textContent = '00.0s';
    state.started = true;
    state.timerId = setInterval(tick, 100);
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  /** 取消待触发的胜局结算/成绩浮层定时器 (发新牌/超时/公布时调用, 防止幻影结算) */
  function clearWinTimers() {
    if (state.winTimer) { clearTimeout(state.winTimer); state.winTimer = null; }
    if (state.overlayTimer) { clearTimeout(state.overlayTimer); state.overlayTimer = null; }
  }

  /* =========================================================
   * 自动结算 (由 compute 在只剩一个数且=24时调用)
   * ========================================================= */

  function onCorrect() {
    stopTimer();
    state.over = true;
    state.streak += 1;
    state.solved += 1;

    if (state.mode === 'timer' && state.elapse < state.best) {
      state.best = state.elapse;
      store.set('cal24.best', String(state.best));
    }
    store.set('cal24.streak', String(state.streak));
    store.set('cal24.solved', String(state.solved));
    updateStats();

    els.pool.classList.add('won');
    els.timer.classList.add('win');
    Fx.celebrate();
    Fx.flash('#f6c453', 0.22, 480);
    Sfx.correct();
    // 等卡片胜利动画 + 彩带播完再弹成绩浮层; 存句柄以便 deal 时取消
    state.overlayTimer = setTimeout(() => {
      state.overlayTimer = null;
      showOverlay();
    }, 1200);
  }

  function updateStats() {
    els.best.textContent = fmtTime(state.best);
    els.streak.textContent = state.streak;
  }

  function showOverlay() {
    const rows = [];
    if (state.mode === 'timer') {
      rows.push(['本局用时', fmtTime(state.elapse)]);
      rows.push(['历史最佳', fmtTime(state.best)]);
    } else {
      rows.push(['剩余时间', fmtTime(state.challengeLeft)]);
    }
    rows.push(['当前连对', `${state.streak} 局`]);
    rows.push(['累计答对', `${state.solved} 局`]);

    els.overlayBadge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.5 14l-2 7 5.5-3 5.5 3-2-7"/></svg>';
    els.overlayTitle.textContent = '太棒了! 算出 24!';
    els.overlayRows.innerHTML = rows.map(([k, v]) =>
      `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    els.overlay.hidden = false;
    void els.overlay.offsetWidth;
    els.overlay.classList.add('show');
  }

  function hideOverlay() {
    els.overlay.classList.remove('show');
    els.overlay.hidden = true;
  }

  /* =========================================================
   * 提示: 基于当前数字池重新求解, 高亮第一步涉及的两个数字
   * ========================================================= */

  /** 在当前数字池上做分步 DFS, 找到通往 24 的第一步 {aVal, bVal, op, resVal} */
  function findFirstStepFromPool() {
    const OPS = ['+', '-', '*', '/'];
    function rec(arr, path) {
      if (arr.length === 1) return arr[0].eq(Frac.of(24)) ? path[0] : null;
      for (let i = 0; i < arr.length; i++) {
        for (let j = 0; j < arr.length; j++) {
          if (i === j) continue;
          for (const op of OPS) {
            let r;
            try {
              if (op === '+') r = arr[i].add(arr[j]);
              else if (op === '-') r = arr[i].sub(arr[j]);
              else if (op === '*') r = arr[i].mul(arr[j]);
              else { if (arr[j].n === 0) continue; r = arr[i].div(arr[j]); }
            } catch (e) { continue; }
            const next = arr.filter((_, k) => k !== i && k !== j);
            next.push(r);
            const out = rec(next, path.concat([{ i, j, op, r }]));
            if (out) return out;
          }
        }
      }
      return null;
    }
    const vals = state.pool.map(it => cloneFrac(it.value));
    return rec(vals, []);
  }

  function hint() {
    if (state.over) return;
    if (state.hintsLeft <= 0) {
      setMessage('提示已用完, 直接公布答案吧', 'warn');
      return;
    }
    if (state.pool.length <= 1) {
      setMessage(state.pool[0] && state.pool[0].value.eq(Frac.of(24)) ? '已经是 24 了' : '只剩一个数, 撤销重试吧', 'warn');
      return;
    }
    const step = findFirstStepFromPool();

    if (!step) {
      setMessage('从当前局面已无法凑出 24, 试试撤销重来', 'warn');
      return;   // 不消耗次数
    }
    state.hintsLeft--;
    $('hintLeft').textContent = '×' + state.hintsLeft;
    const aVal = state.pool[step.i].value;
    const bVal = state.pool[step.j].value;
    const opChar = { '+': '+', '-': '-', '*': '×', '/': '÷' }[step.op];
    const pretty = `${fmtFrac(aVal)} ${opChar} ${fmtFrac(bVal)} = ${fmtFrac(step.r)}`;
    setMessage(`提示: 先算 ${pretty}`, 'info');
    // 高亮池中这两个数字 (按 id 直接定位, 保证选对)
    state.sel = [state.pool[step.i].id, state.pool[step.j].id];
    syncSelection();
    Fx.sparks(innerWidth / 2, innerHeight * 0.42, 12, '#3ee6ff');
    Sfx.click();
  }

  /* =========================================================
   * 公布答案
   * ========================================================= */
  function reveal() {
    if (state.over) return;
    state.over = true;
    pauseTimer();
    const sol = state.solution[0];
    if (!sol) {
      setMessage('这局没有解, 发新牌吧', 'warn');
      state.over = false;
      return;
    }
    els.pool.classList.add('answered');
    const pretty = Solver.prettyExpr(sol);
    const nums = pretty.split(/([×÷])/).map(part => {
      if (part === '×' || part === '÷') return `<i>${part}</i>`;
      if (/^\d+$/.test(part)) return `<b>${part}</b>`;
      return part;
    }).join('');
    showAnswer(`答案是: <span class="ans-expr">${nums}</span>`, 'gold');
    Fx.ring(innerWidth / 2, innerHeight * 0.42, '#f6c453');
    Fx.sparks(innerWidth / 2, innerHeight * 0.42, 24, '#f6c453');
    Fx.flash('#3ee6ff', 0.15, 420);
    Sfx.reveal();
  }

  function pauseTimer() { stopTimer(); }

  function onTimeUp() {
    // 若已结算/已公布/已开新局, 忽略到点回调, 避免与胜局结算竞争显示矛盾
    if (state.over) return;
    state.over = true;
    clearWinTimers();
    const sol = state.solution[0];
    els.pool.classList.add('answered');
    if (sol) {
      showAnswer(`时间到! 答案是: <span class="ans-expr">${Solver.prettyExpr(sol)}</span>`, 'red');
    } else {
      showAnswer('时间到! 这局无解', 'red');
    }
    Sfx.reveal();
  }

  /* =========================================================
   * 模式切换
   * ========================================================= */
  function setMode(mode) {
    state.mode = mode;
    $('modeTimer').classList.toggle('is-on', mode === 'timer');
    $('modeCount').classList.toggle('is-on', mode === 'count');
    stopTimer();
    state.elapse = 0;
    state.challengeLeft = CHALLENGE_SECONDS;
    els.timer.classList.remove('urgent', 'win');
    els.timer.textContent = mode === 'count' ? fmtTime(CHALLENGE_SECONDS) : '00.0s';
    state.started = false;
    // 若一局正在进行中 (未结束), 切换模式后立即重启计时, 避免时钟冻结
    if (!state.over && state.pool.length > 0) startTimer();
  }

  /* =========================================================
   * 事件绑定
   * ========================================================= */
  function bindEvents() {
    // 点数字池
    els.pool.addEventListener('click', (e) => {
      const chip = e.target.closest('.pchip');
      if (!chip || state.over) return;
      if (chip.classList.contains('leaving')) return;
      toggleSelect(+chip.dataset.id);
    });

    // 运算符
    document.querySelectorAll('.op').forEach(btn => {
      btn.addEventListener('click', () => compute(btn.dataset.op));
    });

    // 历史步骤点击 → 回退
    els.steps.addEventListener('click', (e) => {
      const step = e.target.closest('.step');
      if (!step || state.over) return;
      rewindTo(+step.dataset.index);
    });

    $('deal').addEventListener('click', deal);
    $('hint').addEventListener('click', hint);
    $('reveal').addEventListener('click', reveal);
    $('undo').addEventListener('click', undo);
    $('overlayOk').addEventListener('click', () => {
      hideOverlay();
      state.round += 1;
      deal();
    });

    $('modeTimer').addEventListener('click', () => setMode('timer'));
    $('modeCount').addEventListener('click', () => setMode('count'));

    const soundBtn = $('soundBtn');
    const svgSoundOn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    const svgSoundOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
    function syncSound() { soundBtn.innerHTML = Sfx.muted ? svgSoundOff : svgSoundOn; soundBtn.setAttribute('aria-pressed', String(!Sfx.muted)); }
    syncSound();
    soundBtn.addEventListener('click', () => { Sfx.toggleMute(); syncSound(); });

    // 键盘
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // 发牌 / 取消选中 在任何状态下都可用 (即便本局已结束), 方便随时开新局
      if (e.key === ' ') { e.preventDefault(); deal(); return; }
      if (e.key === 'Escape') { state.sel = []; syncSelection(); return; }
      if (state.over) return;
      if (e.key === 'Backspace') { undo(); return; }
      if (['+', '-', '*', '/'].includes(e.key)) { compute(e.key); return; }
      if (/^[1-9]$/.test(e.key)) {
        const d = +e.key;
        const target = state.pool.find(i => !i.leaving && i.value.eq(Frac.of(d)));
        if (target) toggleSelect(target.id);
      }
    });
  }

  /* =========================================================
   * 初始化
   * ========================================================= */
  function init() {
    const best = parseFloat(store.get('cal24.best', 'NaN'));
    state.best = isFinite(best) && best > 0 ? best : Infinity;
    state.streak = parseInt(store.get('cal24.streak', '0'), 10) || 0;
    state.solved = parseInt(store.get('cal24.solved', '0'), 10) || 0;
    updateStats();

    bindEvents();
    Fx.init();
    deal();
  }

  init();
})();
