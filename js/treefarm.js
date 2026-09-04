/**
 * treefarm.js — 树场（独立子场景）资源树管理
 * 与主农场 Farm 完全解耦：只管「树」与「地表（森林地表仅作渲染，无地块状态）」，不含作物/耕地。
 * 渲染与交互由 ui.js 在 UI.scene==='treeFarm' 时分支调用（见 ui.js _renderTreeFarmScene / _handleTreeFarmClick）。
 * 设计定位：C1 经济闭环的资源出口，固定大小区域 + 随机生成，天然防通胀（见《树场与制造链_设计方案》）。
 *
 * ── 结构导航 ──
 *   ① 初始化  init
 *   ② 查询    _inBounds / getTreeAt
 *   ③ 交互    chop / plantAcorn
 *   ④ 每日演化 dailyGrow
 */
const TreeFarm = {
  COLS: DATA.FARM.COLS,
  ROWS: DATA.FARM.ROWS,

  // trees[row][col] = 资源树实体：null=无树；{ stage:'grown'|'sapling', days }。
  // grown=可砍；砍后直接消失(null)，不再有树桩阶段；sapling=种下的橡果长出的树苗，按 TREE.acornGrowDays 长成。
  trees: [],

  // rooted[row][col] = true 表示该格被锄头翻过、地表明为「缠根泥土」(rooted_dirt)。
  // 树场根系太密，锄头无法耕成耕地，只能翻出缠根泥土（纯地表视觉状态，不影响种树/树苗）。
  rooted: [],

  // —— 草态（与主农场共用 grassStep，参数减半 → 草量约为农场一半）——
  // 0 无草 / 1 绿草 / 2 黄草；bare=true 退化成裸土。渲染与演化均复用农场逻辑，树场只"禁耕地"。
  grass: [],
  bare: [],
  dirt: [],   // 树场无「锄成泥土」中间态，恒为 false（仅占位以满足 grassStep 接口）
  grid: [],   // 树场无耕地/作物，恒为 null（grassStep 据此判定「全部格都参与草再生」）
  grassInitDensity: 0.03,                     // 初始绿草比例 = 农场(0.12) 的 1/4（再减半，树场更秃）
  grassGrowChanceBySeason: [0.75, 1, 0.5, 0.25], // 季节生长乘数 = 树场原[1.5,2,1,0.5]再减半（农场1/4）：生长更慢
  grassGrowNeighborMult: 0.5,
  grassGrowAloneMult: 1.5,
  grassDecayBySeason: [0, 0.02, 1.20, 1.90],     // 枯萎季节表 = 树场原[0,0.01,0.60,0.95]加倍（秋/冬>1→基本必枯）
  grassDecayToBareBySeason: [0.10, 0.02, 1.60, 2.00], // 退化成土 = 树场原[0.05,0.01,0.80,1.00]加倍（冬=2→必裸土）
  grassDecayNear: 0.30,
  grassDecayAlone: 0.10,
  dirtRewildChanceBySeason: [0.03, 0.04, 0.015, 0.006],

  // ─────────────────────────────────────────────
  // ① 初始化
  // ─────────────────────────────────────────────
  /** 初始化树场：随机预置 INIT_TREES 棵长成的树，其余每日由 dailyGrow 补满至 MAX_TREES。 */
  init() {
    this.trees = [];
    this.rooted = [];
    this.grass = [];
    this.bare = [];
    this.dirt = [];
    this.grid = [];
    this.flowers = [];  // 树场无花朵，但需初始化以满足 grassStep 的 self.flowers 访问
    for (let r = 0; r < this.ROWS; r++) {
      this.trees[r] = []; this.rooted[r] = [];
      this.grass[r] = []; this.bare[r] = []; this.dirt[r] = []; this.grid[r] = []; this.flowers[r] = [];
      for (let c = 0; c < this.COLS; c++) {
        this.trees[r][c] = null; this.rooted[r][c] = false;
        this.bare[r][c] = false; this.dirt[r][c] = false; this.grid[r][c] = null;
        this.flowers[r][c] = 0;  // 树场无花，恒为 0
        this.grass[r][c] = Math.random() < this.grassInitDensity ? 1 : 0; // 初始绿草（减半密度）
      }
    }
    const cfg = DATA.TREEFARM;
    let placed = 0;
    while (placed < cfg.INIT_TREES && this._placeRandomGrownTree()) placed++;
    // 预跑到稳态：树场草场开局即「长满后」的稳态分布（参数减半→草量约为农场一半）。
    this._warmupGrassToSteady();
  },

  /** 草场预热至稳态：委托 farm.js 的共享 warmupGrassToSteady（与农场同一套草逻辑）。 */
  _warmupGrassToSteady() { warmupGrassToSteady(this); },

  // ─────────────────────────────────────────────
  // ② 查询
  // ─────────────────────────────────────────────
  _inBounds(r, c) { return inBounds(this, r, c); },
  // 网格遍历：对每格回调 (cell, r, c)，cell = this.trees[r][c]。与 Farm._forEachCell 对称（树场走 trees 而非 grid）。
  _forEachCell(cb) {
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        cb(this.trees[r][c], r, c);
      }
    }
  },

  getTreeAt(r, c) { return (this.trees[r] && this.trees[r][c]) || null; },

  /** 某格 8 邻格内是否已有树（供「树旁生树降概率」判定用）。 */

  /** 越界或已有树 → 返回错误对象，否则 null。收口 plantAcorn/till 的「越界 + 已有树」双守卫（两处理由一致）。 */
  _requireEmptyCell(row, col) {
    if (!this._inBounds(row, col)) return { ok: false, reason: 'out_of_bounds' };
    if (this.getTreeAt(row, col)) return { ok: false, reason: '这里已经有树了' };
    return null;
  },

  /** 含端点的随机整数 [min, max]（min + floor(random×(max-min+1))）。收口 chop 的 wood/acorns 产量计算（两处同形）。 */
  _randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  },

  _hasNeighborTree(r, c) {
    return hasAnyNeighbor(r, c, this, (nr, nc) => !!(this.trees[nr] && this.trees[nr][nc]));
  },

  /** 在随机空格放一棵长成的树；pred(r,c) 返回 false 时跳过该格（如「避开树旁」）。
   *  内部自带 guard<5000 防死循环（120 格网格下基本不会触发）。返回是否成功放下。 */
  _placeRandomGrownTree(pred) {
    let guard = 0;
    while (guard < 5000) {
      guard++;
      const r = Math.floor(Math.random() * this.ROWS);
      const c = Math.floor(Math.random() * this.COLS);
      if (this.trees[r][c]) continue;
      if (pred && !pred(r, c)) continue;
      this.trees[r][c] = { stage: 'grown', days: 0 };
      this._clearFrost(r, c);                  // 新长成的树：霜白从 0 起
      return true;
    }
    return false;
  },

  // ─────────────────────────────────────────────
  // ③ 交互
  // ─────────────────────────────────────────────
  /** 清掉某格的树冠霜白残留。砍树/种树时是「新树实体」，不应继承上一棵被砍树的白度
   *  （_updateTreeFrost 只在下雪帧才清无树格，若「砍→雪停→新树长出来」间隙没下雪，残留会传给新树）。
   *  仅在冬季霜白网格存在时才动，避免非冬季误建霜白网格。 */
  _clearFrost(r, c) {
    if (typeof UI !== 'undefined' && UI._treeFrost) UI._treeFrost[r * 1000 + c] = 0;
  },

  /** 砍树：砍倒大树掉落木头/橡果（树场专用），返回 { ok, wood, acorns } 或 { ok:false, reason }。
   *  wood 取自 DATA.TREE；acorns 为 1~3 个「橡果」(DATA.TREE.acornYield*)，可种回树场形成循环。 */
  chop(row, col) {
    if (!this._inBounds(row, col)) return { ok: false, reason: 'out_of_bounds' };
    const t = this.getTreeAt(row, col);
    if (!t) return { ok: false, reason: '这里没有树' };
    if (t.stage !== 'grown') return { ok: false, reason: '树还没长好' };
    const T = DATA.TREE;
    const wood = this._randInt(T.woodYieldMin, T.woodYieldMax);
    const acorns = this._randInt(T.acornYieldMin, T.acornYieldMax);
    this.trees[row][col] = null;
    this._clearFrost(row, col);                // 清掉被砍树的霜白残留（新树不应继承）
    if (typeof Quest !== 'undefined') Quest.trigger('chop'); // 任务书：樵夫/伐木工会
    return { ok: true, wood, acorns };
  },

  /** 种橡果：在空格种下一棵橡果(sapling stage:'sapling')，消耗玩家 1 个橡果；长成后可与普通树一样砍。
   *  返回 { ok } 或 { ok:false, reason }。 */
  plantAcorn(row, col) {
    const e = this._requireEmptyCell(row, col);
    if (e) return e;
    this.trees[row][col] = { stage: 'sapling', days: 0 };
    this._clearFrost(row, col);                // 新树苗：霜白从 0 起
    if (typeof Quest !== 'undefined') Quest.trigger('plantSapling'); // 任务书：林场主
    return { ok: true };
  },

  /** 除草：把有草(绿/黄)的地面清成「普通草方块」(grass=0, 非裸土)。无草时返回 'no_grass'。
   *  与主农场 Farm.clearGrass 对称，使树场锄头逻辑与主农场同步（先除草才能翻地）。 */
  clearGrass(row, col) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    const g = (this.grass[row] && this.grass[row][col]) || 0;
    if (g !== 1 && g !== 2) return 'no_grass';
    this.grass[row][col] = 0;
    if (this.bare[row]) this.bare[row][col] = false; // 变回普通草方块（非裸土）
    return 'ok';
  },

  /** 树场锄地：树场根系太密，锄头无法耕成耕地，只能翻出「缠根泥土」(rooted_dirt) 地表（纯视觉状态）。
   *  带概率：根系太密，只有 ROOT_CHANCE 概率成功翻出缠根泥土；否则只是锄了一下没翻动(root_too_dense)，可重试。
   *  不再像旧版「一律变缠根泥土」——这是真实的随机逻辑，而非单纯贴图替换。 */
  till(row, col) {
    const e = this._requireEmptyCell(row, col);
    if (e) return e;
    const g = (this.grass[row] && this.grass[row][col]) || 0;
    if (g === 1 || g === 2) return { ok: false, reason: 'has_grass' };   // 有草先除草（与主农场一致）
    if (this.getRootedAt(row, col)) return { ok: false, reason: 'already_rooted' };
    const chance = (DATA.TREEFARM.ROOT_CHANCE != null) ? DATA.TREEFARM.ROOT_CHANCE : 0.5;
    if (Math.random() < chance) {
      this.rooted[row][col] = true;
      return { ok: true };
    }
    return { ok: false, reason: 'root_too_dense' };
  },

  getRootedAt(r, c) { return !!(this.rooted[r] && this.rooted[r][c]); },

  // ─────────────────────────────────────────────
  // ④ 每日演化
  // ─────────────────────────────────────────────
  /** 逐日演化：① 橡果种下后长树苗 (days+1)，满 acornGrowDays 长回 grown；② 每日随机补树至 MAX_TREES（控率防刷爆/枯竭）。 */
  dailyGrow() {
    const growDays = DATA.TREE.acornGrowDays;
    let count = 0;
    this._forEachCell((t, r, c) => {
      if (t && t.stage === 'sapling') {
        t.days = (t.days || 0) + 1;
        if (t.days >= growDays) { this.trees[r][c] = { stage: 'grown', days: 0 }; this._clearFrost(r, c); } // 长成的树：霜白从 0 起
      }
      if (this.trees[r][c]) count++;
    });
    const cfg = DATA.TREEFARM;
    let toAdd = Math.min(cfg.REFILL_PER_DAY, cfg.MAX_TREES - count);
    // 树旁生树概率 = 空地的 10%：相邻已有树时仅 10% 概率真正长树，避免成片扎堆、留出林间空地
    while (toAdd > 0 && this._placeRandomGrownTree((r, c) =>
      !(this._hasNeighborTree(r, c) && Math.random() >= 0.10))) toAdd--;
  },

  /** 草每日演化：直接复用农场草态机 grassStep（季节生长/枯死规则与农场完全一致），参数减半→草量约为农场一半。 */
  dailyGrassGrow() { grassStep(this); },
};
