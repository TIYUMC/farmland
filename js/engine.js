/**
 * engine.js — 核心引擎
 * 职责：时间流逝、日夜循环、季节推进、每日结算调度、游戏帧循环。
 *
 * ── 结构导航 ──
 *   [状态]    day/season/year/hour/minute + running/paused/debugFast + hooks
 *   ② 时间循环 start / _startTick / setDebugFast / pause / resume
 *   ③ 日切     sleep / _endDay / nextDay
 *   ④ 显示     getTimeString / getDateString
 *   ⑤ 控制     stop
 */

const Engine = {
  // === 日历状态 ===
  day: 1,          // 当月第几天 (1~14)
  season: 0,       // 0=春 1=夏 2=秋 3=冬
  year: 1,
  hour: DATA.START_HOUR,
  minute: 0,

  // === 运行状态 ===
  running: false,
  tickTimer: null,
  paused: false,
  debugFast: false,    // 调试快进：开启后 0.5 秒 = 1 天（临时功能）

  // === 外部 hooks ===
  onHourChange: null,     // callback(hour, minute)
  onMinuteChange: null,   // callback(hour, minute) — 每分钟刷新 HUD 时钟
  onTick: null,           // callback() — 每游戏刻（每分钟）触发一次，用于与渲染帧率无关的推进（积雪等）
  onNewDay: null,         // callback(day, season, year)
  onDayEnd: null,         // callback() → 返回 { 是否保存并继续 }

  // ─────────────────────────────────────────────
  // ② 时间循环
  // ─────────────────────────────────────────────
  /** 重置游戏内时钟到每日起点（start 与 nextDay 共用，消除重复的 START_HOUR/minute=0 赋值） */
  _resetClock() {
    this.hour = DATA.START_HOUR;
    this.minute = 0;
  },

  /** 初始化并开始首个游戏日 */
  start() {
    this.running = true;
    this._resetClock();
    this._startTick();
  },

  /** 清空当前计时器（若存在），避免多个 setTimeout 叠加（setDebugFast / pause / stop 共用） */
  _clearTickTimer() {
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
  },

  /** 内部：每分钟滴答（调试快进时改为 1 秒 = 1 天） */
  _startTick() {
    // 调试快进：每 0.5 秒直接推进一整天（作物生长/浇水重置/体力恢复都在 nextDay 内完成），
    // 绕过 onDayEnd 结算弹窗，避免每秒弹窗打断操作。
    if (this.debugFast) {
      this.tickTimer = setTimeout(() => {
        if (!this.running || this.paused) return;
        this.nextDay();
      }, 500);
      return;
    }
    const msPerTick = (DATA.REAL_SECS_PER_GAME_HOUR * 1000) / 60; // 每分钟
    const tick = () => {
      if (!this.running || this.paused) return;
      this.minute += 1; // 每 tick 走 1 分钟（配合 msPerTick，1 游戏小时 ≈ 12 秒，一天≈3.6 分钟）
      if (this.onTick) this.onTick();                              // 游戏刻钩子（积雪等按刻推进，与帧率无关）
      if (this.onMinuteChange) this.onMinuteChange(this.hour, this.minute);
      if (this.minute >= 60) {
        this.minute = 0;
        this.hour++;
        if (this.hour >= DATA.END_HOUR) {
          this._endDay();
          return;
        }
        if (this.onHourChange) this.onHourChange(this.hour, this.minute);
      }
      this.tickTimer = setTimeout(tick, msPerTick);
    };
    this.tickTimer = setTimeout(tick, msPerTick);
  },

  /** 切换调试快进（1 秒 = 1 天）。会干净地重启计时循环以切换模式。 */
  setDebugFast(on) {
    this.debugFast = !!on;
    this._clearTickTimer();
    this._startTick();
  },

  /** 强制暂停时间（UI操作时） */
  pause() {
    this.paused = true;
    this._clearTickTimer();
  },
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.running) this._startTick();
  },

  // ─────────────────────────────────────────────
  // ③ 日切
  // ─────────────────────────────────────────────
  /** 触发日结回调并推进到新的一天（_endDay 与 sleep 共用，消除重复的 onDayEnd 调用 + nextDay） */
  _advanceDay() {
    if (this.onDayEnd) this.onDayEnd();
    this.nextDay();
  },

  /** 一天结束 */
  _endDay() {
    // 先触发结算展示（读取当前日末状态，作为纯展示浮层）。
    // 不暂停、不停止走时：紧接着推进到新的一天，时间继续流逝，
    // 这样结算弹窗完全不阻塞操作、也不冻结时间。
    this._advanceDay();
  },

  /** 主动结束当天（B4 修复：玩家主动睡觉，等价于午夜自动结算） */
  sleep() {
    if (!this.running) return;
    // 限制：仅晚上 6 点（18:00）之后才允许主动睡觉（用户要求）
    if (this.hour < 18) {
      if (typeof UI !== 'undefined' && UI.showStatus) {
        UI.showStatus('🌙 还没到晚上 6 点，不能睡觉', 1500);
      }
      return;
    }
    this._advanceDay();
  },

  /** 进入下一天 */
  nextDay() {
    this.day++;
    if (this.day > DATA.DAYS_PER_SEASON) {
      this.day = 1;
      this.season++;
      if (this.season >= DATA.SEASONS_PER_YEAR) {
        this.season = 0;
        this.year++;
      }
    }
    this._resetClock();
    this.paused = false;
    // 日结推进：作物生长 / 重置浇水 / 恢复体力。
    // 放这里保证“结算时时间继续走”——由 _endDay 直接调用，无需等玩家点“继续”。
    if (typeof Farm !== 'undefined') { Farm.dailyGrow(); Farm.resetWater(); Farm.dailyGrassGrow(); Farm.dailyFlowerGrow(); }
    if (typeof TreeFarm !== 'undefined') { TreeFarm.dailyGrow(); TreeFarm.dailyGrassGrow(); } // 树场：树桩长回 + 补树 + 草随季节演化
    if (typeof Player !== 'undefined') { Player.restoreStamina(); }
    if (this.onNewDay) this.onNewDay(this.day, this.season, this.year);
    this.running = true;
    this._startTick();
  },

  // ─────────────────────────────────────────────
  // ④ 显示
  // ─────────────────────────────────────────────
  /** 格式化时间显示 */
  getTimeString() {
    const h = this.hour;
    const m = String(this.minute).padStart(2, '0');
    // 上午: 5~11 (含 6:00 起床)
    // 下午: 12~17
    // 晚上: 18~23
    // 午夜: 0~4 (通常不会出现，因为 24:00 触发睡觉)
    if (h >= 5 && h < 12)  return `上午 ${h}:${m}`;
    if (h === 12)           return `中午 12:${m}`;
    if (h >= 13 && h < 18) return `下午 ${h - 12}:${m}`;
    if (h >= 18 && h < 24) return `晚上 ${h - 12}:${m}`;
    if (h === 0)           return `午夜 0:${m}`;
    return `${h}:${m}`;
  },

  getDateString() {
    return `${DATA.SEASONS[this.season]}${this.day}日 第${this.year}年`;
  },

  // ─────────────────────────────────────────────
  // ⑤ 控制
  // ─────────────────────────────────────────────
  /** 停止引擎 */
  stop() {
    this.running = false;
    this._clearTickTimer();
  },
};
