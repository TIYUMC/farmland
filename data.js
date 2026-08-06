/**
 * data.js — 游戏配置数据
 * 所有可调参数集中在此，方便数值平衡。
 *
 * ── 结构导航（纯配置，按职责分区）──
 *   [季节系统]  SEASONS / DAYS_PER_SEASON / SEASONS_PER_YEAR
 *   [时间系统]  START_HOUR / END_HOUR / REAL_SECS_PER_GAME_HOUR
 *   [工具体力]  TOOL_COST / STAMINA_REGEN_PER_MIN
 *   [作物种子]  CROPS
 *   [玩家初始]  PLAYER_START
 *   [农场网格]  FARM
 *   [资源树]    TREE
 *   [树场]      TREEFARM
 *   [商店物品]  SHOP_ITEMS
 */
const DATA = {
  // === 季节系统 ===
  SEASONS: ['春', '夏', '秋', '冬'],
  DAYS_PER_SEASON: 15,
  SEASONS_PER_YEAR: 4,

  // === 时间系统 ===
  START_HOUR: 6,   // 6:00 起床
  END_HOUR: 24,    // 24:00 强制睡觉 (午夜)
  REAL_SECS_PER_GAME_HOUR: 12, // 每游戏小时 = 12 秒，一天≈3.6分钟

  // === 工具 & 体力消耗 ===
  TOOL_COST: {
    hoe: 4,         // 耕地
    water: 3,       // 浇一株
    harvest: 2,     // 收一株
    plant: 1,       // 播种
    axe: 5,         // 砍树
  },

  // 体力自动恢复速率（每游戏分钟恢复的点数，调小 = 恢复更慢）
  STAMINA_REGEN_PER_MIN: 0.03,

  // === 种子数据 ===
  CROPS: {
    wheat: {
      name: '小麦', seedCost: 1, sellPrice: 35, color: '#BFD07A',
      growDays: 4, regrow: false,
      sprite: '🌱', harvestSprite: '🌾',
      assetStages: ['wheat_stage0', 'wheat_stage2', 'wheat_stage4', 'wheat_stage6', 'wheat_stage7'],
      assetHarvest: '小麦', // 背包图标用「收获篮」png（用户明确要求：背包显示篮子图）；地里不受影响（已解耦，读 assetStages）
      shopSellIcon: '小麦', // shop 卖行同样用篮子图，与背包一致
    },
    potato: {
      name: '土豆', seedCost: 5, sellPrice: 80, color: '#9DBB6A',
      growDays: 6, regrow: false,
      sprite: '🌿', harvestSprite: '🥔',
      assetStages: ['potatoes_stage0', 'potatoes_stage1', 'potatoes_stage2', 'potatoes_stage3', 'potato'],
      assetHarvest: 'potato',
    },
    strawberry: {
      name: '甜浆果', seedCost: 20, sellPrice: 30, color: '#8FCA7A',
      growDays: 8, regrow: true, regrowDays: 3,
      sprite: '🌱', harvestSprite: '🍓',
      assetStages: ['sweet_berry_bush_stage0', 'sweet_berry_bush_stage1', 'sweet_berry_bush_stage2', 'sweet_berry_bush_stage3'],
      assetHarvest: 'sweet_berry_bush_stage3',
      shopSellIcon: 'mc_sweet_berries', // shop 卖行用甜浆果物品图，而非灌木生长图
    },
  },

  // === 玩家初始状态 ===
  PLAYER_START: {
    money: 128, // 开局给两组金锭（2×64）
    stamina: 20,
    maxStamina: 20,
  },

  // === 农场 ===
  FARM: {
    COLS: 12,
    ROWS: 10,
    CELL_SIZE: 48,  // px — 会在运行时根据 canvas 调整
  },

  // === 资源树（可砍伐）===
  // stage: grown=已长成可被斧头砍倒掉木头；砍后变 stump(树桩)，按 regrowDays 天重新长成 grown。
  // 木头暂只产不出（为后续建造/经济闭环铺路）。init 为预置在农场上的树坐标 [row,col]。
  TREE: {
    woodYieldMin: 2,
    woodYieldMax: 4,
    regrowDays: 4,                 // 树桩重新长成大树所需天数
    saplingYieldMin: 1,            // 砍树掉落的「树苗」数量下限（可种回树场，形成可循环）
    saplingYieldMax: 3,            // 砍树掉落的「树苗」数量上限
    saplingGrowDays: 4,            // 种下的树苗长成大树所需天数（与树桩重生同节奏）
    init: [], // 主农场不再预置树（树已移到独立树场 TreeFarm 场景，见 TREEFARM 配置）
  },

  // === 树场（独立子场景：资源出口，C1 经济闭环延伸）===
  // 与主农场 Farm 解耦：专门一张树场地图，固定大小、区域内随机生成（防通胀）。
  // 与主农场共用 12×10 网格尺寸（渲染/画布逻辑不变），最多 MAX_TREES 棵封顶（产能上限），
  // 每天随机补几棵至上限（REFILL_PER_DAY）；砍树后直接消失（无树桩阶段），由玩家种树苗(sapling)长回。
  TREEFARM: {
    MAX_TREES: 10,        // 树木上限（防通胀：木头产能封顶）→ 约 1/12 格（12×10=120 格），用户要求从 20 再减半到 10
    INIT_TREES: 6,        // 开局预置树数（< 上限，留出每日补树空间）；用户要求初始 6 棵
    REFILL_PER_DAY: 3,    // 每日随机补树上限（控率：防瞬时刷爆 / 长期枯竭）
  },

  // === 商店物品（同时驱动「买种子」与「卖作物」两项交易）===
  SHOP_ITEMS: [
    { id: 'wheat',       name: '小麦种子',   cost: 1,  desc: '4天成熟 · 基础作物' },
    { id: 'potato',      name: '土豆',   cost: 5,  desc: '6天成熟 · 高收益' },
    { id: 'strawberry',  name: '甜浆果', cost: 20, desc: '8天成熟 · 可重复收获' },
    // 工具类：cost = 金锭花费；costItems = 附加材料（村民交易第二个输入槽）
    { id: 'axe',         name: '木斧头', cost: 30, type: 'tool',
      costItems: [{ id: 'wheat', count: 5 }],
      desc: '砍树必备 · 30金锭 + 5小麦' },
  ],
};
