/**
 * ui-snow.js — 从 ui.js 拆分
 */

const _snowMethods = {
  _drawSnow(ctx, dt) {

    const W = this.canvas.width, H = this.canvas.height;

    const cs = this.cellSize;

    if (!this._snowFlakes) {

      const n = Math.max(50, Math.round((W * H) / 6000));

      this._snowFlakes = [];

      for (let i = 0; i < n; i++) this._snowFlakes.push(this._newSnow(W, H, true));

    }

    ctx.fillStyle = 'rgba(205,215,235,0.15)';

    ctx.fillRect(-8, -8, W + 16, H + 16);

    // 两种飘雪贴图随机使用

    const sprSky = ASSETS.get('snow_sky');

    const sprSnow = ASSETS.get('snow');

    for (const f of this._snowFlakes) {

      if (f._eaten) continue;                       // 已被生长的积雪吃掉 → 消失，不再绘制

      if (!f.stopped) {                                          // 飘落中：推进 + 在最上层绘制（雪在树前）

        f.y += f.vy * dt;

        f.phase += f.swaySpeed * dt;

        f.rot += f.spin * dt;

        if (f.y >= f.landY) { f.y = f.landY; f.stopped = true; }  // 飘到随机落点即停下（不消失、不重生）

        const x = f.landX + Math.sin(f.phase) * f.swayAmp;

        const s = f.size;

        const ca = Math.cos(f.rot), sa = Math.sin(f.rot);

        ctx.globalAlpha = f.alpha;

        ctx.setTransform(ca, sa, -sa, ca, x + this._shakeX, f.y + this._shakeY);

        const spr = f.type < 0.5 ? sprSky : sprSnow;

        if (spr && spr.width) {

          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(spr, -s / 2, -s / 2, s, s);

        } else {

          ctx.fillStyle = 'rgba(255,255,255,0.95)';

          ctx.fillRect(-s / 2, -1.2, s, 2.4);

          ctx.fillRect(-1.2, -s / 2, 2.4, s);

        }

      }

      // 已停驻的雪花：age 推进与 _eaten/消退检测交给 _tickLandedSnow（每帧、跨季节运行），

      // 绘制交给 _drawSnowLanded（画在植被层之下，不盖住花草树木）。_drawSnow 仅冬天调用，不能在此推进 age。

    }

    // 注：被积雪吃掉的雪花移除已并入 _tickLandedSnow（跨季节每帧执行）。

    // 持续下雪：落点的雪花永久停驻（不消失），但天上要不断有新雪花飘下来（维持 TARGET_MOVING 片在飘）

    let moving = 0, stopped = 0;

    for (const f of this._snowFlakes) { if (f.stopped) stopped++; else moving++; }

    const TARGET_MOVING = Math.max(50, Math.round((W * H) / 6000));

    const MAX_STOPPED = 600;

    if (moving < TARGET_MOVING && stopped < MAX_STOPPED) this._snowFlakes.push(this._newSnow(W, H, false));

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.globalAlpha = 1;

  },



  /** 推进「停驻在地面上的雪花」的老化：每帧、跨季节调用（_drawSnow 仅冬天调用，不能在其内推进 age）。

   *  f.age 随时间增加；若所在格被满格地面积雪覆盖(covered) 或 age>=FADE_DUR(8s)，标记 _eaten 消失。

   *  视觉淡出(fade)由 _drawSnowLanded 负责，本函数只推进状态并从数组移除已吃雪花。 */


  _tickLandedSnow(dt) {

    if (!this._snowFlakes) return;

    const cs = this.cellSize;

    const FADE_DUR = 8;

    for (const f of this._snowFlakes) {

      if (f._eaten || !f.stopped) continue;            // 只推进「已停驻且未吃」的雪花

      f.age = (f.age || 0) + dt;

      const c = Math.floor(f.landX / cs), r = Math.floor(f.landY / cs);

      const covered = this._snowGround && this._snowGround.some(s => s.c === c && s.r === r && (s.pixelStep || 1) >= cs);

      if (covered || f.age >= FADE_DUR) f._eaten = true;

    }

    // 被积雪吃掉的雪花从数组移除（视觉已消失；stopped 数随之减少，补充逻辑会继续下雪）

    if (this._snowFlakes.some(f => f._eaten)) this._snowFlakes = this._snowFlakes.filter(f => !f._eaten);

  },



  /** 绘制「停驻在地面上的雪花」——放在植被层（草/花/树，_vegCache）之下，所以不盖住花草树木。

   *  飘落中的雪花仍在最上层（_drawSnow），雪在树前是合理透视。

   *  停驻雪花随时间 fade：尺寸与透明度都按 (1 - age/FADE_DUR) 缩小，归零即完全消失。

   *  本函数只读取 f.stopped && !f._eaten 的雪花绘制，状态推进交给 _tickLandedSnow（每帧跨季节）。 */


  _drawSnowLanded(ctx) {

    if (!this._snowFlakes) return;

    const FADE_DUR = 8;

    const sprSky = ASSETS.get('snow_sky');

    const sprSnow = ASSETS.get('snow');

    for (const f of this._snowFlakes) {

      if (f._eaten || !f.stopped) continue;          // 只画「停驻且未被吃」的雪花

      const fade = Math.max(0, 1 - (f.age || 0) / FADE_DUR);

      if (fade <= 0) continue;                        // 已完全消退

      const s = f.size * fade;                        // 随时间变小

      const x = f.landX, y = f.landY;                 // 停在固定落点（不再 sway，已冻结）

      const ca = Math.cos(f.rot), sa = Math.sin(f.rot);

      ctx.globalAlpha = f.alpha * fade;               // 随时间变透明

      ctx.setTransform(ca, sa, -sa, ca, x + this._shakeX, y + this._shakeY);

      const spr = f.type < 0.5 ? sprSky : sprSnow;

      if (spr && spr.width) {

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(spr, -s / 2, -s / 2, s, s);

      } else {

        ctx.fillStyle = 'rgba(255,255,255,0.95)';

        ctx.fillRect(-s / 2, -1.2, s, 2.4);

        ctx.fillRect(-1.2, -s / 2, 2.4, s);

      }

    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.globalAlpha = 1;

  },



  /** 生成一片雪花：initial=true 时随机铺满全屏；否则从顶部外侧重生。 */


  _newSnow(W, H, initial) {

    const size = 15 + Math.random() * 30;       // 飘雪粒子大小 15~45（调大下限和范围，更明显）

    const landX = Math.random() * W;            // 固定随机落点（列方向，全屏任意格）

    const landY = Math.random() * H;            // 固定随机落点（行方向，全屏任意格）

    return {

      landX, landY,

      x: landX,

      y: initial ? Math.random() * landY : -12 - Math.random() * H,   // 从屏幕上方飘下，飘到 landY 停下

      vy: 20 + Math.random() * 28,

      size,

      phase: Math.random() * Math.PI * 2,

      swayAmp: 7 + Math.random() * 16,

      swaySpeed: 0.7 + Math.random() * 1.1,

      spin: (Math.random() - 0.5) * 0.7,

      rot: Math.random() * Math.PI * 2,

      alpha: 0.75 + Math.random() * 0.25,       // 0.75~1.0，更实不透明

      type: Math.random(),  // 0~1 决定用哪种飘雪贴图

    };

  },



  // ───── 积雪系统（16×16 像素格，逐步累积铺满）─────

  // 每个雪花有固定的随机落点，雪停后留在该位置；逐渐累积直到铺满。




  _ensureSnowState() {

    // 冬天仅确保积雪数组存在（空），【不预置雪片】：

    // 此前此处会瞬间把全屏 30% 格子预置成雪，导致「冬天一上来就有雪」。

    // 现在雪由 _accumulateSnow 后台累积（与空中飘雪无关）；飘落雪花只做纯视觉，不生成积雪。

    if (!this._snowGround) { this._snowGround = []; this._vegSnowTotal = -1; }

    this._snowTotal = this._snowGround.length;

  },




  _accumulateSnow() {

    // 下雪时：随机添加新雪片（对齐游戏格网，cellSize=cs）

    if (!this._snowGround) return;

    const cs = this.cellSize;

    const cols = DATA.FARM.COLS, rows = DATA.FARM.ROWS;

    // 每刻尝试添加若干新雪片

    const tries = 3 + Math.floor(Math.random() * 5);

    for (let i = 0; i < tries; i++) {

      if (Math.random() < 0.15) {  // 15% 概率添加一片

        const c = Math.floor(Math.random() * cols);

        const r = Math.floor(Math.random() * rows);

        // 落点在格内随机 16px 对齐位置（不固定居中），最终平滑长到铺满整格

        const sub = Math.floor(Math.random() * (cs / 16)) * 16;

        const x = c * cs + sub, y = r * cs + sub;

        // 检查是否已有雪片

        const exists = this._snowGround.some(f => f.c === c && f.r === r);

        if (!exists) {

          this._snowGround.push({ x, y, c, r, pixelStep: 1 });

        }

      }

    }

    this._snowTotal = this._snowGround.length;

    this._syncSnowCanvas();

  },




  _decaySnow() {

    // 融化：把 pixelStep 减 1（1→0 则删除）。gmax 必须与 _growSnowStep 一致(=cellSize)，

    // 否则长大雪(step=48)永远 >= gmax(=3) 被跳过、且 step<=1 永不被删 → 春雪永久残留。

    // 每刻最多让 3 片雪缩小一级，避免同时消失的突兀感。

    if (!this._snowGround || this._snowGround.length === 0) return;

    const gmax = this.cellSize;

    // 若场上还有非满格小雪，则优先化小雪、满格最后化；但若全已是满格（春天常见），

    // 则照化满格，避免「全满格→全 continue→changed=false→直接 return」的死锁。

    const hasSmall = this._snowGround.some(s => {

      const st = s.pixelStep != null ? s.pixelStep : 1;

      return st < gmax;

    });

    let changed = false;

    let melting = 0;

    for (const s of this._snowGround) {

      if (melting >= 3) break;

      const step = s.pixelStep != null ? s.pixelStep : 1;

      if (step <= 1) { s.pixelStep = 0; changed = true; melting++; continue; }  // 最小 → 标记删除

      if (hasSmall && step >= gmax) continue;                                    // 还有小雪：满格暂不动

      s.pixelStep = step - 1;

      changed = true;

      melting++;

    }

    // 清理已化完的（pixelStep <= 0）

    const before = this._snowGround.length;

    this._snowGround = this._snowGround.filter(s => (s.pixelStep != null ? s.pixelStep : 1) > 0);

    if (this._snowGround.length < before) changed = true;

    if (changed) {

      this._snowTotal = this._snowGround.length;

      this._syncSnowCanvas();

    }

  },




  _clearSnowAll() {

    if (!this._snowGround) return;

    const had = this._snowTotal > 0;

    this._snowGround = [];

    this._snowTotal = 0;

    if (this._snowCtx) this._snowCtx.clearRect(0, 0, this._snowCanvas.width, this._snowCanvas.height);

    if (had) { this._buildVegCache(); this._vegSnowTotal = 0; }

  },




  _ensureSnowCanvas() {

    if (!this._snowCanvas) {

      this._snowCanvas = document.createElement('canvas');

      this._snowCtx = this._snowCanvas.getContext('2d');

    }

    if (this._snowCanvas.width !== this.canvas.width || this._snowCanvas.height !== this.canvas.height) {

      this._snowCanvas.width = this.canvas.width;

      this._snowCanvas.height = this.canvas.height;

      this._snowCtx.clearRect(0, 0, this._snowCanvas.width, this._snowCanvas.height);

      this._snowCtx.imageSmoothingEnabled = false;   // 关平滑：雪块边缘不抗锯齿，避免生长时亚像素抖动(颤抖)

      this._snowCs = this.cellSize;

      this._redrawSnowAll();                                        // 尺寸变化后按 cov 重绘全部积雪

    }

  },




  _redrawSnowAll() {

    if (!this._snowGround || this._snowGround.length === 0) return;

    if (!this._snowCanvas) this._ensureSnowCanvas();

    const ctx = this._snowCtx;

    ctx.clearRect(0, 0, this._snowCanvas.width, this._snowCanvas.height);

    // 地面积雪用 powder_snow 贴图（有雪粒纹理）

    const sprGround = ASSETS.get('snow_ground');

    // 离散尺寸跳变：pixelStep 即像素尺寸，1→2→3→…→gmax(整格48px)

    const cs = this.cellSize;

    const gmax = cs;

    for (const f of this._snowGround) {

      const ps = (f.pixelStep != null) ? f.pixelStep : 1;

      if (ps < 1) continue;

      const sz = Math.min(ps, cs);                              // 像素尺寸，1px起步→整格

      // 落点 f.x/f.y 是格内任意16px对齐位置（不固定居中）；从落点平滑滑到铺满整格

      const lx = f.x, ly = f.y;

      const ox = Math.floor(lx / cs) * cs, oy = Math.floor(ly / cs) * cs;   // 所在格原点

      const t = gmax > 1 ? (ps - 1) / (gmax - 1) : 1;             // 0→1

      const x = Math.round(lx + t * (ox - lx));                   // 落点→格左上角

      const y = Math.round(ly + t * (oy - ly));

      if (sprGround && sprGround.width) {

        ctx.drawImage(sprGround, x, y, sz, sz);

      } else {

        // 兜底：纯白方块

        ctx.fillStyle = 'rgba(255,255,255,0.95)';

        ctx.fillRect(x, y, sz, sz);

      }

    }

  },




  _paintSnowCell(ctx, r, c, cs, spr, cov) {

    const x = c * cs, y = r * cs;

    ctx.clearRect(x, y, cs, cs);                                    // 先擦：改覆盖率重绘时不与旧像素叠加

    const a = Math.min(1, cov);

    if (spr && spr.width) {

      ctx.globalAlpha = a;

      ctx.drawImage(spr, x, y, cs, cs);

      ctx.globalAlpha = 1;

    } else {

      ctx.fillStyle = 'rgba(244,248,255,' + (0.96 * a) + ')';       // 贴图未就绪兜底：雪白块

      ctx.fillRect(x, y, cs, cs);

    }

  },




  _tickSnow() {

    this._snowTick++;

    const season = (typeof Engine !== 'undefined') ? Engine.season : 0;

    const hasSnow = !!this._snowGround && this._snowGround.length > 0;

    if (season === 3) {                                            // 冬：地面积雪由 _accumulateSnow 后台累积（与空中飘雪无关）

      this._ensureSnowState();

      if (this.isRaining) this._accumulateSnow();                 // 下雪中：后台随机往游戏格加雪片（独立系统）

      // 地面积雪离散跳变生长（每游戏刻最多2片）

      this._growSnowStep();

    } else if (season === 0) {                                     // 春：雪片逐渐融化消失

      if (hasSnow) this._decaySnow();

    } else {                                                        // 夏/秋：清空残留

      if (hasSnow) this._clearSnowAll();

    }

    this._syncSnowCanvas();

  },



  /** 推进地面积雪像素级增长：每游戏刻最多让2片雪的pixelStep+1，达到整格后停止。

   *  速度 *1/16：累积 16 游戏刻才真正推进一次（原每刻推2片 → 现每16刻推2片）。 */


  _growSnowStep() {

    if (!this._snowGround || this._snowGround.length === 0) return;

    this._snowGrowAcc = (this._snowGrowAcc || 0) + 1;

    if (this._snowGrowAcc < 16) return;   // 速度降为 1/16

    this._snowGrowAcc = 0;

    const cs = this.cellSize;

    const gmax = cs;       // 满格对应的像素尺寸

    let jumped = 0;

    for (const s of this._snowGround) {

      if (s.pixelStep == null) s.pixelStep = 1;

      if (s.pixelStep < gmax) {

        s.pixelStep++;

        jumped++;

        if (jumped >= 2) break;

      }

    }

    if (jumped > 0) this._syncSnowCanvas();

  },




  _syncSnowCanvas() {

    if (this._snowTotal > 0) {

      this._ensureSnowCanvas();

      this._redrawSnowAll();

      if (this._snowTotal !== this._vegSnowTotal) { this._buildVegCache(); this._vegSnowTotal = this._snowTotal; }  // 覆盖率变→刷新草基部截断

      this._shakeSnowBaseCache = null;                         // 雪变化→有雪底缓存失效（懒重建）

    } else if (this._snowCanvas && this._vegSnowTotal !== 0) {

      this._snowCtx.clearRect(0, 0, this._snowCanvas.width, this._snowCanvas.height);

      this._buildVegCache(); this._vegSnowTotal = 0;               // 雪清空→草基部解埋

      this._shakeSnowBaseCache = null;

    }

  },



  /** 构建含雪草格底缓存：每格先在雪层 canvas 上截图（当前积雪），再叠加草基层。

   *  用于草颤时回贴底，保证雪不被无雪底覆盖。懒构建，_syncSnowCanvas 雪变时失效。 */


  _buildShakeSnowBaseCache() {

    if (!this._snowCanvas || this._snowTotal === 0) { this._shakeSnowBaseCache = null; return; }

    if (!this._grassBaseCache) return;

    const cs = this.cellSize;

    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;

    const cache = {};

    // 逐格从 _snowCanvas 截出该格的积雪区域（含透明），再叠加草格底

    for (const key in this._grassBaseCache) {

      const entry = this._grassBaseCache[key];

      if (!entry) { cache[key] = null; continue; }

      const [r, c] = key.split(',').map(Number);

      const x = c * cs, y = r * cs;

      const sub = document.createElement('canvas');

      sub.width = cs; sub.height = cs;

      const sctx = sub.getContext('2d');

      sctx.drawImage(entry.cv, 0, 0);                                 // 草块底（不透明）先画

      sctx.drawImage(this._snowCanvas, x, y, cs, cs, 0, 0, cs, cs);  // 雪盖在草上（埋雪观感，草颤不丢雪）

      cache[key] = { cv: sub, top: entry.top };

    }

    this._shakeSnowBaseCache = cache;

  },




  _blitSnowGround(ctx) {

    if (!this._snowCanvas || this._snowTotal === 0) return;

    this._ensureSnowCanvas();                                        // 尺寸变化则同步全量重绘

    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(this._snowCanvas, 0, 0);

  },



  /** 雨滴落地：在 (x,y) 生成一圈扩散涟漪（用「水」贴图渲染，去鲜明灰蓝）

   *  落点地表判定：雨滴打在【草丛（绿/黄草）或树上】时不产生涟漪——草叶/树冠会接住雨水，不会在地上溅起水圈。

   *  只有落在光秃地面 / 耕地 / 裸土 / 水面（即无草无树的地表）才出涟漪。 */


};

Object.assign(UI, _snowMethods);
