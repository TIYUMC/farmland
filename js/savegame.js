/**
 * savegame.js — 游戏存档/读档系统
 * 职责：将游戏状态序列化到 localStorage，并在需要时还原。
 *
 * 保存范围：
 *   Engine.year / season / day / hour / minute
 *   Player.stamina / money / inventory(seeds) / seeds / wood / planks / saplings
 *         / ownedTools / questsDone / _hotbarSlots / _hotbarSel
 *   Farm.grid / grass / bare / dirt / flowers
 *   TreeFarm.trees / rooted / grass / bare / dirt
 *
 * 自动存档时机：
 *   1. 每日结束（onDayEnd → 睡觉结算）
 *   2. 玩家手动点击「存档」按钮
 *
 * 手动读档：
 *   点击「读档」按钮后，若本地有存档则弹确认框；确认后覆盖当前进度。
 */

const SaveGame = {
  STORAGE_KEY: 'stardew_save_v1',

  // ─────────────────────────────────────────────
  // ① 保存
  // ─────────────────────────────────────────────
  /** 保存当前游戏状态到 localStorage */
  save() {
    const data = this._serialize();
    try {
      window.localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      if (typeof UI !== 'undefined' && typeof UI.showStatus === 'function') UI.showStatus('存档成功！', 1000);
      return true;
    } catch (e) {
      console.error('[SaveGame] 保存失败:', e);
      if (typeof UI !== 'undefined' && typeof UI.showStatus === 'function') UI.showStatus('存档失败', 2000);
      return false;
    }
  },

  /** 保存并立即结束当天（存档 + 睡觉，仅当晚 6 点后有效） */
  saveAndSleep() {
    const ok = this.save();
    if (ok && typeof Engine !== 'undefined') Engine.sleep();
    return ok;
  },

  // ─────────────────────────────────────────────
  // ② 读档
  // ─────────────────────────────────────────────
  /** 从 localStorage 读取存档并还原游戏状态，返回是否成功 */
  load() {
    const raw = window.localStorage.getItem(this.STORAGE_KEY);
    if (!raw) {
      if (typeof UI !== 'undefined' && typeof UI.showStatus === 'function') UI.showStatus('没有找到存档', 2000);
      return false;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('[SaveGame] 存档解析失败:', e);
      if (typeof UI !== 'undefined' && typeof UI.showStatus === 'function') UI.showStatus('存档损坏', 2000);
      return false;
    }
    this._deserialize(data);
    if (typeof UI !== 'undefined') {
      if (typeof UI.showStatus === 'function') UI.showStatus('读档成功！', 1000);
      // 刷新游戏主场景（canvas）
      if (typeof UI.render === 'function') UI.render();
      // 若背包打开则刷新背包面板
      if (UI._inventoryOpen && typeof UI.renderInventory === 'function') UI.renderInventory();
      // 若任务书打开则刷新任务书
      if (UI._questOpen && typeof UI._renderQuest === 'function') UI._renderQuest();
    }
    return true;
  },

  // ─────────────────────────────────────────────
  // ③ 检查
  // ─────────────────────────────────────────────
  /** 判断是否有存档可用 */
  hasSave() {
    return !!window.localStorage.getItem(this.STORAGE_KEY);
  },

  /** 返回存档摘要（供 UI 显示在读档确认弹窗中） */
  getSummary() {
    const raw = window.localStorage.getItem(this.STORAGE_KEY);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const e = d.engine || {};
      const seasonNames = ['春', '夏', '秋', '冬'];
      const seasonIdx = parseInt(e.season, 10);
      const seasonName = seasonNames[seasonIdx] || '?';
      return `${seasonName}${e.day || '?'}日 第${e.year || '?'}年`;
    } catch { return null; }
  },

  // ─────────────────────────────────────────────
  // ④ 序列化 / 反序列化
  // ─────────────────────────────────────────────
  _serialize() {
    return {
      version: 1,
      ts: Date.now(),
      engine: {
        year: Engine?.year ?? 1,
        season: Engine?.season ?? 0,   // int: 0=spring,1=summer,2=fall,3=winter
        day: Engine?.day ?? 1,
        hour: Engine?.hour ?? DATA.START_HOUR,
        minute: Engine?.minute ?? 0,
      },
      player: {
        stamina: Player?.stamina ?? 20,
        money: Player?.money ?? 0,
        // inventory / seeds 是聚合格式 {wheat: N}，由 _rebuildInvSlots 重建 invSlots
        inventory: Player?.inventory ?? {},
        seeds: Player?.seeds ?? {},
        wood: Player?.wood ?? 0,
        planks: Player?.planks ?? 0,
        saplings: Player?.saplings ?? 0,
        ownedTools: Player?.ownedTools ?? {},
        questsDone: Player?.questsDone ?? {},
        _hotbarSlots: Player?._hotbarSlots ?? null,
        _hotbarSel: Player?._hotbarSel ?? 0,
      },
      farm: {
        grid: Farm?.grid ?? null,
        grass: Farm?.grass ?? null,
        bare: Farm?.bare ?? null,
        dirt: Farm?.dirt ?? null,
        flowers: Farm?.flowers ?? null,
      },
      treefarm: {
        trees: TreeFarm?.trees ?? null,
        rooted: TreeFarm?.rooted ?? null,
        grass: TreeFarm?.grass ?? null,
        bare: TreeFarm?.bare ?? null,
        dirt: TreeFarm?.dirt ?? null,
      },
    };
  },

  _deserialize(data) {
    const p = data.player || {};
    const e = data.engine || {};
    const f = data.farm || {};
    const tf = data.treefarm || {};

    // Engine
    if (Engine) {
      Engine.year       = e.year       ?? 1;
      Engine.season     = e.season     ?? 0;
      Engine.day        = e.day        ?? 1;
      Engine.hour       = e.hour       ?? DATA.START_HOUR;
      Engine.minute     = e.minute     ?? 0;
      Engine.running    = true;
      Engine.paused     = false;
    }

    // Player — 不恢复 invSlots（由 _rebuildInvSlots 从聚合重建）
    if (Player) {
      Player.stamina    = p.stamina   ?? 20;
      Player.money      = p.money     ?? 0;
      Player.inventory  = p.inventory ?? {};
      Player.seeds      = p.seeds     ?? {};
      Player.wood       = p.wood      ?? 0;
      Player.planks     = p.planks    ?? 0;
      Player.saplings   = p.saplings  ?? 0;
      Player.ownedTools = p.ownedTools ?? {};
      Player.questsDone = p.questsDone ?? {};
      Player._hotbarSlots = p._hotbarSlots ?? null;
      Player._hotbarSel   = p._hotbarSel   ?? 0;
      // 重建背包视图
      if (typeof Player._rebuildInvSlots === 'function') Player._rebuildInvSlots();
    }

    // Farm
    if (Farm && f.grid) {
      Farm.grid    = f.grid;
      Farm.grass   = f.grass || [];
      Farm.bare    = f.bare  || [];
      Farm.dirt    = f.dirt  || [];
      Farm.flowers = f.flowers || [];
    }

    // TreeFarm
    if (TreeFarm && tf.trees) {
      TreeFarm.trees   = tf.trees;
      TreeFarm.rooted  = tf.rooted || [];
      TreeFarm.grass   = tf.grass  || [];
      TreeFarm.bare    = tf.bare   || [];
      TreeFarm.dirt    = tf.dirt   || [];
    }

    // 清缓存，确保地图按新季节重新渲染
    if (typeof UI !== 'undefined') {
      UI._farmDirty = true;
    }
  },
};
