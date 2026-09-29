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
  // 实际存量存 inventory['acorn']，此处用 getter/setter 承接历史调用点（addAcorns/hasAcorn/useAcorn/quest 等）
  get acorns() { return (this.inventory && this.inventory['acorn']) || 0; },
  set acorns(v) {
    if (!this.inventory) this.inventory = {};
    const n = Math.max(0, Math.floor(v || 0));
    if (n > 0) this.inventory['acorn'] = n;
    else delete this.inventory['acorn'];
  },

  // 已拥有工具：木斧头需先在商店购买（20 金锭 + 5 小麦），未购买则无法装备/砍树。
  // 注意：锄头/水桶开局即拥有，不在此登记。
  ownedTools: {},

  // 收获物背包：{ [cropId]: count } — 用于出售
  inventory: {},

  // 种子背包：{ [cropId]: count } — 用于种植
  seeds: {},

  // 物品获得顺序追踪（保持插入顺序，供 _rebuildInvSlots 使用）
  // 统一追踪所有物品类型，避免按类型分组导致的顺序错乱
  _allOrder: [],  // [{type:'seed'|'crop'|'resource', id:key}]

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
    this.ownedTools = { hoe: true, water: true, axe: false }; // 开局给锄头+水桶；斧头需商店购买
    this.inventory = {};
    this.seeds = {}; // 开局不送种子（仅锄头+水桶；种子由教程 tut1 奖励发放）
    this._allOrder = [];
    this.selectedTool = 'hoe';

    // 背包布局模型（MC 风 36 格：0..26 主栏 + 27..35 快捷栏）
    // 注意：聚合(Player.money/wood/inventory/seeds/ownedTools…)仍是玩法权威；
    // invSlots 只是「背包内布局视图」，由 _rebuildInvSlots 从聚合重建，
    // 在背包内拖动/拆分只改 invSlots 排列，不直接动聚合（种子总数等由聚合保证）。
    this.invSlots = null;        // 长度 36：每格 null 或 {kind,key,label,count,toolId?,seedId?,stackId?}
    this._hotbarSlots = null;    // 长度 9：快捷栏持久布局（跨重开保留用户摆放），每格 null 或身份描述
    this._hotbarSel = 0;         // 当前选中的快捷栏格 0..8
    this._selectedInvSlot = -1;  // 主背包中选中的格（-1表示无选中）
    this._reservedHotbarIdx = null; // 商店拖拽时保留的快捷栏槽位（防止重建时回填）
    this._pendingSeedBackfillSlot = null; // 等待种子补位的金锭槽位索引

    if (typeof Quest !== 'undefined') Quest.reset(); // 任务书：开局清进度
  },

  // ─────────────────────────────────────────────
  // ⑧ 背包布局（MC 物品栏视图模型）
  // ─────────────────────────────────────────────
  /** 默认快捷栏布局（开局一次，之后由 _hotbarSlots 持久化用户摆放） */
  _defaultHotbarSlots() {
    const hb = [null, null, null, null, null, null, null, null, null];
    if (this.ownsTool('hoe')) hb[0] = { kind: 'tool', toolId: 'hoe' };
    if (this.ownsTool('water')) hb[1] = { kind: 'tool', toolId: 'water' };
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
    if (this._hbHasSeed(seedId)) {
      return;
    }
    // 优先填入待补位的槽位（如金锭被拖走后等待种子顶替的槽）
    if (this._pendingSeedBackfillSlot !== null && !this._hotbarSlots[this._pendingSeedBackfillSlot]) {
      this._hotbarSlots[this._pendingSeedBackfillSlot] = { kind: 'seed', seedId };
      this._pendingSeedBackfillSlot = null;
      return;
    }
    // 优先替换金锭槽：新买的种子应该占用金锭所在的槽位，而不是跳到后面的空位
    const moneySlotIdx = this._hotbarSlots.findIndex(s => s && s.kind === 'resource' && s.id === 'money');
    if (moneySlotIdx >= 0) {
      this._hotbarSlots[moneySlotIdx] = { kind: 'seed', seedId };
      // 记录金锭被替换的位置，这样即使之后金锭槽被清除，种子也不会"回去"
      this._pendingSeedBackfillSlot = moneySlotIdx;
      return;
    }
    // 兜底：找第一个空槽
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
    if (id.kind === 'resource') {
      // 资源类型（金钱/木头/木板）使用聚合数据实时同步数量
      const countMap = { money: this.money, wood: this.wood, planks: this.planks };
      const count = countMap[id.id] || 1;
      return { kind: 'resource', id: id.id, key: id.key || id.id, label: id.label || id.id, count: count };
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
    if (s.kind === 'resource') return { kind: 'resource', id: s.id, key: s.key, label: s.label };
    return null;
  },

  /** 去重：快捷栏最多只保留一个金锭（历史存档/重复逻辑/拖拽可能写入多个，导致"两组金锭"） */
  _dedupeHotbarMoney() {
    if (!this._hotbarSlots) return;
    // 只去重（保留一个金锭），不清除金锭（由 _rebuildInvSlots 统一处理，以便触发种子补位）
    let seen = false;
    for (let k = 0; k < this._hotbarSlots.length; k++) {
      const s = this._hotbarSlots[k];
      if (s && s.kind === 'resource' && s.id === 'money') {
        if (seen) {
          this._hotbarSlots[k] = null;
          if (this.invSlots) this.invSlots[27 + k] = null;
        } else {
          seen = true;
        }
      }
    }
  },

  /** 从聚合重建 36 格背包布局（开背包时调用一次；快捷栏用持久化的 _hotbarSlots，主栏用聚合） */
  _rebuildInvSlots() {
    if (!this._hotbarSlots) this._hotbarSlots = this._defaultHotbarSlots();
    const inv = new Array(36).fill(null);
    // 主栏：按物品获得顺序混合排列（工具/种子/收获物/资源都按首次获得时间排队）
    const main = [];
    const toolMap = { hoe: { key: 'wooden_hoe', label: '锄头' }, water: { key: 'water_bucket', label: '水桶' }, axe: { key: 'wooden_axe', label: '斧头' }, acorn: { key: 'acorn', label: '橡果' } };
    const pushStacks = (stackId, key, label) => {
      const total = this._stackCountFromAgg(stackId);
      for (const n of UI._stackChunks(total)) main.push({ kind: 'stack', stackId, key, label, count: n });
    };
    // 兼容旧存档：若 _allOrder 为空，从 inventory/seeds 反向构建顺序
    if (!this._allOrder || this._allOrder.length === 0) {
      this._allOrder = [];
      // 按 keys 插入顺序添加种子和作物
      for (const sid of Object.keys(this.seeds || {})) {
        if ((this.seeds[sid] || 0) > 0) this._allOrder.push({ type: 'seed', id: sid });
      }
      for (const cid of Object.keys(this.inventory || {})) {
        if (cid === 'acorn') continue;
        if ((this.inventory[cid] || 0) > 0) this._allOrder.push({ type: 'crop', id: cid });
      }
      // 资源类
      if (this.wood > 0) this._allOrder.push({ type: 'resource', id: 'wood' });
      if (this.planks > 0) this._allOrder.push({ type: 'resource', id: 'planks' });
      if (this.money > 0) this._allOrder.push({ type: 'resource', id: 'money' });
    }
    // 按统一顺序数组插入所有物品
    for (const entry of (this._allOrder || [])) {
      if (entry.type === 'seed') {
        const sid = entry.id;
        const c = this.seeds[sid]; if (!c || c <= 0) continue;
        if (this._hbHasSeed(sid)) continue;
        const def = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[sid] : null;
        main.push({ kind: 'seed', seedId: sid, key: UI._seedIconKey(sid), label: def ? def.name : sid, count: c });
      } else if (entry.type === 'crop') {
        const cid = entry.id;
        if (cid === 'acorn') continue; // 橡果单独处理
        const c = this.inventory[cid];
        if (!c || c <= 0) continue;
        const def = (typeof DATA !== 'undefined' && DATA.CROPS) ? DATA.CROPS[cid] : null;
        if (!def) continue;
        pushStacks('crop:' + cid, def.assetHarvest, def.name);
      } else if (entry.type === 'resource') {
        if (entry.id === 'wood' && this.wood > 0) pushStacks('wood', 'oak_log_3d', '木头');
        else if (entry.id === 'planks' && this.planks > 0) pushStacks('planks', 'oak_planks_3d', '木板');
        // 金锭不进主背包，只保留在快捷栏（由下方单独处理）
        else if (entry.id === 'money') continue;
      }
    }
    // 去重：快捷栏最多只保留一个金锭（历史存档/重复逻辑可能写入多个，导致"两组金锭"）
    this._dedupeHotbarMoney();
    // 金锭：money>0 时保留/更新金锭槽；money 用尽一律移除，杜绝 count=0 的「幽灵金锭」
    const existingMoneySlot = this._hotbarSlots.findIndex(s => s && s.kind === 'resource' && s.id === 'money');
    if (this.money > 0) {
      if (existingMoneySlot >= 0) {
        // 金锭槽被拖走（_reservedHotbarIdx指向它）：即使还没花完钱也要清空，让种子立刻补位
        if (existingMoneySlot === this._reservedHotbarIdx) {
          this._hotbarSlots[existingMoneySlot] = null;
          // 设置等待种子补位的标志
          this._pendingSeedBackfillSlot = existingMoneySlot;
          // 立即补位：如果快捷栏已有该种子，将其移到刚清空的槽位（不论方向）
          for (const entry of (this._allOrder || [])) {
            if (entry.type !== 'seed') continue;
            const sid = entry.id;
            if ((this.seeds[sid] || 0) > 0) {
              const seedIdx = this._hotbarSlots.findIndex(s => s && s.kind === 'seed' && s.seedId === sid);
              // 只要种子不在目标槽且目标槽为空，就移动过去（不论seedIdx是否大于targetSlot）
              if (seedIdx !== existingMoneySlot && this._hotbarSlots[existingMoneySlot] === null) {
                this._hotbarSlots[existingMoneySlot] = this._hotbarSlots[seedIdx];
                this._hotbarSlots[seedIdx] = null;
                this._pendingSeedBackfillSlot = null;
                break;
              }
            }
          }
        } else {
          this._hotbarSlots[existingMoneySlot].count = this.money;
        }
      } else {
        // 找第一个空槽，但跳过商店拖拽保留的槽位（成交瞬间该槽本就是金锭位，已被清空）
        let hbEmptyIdx = -1;
        for (let k = 0; k < this._hotbarSlots.length; k++) {
          if (!this._hotbarSlots[k]) { hbEmptyIdx = k; break; }
        }
        // 如果 _reservedHotbarIdx 指向的槽已空（金锭被拖走），记录待补位槽位
        // 这样种子可以补位到金锭被拖走的位置，而不是把金锭放回原位
        if (this._reservedHotbarIdx !== null && this._hotbarSlots[this._reservedHotbarIdx] === null) {
          this._pendingSeedBackfillSlot = this._reservedHotbarIdx;
          hbEmptyIdx = -1; // 不回填金锭
        } else if (hbEmptyIdx === this._reservedHotbarIdx) {
          // 只有当 _reservedHotbarIdx 槽还有金锭时才跳过
          for (let k = hbEmptyIdx + 1; k < this._hotbarSlots.length; k++) {
            if (!this._hotbarSlots[k]) { hbEmptyIdx = k; break; }
          }
        }
        // 如果有待补位的槽位（等待种子填入），不填充金锭
        // 当种子已替换金锭槽时，_pendingSeedBackfillSlot 仍为原金锭槽位
        if (hbEmptyIdx >= 0 && this._pendingSeedBackfillSlot !== hbEmptyIdx) {
          this._hotbarSlots[hbEmptyIdx] = { kind: 'resource', id: 'money', key: 'money', label: '金锭', count: this.money };
        }
        // 额外检查：如果 _pendingSeedBackfillSlot 对应的槽已被种子替换，也不回填金锭
        if (this._pendingSeedBackfillSlot >= 0 && this._hotbarSlots[this._pendingSeedBackfillSlot] && 
            this._hotbarSlots[this._pendingSeedBackfillSlot].kind === 'seed') {
          hbEmptyIdx = -1;
        }
      }
    } else if (existingMoneySlot >= 0 && existingMoneySlot !== this._reservedHotbarIdx) {
      // money 用尽：清掉快捷栏里残留的金锭槽，避免显示 count=0 的幽灵金锭
      // 注意：跳过 _reservedHotbarIdx，该槽位在拖拽期间被暂时保留
      this._hotbarSlots[existingMoneySlot] = null;
      // 金锭被花光，触发补位
      this._backfillSeedAfterMoneyRemoved(existingMoneySlot);
    } else if (this.money <= 0 && this._pendingSeedBackfillSlot !== null) {
      // 特殊情况：金锭槽已被清除（_purgeOrder 已删条目），但还有待补位的种子
      this._backfillSeedAfterMoneyRemoved(this._pendingSeedBackfillSlot);
    }
    // 工具：只有拥有时才放入快捷栏（开局时 ownedTools 为空，由 _grantItem 添加工具后触发重建）
    for (const t of ['hoe', 'water']) {
      if (!this.ownsTool(t)) continue; // 未获得该工具时不加入
      if (this._hbHasTool(t)) continue;
      const empty = this._hotbarSlots.findIndex(s => !s);
      if (empty >= 0) {
        this._hotbarSlots[empty] = { kind: 'tool', toolId: t };
      } else {
        main.push({ kind: 'tool', toolId: t, key: toolMap[t].key, label: toolMap[t].label, count: 1 });
      }
    }
    if (this.ownsTool('axe')) {
      if (!this._hbHasTool('axe')) {
        const empty = this._hotbarSlots.findIndex(s => !s);
        if (empty >= 0) {
          this._hotbarSlots[empty] = { kind: 'tool', toolId: 'axe' };
        } else {
          main.push({ kind: 'tool', toolId: 'axe', key: toolMap['axe'].key, label: toolMap['axe'].label, count: 1 });
        }
      }
    }
    if (this.acorns > 0 && !this._hbHasTool('acorn')) {
      main.push({ kind: 'tool', toolId: 'acorn', key: toolMap['acorn'].key, label: toolMap['acorn'].label, count: this.acorns });
    }
    // 补位前置：清掉「数量为 0 / 已删除」的种子占位残留。useSeed 种光某种子时只删了
    // this.seeds 的计数，但 _hotbarSlots 里那份 {kind:'seed'} 描述符没清，导致该格显示 0 的残影、
    // 且槽位不算空 → 其它种子无法补位（用户说的"没补位"）。清掉后腾出空槽给补位。
    // 注意：种子数量始终在 this.seeds[cropId]，清掉占位不会丢种子。
    for (let k = 0; k < this._hotbarSlots.length; k++) {
      const s = this._hotbarSlots[k];
      if (s && s.kind === 'seed' && !(this.seeds[s.seedId] > 0)) this._hotbarSlots[k] = null;
    }
    // 补位：把「有数量、但还没放进快捷栏」的种子，依次填入空着的快捷栏槽位。
    // 例如金锭花光/拖走后空出的格子（或上面清掉的残影格），应由种子顶上，避免留空槽。
    // 与"种子优先快捷栏"一致；已进快捷栏的种子靠 _hbHasSeed 跳过，不会双显。
    // 注意：如果 _reservedHotbarIdx 对应的槽位已被清空（如金锭被拖走），种子应能填入
    for (const entry of (this._allOrder || [])) {
      if (entry.type !== 'seed') continue;
      const sid = entry.id;
      // 情况A：种子还没在快捷栏，正常填入
      if ((this.seeds[sid] || 0) > 0 && !this._hbHasSeed(sid)) {
        let k = this._hotbarSlots.findIndex(s => !s);
        // 跳过拖拽保留的槽位，但如果该槽已被清空（null），则允许填入
        while (k >= 0 && k === this._reservedHotbarIdx && this._hotbarSlots[k] !== null) {
          k = this._hotbarSlots.findIndex((s, idx) => !s && idx !== this._reservedHotbarIdx, k + 1);
        }
        if (k < 0) break; // 快捷栏已满，剩余种子留主背包
        this._hotbarSlots[k] = { kind: 'seed', seedId: sid };
        // 刚填完等待补位的槽位，清除标志
        if (k === this._pendingSeedBackfillSlot) {
          this._pendingSeedBackfillSlot = null;
        }
      }
      // 情况B：种子已在快捷栏，但有待补位的空槽（如金锭被拖走），移动到空槽
      else if ((this.seeds[sid] || 0) > 0 && this._hbHasSeed(sid) && this._pendingSeedBackfillSlot !== null) {
        const seedIdx = this._hotbarSlots.findIndex(s => s && s.kind === 'seed' && s.seedId === sid);
        const targetSlot = this._pendingSeedBackfillSlot;
        // 只要种子不在待补位的槽位，且该槽位为空，就移动过去（不论seedIdx是否大于targetSlot）
        if (seedIdx !== targetSlot && this._hotbarSlots[targetSlot] === null) {
          this._hotbarSlots[targetSlot] = this._hotbarSlots[seedIdx];
          this._hotbarSlots[seedIdx] = null;
          this._pendingSeedBackfillSlot = null;
          break;
        }
      }
    }
    // 快捷栏：按持久布局还原（现在 _hotbarSlots 已更新）
    for (let i = 0; i < 9; i++) inv[27 + i] = this._slotFromIdentity(this._hotbarSlots[i]);
    // 主栏填入背包
    for (let k = 0; k < main.length && k < 27; k++) inv[k] = main[k];
    this.invSlots = inv;
  },

  /** 金锭槽被清空后，优先把第一个未进快捷栏的种子填入该位置，或将已有种子移过来 */
  _backfillSeedAfterMoneyRemoved(moneySlotIndex) {
    for (const entry of (this._allOrder || [])) {
      if (entry.type !== 'seed') continue;
      const sid = entry.id;
      if (this._hbHasSeed(sid)) {
        const seedIdx = this._hotbarSlots.findIndex(s => s && s.kind === 'seed' && s.seedId === sid);
        // 只要种子不在目标槽，且目标槽为空，就移动过去（不论方向）
        if (seedIdx !== moneySlotIndex && this._hotbarSlots[moneySlotIndex] === null) {
          this._hotbarSlots[moneySlotIndex] = this._hotbarSlots[seedIdx];
          this._hotbarSlots[seedIdx] = null;
          break;
        }
      } else if ((this.seeds[sid] || 0) > 0) {
        this._hotbarSlots[moneySlotIndex] = { kind: 'seed', seedId: sid };
        break;
      }
    }
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
    if (!this._allOrder.some(e => e.type === 'resource' && e.id === 'money')) {
      this._allOrder.push({ type: 'resource', id: 'money' });
    }
    // 重新构建背包缓存，使金锭立即显示
    this._rebuildInvSlots();
    // 立即刷新底部快捷栏显示（金锭数量变化需要实时可见）
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._renderBottomHotbar) {
      globalThis.UI._renderBottomHotbar();
    }
  },

  /** 扣钱 */
  spendMoney(amount) {
    if (this.money < amount) return false;
    this.money -= amount;
    // 注意：不清除 _reservedHotbarIdx，由 shop.js 在交易完成后统一清除
    // 如果这里清除，_rebuildInvSlots 执行时看不到保留标志，补位会跳到后面槽位
    if (this.money <= 0) this._purgeOrder('resource', 'money');
    this._rebuildInvSlots();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen) {
      globalThis.UI.renderInventory();
    }
    // 立即刷新底部快捷栏显示（金锭槽清空/种子补位都需要实时可见）
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._renderBottomHotbar) {
      globalThis.UI._renderBottomHotbar();
    }
    return true;
  },

  // ─────────────────────────────────────────────
  // ④ 资源（木头 / 木板 / 橡果）
  // ─────────────────────────────────────────────
  /** 加木头（砍树获得） */
  addWood(amount) {
    this.wood += (amount || 0);
    if (typeof Quest !== 'undefined') Quest.trigger('wood', amount); // 任务书：物资储备/林间建设者
    if (!this._allOrder.some(e => e.type === 'resource' && e.id === 'wood')) {
      this._allOrder.push({ type: 'resource', id: 'wood' });
    }
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
    if (!this._allOrder.some(e => e.type === 'resource' && e.id === 'planks')) {
      this._allOrder.push({ type: 'resource', id: 'planks' });
    }
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
  /** 收获物添加（按首次获得顺序追踪） */
  addToInventory(cropId, count) {
    this.inventory[cropId] = (this.inventory[cropId] || 0) + count;
    if (!this._allOrder.some(e => e.type === 'crop' && e.id === cropId)) {
      this._allOrder.push({ type: 'crop', id: cropId });
    }
    // 重新构建背包缓存并刷新显示
    this._rebuildInvSlots();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._renderBottomHotbar) {
      globalThis.UI._renderBottomHotbar();
    }
  },

  /** 收获物清空 */
  clearInventory() {
    this.inventory = {};
    this._allOrder = [];
  },

  /** 从 _allOrder 移除条目（物品数量为0或已被删除时调用） */
  _purgeOrder(type, id) {
    if (!this._allOrder) return;
    this._allOrder = this._allOrder.filter(e => !(e.type === type && e.id === id));
  },

  /** 清理所有已耗尽物品的 _allOrder 条目，并重建背包布局 */
  _syncAllOrder() {
    if (!this._allOrder) return;
    this._allOrder = this._allOrder.filter(e => {
      if (e.type === 'seed') return (this.seeds[e.id] || 0) > 0;
      if (e.type === 'crop') return (this.inventory[e.id] || 0) > 0;
      if (e.type === 'resource') {
        if (e.id === 'money') return this.money > 0;
        if (e.id === 'wood') return this.wood > 0;
        if (e.id === 'planks') return this.planks > 0;
      }
      return false;
    });
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
  /** 种子操作（按首次获得顺序追踪） */
  addSeeds(cropId, count) {
    // 注意：不清除 _reservedHotbarIdx，因为 spendMoney() → _rebuildInvSlots() 需要它来检测金锭被拖走
    // 清除时机由 shop.js 在 _executeTrade 末尾统一处理
    this.seeds[cropId] = (this.seeds[cropId] || 0) + count;
    if (!this._allOrder.some(e => e.type === 'seed' && e.id === cropId)) {
      this._allOrder.push({ type: 'seed', id: cropId });
    }
    // 买种子优先填快捷栏空位（方便直接拿去种）；快捷栏满才落主背包
    this._ensureSeedInHotbar(cropId);
    this._rebuildInvSlots();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen) {
      globalThis.UI.renderInventory();
    }
    // 买/获种子后快捷栏可能新增一格（优先填空位），立即刷新主界面底部快捷栏 DOM 让补位可见。
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._renderBottomHotbar) {
      globalThis.UI._renderBottomHotbar();
    }
  },

  hasSeed(cropId) {
    return (this.seeds[cropId] || 0) > 0;
  },

  useSeed(cropId) {
    const cur = this.seeds[cropId] || 0;
    if (cur <= 0) return false;
    this.seeds[cropId] = cur - 1;
    if (this.seeds[cropId] <= 0) {
      delete this.seeds[cropId];
      if (typeof this._purgeOrder === 'function') this._purgeOrder('seed', cropId);
    }
    this._rebuildInvSlots();
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._inventoryOpen) {
      globalThis.UI.renderInventory();
    }
    // 种掉种子后快捷栏可能腾出空槽并被背包种子补位，立即刷新主界面底部快捷栏 DOM，
    // 否则 DOM 陈旧、用户看不到补位（_updateHeldSlot 为空函数，不会自动刷新）。
    if (typeof globalThis.UI !== 'undefined' && globalThis.UI._renderBottomHotbar) {
      globalThis.UI._renderBottomHotbar();
    }
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
