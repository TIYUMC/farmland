/**
* ui-weather-view.js — 雨 / 风 / 雪 / 落叶 / 夜晚 的天气绘制与推进
* 职责：天气粒子（雨/雪/落叶）生成与推进、雪地面/空中两套系统、阵风与夜晚蒙层、天气派发与清场。
* 生效/影子：与 ui-weather.js 补丁同名时补丁赢（后加载覆盖）；本件拆前拆后行为一致。
* 方法清单：
*   - _drawEffects
*   - _drawRain
*   - _drawSnow
*   - _tickLandedSnow
*   - _drawSnowLanded
*   - _newSnow
*   - _ensureSnowState
*   - _accumulateSnow
*   - _decaySnow
*   - _clearSnowAll
*   - _ensureSnowCanvas
*   - _redrawSnowAll
*   - _paintSnowCell
*   - _tickSnow
*   - _growSnowStep
*   - _syncSnowCanvas
*   - _buildShakeSnowBaseCache
*   - _blitSnowGround
*   - _spawnRipple
*   - _shakeGrass
*   - _drawGrassShakes
*   - _drawRipples
*   - _isAutumn
*   - _isWinter
*   - _autumnLeafColors
*   - _leafTinted
*   - _spawnLeaf
*   - _updateLeaves
*   - _drawLeaves
*   - _litterTinted
*   - _ensureLitterGrid
*   - _drawLitterCell
*   - _spawnDailyLitter
*   - _newDrop
*   - _buildRainSprite
*   - _totalGameHours
*   - _randRange
*   - _randRainDurDays
*   - _randGapDays
*   - _updateWeather
*   - _nightAlpha
*   - _drawNightOverlay
*   - _rainWaterFields
*   - _clearWeather
*   - _startRain
*   - _startRainAndWater
*   - _syncIsRaining
*   - _switchWeatherPhase
*   - _toggleRain
*   - _spawnBurst
*   - _floatText
*   - _shakeIt
*/

Object.assign(UI, {
  _drawEffects(ctx, dt) {
    if (this._particles) { this._particles.update(dt); this._particles.draw(ctx); }
    if (this._floaters)  { this._floaters.update(dt);  this._floaters.draw(ctx); }
    if (this._shake) this._shake.update(dt);
  },




  /** 视觉下雨：纯画面效果，不影响玩法。雨滴用「水」贴图截取的一段绘制，按天气系统随机下雨。 */

  _drawRain(ctx, dt) {

    if (this._isWinter()) { this._drawSnow(ctx, dt); return; }   // 冬天：雨渲染为飘雪（视觉替换，季节由 Engine.season 决定）

    const W = this.canvas.width, H = this.canvas.height;

    if (!this._rainDrops) {

      const n = Math.max(60, Math.round((W * H) / 4200)); // 雨滴数随画布面积

      this._rainDrops = [];

      for (let i = 0; i < n; i++) this._rainDrops.push(this._newDrop(W, H, true));

    }

    // 阴天压暗（覆盖已绘制的一切，营造阴沉天色；稍大于画布以兼容屏幕震动位移）

    ctx.fillStyle = 'rgba(70,90,120,0.20)';

    ctx.fillRect(-8, -8, W + 16, H + 16);

    const sprite = this._rainSprite;

    if (sprite) {

      // 水贴图截取的雨滴精灵：逐滴绘制；雨丝斜度 = 该滴运动方向（形状与掉落方向一致，不再「竖直身子斜着掉」）；粗细/透明度各异

      for (const d of this._rainDrops) {

        d.y += d.vy * dt;

        d.x += d.vx * dt;

        if (d.y >= d.landY) { this._spawnRipple(d.x, d.landY); Object.assign(d, this._newDrop(W, H, false)); }

        const w = Math.max(1.2, d.len * 0.12 * (d.wF || 1)), h = d.len * 1.2;

        const ang = -Math.atan2(d.vx, d.vy);    // 运动方向角取负 → 雨丝斜度与掉落方向一致（之前符号反了，斜向相反）

        // 用 setTransform 直接拼「平移+旋转」矩阵，省去 save/translate/rotate/restore 四次状态栈操作（视觉完全一致）

        const ca = Math.cos(ang), sa = Math.sin(ang);

        ctx.globalAlpha = (d.alpha != null) ? d.alpha : 1;

        ctx.setTransform(ca, sa, -sa, ca, d.x + this._shakeX, d.y + this._shakeY);

        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);

      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);

      ctx.globalAlpha = 1;

    } else {

      // 精灵未加载好时的回退：蓝色雨丝（一次性 path，性能友好）

      ctx.strokeStyle = 'rgba(80,150,255,0.85)';

      ctx.lineWidth = 1.2;

      ctx.beginPath();

      for (const d of this._rainDrops) {

        d.y += d.vy * dt;

        d.x += d.vx * dt;

        if (d.y >= d.landY) { this._spawnRipple(d.x, d.landY); Object.assign(d, this._newDrop(W, H, false)); }

        ctx.moveTo(d.x, d.y);

        ctx.lineTo(d.x - d.len * 0.25, d.y + d.len);

      }

      ctx.stroke();

    }

  },



  /** 冬日飘雪：冬季「下雨」时渲染为雪（纯视觉，复用 rain 的触发时机 isRaining）。

   *  雪花用 snow 贴图绘制，缓慢下落 + 轻微左右摇摆 + 自转；每片有固定随机落点，飘到该落点即停驻（纯视觉，不消失不重生、不生成积雪）。

   *  落点的雪花永久停驻，天上持续补充新雪花飘下，保证一直下雪（而非只第一下）。

   *  地面积雪是独立的 _accumulateSnow 系统，与空中飘雪互不相干。 */

  _drawSnow(ctx, dt) {
    if (!this._isWinter()) return;
    if (!this.isRaining) return;

    const W = this.canvas.width, H = this.canvas.height;
    const cs = this.cellSize;
    const sprSky = ASSETS.get('snow_sky');
    const sprSnow = ASSETS.get('snow');
    const hasSprites = sprSky && sprSky.width && sprSnow && sprSnow.width;

    if (!this._snowFlakes) {

      const n = Math.max(50, Math.round((W * H) / 6000)) * (this._snowLevel === 2 ? 3 : 1); // 首帧赶上暴雪段直接顶到位（在飘量 ×3）

      this._snowFlakes = [];

      for (let i = 0; i < n; i++) this._snowFlakes.push(this._newSnow(W, H, true));

    }

    ctx.fillStyle = 'rgba(205,215,235,' + (this._snowLevel === 2 ? '0.34' : '0.15') + ')';   // 暴雪天色发灰发闷（0.26→0.34，与暴雨 0.45 同档感）

    ctx.fillRect(-8, -8, W + 16, H + 16);

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

        if (hasSprites) {
          const spr = f.type < 0.5 ? sprSky : sprSnow;
          ctx.drawImage(spr, -s / 2, -s / 2, s, s);
        } else {
          // 无贴图时的降级方案
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.fillRect(-s / 2, -1.2, s, 2.4);
          ctx.fillRect(-1.2, -s / 2, 2.4, s);
        }

      }

      // 已停驻的雪花：age 推进与 _eaten/消退检测交给 _tickLandedSnow（每帧、跨季节运行），

      // 绘制交给 _drawSnowLanded（画在植被层之下，不盖住花草树木）。_drawSnow 仅冬天调用，不能在此推进 age。

    }

    // 持续下雪：落点的雪花永久停驻（不消失），但天上要不断有新雪花飘下来（维持 TARGET_MOVING 片在飘）

    let moving = 0, stopped = 0;

    for (const f of this._snowFlakes) { if (f.stopped) stopped++; else moving++; }

    const TARGET_MOVING = Math.max(50, Math.round((W * H) / 6000)) * (this._snowLevel === 2 ? 3 : 1); // 暴雪在飘量 ×3（；降级不裁回空中，停驻雪花按 age 自然淡出变稀）

    const MAX_STOPPED = 600;

    if (moving < TARGET_MOVING && stopped < MAX_STOPPED) this._snowFlakes.push(this._newSnow(W, H, false));

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.globalAlpha = 1;

  },



  /** 推进「停驻在地面上的雪花」的老化：每帧、跨季节调用（_drawSnow 仅冬天调用，不能在其内推进 age）。

   *  f.age 随时间增加；若所在格被满格地面积雪覆盖(covered) 或 age>=FADE_DUR(8s)，标记 _eaten 消失。

   *  视觉淡出(fade)由 _drawSnowLanded 负责，本函数只推进状态并从数组移除已吃雪花。 */

  _tickLandedSnow(dt) {
    // 仅在冬季运行雪花状态更新，其他季节完全跳过
    if (!this._snowFlakes || !this._isWinter()) return;

    const cs = this.cellSize;
    const FADE_DUR = 8;
    const ground = this._snowGround;
    const flakes = this._snowFlakes;
    let dirty = false;

    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      if (f._eaten || !f.stopped) continue;

      f.age = (f.age || 0) + dt;
      const c = Math.floor(f.landX / cs), r = Math.floor(f.landY / cs);
      const covered = ground && ground.some(s => s.c === c && s.r === r && (s.pixelStep || 1) >= cs);
      if (covered || f.age >= FADE_DUR) {
        f._eaten = true;
        dirty = true;
      }
    }

    // 仅在有雪花被清除时才重建数组（避免每帧分配）
    if (dirty) this._snowFlakes = flakes.filter(f => !f._eaten);
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

    const size = Math.round((15 + Math.random() * 30) * (this._snowLevel === 2 ? 1.3 : 1)); // 飘雪粒子大小 15~45（暴雪 ×1.3 更大更密实）

    const landX = Math.random() * W;            // 固定随机落点（列方向，全屏任意格）

    const landY = Math.random() * H;            // 固定随机落点（行方向，全屏任意格）

    return {

      landX, landY,

      x: landX,

      y: initial ? Math.random() * landY : -12 - Math.random() * H,   // 从屏幕上方飘下，飘到 landY 停下

      vy: Math.round((20 + Math.random() * 28) * (this._snowLevel === 2 ? 2.5 : 1)), // 下落速度（暴雪 ×2.5「砸」下来， 观感加强）

      size,

      phase: Math.random() * Math.PI * 2,

      swayAmp: Math.round((7 + Math.random() * 16) * (this._snowLevel === 2 ? 2 : 1)), // 摆幅（暴雪 ×2 横甩风感）

      swaySpeed: 0.7 + Math.random() * 1.1 + (this._snowLevel === 2 ? 0.8 : 0), // 摆动更快（暴雪 +0.8 风大）

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

    if (!this._snowGround) { this._snowGround = []; this._vegSnowTotal = -1; this._vegSnowSig = ''; }

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

    if (had) { this._buildVegCache(); this._vegSnowTotal = 0; this._vegSnowSig = ''; }

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

      // veg 层失效改按「雪签名」（格+量化桶）比较，替代旧「雪花数量」；_snowTotal 保留（他处仍用），仅新增 sig 比较
      const sig = this._snowSig();
      if (sig !== this._vegSnowSig) { this._buildVegCache(); this._vegSnowSig = sig; }  // 雪签名变→刷新草基部截断

      this._shakeSnowBaseCache = null;                         // 雪变化→有雪底缓存失效（懒重建）

    } else if (this._snowCanvas && this._vegSnowSig) {

      this._snowCtx.clearRect(0, 0, this._snowCanvas.width, this._snowCanvas.height);

      this._buildVegCache(); this._vegSnowSig = '';               // 雪清空→草基部解埋（sig 归空串，veg 重建无截断）

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

  _spawnRipple(x, y) {

    if (!this._ripples) this._ripples = [];

    if (this._ripples.length >= 60) return;            // 上限，避免同屏过多

    if (Math.random() > (this._rainLevel === 2 ? 0.35 : 0.6)) return; // 普通雨 40% 落地生涟漪 → 暴雨 65%

    // ── 地表判定：草丛/树 上不出涟漪 ──

    const cs = this.cellSize;

    const r = Math.floor(y / cs), c = Math.floor(x / cs);

    if (this.scene === 'treeFarm') {

      if (r >= 0 && r < TreeFarm.ROWS && c >= 0 && c < TreeFarm.COLS) {

        if (TreeFarm.getTreeAt(r, c)) return;         // 树（树干/树冠所在格）接住雨水，无涟漪

        const g = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

        if (g === 1 || g === 2) { if (Math.random() < 0.35) this._shakeGrass(r, c); return; }  // 草丛：被雨打颤，不出涟漪（稀疏触发）

      }

    } else {

      if (r >= 0 && r < Farm.ROWS && c >= 0 && c < Farm.COLS) {

        const g = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

        if (g === 1 || g === 2) { if (Math.random() < 0.35) this._shakeGrass(r, c); return; }  // 草丛：被雨打颤，不出涟漪（主农场已无树，稀疏触发）

      }

    }

    this._ripples.push({ x, y, age: 0, maxAge: 0.5 + Math.random() * 0.25, maxR: 13 + Math.random() * 13 });

  },



  /** 给 (r,c) 草格注册一次「被雨打颤」：叠加一次快速摆动（约 0.5s 淡出）。

   *  雨中草会被持续戳得发颤；无雨时静止。同格已存在则刷新（避免无限叠加）。 */

  _shakeGrass(r, c) {

    if (!this._grassShakes) this._grassShakes = [];

    const maxAmp = 0.035 + Math.random() * 0.025;     // 最大摆角 0.035~0.06 rad（约 2°~3.5°，轻轻一弯）

    const existing = this._grassShakes.find(s => s.r === r && s.c === c);

    if (existing) { existing.age = 0; existing.maxAge = 0.3 + Math.random() * 0.15; existing.amp = maxAmp; return; }

    this._grassShakes.push({ r, c, age: 0, maxAge: 0.3 + Math.random() * 0.15, amp: maxAmp });

  },



  /** 绘制并推进草丛颤动：当前在颤的草格，草层绕格底中心左右摆动（顶部摆、根部不动），随时间淡出。

   *  与 _drawRain 解耦——即使雨停，残留颤动仍会继续淡出（render 每帧调用、不限 isRaining）。 */

  _drawGrassShakes(ctx, dt) {

    if (!this._grassShakes || !this._grassShakes.length) return;

    // 有积雪时懒构建含雪底缓存（雪变则失效，此处重建一次）

    if (this._snowTotal > 0 && !this._shakeSnowBaseCache) this._buildShakeSnowBaseCache();

    const cs = this.cellSize;

    const keep = [];

    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;

    const colors = this._seasonColorAt();

    for (const s of this._grassShakes) {

      s.age += dt;

      if (s.age >= s.maxAge) continue;                // 过期移除

      const k = s.age / s.maxAge;                    // 0→1

      const decay = 1 - k;                           // 摆动幅度随寿命衰减

      // 阻尼摆动：小幅左右摆，根部不动、顶部摆（绕格底中心旋转）——作用于「原草层」

      const angle = Math.sin(s.age * 18) * s.amp * decay;

      const x = s.c * cs, y = s.r * cs;

      const gstate = (grassSrc.grass && grassSrc.grass[s.r]) ? (grassSrc.grass[s.r][s.c] || 0) : 0;

      const isBare = !!(grassSrc.bare && grassSrc.bare[s.r] && grassSrc.bare[s.r][s.c]);

      // 贴回预渲染草格底（像素级等价，省去 gblock + 灰度 overlay 两次 drawImage 与一次 composite 切换），

      // 再实时画会摆动的草顶层；草颤结束 age 过期即不再重画，缓存静态草原样复原。

      // 有积雪时改用含雪底缓存（shakeSnowBaseCache），避免无雪底覆盖积雪层。

      const baseCache = (this._snowTotal > 0 && this._shakeSnowBaseCache) ? this._shakeSnowBaseCache : this._grassBaseCache;

      const entry = baseCache && baseCache[s.r + ',' + s.c];

      if (entry) {

        ctx.imageSmoothingEnabled = true;

        ctx.drawImage(entry.cv, x, y);            // 离屏底 = 实时同像素合成结果，1 次 drawImage 替代底土重画

        if (entry.top) this._drawGrassTopLayer(ctx, s.r, s.c, x, y, cs, gstate, colors, angle);

      } else {

        this._drawGrassGroundCell(ctx, s.r, s.c, x, y, cs, gstate, isBare, colors, angle);  // 缓存缺失兜底

      }

      keep.push(s);

    }

    this._grassShakes = keep;

    // 草在静态层本就在「树冠之下」（树冠第二遍覆盖在草上）。实时重画草会盖住相邻格溢出过来的树冠

    // （树冠向左右各溢出约 0.25cs、向上溢出约 0.82 格），导致「草颤时跑到树叶层上面」。

    // 故草颤全部重画后，把每个抖动格的 3×3 邻域内所有树冠再盖回草之上，消除穿帮。

    if (this.scene === 'treeFarm' && TreeFarm.trees && keep.length) {

      const seen = new Set();

      const order = [];

      for (const s of keep) {

        for (let dr = -1; dr <= 1; dr++) {

          for (let dc = -1; dc <= 1; dc++) {

            const rr = s.r + dr, cc = s.c + dc;

            if (rr < 0 || cc < 0 || rr >= DATA.FARM.ROWS || cc >= DATA.FARM.COLS) continue;

            const t = (TreeFarm.trees[rr] && TreeFarm.trees[rr][cc]) || null;

            if (t && !seen.has(rr * 1000 + cc)) { seen.add(rr * 1000 + cc); order.push([rr, cc, t]); }

          }

        }

      }

      order.sort((a, b) => a[0] - b[0]);  // 由下而上重画，保持树冠叠放顺序与缓存一致

      for (const [rr, cc, t] of order) this._drawTreeEntity(ctx, cc * cs, rr * cs, cs, t);

    }

  },



  /** 绘制并推进雨滴落地涟漪：扩散的椭圆环（顶视压扁）+ 水贴图淡填充，随时间淡出。

   *  与 _drawRain 解耦——即使雨停，残留涟漪仍会继续淡出（render 每帧调用、不限 isRaining）。 */

  _drawRipples(ctx, dt) {

    if (!this._ripples || !this._ripples.length) return;

    const spr = this._rainSprite;

    const keep = [];

    for (const r of this._ripples) {

      r.age += dt;

      if (r.age >= r.maxAge) continue;                // 过期移除

      const k = r.age / r.maxAge;                     // 0→1

      const rad = r.maxR * k;

      const ry = rad * 0.42;                          // 顶视：纵向压扁

      const alpha = (1 - k) * 0.55;

      if (spr) {                                       // 水贴图淡填充：用 setTransform 直接拼「平移+缩放」绝对矩阵，省去 save/translate/scale/restore 四次状态栈操作（视觉一致）；叠加震动偏移

        ctx.globalAlpha = alpha * 0.5;

        ctx.setTransform(rad / (spr.width / 2), 0, 0, ry / (spr.height / 2), r.x + this._shakeX, r.y + this._shakeY);

        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);

      }

      ctx.save();                                      // 扩散水蓝环（仅隔离 state，留 1 次 save/restore）

      ctx.globalAlpha = alpha;

      ctx.strokeStyle = 'rgba(150,170,205,1)';

      ctx.lineWidth = Math.max(1, 2.2 * (1 - k));

      ctx.setTransform(1, 0, 0, 1, this._shakeX, this._shakeY);  // 抵消上方绝对矩阵，叠加震动偏移

      ctx.beginPath();

      ctx.ellipse(r.x, r.y, rad, ry, 0, 0, Math.PI * 2);

      ctx.stroke();

      ctx.restore();

      keep.push(r);

    }

    this._ripples = keep;

    // 复位变换/透明度到外层 render 的「震动平移 + globalAlpha=1」基线（原 save/restore 平衡态），供后续 HUD 沿用

    ctx.setTransform(1, 0, 0, 1, this._shakeX, this._shakeY);

    ctx.globalAlpha = 1;

  },



  // ───────────────────────── 秋日落叶系统 ─────────────────────────

  /** 当前是否秋季：落叶只在秋季出现（season 0春/1夏/2秋/3冬）。 */

  _isAutumn() { return (typeof Engine !== 'undefined') && (Engine.season === 2 || this._forceAutumnLeaves); },



  /** 当前是否冬季：冬季「下雨」时渲染为飘雪（season 0春/1夏/2秋/3冬）。 */

  _isWinter() { return (typeof Engine !== 'undefined') && Engine.season === 3; },



  /** 秋叶色板（橙/金黄/红褐/枯黄褐），灰度原图用 source-atop 染成纯秋色并保留叶形 alpha。 */

  _autumnLeafColors() { return ['#d2772a', '#e0a82e', '#b8442a', '#c89a3c', '#9c6f2e']; },



  /** 取一帧染色落叶（缓存 key|color，避免每帧重绘离屏 canvas）。用 getTinted 正片叠底染色，保留叶形纹理（更自然）。 */

  _leafTinted(frame, color) {

    const ck = frame + '|' + color;

    if (this._leafTint[ck]) return this._leafTint[ck];

    const img = ASSETS.getTinted('leaf_' + frame, color);   // 正片叠底染色，保留叶脉明暗

    if (!img) return null;

    this._leafTint[ck] = img;

    return img;

  },



  /** 生成一片落叶：仅树场（有树处）从随机一棵树的树冠下出生，落叶集中在树底；主农场不放落叶。 */

  _spawnLeaf(W, H) {

    if (this.scene !== 'treeFarm') return;   // 落叶只在树场出现，主农场不放（用户：农场不要有落叶）

    if (this._fallingLeaves.length >= 16) return;   // 上限：少量，不满屏

    const colors = this._autumnLeafColors();

    const cs = W / DATA.FARM.COLS;

    const trees = (TreeFarm.trees) ? TreeFarm.trees : null;

    let x, y;

    if (trees) {

      // 树场：从随机一棵树的树冠下飘落（落叶集中在树底，而非满屏）

      const cells = [];

      for (let r = 0; r < DATA.FARM.ROWS; r++)

        for (let c = 0; c < DATA.FARM.COLS; c++)

          if (trees[r] && trees[r][c]) cells.push([r, c]);

      if (cells.length) {

        const [tr, tc] = cells[(Math.random() * cells.length) | 0];

        x = tc * cs + cs * (0.2 + Math.random() * 0.6);

        y = tr * cs + cs * (0.1 + Math.random() * 0.5);   // 树冠底附近出生

      } else { return; }   // 树场无树则不落叶（用户：树没了就不落叶）

    } else { return; }     // 无 trees 也不落叶

    this._fallingLeaves.push({

      x, y,

      vx: (Math.random() - 0.5) * 14,               // 轻微水平漂移

      vy: 24 + Math.random() * 26,                   // 缓慢下落

      sway: Math.random() * Math.PI * 2,            // 摇摆相位

      swayAmp: 12 + Math.random() * 20,

      rot: Math.random() * Math.PI * 2,

      vr: (Math.random() - 0.5) * 0.45,             // 自转放慢（原 ±1.6 太快）

      age: 0,

      life: 7 + Math.random() * 5,                   // 7~12 秒飘落全程

      frame: (Math.random() * 12) | 0,

      color: colors[(Math.random() * colors.length) | 0],

      size: 14 + Math.random() * 8,                 // 飘落叶子小一点（原 28~44 太大）

      scene: this.scene,                             // 记录出生场景，避免切场残留

    });

  },



  /** 推进落叶：仅秋季更新；非秋季让已有叶片自然落完（不突兀清空）。 */

  _updateLeaves(dt, W, H) {
    // 性能优化：非秋季且无残留落叶时完全跳过
    if (!this._isAutumn() && (!this._fallingLeaves || this._fallingLeaves.length === 0)) return;

    if (this._isAutumn()) {

      this._leafTick += dt;

      // 补充节奏放慢：约每 0.5s 一片，且概率 0.7（少量飘落，不满屏）

      if (this._leafTick > 0.5) {

        this._leafTick = 0;

        if (Math.random() < 0.7) this._spawnLeaf(W, H);

      }

    }

    const keep = [];

    for (const lf of this._fallingLeaves) {

      lf.age += dt;

      if (lf.age >= lf.life) continue;               // 落出寿命移除（底部淡出，见 draw）

      lf.x += (lf.vx + Math.sin(lf.age * 1.4 + lf.sway) * lf.swayAmp) * dt;

      lf.y += lf.vy * dt;

      lf.rot += lf.vr * dt;

      if (lf.x < -30) lf.x = W + 20; else if (lf.x > W + 30) lf.x = -20;

      keep.push(lf);

    }

    this._fallingLeaves = keep;

  },



  /** 绘制落叶：飘落动画帧 + 自转 + 落地前淡出；仅在秋季或尚有余叶时绘制。 */

  _drawLeaves(ctx, dt) {

    if (!this._fallingLeaves || !this._fallingLeaves.length) return;

    for (const lf of this._fallingLeaves) {

      if (lf.scene !== this.scene) continue;         // 切场后不再画旧场叶子

      const k = lf.age / lf.life;

      const alpha = k < 0.85 ? 1 : Math.max(0, 1 - (k - 0.85) / 0.15);  // 末段淡出，落地不突兀

      const f = lf.frame;   // 出生随机选定一种形态，飘落中保持不变（不在空中切换形态）

      const img = this._leafTinted(f, lf.color);

      if (!img) continue;

      const s = lf.size * (0.85 + 0.15 * k);

      ctx.save();

      ctx.globalAlpha = alpha;

      ctx.translate(lf.x, lf.y);

      ctx.rotate(lf.rot);

      ctx.imageSmoothingEnabled = false;

      ctx.drawImage(img, -s / 2, -s / 2, s, s);

      ctx.restore();

    }

    ctx.globalAlpha = 1;

  },



  /** 地面落叶堆：每格确定性散布几片棕色落叶（棕色染色 leaf_litter，保留叶形明暗纹理）。静态层每格绘制一次，等同「每格一张贴图」。 */

  _litterTinted() {

    if (this._litterTintCache) return this._litterTintCache;

    // 用 getTinted 正片叠底染色：保留 leaf_litter 内部明暗层次（不像 source-atop 纯色平涂那样糊成一块），自然像落叶堆

    const img = ASSETS.getTinted('leaf_litter', '#9c6b3c');   // 棕色落叶堆

    if (!img) return null;

    this._litterTintCache = img;

    return img;

  },



  /** 确保落叶计数 grid 存在（每格 0~4 份，每份 1/4 格）。null 时按全农场尺寸建全 0 数组。 */

  _ensureLitterGrid() {

    if (!this._litterGrid) {

      this._litterGrid = Array.from({ length: DATA.FARM.ROWS }, () => Array(DATA.FARM.COLS).fill(0));

    }

    return this._litterGrid;

  },

  /** 在单格 (x,y,cs) 按 count(0~4) 份绘制落叶：每份取「贴图的 1/4（一个象限）」绘入对应格象限（左上→右上→左下→右下）。 */

  _drawLitterCell(ctx, x, y, cs, count) {

    const img = this._litterTinted();

    if (!img) return;

    ctx.imageSmoothingEnabled = true;

    const h = cs / 2;

    const qx = [x, x + h, x, x + h];

    const qy = [y, y, y + h, y + h];

    // 把一个 leaf_litter 贴图**裁成 4 个象限**，每份取其中一块（1/4 贴图）绘入对应格象限，

    // 而非把整张缩成 1/4 格。source 取自然尺寸的一半（左右×上下各半）。

    const sw = (img.naturalWidth || img.width) / 2;

    const sh = (img.naturalHeight || img.height) / 2;

    const sx = [0, sw, 0, sw];

    const sy = [0, 0, sh, sh];

    for (let k = 0; k < count && k < 4; k++) {

      ctx.drawImage(img, sx[k], sy[k], sw, sh, qx[k], qy[k], h, h);

    }

  },



  /** 秋日落叶每日生成 / 冬季消失（用户规则，单位=1份=1/4格）：

   *  秋季（R78 按用户「秋天地上落叶提升四倍」整体 ×4）：每树 12% 概率（原 3%）→ 相邻非树非草格 +1 份

   *  （该格满 4 份则不计）；每天至多 16 份（原 4）、全图至多 40 个格有落叶（原 10；每格 0~4 份上限不变）。

   *  冬季：地上枯叶随机消失，每天至多 2 份（随机抽有落叶的格 -1）。春/夏：清空。 */

  _spawnDailyLitter() {

    const season = Engine.season;

    const ROWS = DATA.FARM.ROWS, COLS = DATA.FARM.COLS;

    // 冬季：枯叶随机消失，每天至多 2 份

    if (season === 3) {

      if (!this._litterGrid) return;

      for (let i = 0; i < 2; i++) {

        const cells = [];

        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this._litterGrid[r][c] > 0) cells.push([r, c]);

        if (!cells.length) break;

        if (Math.random() < 0.5) {

          const [r, c] = cells[(Math.random() * cells.length) | 0];

          this._litterGrid[r][c]--;

        }

      }

      return;

    }

    if (!this._isAutumn()) { this._litterGrid = null; return; }   // 春/夏：清空

    const grid = this._ensureLitterGrid();

    // 统计已占用格数（>0 的格）

    let occupied = 0;

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] > 0) occupied++;

    let dayParts = 0;                                            // 当天已落份数（上限 16，R78 ×4）

    // 收集所有树格

    const trees = [];

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (TreeFarm.trees[r] && TreeFarm.trees[r][c]) trees.push([r, c]);

    for (let i = 0; i < trees.length; i++) {

      if (dayParts >= 16) break;                                 // 每天至多 16 份（R78 ×4，可分散任意格）

      const [r, c] = trees[i];

      if (Math.random() >= 0.12) continue;                       // 每棵树 12% 命中（R78 ×4）

      // 收集「相邻非树、非绿黄草、未满 4 份」的格

      const neigh = [];

      for (let dr = -1; dr <= 1; dr++) {

        for (let dc = -1; dc <= 1; dc++) {

          if (dr === 0 && dc === 0) continue;

          const nr = r + dr, nc = c + dc;

          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;

          if (TreeFarm.trees[nr] && TreeFarm.trees[nr][nc]) continue;                       // 相邻是树则跳过

          const gr = (TreeFarm.grass && TreeFarm.grass[nr] && TreeFarm.grass[nr][nc]) || 0;

          if (gr >= 1) continue;                                 // 绿(1)/黄(2)草格跳过

          if (grid[nr][nc] >= 4) continue;                       // 该格已满 4 份

          neigh.push([nr, nc]);

        }

      }

      if (!neigh.length) continue;

      const [nr, nc] = neigh[(Math.random() * neigh.length) | 0];

      if (TreeFarm.trees[nr] && TreeFarm.trees[nr][nc]) continue;   // 生成在树格上 → 无效

      const gr2 = (TreeFarm.grass && TreeFarm.grass[nr] && TreeFarm.grass[nr][nc]) || 0;

      if (gr2 >= 1) continue;                                    // 绿/黄草上 → 无效

      if (grid[nr][nc] >= 4) continue;                           // 满 4 份 → 无效

      const wasEmpty = grid[nr][nc] === 0;

      if (wasEmpty && occupied >= 40) continue;                  // 总共至多 40 个格有落叶（R78 ×4，新格受限）

          grid[nr][nc]++;

      if (wasEmpty) occupied++;

      dayParts++;

    }

    // 落叶变化后标记农场缓存脏，触发重绘
    this.markFarmDirty();
  },



  /** 生成一颗雨滴：anywhere=true 时整屏随机（初始化）；否则从顶部落下。

   *  每滴的长度/速度/粗细/透明度都随机 → 破除「太整齐」的帘幕感 */

  _newDrop(W, H, anywhere) {

    const len = 8 + Math.random() * 20;               // 雨丝长度 8~28px（差异更大）

    return {

      x: Math.random() * (W + 40) - 20,

      y: anywhere ? (Math.random() * H) : -len,

      vy: 420 + Math.random() * 420,                 // 下落速度 420~840 px/s（速度差更大）

      vx: (-40 - Math.random() * 90) * (this._rainLevel === 2 ? 1.8 : 1), // 风向：左飘 -40~-130 px/s（暴雨 ×1.8 斜度更大）

      len,

      wF: 0.7 + Math.random() * 0.7,                 // 单滴粗细系数 0.7~1.4

      alpha: 0.35 + Math.random() * 0.5,             // 单滴透明度 0.35~0.85（更淡、不显眼）

      landY: (0.18 + Math.random() * 0.78) * H       // 落地「地面深度」：顶视下雨落满整片田，落点散布画面各处

    };

  },



  /** 从「水」贴图截取一段，预渲染成雨滴精灵（只做一次；精灵本身保持竖直，斜度由各雨滴运动方向在 _drawRain 里决定） */

  _buildRainSprite() {

    const img = this._waterImg;

    if (!img || !img.width) return;

    const W = 10, H = 28;                       // 雨滴精灵尺寸（细高）

    const c = document.createElement('canvas');

    c.width = W; c.height = H;

    const x = c.getContext('2d');

    // 从水贴图截一段竖向窄条，拉伸缩放到精灵尺寸 → 一条水感雨丝

    const sw = Math.min(6, img.width), sh = Math.min(14, img.height);

    x.drawImage(img, 1, 0, sw, sh, 0, 0, W, H);

    // 水贴图灰度、无颜色 → 叠一层「低饱和灰蓝」，比之前暗淡、不鲜明（用户：太显眼太蓝 → 灰灰的）

    x.globalCompositeOperation = 'source-atop';

    x.fillStyle = 'rgba(150,170,205,0.72)';    // 灰蓝（去鲜明）

    x.fillRect(0, 0, W, H);

    x.globalCompositeOperation = 'source-over';

    this._rainSprite = c;

  },



  /** 当前游戏时间（单调，单位=游戏小时，1 天 = this._dayHours 小时） */

  _totalGameHours() {

    if (typeof Engine === 'undefined' || !Engine) return 0;

    const D = DATA.DAYS_PER_SEASON, S = DATA.SEASONS_PER_YEAR, dayH = this._dayHours;

    const dayIndex = ((Engine.year - 1) * S + Engine.season) * D + (Engine.day - 1);

    return dayIndex * dayH + (Engine.hour - DATA.START_HOUR) + Engine.minute / 60;

  },



  /** 一场雨的时长（天）：0.5 ~ 3 天随机 */

  /** 随机浮点 ∈ [base, max)（天气时长/间隔共用，消除两处重复公式）。 */

  _randRange(base, max) { return base + Math.random() * (max - base); },



  _randRainDurDays() { return this._randRange(0.5, 3); },



  /** 雨停→下次下雨的间隔（天）：2 ~ 10 天随机 */

  _randGapDays() { return this._randRange(2, 10); },



  /** 每帧推进天气：到点自动在 雨 / 晴 之间切换，并同步 this.isRaining */

  _updateWeather() {

    const now = this._totalGameHours();

    if (now >= this._weatherTargetH) {

      this._switchWeatherPhase(now);

    }

  },



  /** 昼夜明暗系数：根据游戏内时刻返回夜晚黑暗强度 [0,1]（白天 0，深夜 ~0.6）。

   *  平滑过渡：破晓 6:00 微暗→7:00 全亮；白昼 7:00–18:00 全亮；黄昏 18:00–20:00 渐暗；夜晚 20:00–24:00 满夜。

   *  纯视觉，不影响玩法（作物生长/体力由 Engine 时钟决定）。 */

  _nightAlpha() {
    const t = (typeof Engine !== 'undefined' && Engine) ? (Engine.hour + Engine.minute / 60) : 12;
    const hour = Math.floor(t);
    const minute = Math.floor((t - hour) * 60);

    if (this._lastNightHour === hour && this._lastMinute === minute && this._nightAlphaCache !== null) {
      return this._nightAlphaCache;
    }

    let alpha;
    if (t < 7)  alpha = 0.4 * Math.max(0, (7 - t) / 1);   // 6:00 破晓微暗(0.4) → 7:00 全亮(0)
    else if (t < 18) alpha = 0;                            // 7:00–18:00 白昼
    else if (t < 20) alpha = 0.6 * (t - 18) / 2;          // 18:00 0 → 20:00 满夜(0.6)，黄昏渐暗
    else alpha = 0.6;                                      // 20:00–24:00 满夜

    this._nightAlphaCache = alpha;
    this._lastNightHour = hour;
    this._lastMinute = minute;
    return alpha;
  },



  /** 顶部昼夜蒙层：在整幅画面（含雨/雪）之上叠加深蓝夜色，使夜晚明显区别于白天。

   *  放在 render 栈最顶层（HUD 是 DOM，不受影响）；过渡帧也在 _renderTransition 末尾调用，保证切场也带夜色。 */

  _drawNightOverlay(ctx) {

    const a = this._nightAlpha();

    if (a <= 0) return;

    const W = this.canvas.width, H = this.canvas.height;

    ctx.imageSmoothingEnabled = false;

    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(8,14,42,' + a + ')';   // 深蓝夜空

    ctx.fillRect(-8, -8, W + 16, H + 16);          // 略大于画布，兼容屏幕震动位移

  },



  /** 下雨时自动浇灌主农场所有已耕地（置 cell.watered=true，等价于手动浇水；不影响树场） */

  _rainWaterFields() {

    if (typeof Farm === 'undefined' || !Farm.grid) return;

    const g = Farm.grid;

    for (let r = 0; r < g.length; r++) {

      const row = g[r]; if (!row) continue;

      for (let c = 0; c < row.length; c++) {

        const cell = row[c];

        if (cell && cell.tilled && !cell.watered) cell.watered = true;

      }

    }

    this.markFarmDirty(); // 刷新湿润土壤表现

  },



  /** 停止下雨：回到晴天空档并重置下次下雨倒计时（_updateWeather 与 _toggleRain 共用，消除重复的 clear + 重设 target 逻辑） */

  _clearWeather(now) {

    this._weatherPhase = 'clear';

    this._weatherTargetH = now + this._randGapDays() * this._dayHours;

  },



  /** 开始下雨：切到雨天空档并重置下雨持续倒计时（_updateWeather 与 _toggleRain 共用，消除重复的 rain + 重设 target 逻辑） */

  _startRain(now) {

    this._weatherPhase = 'rain';

    this._weatherTargetH = now + this._randRainDurDays() * this._dayHours;

  },



  /** 开始下雨并立刻浇灌主农场所有已耕地（_updateWeather 与 _toggleRain 的 else 分支共用，消除重复的 start+water 两行）。

   *  冬天是雪不是雨 → 不浇灌耕地（雪被地面接住，不会让地变湿）。 */

  _startRainAndWater(now) {

    this._startRain(now);

    if (!this._isWinter()) this._rainWaterFields();

  },



  /** 同步下雨标志：把 this.isRaining 与当前天气阶段对齐（_updateWeather 与 _toggleRain 共用，消除重复的同步赋值） */

  _syncIsRaining() {

    this.isRaining = (this._weatherPhase === 'rain');

  },

  /** 切换天气阶段：当前为雨则转晴、否则转雨（_updateWeather 与 _toggleRain 共用，消除重复的 if/else 派发 + 同步） */

  _switchWeatherPhase(now) {

    if (this._weatherPhase === 'rain') {

      this._clearWeather(now);

    } else {

      this._startRainAndWater(now);

    }

    this._syncIsRaining();

  },



  /** R 键：手动切换当前天气（同时重置该阶段倒计时，避免立刻被自动切换翻回） */

  _toggleRain() {

    const now = this._totalGameHours();

    this._switchWeatherPhase(now);

  },



  /** 在指定格子中心爆发粒子（收获/种植/砍树等动作反馈） */

  _spawnBurst(row, col, opts) {

    if (!this._particles) return;

    const cs = this.cellSize;

    this._particles.spawn(col * cs + cs / 2, row * cs + cs / 2, opts);

  },



  /** 在指定格子上方漂浮一行文字（如 +3 小麦 / 木头×4） */

  _floatText(row, col, text, opts) {

    if (!this._floaters) return;

    const cs = this.cellSize;

    this._floaters.spawn(col * cs + cs / 2, row * cs + cs * 0.32, text, opts);

  },



  /** 触发一次轻微屏幕震动（mag 像素 / dur 毫秒） */

  _shakeIt(mag, dur) { if (this._shake) this._shake.add(mag, dur); },



  /** 标记农场静态层已过期，下次 render 时重建缓存 */

});
