/* =========================================================
 * 音效引擎 (WebAudio, 零资源依赖)
 * ========================================================= */
(function (global) {
  'use strict';

  const KEY = 'cal24.mute';
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

  let ctx = null;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 首次用户交互时解锁 AudioContext (浏览器自动播放策略)
  // 首次发牌发生在任何点击之前, 若不提前解锁, 开局音效会被浏览器静音
  function unlock() {
    ensure();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  }
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });

  /** 基础音色: 频率包络 + 音量包络 */
  function tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.15, vol = 0.2, delay = 0, attack = 0.006 }) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const Sfx = {
    click() { tone({ freq: 620, freqEnd: 860, type: 'triangle', dur: 0.06, vol: 0.1 }); },
    deal() {
      [392, 494, 587, 698].forEach((f, i) =>
        tone({ freq: f, freqEnd: f * 1.25, type: 'triangle', dur: 0.14, vol: 0.16, delay: i * 0.1 }));
      tone({ freq: 1568, type: 'sine', dur: 0.5, vol: 0.05, delay: 0.4 });
    },
    correct() {
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.24, vol: 0.18, delay: i * 0.1 }));
      tone({ freq: 2093, freqEnd: 2637, type: 'sine', dur: 0.6, vol: 0.07, delay: 0.5 });
    },
    wrong() { tone({ freq: 220, freqEnd: 130, type: 'sawtooth', dur: 0.3, vol: 0.15 }); },
    reveal() {
      [659, 784, 988, 1319, 1568, 1976].forEach((f, i) =>
        tone({ freq: f, type: 'sine', dur: 0.18, vol: 0.12, delay: i * 0.09 }));
    },
    tick() { tone({ freq: 880, type: 'square', dur: 0.05, vol: 0.07 }); },
    fanfare() {
      [784, 988, 1175, 1568].forEach((f, i) =>
        tone({ freq: f, type: 'square', dur: 0.16, vol: 0.1, delay: i * 0.09 }));
    },
    toggleMute() { muted = !muted; try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {} return muted; },
    get muted() { return muted; }
  };

  global.Sfx = Sfx;
})(window);
