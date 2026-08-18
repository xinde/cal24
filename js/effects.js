/* =========================================================
 * 特效引擎: 彩带礼花 / 金色火花 / 冲击波 / 全屏闪光
 * 纯 Canvas 实现, 零资源依赖
 * ========================================================= */
(function (global) {
  'use strict';

  const PALETTE = ['#f6c453', '#3ee6ff', '#ff5fa2', '#ffffff', '#7dffb2', '#ffd76a'];

  let cv = null, ctx = null;
  let parts = [];
  let raf = 0;
  let last = 0;
  const DPR = () => (window.devicePixelRatio || 1);

  function init() {
    cv = document.getElementById('fx-canvas');
    if (!cv) return;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(loop);
  }

  function resize() {
    if (!cv) return;
    cv.width = window.innerWidth * DPR();
    cv.height = window.innerHeight * DPR();
    if (ctx) ctx.setTransform(DPR(), 0, 0, DPR(), 0, 0);
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(pr => {
      pr.update(dt);
      pr.draw(ctx);
      return pr.alive;
    });
  }

  /* ---------- 粒子类型 ---------- */

  class Confetti {
    constructor(x, y, color, power) {
      this.x = x; this.y = y;
      const ang = Math.random() * Math.PI * 2;
      const spd = (60 + Math.random() * 320) * power;
      this.vx = Math.cos(ang) * spd;
      this.vy = Math.sin(ang) * spd - 90 * power;
      this.g = 620 + Math.random() * 260;
      this.w = 6 + Math.random() * 6;
      this.h = 8 + Math.random() * 8;
      this.color = color;
      this.rot = Math.random() * Math.PI * 2;
      this.vr = (Math.random() - 0.5) * 14;
      this.life = 1.4 + Math.random() * 1.2;
      this.age = 0;
      this.drag = 0.9;
    }
    get alive() { return this.age < this.life; }
    update(dt) {
      this.age += dt;
      this.vy += this.g * dt;
      this.vx *= Math.pow(this.drag, dt * 60);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.rot += this.vr * dt;
    }
    draw(g) {
      const a = Math.max(0, 1 - this.age / this.life);
      g.save();
      g.globalAlpha = a;
      g.translate(this.x, this.y);
      g.rotate(this.rot);
      g.fillStyle = this.color;
      g.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
      g.restore();
    }
  }

  class Spark {
    constructor(x, y, color) {
      this.x = x; this.y = y;
      const ang = Math.random() * Math.PI * 2;
      const spd = 120 + Math.random() * 300;
      this.vx = Math.cos(ang) * spd;
      this.vy = Math.sin(ang) * spd - 60;
      this.g = 500;
      this.color = color;
      this.life = 0.5 + Math.random() * 0.5;
      this.age = 0;
      this.len = 8 + Math.random() * 8;
    }
    get alive() { return this.age < this.life; }
    update(dt) {
      this.age += dt;
      this.vy += this.g * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }
    draw(g) {
      const a = Math.max(0, 1 - this.age / this.life);
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = this.color;
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(this.x, this.y);
      g.lineTo(this.x - this.vx * 0.03, this.y - this.vy * 0.03);
      g.stroke();
      g.restore();
    }
  }

  class Ring {
    constructor(x, y, color) {
      this.x = x; this.y = y;
      this.color = color;
      this.r = 6;
      this.life = 0.7;
      this.age = 0;
      this.speed = 480;
    }
    get alive() { return this.age < this.life; }
    update(dt) {
      this.age += dt;
      this.r += this.speed * dt;
    }
    draw(g) {
      const a = Math.max(0, 1 - this.age / this.life);
      g.save();
      g.globalAlpha = a * 0.9;
      g.strokeStyle = this.color;
      g.lineWidth = 3 * a + 1;
      g.beginPath();
      g.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  /* ---------- 对外 API ---------- */

  function sparks(x, y, count = 16, color = '#f6c453') {
    for (let i = 0; i < count; i++) parts.push(new Spark(x, y, color));
  }

  function ring(x, y, color = '#3ee6ff') {
    parts.push(new Ring(x, y, color));
  }

  function confettiBurst(x, y, opts = {}) {
    const count = opts.count || 120;
    const power = opts.power || 1.1;
    const colors = opts.colors || PALETTE;
    for (let i = 0; i < count; i++) {
      parts.push(new Confetti(x, y, colors[(Math.random() * colors.length) | 0], power));
    }
  }

  /** 双礼花从两侧/中央绽放 */
  function celebrate() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = w / 2;
    const cy = h * 0.42;
    confettiBurst(cx, cy, { count: 150, power: 1.25 });
    confettiBurst(cx - w * 0.32, cy, { count: 80, power: 1.0 });
    confettiBurst(cx + w * 0.32, cy, { count: 80, power: 1.0 });
    ring(cx, cy, '#f6c453');
    ring(cx, cy, '#3ee6ff');
  }

  function flash(color = '#f6c453', alpha = 0.35, dur = 420) {
    const el = document.getElementById('flash');
    if (!el) return;
    el.style.background = color;
    el.style.opacity = alpha;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = 0;
      setTimeout(() => el.classList.remove('on'), 300);
    }, dur);
  }

  global.Fx = { init, sparks, ring, confettiBurst, celebrate, flash };
})(window);
