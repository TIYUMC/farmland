/**
 * ui-weather.js — 天气系统
 * 从 ui.js 拆分出的模块
 */

const _weatherMethods = {
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

    if (t < 7)  return 0.4 * Math.max(0, (7 - t) / 1);   // 6:00 破晓微暗(0.4) → 7:00 全亮(0)

    if (t < 18) return 0;                                 // 7:00–18:00 白昼

    if (t < 20) return 0.6 * (t - 18) / 2;                // 18:00 0 → 20:00 满夜(0.6)，黄昏渐暗

    return 0.6;                                           // 20:00–24:00 满夜

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


};

Object.assign(UI, _weatherMethods);
