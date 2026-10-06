/**
 * ui-weather.js — 从 ui.js 拆分
 */

const _weatherMethods = {
  _drawRain(ctx, dt) {

    if (this._isWinter()) { this._drawSnow(ctx, dt); return; }   // 冬天：雨渲染为飘雪（视觉替换，季节由 Engine.season 决定）

    const W = this.canvas.width, H = this.canvas.height;

    // 雨滴池目标数（随画布面积；暴雨 ×2 与降级裁回都要用）
    const n = Math.max(60, Math.round((W * H) / 4200));

    if (!this._rainDrops) {

      this._rainDrops = [];

      for (let i = 0; i < n; i++) this._rainDrops.push(this._newDrop(W, H, true));

    }

    // 暴雨（0.5.15）：浓段雨滴 ×2 顶置；降级回普通雨时裁回 n（不然下场普通雨继续画双份雨丝）
    if (this._rainLevel === 2) {
      while (this._rainDrops.length < n * 2) this._rainDrops.push(this._newDrop(W, H, true));
    } else if (this._rainDrops.length > n) {
      this._rainDrops.length = n;
    }

    // 阴天压暗（覆盖已绘制的一切，营造阴沉天色；稍大于画布以兼容屏幕震动位移）

    ctx.fillStyle = 'rgba(70,90,120,' + (this._rainLevel === 2 ? '0.45' : '0.20') + ')';

    ctx.fillRect(-8, -8, W + 16, H + 16);

    // 雷闪排程（0.5.15 文档 A 案，纯屏闪白、无音频；0.5.16 观感加强：6 帧≈100ms 肉眼清晰闪，间隔 0.8~3s 浓段内必闪 1~3 次）
    // 实际画白框在 _drawNightOverlay（要画在夜蒙层之上）
    if (this._rainLevel === 2) {
      this._stormFlashCd -= dt;
      if (this._stormFlashCd <= 0) { this._stormFlashLeft = 6; this._stormFlashCd = 0.8 + Math.random() * 2.2; }
    }

    const sprite = this._rainSprite;

    if (sprite) {

      // 水贴图截取的雨滴精灵：逐滴绘制；雨丝斜度 = 该滴运动方向（形状与掉落方向一致，不再「竖直身子斜着掉」）；粗细/透明度各异

      for (const d of this._rainDrops) {

        d.y += d.vy * dt;

        d.x += d.vx * dt;

        if (d.y >= d.landY) { this._spawnRipple(d.x, d.landY); Object.assign(d, this._newDrop(W, H, false)); }

        const w = Math.max(1.2, d.len * (this._rainLevel === 2 ? 0.25 : 0.12) * (d.wF || 1)), h = d.len * 1.2;

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

    // 暴雨（0.5.15）：浓段进出（仅非冬季的雨；冬季 rain 走飘雪路径不进浓段）
    if (this._weatherPhase === 'rain' && !this._isWinter()) {
      if (this._stormScheduledAtH != null && now >= this._stormScheduledAtH && this._rainLevel === 1) this._rainLevel = 2;
      if (this._rainLevel === 2 && this._stormEndH != null && now >= this._stormEndH) this._rainLevel = 1;
    }

    // 暴雪（0.5.15）：进出（仅冬季的雪；与暴雨双 guard 互斥——非冬季暴雨、冬季暴雪）
    if (this._weatherPhase === 'rain' && this._isWinter()) {
      if (this._blizzardScheduledAtH != null && now >= this._blizzardScheduledAtH && this._snowLevel === 1) this._snowLevel = 2;
      if (this._snowLevel === 2 && this._blizzardEndH != null && now >= this._blizzardEndH) this._snowLevel = 1;
    }

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

    // 雷闪（0.5.15，文档 A 案）：浓段排程的白框画在夜蒙层之上，1~2 帧白、无音频
    if (this._stormFlashLeft > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';   // 0.5.16：闪白 0.25→0.45，暴雨雷闪更醒目
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this._stormFlashLeft--;
    }

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

    // 暴雨（0.5.15）：雨停清场时重置浓段状态，防上一场残留
    this._rainLevel = 1;
    this._stormScheduledAtH = null;
    this._stormEndH = null;

    // 大风散场（0.5.40）：不清池，启动淡出倒数
    if (this._windStreaks && this._windStreaks.length) this._windFadeLeft = ((typeof DATA !== 'undefined' && DATA.WEATHER) ? DATA.WEATHER.windFadeSec : 0.6);

    // 暴雪（0.5.15）：雪停清场时重置暴雪段状态
    this._snowLevel = 1;
    this._blizzardScheduledAtH = null;
    this._blizzardEndH = null;

  },



  /** 开始下雨：切到雨天空档并重置下雨持续倒计时（_updateWeather 与 _toggleRain 共用，消除重复的 rain + 重设 target 逻辑） */


  _startRain(now) {

    this._weatherPhase = 'rain';

    const durH = this._randRainDurDays() * this._dayHours;
    this._weatherTargetH = now + durH;

    // 暴雨（0.5.15）：每场雨重置全部浓段状态；非冬季 50% 概率预先排一个浓段
    // 浓段时刻 = 本雨场的 30%~70%，时长 0.3~0.8 天，两个 Math.min 钳死绝不越过雨场终点
    this._rainLevel = 1;
    this._stormScheduledAtH = null;
    this._stormEndH = null;
    this._stormFlashLeft = 0;
    this._stormFlashCd = 1;
    if (!this._isWinter() && Math.random() < 0.5) {
      const at = now + durH * (0.3 + Math.random() * 0.4);
      this._stormScheduledAtH = Math.min(at, this._weatherTargetH - durH * 0.2);
      this._stormEndH = Math.min(at + this._randRange(0.3, 0.8) * this._dayHours, this._weatherTargetH);
    }

    // 暴雪（0.5.15）：冬季雪场 50% 概率排一个暴雪段，公式逐项同款、字段换 blizzard
    this._snowLevel = 1;
    this._blizzardScheduledAtH = null;
    this._blizzardEndH = null;
    if (this._isWinter() && Math.random() < 0.5) {
      const at = now + durH * (0.3 + Math.random() * 0.4);
      this._blizzardScheduledAtH = Math.min(at, this._weatherTargetH - durH * 0.2);
      this._blizzardEndH = Math.min(at + this._randRange(0.3, 0.8) * this._dayHours, this._weatherTargetH);
    }

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

    if (this._weatherPhase === 'rain' || this._weatherPhase === 'wind') {

      this._clearWeather(now);

    } else {

      // 晴天空档到期派发（0.5.46 删大雾）：冬季全雨（飘雪，保持现行为）；非冬季——
      // 35% 大风 / 20% 延长晴天（no-op，不派发只推后晴天空档）/ 余量 45% 全给雨
      if (this._isWinter()) {
        this._startRainAndWater(now);
      } else {
        const r = Math.random();
        if (r < 0.35) this._startWind(now);
        else if (r < 0.55) this._weatherTargetH = now + this._randGapDays() * this._dayHours;   // 0.5.46 延长晴天（no-op：不派发、推后倒计时，下次到点重新派发）
        else this._startRainAndWater(now);
      }

    }

    this._syncIsRaining();

  },

  /** 调试用：设指定天气阶段（clear/rain/wind）并重置该阶段倒计时，行为与 R 键 _toggleRain 同一套底层逻辑。
   *  与 _switchWeatherPhase 对称：那是 toggle（雨→晴/晴→雨），本方法是直接设值。 */
  _setWeatherPhase(phase) {

    const now = this._totalGameHours();

    if (phase === 'rain') {

      this._startRainAndWater(now);      // 重置雨期倒计时 + 浇灌主农场（冬天自动跳过）

    } else if (phase === 'wind') {

      this._startWind(now);             // 调试下拉选「大风」：起一阵纯视觉阵风

    } else {

      this._clearWeather(now);           // 重置下次降雨倒计时

    }

    this._syncIsRaining();

  },



  /** 纯视觉阵风（0.5.10）：起一场大风。方向开风时随机定一次（1=向右吹，-1=向左吹），风停前不变。
   *  不影响玩法（isRaining 保持 false → 雨/雪/涟漪/自动浇灌全不触发）。*/
  _startWind(now) {

    this._weatherPhase = 'wind';

    this._weatherTargetH = now + this._randWindDurDays() * this._dayHours;

    this._windDir = Math.random() < 0.5 ? 1 : -1;   // 1=向右，-1=向左（镜像）

    if (!this._windStreaks || !this._windStreaks.length) this._windFadeLeft = 0;   // 散场淡出复位（0.5.41：仅池空才复位，散场淡出没走完就起新天气时保留旧淡出、不破坏倒数）

    this._syncIsRaining();

  },

  /** 一场大风时长（游戏天）：0.5 ~ 2 天随机（与雨时长 _randRainDurDays 同公式风格） */

  _randWindDurDays() { return this._randRange(0.5, 2); },

  /** 生成一条风丝（16px 贴图集放大到 48px）：按方向贴屏外出生，y/speed/frame 随机错相 */

  _newWindStreak(W, H) {

    const dir = this._windDir || 1;

    const set = Math.random() < 0.5 ? 1 : 0;   // 1=新套(13帧,远层) 0=旧套(19帧)
    const base = 120 + Math.random() * 140;     // 120~260 px/s，每条自定
    return {
      x: dir === 1 ? -48 : (W + 48),   // 向右吹从左屏外进；向左吹从右屏外进
      y: Math.random() * H,
      speed: set === 1 ? base * 0.75 : base,   // 新套=远层慢 25%
      frame: Math.floor(Math.random() * (set === 1 ? 13 : 19)), // 各套自己的帧数错相
      set: set,
    };

  },

  /** 每帧推进风丝：风停即清场；数量维持 ~9 条；沿 _windDir 横移、出屏对侧重生；帧推进每 4 渲染帧 1 帧（两套各自帧数循环：旧 19/新 13） */

  _updateWind(dt, W, H) {

    if (this._weatherPhase !== 'wind') {
      if (!(this._windStreaks && this._windStreaks.length)) return;   // 无残池静默
      const fadeSec = ((typeof DATA !== 'undefined' && DATA.WEATHER) ? DATA.WEATHER.windFadeSec : 0.6);
      this._windFadeLeft -= dt;
      if (this._windFadeLeft <= 1e-4) { this._windStreaks = []; this._windFadeLeft = 0; return; }   // epsilon 判零（浮点累积误差防永久残留）
    }

    if (!this._windStreaks) this._windStreaks = [];

    const target = 9;   // 8~10 居中

    if (this._weatherPhase === 'wind') {   // 补量只在风起期做（淡出期不再补新条）
      while (this._windStreaks.length < target) this._windStreaks.push(this._newWindStreak(W, H));
    }

    this._windFrameTick = (this._windFrameTick || 0) + 1;

    const advFrame = (this._windFrameTick & 3) === 0;   // 每 4 渲染帧播 1 帧贴图 ≈ 15fps 走 19 帧

    for (const s of this._windStreaks) {

      s.x += this._windDir * s.speed * dt;

      if (advFrame) s.frame = (s.frame + 1) % (s.set ? 13 : 19);   // 各套按自己帧数循环

      if (this._weatherPhase === 'wind') {   // 越界对侧回卷只在风起期（淡出期越界就让它出屏，别"越淡越冒新"）

        if (this._windDir === 1) {

          if (s.x > W + 48) { s.x = -48 - (s.x - (W + 48)); s.y = Math.random() * H; }   // 越界多少从对侧回多少

        } else {

          if (s.x < -48) { s.x = (W + 48) + ((-48) - s.x); s.y = Math.random() * H; }

        }

      }

    }

  },

  /** 绘制风丝：48px 像素风（imageSmoothingEnabled=false，画完恢复避免影响雨/雪精灵）；
   *  向左吹的场水平镜像（绕贴图右缘，与树苗翻转同款套路），尾迹指向与移动方向相反 */

  _drawWind(ctx, dt) {

    const arr = this._windStreaks;

    if (!arr || !arr.length) return;

    // 散场淡出（0.5.40）：非 wind 期按剩余倒数比例逐帧降 alpha；wind 期恒 1
    const fadeK = (this._weatherPhase === 'wind') ? 1 : Math.max(0, (this._windFadeLeft || 0) / (((typeof DATA !== 'undefined' && DATA.WEATHER) ? DATA.WEATHER.windFadeSec : 0.6)));

    const flip = (this._windDir === -1);

    ctx.imageSmoothingEnabled = false;

    ctx.globalAlpha = fadeK;   // 近层整体淡出乘数（循环末统一还原 1）

    for (const s of arr) {

      const key = s.set ? 'wind_1_' + s.frame : 'wind_' + s.frame;   // 按套取帧（新套 wind_1_*，旧套 wind_*）
      const img = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get(key) : null;

      if (!img) continue;

      if (s.set) { ctx.save(); ctx.globalAlpha = 0.6 * fadeK; }   // 新套=远层，淡一点（与下方 flip 的 save/restore 嵌套，alpha 收尾还原）

      if (flip) {

        ctx.save();

        ctx.translate(s.x + 48, s.y);

        ctx.scale(-1, 1);

        ctx.drawImage(img, 0, 0, 48, 48);

        ctx.restore();

      } else {

        ctx.drawImage(img, s.x, s.y, 48, 48);

      }

      if (s.set) ctx.restore();   // globalAlpha 还原回 1，不泄漏到雨/雪精灵

    }

    ctx.globalAlpha = 1;   // 还原整体淡出乘数，不泄漏到雨/雪精灵
    ctx.imageSmoothingEnabled = true;   // 恢复，后续雨/雪精灵不被影响

  },



  /** R 键：手动切换当前天气（同时重置该阶段倒计时，避免立刻被自动切换翻回） */


  _toggleRain() {

    const now = this._totalGameHours();

    this._switchWeatherPhase(now);

  },



  /** 在指定格子中心爆发粒子（收获/种植/砍树等动作反馈） */


};

Object.assign(UI, _weatherMethods);
