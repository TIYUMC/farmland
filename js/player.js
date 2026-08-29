/**
 * player.js — 玩家管理
 * 职责：体力、金钱、背包（收获物/种子）、资源（木头/木板/橡果）、工具选择。
 *
 * ── 结构导航 ──
 *   ① 初始化       init
 *   ② 体力         spendStamina / regenStamina / refundStamina / restoreStamina
 *   ③ 金钱         addMoney / spendMoney
 *   ④ 资源(木/板/果) addWood / addPlanks / addAcorns / hasAcorn / useAcorn
 *   ⑤ 工具         ownsTool / selectTool
 *   ⑥ 收获物背包   addToInventory / clearInventory / getInventorySellValue / getInventoryCount
 *   ⑦ 种子         addSeeds / hasSeed / useSeed / getSeedCount
 */
const Player = {
  stamina: DATA.PLAYER_START.stamina,
  maxStamina: DATA.PLAYER_START.maxStamina,
  money: DATA.PLAYER_START.money,

  // 资源：木头（砍树获得；可在背包 2×2 合成格制成木板，也是任务回收物）
  wood: 0,

  // 资源：木板（原木合成获得，1 原木 → 4 木板）
  planks: 0,

  // 任务书：已完成任务集合（刷新即重置，与游戏整体无存档一致）
  questsDone: {},

  // 资源：橡果（砍树掉落 1~3 个，可在树场种回；形成「砍树→得橡果→种树场→再砍」循环）
  acorns: 0,

  // 已拥有工具：木斧头需先在商店购买（20 金锭 + 5 小麦），未购买则无法装备/砍树。
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
    this.planks = 0; // 开局无木板（需砍树得原木后分解）
    this.acorns = 0; // 开局无橡果（需砍树获得）
    this.ownedTools = { axe: false }; // 木斧头开局不拥有，需商店购买
    this.inventory = {};
    this.seeds = {}; // 开局不送种子（仅锄头+水桶；种子由教程 tut1 奖励发放）
    this.selectedTool = 'hoe';

    // 背包布局模型（MC 风 36 格：0..26 主栏 + 27..35 快捷栏）
    // 注意：聚合(Player.money/wood/inventory/seeds/ownedTools…)仍是玩法权威；
    // invSlots 只是「背包内布局视图」，由 _rebuildInvSlots 从聚合重建，
    // 在背包内拖动/拆分只改 invSlots 排列，不直接动聚合（种子总数等由聚合保证）。
    this.invSlots = null;        // 长度 36：每格 null 或 {kind,key,label,count,toolId?,seedId?,stackId?}
    this._hotbarSlots = null;    // 长度 9：快捷栏持久布局（跨重开保留用户摆放），每格 null 或身份描述
    this._hotbarSel = 0;         // 当前选中的快捷栏格 0..8

    if (typeof Quest !== 'undefined') Quest.reset(); // 任务书：开局清进度
  },

  // ─────────────────────────────────────────────
  // ⑧ 背包布局（MC 物品栏视图模型）
  // ─────────────────────────────────────────────
  /** 默认快捷栏布局（开局一次，之后由 _hotbarSlots 持久化用户摆放） */
  _defaultHotbarSlots() {
    const hb = [null, null, null, null, null, null, null, null, null];
    hb[0] = { kind: 'tool', toolId: 'hoe' };
    hb[1] = { kind: 'tool', toolId: 'water' };
    if (this.ownsTool('axe')) hb[2] = { kind: 'tool', toolId: 'axe' };
    if ((this.seeds && this.seeds.wheat) > 0) hb[4] = { kind: 'seed', seedId: 'wheat' };
    return hb;
  },

  /** 快捷栏是否已放置某工具身份 */
  _hbHasTool(toolId) {
    return !!(this._hotbarSlots && this._hotbarSlots.some(s => s && s.kind === 'tool' && s.toolId === toolId));
  },
  /** 快捷栏是否已放置某种子身份 */
  _hbHasSeed(seedId) {
    return !!(this._hotbarSlots && this._hotbarSlots.some(s => s && s.kind === 'seed' && s.seedId === seedId));
  },
  /** 将新工具自动放入快捷栏第一个空位（不覆盖已有项） */
  _ensureToolInHotbar(toolId) {
    if (!this._hotbarSlots) this._hotbarSlots = this._defaultHotbarSlots();
    if (this._hbHasTool(toolId)) return;
    const map = { hoe: { key: 'wooden_hoe', label: '锄头' }, water: { key: 'water_bucket', label: '水桶' }, axe: { key: 'wooden_axe', label: '斧头' }, acorn: { key: 'acorn', label: '橡果' } };
    const m = map[toolId] || { key: toolId, label: toolId };
    for (let i = 0; i < 9; i++) {
      if (!this._hotbarSlots[i]) {
        this._hotbarSlots[i] = { kind: 'tool', toolId };
        break;
      }
    }
  },
  /** 将新种子自动放入快捷栏第一个空位（不覆盖已有项） */
  _ensureSeedInHotbar(seedId) {
    if (!this._hotbarSlots) this._hotbarSlots = this._defaultHotbarSlots();
    if (this._hbHasSeed(seedId)) return;
    for (let i = 0; i < 9; i++) {
      if (!this._hotbarSlots[i]) {
        this._hotbarSlots[i] = { kind: 'seed', seedId };
        break;
      }
    }
  },

  /** 由身份描述(或 null)生成一个可渲染的槽位对象（工具/种子 count 为动态显示值） */
  _slotFromIdentity(id) {
    if (!id) return null;
    if (id.kind === 'tool') {
      const map = { hoe: { key: 'wooden_hoe', label: '锄头' }, water: { key: 'water_bucket', label: '水桶' }, axe: { key: 'wooden_axe', label: '斧头' }, acorn: { key: 'acorn', label: '橡果' } };
      const m = map[id.toolId] || { key: '', label: id.toolId };
      return { kind: 'tool', toolId: id.toolId, key: m.key, label: m.label, count: id.toolId === 'acorn' ? (this.acorns || 0) : 1 };
    }
    if (id.kind === 'seed') {
      const def = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[id.seedId] : null;
      return { kind: 'seed', seedId: id.seedId, key: UI._seedIconKey(id.seedId), label: def ? def.name : id.seedId, count: (this.seeds && this.seeds[id.seedId]) || 0 };
    }
    if (id.kind === 'stack') {
      return { kind: 'stack', stackId: id.stackId, key: id.key, label: id.label, count: this._stackCountFromAgg(id.stackId) };
    }
    return null;
  },

  /** 由 stackId 反查聚合里的真实数量（money/wood/planks/crop:xxx 实时同步，避免背包内数字过期） */
  _stackCountFromAgg(stackId) {
    if (stackId === 'money') return this.money;
    if (stackId === 'wood') return this.wood;
    if (stackId === 'planks') return this.planks;
    if (stackId.indexOf('crop:') === 0) {
      const cid = stackId.slice(5);
      return (this.inventory && this.inventory[cid]) || 0;
    }
    return 0;
  },

  /** 由槽位对象提取其身份描述（用于持久化 _hotbarSlots，丢弃临时 count） */
  _identityFromSlot(s) {
    if (!s) return null;
    if (s.kind === 'tool') return { kind: 'tool', toolId: s.toolId };
    if (s.kind === 'seed') return { kind: 'seed', seedId: s.seedId };
    if (s.kind === 'stack') return { kind: 'stack', stackId: s.stackId, key: s.key, label: s.label };
    return null;
  },

  /** 从聚合重建 36 格背包布局（开背包时调用一次；快捷栏用持久化的 _hotbarSlots，主栏用聚合） */
  _rebuildInvSlots() {
    if (!this._hotbarSlots) this._hotbarSlots = this._defaultHotbarSlots();
    const inv = new Array(36).fill(null);
    // 快捷栏：按持久布局还原
    for (let i = 0; i < 9; i++) inv[27 + i] = this._slotFromIdentity(this._hotbarSlots[i]);
    // 主栏：未进快捷栏的工具/种子 + 所有堆叠资源
    const main = [];
    const toolMap = { hoe: { key: 'wooden_hoe', label: '锄头' }, water: { key: 'water_bucket', label: '水桶' }, axe: { key: 'wooden_axe', label: '斧头' }, acorn: { key: 'acorn', label: '橡果' } };
    for (const t of ['hoe', 'water', 'axe', 'acorn']) {
      if (t === 'axe' && !this.ownsTool('axe')) continue;
      if (t === 'acorn' && !(this.acorns > 0)) continue;
      if (this._hbHasTool(t)) continue;
      main.push({ kind: 'tool', toolId: t, key: toolMap[t].key, label: toolMap[t].label, count: t === 'acorn' ? (this.acorns || 0) : 1 });
    }
    for (const sid of Object.keys(this.seeds || {})) {
      const c = this.seeds[sid]; if (!c || c <= 0) continue;
      if (this._hbHasSeed(sid)) continue;
      const def = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[sid] : null;
      main.push({ kind: 'seed', seedId: sid, key: UI._seedIconKey(sid), label: def ? def.name : sid, count: c });
    }
    const pushStacks = (stackId, key, label) => {
      const total = this._stackCountFromAgg(stackId);
      for (const n of UI._stackChunks(total)) main.push({ kind: 'stack', stackId, key, label, count: n });
    };
    for (const [cid, c] of Object.entries(this.inventory || {})) {
      if (!c || c <= 0) continue;
      const def = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[cid] : null;
      if (!def) continue;
      pushStacks('crop:' + cid, def.assetHarvest, def.name);
    }
    if (this.wood > 0) pushStacks('wood', 'oak_log_3d', '木头');
    if (this.planks > 0) pushStacks('planks', 'oak_planks_3d', '木板');
    if (this.money > 0) pushStacks('money', 'money', '金锭');
    for (let k = 0; k < main.length && k < 27; k++) inv[k] = main[k];
    this.invSlots = inv;
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
    if (typeof Quest !== 'undefined') Quest.trigger('earn', amount); // 任务书：小富即安
    // 重建背包缓存，确保金币出现在背包格子中
    this._rebuildInvSlots();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen) {
      globalThis.UI.renderInventory();
    }
  },

  /** 扣钱 */
  spendMoney(amount) {
    if (this.money < amount) return false;
    this.money -= amount;
    return true;
  },

  // ─────────────────────────────────────────────
  // ④ 资源（木头 / 木板 / 橡果）
  // ─────────────────────────────────────────────
  /** 加木头（砍树获得） */
  addWood(amount) {
    this.wood += (amount || 0);
    if (typeof Quest !== 'undefined') Quest.trigger('wood', amount); // 任务书：物资储备/林间建设者
  },

  /** 加橡果（砍树掉落） */
  addAcorns(amount) {
    this.acorns += (amount || 0);
    // 新增橡果时同步刷新背包布局，确保快捷栏/主栏可见
    if (typeof UI !== 'undefined' && UI._renderBottomHotbar) {
      this._rebuildInvSlots();
      UI._renderBottomHotbar();
    }
  },

  /** 加木板（原木合成获得，1 原木 → 4 木板） */
  addPlanks(amount) {
    this.planks += (amount || 0);
  },

  /** 是否还有橡果可种 */
  hasAcorn() {
    return this.acorns > 0;
  },

  /** 消耗 1 个橡果（种植时调用） */
  useAcorn() {
    if (this.acorns <= 0) return false;
    this.acorns -= 1;
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

// ─────────────────────────────────────────────
// 全局暴露（供 quest.js / UI 等模块跨文件访问）
// ─────────────────────────────────────────────
if (typeof window !== 'undefined') window.Player = Player;
if (typeof globalThis !== 'undefined') globalThis.Player = Player;
