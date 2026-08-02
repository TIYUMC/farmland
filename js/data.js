/**
 * data.js — 游戏配置数据
 * 所有可调参数集中在此，方便数值平衡
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
  },

  // 体力自动恢复速率（每游戏分钟恢复的点数，调小 = 恢复更慢）
  STAMINA_REGEN_PER_MIN: 0.03,

  // === 种子数据 ===
  CROPS: {
    wheat: {
      name: '小麦', seedCost: 1, sellPrice: 35,
      growDays: 4, regrow: false,
      sprite: '🌱', harvestSprite: '🌾',
      assetStages: ['wheat_stage0', 'wheat_stage2', 'wheat_stage4', 'wheat_stage6', 'wheat_stage7'],
      assetHarvest: '小麦', // 背包图标用「收获篮」png（用户明确要求：背包显示篮子图）；地里不受影响（已解耦，读 assetStages）
      shopSellIcon: '小麦', // shop 卖行同样用篮子图，与背包一致
    },
    potato: {
      name: '土豆', seedCost: 5, sellPrice: 80,
      growDays: 6, regrow: false,
      sprite: '🌿', harvestSprite: '🥔',
      assetStages: ['potatoes_stage0', 'potatoes_stage1', 'potatoes_stage2', 'potatoes_stage3', 'potato'],
      assetHarvest: 'potato',
    },
    strawberry: {
      name: '甜浆果', seedCost: 20, sellPrice: 30,
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

  // === 商店物品（同时驱动「买种子」与「卖作物」两项交易）===
  SHOP_ITEMS: [
    { id: 'wheat',       name: '小麦种子',   cost: 1,  desc: '4天成熟 · 基础作物' },
    { id: 'potato',      name: '土豆',   cost: 5,  desc: '6天成熟 · 高收益' },
    { id: 'strawberry',  name: '甜浆果', cost: 20, desc: '8天成熟 · 可重复收获' },
  ],
};
