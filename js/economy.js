/**
 * economy.js — 经济系统
 * 职责：商店购买（种子/工具）、作物出售、商店列表。
 *
 * ── 结构导航 ──
 *   ① 购买（种子） buySeed
 *   ② 出售        sellCropUnits
 *   ③ 购买（工具） canBuyTool / buyTool
 *   ④ 查询        getShopList
 */

const Economy = {
  // ─────────────────────────────────────────────
  // ① 购买（种子）
  // ─────────────────────────────────────────────
  /** 按 id 查商店条目（buySeed / canBuyTool 共用）；找不到返回 undefined */
  _findShopItem(id) {
    return DATA.SHOP_ITEMS.find(s => s.id === id);
  },

  /** 购买种子 */
  buySeed(seedId) {
    const item = this._findShopItem(seedId);
    if (!item) return { ok: false, reason: '未知种子' };
    if (Player.money < item.cost) return { ok: false, reason: '钱不够' };
    Player.spendMoney(item.cost);
    // 不可下地种植的「作物」（如橡果 growDays=0，属资源）入收获物背包，其余入种子背包
    const def = DATA.CROPS[seedId];
    if (def && !def.growDays) Player.addToInventory(seedId, 1);
    else Player.addSeeds(seedId, 1);
    return { ok: true, name: item.name };
  },

  // ─────────────────────────────────────────────
  // ② 出售
  // ─────────────────────────────────────────────
  /** 按数量出售指定作物（默认 1 个；不足则全卖），用于商店「每次成交卖 1 个」 */
  sellCropUnits(cropId, n) {
    const r = this._resolveSellable(cropId);
    if (!r.ok) return r;
    const sell = Math.min(n || 1, r.count);
    return this._applySale(cropId, sell, r);
  },

  /** 应用一次出售：加钱 + 按售出数量删除/递减背包作物，返回成交结果（sellCropUnits 共用，消除重复的 addMoney + inventory 改写 + 返回） */
  _applySale(cropId, sell, r) {
    const total = r.def.sellPrice * sell;
    Player.addMoney(total);
    if (sell >= r.count) delete Player.inventory[cropId];
    else Player.inventory[cropId] = r.count - sell;
    return { ok: true, total, count: sell, name: r.def.name };
  },

  /** 校验某作物是否可出售，返回 { ok:true, def, count } 或 { ok:false, reason }（供 sellCropUnits 复用） */
  _resolveSellable(cropId) {
    const count = Player.inventory[cropId];
    if (!count || count <= 0) return { ok: false, reason: '背包里没有该作物' };
    const def = DATA.CROPS[cropId];
    if (!def || def.sellPrice <= 0) return { ok: false, reason: '该作物不可出售' };
    return { ok: true, def, count };
  },

  // ─────────────────────────────────────────────
  // ④ 查询
  // ─────────────────────────────────────────────
  /** 获取种子商店可用列表 */
  getShopList() {
    return DATA.SHOP_ITEMS.map(item => ({
      ...item,
      canAfford: Player.money >= item.cost,
    }));
  },

  // ─────────────────────────────────────────────
  // ③ 购买（工具）
  // ─────────────────────────────────────────────
  /**
   * 校验能否购买工具（只检查不扣除），供 UI 画红叉 / 提示原因复用。
   * 工具价格 = item.cost 金锭 + item.costItems 里的附加材料（如木斧头要 5 个小麦）。
   */
  canBuyTool(toolId) {
    const item = this._findShopItem(toolId);
    if (!item || item.type !== 'tool') return { ok: false, reason: '商店没有该工具' };
    if (Player.ownedTools && Player.ownedTools[toolId]) return { ok: false, reason: '已经拥有该工具' };
    if (Player.money < item.cost) return { ok: false, reason: `金锭不足（需要 ${item.cost}）` };
    for (const need of (item.costItems || [])) {
      const have = Player.inventory[need.id] || 0;
      if (have < need.count) {
        const nm = (DATA.CROPS[need.id] && DATA.CROPS[need.id].name) || need.id;
        return { ok: false, reason: `${nm}不足（需要 ${need.count}，现有 ${have}）` };
      }
    }
    return { ok: true, item };
  },

  /** 购买工具（如木斧头）：扣除金锭 + 附加材料并标记为已拥有 */
  buyTool(toolId) {
    const chk = this.canBuyTool(toolId);
    if (!chk.ok) return chk;
    const item = chk.item;
    // 先整体校验通过（canBuyTool）才扣，避免扣了金锭却材料不够的半成交
    Player.spendMoney(item.cost);
    for (const need of (item.costItems || [])) {
      const left = (Player.inventory[need.id] || 0) - need.count;
      if (left > 0) Player.inventory[need.id] = left;
      else delete Player.inventory[need.id];
    }
    Player.ownedTools[toolId] = true;
    if (typeof Quest !== 'undefined') Quest.trigger('ownTool', toolId); // 任务书：工匠入门
    return { ok: true, name: item.name };
  },
};
