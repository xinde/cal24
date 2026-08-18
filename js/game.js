/* =========================================================
 * 24点 游戏主逻辑
 * ========================================================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANK = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  const CHALLENGE_SECONDS = 90;

  /* ---------- 持久化 ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  /* ---------- 游戏状态 ---------- */
  let state = {
    cards: [],          // [{value, suit, rank}]
    tokens: [],         // 当前算式 token 数组
    mode: 'timer',      // 'timer' | 'count'
    round: 1,
    streak: 0,
    solved: 0,
    best: Infinity,     // 秒
    solution: [],       // 本局全部解
    started: false,     // 计时是否已开始
    over: false,        // 本局是否已结束(出答案/超时)
    elapse: 0,
    timerId: null,
    hintsLeft: 2,
    challengeLeft: CHALLENGE_SECONDS
  };

  /* ---------- DOM 引用 ---------- */
  const els = {
    cards: $('cards'), felt: $('felt'),
    timer: $('timer'), best: $('best'), streak: $('streak'),
    roundInfo: $('roundInfo'), modeInfo: $('modeInfo'),
    message: $('message'), answer: $('answer'),
    exprTokens: $('exprTokens'), exprPh: $('exprPh'),
    hintLeft: $('hintLeft'),
    overlay: $('overlay'), overlayBadge: $('overlayBadge'),
    overlayTitle: $('overlayTitle'), overlayRows: $('overlayRows'),
  };

  /* =========================================================
   * 帮助函数
   * ========================================================= */
  function fmtTime(sec) {
    if (!isFinite(sec)) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}′${String(Math.floor(s)).padStart(2, '0')}″` : `${s.toFixed(1)}s`;
  }

  function setMessage(text, kind = '') {
    const el = els.message;
    el.textContent = text;
    el.className = 'message show ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3400);
  }

  function clearMessage() {
    els.message.className = 'message';
    els.message.textContent = '';
  }

  function showAnswer(html, kind = 'gold') {
    els.answer.innerHTML = html;
    els.answer.className = 'answer show ' + kind;
  }

  function clearAnswer() {
    els.answer.className = 'answer';
    els.answer.innerHTML = '';
  }

  /* =========================================================
   * 牌面渲染
   * ========================================================= */
  function rankLabel(v) { return RANK[v] || String(v); }

  function cardFaceHTML(card) {
    const col = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'dark';
    const r = rankLabel(card.value);
    return `
      <div class="corner tl"><b>${r}</b><i>${card.suit}</i></div>
      <div class="corner br"><b>${r}</b><i>${card.suit}</i></div>
      <div class="pips" data-suit="${card.suit}">
        <span class="big-rank">${r}</span>
        <span class="big-suit">${card.suit}</span>
      </div>`;
  }

  function createCardEl(card, i) {
    const el = document.createElement('div');
    el.className = 'card dealt';
    el.dataset.value = card.value;
    el.style.setProperty('--i', `${i * 0.12}s`);
    el.style.setProperty('--spin', `${(i - 1.5) * 7 - 4}deg`);
    el.innerHTML = `
      <div class="card-inner">
        <div class="face back"></div>
        <div class="face front ${(card.suit === '♥' || card.suit === '♦') ? 'red' : 'dark'}">${cardFaceHTML(card)}</div>
      </div>`;
    return el;
  }

  function renderCards() {
    els.cards.innerHTML = '';
    state.cards.forEach((card, i) => els.cards.appendChild(createCardEl(card, i)));

    // 计算每张牌相对牌桌中心的水平偏移, 用于发牌聚拢动画
    requestAnimationFrame(() => {
      const cardsRect = els.cards.getBoundingClientRect();
      const centerX = cardsRect.left + cardsRect.width / 2;
      Array.from(els.cards.children).forEach((el) => {
        const rect = el.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - centerX;
        el.style.setProperty('--dx', dx.toFixed(1));
      });
    });

    // 发牌动画: 每张牌落地瞬间迸发金色火花 + 冲击波
    state.cards.forEach((_, i) => {
      setTimeout(() => {
        const el = els.cards.children[i];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        Fx.sparks(cx, cy, 14, '#f6c453');
        Fx.sparks(cx, cy, 6, '#3ee6ff');
        Fx.ring(cx, cy, '#f6c453');
      }, 470 + i * 110);
    });

    // 落地后翻面展示正面
    state.cards.forEach((_, i) => {
      setTimeout(() => {
        const el = els.cards.children[i];
        if (el) el.classList.remove('dealt');
      }, 570 + i * 110);
    });
  }

  /* 根据当前算式, 标记哪些牌已被使用(置灰) */
  function syncUsedState() {
    const usedCount = {};
    state.tokens.forEach(t => { if (/^\d+$/.test(t)) usedCount[t] = (usedCount[t] || 0) + 1; });
    const seen = {};
    Array.from(els.cards.children).forEach((el) => {
      const v = el.dataset.value;
      seen[v] = (seen[v] || 0) + 1;
      const used = (usedCount[v] || 0) >= seen[v];
      el.classList.toggle('used', used);
    });
  }

  /* =========================================================
   * 算式构建
   * ========================================================= */
  function exprRaw() { return state.tokens.join(' '); }

  function renderExpr() {
    els.exprTokens.innerHTML = '';
    const tokens = state.tokens;
    if (tokens.length === 0) {
      els.exprPh.style.display = '';
      return;
    }
    els.exprPh.style.display = 'none';
    tokens.forEach(t => {
      const span = document.createElement('span');
      if (/^\d+$/.test(t)) {
        span.className = 'tok-num';
        span.textContent = t;
      } else if (t === '*' || t === '/') {
        span.className = 'tok-op';
        span.textContent = t === '*' ? '×' : '÷';
      } else if (t === '+' || t === '-') {
        span.className = 'tok-op';
        span.textContent = t;
      } else {
        span.className = 'tok-paren';
        span.textContent = t;
      }
      els.exprTokens.appendChild(span);
    });
    syncUsedState();
  }

  function appendToken(t) {
    // 数字去重校验: 最多使用该牌出现的次数
    if (/^\d+$/.test(t)) {
      const inExpr = state.tokens.filter(x => x === t).length;
      const inDeal = state.cards.filter(c => String(c.value) === t).length;
      if (inExpr >= inDeal) return false;
    }
    state.tokens.push(t);
    renderExpr();
    Sfx.click();
    return true;
  }

  function backspace() {
    if (state.over) return;
    state.tokens.pop();
    renderExpr();
    Sfx.click();
  }

  function clearExpr() {
    if (state.over) return;
    if (state.tokens.length) {
      state.tokens = [];
      renderExpr();
      Sfx.click();
    }
  }

  /* =========================================================
   * 计时器
   * ========================================================= */
  function tick() {
    state.elapse += 0.1;
    updateTimerDisplay();
    if (state.mode === 'count') {
      state.challengeLeft = Math.max(0, CHALLENGE_SECONDS - state.elapse);
      const el = els.timer;
      el.textContent = fmtTime(state.challengeLeft);
      el.classList.toggle('urgent', state.challengeLeft <= 10);
      // 最后 5 秒滴答音
      if (state.challengeLeft <= 5.05 && state.challengeLeft > 0 && Math.abs(state.challengeLeft - Math.round(state.challengeLeft)) < 0.06) {
        Sfx.tick();
      }
      if (state.challengeLeft <= 0) {
        stopTimer();
        onTimeUp();
      }
    }
  }

  function updateTimerDisplay() {
    if (state.mode === 'count') {
      els.timer.textContent = fmtTime(state.challengeLeft);
    } else {
      els.timer.textContent = fmtTime(state.elapse);
    }
  }

  function startTimer() {
    stopTimer();
    state.elapse = 0;
    state.challengeLeft = CHALLENGE_SECONDS;
    updateTimerDisplay();
    state.started = true;
    state.timerId = setInterval(tick, 100);
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function pauseTimer() {
    stopTimer();
  }

  /* =========================================================
   * 发牌
   * ========================================================= */
  function randomCard() {
    return { value: 1 + ((Math.random() * 13) | 0), suit: SUITS[(Math.random() * 4) | 0] };
  }

  function deal() {
    stopTimer();
    clearMessage();
    clearAnswer();
    state.over = false;
    state.hintsLeft = 2;
    $('hintLeft').textContent = '×' + state.hintsLeft;

    // 确保发到有解的牌
    let cards;
    do {
      cards = [randomCard(), randomCard(), randomCard(), randomCard()];
    } while (!Solver.isSolvable(cards.map(c => c.value)));

    state.cards = cards;
    state.tokens = [];
    state.solution = Solver.solve(cards.map(c => c.value));
    renderExpr();

    $('roundInfo').textContent = `第 ${state.round} 局`;

    // 重置计时显示
    if (state.mode === 'count') {
      els.timer.textContent = fmtTime(CHALLENGE_SECONDS);
      els.timer.classList.remove('urgent');
    } else {
      els.timer.textContent = '00.0s';
    }
    els.timer.classList.remove('win');

    renderCards();
    Sfx.deal();
    startTimer();
  }

  /* =========================================================
   * 提交
   * ========================================================= */
  function submit() {
    if (state.over) return;
    const raw = exprRaw();
    if (state.tokens.length === 0) {
      setMessage('先把 4 张牌都放进算式里呀', 'warn');
      return;
    }

    // 1) 数字必须恰好等于 4 张牌
    const nums = Solver.numbersInExpr(raw);
    const dealNums = state.cards.map(c => c.value).slice().sort((a, b) => a - b);
    const sortedNums = nums.slice().sort((a, b) => a - b);
    if (sortedNums.join(',') !== dealNums.join(',')) {
      setMessage('必须恰好使用这 4 张牌各一次', 'error');
      Sfx.wrong();
      shakeExpr();
      return;
    }

    // 2) 求值
    let val;
    try {
      val = Solver.evaluateExpr(raw);
    } catch (e) {
      setMessage('算式不完整或括号不匹配', 'error');
      Sfx.wrong();
      shakeExpr();
      return;
    }

    // 3) 判断 24
    if (val.eq(Solver.Frac.of(24))) {
      onCorrect();
    } else {
      const pretty = val.d === 1 ? String(val.n) : `${val.n}/${val.d}`;
      setMessage(`差一点! 这个算式算出来是 ${pretty}`, 'error');
      Sfx.wrong();
      shakeExpr();
    }
  }

  function shakeExpr() {
    const d = $('exprDisplay');
    d.classList.remove('shake');
    void d.offsetWidth;
    d.classList.add('shake');
  }

  function onCorrect() {
    stopTimer();
    state.over = true;
    state.streak += 1;
    state.solved += 1;

    // 最佳成绩
    if (state.mode === 'timer' && state.elapse < state.best) {
      state.best = state.elapse;
      store.set('cal24.best', String(state.best));
    }
    store.set('cal24.streak', String(state.streak));
    store.set('cal24.solved', String(state.solved));
    updateStats();

    // 特效
    els.cards.classList.add('won');
    els.timer.classList.add('win');
    Fx.celebrate();
    Fx.flash('#f6c453', 0.22, 480);
    Sfx.correct();

    // 弹出结算
    showOverlay();
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

    els.overlayBadge.textContent = state.mode === 'count' && state.challengeLeft <= 0 ? '⏰' : '🎉';
    els.overlayTitle.textContent = state.mode === 'count' && state.challengeLeft <= 0 ? '时间到!' : '太棒了! 答对了!';
    els.overlayRows.innerHTML = rows.map(([k, v]) =>
      `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    els.overlay.hidden = false;
    void els.overlay.offsetWidth; // 强制回流, 确保先计算 opacity:0 再触发过渡
    els.overlay.classList.add('show');
  }

  function hideOverlay() {
    els.overlay.classList.remove('show');
    els.overlay.hidden = true;
  }

  /* =========================================================
   * 提示
   * ========================================================= */
  function hint() {
    if (state.over) return;
    if (state.hintsLeft <= 0) {
      setMessage('提示已用完, 直接公布答案吧', 'warn');
      return;
    }
    const sol = state.solution[0];
    if (!sol) { setMessage('这局无解... 换个牌吧', 'warn'); return; }
    const step = Solver.firstStep(sol);
    state.hintsLeft--;
    $('hintLeft').textContent = '×' + state.hintsLeft;
    if (step) {
      const pretty = Solver.prettyExpr(step.sub).replace(/[()]/g, '');
      const val = step.val.d === 1 ? String(step.val.n) : `${step.val.n}/${step.val.d}`;
      setMessage(`提示: 先算 ${pretty} = ${val}, 继续加油!`, 'info');
    } else {
      setMessage(`提示: ${Solver.prettyExpr(sol)}`, 'info');
    }
    Fx.sparks(innerWidth / 2, innerHeight * 0.45, 12, '#3ee6ff');
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
      return;
    }
    els.cards.classList.add('answered');
    const pretty = Solver.prettyExpr(sol);
    const nums = pretty.split(/([×÷])/).map(part => {
      if (part === '×' || part === '÷') return `<i>${part}</i>`;
      if (/^\d+$/.test(part)) return `<b>${part}</b>`;
      return part;
    }).join('');
    showAnswer(`答案是: <span class="ans-expr">${nums}</span>`, 'gold');
    Fx.ring(innerWidth / 2, innerHeight * 0.45, '#f6c453');
    Fx.sparks(innerWidth / 2, innerHeight * 0.45, 24, '#f6c453');
    Fx.flash('#3ee6ff', 0.15, 420);
    Sfx.reveal();
  }

  function onTimeUp() {
    state.over = true;
    const sol = state.solution[0];
    els.cards.classList.add('answered');
    if (sol) {
      const pretty = Solver.prettyExpr(sol);
      showAnswer(`时间到! 答案是: <span class="ans-expr">${pretty}</span>`, 'red');
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
    els.modeInfo.textContent = mode === 'timer' ? '计时模式' : '挑战 90 秒';
    els.modeInfo.className = 'chip ' + (mode === 'timer' ? 'chip-cyan' : 'chip-magenta');
    // 切换模式时重置当前局计时显示
    stopTimer();
    state.elapse = 0;
    state.challengeLeft = CHALLENGE_SECONDS;
    els.timer.classList.remove('urgent', 'win');
    updateTimerDisplay();
    state.started = false;
  }

  /* =========================================================
   * 事件绑定
   * ========================================================= */
  function bindEvents() {
    // 点牌: 插入该牌数字
    els.cards.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card || state.over) return;
      if (card.classList.contains('used')) {
        setMessage('这张牌已经用过了', 'warn');
        Sfx.wrong();
        return;
      }
      appendToken(card.dataset.value);
    });

    // 运算符按键
    document.querySelectorAll('.key').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.over) return;
        appendToken(btn.dataset.op);
      });
    });

    $('backspace').addEventListener('click', backspace);
    $('clearExpr').addEventListener('click', clearExpr);
    $('submit').addEventListener('click', submit);
    $('deal').addEventListener('click', deal);
    $('hint').addEventListener('click', hint);
    $('reveal').addEventListener('click', reveal);
    $('overlayOk').addEventListener('click', () => {
      hideOverlay();
      state.round += 1;
      deal();
    });

    $('modeTimer').addEventListener('click', () => setMode('timer'));
    $('modeCount').addEventListener('click', () => setMode('count'));

    const soundBtn = $('soundBtn');
    function syncSound() { soundBtn.textContent = Sfx.muted ? '🔇' : '🔊'; soundBtn.setAttribute('aria-pressed', String(!Sfx.muted)); }
    syncSound();
    soundBtn.addEventListener('click', () => { Sfx.toggleMute(); syncSound(); });

    // 键盘
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Enter') { submit(); return; }
      if (e.key === ' ') { e.preventDefault(); deal(); return; }
      if (e.key === 'Escape') { clearExpr(); return; }
      if (e.key === 'Backspace') { backspace(); return; }
      if (['+', '-', '*', '/', '(', ')'].includes(e.key)) { appendToken(e.key); return; }
      if (/^[1-9]$/.test(e.key)) { appendToken(e.key); return; }
    });
  }

  /* =========================================================
   * 初始化
   * ========================================================= */
  function init() {
    // 读取持久化数据
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
