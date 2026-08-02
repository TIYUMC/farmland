/**
 * economy.js — 经济系统
 * 管理：商店、出售、每日结算
 */

const Economy = {
  /** 购买种子 */
  buySeed(seedId) {
    const item = DATA.SHOP_ITEMS.find(s => s.id === seedId);
    if (!item) return { ok: false, reason: '未知种子' };
    if (Player.money < item.cost) return { ok: false, reason: '钱不够' };
    Player.spendMoney(item.cost);
    Player.addSeeds(seedId, 1);
    return { ok: true, name: item.name };
  },

  /** 出售所有可出售的作物（种子不出售） */
  sellAll() {
    let total = 0;
    const soldItems = {};
    const toRemove = [];

    for (const [cropId, count] of Object.entries(Player.inventory)) {
      const def = DATA.CROPS[cropId];
      if (def && def.sellPrice > 0 && count > 0) {
        const value = def.sellPrice * count;
        total += value;
        soldItems[cropId] = count;
        toRemove.push(cropId);
      }
    }

    if (total <= 0) return { ok: false, reason: '背包里没有可出售的作物' };

    Player.addMoney(total);
    for (const id of toRemove) {
      delete Player.inventory[id];
    }
    return { ok: true, total, items: soldItems };
  },

  /** 出售指定作物（背包内单格卖出全部数量） */
  sellCrop(cropId) {
    const count = Player.inventory[cropId];
    if (!count || count <= 0) return { ok: false, reason: '背包里没有该作物' };
    const def = DATA.CROPS[cropId];
    if (!def || def.sellPrice <= 0) return { ok: false, reason: '该作物不可出售' };
    const total = def.sellPrice * count;
    Player.addMoney(total);
    delete Player.inventory[cropId];
    return { ok: true, total, count, name: def.name };
  },

  /** 按数量出售指定作物（默认 1 个；不足则全卖），用于商店「每次成交卖 1 个」 */
  sellCropUnits(cropId, n) {
    const count = Player.inventory[cropId];
    if (!count || count <= 0) return { ok: false, reason: '背包里没有该作物' };
    const def = DATA.CROPS[cropId];
    if (!def || def.sellPrice <= 0) return { ok: false, reason: '该作物不可出售' };
    const sell = Math.min(n || 1, count);
    const total = def.sellPrice * sell;
    Player.addMoney(total);
    if (sell >= count) delete Player.inventory[cropId];
    else Player.inventory[cropId] = count - sell;
    return { ok: true, total, count: sell, name: def.name };
  },

  /** 获取种子商店可用列表 */
  getShopList() {
    return DATA.SHOP_ITEMS.map(item => ({
      ...item,
      canAfford: Player.money >= item.cost,
    }));
  },
};
