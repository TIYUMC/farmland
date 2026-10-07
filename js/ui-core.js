/**
* ui-core.js — UI 渲染主循环 + 动作框架 + 颜色/季节/随机工具 + 全部 25 字段 + 文件尾暴露段
* 职责：渲染主循环(render) / 动画循环 / 动作框架(_tryAction/_busy) / 季节配色与随机 / 场景切换 / 状态提示 / 脏格刷新入口；本文件是全库唯一写 const UI={...} 字面量的文件，后续 4 件与 7 个补丁文件全部以 Object.assign(UI,{...}) 挂载
* 生效/影子：独有 _refreshDirtyCells（无补丁覆盖）；本文件为 UI 字段与主循环的唯一字面量来源。
* 方法清单：
*   - _hexToRgb
*   - _shade
*   - _seasonColorAt
*   - _cellSeed
*   - _stackChunks
*   - _tryAction
*   - _fail
*   - _warnAlreadyTilled
*   - _warnIfNotOk
*   - init
*   - render
*   - _startAnimLoop
*   - _stopAnimLoop
*   - showStatus
*   - _refreshDirtyCells
*   - toggleScene
* 字段清单（25）：canvas、ctx、cellSize、offsetX、offsetY、statusTimeout、_achievementTimeout、summaryCallback、_busy、_busyTimer、_busyEffectTimer、_busyEffectResult、BUSY_BASE_MS、BUSY_SLOW_K、_animRaf、_isPageVisible、_isMobile、_hoverRaf、_hoverCell、_mouseX、_mouseY、scene、_seasonColors、_bareSoilKeys、_dryGrassColor
*/
const UI = {
  canvas: null,

  ctx: null,

  cellSize: DATA.FARM.CELL_SIZE,

  offsetX: 0, offsetY: 0,



  statusTimeout: null,

  _achievementTimeout: null,  // 成就弹窗定时器

  summaryCallback: null,



  _busy: false,        // 正在执行动作中（期间锁输入，不能干别的事）

  _busyTimer: null,

  _busyEffectTimer: null,   // 80% 触发真正世界改动的定时器

  _busyEffectResult: null,  // onEffect 的返回结果，传给 onDone 复用

  BUSY_BASE_MS: 600,   // 满体力时单次动作耗时（毫秒）

  BUSY_SLOW_K: 2.5,    // 体力越低、耗时放大系数：0 体力时耗时 = 满体的 (1+K) = 3.5 倍

  _animRaf: null,      // requestAnimationFrame 句柄，用于停止动画循环
  _isPageVisible: true, // 页面是否可见
  _isMobile: false,    // 是否为移动设备（性能优化）
  _hoverRaf: null,     // 悬停动画帧句柄



  _hoverCell: null, // { row, col } | null

  _mouseX: -1e4, _mouseY: -1e4, // 画布内鼠标像素坐标（供画布 UI 高亮 + 草描边距离渐变）；-1e4=未移动/已离开→描边默认10%

  scene: 'farm',    // 'farm' = 主农场；'treeFarm' = 树场（独立子场景）。切换时 markFarmDirty 重建静态层。



  // 绘制缓存

  _seasonColors: {

    0: { soil: '#7a5c3a', grass: '#6b7f4f', bg: '#74925f', water: '#4a8adf' }, // 春（降绿、偏柔和黄绿，避免过绿）

    1: { soil: '#8a6c3a', grass: '#6a9a4a', bg: '#7aaa5a', water: '#3a7adf' }, // 夏

    2: { soil: '#7a5c3a', grass: '#7a8a3a', bg: '#8a9a4a', water: '#4a7acf' }, // 秋

    3: { soil: '#5a4c3a', grass: '#9e8a40', bg: '#7a7350', water: '#5a8abf' }, // 冬（草改枯黄、比秋更黄；背景转灰黄，告别过绿）

  },



  // 裸土时随机选用的土图（用户新增的 3 种土，已注册进 assets.js registry）

  // 裸土渲染候选土图：随格随机选一种（dirt / coarse_dirt / rooted_dirt 均为桌面源素材，非坏图）

  _bareSoilKeys: ['coarse_dirt', 'dirt', 'rooted_dirt'],



  // 枯黄草(退化态2)的固定染色：比草方块(暗草色)明显更亮更黄，与绿草/草方块都拉开色差

  _dryGrassColor: '#c2a24c',



  // 把 #rrggbb 转成 {r,g,b}

  // ─────────────────────────────────────────────

  // [工具] 颜色 / 季节 / 随机计算

  // ─────────────────────────────────────────────

  _hexToRgb(hex) {

    const h = hex.replace('#', '');

    return {

      r: parseInt(h.slice(0, 2), 16),

      g: parseInt(h.slice(2, 4), 16),

      b: parseInt(h.slice(4, 6), 16),

    };

  },



  // 把 'rgb(r,g,b)' 调亮/调暗 amt（正=亮，负=暗）。用于让草丛与底色拉开对比，草才显得出。

  _shade(rgb, amt) {

    const m = String(rgb).match(/\d+/g);

    if (!m || m.length < 3) return rgb;

    const c = (i) => Math.max(0, Math.min(255, (+m[i]) + amt));

    return `rgb(${c(0)},${c(1)},${c(2)})`;

  },



  // 按「季节 + 当天进度」连续插值出当天颜色：每天挪一点点，渐变而非换季硬切。

  // 返回 {soil, grass, bg, water}，格式为 'rgb(r,g,b)'，喂给 ASSETS.getTinted 当缓存键也安全。

  _seasonColorAt() {

    const palette = this._seasonColors;

    const daysPer = DATA.DAYS_PER_SEASON;

    const t = Engine.season + (Engine.day - 1) / daysPer; // 连续季节位置 0..4

    const i0 = Math.floor(t) % 4;

    const i1 = (i0 + 1) % 4;

    const f = t - Math.floor(t); // 本季内进度 0..1

    const lerp = (a, b) => {

      const ca = this._hexToRgb(a), cb = this._hexToRgb(b);

      const r = Math.round(ca.r + (cb.r - ca.r) * f);

      const g = Math.round(ca.g + (cb.g - ca.g) * f);

      const bl = Math.round(ca.b + (cb.b - ca.b) * f);

      return `rgb(${r},${g},${bl})`;

    };

    return {

      soil: lerp(palette[i0].soil, palette[i1].soil),

      grass: lerp(palette[i0].grass, palette[i1].grass),

      bg: lerp(palette[i0].bg, palette[i1].bg),

      water: lerp(palette[i0].water, palette[i1].water),

    };

  },



  /** 取「季节草色」并按 delta 偏移明度（this._shade(this._seasonColorAt().grass, delta) 的便捷版），

   *  集中收口「草色 + N 明度」的计算，避免散落重复。 */

  _cellSeed(r, c) {

    let h = (r * 374761393 + c * 668265263) >>> 0;

    h = (h ^ (h >>> 13)) >>> 0;

    h = (h * 1274126177) >>> 0;

    h = (h ^ (h >>> 16)) >>> 0;

    return h / 4294967296;

  },



  // 裸土格按 cell 稳定随机选一种土图（与裸土判定用不同 seed 偏移，互不相关）

  _stackChunks(total, STACK = 64) {

    const chunks = [];

    let rem = Math.max(0, total || 0);

    while (rem > 0) {

      const inSlot = Math.min(STACK, rem);

      chunks.push(inSlot);

      rem -= inSlot;

    }

    return chunks;

  },



  /**

   * 体力事务（B1 规则）：先扣体力 → 执行动作 → 失败自动回滚，避免白扣体力。

   *

   * 全部田间动作（锄/除草/耕/浇/种/收/砍）都遵守这一套，此前每处各写一遍

   * `spendStamina → 动作 → else refundStamina`，共 7 份重复，现统一收口于此。

   *

   * 两种返回契约都支持（农场层历史遗留，不强行统一以免改动业务代码）：

   *   · 字符串型：`'ok'` 成功，其余为失败原因（till / toDirt / water / plant / clearGrass）

   *   · 对象型：`{ ok: true, … }` 成功，`{ ok: false, reason }` 失败（harvest / chop）

   *

   * 注意：只负责「扣 / 回滚」，成功与失败的提示文案、标脏、忙碌动画仍留在调用方，

   * 因此控制流（switch 内的 break、提前 return）完全不受影响。

   *

   * @param {number}   cost   本次动作消耗的体力

   * @param {Function} action 实际动作，返回上述两种契约之一

   * @returns {*} 原样返回 action 的结果，调用方照旧按 `'ok'` / `res.ok` 分支处理

   */

  _tryAction(cost, action) {

    Player.spendStamina(cost);          // 先扣：体力耗尽也允许干活，spendStamina 不拦截

    const res = action();

    const ok = (res === 'ok') || !!(res && res.ok);

    if (!ok) Player.refundStamina(cost); // 失败回滚

    return res;

  },



  /** 动作失败提示：res 为 null/无 ok 时弹错误并返 true（调用点 `if (this._fail(res,msg)) return;` 早返），否则返 false。harvest/chop/通用错误处理三处共用。 */

  _fail(res, msg) {

    if (!res || !res.ok) { this.showStatus(msg, 800); return true; }

    return false;

  },



  /**

   * 锄头动作返回 'already_tilled' 时的统一提示：

   * 地里已有作物就提醒「还没成熟」，空耕地则提醒「已经耕过了」。

   * 耕地与锄成泥土两条分支共用（原为两份逐字相同的代码）。

   */

  _warnAlreadyTilled(cell) {

    if (cell && cell.crop) this.showStatus('作物还没成熟，再等等', 600);

    else this.showStatus('这块地已经耕过了', 500);

  },



  /** 锄头「耕地 / 锄成泥土」两条分支 onDone 的早返守卫：res 非 ok 时提示已耕过并拦截。 */

  _warnIfNotOk(res, cell) {

    if (res !== 'ok') { this._warnAlreadyTilled(cell); return true; }

    return false;

  },



  // ─────────────────────────────────────────────

  // ① 初始化 / 画布尺寸

  // ─────────────────────────────────────────────

  init() {

    this.canvas = document.getElementById('game-canvas');

    this.ctx = this.canvas.getContext('2d');

    this._resize();

    window.addEventListener('resize', () => this._resize());

    // 转屏：部分移动浏览器的 resize 在旋屏后有延迟/尺寸未稳，补一次延时重算，
    // 否则横竖屏切换后画布会停留在旧尺寸（表现为画面偏移或显示不全）。
    window.addEventListener('orientationchange', () => {
      this._resize();
      setTimeout(() => this._resize(), 300);
    });



    // 事件绑定

    this.canvas.addEventListener('click', (e) => {
      this._onCanvasClick(e);
    });

    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));

    this.canvas.addEventListener('mouseleave', () => {

      if (this._hoverRaf) { cancelAnimationFrame(this._hoverRaf); this._hoverRaf = null; }

      this._hoverCell = null;
      this._mouseX = -1e4; this._mouseY = -1e4;   // 移出画布：草描边距离极大→回落默认 10%（_drawGrassOutline 据此淡出）

      this._needsRender = true;
      this.render();

    });

    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

    // 切场导航箭头 DOM 按钮：锁定 → nudge；未锁定 → toggleScene（T 键/调试关闭强退仍走 toggleScene，内部已含 _updateNavBtn）
    const navBtn = document.getElementById('nav-scene-btn');
    if (navBtn) navBtn.addEventListener('click', () => this._navBtnClick());

    // 手机无鼠标：用手指当「靠近点」驱动草描边距离渐变（_eventToCanvas 已取 e.touches[0]）
    this.canvas.addEventListener('touchmove', (e) => this._onMouseMove(e), { passive: false });
    this.canvas.addEventListener('touchend', () => {
      if (this._hoverRaf) { cancelAnimationFrame(this._hoverRaf); this._hoverRaf = null; }
      this._mouseX = -1e4; this._mouseY = -1e4;   // 抬手：草描边回落默认 10%
      this._needsRender = true; this.render();
    });



    // 商店交易列表滚动：滚轮翻行 + 拖动右侧滑块把手

    // （mousemove/mouseup 挂在 window 上，指针拖出画布也不会卡住把手）

    this.canvas.addEventListener('wheel', (e) => { if (this._onShopWheel) this._onShopWheel(e); }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => { if (this._onShopBarDown) this._onShopBarDown(e); });
    this.canvas.addEventListener('touchstart', (e) => { if (this._onShopBarDown) this._onShopBarDown(e); }, { passive: false });
    window.addEventListener('mousemove', (e) => { if (this._onShopBarMove) this._onShopBarMove(e); });
    window.addEventListener('touchmove', (e) => { if (this._onShopBarMove) this._onShopBarMove(e); }, { passive: false });
    window.addEventListener('mouseup', () => { this._shopBarDrag = false; });
    window.addEventListener('touchend', () => { this._shopBarDrag = false; });



    // 工具栏按钮只绑定点击；选中态由「底部快捷栏」统一高亮显示（见 _invSyncSelToTool），

    // 这里不再给任何工具按钮加 .active，避免与快捷栏形成第二个高亮框。

    document.querySelectorAll('.tool-btn').forEach(btn => {

      btn.addEventListener('click', () => this._onToolClick(btn));

    });



    // 背包关闭：点击面板外区域 or 按 B / Esc

    const overlay = document.getElementById('inventory-overlay'); if (overlay) overlay.addEventListener('click', (e) => {

      if (e.target === e.currentTarget) {

        // 光标上有物：先退回背包（不丢），不关；否则关闭

        if (this._invHeld) { this._invReturnHeld(); this.renderInventory(); this._updateGhost(); }

        else this.closeInventory();

      }

    });


    // 持续重绘循环：驱动未浇水作物的闪烁动画

    // 注意：不在 init() 中启动动画循环，避免标题屏幕时渲染旧数据
    // 动画循环在游戏正式开始后才启动（_startNewGame / _continueGame）



        // 页面不可见时暂停渲染，节省性能
    document.addEventListener('visibilitychange', () => {
      this._isPageVisible = !document.hidden;
      if (this._isPageVisible && !this._animRaf) this._startAnimLoop();
    });

    // 切换场景时重置动画循环
    window.addEventListener('gameSceneChange', () => {
      this._stopAnimLoop();
      if (this._isPageVisible) this._startAnimLoop();
    });

    // 游戏手感增强（juice.js）：粒子 / 漂浮文字 / 屏幕震动 / 箭头平滑 hover

    this._particles = new Juice.ParticleSystem();

    this._floaters  = new Juice.Floaters();

    this._shake     = new Juice.Shake();

    this._lastFrame = 0;
    this._isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

    this._navBtnLast = null;                                 // DOM 导航按钮幂等标记（{scene, locked, left}）



    // 视觉下雨（纯画面，不影响玩法）：雨滴用「水」贴图截取的一段；按天气系统随机下雨

    // 开局随机：一半几率直接下雨、一半晴（用户要求「不要开局就下雨，随机」）；随后 0.5~3 天一场、间隔 2~10 天 自动循环

    this._dayHours = DATA.END_HOUR - DATA.START_HOUR;        // 一天 = 18 游戏小时

    this._weatherPhase = (Math.random() < 0.01) ? 'rain' : 'clear';   // 当前阶段：rain / clear（开局随机）

    this._weatherTargetH = this._totalGameHours() + (this._weatherPhase === 'rain' ? this._randRainDurDays() : this._randGapDays()) * this._dayHours;

    this.isRaining = (this._weatherPhase === 'rain');         // 与阶段同步（render 据此画雨）

    if (this.isRaining && !this._isWinter()) this._rainWaterFields();   // 开局即下雨则立刻浇灌已耕地（冬天是雪不浇）

    this._rainDrops = null;                                  // 雨滴数组懒初始化

    this._ripples = [];                                      // 雨滴落地涟漪数组（空，下雨时生成）

    this._grassShakes = [];                                  // 草丛被雨打颤数组（空，下雨时生成）

    this._shakeSnowBaseCache = null;                          // 积雪时的草格底缓存：雪覆盖时草格底含雪，无雪时用 _grassBaseCache

    this._fallingLeaves = [];                                // 秋日落叶数组（仅秋季生成）

    this._windStreaks = [];                                  // 大风风丝数组（仅 phase==='wind' 时填充）
    this._windFadeLeft = 0;      // 风丝散场淡出倒数（秒）

    this._litterGrid = null;                                // 秋日地面落叶堆：每格0~4份(每份1/4格)二维计数 grid；null=未初始化/已清空

    this._litterTintCache = null;                           // 地面落叶堆棕色染色缓存

    this._leafTint = {};                                     // 落叶染色缓存（source-atop 纯秋色）

    this._leafTick = 0;                                      // 落叶飘落动画帧推进计时

    this._forceAutumnLeaves = false;                         // 调试开关：强制显示落叶（无视季节，仅测试用）

    this._rainSprite = null;                                 // 水贴图截取的雨滴精灵（懒加载）

    this._waterImg = new Image();

    this._waterImg.onload = () => this._buildRainSprite();

    this._waterImg.src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.water) ? ASSETS.registry.water : '';



    // 积雪系统（16×16 像素格逐步累积铺满）：每个雪花有固定随机落点，雪停后留在该位置。

    this._snowGround = [];            // 地面积雪雪花 [{x, y}] 固定位置列表

    this._snowTotal = 0;              // 积雪雪花数量（>0 才绘制）

    this._snowTick = 0;               // 每游戏刻 +1

    this._vegCache = null;            // 植被离屏缓存（仅草+花），在积雪层之后贴回 → 草花显示在雪之上
    this._farmCache = null;           // 静态农场层离屏缓存：首次为null确保全量重建
    this._farmCacheEntries = {};      // 单格缓存：{key: canvas} 缓存已渲染的单格
    this._farmCacheDirty = new Set(); // 需要重绘的格子集合
    this._vegCacheDirty = new Set();  // vegCache 需要重绘的格子集合
    this._grassBaseCache = null;      // 草格底缓存：预渲染草格底图，用于草颤动画
    this._farmCacheKey = '';          // 缓存签名，首次渲染时因 _farmCache=null 触发全量重建
    this._grassDataRev = 0;           // 农场数据修订号：除草/耕地/季节等改变草分布时 +1，使合并草轮廓缓存(_ensureGrassOutline)失效
    this._farmDirty = false;          // 全量重建标志，确保首次渲染时正常重建缓存

    // 性能缓存：避免每帧重复计算
    this._nightAlphaCache = null;     // 夜间蒙层强度缓存（游戏时间变化时才重算）
    this._lastNightHour = -1;         // 上次计算的小时（用于缓存失效检测）
    this._lastMinute = -1;            // 上次计算的分钟



    // 初始化选中态（_updateHeldSlot 已是空实现，保留调用以免各处判空）

    this._updateHeldSlot();



    // 商店（直接画在游戏画布上）状态初始化

    this._shopOpen = false;

    this._shopSel = null;

    this._shopLayout = null;

    this._shopHover = null;

    this._trades = [];

    this._dragKey = null;          // 当前从背包拖出（dragstart）的物品 key

    this._dragCount = 1;          // 当前拖出物品的堆叠数量（拖入输入框后输入栏按此显示）

    this._shopDroppedId = null;   // 已拖入输入框且匹配的交易 id（输出框显示产物的前提）

    this._shopDroppedCount = null;// 已放入输入框的物品数量（每次成交后递减，实时显示剩余）

    this._shopReservedKey = null; // 已被拖入输入框、需从背包扣除的物品 key（money / 作物 assetHarvest）

    this._toolParts = {};        // 工具交易：已拖入的各材料 { key: count }

    this._toolReserved = [];     // 工具交易：已从背包「扣除」（隐藏）的材料 key 列表

    this._shopDirty = false;   // 仅当交易状态变化时重建 DOM 图标，避免每帧抖动

    this._shopScroll = 0;      // 交易列表滚动偏移（单位：行）

    this._shopVis = 7;         // 列表一屏可见行数（每帧按纹理凹槽高度算出，这里给个兜底）

    this._shopBarDrag = false; // 是否正在拖动滚动条把手

  },



  render() {

    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);   // 每帧从单位矩阵开始，消除任何残留 translate 累积导致的抖动画面

    const cs = this.cellSize;



    // 帧间 dt（秒），用于所有基于时间的动画，帧率无关

    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    const dt = this._lastFrame ? Math.min(0.05, (now - this._lastFrame) / 1000) : 0.016;

    this._lastFrame = now;

    this._shakeX = 0; this._shakeY = 0;   // 默认无震动偏移；下方用 setTransform 绝对矩阵绘制雨/雪时需要叠回位移，避免被绝对矩阵丢弃



    // 切换滑场过渡：横向平移两屏，动画期间不走常规渲染

    if (this._transition) { this._renderTransition(dt); if (this.isRaining) this._drawRain(ctx, dt); if (this._ripples && this._ripples.length) this._drawRipples(ctx, dt); this._drawNightOverlay(ctx); this._updateHUD(); return; }  // 过渡期间不画草颤：双屏混合会让原场景坐标错乱残留在另一屏



    // 屏幕震动：整体平移主画布（含静态层），幅度随剩余时间衰减

    let shook = false;

    if (this._shake && this._shake.t > 0) {

      const o = this._shake.offset();

      ctx.save(); ctx.translate(o.x, o.y); shook = true;   // t>0 即固定 save/translate（含过零 o=0），保证配对、避免振荡过零 snap 跳变

      this._shakeX = o.x; this._shakeY = o.y;   // 记录震动偏移，供下方 setTransform 绝对矩阵（雨/雪）叠回位移

    }



    // 冬季下雪时推进树冠白化（每棵树随机快慢），跨 1/8 档才让静态层失效。

    // 必须放在 _ensureFarmCache 之前：这样本帧失效后立刻用新的白化程度重绘树冠。

    this._updateTreeFrost(dt);



    // 确保静态层（背景 + 草地/耕地/作物 + 进度条 + 网格线）为最新；

    // 仅在「农场状态变化 / 跨天换季 / 画布尺寸变化」时重绘整张网格到离屏画布。

    this._ensureFarmCache();



    // 每帧只需将静态层一次性贴回主画布（开销极低）

    ctx.imageSmoothingEnabled = false;

    // 先铺一层草地底色，震动露出的边缘不会透出黑边

    ctx.fillStyle = this._shakeTint || '#3a5f3a';

    ctx.fillRect(-8, -8, this.canvas.width + 16, this.canvas.height + 16);

    // 渲染农场静态层：有脏格时先整体贴回，再覆盖脏格；否则直接整体贴回
    if (this._farmCache) {
      ctx.drawImage(this._farmCache, 0, 0);
    }



    // 积雪地面层：在静态层之上、草丛颤动之下绘制（雪是地面层，草丛从雪里探出）

    this._blitSnowGround(ctx);



    // 停驻雪花老化：仅冬季运行时更新状态（非冬季跳过以节省CPU）
    if (this._isWinter()) {
      this._tickLandedSnow(dt);
    }
    // 停驻雪花绘制：仅冬季且有数据时绘制

    // 停驻在地面的雪花：画在积雪地面层之上、植被层之下，所以不盖住草/花/树

    // （飘落中的雪花仍在最上层 _drawSnow，雪在树前是合理透视）

    if (this._snowFlakes && this._snowFlakes.some(f => f.stopped && !f._eaten)) this._drawSnowLanded(ctx);



    // 植被层（草 + 花朵）：在积雪层之后贴回，使草花显示在雪之上（雪只盖住地面/作物/树，草花从雪里探出）
    if (this._vegCache) {
      ctx.drawImage(this._vegCache, 0, 0);
    }



    // 邻近提亮层（B · A 路线）：只遍历有元素格，按鼠标距离叠白色提亮，与草描边同源 _proxBoost
    this._drawProxHighlight(ctx, cs);

    // 草丛颤动：在静态层之上、雨蒙层/选中框/雨丝之下绘制，

    // 这样重画的草继承雨天的朦胧感，且不会盖住选中框（图层顺序修正）。

    if (this._grassShakes && this._grassShakes.length) this._drawGrassShakes(ctx, dt);

    // 草白描边实时层：画在夜间蒙层之上（见下方 _drawNightOverlay 后的调用），
    // 避免夜晚整幅夜色把白描边压暗、看不出轮廓。

    // 动态层：未浇水作物的呼吸高亮
    if (this.scene === 'farm') {
      this._drawWaterOverlay(ctx, cs);
      this._drawFarmlandOverlay(ctx, cs);
    }



    // 商店：直接画在画布上，覆盖在农场之上（放大、物品贴图直接合成进 GUI）

    if (this._shopOpen) {

      this._drawShopOverlay();

      this._drawNightOverlay(ctx);

      this._updateHUD();

      if (shook) ctx.restore();

      return;

    }



    // 鼠标悬停高亮

    if (this._hoverCell) {

      const { row: hr, col: hc } = this._hoverCell;

      if (hr >= 0 && hr < DATA.FARM.ROWS && hc >= 0 && hc < DATA.FARM.COLS) {

        ctx.fillStyle = 'rgba(255,255,255,0.18)';

        ctx.fillRect(hc * cs, hr * cs, cs, cs);

        ctx.strokeStyle = 'rgba(255,255,100,0.6)';

        ctx.lineWidth = 2;

        ctx.strokeRect(hc * cs + 1, hr * cs + 1, cs - 2, cs - 2);

      }

    }






    // 特效层：粒子 + 漂浮文字（在箭头之上），并按 dt 推进各自动画与震动

    this._drawEffects(ctx, dt);



    // 天气系统：每帧推进（雨/晴自动切换），是否下雨都需运行

    this._updateWeather();

    // 积雪系统：每帧推进（冬天累积 / 春天融化 / 夏秋清空），是否下雪都需运行

    // 积雪改为按「游戏刻」推进：由 Engine.onTick → UI._tickSnow() 每游戏分钟触发一次（见 main.js），不再按渲染帧，故此处不调用

    // 秋日落叶：仅秋季生成，覆盖整个世界（在下雨之上，像雨一样是画面层）

    this._updateLeaves(dt, this.canvas.width, this.canvas.height);

    this._drawLeaves(ctx, dt);

    // 大风（纯视觉阵风）：画在落叶之后、雨之前；与雨互斥（isRaining 假时 _updateWind 清场），
    // 仍盖在夜色蒙层（953 行）之下。切场过渡帧（778）不画风，跟落叶处理一致。
    if (this._weatherPhase === 'wind' || (this._windStreaks && this._windStreaks.length)) { this._updateWind(dt, this.canvas.width, this.canvas.height); this._drawWind(ctx, dt); }

    // 视觉下雨（纯画面，R 键可手动切换）：画在最上层，覆盖整个世界与粒子

    if (this.isRaining) this._drawRain(ctx, dt);

    if (this._ripples && this._ripples.length) this._drawRipples(ctx, dt);   // 落地涟漪在雨丝之上；雨停后残留仍淡出



    // 昼夜蒙层：整幅画面最顶层（含雨/雪），使夜晚明显区别于白天

    this._drawNightOverlay(ctx);

    // 草白描边实时层：整片合并外轮廓（无相邻双白线交叉），alpha 随鼠标到最近草质心距离 10%→100% 渐变（草身不变）。
    // 画在夜间蒙层之上：黑夜时白描边不再被夜色压暗，轮廓清晰（用户反馈「夜晚太暗」）。
    this._drawGrassOutline(ctx);

    // DOM 导航按钮位置/贴图/锁定态刷新：覆盖 resize/Quest完成等一切状态变化的兜底路径

    this._updateNavBtn();



    // HUD 更新

    this._updateHUD();



    if (shook) ctx.restore();

  },



  toggleScene() {

    if (this._transition) return;                               // 动画进行中忽略重复触发

    this._grassShakes = [];                                     // 立即清空草颤，避免过渡期间雨滴继续往旧场坐标推入残留

    const toScene = (this.scene === 'treeFarm') ? 'farm' : 'treeFarm';

    const dir = (toScene === 'treeFarm') ? -1 : 1;             // 反转滑场方向：树场在右→-1 源屏右滑；农场在左→+1 源屏左滑

    // 过渡快照必须是【独立副本】(不再直接用实时 _farmCache)，否则往上面画雪会污染静态缓存；

    // 两屏都合成当前地面积雪 + 当前植被层，避免切场滑动期间雪整段消失（雪是全局覆盖整屏）。

    const src = this._renderSceneToCanvas(this.scene);

    const dst = this._renderSceneToCanvas(toScene);

    if (this._snowCanvas && this._snowTotal > 0) {

      src.getContext('2d').drawImage(this._snowCanvas, 0, 0);

      dst.getContext('2d').drawImage(this._snowCanvas, 0, 0);

    }

    // 停驻雪花(landed)烘焙进两屏快照，随场景一起滑动：否则切场时停驻雪花既不滑也不随场景走(原地不动/整段消失)。

    // 层级与正常渲染一致：地面积雪层(上) → 停驻雪花(下) → 植被层；纯绘制、不推进状态。

    if (this._snowFlakes && this._snowFlakes.some(f => f.stopped && !f._eaten)) {

      const sx = this._shakeX, sy = this._shakeY;

      this._shakeX = 0; this._shakeY = 0;            // 快照用世界坐标(不带震动偏移)，避免错位

      this._drawSnowLanded(src.getContext('2d'));

      this._drawSnowLanded(dst.getContext('2d'));

      this._shakeX = sx; this._shakeY = sy;

    }

    // 当前场景植被(草/花/树)烘焙到源屏，置于 landed 之上（与正常渲染 _vegCache 守卫一致：仅当有积雪时）

    if (this._snowTotal > 0 && this._vegCache) src.getContext('2d').drawImage(this._vegCache, 0, 0);

    this._transition = { t: 0, dur: 0.36, src, dst, dir, toScene };

    // 切场瞬间刷新 DOM 导航按钮（scene 在过渡完成分支切换，到时 render 末尾再兜底一次）

    this._updateNavBtn();

  },






  /** 共享：判断点 (px,py) 是否落在矩形 rect{x,y,w,h} 内（含边界）。导航箭头命中/悬停与商店

   *  滚动条/结果槽/交易行命中判定共 7 处逐字重复，统一收口于此。shop.js 在 ui.js 之后加载，

   *  其 `UI.xxx = function(){}` 内 this 即 UI，可直接 this._hitRect(...)。 */

  _refreshDirtyCells() {
    if (!this._farmCache) return;
    const sctx = this._farmCache.getContext('2d');
    const cs = this.cellSize;
    const colors = this._seasonColorAt();

    // 重绘 farmCache 中的脏格
    const dirtyCells = [];
    for (const key of this._farmCacheDirty) {
      const [r, c] = key.split(',').map(Number);
      dirtyCells.push({ r, c });
    }
    if (dirtyCells.length > 0) {
      // 第一遍：重绘地面（草/泥土/缠根泥土）
      for (const { r, c } of dirtyCells) {
        const x = c * cs, y = r * cs;
        sctx.clearRect(x, y, cs, cs);
        this._renderCell(sctx, r, c, x, y, cs, colors);
      }
      // 第二遍：重绘树（确保树在地面之上）——仅在树场场景
      if (this.scene === 'treeFarm') {
        // A 子循环：脏集里的 grown 树先画「地面树荫」，参数逐字抄全量 ui-scene.js:1185。
        // 全量路径是「第三遍树荫 → 第四遍树冠」，增量必须同序：先树荫后树冠，
        // 否则树冠会把树荫糊住复现「阴影透到叶子上面」的老 bug（树冠向上溢出会盖进上一行的格）。
        for (const { r, c } of dirtyCells) {
          const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;
          if (t && t.stage === 'grown') {
            this._drawShadowEllipse(sctx, c * cs + cs / 2, r * cs + cs * 0.72, cs * 0.52, cs * 0.26, 0.16);
          }
        }
        // B 子循环：树实体（树冠 + 树干）
        for (const { r, c } of dirtyCells) {
          const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;
          if (t) {
            const x = c * cs, y = r * cs;
            this._drawTreeEntity(sctx, x, y, cs, t);
          }
        }
      }
    }
    this._farmCacheDirty.clear();

    // 重绘 vegCache 中的脏格（无论有无积雪都刷新，因为花朵/草叶都在这里）
    if (this._vegCacheDirty.size > 0) {
      // 确保 vegCache 尺寸正确（与 _buildVegCache 保持一致）
      if (!this._vegCache) this._vegCache = document.createElement('canvas');
      const cv = this._vegCache;
      if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {
        cv.width = this.canvas.width;
        cv.height = this.canvas.height;
      }
      const vctx = cv.getContext('2d');
      const cs = this.cellSize;
      const colors = this._seasonColorAt();

      // 只需要重绘脏格区域（不清空整个画布，只clear脏格）
      // 注意：邻居草身会溢出画进脏格矩形（_grassVariation ox/±17% + scale 1.25），
      // 只 clear+重画脏格会擦掉邻居溢出那截 →「耕地后相邻格只剩描边白圈没草身」。
      // 修复：clear 只清脏格；随后补画「脏格 ∪ 8 邻格」（行主序，与全量构建同 z 序），
      // 邻格补画不 clear（vegCache 透明底只叠画），把溢出那截恢复。
      for (const key of this._vegCacheDirty) {
        const [r, c] = key.split(',').map(Number);
        vctx.clearRect(c * cs, r * cs, cs, cs);
      }
      const ROWS = DATA.FARM.ROWS, COLS = DATA.FARM.COLS;
      const paintSet = new Set();
      for (const key of this._vegCacheDirty) {
        const [r, c] = key.split(',').map(Number);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS) continue;
            paintSet.add(rr + ',' + cc);
          }
        }
      }
      const paintList = [...paintSet].sort((a, b) => {
        const [ar, ac] = a.split(',').map(Number);
        const [br, bc] = b.split(',').map(Number);
        return ar * COLS + ac - (br * COLS + bc);
      });
      for (const key of paintList) {
        const [r, c] = key.split(',').map(Number);
        this._renderVegCell(vctx, r, c, c * cs, r * cs, cs, colors);
      }
      this._vegCacheDirty.clear();
    }

    // _grassBaseCache 失效（在 _invalidateCell 里被置 null）时必须**完整**重建，不能只重建脏格。
    // 只建脏格会让缓存变成稀疏对象：脏格走「预渲染底 + 摆动顶层」，其余草格走「实时兜底」，
    // 两条路径画法不同 → 被点击的那一格视觉与周围不一致，且不会自动恢复（单格异常色）。
    // _rebuildGrassBase() 只重画草颤底缓存，不触碰 farmCache / vegCache，
    // 因此不会像 _rebuildFarmCache() 那样引起整屏闪烁。
    if (this._grassBaseCache === null) {
      this._rebuildGrassBase();
    }
  },

  /** 渲染单个格子到给定的 ctx */
  _startAnimLoop() {

    if (this._animRaf) return; // 防止重复启动

    let frameCount = 0;
    let lastRenderTime = 0;
    // 检测是否为移动端
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    const minFrameInterval = isMobile ? 33 : 16; // 移动端30fps降频（原20fps仍偏卡），桌面60fps

    const loop = () => {

      // 页面不可见时跳过渲染，节省性能
      if (!this._isPageVisible) {
        this._animRaf = requestAnimationFrame(loop);
        return;
      }

      // 帧率限制：无论是否脏都按目标帧间隔节流（关键移动端优化——
      // 旧逻辑仅在空闲时节流，导致草颤/水波/天气动画期间仍以满速 60fps 渲染，手机卡死）
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      if (now - lastRenderTime < minFrameInterval) {
        this._animRaf = requestAnimationFrame(loop);
        return;
      }

      // 脏标记检测：本帧是否真的有内容需要更新
      // 时间驱动动画（雪/落叶/粒子）在 render() 内推进，活跃时强制继续渲染；
      // 全静默（雪全停/叶落尽/粒子播完）时回到不渲染，帧率限制(33/16ms)与 _isPageVisible 检查均在门槛之前，不受影响。
      const snowMoving = this._isWinter() && this._snowFlakes &&
                         this._snowFlakes.some(f => !f.stopped && !f._eaten);
      const leafFalling = this._fallingLeaves && this._fallingLeaves.length > 0;
      const particlesAlive = this._particles && this._particles.list.length > 0;
      const needsRender = this._needsRender ||
                          (this._grassShakes && this._grassShakes.length > 0) ||
                          (this._ripples && this._ripples.length > 0) ||
                          this._transition ||
                          snowMoving || leafFalling || particlesAlive ||
                          this._weatherPhase === 'wind' || (this._windStreaks && this._windStreaks.length);                                  // 大风期常驻渲染：风丝推进不依赖鼠标事件；风停 phase 回 clear，_updateWind 清 _windStreaks，条件自动为假、循环回静默（零性能残留）； 散场淡出：池非空=淡出中，照走
      if (!needsRender) {
        this._animRaf = requestAnimationFrame(loop);
        return;
      }

      lastRenderTime = now;

      const t0 = now;
      frameCount++;

      try { this.render(); } catch (err) { console.error('[render loop]', err); }

      if (this.ctx) this.ctx.setTransform(1, 0, 0, 1, 0, 0); // 异常帧后复位变换

      // 轻量 FPS 统计（仅 console.log 每秒一次）
      if (typeof performance !== 'undefined') {
        if (this._fpsLast == null) this._fpsLast = t0;
        this._fpsCount = (this._fpsCount || 0) + 1;
        const dt2 = t0 - this._fpsLast;
        if (dt2 >= 1000) { this._fps = Math.round(this._fpsCount * 1000 / dt2); this._fpsCount = 0; this._fpsLast = t0; console.log('[FPS]', this._fps); }
      }

      // 重置脏标记（已渲染）
      this._needsRender = false;

      this._animRaf = requestAnimationFrame(loop);

    };

    this._animRaf = requestAnimationFrame(loop);

  },

  /** 停止动画循环，用于游戏重置时清除旧渲染帧 */
  _stopAnimLoop() {
    if (this._animRaf) {
      cancelAnimationFrame(this._animRaf);
      this._animRaf = null;
    }
  },



  /** 更新 HUD（仅在值变化时写 DOM，避免每帧 getElementById + 布局重绘——HUD 仅随游戏事件变化） */

  showStatus(msg, duration = 1500) {

    // 把提示框里的 emoji 替换为真实贴图

    const iconMap = {

      '🔨': 'wooden_hoe',    // 锄头

      '⚡': 'command_block',  // 调试快进（Command_Block 贴图）

      '💧': 'water_bucket',   // 浇水

      '💰': 'money',          // 金币/出售

      '📦': 'bundle_filled',  // 背包

      '❌': 'cancel',             // 交易失败 / 错误：纯红叉（不用 crafting_arrow_error 的箭头+叉叉组合）

      '✅': 'confirm',             // 成功 / 确认

      '🌙': 'moon',           // 夜晚 / 睡觉

      '🌱': 'wheat_seeds',    // 幼苗（复用小麦种子贴图，无需新素材）

      '🪓': 'wooden_axe',      // 斧头（砍树 / 工具名）

      '🪴': 'acorn',     // 橡果（没橡果提示）

      '🪵': 'wooden_hoe',      // 根系太密（锄头失败提示）：复用锄头贴图

      '🌳': 'acorn',     // 树场有树提示：复用橡果贴图

      '🌟': 'nether_star',     // 任务达成（Quest.trigger 的达成提示）

      '🔒': 'Icon_Locked',     // 未解锁 / 需先满足前置

    };

    for (const [emoji, key] of Object.entries(iconMap)) {

      let src = '';

      if (emoji === '🌿') {

        // 草图标按季节染色：与地图上绿草(short_grass 季节草色 +30 明度)保持一致；逻辑收口到 _tintedGrassURL

        src = this._tintedGrassURL();

      } else {

        src = this._assetURL(key);

      }

      if (src) msg = msg.replaceAll(emoji, `<img class="status-hoe" src="${src}" alt="${key}">`);

    }

    const el = document.getElementById('status-message');

    el.innerHTML = msg;

    // 重播弹跳动画

    el.classList.remove('status-visible');

    void el.offsetWidth;

    el.classList.add('status-visible');

    if (this.statusTimeout) clearTimeout(this.statusTimeout);

    this.statusTimeout = setTimeout(() => {

      el.className = 'status-hidden';

    }, duration);

  },



  /**

   * 生成贴图 <img> 片段，供结算面板等非 showStatus 场景使用。

   * key 未注册（或不是可用贴图）时返回空串——调用方用 `|| '🌱'` 之类的 emoji 兜底即可。

   */

};

// 暴露到全局，供 quest.js / inventory.js 引用（原 ui.js L6075-6079）
if (typeof window !== 'undefined') window.UI = UI;
if (typeof globalThis !== 'undefined') globalThis.UI = UI;
