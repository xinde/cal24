/* =========================================================
 * 24点 求解器 (Solver)
 * 精确有理数运算, 支持 + - * / 与括号, 穷举全部 4 数组合
 * ========================================================= */
(function (global) {
  'use strict';

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }

  /** 精确分数, 避免浮点误差 (如 3 ÷ 2 = 1.5 精确表示) */
  class Frac {
    constructor(n, d = 1) {
      if (d === 0) throw new Error('division by zero');
      const g = gcd(n, d);
      n /= g; d /= g;
      if (d < 0) { n = -n; d = -d; }
      this.n = n; this.d = d;
    }
    static of(n) { return new Frac(n, 1); }
    add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
    div(o) { if (o.n === 0) throw new Error('division by zero'); return new Frac(this.n * o.d, this.d * o.n); }
    eq(o) { return this.n === o.n && this.d === o.d; }
    valueOf() { return this.n / this.d; }
    toString() {
      if (this.d === 1) return String(this.n);
      return this.n + '/' + this.d;
    }
  }

  /* ---------- 词法 / 语法分析 ---------- */
  function tokenize(s) {
    const out = [];
    const re = /\d+|[+\-*/()]/g;
    let m;
    while ((m = re.exec(s))) {
      const t = m[0];
      if (/^\d+$/.test(t)) out.push({ type: 'num', v: parseInt(t, 10) });
      else if (t === '+' || t === '-' || t === '*' || t === '/') out.push({ type: 'op', v: t });
      else if (t === '(') out.push({ type: 'lparen' });
      else if (t === ')') out.push({ type: 'rparen' });
      else return null;
    }
    return out;
  }

  /** 解析算式为分数结果, 非法或除零时抛出 */
  function evaluateExpr(str) {
    const tokens = tokenize(str);
    if (!tokens || tokens.length === 0) throw new Error('empty');
    let p = 0;
    const peek = () => tokens[p];
    const consume = () => tokens[p++];

    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().type === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = consume().v;
        const right = parseTerm();
        left = op === '+' ? left.add(right) : left.sub(right);
      }
      return left;
    }
    function parseTerm() {
      let left = parseFactor();
      while (peek() && peek().type === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = consume().v;
        const right = parseFactor();
        left = op === '*' ? left.mul(right) : left.div(right);
      }
      return left;
    }
    function parseFactor() {
      const t = peek();
      if (!t) throw new Error('unexpected end');
      if (t.type === 'num') { consume(); return Frac.of(t.v); }
      if (t.type === 'lparen') {
        consume();
        const inner = parseExpr();
        if (!peek() || peek().type !== 'rparen') throw new Error('unbalanced (');
        consume();
        return inner;
      }
      throw new Error('unexpected token');
    }

    const result = parseExpr();
    if (p !== tokens.length) throw new Error('trailing tokens');
    return result;
  }

  /** 提取算式中的所有数字 (按出现顺序) */
  function numbersInExpr(str) {
    const tokens = tokenize(str);
    if (!tokens) return [];
    return tokens.filter(t => t.type === 'num').map(t => t.v);
  }

  /* ---------- 穷举求解 ---------- */
  const OPS = ['+', '-', '*', '/'];

  // 4 个数的 5 种括号结构
  const FORMS = [
    (a, b, c, d, o1, o2, o3) => `((${a} ${o1} ${b}) ${o2} ${c}) ${o3} ${d}`,
    (a, b, c, d, o1, o2, o3) => `(${a} ${o1} (${b} ${o2} ${c})) ${o3} ${d}`,
    (a, b, c, d, o1, o2, o3) => `${a} ${o1} ((${b} ${o2} ${c}) ${o3} ${d})`,
    (a, b, c, d, o1, o2, o3) => `${a} ${o1} (${b} ${o2} (${c} ${o3} ${d}))`,
    (a, b, c, d, o1, o2, o3) => `(${a} ${o1} ${b}) ${o2} (${c} ${o3} ${d})`
  ];

  function permute(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const res = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permute(rest)) res.push([arr[i]].concat(p));
    }
    return res;
  }

  /** 将漂亮的解排在前面: 少除号 → 少括号 → 少减号 */
  function rankExpr(e) {
    let score = 0;
    if (e.includes('/')) score += 12;
    if (e.includes('-')) score += 3;
    score += (e.match(/\(/g) || []).length * 2;
    return score;
  }

  /** 返回全部解的字符串数组 (按美观度排序) */
  function solve(nums) {
    const found = new Set();
    const perms = permute(nums.slice());
    for (const p of perms) {
      for (const form of FORMS) {
        for (const o1 of OPS) for (const o2 of OPS) for (const o3 of OPS) {
          try {
            const expr = form(p[0], p[1], p[2], p[3], o1, o2, o3);
            if (evaluateExpr(expr).eq(Frac.of(24))) found.add(expr);
          } catch (e) { /* 除零/非法, 跳过 */ }
        }
      }
    }
    return Array.from(found).sort((x, y) => rankExpr(x) - rankExpr(y));
  }

  function isSolvable(nums) { return solve(nums).length > 0; }

  /** 提取解法的最内层子式作为提示: 找到嵌套最深的括号组 */
  function firstStep(expr) {
    let depth = 0, maxDepth = 0, start = -1, end = -1;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '(') {
        depth++;
        if (depth > maxDepth) { maxDepth = depth; start = i; }
      } else if (ch === ')') {
        if (depth === maxDepth && start !== -1) { end = i; break; }
        depth--;
      }
    }
    if (start !== -1 && end !== -1) {
      const sub = expr.slice(start + 1, end);
      try {
        const val = evaluateExpr(sub);
        return { sub, val };
      } catch (e) { return null; }
    }
    return null;
  }

  /** 展示用: * → ×, / → ÷, 数字加粗高亮 */
  function prettyExpr(expr) {
    return expr
      .replace(/\*/g, '×')
      .replace(/\//g, '÷');
  }

  global.Solver = { Frac, tokenize, evaluateExpr, numbersInExpr, solve, isSolvable, firstStep, prettyExpr };
})(window);
