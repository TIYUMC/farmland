/**
 * farm.js — 农场管理系统
 * 职责：地块网格、耕地三态(草方块→泥土→耕地)、播种、浇水、生长、收获、野草演化。
 *
 * ── 结构导航 ──
 *   [数据]    状态字段：grid / grass / bare / dirt + 草态机参数
 *   ① 初始化  init
 *   ② 地面状态 clearGrass / till / toDirt（草→泥土→耕地 三态）
 *   ③ 种植作物 plant / water / harvest / _isGrown
 *   ④ 每日演化 dailyGrow / resetWater / dailyGrassGrow
 *   ⑤ 查询统计 getHarvestableCount / getTilledEmptyCount
 *   [工具]    _inBounds / _forEachCell
 */
/**
 * 遍历 (r,c) 周围 3x3（8 邻格，跳过自身）通用 helper：越界跳过，对任一邻格调用 pred(nr,nc)，
 * 任一为真即返回 true（遇首个匹配即早返）。farm `_neighborSome` 与 treefarm `_hasNeighborTree` 共用同一骨架，消除重复。
 * pred 内若引用 host/闭包变量，由调用点用箭头回调自行保 `this`/闭包（与原文一致）。
 */
function hasAnyNeighbor(r, c, host, pred) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= host.ROWS || nc < 0 || nc >= host.COLS) continue;
      if (pred(nr, nc)) return true;
    }
  }
  return false;
}
const Farm = {
  COLS: DATA.FARM.COLS,
  ROWS: DATA.FARM.ROWS,

  // grid[row][col] = { tilled, crop, waterCount, grownDays } | null
  grid: [],

  // grass[row][col] = 草状态：0=无草(光秃草地), 1=绿草, 2=黄草(枯死退化态)。
  // 仅对空地(草方块)有意义；耕地格由 farmland 贴图表现，不读此值。
  // 初始在 init() 按 grassInitDensity 预置为绿草(1)；之后每天由 dailyGrassGrow() 演化：
  //   无草(0)→绿草(1) 基础率 = 1/一季天数，再乘 季节乘数(grassGrowChanceBySeason) 与 邻居因子(grassGrowNeighborMult/Alone)；绿草(1)→黄草(2) 按周围邻居的退化概率；
  //   黄草(2)→草方块(0,非土) 按 grassDecayToBareBySeason × 邻居(反转) / 秋冬无视；次日草方块(0) 再按同表退化成裸土(土色，bare=true)。
  //   黄草(2)→绿草(1) 枯草重生：仅主农场(grassRewindBySeason 有值)，按 季节基础 + 邻居因数(加法)；同格若同时掷出枯萎与重生→保持不变（见 grassStep）。
  //   即：草必须先在草方块上长成绿草(1)→黄草(2)→草方块(0)→土(裸土)→(次日)草方块→绿草，逐态退化、黄草不能跳过草方块直接变土，回到裸地循环。
  grass: [],

  // bare[row][col] = 该草方块是否「已退化为裸土(土色)」。仅当草(1/2)退化成 0 时才置 true；
  // 从未长草的普通草方块地面(false)即使到秋冬也不显示裸土、保持草方块底纹。即：只有草方块退化才转土色。
  bare: [],

  // dirt[row][col] = 该地面是否「已被锄成泥土(中间态)」。普通草方块/裸土 经一次锄头→泥土(dirt=true)，
  // 再锄一次才成耕地(farmland)。泥土态不可直接耕地(必须先到泥土)，但长期荒废会按 dirtRewildChanceBySeason
  // 每日概率「回春」变回草方块(dirt=false, grass 本就为 0)，重新野化成草地。仅对 grid=null 的地面有意义。
  dirt: [],

  // flowers[row][col] = 花朵状态：0=无花，1..N=花种编号（编号 = DATA.FLOWERS 下标+1，见 data.js）。
  //   当前花种：1=Allium 2=Azure_Bluet 3=Cornflower 4=Dandelion 5=Lily_Of_The_Valley
  // 演化规则与草态机同构（由 flowerStep 每天驱动，详见底部函数注释）：
  //   - 出现条件：仅在「无花+空地(grass=0, dirt=false, bare=false, grid=null)」上可能生成
  //   - 春生夏枯：长出仅在春天(season=0)；枯萎率 = grassDecayBySeason[季]（夏1%/秋60%/冬95%）
  //   - 簇生：邻居(8 邻)有花时，长出率 × flowerClusterMult；无花邻时 × 1
  //   - 花种选取：靠着花长出来的继承邻居品种（成片同色）；孤立长出的随机取一种
  //   - 与草互斥：花朵格子 grass=0（视觉上花朵替换草方块底纹），cell 仍非耕/非土/非裸土
  //   - 锄头交互：见 ui.js _handleHoeClick「锄花」分支，调 Farm.clearFlower 清除
  flowers: [],


  // === 野草生长/退化参数（集中可调）===
  // 长草率按「季节天数摊薄」：基础率 = 1 / DAYS_PER_SEASON（一季 x 天，每天长 1/x 进度），再乘以下两项。
  grassGrowChanceBySeason: [3, 4, 2, 1], // 「季节生长乘数」：基础率再乘它；春3 / 夏4 / 秋2 / 冬1（夏长得最快、冬最慢）。实际每天生长率 = (1/DAYS_PER_SEASON)×本数组[季节]×邻居因子
  grassGrowNeighborMult: 0.5,  // 无草→绿草：周围「有草」时的生长率乘数（用户定：0.5，比孤立慢）
  grassGrowAloneMult: 1.5,    // 无草→绿草：周围「无草(孤立裸地)」时的生长率乘数（用户定：1.5，比贴草快）
  grassDecayBySeason: [0, 0.01, 0.60, 0.95], // 「绿草→黄草(枯死)」退化基础概率，随季节：春0%(春天绿草不枯) / 夏1% / 秋60% / 冬95%（下标=Engine.season）；实际概率 = 本数组[季] × 邻居系数(grassDecayNear/Alone，乘法)，见 grassStep 绿→黄 分支。（注：本次未改这步，仍乘法）
  grassDecayToBareBySeason: [0.05, 0.40, 0.80, 1.00], // 「黄草→草方块」退化基础概率（黄草退化成草方块、非土的那一步；草方块→土 是另一步），随季节：春5% / 夏40% / 秋80% / 冬100%（下标=Engine.season）。★本次改为「加法」邻居因数：实际概率 = 本数组[季] + 邻居加成(孤立+0.10 / 靠草丛+0.05)，见 grassStep 黄→草方块 分支。草方块→土 仍用原乘法(grassDecayNear/Alone 反转)。
  // 绿→黄 乘法邻居系数（相邻8格有任意草态(绿/黄)算有草邻居）：
  grassDecayNear: 0.10,   // 绿→黄 中：有草邻居 ×0.10（近草更耐活、不易枯）
  grassDecayAlone: 0.30,  // 绿→黄 中：无草邻居 ×0.30（孤立更易枯）
  grassRewindBySeason: [0.10, 0.50, 0, 0], // 「黄草(枯草)→绿草」重生基础概率，随季节：春10% / 夏50% / 秋0 / 冬0（下标=Engine.season，本次把夏天基础 0.30→0.50）。实际概率 = 本数组[季] + 邻居因数(有草邻+10% / 孤立+5%，加法非乘法；越靠近草丛越易重生、越孤立越不易)；仅主农场启用(树场不设此键→undefined)。同格若同时掷出枯萎与重生→保持不变。
  grassInitDensity: 0.12,       // 新游戏初始草覆盖比例(0~1)，预置为绿草(1)；调低→开局稀疏，草随天数从少到多自然长满
  dirtRewildChanceBySeason: [0.13, 0.24, 0.015, 0.006], // 「泥土→草方块」回春概率：锄过却没耕的泥土，长期荒废后按此每日概率解除 dirt、变回草方块(重新进入草生命周期、会再长草)；春13%/夏24%(用户2026-08-05:+10pp/+20pp)/秋1.5%/冬0.6%。调高→泥土更快野化。
  // === 花朵参数（与草参数同表，便于集中调）===
  // 花的长出率不再自带绝对概率，而是直接借用「草方块→绿草」那一步的生长率（用户定：
  // "花的生长按绿草的生长率算，草方块长出绿草的"），公式见 flowerStep：
  //   每天长出率 = (1/DAYS_PER_SEASON) × 季节乘数(grassGrowChanceBySeason，季内插值) × 0.5
  //                × flowerSpawnBySeason[季] × (有花邻居 ? flowerClusterMult : 1) × flowerSpawnMult
  //   春天实测：孤立 10%/天、成簇 30%/天（对比旧值 0.3%/0.9%，快约 33 倍）
  flowerSpawnBySeason: [1, 0, 0, 0],     // 季节闸门（★不是绝对概率，是乘数）：春=1 开、夏秋冬=0 关（用户定「只有春天有花」）
  flowerInitDensity: 0.02,               // 新游戏初始花朵覆盖比例(0~1)，品种在 DATA.FLOWERS 里随机取；比草少（花是点缀，新游戏开局稀疏）
  flowerClusterMult: 3.0,                // 邻居有花时，长出率 × 此系数（成簇而非均匀；用户定："邻居=别的花"）
  flowerMaxDensity: 0.15,                // 花朵密度上限：花数 ÷「可长花格子(空草方块)+已有花」达此比例后，当天不再生成新花（用户觉花太多→由 0.30 乘 1/2 降到 0.15，约半数花朵）。仅限制生成，枯萎照常
  flowerSpawnMult: 0.5,                  // 全局整体缩放（用户定"花太多"→ 乘 1/2；簇生/孤立一起减半）。改这里即整体调多/调少，不动其它机制
  // 「耕地→自然退化的土」休耕阈值 = 整整一年(4 季 × 15 天 = 60 天)。已耕地(grid≠null)若连续这么多天无作物
  // (crop===null)，才退化为裸土(bare=true)。写成 DATA 表达式，改季节天数时自动跟随「一年」的语义。
  // 退化后的裸土用锄头点一次即可直接复耕成耕地（不经泥土中间态）。调小→耕地更快荒废。
  fallowDegradeDays: DATA.DAYS_PER_SEASON * DATA.SEASONS_PER_YEAR,

  // ─────────────────────────────────────────────
  // ① 初始化
  // ─────────────────────────────────────────────
  /** 初始化空农场 */
  init() {
    this.grid = [];
    this.grass = [];
    this.bare = [];
    this.dirt = [];
    this.flowers = [];
    for (let r = 0; r < this.ROWS; r++) {
      this.grid[r] = [];
      this.grass[r] = [];
      this.bare[r] = [];
      this.dirt[r] = [];
      this.flowers[r] = [];
      for (let c = 0; c < this.COLS; c++) {
        this.grid[r][c] = null; // 荒地
        this.bare[r][c] = false; // 初始均未退化成裸土
        this.dirt[r][c] = false; // 初始均未锄成泥土
        // 初始只预置一小部分短草(grassInitDensity=0.12)，使新游戏是稀疏草地；
        // 剩下的空地由 dailyGrassGrow 按 (1/一季天数)×季节乘数×邻居因子 逐日蔓延长出（见下）。
        this.grass[r][c] = Math.random() < this.grassInitDensity ? 1 : 0;
        // 花朵初始预置(0.02 密度，比草少)；品种随机；与草互斥——花格子 grass=0，视觉替换
        this.flowers[r][c] = Math.random() < this.flowerInitDensity ? this._randomFlowerSpecies() : 0;
        if (this.flowers[r][c] > 0) this.grass[r][c] = 0;
      }
    }
    // 预跑到稳态：新游戏开局草场直接是「长满后」的稳态分布，而非稀疏等待逐年蔓延长出（约需 3 年）。
    this._warmupGrassToSteady();
  },

  /** 预跑草演化至稳态：先跑若干完整年让草态机 grassStep 收敛到全年循环的稳态，
   *  再从收敛后的日历位置逐日推进到「游戏开场」的 (Engine.season, Engine.day)，
   *  使草场状态与开场季节一致（避免「草像冬天、日历是春天」的错位）。
   *  这样开局草场就是「长满后」的循环稳态，不用等几年才长满。 */
  _warmupGrassToSteady() { warmupGrassToSteady(this); },

  // ─────────────────────────────────────────────
  // ② 地面状态（草→泥土→耕地 三态）
  // ─────────────────────────────────────────────
  /** 除草：把有草(绿/黄)的地面清成「普通草方块」(grass=0, 非裸土)。无草时返回 'no_grass'。 */
  /** 越界检查：越界返回 'out_of_bounds'，否则 null（clearGrass/till/toDirt/plant/water 共用，消除重复的 !_inBounds 守卫） */
  _outOfBounds(row, col) {
    return this._inBounds(row, col) ? null : 'out_of_bounds';
  },

  clearGrass(row, col) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    const g = this._grassState(row, col);
    if (!this._isGrassState(g)) return 'no_grass';
    this.grass[row][col] = 0;
    if (this.bare[row]) this.bare[row][col] = false; // 变回普通草方块（非裸土），之后才能锄地
    return 'ok';
  },

  /** 锄花：清除该格花朵。无花时返回 'no_flower'，成功 'ok'，越界 'out_of_bounds'。
   *  与 clearGrass 同步签名（_outOfBounds / state / state-check），UI「锄花」分支调用。 */
  clearFlower(row, col) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    const f = this._flowerState(row, col);
    if (!this._isFlowerState(f)) return 'no_flower';
    this.flowers[row][col] = 0;
    return 'ok';
  },
  /** 读取某格花朵状态：0=无花, 1..N=花种编号（见 DATA.FLOWERS）。与 _grassState 同构。 */
  _flowerState(row, col) {
    return (this.flowers[row] && this.flowers[row][col]) || 0;
  },
  /** 花朵状态是否有效（>0）。与 _isGrassState 同构。 */
  _isFlowerState(f) { return f > 0; },
  /** 可用花种数量 = DATA.FLOWERS 长度（DATA 缺失时兜底 1，保证只出 Allium 而不是崩）。 */
  _flowerSpeciesCount() {
    const list = (typeof DATA !== 'undefined' && DATA.FLOWERS) ? DATA.FLOWERS : null;
    return (list && list.length) ? list.length : 1;
  },
  /** 随机取一个花种编号（1..N）。孤立长出的花用它；靠着花长的继承邻居品种。 */
  _randomFlowerSpecies() {
    return 1 + Math.floor(Math.random() * this._flowerSpeciesCount());
  },

  /** 耕地：
   *  - 有草(绿/黄)的地面：必须先 clearGrass 除草。
   *  - 普通草方块：必须先 toDirt 锄成泥土(dirt=true) 才能耕（草→泥土→耕地 三态）。
   *  - 自然退化的裸土(bare=true)：本来就是裸露的土，锄头点【一次】直接成耕地，不再走泥土中间态。 */
  till(row, col) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    if (this._isTilled(row, col)) return 'already_tilled';
    const g = this._grassState(row, col);
    if (this._isGrassState(g)) return 'has_grass';
    const isBare = !!(this.bare[row] && this.bare[row][col]);
    if (!this.dirt[row][col] && !isBare) return 'need_dirt'; // 草方块必须先锄成泥土(dirt=true)才能耕地
    this.dirt[row][col] = true; // 退化土一步到位时也补上 dirt 标记，保持状态一致
    this.grid[row][col] = { tilled: true, crop: null, watered: false, grownDays: 0, fallowDays: 0 };
    this.bare[row][col] = false; // 清除退化土标记（退化土复耕后不再是裸土）
    if (typeof Quest !== 'undefined') Quest.trigger('till'); // 任务书：开垦者
    return 'ok';
  },

  /** 锄成泥土：【普通草方块】经一次锄头变为「泥土」中间态(dirt=true)，再锄一次才成耕地。
   *  自然退化的裸土(bare=true)不走这里——它由 till() 一锄直接成耕地。
   *  有草(1/2)的格子必须先 clearGrass；已是泥土/已耕地则返回对应错误码。 */
  toDirt(row, col) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    if (this._isTilled(row, col)) return 'already_tilled';
    const g = this._grassState(row, col);
    if (this._isGrassState(g)) return 'has_grass';
    if (this.dirt[row][col]) return 'already_dirt';
    this.dirt[row][col] = true;
    return 'ok';
  },

  // ─────────────────────────────────────────────
  // ③ 种植与作物
  // ─────────────────────────────────────────────
  /** 播种 */
  plant(row, col, cropId) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    const cell = this.grid[row][col];
    if (!cell) return 'not_tilled';
    if (cell.crop) return 'already_planted';
    const cropDef = DATA.CROPS[cropId];
    if (!cropDef) return 'invalid_crop';

    cell.crop = cropId;
    // B3：不再清空 watered，保留播种前已做的预浇水（空耕地可先浇水再种）
    cell.grownDays = 0;
    cell.regrowCount = 0;
    if (typeof Quest !== 'undefined') Quest.trigger('plant'); // 任务书：播种者
    return 'ok';
  },

  /** 浇水（一格） */
  water(row, col) {
    const _ob = this._outOfBounds(row, col); if (_ob) return _ob;
    const cell = this.grid[row][col];
    if (!cell || !cell.tilled) return 'no_tilled'; // B3：已耕地即可浇（含空耕地预浇水），不要求已有作物
    if (cell.watered) return 'already_watered';
    cell.watered = true;
    return 'ok';
  },

  // ─────────────────────────────────────────────
  // ④ 每日演化
  // ─────────────────────────────────────────────
  /** 每日增长：遍历所有已种植格子，没浇水的生长不加 */
  dailyGrow() {
    let grownCount = 0;
    this._forEachCell((cell, r, c) => {
      if (!cell) return;
      if (!cell.crop) {
        // 休耕（空耕地）退化：连续无作物满 fallowDegradeDays 天，退化为「自然退化的土」（裸土）
        cell.fallowDays = (cell.fallowDays || 0) + 1;
        if (cell.fallowDays >= this.fallowDegradeDays) {
          this.grid[r][c] = null;
          this.dirt[r][c] = false;
          this.bare[r][c] = true;   // 退化为裸土：之后需锄两次(泥土→耕地)才能复耕
          this.grass[r][c] = 0;
        }
        return;
      }

      const cropDef = DATA.CROPS[cell.crop];
      if (this._isGrown(cell)) {
        // 已成熟：可多次收获的作物重置
        if (cropDef.regrow) {
          // 已经成熟的不再增长，等下一天再次可收
        }
        return;
      }

      // 调试模式（Engine.debugFast）下无视浇水，直接生长，方便快速测试
      if (cell.watered || (typeof Engine !== 'undefined' && Engine.debugFast)) {
        cell.grownDays++;
        grownCount++;
      }
    });
    return grownCount;
  },

  /** 新的一天：重置所有浇水状态 */
  resetWater() {
    this._forEachCell((cell) => { if (cell) cell.watered = false; });
  },

  /**
   * 野草逐日演化（每个空地草方块每天掷一次）。草状态：0=无草, 1=绿草, 2=黄草。
   *  - 无草(0)→绿草(1)：基础率 = (1/一季天数) × grassGrowChanceBySeason[季节]，再 × 邻居因子(grassGrowNeighborMult 有草 / grassGrowAloneMult 无草) 蔓延。
   *    注：退化来的裸土(bare=true)恢复成草方块，也按此同一「长草概率」掷骰（掷中才恢复），而非 100% 立即恢复。
   *  - 绿草(1)→黄草(2)：按 grassDecayBySeason[季节] 为基础，再「× 绿草邻居系数」(近草=30% / 无草=10%) 相乘。
   *  - 黄草(2)→草方块(0,非土)：春/夏按 grassDecayToBareBySeason[季节] × 绿草邻居系数(反转：有草=10% / 无草=30%) 退化；秋(2)/冬(3) 无视邻居，直接按季节基础概率(秋80%/冬100%)退化成草方块（此时非土）。
   *  - 草方块(0,非土)→土(裸土)：再次按 grassDecayToBareBySeason[季节] × 绿草邻居系数(反转) / 秋冬无视 退化成裸土(bare=true)。即黄草必须先变草方块、次日草方块才进一步变土，不能跳过草方块直接变土。
   *    注：退化(绿→黄 / 黄→草方块 / 草方块→土) 与 生长(0→1) 均用绿草邻居(相邻有任意草态)。
   * 耕地/已种格不参与（走 farmland 贴图）。
   * 注：邻居判定读取当天开始时的快照(prev)，避免本轮回写影响后续格子的邻居视野。
   *
   * ── 状态转移表（草态机速查）──
   *   当前态             → 下一态            触发条件 / 概率
   *   0 无草             → 1 绿草            growBase × 邻居因子(grassGrowNeighborMult 有草 / grassGrowAloneMult 无草)
   *   1 绿草             → 2 黄草            grassDecayBySeason[季] × 邻居系数(近草30% / 无草10%)
   *   2 黄草             → 0 草方块(非土)    春/夏=grassDecayToBareBase×邻居(反转)；秋/冬=直接按季(80%/100%)
   *   0 草方块(非土)     → 土(bare)          同上（黄草须先变草方块，次日才变土，不可跳过）
   *   0 草方块(非土)     → 1 绿草            growBase × 邻居 × 0.5（用户要求减半）
   *   土(bare)           → 0 草方块          按「长草概率」掷骰(非100%)；邻居反转×1.5/0.5；秋/冬额外×0.5
   *   注：耕地/已种格不参与；邻居基于当天开始快照(prev)，避免遍历顺序影响。
   */
  // 委托给共享草态机（定义见文件末尾 grassStep），保证树场与主农场用同一套季节生长/枯死逻辑。
  dailyGrassGrow() { grassStep(this); },
  // 委托给共享花朵态机（定义见文件末尾 flowerStep），主农场独有（树场不开花）。
  dailyFlowerGrow() { flowerStep(this); },

  /** 收获指定格子 */
  harvest(row, col) {
    if (!this._inBounds(row, col)) return { ok: false, reason: 'out_of_bounds' };
    const cell = this.grid[row][col];
    if (!cell || !cell.crop) return { ok: false, reason: 'no_crop' };
    if (!this._isGrown(cell)) return { ok: false, reason: 'not_grown' };

    const cropDef = DATA.CROPS[cell.crop];
    let count = 1;
    // 土豆 20% 额外掉落
    if (cell.crop === 'potato' && Math.random() < 0.2) count = 2;

    if (cropDef.regrow) {
      // 可多次收获：不清除，重置生长
      cell.grownDays = 0;
      cell.watered = false;
      cell.regrowCount = (cell.regrowCount || 0) + 1;
    } else {
      // 一次性作物：清除（保留 tilled，但重新开始计算休耕天数）
      this.grid[row][col] = { tilled: true, crop: null, watered: false, grownDays: 0, fallowDays: 0 };
    }

    if (typeof Quest !== 'undefined') Quest.trigger('harvest', count); // 任务书：丰收季
    return { ok: true, cropId: cell.crop, count, sellPrice: cropDef.sellPrice };
  },

  /** 检查是否成熟 */
  _isGrown(cell) {
    if (!cell || !cell.crop) return false;
    const cropDef = DATA.CROPS[cell.crop];
    if (!cropDef) return false;

    if (cell.regrowCount > 0 && cropDef.regrow) {
      // 二次收获：使用 regrowDays
      return cell.grownDays >= cropDef.regrowDays;
    }
    return cell.grownDays >= cropDef.growDays;
  },

  // ─────────────────────────────────────────────
  // [工具]
  // ─────────────────────────────────────────────
  _inBounds(r, c) { return inBounds(this, r, c); },

  /** 读取某格草态：0=无草, 1=绿草, 2=黄草。消除 clearGrass/till/toDirt 三处重复的 "grass[row] && grass[row][col] || 0" 表达式。 */
  _grassState(row, col) {
    return (this.grass[row] && this.grass[row][col]) || 0;
  },

  /** 草态是否为「有草」(绿/黄)。消除 till/toDirt 的 "g === 1 || g === 2" 判断，clearGrass 用其反义。 */
  _isGrassState(g) {
    return g === 1 || g === 2;
  },

  /** 某格是否已耕（grid 非空即已耕地）。收口 till/toDirt 的 "grid[row][col] !== null" 判断。 */
  _isTilled(row, col) {
    return this.grid[row][col] !== null;
  },

  /** 遍历所有格子，对每个 cell 调用 cb(cell, r, c)（含 null 荒地）。消除重复的双层 for 循环。 */
  _forEachCell(cb) {
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        cb(this.grid[r][c], r, c);
      }
    }
  },

  // ─────────────────────────────────────────────
  // ⑤ 查询统计
  // ─────────────────────────────────────────────
  /** 统计满足谓词 pred(cell,r,c) 的格子数。收口 getHarvestableCount / getTilledEmptyCount 的「计数循环」重复。 */
  _countCells(pred) {
    let count = 0;
    this._forEachCell((cell, r, c) => { if (pred(cell, r, c)) count++; });
    return count;
  },

  /** 获取可收获格子数 */
  getHarvestableCount() {
    return this._countCells((cell) => cell && cell.crop && this._isGrown(cell));
  },

  /** 获取已耕未种格子数 */
  getTilledEmptyCount() {
    return this._countCells((cell) => cell && !cell.crop);
  },
};

// ─────────────────────────────────────────────
// 共享草态机步进：Farm 与 TreeFarm 共用同一套季节生长/枯死规则（保证「树场草逻辑 = 农场草逻辑」）。
// 与上方 Farm.dailyGrassGrow 原逻辑逐字一致，仅 this→self；调用方（Farm / TreeFarm）需自带
// grass/bare/dirt/grid 数组与 ROWS/COLS，以及草参数属性（grassGrowChanceBySeason 等）。
// ─────────────────────────────────────────────
// 草场预热至稳态：Farm 与 TreeFarm 共用（两方法体逐字一致，抽此消除重复）。
// 预跑若干完整年让 grassStep 收敛到稳态，再推进到开场日，使草场与开场季节一致。
// 越界检查：Farm 与 TreeFarm 共用（两 _inBounds 逻辑逐字一致，抽此消除重复）。
function inBounds(host, r, c) {
  return r >= 0 && r < host.ROWS && c >= 0 && c < host.COLS;
}

function warmupGrassToSteady(host) {
  const savedSeason = Engine.season, savedDay = Engine.day;
  const dps = DATA.DAYS_PER_SEASON, sps = DATA.SEASONS_PER_YEAR;
  const convergeYears = 4;
  for (let y = 0; y < convergeYears; y++) {
    for (let d = 0; d < sps * dps; d++) {
      Engine.season = Math.floor(d / dps) % sps;
      Engine.day = (d % dps) + 1;
      grassStep(host);
    }
  }
  let guard = 0;
  while (!(Engine.season === savedSeason && Engine.day === savedDay) && guard < sps * dps * 2) {
    Engine.day++;
    if (Engine.day > dps) { Engine.day = 1; Engine.season = (Engine.season + 1) % sps; }
    grassStep(host);
    guard++;
  }
}

// 连续季节位置 t：季内按天数平滑插值，消除夏→秋等跨季阶跃（与 ui._seasonColorAt 同思路）。
// t∈[0,4)：0 春初…1 夏初…2 秋初…3 冬初，t→4 环绕回春。Engine 缺失时退化为离散季节。
function seasonPos(fallbackSeason) {
  return (typeof Engine !== 'undefined')
    ? Engine.season + (Engine.day - 1) / DATA.DAYS_PER_SEASON
    : fallbackSeason;
}
// 按 t 在四季表间线性插值取值，使生长/退化随天数渐变而非跨季跳变。grassStep / flowerStep 共用。
function seasonLerp(arr, t) {
  const i0 = Math.floor(t) % 4, i1 = (i0 + 1) % 4, f = t - Math.floor(t);
  return arr[i0] + (arr[i1] - arr[i0]) * f;
}

// 「草方块→绿草」这一步的整体减半系数（用户早前要求）。花朵长出率沿用同一条率，故共用此常量，
// 避免日后调草时花没跟着变。注意：裸土→草方块 的恢复率用的是**未减半**的 growBase，勿混。
const GRASS_GROW_HALVE = 0.5;

function grassStep(self) {
  // 季节对应的概率（下标 = Engine.season：0春/1夏/2秋/3冬）
  const season = (typeof Engine !== 'undefined') ? Engine.season : 0;
  const daysPer = DATA.DAYS_PER_SEASON;
  const t = seasonPos(season);
  const lerpSeason = (arr) => seasonLerp(arr, t);
  const growBase = (1 / daysPer) * lerpSeason(self.grassGrowChanceBySeason); // 无草→绿草 基础率（生长乘数连续插值）
  const decayBase = lerpSeason(self.grassDecayBySeason);     // 绿草→黄草 季节基础概率（连续插值）
  const decayToBareBase = lerpSeason(self.grassDecayToBareBySeason); // 黄草→无草 季节基础概率（连续插值）
  const rewindBase = self.grassRewindBySeason ? lerpSeason(self.grassRewindBySeason) : 0; // 黄草→绿草 重生基础概率（仅主农场有此键；树场为 undefined→0）
  const decayNear = self.grassDecayNear;
  const decayAlone = self.grassDecayAlone;
  // 快照：邻居判定基于当天开始状态，避免遍历顺序影响结果
  const prev = self.grass.map((row) => row.slice());
  const prevBare = self.bare.map((row) => row.slice()); // 裸土快照，供邻居判定(避免遍历顺序影响)
  // 3×3 邻居遍历：对 (r,c) 周围 8 格逐一调用 test(nr,nc)，任一为真即返回真（越界跳过）。
  const _neighborSome = (r, c, test) => hasAnyNeighbor(r, c, self, test);
  // 任意草态(绿/黄)相邻 → 供生长(0→1)用
  const hasNeighborGrass = (r, c) => _neighborSome(r, c, (nr, nc) => !!prev[nr][nc]);
  // 在「原有绿草邻居」基础上【叠加】空秃草方块地(无草、非土)也算邻居（土↔草方块两步用）
  const hasNeighborGrassOrBlock = (r, c) => _neighborSome(r, c, (nr, nc) =>
    !!prev[nr][nc] ||
    (self.grid[nr][nc] === null && prev[nr][nc] === 0 && !prevBare[nr][nc]));
  for (let r = 0; r < self.ROWS; r++) {
    for (let c = 0; c < self.COLS; c++) {
      if (self.grid[r][c] !== null) continue; // 耕地/有作物 不参与草再生（耕过了不会回春）
      if (self.flowers && self.flowers[r] && self.flowers[r][c] > 0) continue; // 与花互斥：花格不长草（树场无 flowers，须先判存在）
      if (self.dirt[r] && self.dirt[r][c]) {
        if (Math.random() < self.dirtRewildChanceBySeason[season]) {
          self.dirt[r][c] = false; // 泥土 → 草方块（中间态解除）
          self.bare[r][c] = false;
        }
        continue;
      }
      if (prev[r][c] === 1) {
        const neighbor = hasNeighborGrass(r, c) ? decayNear : decayAlone;
        const decay = decayBase * neighbor;
        if (Math.random() < decay) self.grass[r][c] = 2; // 仍是草(黄)，未退化成裸土（本步仍按乘法，未改）
      } else if (prev[r][c] === 0) {
        if (self.bare[r][c]) {
          // 裸土 → 草方块：有草邻居时生长慢(竞争抑制)，孤立时生长快（参考第497行同类写法）
          const recoverNeighbor = hasNeighborGrassOrBlock(r, c) ? self.grassGrowNeighborMult : self.grassGrowAloneMult;
          if (Math.random() < growBase * recoverNeighbor) {
            self.bare[r][c] = false; // 土 → 草方块（按长草概率恢复底纹，grass 仍为 0）
          }
          continue;
        }
        const nb = hasNeighborGrassOrBlock(r, c) ? decayAlone : decayNear;
        const toBareDecay = decayToBareBase * nb;
        if (Math.random() < toBareDecay) {
          self.bare[r][c] = true; // 草方块 → 土（草方块退化成裸土，仅此路径能转土色；grass 仍为 0）
          continue;
        }
        const growNeighbor = hasNeighborGrass(r, c) ? self.grassGrowNeighborMult : self.grassGrowAloneMult;
        const grow = growBase * growNeighbor * GRASS_GROW_HALVE; // 草方块→绿草 整体 ×1/2（用户要求减半；花朵共用此系数）
        if (Math.random() < grow) {
          self.grass[r][c] = 1;   // 长成绿草
          self.bare[r][c] = false; // 重新长草 → 不再是裸土
          self.flowers[r][c] = 0; // 草覆盖花朵 → 清除花朵（草与花互斥）
        }
      } else if (prev[r][c] === 2) {
        // 黄草(枯草)：① 可能重生为绿草；② 可能退化为草方块。两者皆掷，若同格同时命中→保持不变。
        // 枯萎(黄→草方块)改为「加法」邻居因数：基础(季节) + 邻居加成；越孤立越易枯成草方块(孤立+0.10) / 靠草丛较不易(靠草丛+0.05)
        const decayNb = hasNeighborGrass(r, c) ? 0.05 : 0.10;
        const decay = Math.min(1, decayToBareBase + decayNb); // 黄草→草方块 退化概率（加法非乘法）
        const doDecay = Math.random() < decay;
        let doRegrow = false;
        if (rewindBase > 0) {
          // 重生概率 = 季节基础 + 邻居因数（加法，非乘法）：越靠近草丛越易重生（有草邻 +10%）/ 越孤立越不易（孤立 +5%）
          const nbBonus = hasNeighborGrass(r, c) ? 0.10 : 0.05;
          const regrowProb = Math.min(1, rewindBase + nbBonus);
          doRegrow = Math.random() < regrowProb;
        }
        if (doRegrow && doDecay) {
          // 同时经历枯萎与生长 → 保持不变（仍是黄草）
        } else if (doRegrow) {
          self.grass[r][c] = 1;   // 枯草重生为绿草
          self.flowers[r][c] = 0; // 草覆盖花朵 → 清除花朵（草与花互斥）
        } else if (doDecay) {
          self.grass[r][c] = 0;   // 黄草退化成草方块(无草)
          self.bare[r][c] = false; // 关键：此时不是土，只是无草草方块(草方块底纹)
        }
        // 否则保持黄草(2)不变
      }
    }
  }
}

// ─────────────────────────────────────────────
// 共享花朵态机步进：与 grassStep 同构但独立。花朵在春生夏枯、簇生，
// 与草/裸土/耕地/作物均互斥（不抢格子，仅在空草方块上生长）。由 Farm.dailyFlowerGrow() 每日调用。
//   - 季节：Engine.season（0春/1夏/2秋/3冬）
//   - 长出：仅春天(flowerSpawnBySeason 闸门=1)，每天在「无花+空地(grass=0, dirt=false, bare=false, grid=null)」上
//       用**和「草方块→绿草」完全相同的生长率**（用户定：「花的生长按绿草的生长率算」）：
//         (1/DAYS_PER_SEASON) × grassGrowChanceBySeason[季,插值] × GRASS_GROW_HALVE
//       再 × 闸门 × (邻居有花 ? flowerClusterMult : 1)。春天实测：孤立 10%/天、成簇 30%/天。
//   - 上限：花数/可长花格子 ≥ flowerMaxDensity(30%) 时当天停止生成（用户定：不让春天铺满花海）。
//       只挡生成，不挡枯萎；计数随当天生成/枯萎实时增减，避免一天内冲过头。
//   - 枯萎：每天在花朵格子上按 grassDecayBySeason[季] 概率清除（夏1%/秋60%/冬95%；春0%=春季不枯）
//   - 邻居：8 邻格 flowers>0 即为「有花邻居」，簇生用
//   - 品种：有花邻居时**继承**其中随机一个邻居的品种（花丛成片同色）；孤立长出的随机取一种
// ─────────────────────────────────────────────
function flowerStep(self) {
  const season = (typeof Engine !== 'undefined') ? Engine.season : 0;
  // 季节闸门（春=1 开 / 夏秋冬=0 关），不是概率本身——概率来自下面的草生长率
  const seasonGate = (self.flowerSpawnBySeason && self.flowerSpawnBySeason[season]) || 0;
  const decayBase = (self.grassDecayBySeason && self.grassDecayBySeason[season]) || 0;
  if (seasonGate <= 0 && decayBase <= 0) return; // 性能短路：非春且无枯萎率 → 直接 return
  // 长出率 = 「草方块→绿草」的同一条率 × 季节闸门（邻居因子在下面按簇生另算）
  const t = seasonPos(season);
  const spawnBase = (1 / DATA.DAYS_PER_SEASON)
    * seasonLerp(self.grassGrowChanceBySeason, t)
    * GRASS_GROW_HALVE
    * seasonGate
    * (self.flowerSpawnMult != null ? self.flowerSpawnMult : 1); // 全局整体缩放（用户定"花太多"→ 乘 1/2）
  const clusterMult = self.flowerClusterMult || 1;
  // 密度上限：先数一遍当前花数与「可长花的格子总数」（空草方块 + 已有花），达上限就当天不再生成。
  // 只在会生成的日子(春天)才统计，其余季节省掉这次遍历。
  let flowerCount = 0, capacity = 0;
  if (spawnBase > 0) {
    for (let r = 0; r < self.ROWS; r++) {
      for (let c = 0; c < self.COLS; c++) {
        if (self.grid[r] && self.grid[r][c] !== null) continue;
        if (self.dirt[r] && self.dirt[r][c]) continue;
        if (self.bare[r] && self.bare[r][c]) continue;
        if (self.flowers[r][c] > 0) { flowerCount++; capacity++; continue; } // 花格 grass 恒为 0，须先判
        if (self.grass[r][c] > 0) continue;
        capacity++;
      }
    }
  }
  const maxFlowers = capacity * (self.flowerMaxDensity != null ? self.flowerMaxDensity : 1);
  // 邻居判定 + 品种继承：扫 8 邻，用蓄水池抽样等概率取一个「花邻居」的品种；无花邻居返回 0。
  // 返回值同时兼作「有没有花邻居」的判定（>0 即有），所以不必再单独跑一次 hasAnyNeighbor。
  const pickNeighborSpecies = (r, c) => {
    let picked = 0, seen = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= self.ROWS || nc < 0 || nc >= self.COLS) continue;
        const s = self.flowers[nr][nc];
        if (s > 0 && Math.random() < 1 / ++seen) picked = s;
      }
    }
    return picked;
  };
  for (let r = 0; r < self.ROWS; r++) {
    for (let c = 0; c < self.COLS; c++) {
      // 占用格不参与花朵生命周期：耕地/有作物/有草(1/2)/裸土/泥土
      if (self.grid[r] && self.grid[r][c] !== null) continue;
      if (self.dirt[r] && self.dirt[r][c]) continue;
      if (self.bare[r] && self.bare[r][c]) continue;
      if (self.grass[r][c] > 0) continue; // 与草互斥：草格不长花
      if (self.flowers[r][c] > 0) {
        // 已是花 → 按当前季节 grass decay 概率枯萎（枯萎不受密度上限影响）
        if (decayBase > 0 && Math.random() < decayBase) { self.flowers[r][c] = 0; flowerCount--; }
      } else if (spawnBase > 0 && flowerCount < maxFlowers) {
        // 无花且未达密度上限 → 按「草的生长率 × 簇生系数」长出；品种继承邻居（成片同色），孤立则随机
        const near = pickNeighborSpecies(r, c);
        const cluster = near > 0 ? clusterMult : 1;
        if (Math.random() < spawnBase * cluster) {
          self.flowers[r][c] = near > 0 ? near
            : (self._randomFlowerSpecies ? self._randomFlowerSpecies() : 1); // 树场等无此方法时兜底 1
          flowerCount++;
        }
      }
    }
  }
}
