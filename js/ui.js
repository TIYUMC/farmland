/**

 * ui.js — UI 系统

 * 渲染、工具栏、弹窗、消息提示、每日结算

 */

/**

 * ───────────────────────────────────────────────────────────────────────────

 * ui.js 结构导航（可读性手册）

 * 本文件为 UI 系统单文件实现，体量较大，按职责分为以下区块（方法名见对应区块）：

 *

 *  [工具]   颜色/季节/随机：_hexToRgb · _shade · _seasonColorAt · _cellSeed · _bareSoilKey

 *          通用逻辑：_stackChunks（64 堆叠）· _tryAction（体力事务）· _warnAlreadyTilled

 *  ① 初始化/尺寸：init · _resize

 *  ② 主渲染/缓存：render · markFarmDirty · _ensureFarmCache · _rebuildFarmCache

 *     └ ② 区体量很大，内部另含三个带独立分隔线注释的子系统（文件内顺序：积雪 → 秋日落叶 → 场景切换）：

 *         积雪系统（16×16 像素格逐步累积铺满）· 秋日落叶系统 · 场景切换 toggleScene + 画布左上角导航箭头

 *  ③ 动态呼吸层：_drawWaterOverlay · _drawFarmlandOverlay · _drawBreathingBorder · _drawCornerBadge

 *  ④ 静态农场层：_renderStaticScene · _drawGrassGroundCell · _drawBareSoil · _drawCropCell · _drawTreeEntity · _renderTreeFarmScene

 *  ⑤ 动画/HUD：_startAnimLoop · _updateHUD

 *  ⑥ 工具栏：_onToolClick · _drawEmojiCrop（_updateHeldSlot 为空实现：手持槽已移除，选中态走底部快捷栏）

 *  ⑦ 画布输入：_onMouseMove

 *  ⑧ 田间动作：_onCanvasClick · _handleHoeClick · _chopTree · _handleTreeFarmClick · _startBusy

 *            全部走 _tryAction 体力事务（先扣后做 / 失败回滚），见 [工具] 区

 *  ⑨ 提示/图标：showStatus · _assetURL · _iconHTML · _tintedGrassURL · _grassIconHTML

 *  ⑩ 背包（已拆至 inventory.js）：openInventory · closeInventory · renderInventory · _makeSlot · _seedIconKey

 *                                 · _renderBottomHotbar（底部常驻 MC 快捷栏）· _bindBottomHotbar

 *                                 · _applyHotbarSlot / _invSyncSelToTool（快捷栏选中 ↔ 工具栏装备联动）

 *  ⑪ 商店系统（已拆至 shop.js）：openShop · closeShop · _buildTrades · _executeTrade · _drawShopOverlay

 *            · _onShopClick · _changeShopSel · _onShopWheel · _onShopBarDown

 *            · _onShopBarMove · _onShopMove

 *  ⑫ 每日结算：showFullSummary · closeSummary

 *  ⑬ 任务书（进度树，文件末段）：openQuest · closeQuest · _renderQuest · _renderQuestTabs · showAchievement

 *                                入口为底部工具栏 #btn-quest；完成判定与领取逻辑在 quest.js（Quest.isDone / Quest.claim）

 * ───────────────────────────────────────────────────────────────────────────

 */

const UI = {

  // refs

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



  _hoverCell: null, // { row, col } | null

  _mouseX: 0, _mouseY: 0, // 画布内鼠标像素坐标（供画布上 UI 按钮的悬停高亮判定）

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

  _seasonGrass(delta) {

    return this._shade(this._seasonColorAt().grass, delta);

  },



  // 每格稳定随机种子 0..1：同一格每次计算都一样（不闪烁），不同格不同（斑驳自然）

  _cellSeed(r, c) {

    let h = (r * 374761393 + c * 668265263) >>> 0;

    h = (h ^ (h >>> 13)) >>> 0;

    h = (h * 1274126177) >>> 0;

    h = (h ^ (h >>> 16)) >>> 0;

    return h / 4294967296;

  },



  // 裸土格按 cell 稳定随机选一种土图（与裸土判定用不同 seed 偏移，互不相关）

  _bareSoilKey(r, c) {

    // 树场裸土只用「普通土」(coarse_dirt / dirt)，**不再**随机成 rooted_dirt。

    // 原因：树格与退化裸土都走裸土画法，若裸土也是缠根泥土，则每棵树脚下、每块退化地都是缠根泥土，

    // 满屏都像被锄过，玩家分不清哪些格是自己真锄出来的（用户「贴图怎么全是缠根泥土？」）。

    // 现在「缠根泥土」是锄头翻出来(rooted)的专属地表，唯一出处，一眼可辨。

    if (this.scene === 'treeFarm') {

      return this._cellSeed(r + 909, c + 131) < 0.6 ? 'coarse_dirt' : 'dirt';

    }

    const arr = this._bareSoilKeys;

    const i = Math.floor(this._cellSeed(r + 101, c + 257) * arr.length) % arr.length;

      return arr[i];

  },



  // 堆叠拆分：把总数按每格 STACK 个拆成数组（背包/商店共用的堆叠规则，MC 标准 64 一组）

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

    if (cell && cell.crop) this.showStatus('🌱 作物还没成熟，再等等', 600);

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

    this.canvas.style.outline = '2px solid red'; // DEBUG: canvas边界
    this._debugTest = true; // 调试：每帧画红色测试块
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

    this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));

    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));

    this.canvas.addEventListener('mouseleave', () => {

      if (this._hoverRaf) { cancelAnimationFrame(this._hoverRaf); this._hoverRaf = null; }

      this._hoverCell = null;

      this.render();

    });

    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });



    // 商店交易列表滚动：滚轮翻行 + 拖动右侧滑块把手

    // （mousemove/mouseup 挂在 window 上，指针拖出画布也不会卡住把手）

    this.canvas.addEventListener('wheel', (e) => this._onShopWheel(e), { passive: false });

    this.canvas.addEventListener('mousedown', (e) => this._onShopBarDown(e));

    window.addEventListener('mousemove', (e) => this._onShopBarMove(e));

    window.addEventListener('mouseup', () => { this._shopBarDrag = false; });



    // 工具栏按钮只绑定点击；选中态由「底部快捷栏」统一高亮显示（见 _invSyncSelToTool），

    // 这里不再给任何工具按钮加 .active，避免与快捷栏形成第二个高亮框。

    document.querySelectorAll('.tool-btn').forEach(btn => {

      btn.addEventListener('click', () => this._onToolClick(btn));

    });



    // 背包关闭：点击面板外区域 or 按 B / Esc

    document.getElementById('inventory-overlay').addEventListener('click', (e) => {

      if (e.target === e.currentTarget) {

        // 光标上有物：先退回背包（不丢），不关；否则关闭

        if (this._invHeld) { this._invReturnHeld(); this.renderInventory(); this._updateGhost(); }

        else this.closeInventory();

      }

    });

    document.addEventListener('keydown', (e) => {

      if (e.key === 'Escape') { this.closeInventory(); this.closeShop(); this.closeSummary(); }

      else if (e.key === 'r' || e.key === 'R') { this._toggleRain(); }

    });



    // 持续重绘循环：驱动未浇水作物的闪烁动画

    this._startAnimLoop();



    // 游戏手感增强（juice.js）：粒子 / 漂浮文字 / 屏幕震动 / 箭头平滑 hover

    this._particles = new Juice.ParticleSystem();

    this._floaters  = new Juice.Floaters();

    this._shake     = new Juice.Shake();

    this._lastFrame = 0;

    this._navHoverCur = 1;



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
    this._farmCacheEntries = {};      // 单格缓存：{key: canvas} 缓存已渲染的单格
    this._farmCacheDirty = new Set(); // 需要重绘的格子集合
    this._vegCacheDirty = new Set();  // vegCache 需要重绘的格子集合



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



  _resize() {

    // #game-area 是 flex 居中容器，canvas 尺寸由 JS 设置
    // 用 clientHeight 量实际可用空间（而非 window.innerHeight，后者在页面初始化时可能不准）
    const gameArea = document.getElementById('game-area');
    const hud = document.getElementById('hud-bar');
    const toolbar = document.getElementById('toolbar');

    // 直接量 game-area 的实际可用空间，而不是拿 innerWidth/innerHeight 自己去减：
    //   桌面 / 竖屏：HUD 与工具栏上下堆叠，game-area 的高度已是扣除后的剩余；
    //   手机横屏：两者移到左右侧栏，此时该扣的是「宽度」而非高度。
    // 若沿用旧的减法，侧栏布局下 availW 会错算成整个屏幕宽，画布将溢出 game-area。
    const availW = gameArea.clientWidth || window.innerWidth;
    let availH = gameArea.clientHeight;
    if (!availH) {
      // 布局尚未稳定时的兜底（toolbar 和 hotbar 分开，各减一次）
      const hotbar = document.getElementById('bottom-hotbar');
      availH = window.innerHeight - hud.offsetHeight - toolbar.offsetHeight - (hotbar ? hotbar.offsetHeight : 0) - 8;
    }



    // 计算格子大小：让农场尽量填满

    const idealSizeByH = Math.floor(availH / DATA.FARM.ROWS);

    const idealSizeByW = Math.floor(availW / DATA.FARM.COLS);

    // 小屏(手机)放宽下限：桌面 32 的保底会在手机上反向把画布撑出容器 —— 这正是「显示不全」的根因。
    // 例：手机横屏 availH≈250 → ideal=25，若被 max(...,32) 抬成 32，画布高 320 > 250 直接溢出。

    const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) <= 560;
    const MIN_CELL = isSmallScreen ? 14 : 32;

    let size = Math.min(idealSizeByH, idealSizeByW, 85);

    size = Math.max(size, MIN_CELL);

    // ★ 兜底之后必须再用可用空间夹一次，否则保底值会把画布顶出容器
    size = Math.min(size, idealSizeByH, idealSizeByW);

    this.cellSize = Math.max(size, 1);   // 极端窄窗保底 1px，杜绝 0 / 负值



    this.canvas.width = DATA.FARM.COLS * this.cellSize;

    this.canvas.height = DATA.FARM.ROWS * this.cellSize;



    // ★ 强制 CSS 尺寸与 buffer 尺寸一致 — 准星不准的核心修复

    this.canvas.style.width = `${this.canvas.width}px`;

    this.canvas.style.height = `${this.canvas.height}px`;



    // game-area 是 flex 居中容器，CSS 已处理水平和垂直居中
    // JS 不再设置 margin，避免与 flex 居中冲突
    this.offsetX = 0;
    this.offsetY = 0;
    this.canvas.style.marginLeft = '';
    this.canvas.style.marginTop = '';



    // 画布位置变了，商店 DOM 叠层需重新对齐

    if (this._shopOpen) this._shopDirty = true;

  },



  /** 主渲染（B6 优化：静态农场层缓存到离屏画布，每帧只 blit + 重绘动态未浇水高亮） */

  // ─────────────────────────────────────────────

  // ② 主渲染 / 静态层缓存

  // ─────────────────────────────────────────────

  render() {

    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);   // 每帧从单位矩阵开始，消除任何残留 translate 累积导致的抖动画面
    // 调试：每帧画一个红色方块在左上角，确认渲染正常
    if (this._debugTest) {
      ctx.fillStyle = 'rgba(255,0,0,0.5)';
      ctx.fillRect(10, 10, 50, 50);
      ctx.fillStyle = '#fff';
      ctx.font = '10px monospace';
      ctx.fillText('DEBUG TEST', 12, 40);
    }

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
    const hasFarmDirty = this._farmCacheDirty && this._farmCacheDirty.size > 0;
    const hasVegDirty = this._vegCacheDirty && this._vegCacheDirty.size > 0;
    if (this._farmCache) {
      ctx.drawImage(this._farmCache, 0, 0);
      if (hasFarmDirty) {
        const cs = this.cellSize;
        const sctx = this._farmCache.getContext('2d');
        const colors = this._seasonColorAt();
        for (const key of this._farmCacheDirty) {
          const [r, c] = key.split(',').map(Number);
          const x = c * cs, y = r * cs;
          sctx.clearRect(x, y, cs, cs);
          this._renderCell(sctx, r, c, x, y, cs, colors);
          ctx.drawImage(this._farmCache, x, y, cs, cs, x, y, cs, cs);
        }
        this._farmCacheDirty.clear();
      }
    }



    // 积雪地面层：在静态层之上、草丛颤动之下绘制（雪是地面层，草丛从雪里探出）

    this._blitSnowGround(ctx);



    // 停驻雪花老化：每帧、跨季节推进 f.age（_drawSnow 仅冬天，不能在里面推进），使春天也能 fade 消失

    this._tickLandedSnow(dt);

    // 停驻在地面的雪花：画在积雪地面层之上、植被层之下，所以不盖住草/花/树

    // （飘落中的雪花仍在最上层 _drawSnow，雪在树前是合理透视）

    if (this._snowFlakes && this._snowFlakes.some(f => f.stopped && !f._eaten)) this._drawSnowLanded(ctx);



    // 植被层（草 + 花朵）：在积雪层之后贴回，使草花显示在雪之上（雪只盖住地面/作物/树，草花从雪里探出）

    if (this._snowTotal > 0 && this._vegCache) ctx.drawImage(this._vegCache, 0, 0);



    // 草丛颤动：在静态层之上、雨雾蒙层/选中框/雨丝之下绘制，

    // 这样重画的草继承雨天的朦胧感，且不会盖住选中框（图层顺序修正）。

    if (this._grassShakes && this._grassShakes.length) this._drawGrassShakes(ctx, dt);



    // 动态层：未浇水作物的呼吸高亮（逐帧动画，必须每帧重画）——仅主农场有耕地/浇水概念

    if (this.scene === 'farm') this._drawWaterOverlay(ctx, cs);



    // 动态层：耕地的呼吸描边——"玩家翻过的田"边界签名，与未浇水高亮同款呼吸节奏（方案：A3 + 同款闪烁）

    if (this.scene === 'farm') this._drawFarmlandOverlay(ctx, cs);



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



    // 场景导航箭头（树场← / 农场→），画在最上层、两个场景都显示

    this._drawNavArrow(ctx, dt);



    // 特效层：粒子 + 漂浮文字（在箭头之上），并按 dt 推进各自动画与震动

    this._drawEffects(ctx, dt);



    // 天气系统：每帧推进（雨/晴自动切换），是否下雨都需运行

    this._updateWeather();

    // 积雪系统：每帧推进（冬天累积 / 春天融化 / 夏秋清空），是否下雪都需运行

    // 积雪改为按「游戏刻」推进：由 Engine.onTick → UI._tickSnow() 每游戏分钟触发一次（见 main.js），不再按渲染帧，故此处不调用

    // 秋日落叶：仅秋季生成，覆盖整个世界（在下雨之上，像雨一样是画面层）

    this._updateLeaves(dt, this.canvas.width, this.canvas.height);

    this._drawLeaves(ctx, dt);

    // 视觉下雨（纯画面，R 键可手动切换）：画在最上层，覆盖整个世界与粒子

    if (this.isRaining) this._drawRain(ctx, dt);

    if (this._ripples && this._ripples.length) this._drawRipples(ctx, dt);   // 落地涟漪在雨丝之上；雨停后残留仍淡出



    // 昼夜蒙层：整幅画面最顶层（含雨/雪），使夜晚明显区别于白天

    this._drawNightOverlay(ctx);



    // HUD 更新

    this._updateHUD();



    if (shook) ctx.restore();

  },



  /** 特效层：每帧推进并绘制粒子 / 漂浮文字，并衰减屏幕震动 */

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

  _spawnRipple(x, y) {

    if (!this._ripples) this._ripples = [];

    if (this._ripples.length >= 60) return;            // 上限，避免同屏过多

    if (Math.random() > 0.6) return;                  // 约 60% 落地才生成涟漪，错落不密集

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

  },



  /** 生成一颗雨滴：anywhere=true 时整屏随机（初始化）；否则从顶部落下。

   *  每滴的长度/速度/粗细/透明度都随机 → 破除「太整齐」的帘幕感 */

  _newDrop(W, H, anywhere) {

    const len = 8 + Math.random() * 20;               // 雨丝长度 8~28px（差异更大）

    return {

      x: Math.random() * (W + 40) - 20,

      y: anywhere ? (Math.random() * H) : -len,

      vy: 420 + Math.random() * 420,                 // 下落速度 420~840 px/s（速度差更大）

      vx: -40 - Math.random() * 90,                  // 风向：左飘 -40~-130 px/s

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

  markFarmDirty() { this._farmDirty = true; },

  /** 标记单个格子需要重绘（增量更新）。
   *  用于点击操作后只更新变化的格子，避免重建全部120格。 */
  _invalidateCell(row, col) {
    const key = row + "," + col;
    this._farmCacheDirty.add(key);
    // 树场：树冠高 cs*1.5，向上溢出约 0.5~0.8 格到上一行，需同步失效上一行，
    // 否则旧草色会从树冠上方残留形成绿方块闪屏。
    if (this.scene === "treeFarm" && row > 0) {
      const upKey = (row - 1) + "," + col;
      this._farmCacheDirty.add(upKey);
    }
    // 草格和花朵需要同时使 vegCache 失效
    const grassSrc = (this.scene === "treeFarm") ? TreeFarm : Farm;
    const gstate = (grassSrc.grass && grassSrc.grass[row]) ? (grassSrc.grass[row][col] || 0) : 0;
    const flower = (grassSrc.flowers && grassSrc.flowers[row]) ? (grassSrc.flowers[row][col] || 0) : 0;
    if (gstate === 1 || gstate === 2 || flower > 0) {
      this._vegCacheDirty.add(key);
    }
  },



  /** 主农场 ↔ 树场 场景切换：用滑场过渡（横向平移两屏），避免瞬切 */

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

  },



  /** 画布左上角的场景导航箭头按钮几何。

   *  树场(treeFarm)→左箭头(arrow_left)回农场；农场(farm)→右箭头(arrow_right)去树场。 */

  _navRect() {

    const m = 4, w = 64, h = 64;

    const y = Math.round(this.canvas.height / 2 - h / 2); // 画布垂直居中

    // 树场场景在右边、农场场景在左边（与箭头方向一致：→去树场在右、←回农场在左）

    const x = (this.scene === 'treeFarm') ? (this.canvas.width - m - w) : m;

    return { x, y, w, h, dir: (this.scene === 'treeFarm') ? 'right' : 'left' };

  },



  /** 共享：判断点 (px,py) 是否落在矩形 rect{x,y,w,h} 内（含边界）。导航箭头命中/悬停与商店

   *  滚动条/结果槽/交易行命中判定共 7 处逐字重复，统一收口于此。shop.js 在 ui.js 之后加载，

   *  其 `UI.xxx = function(){}` 内 this 即 UI，可直接 this._hitRect(...)。 */

  _hitRect(px, py, rect) {

    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;

  },



  /** 点击坐标是否落在导航箭头按钮内 */

  _navHit(x, y) {

    const r = this._navRect();

    return this._hitRect(x, y, r);

  },



  /** 绘制导航箭头按钮（悬停时用 *_highlighted 贴图，底板变亮提示可点） */

  _drawNavArrow(ctx, dt) {

    const r = this._navRect();

    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    const t = now / 1000;

    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;

    const hovering = this._hitRect(this._mouseX, this._mouseY, r);



    // hover 平滑缩放：目标 1.16，否则 1.0；帧率无关指数趋近（点击/悬停反馈，空闲不循环）

    const target = hovering ? 1.16 : 1.0;

    const k = 1 - Math.pow(0.0008, dt || 0.016);

    this._navHoverCur = Juice.lerp(this._navHoverCur, target, k);



    const iconKey = r.dir === 'left'

      ? (hovering ? 'arrow_left_highlighted' : 'arrow_left')

      : (hovering ? 'arrow_right_highlighted' : 'arrow_right');

    const inner = r.w - 10;

    const preNav = (typeof ASSETS.get === 'function') ? ASSETS.get(iconKey) : null;

    const navAR = (preNav && preNav.naturalWidth && preNav.naturalHeight)

      ? preNav.naturalWidth / preNav.naturalHeight : 1;

    let dw, dh;

    if (navAR >= 1) { dw = inner; dh = inner / navAR; }

    else { dh = inner; dw = inner * navAR; }

    const scale = this._navHoverCur;

    dw *= scale; dh *= scale;



    // 招手（仅 hover 时）：沿指向缓慢、平滑地滑出再滑回（easeInOut，单次约 2.2s，幅度 6px），

    // 像「往这边走」。空闲时完全静止——遵循 NN/g：无关的持续动效会劫持注意力，应克制。

    let nudge = 0;

    if (hovering) {

      const period = 2.2;

      const ph = (t % period) / period;                 // 0→1

      const eased = (1 - Math.cos(ph * Math.PI * 2)) / 2; // 0→1→0 平滑，无突变

      nudge = eased * 6;

    }

    const baseX = (r.dir === 'left') ? r.x : (r.x + r.w - dw);

    const dirSign = (r.dir === 'left') ? -1 : 1;        // ← 朝左、→ 朝右

    const dx = Math.round(baseX + dirSign * nudge);     // 沿指向滑动：招手往那边走

    const dy = Math.round(r.y + (r.h - dh) / 2);



    // hover 柔光晕（仅高亮态、静态非循环）：轻量提示

    if (hovering) {

      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.w * 0.62);

      gr.addColorStop(0, 'rgba(255,238,170,0.14)');

      gr.addColorStop(1, 'rgba(255,238,170,0)');

      ctx.save();

      ctx.fillStyle = gr;

      ctx.beginPath(); ctx.arc(cx, cy, r.w * 0.62, 0, Math.PI * 2); ctx.fill();

      ctx.restore();

    }



    // 主要导航控件：始终清晰可见（不再全屏按距离淡入淡出）

    ctx.save();

    ctx.globalAlpha = hovering ? 1 : 0.92;

    ASSETS.draw(ctx, iconKey, dx, dy, dw, dh, false) // 关插值：消除缩小贴图边缘黑色渗边 + 移动颤抖

      || (ctx.font = `${r.h * 0.5}px sans-serif`, this._setTextCenter(ctx),

          ctx.fillStyle = '#fff', ctx.fillText(r.dir === 'left' ? '←' : '→', cx, cy));

    ctx.restore();

  },



  /** 保证静态农场层离屏画布为最新；过期则重建 */

  _ensureFarmCache() {

    const sig = `${Engine.year}-${Engine.season}-${Engine.day}@${this.canvas.width}x${this.canvas.height}`;
    const hasFarmDirty = this._farmCacheDirty.size > 0;
    const hasVegDirty = this._vegCacheDirty.size > 0;

    // 全量重建条件：缓存不存在 / 季节日变化 / 全量标记 / 格数变化
    const needFullRebuild = !this._farmCache || this._farmCacheKey !== sig || this._farmDirty;
    
    // 局部更新：只重绘脏格
    if (needFullRebuild) {
      this._rebuildFarmCache();
      this._farmCacheDirty.clear();
      this._vegCacheDirty.clear();
    } else if (hasFarmDirty || hasVegDirty) {
      this._refreshDirtyCells();
    }
    
    this._farmCacheKey = sig;
    this._farmDirty = false;
  },

  /** 增量重绘被标记为脏的格子 */
  _refreshDirtyCells() {
    if (!this._farmCache) return;
    const sctx = this._farmCache.getContext('2d');
    const cs = this.cellSize;
    const colors = this._seasonColorAt();
    
    // 重绘 farmCache 中的脏格
    for (const key of this._farmCacheDirty) {
      const [r, c] = key.split(',').map(Number);
      const x = c * cs, y = r * cs;
      sctx.clearRect(x, y, cs, cs);
      this._renderCell(sctx, r, c, x, y, cs, colors);
      // 存储到缓存
      if (!this._farmCacheEntries[key]) {
        this._farmCacheEntries[key] = document.createElement('canvas');
      }
      this._farmCacheEntries[key].width = cs;
      this._farmCacheEntries[key].height = cs;
      this._farmCacheEntries[key].getContext('2d').drawImage(sctx.canvas, x, y, cs, cs, 0, 0, cs, cs);
      this._farmCacheDirty.delete(key);
    }
    
    // 重绘 vegCache 中的脏格（仅在有积雪时）
    if (this._vegCacheDirty.size > 0 && this._snowTotal > 0) {
      if (!this._vegCache) this._vegCache = document.createElement('canvas');
      const vctx = this._vegCache.getContext('2d');
      const cs = this.cellSize;
      const colors = this._seasonColorAt();
      
      // 只需要重绘脏格区域
      for (const key of this._vegCacheDirty) {
        const [r, c] = key.split(',').map(Number);
        const x = c * cs, y = r * cs;
        vctx.clearRect(x, y, cs, cs);
        this._renderVegCell(vctx, r, c, x, y, cs, colors);
        this._vegCacheDirty.delete(key);
      }
    } else if (this._vegCacheDirty.size > 0 && this._snowTotal === 0) {
      // 无雪时 vegCache 不需要维护，清除脏标记
      this._vegCacheDirty.clear();
    }
  },

  /** 渲染单个格子到给定的 ctx */
  _renderCell(ctx, r, c, x, y, cs, colors) {
    const cell = (this.scene === 'treeFarm' && TreeFarm.grid[r] && TreeFarm.grid[r][c]) 
      || (Farm.grid[r] && Farm.grid[r][c]);
    
    if (this.scene === 'treeFarm') {
      // 树场：只画草、树和缠根泥土
      const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);
      if (hasTree) {
        // 先铺裸土底（与 _renderTreeFarmScene 一致：有树/树苗的格不画草，露出裸土），
        // 防止农场缓存中残留的旧草色从树下方透出形成纯绿方块。
        this._drawGrassGroundCell(ctx, r, c, x, y, cs, 0, true, colors);
        this._drawTreeEntity(ctx, x, y, cs, TreeFarm.trees[r][c]);
        return;
      }
      // 锄头翻出的缠根泥土：先铺土色底 + 贴 rooted_dirt
      if (TreeFarm.getRootedAt(r, c)) {
        this._fillCell(ctx, x, y, cs, colors.soil);
        this._drawPaddedAsset(ctx, 'rooted_dirt', x, y, cs, 1, true)
          || this._fillCell(ctx, x, y, cs, colors.soil);
        return;
      }
      const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
      const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);
      if (!isBare && (gstate === 1 || gstate === 2)) {
        this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);
      }
      return;
    }
    
    // 主农场
    if (!cell) {
      if (Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]) {
        this._drawBareSoil(ctx, r, c, x, y, cs, colors);
      } else {
        const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
        const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);
        this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);
      }
    } else {
      const tex = cell.watered ? 'farmland_moist' : 'farmland_dry';
      this._drawPaddedAsset(ctx, tex, x, y, cs, 1)
        || this._fillCell(ctx, x, y, cs, cell.watered ? colors.water : colors.soil);
    }
    
    // 花朵
    const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
    if (flower > 0) {
      const fkey = this._flowerDef(flower).key;
      this._drawPaddedAsset(ctx, fkey, x, y, cs, 0)
        || this._fillCell(ctx, x, y, cs, '#a9b765');
    }
    
    // 作物
    if (cell && cell.crop) {
      this._drawCropCell(ctx, x, y, cs, cell);
    }
    
    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cs, cs);
  },

  /** 渲染单个植被格到 vegCache */
  _renderVegCell(ctx, r, c, x, y, cs, colors) {
    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;
    
    if (this.scene === 'treeFarm') {
      const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);
      if (!hasTree) {
        const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
        const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);
        if (!isBare && (gstate === 1 || gstate === 2)) {
          this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);
        }
      }
      return;
    }
    
    const cell = Farm.grid[r] && Farm.grid[r][c];
    if (!cell) {
      const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
      const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);
      if (!isBare && (gstate === 1 || gstate === 2)) {
        this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);
      }
    } else if (cell.crop) {
      this._drawCropCell(ctx, x, y, cs, cell);
    }
    
    const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
    if (flower > 0) {
      const fkey = this._flowerDef(flower).key;
      this._drawPaddedAsset(ctx, fkey, x, y, cs, 0) || this._fillCell(ctx, x, y, cs, '#a9b765');
    }
  },



  /** 重建静态农场层到离屏画布 */

  _rebuildFarmCache() {

    if (!this._farmCache) this._farmCache = document.createElement('canvas');

    const cv = this._farmCache;

    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {

      cv.width = this.canvas.width;

      cv.height = this.canvas.height;

    }

    const sctx = cv.getContext('2d');

    sctx.clearRect(0, 0, cv.width, cv.height);

    this._renderStaticScene(sctx);

    this._rebuildGrassBase();   // 草格底随静态层一起重建（同失效触发：跨天换季/尺寸/农场变化），保证缓存与静态层像素一致

    this._buildVegCache();      // 草+花离屏缓存：与 _farmCache 同失效触发，render() 中于积雪层之后贴回（草花在雪之上）

  },



  /** 预渲染草格「底」到离屏画布（dirt + grass_block + 灰度 overlay；裸土用 bareSoil），

   *  每抖动格每帧只 drawImage 贴回 + 实时画摆动草顶层，省去底土重画与 composite 切换。缓存与 _renderStaticScene 同步重建。 */

  _rebuildGrassBase() {

    const cs = this.cellSize;

    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;

    const colors = this._seasonColorAt();

    const cache = {};

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const gstate = (grassSrc.grass && grassSrc.grass[r]) ? (grassSrc.grass[r][c] || 0) : 0;

        const isBare = !!(grassSrc.bare && grassSrc.bare[r] && grassSrc.bare[r][c]);

        if (gstate === 0 && !isBare) { cache[r + ',' + c] = null; continue; }  // 非草非裸：不会草颤，无需缓存底

        const cv = document.createElement('canvas');

        cv.width = cs; cv.height = cs;

        const bctx = cv.getContext('2d');

        let top = false;

        if (isBare) {

          this._drawBareSoil(bctx, r, c, 0, 0, cs, colors);

        } else {

          const hasBlock = this._drawGrassBaseLayer(bctx, r, c, 0, 0, cs, colors);

          top = hasBlock && (gstate === 1 || gstate === 2);

        }

        cache[r + ',' + c] = { cv, top };

      }

    }

    this._grassBaseCache = cache;

  },



  /** 植被离屏缓存：仅画「草(底+静态顶层) + 花朵」，不画地面/作物/树。

   *  与 _farmCache 同失效触发重建；render() 中在积雪层之后贴回 → 草花显示在雪之上（雪只盖地面/作物/树，草花从雪里探出）。

   *  画法对齐 _renderStaticScene / _renderTreeFarmScene：草仅画在地面格(!cell)与树场非树格；花画在 flowers>0 的格。 */

  _buildVegCache() {

    if (!this._vegCache) this._vegCache = document.createElement('canvas');

    const cv = this._vegCache;

    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {

      cv.width = this.canvas.width; cv.height = this.canvas.height;

    }

    const ctx = cv.getContext('2d');

    ctx.clearRect(0, 0, cv.width, cv.height);

    const cs = this.cellSize;

    const colors = this._seasonColorAt();

    if (this.scene === 'treeFarm') {

      // 第一遍：非树格只画草叶（透明底，雪从草叶间露出；裸土/无草不画→雪正常盖住）；树格留空，由第二遍画树

      this._forEachFarmCell(cs, (r, c, x, y) => {

        const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);

        if (!hasTree) {

          const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

          const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);

          if (!isBare && (gstate === 1 || gstate === 2)) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);

        }

      });

      // 第二遍：树（从上往下画 r=0→ROWS-1）→ 树在雪之上，不被雪盖住

      // 关键：树冠向上溢出约 1.5 格。上下相邻时，下面树(r+1)的树冠会溢入上面树(r)的格内，

      // 盖住上面树的树干底部。先画上面树、后画下面树，让下面树溢出的树冠自然叠在上方树干之上，

      // 解决「上面的树干叠到下面的树叶上」。

      for (let r = 0; r < DATA.FARM.ROWS; r++) {

        for (let c = 0; c < DATA.FARM.COLS; c++) {

          const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

          if (t) this._drawTreeEntity(ctx, c * cs, r * cs, cs, t);

        }

      }

    } else {

      this._forEachFarmCell(cs, (r, c, x, y) => {

        const cell = Farm.grid[r][c];

        if (!cell) {                                                // 地面格：只画草叶（透明底），让雪从草叶间露出；裸土/无草格不画→雪正常盖住

          const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

          const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

          if (!isBare && (gstate === 1 || gstate === 2)) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);

        } else if (cell.crop) {                                     // 作物格：作物画在雪之上（作物从雪里探出，不被雪盖住）

          this._drawCropCell(ctx, x, y, cs, cell);

        }

        const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;

        if (flower > 0) {

          const fkey = this._flowerDef(flower).key;

          this._drawPaddedAsset(ctx, fkey, x, y, cs, 0) || this._fillCell(ctx, x, y, cs, '#a9b765');

        }

      });

    }

  },





  /** 把指定场景的静态层渲染到一张离屏画布（用于滑场过渡的目标屏） */

  _renderSceneToCanvas(scene) {

    const cv = document.createElement('canvas');

    cv.width = this.canvas.width; cv.height = this.canvas.height;

    const c = cv.getContext('2d');

    const prev = this.scene;

    this.scene = scene;

    this._renderStaticScene(c);

    this.scene = prev;

    return cv;

  },



  /** 滑场过渡：把源屏与目标屏横向拼接平移，像摄像机「平移过去」；结束落定后在目标箭头处迸发粒子 */

  _renderTransition(dt) {

    const tr = this._transition;

    tr.t += dt;

    const k = Math.min(1, tr.t / tr.dur);

    const e = Juice.ease.inOutCubic(k);                     // 平滑加减速，避免突兀

    const W = this.canvas.width, H = this.canvas.height;

    const off = e * W;

    const ctx = this.ctx;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#1d2a1d';

    ctx.fillRect(0, 0, W, H);

    if (tr.dir > 0) {                                       // 去树场（右侧）：源屏左滑、目标屏从右进

      ctx.drawImage(tr.src, -off, 0);

      ctx.drawImage(tr.dst, W - off, 0);

    } else {                                                // 回农场（左侧）：源屏右滑、目标屏从左进

      ctx.drawImage(tr.src, off, 0);

      ctx.drawImage(tr.dst, off - W, 0);

    }

    if (k >= 1) {                                           // 落定：切到目标场景，重建缓存，目标箭头处迸发粒子

      this.scene = tr.toScene;

      this._transition = null;

      this._grassShakes = [];                                // 切场时清空旧场草颤，避免残留到新场（坐标被套用到新场草地）

      this._fallingLeaves = [];                              // 切场时清空落叶，避免跨场景残留

      this.markFarmDirty();

      this._vegCache = null;                              // 切场：失效旧 vegCache，防止跨场景残留

      const r = this._navRect();

      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;

      if (this._particles) {

        // 用刚注册的粒子贴图（generic_0~7），不含 nether_star

        this._particles.spawn(cx, cy, {

          imgKeys: ['generic_0', 'generic_1', 'generic_2', 'generic_3', 'generic_4', 'generic_5', 'generic_6', 'generic_7'],

          imgSize: this.scene === 'treeFarm' ? 18 : 16,

          count: 24, speed: 130, gravity: 210, spread: Math.PI * 2, spawnRadius: 14,

        });

      }

    }

  },



  /** 动态层：未浇水作物的呼吸高亮（逐帧动画，开销极低——仅遍历有作物的格子） */

  // ─────────────────────────────────────────────

  // ③ 动态呼吸高亮层（逐帧动画）

  // ─────────────────────────────────────────────



  /** 右上角「贴图 + emoji 兜底」呼吸角标：需浇水 / 需播种提示共用，消除两处重复绘制 */

  /** 文字居中对齐设置（textAlign/textBaseline → center/middle），消除 _drawCornerBadge / 作物图标 / 导航箭头 三处重复 */

  _setTextCenter(ctx) {

    ctx.textAlign = 'center';

    ctx.textBaseline = 'middle';

  },



  _drawCornerBadge(ctx, key, emoji, ix, iy, iw, pulse) {

    ctx.globalAlpha = 0.75 + 0.25 * pulse;

    const drawn = ASSETS.draw(ctx, key, ix, iy, iw, iw);

    if (!drawn) {

      ctx.font = `${iw * 0.8}px sans-serif`;

      this._setTextCenter(ctx);

      ctx.fillText(emoji, ix + iw / 2, iy + iw / 2);

    }

    ctx.globalAlpha = 1;

  },



  /** 呼吸描边 + 右上角角标：需浇水蓝边与空耕地绿边共用同一套几何（inset 描边 lw3 + 右上角呼吸角标）。

   *  strokeRGB 为描边 rgba 字符串（调用方按状态/季节算好）；iw 角标边长；badgeKey/emoji 为右上角角标。 */

  _drawBreathingBorder(ctx, x, y, cs, strokeRGB, iw, pulse, badgeKey, badgeEmoji) {

    ctx.save();

    ctx.strokeStyle = strokeRGB;

    ctx.lineWidth = 3;

    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4); // inset 对齐，几何上完全同粗同位

    const ix = x + cs - iw - 2, iy = y + 2;

    this._drawCornerBadge(ctx, badgeKey, badgeEmoji, ix, iy, iw, pulse);

    ctx.restore();

  },



  _drawWaterOverlay(ctx, cs) {

    this._forEachFarmCell(cs, (r, c, x, y) => {

      const cell = Farm.grid[r][c];

      if (!cell || !cell.crop) return;

      const isGrown = Farm._isGrown(cell);

      if (cell.watered || isGrown) return; // 已浇水或成熟则无需提示

      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);

      // 整格淡蓝呼吸高亮

      this._fillCell(ctx, x, y, cs, `rgba(90,180,250,${0.10 + 0.14 * pulse})`);

      // 闪烁边框 + 右上角水桶角标

      this._drawBreathingBorder(ctx, x, y, cs, `rgba(95,195,255,${0.45 + 0.45 * pulse})`, cs * 0.36, pulse, 'water_bucket', '💧');

    });

  },



  /** 动态层：耕地的呼吸描边——"玩家翻过的田"边界签名，每帧呼吸闪烁（方案：A3 + 跟需浇水同款呼吸动画） */

  _drawFarmlandOverlay(ctx, cs) {

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);

    this._forEachFarmCell(cs, (r, c, x, y) => {

      const cell = Farm.grid[r][c];

      // 仅空耕地(无作物)才呼吸描边；已播种格交给"需浇水"蓝边提示，避免双重描边

      if (!cell || !cell.tilled || cell.crop) return;

      // 空耕地描边改用绿色，随脉冲呼吸；线宽与基线对齐"需浇水"蓝边(lw3, 0.45+0.45*pulse)，仅色相区分

      const strokeRGB = cell.watered

        ? `rgba(70,150,95,${0.30 + 0.35 * pulse})`    // 湿土：柔深绿（半透明质感）

        : `rgba(125,190,135,${0.30 + 0.35 * pulse})`; // 干土：柔草绿（半透明质感，降饱和不刺眼）

      this._drawBreathingBorder(ctx, x, y, cs, strokeRGB, cs * 0.34, pulse, 'wheat_seeds', '🌾');

    });

  },



  /** 把静态农场层（背景 + 草地/耕地/作物 + 进度条 + 网格线，不含未浇水呼吸高亮）画到给定 ctx */

  // ─────────────────────────────────────────────

  // ④ 静态农场层绘制（背景/草/耕地/作物/网格）

  // ─────────────────────────────────────────────

  _renderStaticScene(ctx) {

    const cs = this.cellSize;

    const colors = this._seasonColorAt();



    // 背景

    ctx.fillStyle = colors.bg;

    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);



    // 网格线颜色

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';

    ctx.lineWidth = 1;



    // 树场场景：整张静态层交给树场渲染（森林地表 + 大树），不再画主农场的草/耕地/作物。

    if (this.scene === 'treeFarm') { this._renderTreeFarmScene(ctx, cs); return; }



    this._forEachFarmCell(cs, (r, c, x, y) => {

        const cell = Farm.grid[r][c];



        // 地板贴图

        const pad = 1;

        if (!cell) {

          // 泥土：把【普通草方块】锄过一次后的中间态(dirt=true)，再锄一次才成耕地。画成土色（土图）表示「已松动待耕」。

          // 注：不能画成 farmland_dry，否则和真耕地长得一模一样；而草方块→泥土 本身就是「绿草纹→土色」的明显变化。

          // （自然退化的裸土 bare=true 已改为锄一次直接成耕地，不再经过本中间态。）

          if (Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]) {

            this._drawBareSoil(ctx, r, c, x, y, cs, colors);

          }

        // 草方块地面：裸土(土色)只来自草方块上的草退化成无草——Farm.bare[r][c]===true（草1/2退化成0）才画裸土；

        // 其余草方块保持草方块底纹（含 short_grass 绿草 / short_dry_grass 黄草顶层）。从未长草的普通

        // 地面即使在秋冬也不随机变裸土，只有真正退化过的草方块才会转土色。

        else {

          // 草地（含裸土）统一走共享画法，与树场完全一致

          const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

          const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

          this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);

        }

      } else {

        const tex = cell.watered ? 'farmland_moist' : 'farmland_dry';

        this._drawPaddedAsset(ctx, tex, x, y, cs, pad)

          || this._fillCell(ctx, x, y, cs, cell.watered ? colors.water : colors.soil);

        // 耕地描边已移至动态层 _drawFarmlandOverlay（呼吸闪烁，与未浇水高亮同款），此处只画底纹。

      }



      // 画花朵：flowers 数组与 dirt/grass 同维；花朵格 = flowers[r][c] > 0（草=0，视觉替换草方块）

      // 数据驱动：flowers[r][c] 的值即花种编号(1..N)，贴图键查 DATA.FLOWERS（加花种不用改本处）

      const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;

      if (flower > 0) {

        const fkey = this._flowerDef(flower).key;

        // pad=0 让花朵占满整格（视觉上像地里长出来的，与草方块同占位）

        this._drawPaddedAsset(ctx, fkey, x, y, cs, 0)

          || this._fillCell(ctx, x, y, cs, '#a9b765');

      }



      // 画作物（抽到 _drawCropCell，与 _drawGrassGroundCell 同款「一格一画法」）

      if (cell && cell.crop) {

        this._drawCropCell(ctx, x, y, cs, cell);

      }



        // 网格线

        ctx.strokeRect(x, y, cs, cs);

    });

  },



  /** 共享：画一格「草地地面」——草方块底 + 绿草/枯草丛，或退化裸土。农场与树场共用此画法，视觉完全一致。

   *  gstate: 0 无草 / 1 绿草 / 2 黄草；isBare=true 表示退化成裸土。 */

  /** 草格「底」：土色 + 草方块染色 + 灰度 overlay（overlay 混合）。不含会逐帧摆动的草顶层。

   *  预渲染进离屏画布后每帧只贴回（_drawGrassShakes），与实时重画像素级等价——离屏内合成结果 == 实时同像素合成。

   *  返回 gblock 是否存在（决定草顶层是否绘制，复刻原 _drawGrassGroundCell 仅在 gblock 存在时才画顶层）。 */

  _drawGrassBaseLayer(ctx, r, c, x, y, cs, colors) {

    colors = colors || this._seasonColorAt();

    const gblockGray = ASSETS.get('grass_block');

    const gblock = ASSETS.getTinted('grass_block', this._shade(colors.grass, -18));

    if (gblock) {

      ctx.imageSmoothingEnabled = true;

      this._drawImageCell(ctx, gblock, x, y, cs);

      if (gblockGray) {

        ctx.globalCompositeOperation = 'overlay';

        ctx.globalAlpha = 0.85;

        this._drawImageCell(ctx, gblockGray, x, y, cs);

        ctx.globalCompositeOperation = 'source-over';

        ctx.globalAlpha = 1;

      }

    } else {

      this._fillCell(ctx, x, y, cs, this._shade(colors.grass, -18));

    }

    return !!gblock;

  },



  /** 草格「顶层」：会逐帧绕格底中心摆动的 short_grass / short_dry_grass（仅 gstate 1/2 有）。逐帧实时画，不可缓存。 */

  _drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, sway, snowTruncate = true) {

    if (gstate !== 1 && gstate !== 2) return;

    const C = DATA.FARM.COLS, i = r * C + c;

    // 雪埋草：雪覆盖率与草基部截断率正相关（比值 1），最多截断 1/4（100% 覆盖）。截断的是草叶基部（被雪盖住那段）。

    // 仅「雪上植被层(_vegCache) / 草颤层」需要此截断（让雪埋住草基）；静态层(_farmCache)是雪融化后露出的底，

    // 绝不截断，否则雪化后草永久短一截（静态层只在换季/农场变化/尺寸时重建，不在雪融化时重建）。

    const cellLeft = c * cs, cellTop = r * cs;

    let snowCovered = false;

    if (snowTruncate && this._snowGround) {

      for (const f of this._snowGround) {

        // 雪片落在同一游戏格（c/r 精确匹配）即认为该格积雪，截断草基部

        if (f.c === c && f.r === r) {

          snowCovered = true;

          break;

        }

      }

    }

    const cov = snowCovered ? 1.0 : 0.0;  // 积雪则满覆盖截断，否则无截断

    const trunc = cov * 0.25;

    const s = sway || 0;

    ctx.save();

    if (trunc > 0) {                                              // 只画草叶顶部 (1-trunc)，基部被雪埋住

      ctx.beginPath();

      ctx.rect(x, y, cs, cs * (1 - trunc));

      ctx.clip();

    }

    if (s) {

      const cx = x + cs / 2, cyBottom = y + cs;

      ctx.translate(cx, cyBottom);

      ctx.rotate(s);

      ctx.translate(-cx, -cyBottom);

    }

    if (gstate === 1) {

      const sg = ASSETS.getTinted('short_grass', this._shade(colors.grass, 30));

      if (sg) { ctx.globalAlpha = 1; this._drawImageCell(ctx, sg, x, y, cs); ctx.globalAlpha = 1; }

    } else {

      const dg = ASSETS.get('short_dry_grass');

      if (dg) {

        ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;

        this._drawImageCell(ctx, dg, x, y, cs); ctx.globalAlpha = 1;

      } else { this._fillCell(ctx, x, y, cs, this._dryGrassColor); }

    }

    ctx.restore();

  },



  _drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors, swayAngle) {

    colors = colors || this._seasonColorAt();

    const sway = swayAngle || 0;

    if (isBare) { this._drawBareSoil(ctx, r, c, x, y, cs, colors); return; }

    const hasBlock = this._drawGrassBaseLayer(ctx, r, c, x, y, cs, colors);

    if (hasBlock) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, sway, false);  // 静态层：雪化后露出的底，不截断

  },



  /** 画一格「裸土/松动土」：先铺土色底，再叠随格随机的裸土贴图（dirt/coarse_dirt/rooted_dirt），

   *  贴图缺失回退土色。农场泥土中间态(dirt)与退化裸土(bare)共用此画法，逻辑完全一致。 */

  _drawBareSoil(ctx, r, c, x, y, cs, colors) {

    const pad = 1;

    this._fillCell(ctx, x, y, cs, colors.soil);

    const key = this._bareSoilKey(r, c);

    this._drawPaddedAsset(ctx, key, x, y, cs, pad, true)

      || this._fillCell(ctx, x, y, cs, colors.soil);

  },



  /** 共享：把一张图整幅铺满一个 cs×cs 的格子（源取全图，目标为整格）。草方块染色底 / 灰度 overlay /

   *  绿草顶层 / 枯草顶层共 4 处收口。只封装 drawImage 本身，各调用点的 smoothing / alpha /

   *  compositeOperation 等状态设置仍保留在原处（各处差异很大，刻意不并入）。 */

  _drawImageCell(ctx, img, x, y, cs) {

    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, cs, cs);

  },



  /** 共享：用纯色铺满一个 cs×cs 的格子（设 fillStyle + fillRect 整格）。呼吸高亮 / 耕地底纹兜底 /

   *  枯草兜底 / 草方块暗底 / 裸土土色底与兜底共 6 处收口。与原内联一致，调用后 ctx.fillStyle 保留为 color。 */

  _fillCell(ctx, x, y, cs, color) {

    ctx.fillStyle = color;

    ctx.fillRect(x, y, cs, cs);

  },



  /** 共享：把贴图按统一内边距 pad 画进一个 cs×cs 的格子（四边各留 pad），返回 ASSETS.draw 的成功布尔，

   *  调用点用 `|| fallback` 接各自兜底画法。耕地底纹 / 裸土 / 成熟作物三处画法在此统一收口。 */

  _drawPaddedAsset(ctx, key, x, y, cs, pad, smooth) {

    return ASSETS.draw(ctx, key, x + pad, y + pad, cs - pad * 2, cs - pad * 2, smooth);

  },



  /** 画木质贴图(树干/缠根泥土)：成功则贴图，失败用棕色(#6b4a2b)填充同一矩形——木元素兜底画法统一收口。 */

  _drawWoodOrFill(ctx, key, x, y, w, h, smooth) {

    if (ASSETS.draw(ctx, key, x, y, w, h, smooth)) return true;

    ctx.fillStyle = '#6b4a2b';

    ctx.fillRect(x, y, w, h);

    return false;

  },



  /** 画半透明黑色阴影椭圆（树荫/树冠体积暗部共用），alpha 控制深浅。 */

  _drawShadowEllipse(ctx, cx, cy, rx, ry, alpha) {

    ctx.save();

    ctx.fillStyle = `rgba(0,0,0,${alpha})`;

    ctx.beginPath();

    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

    ctx.fill();

    ctx.restore();

  },



  /** 画一格已耕地里长着的作物：成熟用最后一帧生长贴图，生长中按进度选 assetStages 帧并缩放；

   *  贴图缺失回退 emoji。附带生长进度条（未成熟）与成熟金色底线标记。由 _renderStaticScene 调用。 */

  _drawCropCell(ctx, x, y, cs, cell) {

    const def = DATA.CROPS[cell.crop];

    const isGrown = Farm._isGrown(cell);

    const totalDays = (cell.regrowCount > 0 && def.regrow) ? def.regrowDays : def.growDays;

    const progress = Math.min(cell.grownDays / totalDays, 1);

    if (isGrown) {

      // 成熟：用作物自身最后一帧生长贴图（地里长出来的样子），不读 assetHarvest（只管背包/商店图标）

      const assetKey = (def.assetStages && def.assetStages.length)

        ? def.assetStages[def.assetStages.length - 1]

        : def.assetHarvest;

      const padC = 4;

      this._drawPaddedAsset(ctx, assetKey, x, y, cs, padC)

        || this._drawEmojiCrop(ctx, x, y, cs, def, true);

    } else if (def.assetStages && def.assetStages.length) {

      // 生长中：按 progress 选 assetStages 中的一张，随进度由小变大（0.35→0.85）

      const stages = def.assetStages;

      const idx = Math.min(stages.length - 1, Math.floor(progress * stages.length));

      const assetKey = stages[idx];

      const sizeFrac = 0.35 + 0.5 * progress;

      const dw = cs * sizeFrac, dh = cs * sizeFrac;

      const dx = x + (cs - dw) / 2, dy = y + (cs - dh) / 2;

      ASSETS.draw(ctx, assetKey, dx, dy, dw, dh)

        || this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);

    } else {

      this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);

    }

    // 生长进度条（未成熟才画）

    if (!isGrown) {

      const barW = cs * 0.7, barH = 4;

      const barX = x + (cs - barW) / 2, barY = y + cs - barH - 4;

      ctx.fillStyle = 'rgba(0,0,0,0.3)';

      ctx.fillRect(barX, barY, barW, barH);

      ctx.fillStyle = '#4ade80';

      ctx.fillRect(barX, barY, barW * progress, barH);

    }

    // 成熟标记：底部一根金色细线，不画头顶小金币，保持画面干净

    if (isGrown) {

      ctx.fillStyle = 'rgba(255,215,0,0.55)';

      ctx.fillRect(x + 2, y + cs - 3, cs - 4, 2);

    }

  },



  /** 遍历农场网格：对每格回调 (r, c, x, y)，x/y 为该格左上角像素坐标（农场主场景与树场静态层共用同一双重 for + 坐标计算骨架，消除重复） */

  _forEachFarmCell(cs, cb) {

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const x = c * cs, y = r * cs;

        cb(r, c, x, y);

      }

    }

  },



  /** 树场场景的静态层：草地地面（复用农场 _drawGrassGroundCell，草态由 TreeFarm.grass/bare 驱动，草量减半）+ 资源树。 */



  _renderTreeFarmScene(ctx, cs) {

    // 树场地面复用农场同一套草地画法；草态由 TreeFarm.grass/bare 驱动（与农场同逻辑、草量减半）。

    const colors = this._seasonColorAt();

    this._forEachFarmCell(cs, (r, c, x, y) => {

        const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

        const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);

        const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);  // 有树/树苗的格不画草，露出裸土

        this._drawGrassGroundCell(ctx, r, c, x, y, cs, hasTree ? 0 : gstate, isBare || hasTree, colors);

        ctx.strokeStyle = 'rgba(0,0,0,0.10)';

        ctx.lineWidth = 1;

        ctx.strokeRect(x, y, cs, cs);

        // 被锄头翻过的格：地表明为「缠根泥土」(rooted_dirt)（树场根系太密，耕不成耕地），盖在草地之上。

        // 必须与裸土同款画法（先铺土色底 + pad=1 内边距），否则锄完贴图会从 cs-2 突然涨到 cs，

        // 看着像「泥土被锄了之后贴图变大了」（用户反馈）。

        if (TreeFarm.getRootedAt(r, c)) {

          this._fillCell(ctx, x, y, cs, colors.soil);

          this._drawPaddedAsset(ctx, 'rooted_dirt', x, y, cs, 1, true)

            || this._fillCell(ctx, x, y, cs, colors.soil);

        }

    });

    // 第二遍：地面落叶堆按「每格0~4份」grid 绘制；秋季生成、冬季逐日消失（故两季都渲染）

    if (this._isAutumn() || Engine.season === 3) {

      const grid = this._litterGrid;

      if (grid) {

        for (let r = 0; r < DATA.FARM.ROWS; r++) {

          for (let c = 0; c < DATA.FARM.COLS; c++) {

            const n = grid[r][c];

            if (n > 0) this._drawLitterCell(ctx, c * cs, r * cs, cs, n);

          }

        }

      }

    }

    // 第三遍：所有树的「地面树荫椭圆」单独一遍、统一先画在地面层。

    // 必须先于任何树冠：树冠向上溢出约 0.82 格，会盖进上一行的格子；若树荫仍留在 _drawTreeEntity 里，

    // 上一行的树（后画）就会把自己的地荫糊到下一行树的树冠上——就是用户看到的「阴影透到叶子上面」。

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

        if (t && t.stage === 'grown') {

          this._drawShadowEllipse(ctx, c * cs + cs / 2, r * cs + cs * 0.72, cs * 0.52, cs * 0.26, 0.16);

        }

      }

    }

    // 第四遍画树：从上往下画（r=0→ROWS-1）。树冠向上溢出约 1.5 格，下面树的树冠会溢入上面树格内，

    // 先画上面树、后画下面树，使下面溢出的树冠正确盖住上面树的树干（避免「上树树干叠下树树叶」）。

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

        if (t) this._drawTreeEntity(ctx, c * cs, r * cs, cs, t);

      }

    }

  },



  /** 冬季树叶偏白：把指定贴图（叶子/树苗）复制进离屏画布，用 source-atop 叠一层半透明霜白，

   *  使非透明像素（叶/苗）染白、透明空隙保持透明——得到「偏白霜叶」。按资源 key 缓存复用。 */

  _winterFrosted(key) {

    if (!this._winterFrost) this._winterFrost = {};

    if (key in this._winterFrost) return this._winterFrost[key];

    const img = ASSETS.get(key);

    if (!img || !img.width) return null;            // 尚未加载：不缓存，下一帧重试

    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;

    const cv = document.createElement('canvas');

    cv.width = w; cv.height = h;

    const cx = cv.getContext('2d');

    cx.imageSmoothingEnabled = false;

    cx.drawImage(img, 0, 0);

    cx.globalCompositeOperation = 'source-atop';

    cx.fillStyle = 'rgba(233,240,248,0.40)';        // 霜白：40% 不透明冷白叠底（淡霜感，太白则下调）

    cx.fillRect(0, 0, w, h);

    cx.globalCompositeOperation = 'source-over';

    this._winterFrost[key] = cv;

    return cv;

  },



  /** 冬季「下雪过程中」推进树叶白化：一场雪只有「FROST_BUDGET_PER_SNOW 个 1/8 档」的共享额度，

   *  随机分配给树场里还没满的树 —— 是零和的：一棵树多吃，别的树就少吃；若某棵树吃满 8 档，

   *  本场雪额度耗尽，其余树这场合就没机会了（用户原话：「如果一棵树生满，那其他树的机会就没了」）。

   *   - 只「树场 + 冬季 + 正在下雪(isRaining，冬天的雨即雪)」时发放；雪停则冻结（已白的保留）。

   *   - 每场雪开始重置额度（已白的树保留，新额度重新随机发）；离开冬季 → 整片清空（融雪回正常叶色）。

   *   - 不是「每棵树各自独立 0→8」，而是全场共享 N 档、随机撒到随机的树上。

   *  性能：树冠在静态缓存层，只在白化跨过 1/8 档位时才 markFarmDirty 重绘。 */

  _updateTreeFrost(dt) {

    if (!this._isWinter()) {                                   // 非冬季：融雪清空

      if (this._treeFrost) { this._treeFrost = null; this.markFarmDirty(); }

      this._frostBudget = 0; this._frostAccum = 0; this._frostSnowingPrev = false;

      return;

    }

    if (this.scene !== 'treeFarm' || !TreeFarm.trees) return;



    const snowing = !!this.isRaining;                          // 冬天的「雨」就是雪

    if (snowing && !this._frostSnowingPrev) {                  // 新的一场雪：重置本场共享额度

      this._frostBudget = (DATA.TREEFARM && DATA.TREEFARM.FROST_BUDGET_PER_SNOW) || 8;

      this._frostAccum = 0;

    }

    this._frostSnowingPrev = snowing;

    if (!snowing) return;                                      // 没下雪不白；已白的冻结保留

    if (this._frostBudget <= 0) return;                       // 本场雪额度发完，其余树没机会了



    const SPEND_RATE = 0.6;                                    // 发放速度：单位/秒（8 档约 13 秒发完，可调）

    this._frostAccum = (this._frostAccum || 0) + dt * SPEND_RATE;

    let stepped = false;

    while (this._frostAccum >= 1 && this._frostBudget > 0) {

      this._frostAccum -= 1;

      this._frostBudget -= 1;

      // 在还没满（<8 档）的树里随机选一棵，把这一档发给它（零和：吃满的树退出候选池）

      const grid = this._treeFrost;

      const cand = [];

      for (let r = 0; r < DATA.FARM.ROWS; r++) {

        for (let c = 0; c < DATA.FARM.COLS; c++) {

          const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);

          const key = r * 1000 + c;

          if (!hasTree) {                                      // 树被砍了：清零，别让新树继承旧白度

            if (grid && grid[key]) { grid[key] = 0; stepped = true; }

            continue;

          }

          const cur = (grid && grid[key]) || 0;

          if (Math.floor(cur * 8) < 8) cand.push(key);

        }

      }

      if (cand.length === 0) { this._frostBudget = 0; break; } // 全满了，剩余额度作废

      const pick = cand[Math.floor(Math.random() * cand.length)];

      const cur = (grid && grid[pick]) || 0;

      const next = Math.min(1, cur + 1 / 8);

      if (Math.floor(next * 8) !== Math.floor(cur * 8)) stepped = true;

      (this._treeFrost || (this._treeFrost = {}))[pick] = next;

    }

    if (stepped) this.markFarmDirty();

  },



  /** 取某格树当前白化程度（量化到 1/8 档，与上面的缓存失效节奏对齐，避免画出未失效的中间档） */

  _treeFrostAt(r, c) {

    const v = (this._treeFrost && this._treeFrost[r * 1000 + c]) || 0;

    return Math.floor(v * 8) / 8;

  },



  /** 预合成「树冠精灵」= 季节染色树冠 + 体积暗部(约束②b)，暗部用 source-atop 只落在树冠自身的

   *  非透明像素上，绝不溢出到格子空白处。

   *  为什么要预合成：以前 ②b 是直接在主画布上画椭圆，而树冠向上溢出约 0.82 格、树又是由下而上画的，

   *  于是「后画的上排树」会把自己的体积暗部糊到「前排树的叶子」上——这也是用户说的「阴影透到叶子上面」。

   *  所有树的树冠尺寸/暗部位置都一样，故按 (leafColor,size) 缓存一次，全场复用，反而更快。 */

  _canopySprite(leafColor, size) {

    const tinted = ASSETS.getTinted('oak_leaves', leafColor);

    if (!tinted || !size) return null;

    if (!this._canopyCache) this._canopyCache = {};

    const k = leafColor + '|' + size;

    if (this._canopyCache[k]) return this._canopyCache[k];

    if (Object.keys(this._canopyCache).length > 24) this._canopyCache = {};  // 季节色每天渐变，防缓存无限膨胀

    const cv = document.createElement('canvas');

    cv.width = size; cv.height = size;

    const cx = cv.getContext('2d');

    cx.imageSmoothingEnabled = false;

    cx.drawImage(tinted, 0, 0, size, size);

    cx.globalCompositeOperation = 'source-atop';          // 只染树冠自己的像素，空隙保持透明

    cx.fillStyle = 'rgba(0,0,0,0.18)';

    cx.beginPath();

    cx.ellipse(size * 0.64, size * 0.60, size * 0.34, size * 0.30, 0, 0, Math.PI * 2);

    cx.fill();

    cx.globalCompositeOperation = 'source-over';

    this._canopyCache[k] = cv;

    return cv;

  },



  /** 画一棵资源树（树场专用：grown=大树，sapling=树苗）。

   *  树干 oak_log、树冠 oak_leaves 染季节色并向上溢出（视觉大树，逻辑仍只占 1 格）。 */

  _drawTreeEntity(ctx, x, y, cs, t) {

    if (!t) return;

    const fr = Math.round(y / cs), fc = Math.round(x / cs);       // 反推格坐标，用于取该树的白化进度

    const frostAmt = this._isWinter() ? this._treeFrostAt(fr, fc) : 0;

    if (t.stage === 'sapling') {

      // 树苗：用 acorn 像素贴图绘制；素材缺失时回退简单像素方块，不出 emoji

      const pad = 4, size = cs - pad * 2;

      const winter = this._isWinter();

      if (!ASSETS.draw(ctx, 'acorn', x + pad, y + pad, size, size)) {

        const cx = x + cs / 2;

        const trunkW = Math.max(2, cs * 0.14), trunkH = cs * 0.34;

        ctx.fillStyle = '#6b4a2b';

        ctx.fillRect(cx - trunkW / 2, y + cs - trunkH - 1, trunkW, trunkH);

        const leaf = (winter && frostAmt > 0.5) ? '#e3ecf5' : this._seasonGrass(-22);

        ctx.fillStyle = leaf;

        const ly = y + cs * 0.16, lh = cs * 0.26;

        ctx.fillRect(cx - cs * 0.22, ly + lh,       cs * 0.44, lh);

        ctx.fillRect(cx - cs * 0.16, ly + lh * 0.5, cs * 0.32, lh);

        ctx.fillRect(cx - cs * 0.10, ly,            cs * 0.20, lh);

      } else if (frostAmt > 0) {

        // 按该树自己的白化进度叠霜白（0=没白，1=全白）——下雪过程中逐渐盖白，不是一进冬天就白

        const frost = this._winterFrosted('acorn');

        if (frost && frost.width) {

          ctx.save();

          ctx.globalAlpha = Math.min(1, frostAmt);

          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(frost, x + pad, y + pad, size, size);

          ctx.restore();

        }

      }

      return;

    }

    if (t.stage === 'grown') {

      // === A4 树叶与草地区分：4 条硬约束 ===

      const baseGrass = this._seasonColorAt().grass;

      // 约束①：树冠比草地更深/更饱和（偏离由 -14 加深到 -30）

      const leafColor = this._shade(baseGrass, -30);

      // 树冠底色一律按季节草色染深；冬季的「霜白」改为下面按该树 frostAmt 叠加，

      // 这样一进冬天不会整片林子瞬间全白，而是下雪过程中一棵棵慢慢泛白（用户要求）。

      const tinted = ASSETS.getTinted('oak_leaves', leafColor);

      const trunkW = cs * 0.52, trunkH = cs * 0.72;

      const tx = x + (cs - trunkW) / 2, ty = y + cs - trunkH - 2;

      // 注：约束②a 的地面树荫椭圆已上移到 _renderTreeFarmScene 的独立一遍（先于所有树冠画），

      // 否则后画的树会把地荫盖到前排树冠上（用户「阴影透到叶子上面」）。

      // 约束④：树干 oak_log 占下半部，树冠长在树干上（连通，不悬空）

      this._drawWoodOrFill(ctx, 'oak_log', tx, ty, trunkW, trunkH);

      // 树冠：oak_leaves（1024 方图，保持 1:1 不变形），底部接树干顶端向上长，

      // 不再用「整体上移 overflow」——那会让叶子内容在边缘格被推到格子下方显得「往下挤」。

      const crownSize = cs * 1.5;

      const crownW = crownSize, crownH = crownSize;

      const crownX = x + (cs - crownW) / 2;

      const crownBottom = y + cs - trunkH * 0.45;   // 树冠底落在树干上半部，连通不悬空

      const crownY = crownBottom - crownH;          // 向上生长；超界部分由画布自然裁切

      // 树冠 + 体积暗部(②b) 已预合成到一张精灵里（暗部 source-atop 只落在叶子像素上，不会溢出去盖到别的树）

      const canopy = this._canopySprite(leafColor, Math.max(1, Math.round(crownSize)));

      if (canopy) {

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(canopy, crownX, crownY, crownW, crownH);

      } else if (tinted) {                                   // 兜底：贴图还没染好时先画原色树冠

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(tinted, crownX, crownY, crownW, crownH);

      }

      // 冬季按该树的白化进度 frostAmt 叠一层霜白（下雪过程中逐渐盖白；只染非透明的叶像素，用离屏 source-atop 版）

      if (frostAmt > 0) {

        const frostImg = this._winterFrosted('oak_leaves');

        if (frostImg) {

          ctx.save();

          ctx.globalAlpha = Math.min(1, frostAmt);

          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(frostImg, crownX, crownY, crownW, crownH);

          ctx.restore();

        }

      }

      // 注：A4 约束③（外缘亮边/描边）按用户反馈「太丑了」已移除；靠约束①②④（更深+树荫椭圆+体积暗部+树干连通）做树叶/草地分层

    }

    // 注：树桩(stump)阶段已移除——砍树后 trees[r][c]=null 直接消失，不再渲染桩（用户「树桩去掉」）。

    // ── 调试叠加层：点击一次后永久显示，用于对比鼠标视觉位置与实际格子 ──
    if (!this._debugLock) {
      // 点击区域任意一处即激活，之后锁定不消失
      if (this._mouseX > 0 || this._hoverCell) this._debugLock = true;
    }
    if (this._debugLock) {
      const cs = this.cellSize;
      const hr = this._hoverCell ? this._hoverCell.row : -1;
      const hc = this._hoverCell ? this._hoverCell.col : -1;
      // 半透明背景
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(4, 4, 220, 90);
      // 坐标信息
      ctx.fillStyle = '#0f0';
      ctx.font = '11px monospace';
      ctx.fillText(`mouse: ${this._mouseX.toFixed(0)},${this._mouseY.toFixed(0)}`, 10, 20);
      ctx.fillText(`cell: ${hr},${hc}`, 10, 36);
      ctx.fillText(`cs=${cs} x=${hc*cs} y=${hr*cs}`, 10, 52);
      const r = this.canvas.getBoundingClientRect();
      ctx.fillText(`rect: ${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`, 10, 68);
      // 十字准星
      ctx.strokeStyle = 'rgba(255,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this._mouseX, 0);
      ctx.lineTo(this._mouseX, this.canvas.height);
      ctx.moveTo(0, this._mouseY);
      ctx.lineTo(this.canvas.width, this._mouseY);
      ctx.stroke();
    }

  },



  /** 持续重绘循环：驱动未浇水作物的闪烁动画（标签页隐藏时浏览器自动暂停） */

  // ─────────────────────────────────────────────

  // ⑤ 动画循环 / HUD

  // ─────────────────────────────────────────────

  _startAnimLoop() {

    if (this._animRaf) return; // 防止重复启动

    const loop = () => {

      const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      try { this.render(); } catch (err) { console.error('[render loop]', err); }

      if (this.ctx) this.ctx.setTransform(1, 0, 0, 1, 0, 0); // 异常帧后复位变换，防止 save/restore 失衡残留偏移

      // 轻量 FPS 统计（仅 console.log 每秒一次，便于定位卡顿是否帧率问题；不要可删）

      if (typeof performance !== 'undefined') {

        if (this._fpsLast == null) this._fpsLast = t0;

        this._fpsCount = (this._fpsCount || 0) + 1;

        const dt2 = t0 - this._fpsLast;

        if (dt2 >= 1000) { this._fps = Math.round(this._fpsCount * 1000 / dt2); this._fpsCount = 0; this._fpsLast = t0; console.log('[FPS]', this._fps); }

      }

      this._animRaf = requestAnimationFrame(loop);

    };

    this._animRaf = requestAnimationFrame(loop);

  },



  /** 更新 HUD（仅在值变化时写 DOM，避免每帧 getElementById + 布局重绘——HUD 仅随游戏事件变化） */

  _updateHUD() {

    if (!this._hudCache) this._hudCache = { dt: null, sta: null, money: null, pct: null, bg: null };

    const c = this._hudCache;

    const dt = Engine.getDateString() + ' ' + Engine.getTimeString();

    if (dt !== c.dt) { document.getElementById('hud-datetime').textContent = dt; c.dt = dt; }



    const shownStamina = Math.round(Player.stamina);

    const pct = (shownStamina / Player.maxStamina) * 100;

    const sta = `${shownStamina}/${Player.maxStamina}`;

    const money = Player.money;

    const bg = pct < 30 ? '#e0524f' : '';   // B5：体力 <30% 变红

    if (sta !== c.sta) { document.getElementById('hud-stamina').textContent = sta; c.sta = sta; }

    if (pct !== c.pct || bg !== c.bg) {

      const fill = document.getElementById('stamina-bar-fill');

      fill.style.width = `${pct}%`;

      fill.style.background = bg;

      c.pct = pct; c.bg = bg;

    }

  },



  /** 工具栏点击 */

  // ─────────────────────────────────────────────

  // ⑥ 工具栏（原「手持槽」区块已移除，见 _updateHeldSlot）

  // ─────────────────────────────────────────────

  _onToolClick(btn) {

    const tool = btn.dataset.tool;

    if (!tool) return;

    if (this._busy) return; // 正在干活中，期间不能切换工具



    // 当前选中的工具由「底部快捷栏」高亮体现，工具栏按钮本身不再加选中边框，

    // 避免同时出现两个高亮框（快捷栏 + 工具按钮）。



    // 处理种子选择

    const seedId = this._seedIdFromTool(tool);

    if (seedId) {

      Player.selectTool(`seed-${seedId}`);

      this.showStatus(`选择种子：${DATA.CROPS[seedId].name}`, 1000);

    } else {

      Player.selectTool(tool);

      const names = { hoe: '锄头', water: '水桶', axe: '斧头', acorn: '橡果' };

      this.showStatus(`选择工具：${names[tool] || tool}`, 800);

    }

    this._updateHeldSlot();

    // 背包开着时同步快捷栏选中高亮（工具栏按钮直接装备也联动高亮）

    if (this._invSyncSelToTool) this._invSyncSelToTool();

    if (this._inventoryOpen) this.renderInventory();

  },



  /** 原「刷新底部『手中物品』显示」——手持槽已移除，选中态改由底部快捷栏高亮表达。
      本方法为空实现，但仍被 9 处调用（inventory.js / shop.js / ui.js / main.js），
      保留空壳以免每处调用点都要判空。 */

  _updateHeldSlot() {},



  /** 降级回退：用 emoji 渲染作物（贴图加载失败时用） */

  _drawEmojiCrop(ctx, x, y, cs, def, isGrown, progress = 1) {

    let icon;

    if (isGrown) {

      icon = def.harvestSprite;

    } else {

      // 三个生长阶段轮换：苗 → 叶 → 芽

      const stages = ['🌱', '🌿', '🌳'];

      const stageIdx = Math.min(2, Math.floor(progress * 3));

      icon = stages[stageIdx];

    }

    const scale = isGrown ? 0.6 : (0.25 + progress * 0.45); // 25% → 70%

    const size = cs * scale;

    ctx.font = `${size}px sans-serif`;

    this._setTextCenter(ctx);

    ctx.fillText(icon, x + cs / 2, y + cs / 2);

  },



  // ─────────────────────────────────────────────

  // ⑦ 画布输入（鼠标悬停）

  // ─────────────────────────────────────────────

  _eventToCanvas(e) {

    const rect = this.canvas.getBoundingClientRect();

    return { x: e.clientX - rect.left, y: e.clientY - rect.top };

  },



  /** 画布像素坐标 → 网格行列（输入热路径共用，消除 _onMouseMove/_onCanvasClick 两处重复） */

  _cellAt(x, y) {

    return { row: Math.floor(y / this.cellSize), col: Math.floor(x / this.cellSize) };

  },



  /** 从工具 id 解析种子作物 id；非种子工具返回 null（种子播种两处共用，消除重复的 startsWith+replace） */

  _seedIdFromTool(tool) {

    return tool.startsWith('seed-') ? tool.replace('seed-', '') : null;

  },



  /** 收获/收割时取作物定义 + 额外掉落后缀（收割成功分支与收获回调两处共用，消除重复的 CROPS 查表 + extra 拼接） */

  _cropDefExtra(res) {

    return {

      def: DATA.CROPS[res.cropId],

      extra: res.count > 1 ? ' (+额外掉落!)' : ''

    };

  },



  _onMouseMove(e) {

    if (this._shopOpen) { this._onShopMove(e); return; }

    if (this._busy) return; // 正在干活中，悬停高亮冻结在当前地块，不跟随鼠标
    // DEBUG: 更新DOM调试覆盖层
    const dbg = document.getElementById('debug-overlay');
    if (dbg) {
      dbg.style.display = 'block';
      dbg.textContent = `mouse: ${x.toFixed(0)},${y.toFixed(0)} | cell: ${next ? next.row + "," + next.col : "-1,-1"} | rect: ${this.canvas.getBoundingClientRect().toJSON()}`;
    }

    const { x, y } = this._eventToCanvas(e);

    this._mouseX = x; this._mouseY = y; // 供导航箭头等画布 UI 的悬停高亮

    const { row, col } = this._cellAt(x, y);

    let next;

    if (row >= 0 && row < DATA.FARM.ROWS && col >= 0 && col < DATA.FARM.COLS) {

      next = { row, col };

    } else {

      next = null;

    }

    // 只在悬停格子变化时重绘，避免乱晃/卡顿

    const cur = this._hoverCell;

    if ((cur === null) !== (next === null)

        || (cur && next && (cur.row !== next.row || cur.col !== next.col))) {

      this._hoverCell = next;

      if (!this._hoverRaf) {

        this._hoverRaf = requestAnimationFrame(() => {

          this._hoverRaf = null;

          this.render();

        });

      }

    }

  },



  /** 点击地图 */

  // ─────────────────────────────────────────────

  // ⑧ 田间动作（锄 / 浇 / 种 / 收 / 砍树）

  // ─────────────────────────────────────────────

  // ── 农场/树场动作：_startBusy 的 onEffect / onDone 具名化（原内联箭头整体搬出，行为不变）──

  // 通用动作骨架：扣体力(cost) 或 cost=null 直接执行 → 世界操作 → 成功(res 满足 isOk)时调用 onOk(res)。

  // 各 *_Effect 把「成功分支」原样搬进 onOk，worldFn 用闭包固化 row/col，行为逐字等价。

  _actionEffect(row, col, cost, worldFn, onOk, opts) {

    const res = (cost == null) ? worldFn(row, col) : this._tryAction(cost, () => worldFn(row, col));

    const isOk = (opts && opts.isOk) || ((r) => r === 'ok');

    if (isOk(res) && onOk) onOk(res);

    return res;

  },

  _waterEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.water, (r, c) => Farm.water(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6bb6ff', '#9fd4ff', '#bfe8ff'], shape: 'rect', count: 10, speed: 70, gravity: 320, dir: -Math.PI / 2, spread: Math.PI * 1.3 });

    });

  },

  _waterDone(res) {

    if (res !== 'ok') {

      if (res === 'already_watered') this.showStatus('已经浇过水了', 400);

      else if (res === 'no_tilled') this.showStatus('这里还没有耕地', 500);

      return;

    }

    this.showStatus('💧 浇水完成', 500);

  },

  _plantEffect(row, col, seedId, seedName, plantCost) {

    const def = DATA.CROPS[seedId];

    const hc = (def && def.color) || '#FFD86B';

    const _rgb = this._hexToRgb(hc);

    const base = `rgb(${_rgb.r},${_rgb.g},${_rgb.b})`;

    return this._actionEffect(row, col, plantCost, (r, c) => Farm.plant(r, c, seedId), (res) => {

      this._invalidateCell(row, col);

      Player.useSeed(seedId);

      this._updateHeldSlot();

      this._spawnBurst(row, col, { colors: [base, this._shade(base, 30), this._shade(base, -30)], count: 12, speed: 75, gravity: 280 });

    });

  },

  _plantDone(res, seedName) {

    if (res === 'no_seed') { this.showStatus(`❌ 种子包里没有 ${seedName} 种子, 去商店买吧 (B)`, 1500); return; }

    if (res !== 'ok') {

      if (res === 'not_tilled') this.showStatus('需要先耕地！', 600);

      else if (res === 'already_planted') this.showStatus('已经种了东西了', 600);

      else this.showStatus('无法种植', 600);

      return;

    }

  },

  _harvestEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.harvest, (r, c) => Farm.harvest(r, c), (res) => {

      Player.addToInventory(res.cropId, res.count);

      this._invalidateCell(row, col);

      const { def, extra } = this._cropDefExtra(res);

      this._spawnBurst(row, col, { colors: ['#9bd45a', '#c6e87a', '#e8f0a0', (def && def.color) || '#FFD86B'], count: 16, speed: 95, gravity: 260 });

      this._shakeIt(2, 220);

    }, { isOk: (r) => r.ok });

  },

  _harvestDone(res) {

    if (this._fail(res, '❌ 无法收割')) return;

    const { def, extra } = this._cropDefExtra(res);

    this.showStatus(`🔨 收获 ${def.name}×${res.count}${extra}`, 1500);

  },

  _clearGrassEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.clearGrass(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#7bbf4a', '#9bd45a', '#cfe89a'], count: 10, speed: 60, gravity: 200, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },

  _clearGrassDone(res, gstate) {

    if (res !== 'ok') { this.showStatus('❌ 无法除草', 800); return; }

    const grassIcon = this._grassIconHTML(gstate);

    this.showStatus(grassIcon + ' 除掉了草，可以耕地了', 800);

  },

  /** 按花种编号(1..N)取 DATA.FLOWERS 定义（贴图键/中文名/粒子色）。越界或 DATA 缺失时兜底第一种。

   *  渲染、锄花粒子、锄花提示三处共用，避免各写一份查表逻辑。 */

  _flowerDef(species) {

    const list = (typeof DATA !== 'undefined' && DATA.FLOWERS) ? DATA.FLOWERS : null;

    if (!list || !list.length) return { key: 'Allium', name: '花', colors: ['#c77dff', '#e0aaff', '#d8b4f0', '#ffffff'] };

    return list[(species | 0) - 1] || list[0];

  },

  /** 锄花 effect：与 _clearGrassEffect 同构（扣体力 → 调 Farm.clearFlower → 粒屑）。

   *  花瓣粒屑取该花自己的配色（DATA.FLOWERS[].colors），区别于草屑的纯绿。

   *  ⚠ 必须在 Farm.clearFlower 之前读花种——清除后格子已归 0，回调里就查不到品种了。 */

  _clearFlowerEffect(row, col) {

    const def = this._flowerDef(Farm._flowerState(row, col));

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.clearFlower(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: def.colors, count: 12, speed: 70, gravity: 220, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },

  /** species 由 _handleHoeClick 在清除前捕获后传入（清除后 Farm 里已查不到）。 */

  _clearFlowerDone(res, species) {

    if (res !== 'ok') { this.showStatus('❌ 这里没有花', 800); return; }

    const def = this._flowerDef(species);

    const flowerIcon = this._iconHTML(def.key, 'status-hoe', def.name) || '🌸';

    this.showStatus(flowerIcon + ' 锄掉了' + def.name + '，可以耕地了', 800);

  },

  _tillEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.till(r, c), (res) => {

      if (this.isRaining) { const cl = (Farm.grid[row] && Farm.grid[row][col]); if (cl) cl.watered = true; }

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#8a5a2b', '#a9763c', '#6b4423'], count: 14, speed: 80, gravity: 320 });

    });

  },

  _tillDone(res, cell) {

    if (this._warnIfNotOk(res, cell)) return;

    this.showStatus('🔨 耕地完成', 600);

  },

  _toDirtEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.toDirt(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#8a5a2b', '#a9763c', '#6b4423'], count: 12, speed: 75, gravity: 300 });

    });

  },

  _toDirtDone(res, cell) {

    if (this._warnIfNotOk(res, cell)) return;

    const dirtIcon = this._iconHTML('coarse_dirt', 'status-hoe', '泥土');

    this.showStatus(dirtIcon + ' 锄成了泥土，再锄一次就能耕地', 800);

  },

  _chopEffect(row, col, tree, src) {

    return this._actionEffect(row, col, DATA.TOOL_COST.axe, (r, c) => src.chop(r, c), (res) => {

      Player.addWood(res.wood);

      if (res.acorns) Player.addAcorns(res.acorns);

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6b4a2b', '#8a5a2b', '#3d6b2a', '#5a8a3a'], count: 22, speed: 130, gravity: 340, spread: Math.PI * 2 });

      this._shakeIt(4, 300);

    }, { isOk: (r) => r.ok });

  },

  _chopDone(res) {

    if (this._fail(res, '❌ 无法砍树')) return;

    const logIcon = this._iconHTML('oak_log', 'status-hoe', '木头') || '🪵';

    let extra = '';

    if (res.acorns) {

      const acornIcon = this._iconHTML('acorn', 'status-hoe', '橡果') || '';

      extra = ` 橡果×${res.acorns} ${acornIcon}`;

    }

    this.showStatus(`🪓 砍倒树，获得木头×${res.wood} ${logIcon}${extra}`, 1500);

  },

  _plantSaplingEffect(row, col) {

    return this._actionEffect(row, col, null, (r, c) => TreeFarm.plantAcorn(r, c), (res) => {

      Player.useAcorn();

      this._updateHeldSlot();

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#3d6b2a', '#5a8a3a', '#8a5a2b'], count: 10, speed: 55, gravity: 240 });

    }, { isOk: (r) => r.ok });

  },

  _plantSaplingDone(res) {

    if (this._fail(res, `❌ ${res ? res.reason : '失败'}`)) return;

  },



  _onCanvasClick(e) {

    const { x, y } = this._eventToCanvas(e);

    // DEBUG: 坐标映射日志，点击后在控制台查看实际行列与点击位置
    console.log('[click]', 'x=' + x.toFixed(1) + ' y=' + y.toFixed(1),
                '| rect=', this.canvas.getBoundingClientRect(),
                '| client=', e.clientX, e.clientY,
                '| cell=', Math.floor(x / this.cellSize), Math.floor(y / this.cellSize),
                '| cs=', this.cellSize);

    this._mouseX = x; this._mouseY = y;

    // 商店打开时点击交给商店逻辑（含「点面板外关闭」）

    if (this._shopOpen) { this._onShopClick(x, y); return; }

    if (Engine.paused) return;

    if (this._busy) return; // 正在干活中，期间不能点地图

    if (this._transition) return; // 切换滑场动画进行中，屏蔽点击



    // 画布左上角导航箭头：树场←回农场 / 农场→去树场（先于网格点击判定）

    if (this._navHit(x, y)) { this.toggleScene(); return; }



    const { row, col } = this._cellAt(x, y);



    if (!Farm._inBounds(row, col)) return;



    // 锁定悬停高亮到当前正在操作的格子（忙时高亮冻结在此处）

    this._hoverCell = { row, col };



    const tool = Player.selectedTool;



    // ── 树场场景：只处理砍树（斧头），其余工具无意义，统一拦截 ──

    if (this.scene === 'treeFarm') { this._handleTreeFarmClick(row, col, tool); this.render(); return; }



    // 主农场已不再有树（树移到独立树场 TreeFarm 场景）；斧头等工具在农场上无树可交互，

    // 直接走下方的耕地/浇水/播种逻辑。砍树请按 T 进入树场。



    // 根据工具类型处理，每类自己做体力检查 + 事务（成功才扣）

    switch (tool) {

      case 'hoe':

        this._handleHoeClick(row, col);

        return;



      case 'water': {

        // 点击即判定：干不了直接提示、不进进度条

        const wcell = (Farm.grid[row] && Farm.grid[row][col]) || null;

        if (!wcell || !wcell.tilled) { this.showStatus('这里还没有耕地', 500); return; }

        if (wcell.watered) { this.showStatus('已经浇过水了', 400); return; }

        this._startBusy('浇水', null,

          () => this._waterEffect(row, col),

          (res) => this._waterDone(res));

        return;

      }



      default: {

        // 种子播种：先检查种子，再「先扣后做 + 失败回滚」（B1）

        const seedId = this._seedIdFromTool(tool);

        if (seedId) {

          const plantCost = DATA.TOOL_COST.plant || 3;

          const seedName = (DATA.CROPS[seedId] && DATA.CROPS[seedId].name) || seedId;

          // 按作物选对应种子贴图（不再统一用小麦种子）

          const seedIconKey = ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries' })[seedId] || 'wheat_seeds';

          // 点击即判定：干不了直接提示、不进进度条

          if (!Player.hasSeed(seedId)) { this.showStatus(`❌ 种子包里没有 ${seedName} 种子, 去商店买吧 (B)`, 1500); return; }

          const cell0 = (Farm.grid[row] && Farm.grid[row][col]) || null;

          if (!cell0) { this.showStatus('需要先耕地！', 600); return; }

          if (cell0.crop) { this.showStatus('已经种了东西了', 600); return; }

          this._startBusy('种植', seedIconKey,

            () => this._plantEffect(row, col, seedId, seedName, plantCost),

            (res) => this._plantDone(res, seedName));

        }

        return;

      }

    }

  },



  /** 锄头在主农场的点击逻辑：按当前格子状态分 4 种情况处理（收割/除草/耕地/锄成泥土）。

   *  全程走 _tryAction 体力事务；每种失败分支各回各的提示，互不影响。 */

  _handleHoeClick(row, col) {

    const cell = (Farm.grid[row] && Farm.grid[row][col]) || null;

    // 成熟的作物：锄头点击即可收割（无需单独的「收获」工具）

    if (cell && cell.crop && Farm._isGrown(cell)) {

      this._startBusy('收割', null,

        () => this._harvestEffect(row, col),

        (res) => this._harvestDone(res));

      return;

    }

    // 点击即判定：作物未成熟不能收/锄，立刻提示、不进进度条（避免落到耕地分支拖到 80% 才报）

    if (cell && cell.crop) { this.showStatus('🌱 作物还没成熟，再等等', 600); return; }

    // 点击即判定：已耕地（非成熟作物）不能再锄，立刻提示、不进进度条

    if (cell && cell.tilled) { this.showStatus('这块地已经耕过了', 500); return; }

    // 花朵格子：先锄花（视觉上花朵替换草方块，grass=0/flowers>0；详见 Farm.clearFlower）

    const fstate = (Farm.flowers && Farm.flowers[row]) ? (Farm.flowers[row][col] || 0) : 0;

    if (fstate > 0) {

      this._startBusy('锄花', null,

        () => this._clearFlowerEffect(row, col),

        (res) => this._clearFlowerDone(res, fstate)); // fstate=清除前捕获的花种，用于提示图标/名字

      return;

    }

    // 有草(绿/黄)的地面：必须先除掉草 → 变回普通草方块，之后才能锄地

    const gstate = (Farm.grass && Farm.grass[row]) ? (Farm.grass[row][col] || 0) : 0;

    if (gstate === 1 || gstate === 2) {

      this._startBusy('除草', null,

        () => this._clearGrassEffect(row, col),

        (res) => this._clearGrassDone(res, gstate));

      return;

    }

    // 已是泥土(dirt) 或 自然退化的裸土(bare) → 锄一次直接成耕地

    // （裸土本来就是裸露的土，不需要再「锄成泥土」，一锄到位）

    const isBareSoil = !!(Farm.bare && Farm.bare[row] && Farm.bare[row][col]);

    if ((Farm.dirt && Farm.dirt[row] && Farm.dirt[row][col]) || isBareSoil) {

      this._startBusy('耕地', null,

        () => this._tillEffect(row, col),

        (res) => this._tillDone(res, cell));

      return;

    }

    // 否则：普通草方块（从未退化过的地面）→ 先锄成泥土，再锄一次才成耕地

      this._startBusy('锄地', null,

        () => this._toDirtEffect(row, col),

        (res) => this._toDirtDone(res, cell));

  },



  /** 用斧头砍树：stamina 先扣后做 + 失败回滚（与锄地/浇水同款事务逻辑）。

   *  src 默认 Farm（主农场上的树）；树场场景传 TreeFarm。 */

  _chopTree(row, col, tree, src) {

    src = src || TreeFarm;

    if (tree.stage !== 'grown') {

      this.showStatus('🌱 树还没长好，等它重新长大', 1000);

      return;

    }

    this._startBusy('砍树', null,

      () => this._chopEffect(row, col, tree, src),

      (res) => this._chopDone(res));

  },



  /** 树场场景的点击处理：① 有树→斧头砍；② 空格→选了「橡果」则种下，否则提示。 */

  _handleTreeFarmClick(row, col, tool) {

    const tree = TreeFarm.getTreeAt(row, col);

    if (tree) {

      if (tool === 'axe') {

        if (!Player.ownedTools || !Player.ownedTools.axe) {

          this.showStatus('先去商店 (B) 买把木斧头再砍', 1500);

        } else {

          this._chopTree(row, col, tree, TreeFarm);

        }

      } else {

        this.showStatus('🌳 这里有棵树，按 3 切斧头再砍', 1200);

      }

      return;

    }

    // 锄头：与主农场同步的分支逻辑（先除草、再尝试翻出缠根泥土带概率）；不产生耕地、不弹窗

    if (tool === 'hoe') {

      this._handleTreeFarmHoeClick(row, col);

      this.render();

      return;

    }

    // 空格：种橡果（需先在背包选中「橡果」，或快捷键切到橡果工具）

    if (tool === 'acorn') {

      // 点击即判定：干不了直接提示、不进进度条（有树的情况已被上方 if(tree) 拦截）

      if (!Player.hasAcorn()) {

        this.showStatus('没有橡果，去砍树掉落 1~3 个再来种', 1200);

      } else {

        this._startBusy('种植', null,

          () => this._plantSaplingEffect(row, col),

          (res) => this._plantSaplingDone(res));

      }

      this.render();

      return;

    }

    if (tool === 'axe') this.showStatus('🪓 这里没有树可砍', 800);

    else this.showStatus('树场里：按 3 切斧头砍树，或选「橡果」点击空格种植', 1000);

    this.render();

  },



  /** 树场锄头点击：与主农场 _handleHoeClick 同步的分支逻辑，但不产生耕地（树场根系太密，只翻出缠根泥土，且带概率）。

   *  - 有草(绿/黄) → 除草（与主农场一致，走「正在除草中」进度条）

   *  - 已翻出缠根泥土 → 点击即拦截，提示一句，不再重复锄（用户「这个泥土怎么还可以再被锄一次，不合理」）

   *  - 其余地面（草方块/裸土）→「正在锄地中」进度条 → ROOT_CHANCE 概率翻出缠根泥土，失败可重试

   *  R78：恢复 _startBusy 的「正在 X 中…」指示器（用户要求把这个弹窗展示出来），

   *  这样锄头那点耗时是有进度条可见的，不再「感觉有延迟」；R77 去掉的是**成功结果那条 toast**，仍然不加回来。 */

  _handleTreeFarmHoeClick(row, col) {

    const gstate = (TreeFarm.grass && TreeFarm.grass[row]) ? (TreeFarm.grass[row][col] || 0) : 0;

    if (gstate === 1 || gstate === 2) {                       // 有草 → 先除草

      this._startBusy('除草', 'wooden_hoe',

        () => this._tfClearGrassEffect(row, col),

        (res) => { if (res !== 'ok') this.showStatus('❌ 无法除草', 600); });

      return;

    }

    if (TreeFarm.getRootedAt(row, col)) {                     // 已翻出缠根泥土：不能再锄

      this.showStatus('这块地已经翻过了', 500);

      return;

    }

    this._startBusy('锄地', 'wooden_hoe',

      () => this._tfTillEffect(row, col),

      (res) => this._tfTillDone(res));

  },



  /** 树场除草：与主农场 _clearGrassEffect 同构（同样走 _tryAction 扣体力），只是作用于 TreeFarm。 */

  _tfClearGrassEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => TreeFarm.clearGrass(r, c), () => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#7bbf4a', '#9bd45a', '#cfe89a'], count: 10, speed: 60, gravity: 200, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },



  /** 树场锄地：TreeFarm.till 返回 {ok} / {ok:false,reason}，故用 isOk 取 r.ok（不是主农场那套 'ok' 字符串）。 */

  _tfTillEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => TreeFarm.till(r, c), () => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6b4a2b', '#8a5a2b', '#3d6b2a'], count: 12, speed: 75, gravity: 300 });

    }, { isOk: (r) => !!(r && r.ok) });

  },



  _tfTillDone(res) {

    if (res && res.ok) return;                                // 成功：不弹结果 toast（R77 要求），靠贴图 + 粒子表现

    // 失败只在「根系太密」这种可重试的情况提示一句，否则玩家不知道为什么点了没反应

    if (res && res.reason === 'root_too_dense') this.showStatus('🪵 根系太密，没锄动，再试一次', 700);

  },



  /** 进入“正在 X 中”状态：体力越低耗时越长（效率越低），期间锁输入。

   *  - onEffect()：进度条到 80% 时才触发，执行真正的世界改动（含 _tryAction 体力事务），须返回 res。

   *  - onDone(res)：进度条满 100%（成功）或 80%（失败）时触发，负责状态提示/粒子等表现。

   *  设计点：被操作的对象（作物/树/地块）在进度条 80% 时才真正变化，而非点击瞬间。 */

  _startBusy(label, iconKey, onEffect, onDone) {

    const BUSY_ICONS = {

      '耕地': 'wooden_hoe', '浇水': 'water_bucket', '收割': 'wooden_hoe',

      '种植': 'wheat_seeds', '砍树': 'oak_log', '除草': 'wooden_hoe', '锄地': 'wooden_hoe',

    };

    const key = iconKey || BUSY_ICONS[label] || '';

    const iconSrc = this._assetURL(key);

    document.getElementById('busy-icon').src = iconSrc;



    const r = Math.max(0, Math.min(1, Player.stamina / Player.maxStamina));

    const dur = Math.round(this.BUSY_BASE_MS * (1 + (1 - r) * this.BUSY_SLOW_K));

    const EFFECT_AT = 0.8; // 进度条到 80% 才真正改变被操作的对象

    this._busy = true;

    this._busyEffectResult = null;

    const ind = document.getElementById('busy-indicator');

    document.getElementById('busy-text').textContent = `正在${label}中…`;

    // 先显示指示器（元素可见时 reflow 才能捕获 0% 起始态，否则 transition 不触发、进度条不动）

    ind.classList.remove('busy-hidden');

    ind.classList.add('busy-visible');

    const fill = document.getElementById('busy-fill');

    // 重启进度条动画

    fill.style.transition = 'none';

    fill.style.width = '0%';

    void fill.offsetWidth; // 强制 reflow，让下次 width 变化重新触发 transition

    fill.style.transition = `width ${dur}ms linear`;

    fill.style.width = '100%';

    clearTimeout(this._busyTimer);

    clearTimeout(this._busyEffectTimer);

    // 80%：触发真正的世界改动

    this._busyEffectTimer = setTimeout(() => {

      const res = onEffect ? onEffect() : 'ok';

      this._busyEffectResult = res;

      const ok = res === 'ok' || !!(res && res.ok);

      if (!ok) { // 失败：立刻结束并显示失败提示（不撑满整条）

        clearTimeout(this._busyTimer);

        this._finishBusy();

        if (onDone) onDone(res);

      }

    }, dur * EFFECT_AT);

    // 100%：成功才走到这里，弹完成表现

    this._busyTimer = setTimeout(() => {

      this._finishBusy();

      if (onDone) onDone(this._busyEffectResult);

    }, dur);

  },



  /** 收尾“正在 X 中”状态：解锁输入 + 隐藏指示器 */

  _finishBusy() {

    this._busy = false;

    const ind = document.getElementById('busy-indicator');

    ind.classList.remove('busy-visible');

    ind.classList.add('busy-hidden');

  },



  /** 显示状态消息 */

  // ─────────────────────────────────────────────

  // ⑨ 状态提示 / 图标

  // ─────────────────────────────────────────────

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

  _assetURL(key) {

    return (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';

  },



  _iconHTML(key, cls, alt) {

    const src = this._assetURL(key);

    return src ? `<img class="${cls}" src="${src}" alt="${alt}">` : '';

  },



  /** 把奖励结构渲染成中文摘要（无 emoji；money/物品均用文字） */

  _rewardText(reward) {

    if (!reward) return '';

    const parts = [];

    if (reward.money) parts.push(`金锭 ×${reward.money}`);

    if (reward.items) {

      const LABEL = {

        'money': '金锭', 'wood': '原木', 'planks': '木板', 'acorns': '橡果',

        'axe': '木斧头', 'seed:wheat': '小麦种子', 'seed:strawberry': '甜浆果种子',

        'crop:wheat': '小麦', 'crop:strawberry': '甜浆果',

      };

      for (const it of reward.items) {

        const lbl = LABEL[it.id] || it.id;

        parts.push(`${lbl} ×${it.count}`);

      }

    }

    return parts.join('，');

  },



  /**

   * 绿草(short_grass)按「季节草色 +30 明度」染色的 dataURL；拿不到染色就回退 short_grass 原图。

   * showStatus 的 🌿 角标与地里被清除的绿草图标都走这一处，保证视觉一致、逻辑唯一。

   */

  _tintedGrassURL() {

    if (typeof ASSETS !== 'undefined' && ASSETS.getTinted) {

      const tinted = ASSETS.getTinted('short_grass', this._seasonGrass(30));

      if (tinted) { try { return tinted.toDataURL(); } catch (e) { /* 染色失败 → 回退原图 */ } }

    }

    return this._assetURL('short_grass');

  },



  /**

   * 状态提示用的「草」图标：与被清除的草类型一致。

   * - 绿草(gstate===1)：季节草色 +30 明度染 short_grass（与地图绿草一致）

   * - 枯草(gstate===2)：直接用已上色 short_dry_grass（与地图黄草一致）

   * 返回可直接塞进 showStatus(msg) 的 <img> 片段；拿不到贴图时返回空串。

   */

  _grassIconHTML(gstate) {

    const src = (gstate === 2)

      ? this._assetURL('short_dry_grass')

      : this._tintedGrassURL();

    return src ? `<img class="status-hoe" src="${src}" alt="草">` : '';

  },



  /** 显示每日结算 — 纯展示浮层，不阻塞操作、时间继续走 */

  // ─────────────────────────────────────────────

  // ⑫ 每日结算

  // ─────────────────────────────────────────────

  showFullSummary() {

    const overlay = document.getElementById('day-summary');

    const content = document.getElementById('summary-content');

    content.innerHTML = '';



    const dayStr = Engine.getDateString();



    let html = `<div class="summary-row" style="color:var(--accent);font-weight:bold;">${dayStr} · 结束</div>`;



    html += `<div class="summary-row"><span>体力</span><span>${Math.round(Player.stamina)} / ${Player.maxStamina}</span></div>`;



    const invCount = Player.getInventoryCount();

    const sellValue = Player.getInventorySellValue();

    html += `<div class="summary-row"><span>${this._iconHTML('小麦', 'icon-sm', '待售') || '🌾'} 待售</span><span>${invCount}件 (${sellValue})</span></div>`;



    const tillCount = Farm.getTilledEmptyCount();

    const plantCount = Farm.grid.flat().filter(c => c && c.crop).length;

    html += `<div class="summary-row"><span>${this._iconHTML('wheat_seeds', 'icon-sm', '种子') || '🌱'} 已种</span><span>${plantCount}</span></div>`;

    html += `<div class="summary-row"><span>${this._iconHTML('farmland_dry', 'icon-sm', '空耕地') || '🟫'} 空耕地</span><span>${tillCount}</span></div>`;



    const harvestReady = Farm.getHarvestableCount();

    html += `<div class="summary-row" style="color:var(--accent);"><span>${this._iconHTML('nether_star', 'icon-sm', '可收') || '✨'} 可收</span><span>${harvestReady}</span></div>`;



    const moneyIcon = this._iconHTML('money', 'icon-sm', '金币') || '💰';

    html += `<div class="summary-total"><span>${moneyIcon}</span><span>${Player.money}</span></div>`;



    content.innerHTML = html;



    // 标题用月亮贴图（🌙 → moon），关闭按钮仍用 Confirm 图标

    const confirmHtml = this._iconHTML('confirm', 'icon-sm', '确认');

    const moonHtml = this._iconHTML('moon', 'icon-title', '月亮');

    const header = document.getElementById('summary-header');

    if (header) header.innerHTML = moonHtml ? moonHtml + ' 一天结束' : '🌙 一天结束';



    // 日结推进（作物生长 / 重置浇水 / 恢复体力 / 进入下一天）已由引擎在

    // _endDay → nextDay 中自动完成，且时间已在新的一天继续流逝。

    // 此处结算面板仅为“纯展示浮层”：几秒后自动淡出，“继续/跳过”按钮仅用于提前收起。

    const nextBtn = document.getElementById('summary-next');

    nextBtn.innerHTML = confirmHtml ? confirmHtml + ' 关闭' : '关闭';

    nextBtn.onclick = () => this.closeSummary();



    if (this._summaryTimer) clearTimeout(this._summaryTimer);

    this._summaryTimer = setTimeout(() => this.closeSummary(), 4000);



    overlay.className = 'panel-visible';

  },



  closeSummary() {

    const overlay = document.getElementById('day-summary');

    if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }

    overlay.className = 'panel-hidden';

  },





  // ===== 任务书（Advancement / 进度树）=====

  _questOpen: false,

  _questTipNode: null,     // 当前点开的提示节点（再点同一节点 / 点其它节点切换 / 关界面清除）



  openQuest() {

    if (this._questOpen) { this.closeQuest(); return; }

    this._questOpen = true;

    const ov = document.getElementById('quest-overlay');

    if (ov) {

      ov.className = 'overlay-visible';

      ov.onclick = (e) => { if (e.target === ov) this.closeQuest(); };

    }

    // 打开时强制重置：回到默认分类、丢弃上次平移/缩放，视图对准根节点。

    // 不保留上次浏览位置，也不保留上次选中的分类页签（进入界面即「归位到根节点」）。

    this._questTab = null;            // 回到默认分类（_renderQuest 按 tabs[0] 取）

    this._questPan = null;            // 丢弃上次平移与缩放，重新初始化

    this._questCenterOnRoot = true; // 视图强制对准根节点

    this._questTipNode = null;    // 关闭上次的提示节点状态

    this._renderQuest();

  },



  closeQuest() {

    if (!this._questOpen) return;

    const ov = document.getElementById('quest-overlay');

    if (ov) ov.className = 'overlay-hidden';

    const t = document.querySelector('#quest-overlay .quest-tip');

    if (t) t.classList.remove('show');

    const tt = document.getElementById('quest-tab-tip');

    if (tt) tt.classList.remove('show');

    this._questOpen = false;

    this._questTipNode = null;    // 关闭提示节点状态

    // 背包仍开着，不关（关闭任务书即回到背包）

  },



  // 领取弹窗已移除：点击节点即领取（FTB 原生交互），弹窗只显示任务/奖励信息，无领取按钮。



  _renderQuest() {

    const tree = document.getElementById('quest-tree');

    if (!tree) return;

    const panel = document.getElementById('quest-panel');

    const R = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

    tree.innerHTML = '';

    // 背景：固定贴在面板上（contain 居中），不参与拖动；

    // 拖动只移动进度节点/连线所在的 #quest-tree，背景始终不动。

    if (R['demo_background'] && panel) {

      panel.style.backgroundImage = `url(${R['demo_background']})`;

      panel.style.backgroundSize = 'contain';

      panel.style.backgroundPosition = 'center';

      panel.style.backgroundRepeat = 'no-repeat';

    }



    const SRC = (typeof DATA !== 'undefined' && DATA.QUESTS) ? DATA.QUESTS : [];

    // 完成态由 Quest 模块按真实进度判定（root 现为 manual，需点击才完成）；用副本避免污染 DATA

    const ADV = SRC.map(n => ({

      ...n,

      done: (typeof Quest !== 'undefined') ? Quest.isDone(n.id) : (n.done || false),

    }));

    // 选项卡（分类页签）：每个 tab 只显示该分类的节点（无总览页）

    const tabs = (typeof DATA !== 'undefined' && DATA.QUEST_TABS) ? DATA.QUEST_TABS : [];

    if (!this._questTab || this._questTab === 'overview') this._questTab = (tabs[0] && tabs[0].id) || 'core';

    const activeTab = this._questTab;

    const vis = ADV.filter(n => n.cat === activeTab);

    // 可见节点包围盒 + 质心：用于把当前页节点居中到面板视口（避免散在四角「一左一右一上一下」）

    if (vis.length) {

      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;

      vis.forEach(n => { mnx = Math.min(mnx, n.x); mxx = Math.max(mxx, n.x); mny = Math.min(mny, n.y); mxy = Math.max(mxy, n.y); });

      // cx/cy 用包围盒中心（不是节点坐标均值）：分布偏斜时（如 root 在最左），

      // 居中后整块节点才能落在背景框内；用均值会把左边缘节点推出框外被裁切。

      this._questBBox = { minX: mnx, maxX: mxx, minY: mny, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };

    } else {

      this._questBBox = null;

    }

    this._renderQuestTabs(tabs, activeTab);

    const byId = {};

    vis.forEach(a => { byId[a.id] = a; });

    // 教程步骤编号：按tutorial节点在列表中的顺序分配（第1步、第2步...）
    const tutorialStepMap = {};
    let stepCounter = 1;
    vis.filter(n => n.tutorial).forEach(n => { tutorialStepMap[n.id] = stepCounter++; });


    // 坐标空间固定为 760×717（与面板 176:166 一致）；框为正方形，图标居中，文字在框右侧（放不下则翻左）

    const PW = 760, PH = 717, FS = 52, ICON = 34, GAP = 8, TXT_W = 80;



    // 1) 连线层：纯代码绘制的 SVG 折线（不再用 tab 贴图），完成路径染绿

    const NS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(NS, 'svg');

    svg.setAttribute('class', 'quest-links');

    // viewBox 用 #quest-tree 的真实像素尺寸（而非固定 760×717）：节点方框按树像素定位，

    // 只有 viewBox 与树像素 1:1，直线端点才会精确落在节点中心（窗口非 760 宽时也不错位）。

    const tw = tree.clientWidth || PW, th = tree.clientHeight || PH;

    svg.setAttribute('viewBox', `0 0 ${tw} ${th}`);

    svg.setAttribute('preserveAspectRatio', 'none');

    let li = 0;

    vis.forEach(n => {

      if (!n.parent || !byId[n.parent] || n.tutorial) return;

      const p = byId[n.parent];

      if (p.cat !== n.cat) return;   // 跨分类父节点（如教程挂到核心页根「初来乍到」）不画连线，避免孤儿线

      const path = document.createElementNS(NS, 'path');

      // 直连线：父节点中心 → 子节点中心，一条斜直线（用户要求「直直的，不要弯」）

      path.setAttribute('d', `M ${p.x} ${p.y} L ${n.x} ${n.y}`);

      path.setAttribute('vector-effect', 'non-scaling-stroke');

      path.setAttribute('pathLength', '100');   // 统一虚拟长度，配合 CSS stroke-dashoffset 实现「自己画出来」动画

      path.setAttribute('class', 'q-link' + ((p.done && n.done) ? ' done' : ''));

      path.style.setProperty('--i', li++);

      svg.appendChild(path);

    });

    tree.appendChild(svg);



    // 悬停提示：默认只显示节点名，悬停节点弹出「标题 + 详细描述」（避免永久文字重叠）

    // 挂在 overlay 上，用视口坐标定位，不受 tree 缩放/面板 overflow 裁切影响

    let tip = document.querySelector('#quest-overlay .quest-tip');

    if (tip) tip.remove();

    tip = document.createElement('div');

    tip.className = 'quest-tip';

    if (R['enchantment']) tip.style.backgroundImage = `url(${R['enchantment']})`;

    const _ov = document.getElementById('quest-overlay');

    if (_ov) _ov.appendChild(tip);



    // ===== 进度树 = 有向图：入度(前置) / 出度(可解锁) =====

    // 图的边有两类：

    //   1) 树边：child.parent → child（同分类内的推进）

    //   2) 网关边：tab.prereq → 该支线的入口节点（主线网关节点解锁整条支线）

    // 支线入口节点（父节点不在本分类内）的前置一律改判为网关节点，

    // 否则悬停会显示 root 这种「看不见也点不到」的跨页父节点，反而误导。

    const allById = {};

    ADV.forEach(a => { allById[a.id] = a; });

    const tabLabel = {};

    tabs.forEach(t => { tabLabel[t.id] = t.label; });

    const gatewayOf = {};   // 支线入口节点 id → 解锁它的主线网关节点 id

    tabs.forEach(t => {

      if (!t.prereq || !allById[t.prereq]) return;

      ADV.forEach(n => {

        if (n.cat !== t.id) return;

        const p = n.parent ? allById[n.parent] : null;

        if (!p || p.cat !== n.cat) gatewayOf[n.id] = t.prereq;

      });

    });

    // 入度：直接前驱（网关边优先于树边）

    const preOf = (n) => {

      const g = gatewayOf[n.id];

      if (g) return [allById[g]];

      const p = n.parent ? allById[n.parent] : null;

      return p ? [p] : [];

    };

    // 出度：树边后继 + 由本节点作为网关解锁的支线入口

    const nextOf = (n) => ADV.filter(c => (gatewayOf[c.id] ? gatewayOf[c.id] === n.id : c.parent === n.id));

    // 完成/未完成状态图标一律用素材库贴图（confirm 绿勾 / Icon_Locked 锁），不用 emoji

    const ICO_OK = this._iconHTML('confirm', 'q-st', '已完成');

    const ICO_LOCK = this._iconHTML('Icon_Locked', 'q-st', '未完成');

    // 关联节点小标签：完成态用色区分；跨分类的额外标注所属支线名

    const chip = (m) => `<span class="q-node${m.done ? ' ok' : ''}">${m.done ? ICO_OK : ICO_LOCK}${m.title}`

      + (m.cat !== activeTab ? `<i>·${tabLabel[m.cat] || m.cat}</i>` : '') + '</span>';



    const showTip = (node) => {

      const tip = document.querySelector('#quest-overlay .quest-tip');

      if (!tip) return;

      const el = document.querySelector('#quest-tree .quest-frame[data-qid="' + node.id + '"]');

      if (!el) return;

      const r = el.getBoundingClientRect();

      const tr = node.track || {};

      // —— 目标（按完成类型组织文案；进度/成就自动完成，教程手动）——

      let goal;

      if (node.manual) {

        if (node.track && node.track.k === 'submit') {

          // 提交型：需持有并交出物品，点击节点领取（消耗物品）

          const tn = node.track.n || 1;

          const have = (typeof Quest !== 'undefined') ? Quest._itemCount(node.track.item) : 0;

          const iname = (typeof Quest !== 'undefined') ? Quest._itemName(node.track.item) : (node.track.item || '');

          if ((typeof Quest !== 'undefined') && Quest.isDone(node.id)) goal = ICO_OK + ' 已完成 · 奖励已领取';

          else {

            const pend = preOf(node).filter(p => !p.done);

            const lock = pend.length ? ICO_LOCK + ' ' : '';

            goal = lock + `提交要求：交 ${tn}×${iname}<br>已持有：<b>${have} / ${tn}</b>`;

          }

        } else {

          // 普通手动解锁成就（教程）：点击节点领取，不自动完成

          if ((typeof Quest !== 'undefined') && Quest.isDone(node.id)) goal = ICO_OK + ' 已完成 · 奖励已领取';

          else {

            const pend = preOf(node).filter(p => !p.done);

            const lock = pend.length ? ICO_LOCK + ' ' : '';

            goal = lock + (node.desc ? node.desc : '点击节点领取奖励');

          }

        }

      } else if (tr.k === 'always') {

        goal = node.done ? (ICO_OK + ' 起始任务（已完成）') : '起始任务';

      } else if (tr.k === 'ownTool') {

        const has = !!(typeof Player !== 'undefined' && Player.ownedTools && Player.ownedTools[tr.tool]);

        goal = (has ? ICO_OK + ' 已拥有 — ' : ICO_LOCK + ' 需先拥有 — ') + (node.desc || ('工具：' + tr.tool));

      } else {

        // 累计型（进度/成就）：实时进度 = min(已累计, 目标)

        const cur = (typeof Quest !== 'undefined') ? Math.min(Quest.stats[tr.k] || 0, tr.n) : 0;

        goal = `完成要求：${node.desc || ''}<br>进度：<b>${cur} / ${tr.n}</b>${node.done ? ' ' + ICO_OK + ' 已完成' : ''}`;

      }

      // —— 奖励（无则显示「无」）——

      const rewardText = this._rewardText(node.reward);

      const rewardSec = rewardText ? rewardText : '无';

      // —— 前置 / 后置（无则显示「无」）——

      const pre = preOf(node), nxt = nextOf(node);

      const preSec = pre.length ? pre.map(chip).join('') : '无';

      const nextSec = nxt.length ? nxt.map(chip).join('') : '无';

      // 教程节点：显示步骤编号 + 操作目标，目标栏改为清晰的交互提示
      let tipHtml = '';
      if (node.tutorial) {
        const stepNum = tutorialStepMap[node.id] || node.id.replace('tut', '');
        tipHtml += `<div class="quest-ttl">${node.title}</div>`;
        tipHtml += `<div class="quest-ds">${node.desc || '点击节点学习'}</div>`;
        // 教程目标栏只显示当前操作步骤，不重复 desc
        if (node.track && node.track.k === 'submit') {
          const tn = node.track.n || 1;
          const have = (typeof Quest !== 'undefined') ? Quest._itemCount(node.track.item) : 0;
          const iname = (typeof Quest !== 'undefined') ? Quest._itemName(node.track.item) : (node.track.item || '');
          goal = `提交：${tn} × ${iname}<br>已持有：<b>${have} / ${tn}</b>`;
        } else {
          goal = '点击节点领取奖励';
        }
        tipHtml += `<div class="quest-gr"><b>目标</b>${goal}</div>`;
      } else {
        tipHtml = `<div class="quest-gr"><b>目标</b>${goal}</div>`;
      }

      tip.innerHTML = tipHtml
        + `<div class="quest-gr"><b>奖励</b>${rewardSec}</div>`
        + `<div class="quest-gr"><b>前置</b>${preSec}</div>`
        + `<div class="quest-gr"><b>后置</b>${nextSec}</div>`;

      tip.classList.add('show');

      const tw = tip.offsetWidth, th = tip.offsetHeight;

      let left = r.right + 10, top = r.top + r.height / 2 - th / 2;

      if (left + tw > window.innerWidth - 8) left = r.left - 10 - tw;

      if (left < 8) left = 8;

      if (top < 8) top = 8;

      if (top + th > window.innerHeight - 8) top = window.innerHeight - 8 - th;

      tip.style.left = left + 'px'; tip.style.top = top + 'px';

    };

    // 提示由悬停节点展开（mouseenter → showTip）；移开节点收起（mouseleave → hideTip）；点击节点额外触发领取奖励

    const hideTip = () => { tip.classList.remove('show'); this._questTipNode = null; };



    // 2) 任务节点：正方形框(obtained/unobtained 区分完成) + 居中图标 + 文字

    vis.forEach((n, i) => {

      const frame = document.createElement('div');

      frame.className = 'quest-frame';

      frame.style.left = (n.x - FS / 2) + 'px';

      frame.style.top = (n.y - FS / 2) + 'px';

      frame.style.width = FS + 'px';

      frame.style.height = FS + 'px';

      const frameKey = n.challenge

        ? 'Advancement_Challenge_Frame_' + (n.done ? 'Obtained' : 'Unobtained')

        : (n.done ? 'advancement_task_frame_obtained' : 'advancement_task_frame_unobtained');

      frame.style.backgroundImage = `url(${R[frameKey]})`;

      tree.appendChild(frame);



      const icSize = (n.id === 'root') ? 44 : ICON;

      const ic = document.createElement('img');

      ic.className = 'quest-ic';

      ic.style.width = icSize + 'px';

      ic.style.height = icSize + 'px';

      ic.style.left = (n.x - icSize / 2) + 'px';

      ic.style.top = (n.y - icSize / 2) + 'px';

      // 完成态显示 confirm（绿色对勾），未完成显示原图标

      ic.src = R[n.done ? 'confirm' : n.icon] || R[n.icon] || '';

      tree.appendChild(ic);



      const txt = document.createElement('div');

      txt.className = 'quest-txt';

      // 文字放在框正下方居中：避免同排节点左右标签互相重叠（side 布局在 160px 间距下必重叠）

      txt.style.width = TXT_W + 'px';

      txt.style.left = (n.x - TXT_W / 2) + 'px';

      txt.style.top = (n.y + FS / 2 + 6) + 'px';

      txt.style.textAlign = 'center';

      txt.innerHTML = `<div class="quest-ttl">${n.title}</div>`;

      tree.appendChild(txt);



      frame.dataset.qid = n.id;

      frame.style.cursor = 'pointer';

      // 悬停节点 = 弹窗出现（任务/前置/奖励预览）；点击节点 = 领取奖励（FTB 原生：悬停看、点击领，无领取按钮）

      frame.addEventListener('mouseenter', () => showTip(n));   // 悬停即弹

      frame.addEventListener('mouseleave', () => hideTip());     // 移开即收

      frame.addEventListener('pointerdown', (e) => e.stopPropagation()); // 防止面板拖拽 setPointerCapture 吞掉 click

      frame.addEventListener('click', (e) => {

        e.stopPropagation();

        if ((typeof Quest !== 'undefined') && n.manual && !Quest.isDone(n.id) && Quest._manualClaimable(n)) {

          const result = Quest.claim(n.id);

          if (result) {

            this._updateHUD(); // 刷新 HUD（时间/体力）；金币奖励由下面的 openInventory 重渲染背包展示

            // 无条件打开背包，确保用户看到奖励

            if (typeof UI !== 'undefined' && UI.openInventory) {

              UI.openInventory();

              // 强制刷新背包 DOM

              if (UI.renderInventory) UI.renderInventory();

            }

          }

        }

        showTip(n);            // 刷新弹窗（已领则显示「已完成 · 奖励已领取」）

        this._renderQuest();  // 完整重绘节点：边框+图标同步更新为 done 态

      });

      // 进场 stagger：节点三件套(框/图标/文字)一起按序号 --i 错峰入场；动画结束移除 .qenter，交还 hover transform 控制

      [frame, ic, txt].forEach(el => {

        el.classList.add('qenter');

        el.style.setProperty('--i', i);

        el.addEventListener('animationend', () => el.classList.remove('qenter'), { once: true });

      });

    });



    // 可见内容「真实包围盒」：含 方框(frame) + 图标(ic) + 文字标签(txt) 的全部渲染范围，

    // 不止节点圆心。文字标签在框正下方(n.y+FS/2+6)，方框比圆心大 FS/2；只按圆心夹取会让

    // 标签/边框在拖到极值时漏进上下暗边带（即「超出背景」）。用真实包围盒居中+夹取，杜绝漏出。

    {

      const els = tree.querySelectorAll('.quest-frame, .quest-ic, .quest-txt');

      if (els.length) {

        let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;

        els.forEach(el => {

          const l = el.offsetLeft, t = el.offsetTop, r = l + el.offsetWidth, b = t + el.offsetHeight;

          if (l < mnx) mnx = l; if (r > mxx) mxx = r;

          if (t < mny) mny = t; if (b > mxy) mxy = b;

        });

        this._questBBox = { minX: mnx, maxX: mxx, minY: mny, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };

      } else {

        this._questBBox = null;

      }

    }



    // 拖拽平移：面板为视口，内部树放大(scale)后超出窗口，按住拖动浏览（仿 Minecraft 进度树）

    if (!this._questPan) this._questPan = { tx: 0, ty: 0, scale: 1.2 };

    const P = this._questPan;

    if (panel) {

      // 背景可视区：demo_background 以 contain 贴在面板上（宽图按宽适配、居中），

      // 面板上下会留出暗边带。节点/连线须留在「背景可视区」内，不能拖进上下暗边带（否则显得「超出背景」）。

      const bgRect = () => {

        const vw = panel.clientWidth, vh = panel.clientHeight;

        const Rr = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

        const url = Rr['demo_background'];

        if (!url) return { x: 0, y: 0, w: vw, h: vh };

        if (!this._questBgImg) {

          const im = new Image();

          im.onload = () => { this._questBgRatio = im.naturalHeight / im.naturalWidth; };

          im.src = url; this._questBgImg = im;

        }

        const ratio = this._questBgRatio || (1024 / 1528); // 兜底：固定素材 1528×1024

        const PAD = 8; // 留出安全边距：内容夹取到「比背景再内缩 8px」的带内，吸收亚像素取整，确保绝不漏进暗边带

        let w, h;

        if (ratio <= vh / vw) { w = vw; h = vw * ratio; } // 宽图：按宽适配

        else { h = vh; w = vh / ratio; }                  // 高图：按高适配

        const bx = (vw - w) / 2, by = (vh - h) / 2;

        return { x: bx + PAD, y: by + PAD, w: w - 2 * PAD, h: h - 2 * PAD };

      };

      // 裁切容器：把进度树限制在「背景可视区」矩形（与 demo_background 的 contain 区域一致）内。

      // 目的：让树可以比视口更大、用拖拽平移浏览（参考我的世界进度树——树大于屏幕、拖拽漫游），

      // 同时绝不拖进上下/左右暗边带（被这里的 overflow:hidden 挡在背景图范围内，不会溢出到暗边）。

      // 背景图本身仍是 contain（未改用户要求的显示方式），只是给树加了一层「按背景区域裁切」的窗口。

      let clip = document.getElementById('quest-tree-clip');

      if (!clip) {

        clip = document.createElement('div');

        clip.id = 'quest-tree-clip';

        panel.insertBefore(clip, tree);

        clip.appendChild(tree); // tree 移入裁切容器（之后仍按 id 取到，不必重建）

      }

      const _band = bgRect();

      clip.style.position = 'absolute';

      clip.style.left = _band.x + 'px';

      clip.style.top = _band.y + 'px';

      clip.style.width = _band.w + 'px';

      clip.style.height = _band.h + 'px';

      clip.style.overflow = 'hidden';

      clip.style.pointerEvents = 'none'; // 拖拽事件照常冒泡给 panel 处理

      // tree 原点对齐面板(0,0)：左/上偏移 -_band，使节点坐标(n.x,n.y)仍对应面板像素（平移/夹取数学不变）

      tree.style.position = 'absolute';

      tree.style.left = (-_band.x) + 'px';

      tree.style.top = (-_band.y) + 'px';

      tree.style.right = 'auto';

      tree.style.bottom = 'auto';

      tree.style.width = panel.clientWidth + 'px';

      tree.style.height = panel.clientHeight + 'px';

      // 自适应缩放：用户要求「缩小到约一半节点可见、其余拖拽浏览」（参考我的世界进度树）。

      // 节点间距已减半(DX 150→75)，cw 同步减半；此处再乘 0.5 并下调上限到 1.25，

      // 使整棵进度树缩到约可见一半、节点仍清晰，剩余靠拖拽漫游。下限 0.5 防缩成小点。

      if (this._questBBox) {

        const cw = (this._questBBox.maxX - this._questBBox.minX) || 1;

        const ch = (this._questBBox.maxY - this._questBBox.minY) || 1;

        P.scale = Math.min(1.25, Math.max(0.5, _band.w / cw * 0.5, _band.h / ch * 0.5));

      }

      const clampPan = () => {

        const vw = panel.clientWidth, vh = panel.clientHeight;

        const bb = this._questBBox;

        if (bb) {

          // 夹取但不强制居中：让节点整体留在「背景可视区」内即可（暗边带不参与夹取）。

          // 这样拖拽平移不会被「居中」瞬间复位，又不会把节点拖进上下的暗边带（超出背景）。

          const band = bgRect();

          const txMin = band.x - bb.minX * P.scale, txMax = band.x + band.w - bb.maxX * P.scale;

          const tyMin = band.y - bb.minY * P.scale, tyMax = band.y + band.h - bb.maxY * P.scale;

          // 内容 ≤ 背景：txMin<txMax，夹在 [txMin,txMax]（不越出背景可视区）；

          // 内容 > 背景（我的世界风格：树比视口大）：txMin>txMax，取 [txMax,txMin] 让树始终覆盖背景、可拖拽平移。

          // 两情况统一用 min/max 夹取，拖拽位移绝不会被「居中」复位（修复内容>背景时拖拽失效）。

          const txLo = Math.min(txMin, txMax), txHi = Math.max(txMin, txMax);

          const tyLo = Math.min(tyMin, tyMax), tyHi = Math.max(tyMin, tyMax);

          P.tx = Math.min(txHi, Math.max(txLo, P.tx));

          P.ty = Math.min(tyHi, Math.max(tyLo, P.ty));

        } else {

          const minX = vw - PW * P.scale, minY = vh - PH * P.scale;

          P.tx = Math.min(0, Math.max(minX, P.tx));

          P.ty = Math.min(0, Math.max(minY, P.ty));

        }

      };

      const apply = () => { tree.style.transform = `translate(${P.tx}px,${P.ty}px) scale(${P.scale})`; };

      // 打开时（或切换分类时）把视图对准**根节点**——强制重置到任务树起点；

      // 若当前分类页不含根节点（根只在 core 页），退回对准「包围盒中心」。

      // 对准「背景可视区」中心（不是面板中心）：节点不偏到上下暗边带。

      if ((this._questCenterOnRoot || !P.centered) && this._questBBox) {

        const band = bgRect();

        const root = vis.find(n => n.id === 'root');

        const fx = root ? root.x : this._questBBox.cx;

        const fy = root ? root.y : this._questBBox.cy;

        P.tx = (band.x + band.w / 2) - fx * P.scale;

        P.ty = (band.y + band.h / 2) - fy * P.scale;

        P.centered = true;

        this._questCenterOnRoot = false;

      }

      if (!panel.dataset.panBound) {

        panel.dataset.panBound = '1';

        let sx = 0, sy = 0, stx = 0, sty = 0, dragging = false;

        panel.addEventListener('pointerdown', (e) => {

          if (e.button !== 0) return;

          dragging = true; sx = e.clientX; sy = e.clientY; stx = P.tx; sty = P.ty;

          panel.classList.add('grabbing');

          try { panel.setPointerCapture(e.pointerId); } catch (_) {}

          e.preventDefault();

        });

        panel.addEventListener('pointermove', (e) => {

          if (!dragging) return;

          P.tx = stx + (e.clientX - sx);

          P.ty = sty + (e.clientY - sy);

          clampPan(); apply();

        });

        const end = (e) => {

          if (!dragging) return;

          dragging = false; panel.classList.remove('grabbing');

          try { panel.releasePointerCapture(e.pointerId); } catch (_) {}

        };

        panel.addEventListener('pointerup', end);

        panel.addEventListener('pointercancel', end);

      }

      clampPan(); apply();

    }

  },



  // 渲染顶部选项卡条：用 advancement_tab_* 小方格贴图作底图，选中态用 *_Selected；

  // 依在数组中的次序拼成 Above_Left / Above_Middle×(N-2) / Above_Right 的小方格条。

  _renderQuestTabs(tabs, activeTab) {

    if (!tabs || !tabs.length) return;

    const R = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

    let bar = document.getElementById('quest-tabs');

    if (!bar) {

      bar = document.createElement('div');

      bar.id = 'quest-tabs';

      const wrap = document.getElementById('quest-frame-wrap');

      if (wrap) wrap.appendChild(bar);

    }

    bar.innerHTML = '';

    // 页签悬停弹窗：复用 Enchantment 弹窗样式，仅悬停时显示该支线的「前置/解锁条件」这类详情。

    // 短名仍常驻在页签上；弹窗只补"玩家该完成什么才能解锁"这种信息（不重复短名）。

    let tabTip = document.getElementById('quest-tab-tip');

    if (!tabTip) {

      tabTip = document.createElement('div');

      tabTip.id = 'quest-tab-tip';

      tabTip.className = 'quest-tab-tip';

      if (R['enchantment']) tabTip.style.backgroundImage = `url(${R['enchantment']})`;

      const _ov = document.getElementById('quest-overlay');

      if (_ov) _ov.appendChild(tabTip);

    }

    const tabTipHTML = (t) => {

      if (t.prereq && typeof Quest !== 'undefined' && !Quest.isDone(t.prereq)) {

        const pn = (typeof DATA !== 'undefined') ? DATA.QUESTS.find(q => q.id === t.prereq) : null;

        const pt = pn ? pn.title : t.prereq;

        return `<div class="quest-ttl">${t.label}</div><div class="quest-ds">需完成【${pt}】解锁</div>`;

      }

      const nodes = (typeof DATA !== 'undefined') ? DATA.QUESTS.filter(n => n.cat === t.id) : [];

      const done = nodes.filter(n => typeof Quest !== 'undefined' && Quest.isDone(n.id)).length;

      return `<div class="quest-ttl">${t.label}</div><div class="quest-ds">完成进度 ${done} / ${nodes.length}</div>`;

    };

    const showTabTip = (t, el) => {

      const r = el.getBoundingClientRect();

      tabTip.innerHTML = tabTipHTML(t);

      tabTip.classList.add('show');

      const tw = tabTip.offsetWidth, th = tabTip.offsetHeight;

      let left = r.left + r.width / 2 - tw / 2;

      let top = r.bottom + 8;

      if (left < 8) left = 8;

      if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw;

      if (top + th > window.innerHeight - 8) top = r.top - 8 - th; // 下方放不下则翻到上方

      if (top < 8) top = 8;

      tabTip.style.left = left + 'px';

      tabTip.style.top = top + 'px';

    };

    const hideTabTip = () => tabTip.classList.remove('show');

    tabs.forEach(t => {

      const locked = !!(t.prereq && typeof Quest !== 'undefined' && !Quest.isDone(t.prereq));

      const btn = document.createElement('div');

      btn.className = 'quest-tab' + (t.id === activeTab ? ' active' : '') + (locked ? ' locked' : '');

      const spr = R[t.id === activeTab ? t.selected : t.tab];

      if (spr) btn.style.backgroundImage = `url(${spr})`;

      // 选项卡上的代表物图标（如 种植=小麦种子、采集=原木、工具=木斧头）

      // 仅核心玩法（新换的耕地+锄头图）放大显示，其余保持原尺寸

      const icCls = (t.icon && R[t.icon]) ? (t.id === 'core' ? 'quest-tab-ic quest-tab-ic--core' : 'quest-tab-ic') : '';

      const ic = icCls ? `<img class="${icCls}" src="${R[t.icon]}">` : '';

      // 未解锁的支线选项卡：叠加锁图标（Icon_Locked），明确"锁住、暂不可进"。

      // 详情（解锁条件/进度）放进悬停弹窗，不常驻显示；页签本身只放图标/锁/短名。

      const lock = (locked && R['Icon_Locked']) ? `<img class="quest-tab-lock" src="${R['Icon_Locked']}">` : '';

      // 分类标签文字常驻显示（名字短，直接显示即可）；解锁条件等详情只在悬停弹窗里

      btn.innerHTML = `${ic}${lock}<span class="quest-tab-lbl">${t.label}</span>`;

      // 阻止 tab 上的指针事件冒泡到 panel，避免触发平移拖拽

      btn.addEventListener('pointerdown', e => e.stopPropagation());

      btn.addEventListener('mouseenter', () => showTabTip(t, btn));

      btn.addEventListener('mouseleave', hideTabTip);

      btn.addEventListener('click', () => {

        if (locked) {

          // 未解锁：抖动即可（解锁条件在悬停弹窗里告知玩家，不常驻显示）

          btn.classList.remove('shake');

          void btn.offsetWidth;

          btn.classList.add('shake');

          return;

        }

        if (this._questTab === t.id) return;

        this._questTab = t.id;

        this._questCenterOnRoot = true; // 切换分类后把视图对准该组节点（根不在该页则退回包围盒中心）

        this._renderQuest();

      });

      bar.appendChild(btn);

    });

  },



  /**

   * MC 风格成就弹窗：右上角滑入，3.5 秒后自动收回。

   * @param {string} title  成就标题

   * @param {string} [iconKey]  ASSETS.registry 中的贴图键（默认 'nether_star'）

   * @param {number} [duration] 显示时长（ms），默认 3500

   */

  showAchievement(title, iconKey = 'nether_star', duration = 3500) {

    const el = document.getElementById('achievement-toast');

    if (!el) return;

    const iconSrc = this._assetURL(iconKey);

    const frameSrc = this._assetURL('blank_row_frame');

    el.innerHTML = `<div class="achievement-frame">` +

      (frameSrc ? `<img class="achievement-bg" src="${frameSrc}" alt="">` : '') +

      (iconSrc ? `<img class="achievement-icon" src="${iconSrc}" alt="${title}">` : '') +

      `<div class="achievement-text">` +

      `<span class="achievement-label">成就达成</span>` +

      `<span class="achievement-title">${title}</span>` +

      `</div></div>`;

    el.className = 'toast-visible';

    if (this._achievementTimeout) clearTimeout(this._achievementTimeout);

    this._achievementTimeout = setTimeout(() => {

      el.className = 'toast-hidden';

    }, duration);

  },



};



// 暴露到全局，供 quest.js / inventory.js 引用

if (typeof window !== 'undefined') window.UI = UI;

if (typeof globalThis !== 'undefined') globalThis.UI = UI;

