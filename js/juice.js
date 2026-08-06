/* js/juice.js — 轻量「游戏手感」(game-feel) 增强库：缓动 / 粒子 / 漂浮文字 / 屏幕震动。
 * 纯 Vanilla、零依赖、无副作用；挂载全局 Juice，供各 UI 模块调用。
 * 设计：所有动画基于 dt(秒) 推进，与帧率无关；状态均挂在调用方实例上，不污染全局。
 */
(function (root) {
  'use strict';

  // ── 缓动函数：让运动自然（替代生硬的线性/sin） ──
  const ease = {
    linear:     t => t,
    inOutQuad:  t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outCubic:   t => 1 - Math.pow(1 - t, 3),
    outQuart:   t => 1 - Math.pow(1 - t, 4),
    outBack:    t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  };
  const lerp  = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand  = (a, b) => a + Math.random() * (b - a);

  // ── 粒子系统 ──
  function ParticleSystem() { this.list = []; }
  ParticleSystem.prototype.spawn = function (x, y, opts) {
    opts = opts || {};
    const n      = opts.count || 12;
    const colors = opts.colors || ['#9b7653', '#caa472', '#7a5a3a'];
    const speed  = opts.speed || rand(70, 150);
    const g      = opts.gravity != null ? opts.gravity : 220;
    const baseLife = opts.life || rand(0.75, 1.25);
    const size   = opts.size || rand(4, 7.5);
    const spread = opts.spread != null ? opts.spread : Math.PI * 2;
    const dir0   = opts.dir != null ? opts.dir : -Math.PI / 2; // 默认向上喷
    const r0    = opts.spawnRadius != null ? opts.spawnRadius : rand(3, 9); // 初始即散成环，避免第0帧堆叠成一点看不见
    const imgKeys = opts.imgKeys && opts.imgKeys.length ? opts.imgKeys : null; // 贴图粒子：传入贴图 key 数组
    const imgSize = opts.imgSize || 14;
    for (let i = 0; i < n; i++) {
      const a  = dir0 + (Math.random() - 0.5) * spread;
      const sp = speed * rand(0.5, 1.25);
      this.list.push({
        x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g, age: 0, life: baseLife * rand(0.8, 1.2),
        size: size * rand(0.7, 1.3),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 6,
        shape: opts.shape || 'rect',
        imgKey: imgKeys ? imgKeys[(Math.random() * imgKeys.length) | 0] : null, // 贴图粒子优先
        imgSize,
      });
    }
  };
  ParticleSystem.prototype.update = function (dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x  += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  };
  ParticleSystem.prototype.draw = function (ctx) {
    const A = typeof ASSETS !== 'undefined' ? ASSETS : null;
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.8)); // 开头更实、结尾才淡出，便于看清
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      if (p.imgKey && A) {
        // 贴图粒子：关闭插值让像素贴图清晰；draw 失败（缺图）回退色块
        const s = p.imgSize * (0.6 + 0.4 * k);
        const ok = A.draw(ctx, p.imgKey, -s / 2, -s / 2, s, s, false);
        if (!ok) {
          const sz = p.size * (0.6 + 0.4 * k);
          ctx.fillStyle = p.color; ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        }
      } else {
        const s = p.size * (0.6 + 0.4 * k);                 // 整体更大、随寿命略缩
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-s / 2, -s / 2, s, s);
        // 深色描边：让粒子在任何底色上都清晰可辨，不再"看不见"
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke(); }
        else ctx.strokeRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // ── 漂浮文字（+N、种下 X 等），上浮淡出 ──
  function Floaters() { this.list = []; }
  Floaters.prototype.spawn = function (x, y, text, opts) {
    opts = opts || {};
    this.list.push({
      x, y, text,
      age: 0, life: opts.life || 1.1,
      color: opts.color || '#FFE08A',
      size: opts.size || 16,
      vy: opts.vy || -34,
      delay: opts.delay || 0,
    });
  };
  Floaters.prototype.update = function (dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.age += dt;
      if (f.age >= f.life) { this.list.splice(i, 1); continue; }
      f.y += f.vy * dt;
      f.vy *= (1 - 1.6 * dt); // 上浮减速
    }
  };
  Floaters.prototype.draw = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.list) {
      if (f.delay > 0) continue;
      const k = f.age / f.life;
      const a = k < 0.15 ? k / 0.15 : (k > 0.7 ? (1 - (k - 0.7) / 0.3) : 1);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `bold ${f.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.restore();
  };

  // ── 屏幕震动 ──
  function Shake() { this.t = 0; this.dur = 0; this.mag = 0; }
  Shake.prototype.add = function (mag, dur) {
    mag = mag || 4; dur = dur || 220;
    if (mag >= this.mag || this.t <= 0) this.mag = mag;
    this.dur = Math.max(this.dur, dur);
    this.t = Math.max(this.t, dur);
  };
  Shake.prototype.offset = function () {
    if (this.t <= 0) return { x: 0, y: 0 };
    const k = this.t / this.dur, m = this.mag * k;            // 随剩余时间衰减
    const elapsed = (this.dur - this.t) / 1000;               // 自触发起的秒数
    const ph = elapsed * 34 * Math.PI * 2;                    // 平滑振荡（Hz），替代逐帧白噪声
    // 整像素对齐：像素画平移整数像素才清晰，避免亚像素抖动导致的"画质粗糙/发毛"
    return {
      x: Math.round(Math.sin(ph) * m),
      y: Math.round(Math.sin(ph * 1.27 + 1.3) * m),
    };
  };
  Shake.prototype.update = function (dt) { if (this.t > 0) { this.t -= dt; if (this.t < 0) this.t = 0; } };

  const Juice = { ease, lerp, clamp, rand, ParticleSystem, Floaters, Shake };
  if (typeof module !== 'undefined' && module.exports) module.exports = Juice;
  root.Juice = Juice;
})(typeof globalThis !== 'undefined' ? globalThis : this);
