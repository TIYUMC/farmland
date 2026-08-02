/**
 * player.js — 玩家管理
 * 体力、金钱、背包、工具选择
 */
const Player = {
  stamina: DATA.PLAYER_START.stamina,
  maxStamina: DATA.PLAYER_START.maxStamina,
  money: DATA.PLAYER_START.money,

  // 收获物背包：{ [cropId]: count } — 用于出售
  inventory: {},

  // 种子背包：{ [cropId]: count } — 用于种植
  seeds: {},

  // 当前选择的工具/种子
  selectedTool: 'hoe',

  /** 初始化 */
  init() {
    this.stamina = this.maxStamina;
    this.money = DATA.PLAYER_START.money;
    this.inventory = {};
    this.seeds = {
      wheat: 5,  // 开局送 5 个小麦种子
    };
    this.selectedTool = 'hoe';
  },

  /** 消耗体力（不再拦截：可一直扣到 0，由自动恢复慢慢回血） */
  spendStamina(amount) {
    this.stamina = Math.max(0, this.stamina - amount);
    return true;
  },

  /** 缓慢自动恢复体力（每游戏分钟调用一次） */
  regenStamina(rate) {
    if (!rate || rate <= 0) return;
    this.stamina = Math.min(this.maxStamina, this.stamina + rate);
  },

  /** 退还体力（操作取消时返还，不超过上限） */
  refundStamina(amount) {
    this.stamina = Math.min(this.maxStamina, this.stamina + amount);
  },

  /** 恢复体力（睡觉） */
  restoreStamina() {
    this.stamina = this.maxStamina;
  },

  /** 加钱 */
  addMoney(amount) {
    this.money += amount;
  },

  /** 扣钱 */
  spendMoney(amount) {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  },

  /** 收获物添加 */
  addToInventory(cropId, count) {
    this.inventory[cropId] = (this.inventory[cropId] || 0) + count;
  },

  /** 收获物清空 */
  clearInventory() {
    this.inventory = {};
  },

  /** 计算收获物出售总价 */
  getInventorySellValue() {
    let total = 0;
    for (const [cropId, count] of Object.entries(this.inventory)) {
      const def = DATA.CROPS[cropId];
      if (def) total += def.sellPrice * count;
    }
    return total;
  },

  /** 收获物总数 */
  getInventoryCount() {
    return Object.values(this.inventory).reduce((a, b) => a + b, 0);
  },

  /** 种子操作 */
  addSeeds(cropId, count) {
    this.seeds[cropId] = (this.seeds[cropId] || 0) + count;
  },

  hasSeed(cropId) {
    return (this.seeds[cropId] || 0) > 0;
  },

  useSeed(cropId) {
    const cur = this.seeds[cropId] || 0;
    if (cur <= 0) return false;
    this.seeds[cropId] = cur - 1;
    if (this.seeds[cropId] <= 0) delete this.seeds[cropId];
    return true;
  },

  /** 种子总数 */
  getSeedCount() {
    return Object.values(this.seeds).reduce((a, b) => a + b, 0);
  },

  /** 设置工具 */
  selectTool(toolId) {
    this.selectedTool = toolId;
  },
};
