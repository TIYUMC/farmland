/**
 * player.js — 玩家管理
 * 职责：体力、金钱、背包（收获物/种子）、资源（木头/树苗）、工具选择。
 *
 * ── 结构导航 ──
 *   ① 初始化       init
 *   ② 体力         spendStamina / regenStamina / refundStamina / restoreStamina
 *   ③ 金钱         addMoney / spendMoney
 *   ④ 资源(木/苗)  addWood / addSaplings / hasSapling / useSapling
 *   ⑤ 工具         ownsTool / selectTool
 *   ⑥ 收获物背包   addToInventory / clearInventory / getInventorySellValue / getInventoryCount
 *   ⑦ 种子         addSeeds / hasSeed / useSeed / getSeedCount
 */
const Player = {
  stamina: DATA.PLAYER_START.stamina,
  maxStamina: DATA.PLAYER_START.maxStamina,
  money: DATA.PLAYER_START.money,

  // 资源：木头（砍树获得，暂只产不出；为后续建造/经济闭环铺路）
  wood: 0,

  // 资源：树苗（砍树掉落 1~3 个，可在树场种回；形成「砍树→得树苗→种树场→再砍」循环）
  saplings: 0,

  // 已拥有工具：木斧头需先在商店购买（200 金锭），未购买则无法装备/砍树。
  // 注意：锄头/水桶开局即拥有，不在此登记。
  ownedTools: {},

  // 收获物背包：{ [cropId]: count } — 用于出售
  inventory: {},

  // 种子背包：{ [cropId]: count } — 用于种植
  seeds: {},

  // 当前选择的工具/种子
  selectedTool: 'hoe',

  // ─────────────────────────────────────────────
  // ① 初始化
  // ─────────────────────────────────────────────
  /** 初始化 */
  init() {
    this.stamina = this.maxStamina;
    this.money = DATA.PLAYER_START.money;
    this.wood = 0;
    this.saplings = 0; // 开局无树苗（需砍树获得）
    this.ownedTools = { axe: false }; // 木斧头开局不拥有，需商店购买
    this.inventory = {};
    this.seeds = {
      wheat: 5,  // 开局送 5 个小麦种子
    };
    this.selectedTool = 'hoe';
  },

  // ─────────────────────────────────────────────
  // ② 体力
  // ─────────────────────────────────────────────
  /** 消耗体力（不再拦截：可一直扣到 0，由自动恢复慢慢回血） */
  spendStamina(amount) {
    this.stamina = Math.max(0, this.stamina - amount);
    return true;
  },

  /** 增加体力并夹紧在 [0, maxStamina]（regenStamina / refundStamina 共用核心逻辑） */
  _addStamina(delta) {
    this.stamina = Math.min(this.maxStamina, this.stamina + delta);
  },

  /** 缓慢自动恢复体力（每游戏分钟调用一次） */
  regenStamina(rate) {
    if (!rate || rate <= 0) return;
    this._addStamina(rate);
  },

  /** 退还体力（操作取消时返还，不超过上限） */
  refundStamina(amount) { this._addStamina(amount); },

  /** 恢复体力（睡觉） */
  restoreStamina() {
    this.stamina = this.maxStamina;
  },

  // ─────────────────────────────────────────────
  // ③ 金钱
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // ④ 资源（木头/树苗）
  // ─────────────────────────────────────────────
  /** 加木头（砍树获得） */
  addWood(amount) {
    this.wood += (amount || 0);
  },

  /** 加树苗（砍树掉落） */
  addSaplings(amount) {
    this.saplings += (amount || 0);
  },

  /** 是否还有树苗可种 */
  hasSapling() {
    return this.saplings > 0;
  },

  /** 消耗 1 个树苗（种植时调用） */
  useSapling() {
    if (this.saplings <= 0) return false;
    this.saplings -= 1;
    return true;
  },

  // ─────────────────────────────────────────────
  // ⑤ 工具
  // ─────────────────────────────────────────────
  /** 是否已拥有某工具（如木斧头） */
  ownsTool(toolId) {
    return !!(this.ownedTools && this.ownedTools[toolId]);
  },

  // ─────────────────────────────────────────────
  // ⑥ 收获物背包
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // ⑦ 种子
  // ─────────────────────────────────────────────
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
