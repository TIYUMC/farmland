/**
 * savegame.js — 游戏存档/读档系统
 * 职责：将游戏状态序列化到 localStorage，并在需要时还原。
 *
 * 保存范围：
 *   Engine.year / season / day / hour / minute
 *   Player.stamina / money / inventory(seeds) / seeds / wood / planks / acorns
 *         / ownedTools / questsDone / _hotbarSlots / _hotbarSel
 *   Farm.grid / grass / bare / dirt / flowers
 *   TreeFarm.trees / rooted / grass / bare / dirt
 *
 * 自动存档时机：
 *   1. 每日结束（onDayEnd → 睡觉结算）
 *   2. 玩家手动点击「存档」按钮
 *
 * 手动读档：
 *   主页面已无「读档」按钮（已移除）；标题页为 3 槽存档列表（mc-btn 同款按钮），
 *   有档槽点下直接读入该槽、空槽点下 confirm 后开新游戏落该槽，见 main.js _renderTitleSlots。
 *
 * 槽位化：
 *   槽 1 沿用老 key 'stardew_save_v1'（老玩家存档原地识别，不迁移不丢）；
 *   槽 2/3 用新 key。save/load/hasSave/getSummary 均参数化 slot、缺省取 currentSlot，
 *   故自动存（onDayEnd）/手动存/关页静默存（均无参调用）自动落到"正在玩的那份档"。
 *
 * 任务书可读化批次：头部补全「方法清单」字段（纯注释，零代码改动）
 * 方法清单：
 *   - STORAGE_KEY
 *   - SLOT_KEYS
 *   - currentSlot
 *   - save
 *   - saveAndSleep
 *   - load
 *   - hasSave
 *   - getSummary
 *   - listSlots
 *   - _serialize
 *   - _deserialize
 *
 */

const SaveGame = {
  // ─────────────────────────────────────────────
  // 槽位常量 / 当前槽
  // ─────────────────────────────────────────────
  STORAGE_KEY: 'stardew_save_v1',
  /** 槽位 key 表：槽 1 沿用老 key（不迁移），槽 2/3 新 key */
  SLOT_KEYS: { 1: 'stardew_save_v1', 2: 'stardew_save_v2_slot', 3: 'stardew_save_v3_slot' },
  /** 当前操作的槽：load(slot) 成功或开新游戏落槽时刷新；无参 save/hasSave/getSummary 缺省取它 */
  currentSlot: 1,

  // ─────────────────────────────────────────────
  // ① 保存
  // ─────────────────────────────────────────────
  /** 保存当前游戏状态到指定槽（缺省 currentSlot）。自动存/手动存/关页静默存均无参调用，自动落当前槽 */
  save(slot) {
    if (slot === undefined || slot === null) slot = this.currentSlot;
    this.currentSlot = slot;
    const data = this._serialize();
    const key = this.SLOT_KEYS[slot];
    if (!key) { console.error('[SaveGame] 未知槽位:', slot); return false; }
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
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
  /** 从指定槽（缺省 currentSlot）读取存档并还原游戏状态，返回是否成功 */
  load(slot) {
    if (slot === undefined || slot === null) slot = this.currentSlot;
    const key = this.SLOT_KEYS[slot];
    if (!key) {
      if (typeof UI !== 'undefined' && typeof UI.showStatus === 'function') UI.showStatus('未知存档槽', 2000);
      return false;
    }
    const raw = window.localStorage.getItem(key);
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
    this.currentSlot = slot;   // 记下当前操作槽：后续无参 save/关页静默存自动落这份档
    if (typeof UI !== 'undefined') {
      if (typeof UI.showStatus === 'function') UI.showStatus('读档成功！', 1000);
      // 注意：不在这里调用 UI.render()，避免在缓存清除前渲染旧数据
      // 由调用方（main.js _continueGame）负责在清除缓存后渲染
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
  /** 判断指定槽（缺省 currentSlot）是否有存档 */
  hasSave(slot) {
    if (slot === undefined || slot === null) slot = this.currentSlot;
    const key = this.SLOT_KEYS[slot];
    return !!key && !!window.localStorage.getItem(key);
  },

  // ─────────────────────────────────────────────
  // 摘要 / 槽列表
  // ─────────────────────────────────────────────
  /**
   * 返回存档摘要（"秋3日 第1年 · 10/3"，末尾为 ts 转本地日期短格式）。
   * 原供读档确认弹窗使用，该弹窗已移除；现供标题页槽位列表显示（listSlots 调用）。
   * 无档/损坏返回 null。
   */
  getSummary(slot) {
    if (slot === undefined || slot === null) slot = this.currentSlot;
    const key = this.SLOT_KEYS[slot];
    if (!key) return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      const e = d.engine || {};
      const seasonNames = ['春', '夏', '秋', '冬'];
      const seasonIdx = parseInt(e.season, 10);
      const seasonName = seasonNames[seasonIdx] || '?';
      let s = `${seasonName}${e.day || '?'}日 第${e.year || '?'}年`;
      if (d.ts) {
        const dt = new Date(d.ts);
        if (!isNaN(dt.getTime())) s += ` · ${dt.getMonth() + 1}/${dt.getDate()}`;
      }
      return s;
    } catch { return null; }
  },

  /**
   * 列出 3 个槽的状态，供标题页渲染：
   * [{ slot, has, summary, ts }, ...]
   * summary 为「秋3日 第1年 · 10/3」格式（getSummary），ts 读存档 JSON 里现成的 data.ts。
   */
  listSlots() {
    const out = [];
    for (let n = 1; n <= 3; n++) {
      const key = this.SLOT_KEYS[n];
      let has = false, summary = null, ts = null;
      if (key && window.localStorage.getItem(key)) {
        has = true;
        summary = this.getSummary(n);
        try {
          const d = JSON.parse(window.localStorage.getItem(key));
          ts = d && typeof d.ts === 'number' ? d.ts : null;
        } catch { /* 损坏档：只标记 has，摘要留空 */ }
      }
      out.push({ slot: n, has: has, summary: summary, ts: ts });
    }
    return out;
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
        _allOrder: Player?._allOrder ?? [],
        wood: Player?.wood ?? 0,
        planks: Player?.planks ?? 0,
        acorns: Player?.acorns ?? 0,
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
      Player._allOrder  = p._allOrder ?? [];
      Player.wood       = p.wood      ?? 0;
      Player.planks     = p.planks    ?? 0;
      Player.acorns     = p.acorns    ?? 0;
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
      // B3：旧档可能缺 flowers/grass/bare/dirt 字段、或存成 1D/行数不对的残形 → 按 init 形状重建 2D 矩阵，
      // 次日 grassStep/flowerStep 逐格访问才不会 Cannot read properties of undefined。
      const _fb2d = (rows, cols, v) => { const m = []; for (let r = 0; r < rows; r++) { m.push(new Array(cols).fill(v)); } return m; };
      const _ok2d = (m, rows) => Array.isArray(m) && Array.isArray(m[0]) && m.length === rows && m.every(row => row.length === Farm.COLS);
      Farm.grass   = _ok2d(f.grass,   Farm.ROWS) ? f.grass   : _fb2d(Farm.ROWS, Farm.COLS, 0);
      Farm.bare    = _ok2d(f.bare,    Farm.ROWS) ? f.bare    : _fb2d(Farm.ROWS, Farm.COLS, false);
      Farm.dirt    = _ok2d(f.dirt,    Farm.ROWS) ? f.dirt    : _fb2d(Farm.ROWS, Farm.COLS, false);
      Farm.flowers = _ok2d(f.flowers, Farm.ROWS) ? f.flowers : _fb2d(Farm.ROWS, Farm.COLS, 0);
    }

    // TreeFarm
    if (TreeFarm && tf.trees) {
      TreeFarm.trees   = tf.trees;
      const _tb2d = (rows, cols, v) => { const m = []; for (let r = 0; r < rows; r++) { m.push(new Array(cols).fill(v)); } return m; };
      const _tok2d = (m) => Array.isArray(m) && Array.isArray(m[0]) && m.length === TreeFarm.ROWS && m.every(row => row.length === TreeFarm.COLS);
      TreeFarm.rooted  = _tok2d(tf.rooted) ? tf.rooted : _tb2d(TreeFarm.ROWS, TreeFarm.COLS, false);
      TreeFarm.grass   = _tok2d(tf.grass)  ? tf.grass  : _tb2d(TreeFarm.ROWS, TreeFarm.COLS, 0);
      TreeFarm.bare    = _tok2d(tf.bare)   ? tf.bare   : _tb2d(TreeFarm.ROWS, TreeFarm.COLS, false);
      TreeFarm.dirt    = _tok2d(tf.dirt)   ? tf.dirt   : _tb2d(TreeFarm.ROWS, TreeFarm.COLS, false);
    }

    // 清缓存，确保地图按新季节重新渲染
    if (typeof UI !== 'undefined') {
      UI._farmDirty = true;
    }
  },
};
