/**
 * quest.js — 任务书（Advancement）进度系统
 * 职责：累计玩家行为事件、按 track 自动点亮任务、供 UI 渲染读取完成态。
 * 数据驱动：任务树定义见 data.js 的 DATA.QUESTS。
 *
 * 埋点约定（各模块成功动作后调用，全部用 typeof Quest 守卫，零回归风险）：
 *   Farm.till/plant/harvest  → Quest.trigger('till'|'plant'|'harvest', count)
 *   TreeFarm.chop/plantSapling → Quest.trigger('chop'|'plantSapling')
 *   Player.addWood           → Quest.trigger('wood', amount)
 *   Player.addMoney          → Quest.trigger('earn', amount)
 *   Economy.buyTool         → Quest.trigger('ownTool', toolId)
 */
const Quest = {
  // 各事件累计次数 / 总量
  stats: {},

  /** 玩家已完成任务集合（挂在 Player.questsDone，刷新即重置，与游戏整体无存档一致） */
  _done() {
    return (typeof Player !== 'undefined' && Player.questsDone) || {};
  },

  /** 重置进度（Player.init 时调用） */
  reset() {
    this.stats = {};
    if (typeof Player !== 'undefined') Player.questsDone = {};
  },

  /**
   * 触发一个行为事件：累加 stats[type]，并立即评估所有任务是否达成。
   * n = 本次增量（默认 1），收获/卖钱/木头传实际数量。
   */
  trigger(type, n) {
    const inc = (typeof n === 'number') ? n : 1;
    this.stats[type] = (this.stats[type] || 0) + inc;
    this._evaluate();
  },

  /** 遍历任务树，满足 track 的标记为完成 */
  _evaluate() {
    const quests = (typeof DATA !== 'undefined' && DATA.QUESTS) || [];
    const done = this._done();
    let changed = false;
    for (const q of quests) {
      if (done[q.id]) continue;
      if (this._meets(q.track)) {
        done[q.id] = true;
        changed = true;
        this._announce(q);
      }
    }
    if (changed) {
      if (typeof Player !== 'undefined') Player.questsDone = done;
      // 任务书开着则实时刷新
      if (typeof globalThis.UI !== 'undefined' && globalThis.UI._questOpen && globalThis.UI._renderQuest) globalThis.UI._renderQuest();
    }
  },

  /** 判定单个 track 是否满足 */
  _meets(track) {
    if (!track) return false;
    if (track.k === 'manual') return false; // 手动解锁成就：绝不自动完成，只能由 _claim 点亮
    if (track.k === 'submit') return false; // 提交型：需持有物品并点击领取，绝不自动完成
    if (track.k === 'always') return true;
    if (track.k === 'ownTool') {
      return !!(typeof Player !== 'undefined' && Player.ownedTools && Player.ownedTools[track.tool]);
    }
    // 累计型：stats[track.k] >= track.n
    const v = this.stats[track.k] || 0;
    return v >= (track.n || 1);
  },

  /** 是否已完成（always 型即便未标记也视为完成，开局即亮） */
  isDone(id) {
    const done = this._done();
    if (done[id]) return true;
    const quests = (typeof DATA !== 'undefined' && DATA.QUESTS) || [];
    const q = quests.find(x => x.id === id);
    return !!(q && q.track && q.track.k === 'always');
  },

  /** 达成提示 */
  _announce(q) {
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI.showStatus) {
      globalThis.UI.showStatus('🌟 任务达成：' + q.title, 1600);
    }
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI.showAchievement) {
      globalThis.UI.showAchievement(q.title, 'nether_star', 3500);
    }
  },

  // ─────────────────────────────────────────────
  // 手动解锁成就（FTB 风格：点节点弹「领取奖励」→ 校验前置 → 发奖）
  // ─────────────────────────────────────────────
  /** 该手动成就当前是否可领取（前置全部完成） */
  _manualClaimable(q) {
    if (!q) return false;
    const pre = [];
    if (q.parent) pre.push(q.parent);
    if (Array.isArray(q.prereq)) pre.push.apply(pre, q.prereq); // 支持显式前置数组
    if (!pre.every(pid => this.isDone(pid))) return false;
    // 提交型：还需持有足够物品
    if (q.track && q.track.k === 'submit') {
      if (!this._hasItems(q.track.item, q.track.n)) return false;
    }
    return true;
  },

  /** 领取一个手动成就：校验前置 → 标记完成 → 发奖 → 重渲染 → 提示 */
  claim(id) {
    const q = (typeof DATA !== 'undefined' && DATA.QUESTS) ? DATA.QUESTS.find(x => x.id === id) : null;
    if (!q) return false;
    if (!q.manual) return false;
    if (this.isDone(id)) return false;
    if (!this._manualClaimable(q)) return false;
    // 提交型：先扣交出的物品（不足则拒，理论上 _manualClaimable 已拦）
    if (q.track && q.track.k === 'submit') {
      if (!this._takeItems(q.track.item, q.track.n)) return false;
    }
    if (typeof Player !== 'undefined') Player.questsDone[id] = true;
    this._grantReward(q.reward);
    // 提交消耗了物品：背包若开着则实时刷新
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen && globalThis.UI.renderInventory) {
      globalThis.UI.renderInventory();
    }
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._questOpen && globalThis.UI._renderQuest) globalThis.UI._renderQuest();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI.showStatus) globalThis.UI.showStatus('成就达成：' + q.title, 1600);
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI.showAchievement) globalThis.UI.showAchievement(q.title, 'nether_star', 3500);
    return true;
  },

  /** 发放奖励（money 直接加钱；items 逐条映射 Player 聚合） */
  _grantReward(reward) {
    if (!reward || typeof Player === 'undefined') return;
    if (reward.money) Player.addMoney(reward.money);
    if (reward.items) for (const it of reward.items) this._grantItem(it);
  },

  /** 单条奖励物品 → Player 字段（money/wood/planks/saplings/axe/seed:<crop>/crop:<crop>） */
  _grantItem(it) {
    if (!it || typeof Player === 'undefined') return;
    const id = it.id, n = it.count || 1;
    if (id === 'money') Player.addMoney(n);
    else if (id === 'wood') Player.addWood(n);
    else if (id === 'planks') Player.addPlanks(n);
    else if (id === 'saplings') Player.addSaplings(n);
    else if (id === 'axe') {
      Player.ownedTools.axe = true;
      if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen && globalThis.UI.renderInventory) globalThis.UI.renderInventory();
    }
    else if (id.indexOf('seed:') === 0) {
      const seedId = id.slice(5);
      Player.addSeeds(seedId, n);
      // 直接重建背包缓存，确保种子立即显示
      Player._rebuildInvSlots();
      // 无条件刷新背包显示（不管开没开）
      if (typeof globalThis.UI !== 'undefined' && globalThis.UI.renderInventory) {
        globalThis.UI.renderInventory();
      }
    }
    else if (id.indexOf('crop:') === 0) Player.addToInventory(id.slice(5), n);
  },

  /** 玩家是否持有足够物品（提交型任务判定用） */
  _hasItems(item, n) {
    if (!item || typeof Player === 'undefined') return false;
    const need = n || 1;
    if (item === 'money') return Player.money >= need;
    if (item === 'wood') return Player.wood >= need;
    if (item === 'planks') return Player.planks >= need;
    if (item === 'saplings') return Player.saplings >= need;
    if (item.indexOf('seed:') === 0) return (Player.seeds[item.slice(5)] || 0) >= need;
    if (item.indexOf('crop:') === 0) return (Player.inventory[item.slice(5)] || 0) >= need;
    return false;
  },

  /** 扣除交出的物品（提交型任务领取时调用；不足返回 false 不扣） */
  _takeItems(item, n) {
    if (!item || typeof Player === 'undefined') return false;
    const need = n || 1;
    if (item === 'money') { if (Player.money < need) return false; Player.money -= need; return true; }
    if (item === 'wood') { if (Player.wood < need) return false; Player.wood -= need; return true; }
    if (item === 'planks') { if (Player.planks < need) return false; Player.planks -= need; return true; }
    if (item === 'saplings') { if (Player.saplings < need) return false; Player.saplings -= need; return true; }
    if (item.indexOf('seed:') === 0) {
      const c = item.slice(5), cur = Player.seeds[c] || 0;
      if (cur < need) return false;
      Player.seeds[c] = cur - need; if (Player.seeds[c] <= 0) delete Player.seeds[c];
      return true;
    }
    if (item.indexOf('crop:') === 0) {
      const c = item.slice(5), cur = Player.inventory[c] || 0;
      if (cur < need) return false;
      Player.inventory[c] = cur - need; if (Player.inventory[c] <= 0) delete Player.inventory[c];
      return true;
    }
    return false;
  },

  /** 当前持有某物品数量（弹窗显示进度用） */
  _itemCount(item) {
    if (!item || typeof Player === 'undefined') return 0;
    if (item === 'money') return Player.money;
    if (item === 'wood') return Player.wood;
    if (item === 'planks') return Player.planks;
    if (item === 'saplings') return Player.saplings;
    if (item.indexOf('seed:') === 0) return Player.seeds[item.slice(5)] || 0;
    if (item.indexOf('crop:') === 0) return Player.inventory[item.slice(5)] || 0;
    return 0;
  },

  /** 物品中文名（弹窗显示用） */
  _itemName(item) {
    if (item === 'money') return '金锭';
    if (item === 'wood') return '木头';
    if (item === 'planks') return '木板';
    if (item === 'saplings') return '树苗';
    if (item.indexOf('seed:') === 0) { const d = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[item.slice(5)] : null; return d ? (d.name + '种子') : '种子'; }
    if (item.indexOf('crop:') === 0) { const d = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[item.slice(5)] : null; return d ? d.name : '作物'; }
    return item;
  },
};

if (typeof window !== 'undefined') window.Quest = Quest;
if (typeof globalThis !== 'undefined') globalThis.Quest = Quest;
