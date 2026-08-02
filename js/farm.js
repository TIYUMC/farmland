/**
 * farm.js — 农场管理系统
 * 管理：地块网格、耕地、播种、浇水、生长、收获
 */
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
  //   即：草必须先在草方块上长成绿草(1)→黄草(2)→草方块(0)→土(裸土)→(次日)草方块→绿草，逐态退化、黄草不能跳过草方块直接变土，回到裸地循环。
  grass: [],

  // bare[row][col] = 该草方块是否「已退化为裸土(土色)」。仅当草(1/2)退化成 0 时才置 true；
  // 从未长草的普通草方块地面(false)即使到秋冬也不显示裸土、保持草方块底纹。即：只有草方块退化才转土色。
  bare: [],

  // dirt[row][col] = 该地面是否「已被锄成泥土(中间态)」。普通草方块/裸土 经一次锄头→泥土(dirt=true)，
  // 再锄一次才成耕地(farmland)。泥土态不再长草、也不可直接耕地(必须先到泥土)。仅对 grid=null 的地面有意义。
  dirt: [],

  // === 野草生长/退化参数（集中可调）===
  // 长草率按「季节天数摊薄」：基础率 = 1 / DAYS_PER_SEASON（一季 x 天，每天长 1/x 进度），再乘以下两项。
  grassGrowChanceBySeason: [3, 4, 2, 1], // 「季节生长乘数」：基础率再乘它；春3 / 夏4 / 秋2 / 冬1（夏长得最快、冬最慢）。实际每天生长率 = (1/DAYS_PER_SEASON)×本数组[季节]×邻居因子
  grassGrowNeighborMult: 0.5,  // 无草→绿草：周围「有草」时的生长率乘数（用户定：0.5，比孤立慢）
  grassGrowAloneMult: 1.5,    // 无草→绿草：周围「无草(孤立裸地)」时的生长率乘数（用户定：1.5，比贴草快）
  grassDecayBySeason: [0, 0.01, 0.60, 0.95], // 「绿草→黄草(枯死)」的退化基础概率，随季节：春0%(春天绿草不枯) / 夏1% / 秋60% / 冬95%（下标=Engine.season）；实际概率再叠加邻居规则（见 dailyGrassGrow）
  grassDecayToBareBySeason: [0.05, 0.01, 0.80, 1.00], // 「黄草→草方块」与「草方块→土」共用的退化基础概率（两步各掷一次，故黄草需两天才到土）；随季节：春5% / 夏1% / 秋80% / 冬100%；秋/冬无视邻居系数（见 dailyGrassGrow）
  // 退化邻居系数（以「绿草邻居」判定：相邻8格有任意草态(绿/黄)算有草）：
  grassDecayNear: 0.30,   // 有草邻居时的退化乘数；在 绿→黄 中=近草更快(×0.30)，在 黄→无 中反转=有草更慢(×0.10，见 dailyGrassGrow)
  grassDecayAlone: 0.10,  // 无草邻居时的退化乘数；在 绿→黄 中=无草更慢(×0.10)，在 黄→无 中反转=无草更快(×0.30)
  grassInitDensity: 0.12,       // 新游戏初始草覆盖比例(0~1)，预置为绿草(1)；调低→开局稀疏，草随天数从少到多自然长满

  /** 初始化空农场 */
  init() {
    this.grid = [];
    this.grass = [];
    this.bare = [];
    this.dirt = [];
    for (let r = 0; r < this.ROWS; r++) {
      this.grid[r] = [];
      this.grass[r] = [];
      this.bare[r] = [];
      this.dirt[r] = [];
      for (let c = 0; c < this.COLS; c++) {
        this.grid[r][c] = null; // 荒地
        this.bare[r][c] = false; // 初始均未退化成裸土
        this.dirt[r][c] = false; // 初始均未锄成泥土
        // 初始只预置一小部分短草(grassInitDensity=0.12)，使新游戏是稀疏草地；
        // 剩下的空地由 dailyGrassGrow 按 (1/一季天数)×季节乘数×邻居因子 逐日蔓延长出（见下）。
        this.grass[r][c] = Math.random() < this.grassInitDensity ? 1 : 0;
      }
    }
  },

  /** 除草：把有草(绿/黄)的地面清成「普通草方块」(grass=0, 非裸土)。无草时返回 'no_grass'。 */
  clearGrass(row, col) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    const g = (this.grass[row] && this.grass[row][col]) || 0;
    if (g !== 1 && g !== 2) return 'no_grass';
    this.grass[row][col] = 0;
    if (this.bare[row]) this.bare[row][col] = false; // 变回普通草方块（非裸土），之后才能锄地
    return 'ok';
  },

  /** 耕地：有草的地面必须先除草(clearGrass)→锄成泥土(toDirt)后才能耕，否则返回对应错误码。 */
  till(row, col) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    if (this.grid[row][col] !== null) return 'already_tilled';
    const g = (this.grass[row] && this.grass[row][col]) || 0;
    if (g === 1 || g === 2) return 'has_grass';
    if (!this.dirt[row][col]) return 'need_dirt'; // 草方块必须先锄成泥土(dirt=true)才能耕地
    this.grid[row][col] = { tilled: true, crop: null, watered: false, grownDays: 0 };
    return 'ok';
  },

  /** 锄成泥土：普通草方块/裸土 经一次锄头变为「泥土」中间态(dirt=true)，再锄一次才成耕地。
   *  有草(1/2)的格子必须先 clearGrass；已是泥土/已耕地则返回对应错误码。 */
  toDirt(row, col) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    if (this.grid[row][col] !== null) return 'already_tilled';
    const g = (this.grass[row] && this.grass[row][col]) || 0;
    if (g === 1 || g === 2) return 'has_grass';
    if (this.dirt[row][col]) return 'already_dirt';
    this.dirt[row][col] = true;
    return 'ok';
  },

  /** 播种 */
  plant(row, col, cropId) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    const cell = this.grid[row][col];
    if (!cell) return 'not_tilled';
    if (cell.crop) return 'already_planted';
    const cropDef = DATA.CROPS[cropId];
    if (!cropDef) return 'invalid_crop';

    cell.crop = cropId;
    // B3：不再清空 watered，保留播种前已做的预浇水（空耕地可先浇水再种）
    cell.grownDays = 0;
    cell.regrowCount = 0;
    return 'ok';
  },

  /** 浇水（一格） */
  water(row, col) {
    if (!this._inBounds(row, col)) return 'out_of_bounds';
    const cell = this.grid[row][col];
    if (!cell || !cell.tilled) return 'no_tilled'; // B3：已耕地即可浇（含空耕地预浇水），不要求已有作物
    if (cell.watered) return 'already_watered';
    cell.watered = true;
    return 'ok';
  },

  /** 每日增长：遍历所有已种植格子，没浇水的生长不加 */
  dailyGrow() {
    let grownCount = 0;
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = this.grid[r][c];
        if (!cell || !cell.crop) continue;

        const cropDef = DATA.CROPS[cell.crop];
        if (this._isGrown(cell)) {
          // 已成熟：可多次收获的作物重置
          if (cropDef.regrow) {
            // 已经成熟的不再增长，等下一天再次可收
          }
          continue;
        }

        if (cell.watered) {
          cell.grownDays++;
          grownCount++;
        }
      }
    }
    return grownCount;
  },

  /** 新的一天：重置所有浇水状态 */
  resetWater() {
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = this.grid[r][c];
        if (cell) cell.watered = false;
      }
    }
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
   */
  dailyGrassGrow() {
    // 季节对应的概率（下标 = Engine.season：0春/1夏/2秋/3冬）
    const season = (typeof Engine !== 'undefined') ? Engine.season : 0;
    const growBase = (1 / DATA.DAYS_PER_SEASON) * this.grassGrowChanceBySeason[season]; // 无草→绿草 基础率：1/一季天数 × 季节乘数
    const decayBase = this.grassDecayBySeason[season];     // 绿草→黄草 季节基础概率
    const decayToBareBase = this.grassDecayToBareBySeason[season]; // 黄草→无草 季节基础概率
    const decayNear = this.grassDecayNear;
    const decayAlone = this.grassDecayAlone;
    // 快照：邻居判定基于当天开始状态，避免遍历顺序影响结果
    const prev = this.grass.map((row) => row.slice());
    const prevBare = this.bare.map((row) => row.slice()); // 裸土快照，供邻居判定(避免遍历顺序影响)
    const hasNeighborGrass = (r, c) => {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= this.ROWS || nc < 0 || nc >= this.COLS) continue;
          if (prev[nr][nc]) return true; // 任意草态(绿/黄)都算"有草"——供生长(0→1)用
        }
      }
      return false;
    };
    // 土↔草方块两步用的邻居判定：在「原有绿草邻居」基础上【叠加】空秃草方块地(无草、非土)也算邻居。
    // 即「绿草/黄草 相邻」仍算(保留原逻辑，不是替代) + 「空秃草方块地 相邻」也算(新增：加上草方块)。土(裸土)相邻不算。
    // 供「土→草方块恢复」与「草方块→土退化」两条使用。
    const hasNeighborGrassOrBlock = (r, c) => {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= this.ROWS || nc < 0 || nc >= this.COLS) continue;
          if (prev[nr][nc]) return true; // 绿草/黄草 相邻（原有邻居判定，保留，不是替代）
          // 空秃草方块地(无草且非土) 相邻 → 也算有邻居（新增：加上草方块，不是替代绿草邻居）
          if (this.grid[nr][nc] === null && prev[nr][nc] === 0 && !prevBare[nr][nc]) return true;
        }
      }
      return false;
    };
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        if (this.grid[r][c] !== null) continue; // 非草方块（已耕地/有作物）
        if (this.dirt[r] && this.dirt[r][c]) continue; // 泥土态：玩家已锄松，不再长草，保持待耕地
        if (prev[r][c] === 1) {
          // 绿草 → 黄草（生成枯草）：保持原逻辑，用绿草邻居(任意草态)判定，季节基础概率 × 邻居系数(近草30%/无草10%)，相乘。
          // 注意：这条不归"无草草方块邻居"管，用户未改动。
          const neighbor = hasNeighborGrass(r, c) ? decayNear : decayAlone;
          const decay = decayBase * neighbor;
          if (Math.random() < decay) this.grass[r][c] = 2; // 仍是草(黄)，未退化成裸土
        } else if (prev[r][c] === 0) {
          // 退化来的裸土(bare=true)：按「长草概率」(= 无草→绿草的概率 growBase×邻居因子) 掷骰恢复成草方块底纹；
          // 掷中→变回草方块(当天不长草，明天再走退化/长草)，未掷中→今天仍是土。不再 100% 立即恢复。
          if (this.bare[r][c]) {
            // 土→草方块恢复：邻居因子与「无草→绿草」反转——有邻居×1.5(快) / 无邻居×0.5(慢)
            // 秋冬额外 ×1/2（用户要求仅「土→草方块」这一步的秋冬减半，不影响草方块→绿草）
            const recoverNeighbor = hasNeighborGrassOrBlock(r, c) ? this.grassGrowAloneMult : this.grassGrowNeighborMult;
            const recoverSeasonMult = (season === 2 || season === 3) ? 0.5 : 1;
            if (Math.random() < growBase * recoverNeighbor * recoverSeasonMult) {
              this.bare[r][c] = false; // 土 → 草方块（按长草概率恢复底纹，grass 仍为 0）
            }
            continue; // 土状态当天不长草（无论是否恢复，都等明天）
          }
          // 普通无草草方块(非土) 的两条去向：先判定是否退化为土，否则才长绿草。
          // (a) 草方块 → 土：按 grassDecayToBareBySeason × 草方块邻居系数(反转) / 秋冬无视，与「黄草→草方块」共用同一季节表。
          //     即黄草先退化成此草方块态，次日草方块才有概率进一步退化成土——黄草不能跳过草方块直接变土。
          //     邻居判定用 hasNeighborGrassOrBlock = 绿草/黄草 或 空秃草方块地(非土) 相邻都算(在原绿草邻居上叠加草方块，不是替代)。
          let toBareDecay;
          if (season === 2 || season === 3) {
            toBareDecay = decayToBareBase; // 秋/冬：忽略邻居系数
          } else {
            const nb = hasNeighborGrassOrBlock(r, c) ? decayAlone : decayNear;
            toBareDecay = decayToBareBase * nb;
          }
          if (Math.random() < toBareDecay) {
            this.bare[r][c] = true; // 草方块 → 土（草方块退化成裸土，仅此路径能转土色；grass 仍为 0）
            continue;
          }
          // (b) 草方块 → 绿草：基础率 = (1/一季天数) × 季节乘数，再乘邻居因子（草从少到多自然蔓延）
          const growNeighbor = hasNeighborGrass(r, c) ? this.grassGrowNeighborMult : this.grassGrowAloneMult;
          const grow = growBase * growNeighbor * 0.5; // 草方块→绿草 整体 ×1/2（用户要求减半）
          if (Math.random() < grow) {
            this.grass[r][c] = 1;   // 长成绿草
            this.bare[r][c] = false; // 重新长草 → 不再是裸土
          }
        } else if (prev[r][c] === 2) {
          // 黄草 → 草方块(无草、非土)：用 hasNeighborGrass 判定，绿草(1)和黄草(2)相邻都算"有草邻居"（黄草已计入）。
          //   反转——孤立枯草(无草格)→decayNear=30%(退化更快) / 被草(含黄草)包围→decayAlone=10%(退化更慢)。
          // 秋(2)/冬(3) 无视邻居规则，直接按季节基础概率(秋80% / 冬100%)退化成草方块（此时只是无草草方块，还不是土）。
          //   次日草方块再按同一 grassDecayToBareBySeason 进一步退化成土——即「黄草必须先变草方块，才能变土」。
          let decay;
          if (season === 2 || season === 3) {
            decay = decayToBareBase; // 秋/冬：忽略邻居系数
          } else {
            const neighbor = hasNeighborGrass(r, c) ? decayAlone : decayNear;
            decay = decayToBareBase * neighbor;
          }
          if (Math.random() < decay) {
            this.grass[r][c] = 0;   // 黄草退化成草方块(无草)
            this.bare[r][c] = false; // 关键：此时不是土，只是无草草方块(草方块底纹)
          }
        }
      }
    }
  },

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
      // 一次性作物：清除
      this.grid[row][col] = { tilled: true, crop: null, watered: false, grownDays: 0 };
    }

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

  _inBounds(r, c) {
    return r >= 0 && r < this.ROWS && c >= 0 && c < this.COLS;
  },

  /** 获取可收获格子数 */
  getHarvestableCount() {
    let count = 0;
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.crop && this._isGrown(cell)) count++;
      }
    }
    return count;
  },

  /** 获取已耕未种格子数 */
  getTilledEmptyCount() {
    let count = 0;
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = this.grid[r][c];
        if (cell && !cell.crop) count++;
      }
    }
    return count;
  },
};
