/**
 * inventory.js — 背包子系统（MC 物品栏风格 DOM 弹窗 + 完整 MC 鼠标逻辑）
 *
 * 从 ui.js 拆出，方法仍挂在全局 UI 对象上（`UI.x = function(){…}`），
 * 所有 this.* 跨方法调用与原实现完全一致，仅文件位置变化。
 *
 * ── 结构导航 ──
 *  ① 开关：openInventory · closeInventory
 *  ② 渲染：renderInventory · _makeSlot
 *  ③ MC 鼠标逻辑：_invMouseDown · _invPickUp · _invDeposit · _invMouseOver
 *                 · _invMouseUp · _invDblClick · _invShiftTransfer
 *                 · _invReturnHeld · _invHeldGhost · _slotIndexFromEvent · _sameIdentity
 *  ④ 合成格：_craftGrid … _renderCraft（2×2，改动后重建 invSlots 以同步数量）
 */

// ─────────────────────────────────────────────
// ① 开关
// ─────────────────────────────────────────────

/** 打开背包（MC 物品栏 GUI：inventory.png 纹理背景） */
UI.openInventory = function() {
  if (this._inventoryOpen) return;
  if (this._shopOpen) this.closeShop();   // 互斥：打开背包时先收起商店，避免两者叠在一起
  this._inventoryOpen = true;
  const panel = document.getElementById('inventory-panel');
  const invImg = this._assetURL('inventory');
  if (invImg) panel.style.backgroundImage = `url(${invImg})`;
  this._invBindOnce();                   // 一次性绑定网格交互（事件委托）
  // 从聚合重建 36 格布局（快捷栏按持久 _hotbarSlots 还原）
  Player._rebuildInvSlots();
  this._invHeld = null;     // 清空可能残留的持物
  this._dragButton = null;
  this._dragMode = null;    // 'pick'=从空格拿起拖拽；'place'=光标已有物单击放置
  this._dragLast = null;    // 拖动中最后所在格（左键整堆移动目标）
  this._dragSplit = false;  // 左键长按进入「平分」模式
  this._longPressTimer = null;
  const mainG = document.getElementById('inv-grid-main');
  const hotG = document.getElementById('inv-grid-hotbar');
  mainG.classList.add('inv-grid-anim');   // 仅开背包播一次入场动画
  hotG.classList.add('inv-grid-anim');
  this.renderInventory();
  this._updateHUD();  // 刷新 HUD（时间/体力；金币已移入背包格子，HUD 上不再显示）
  // 动画播完移除类，之后任何重渲染（拿起/放下/滚轮）都不再重放
  setTimeout(() => { mainG.classList.remove('inv-grid-anim'); hotG.classList.remove('inv-grid-anim'); }, 1200);
  document.getElementById('inventory-overlay').className = 'overlay-visible';
};


/** 关闭背包（先退回持物，避免丢物） */
UI.closeInventory = function() {
  if (!this._inventoryOpen) return;
  this._invReturnHeld();    // 关背包前把光标上的物品退回背包（不丢）
  document.getElementById('inventory-overlay').className = 'overlay-hidden';
  this._inventoryOpen = false;
  Engine.resume();
  this.render();
};


// ─────────────────────────────────────────────
// ② 渲染
// ─────────────────────────────────────────────

/** 渲染背包（按 Player.invSlots 渲染主栏 0..26 + 快捷栏 27..35） */
UI.renderInventory = function() {
  if (!Player.invSlots) Player._rebuildInvSlots();

  // 主物品栏 9×3
  const main = document.getElementById('inv-grid-main');
  main.innerHTML = '';
  for (let i = 0; i < 27; i++) {
    const s = this._makeSlot(Player.invSlots[i], i, false);
    s.style.setProperty('--i', i);
    main.appendChild(s);
  }

  // 快捷栏 9×1（真实物品栏，可放工具/种子/物品；滚轮切选中格装备）
  const hotbar = document.getElementById('inv-grid-hotbar');
  hotbar.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const idx = 27 + i;
    const s = this._makeSlot(Player.invSlots[idx], idx, true, i === Player._hotbarSel);
    s.style.setProperty('--i', i);
    hotbar.appendChild(s);
  }

  // 合成格：每次渲染背包同步刷新
  this._renderCraft();
  this._updateGhost();
};


/** 构造一个物品格子 DOM（仅展示；交互全部走网格事件委托，不在格子上绑 click） */
UI._makeSlot = function(slot, index, isHotbar, isSelected) {
  const el = document.createElement('div');
  el.className = 'inv-slot';
  el.dataset.index = index;

  // 快捷栏选中格使用 gamemode_switcher_selection 贴图
  if (isHotbar && isSelected) {
    const bgSrc = this._assetURL('gamemode_switcher_selection');
    if (bgSrc) el.style.cssText += ';background-image:url("' + bgSrc + '");background-size:cover;background-repeat:no-repeat;background-position:center';
  }

  if (!slot) return el;                      // 空槽
  const cls = slot.kind === 'seed' ? 'seed' : (slot.kind === 'tool' ? 'tool' : 'crop');
  el.classList.add(cls);

  // 工具/种子数量为 0 时显示为空格（MC 风格：没货就空着，但仍可拖入）
  const emptyToolSeed = (slot.kind === 'tool' && slot.toolId === 'acorn' && !(slot.count > 0)) ||
                        (slot.kind === 'seed' && !(slot.count > 0));
  if (emptyToolSeed) { el.classList.add('inv-empty'); return el; }

  const src = this._assetURL(slot.key) || '';
  let showCount = '';
  if (slot.kind === 'stack') showCount = slot.count > 1 ? slot.count : '';
  else if (slot.kind === 'tool') showCount = (slot.toolId === 'acorn' && slot.count > 0) ? slot.count : '';
  else if (slot.kind === 'seed') showCount = slot.count > 1 ? slot.count : '';

  el.title = slot.label + (showCount !== '' ? (' ×' + showCount) : '');
  el.innerHTML = (src ? `<img src="${src}" alt="${slot.label}">` : '') +
                 (showCount !== '' ? `<span class="inv-count">${showCount}</span>` : '');
  return el;
};


// ─────────────────────────────────────────────
// ③ MC 鼠标逻辑
// ─────────────────────────────────────────────

/** 从事件定位落点格 index（事件委托：取最近的 .inv-slot 的 data-index） */
UI._slotIndexFromEvent = function(e) {
  const t = e.target.closest && e.target.closest('.inv-slot');
  if (!t || t.dataset.index === undefined) return null;
  return parseInt(t.dataset.index, 10);
};

/** 两个槽位是否同类可堆叠（同 kind 且同 toolId/seedId/stackId） */
UI._sameIdentity = function(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'tool') return a.toolId === b.toolId;
  if (a.kind === 'seed') return a.seedId === b.seedId;
  if (a.kind === 'stack') return a.stackId === b.stackId;
  return false;
};

/** 快捷栏格变化后，把布局持久化进 Player._hotbarSlots（跨重开保留用户摆放） */
UI._afterInvChange = function(index) {
  if (index >= 27 && index < 36) {
    const i = index - 27;
    const s = Player.invSlots[index];
    Player._hotbarSlots[i] = s ? Player._identityFromSlot(s) : null;
  }
};

/** 按下格子：拿起 / 放下（左键整堆，右键一半/逐个） */
UI._invMouseDown = function(index, button) {
  const held = this._invHeld;
  this._dragButton = button === 2 ? 'right' : 'left';
  this._dragIndex = index;
  if (!held) {
    const slot = Player.invSlots[index];
    if (!slot) return;                       // 空格按下：无动作
    this._invPickUp(index, button === 2);    // 右键=拿一半
    this._dragMode = 'pick';                 // 从空格拿起 → 进入拖拽模式
    this._dragEntered = new Set();           // 记录经过的格子
    this._dragLast = null;                   // 最后所在格（整堆移动用）
    this._dragSplit = false;                 // 左键快速拖=整堆移动；长按=平分
    // 长按计时：按住不动超过阈值才进入「平分」模式；一旦移动则取消计时→整堆移动
    if (this._longPressTimer) clearTimeout(this._longPressTimer);
    this._longPressTimer = setTimeout(() => {
      if (this._dragMode === 'pick' && this._invHeld && !this._dragSplit) {
        this._dragSplit = true;
      }
    }, 500);
  } else {
    // 光标已有物：单击放置（左键整堆 / 右键落 1），不进入拖拽均分
    this._invDeposit(index, this._dragButton);
    this._dragMode = 'place';
    this._dragEntered = null;
  }
  this._invRenderAndGhost();
};

/** 拿起整堆(half=false) 或 一半(half=true，仅堆叠物；工具/种子整拿) */
UI._invPickUp = function(index, half) {
  const slot = Player.invSlots[index];
  if (!slot) return;
  if (slot.kind === 'stack') {
    if (half) {
      const take = Math.ceil(slot.count / 2);
      this._invHeld = Object.assign({}, slot, { count: take });
      slot.count -= take;
      if (slot.count <= 0) Player.invSlots[index] = null;
    } else {
      this._invHeld = slot;
      Player.invSlots[index] = null;
    }
  } else {
    // 工具/种子：整拿（不可拆分）
    this._invHeld = Object.assign({}, slot);
    Player.invSlots[index] = null;
  }
};

/** 把光标物放到 index 格（mode: 'left'=整堆合并/交换，'right'=放 1 个） */
UI._invDeposit = function(index, mode) {
  const held = this._invHeld;
  if (!held) return;
  const slot = Player.invSlots[index];
  if (!slot) {
    if (mode === 'right') {
      Player.invSlots[index] = Object.assign({}, held, { count: 1 });
      held.count -= 1;
      if (held.count <= 0) this._invHeld = null;
    } else {
      Player.invSlots[index] = held;
      this._invHeld = null;
    }
    this._afterInvChange(index);
    return;
  }
  // 目标已占用
  if (this._sameIdentity(slot, held)) {
    if (slot.kind === 'stack' && slot.count < 64) {
      const room = 64 - slot.count;
      if (mode === 'right') {
        slot.count += 1; held.count -= 1;
        if (held.count <= 0) this._invHeld = null;
      } else {
        const mv = Math.min(room, held.count);
        slot.count += mv; held.count -= mv;
        if (held.count <= 0) this._invHeld = null;
      }
    } else {
      // 工具/种子 或 堆叠已满：左键交换；右键放不下→无动作
      if (mode === 'right') return;
      const tmp = Player.invSlots[index];
      Player.invSlots[index] = held;
      this._invHeld = tmp;
    }
  } else {
    // 不同类：左键交换；右键放不下→无动作
    if (mode === 'right') return;
    const tmp = Player.invSlots[index];
    Player.invSlots[index] = held;
    this._invHeld = tmp;
  }
  this._afterInvChange(index);
};

/** 拖拽经过新格子：仅记录经过的格子（跳过起点），不立即放下（松手才分发，符合 MC） */
UI._invMouseOver = function(index) {
  if (this._dragMode !== 'pick' || !this._invHeld || !this._dragEntered) return;
  if (index === this._dragIndex) return;          // 起点已空，不计入分发
  if (this._dragEntered.has(index)) return;
  if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; } // 已移动→非长按
  this._dragEntered.add(index);
  this._dragLast = index;
};

/** 鼠标移动时按坐标命中当前所在格子并记录（比 mouseover 更可靠，拖动中必触发） */
UI._invDragHover = function(x, y) {
  if (this._dragMode !== 'pick' || !this._invHeld || !this._dragEntered) return;
  const el = document.elementFromPoint(x, y);
  const slot = el && el.closest && el.closest('.inv-slot');
  if (!slot || slot.dataset.index === undefined) return;
  const idx = parseInt(slot.dataset.index, 10);
  if (idx === this._dragIndex) return;            // 起点不计入
  if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; } // 已移动→非长按
  this._dragEntered.add(idx);
  this._dragLast = idx;
};

/** 松开：左键整堆移动到最后所在格；左键长按=均分到经过各格；右键每格落 1（MC）。未移动则左键回起点/右键留手 */
UI._invMouseUp = function() {
  if (this._longPressTimer) { clearTimeout(this._longPressTimer); this._longPressTimer = null; }
  if (this._dragMode === 'pick' && this._invHeld) {
    const moved = this._dragLast != null && this._dragLast !== this._dragIndex;
    if (!moved) {
      // 未拖动到其他格：左键整堆放回起点；右键物品留手（不落）
      if (this._dragButton === 'left' && this._dragIndex != null) {
        this._invDeposit(this._dragIndex, 'left');
      }
    } else if (this._dragButton === 'left') {
      if (this._dragSplit) {
        // 左键长按：把整堆均分（total/n）到经过的每格；长按但未拖动到他格则整堆回起点
        if (this._dragEntered.size > 0) this._invDistributeEven(this._dragEntered);
        else this._invDeposit(this._dragIndex, 'left');
      } else {
        this._invDeposit(this._dragLast, 'left');        // 左键单击拖：整堆移动到目标格
      }
    } else {
      this._invDistribute(this._dragEntered);          // 右键拖：每格落 1
    }
  }
  this._dragMode = null;
  this._dragButton = null;
  this._dragIndex = null;
  this._dragEntered = null;
  this._dragLast = null;
  this._dragSplit = false;
  this._invRenderAndGhost();
};

/** 左键长按均分：total/n 均分到进入的每格（余数给前 r 格），异类/满格放不下则剩余留手 */
UI._invDistributeEven = function(entered) {
  const cells = [...entered];
  if (!this._invHeld) return;
  const n = cells.length;
  let total = this._invHeld.count;
  const base = Math.floor(total / n);
  let rem = total % n;
  for (const idx of cells) {
    let put = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    if (put <= 0) continue;
    while (put > 0 && this._invHeld) {
      const s = Player.invSlots[idx];
      if (!s) {
        const mv = Math.min(put, 64);
        Player.invSlots[idx] = Object.assign({}, this._invHeld, { count: mv });
        this._invHeld.count -= mv;
        if (this._invHeld.count <= 0) this._invHeld = null;
        put -= mv;
      } else if (this._sameIdentity(s, this._invHeld) && s.kind === 'stack' && s.count < 64) {
        const mv = Math.min(put, 64 - s.count);
        s.count += mv; this._invHeld.count -= mv;
        if (this._invHeld.count <= 0) this._invHeld = null;
        put -= mv;
      } else {
        break; // 异类或已满：本格放不下，剩余留手
      }
    }
  }
  if (cells.length) this._afterInvChange(cells[0]);
  this._invRenderAndGhost();
};

/** 松手分发（右键拖）：手中物品每格落 1 到经过的格子（空格或同类未满格），剩余留手 */
UI._invDistribute = function(entered) {
  const cells = [...entered];
  for (const idx of cells) {
    if (!this._invHeld) break;
    const s = Player.invSlots[idx];
    if (!s || this._sameIdentity(s, this._invHeld)) this._invDeposit(idx, 'right');
  }
  if (cells.length) this._afterInvChange(cells[0]);
  this._invRenderAndGhost();
};

/** 双击：把同网格内同类堆叠收集进本格（最多 64） */
UI._invDblClick = function(index) {
  const slot = Player.invSlots[index];
  if (!slot || slot.kind !== 'stack') return;
  const start = index < 27 ? 0 : 27;
  const end = index < 27 ? 27 : 36;
  for (let i = start; i < end; i++) {
    if (i === index) continue;
    const o = Player.invSlots[i];
    if (o && this._sameIdentity(o, slot) && slot.count < 64) {
      const mv = Math.min(64 - slot.count, o.count);
      slot.count += mv; o.count -= mv;
      if (o.count <= 0) { Player.invSlots[i] = null; this._afterInvChange(i); }
      if (slot.count >= 64) break;
    }
  }
  this._invRenderAndGhost();
};

/** Shift+左键：快速转移到另一侧网格（主栏↔快捷栏） */
UI._invShiftTransfer = function(index) {
  const slot = Player.invSlots[index];
  if (!slot) return;
  const toHotbar = index < 27;
  const start = toHotbar ? 27 : 0, end = toHotbar ? 36 : 27;
  // 先合并进同类有空位的格
  for (let i = start; i < end; i++) {
    const o = Player.invSlots[i];
    if (o && this._sameIdentity(o, slot) && o.kind === 'stack' && o.count < 64) {
      const mv = Math.min(64 - o.count, slot.count);
      o.count += mv; slot.count -= mv;
      this._afterInvChange(i);
      if (slot.count <= 0) { Player.invSlots[index] = null; this._afterInvChange(index); return; }
    }
  }
  // 再放进第一个空格
  for (let i = start; i < end; i++) {
    if (!Player.invSlots[i]) {
      Player.invSlots[i] = slot;
      Player.invSlots[index] = null;
      this._afterInvChange(i);
      this._afterInvChange(index);
      return;
    }
  }
  // 没位置：留在原地
};

/** 数字键 1-9：把光标物移到对应快捷栏格（原物换到光标） */
UI._invNumberKey = function(n) {
  if (!this._invHeld) return;
  const idx = 27 + (n - 1);
  const cur = Player.invSlots[idx];
  Player.invSlots[idx] = this._invHeld;
  this._invHeld = cur;                  // 原物到光标（空则光标清空）
  this._afterInvChange(idx);
  this._invRenderAndGhost();
};

/** Q：丢弃光标物（本游戏无地面，退回背包首个空格/同类合并，不丢） */
UI._invDropHeld = function() {
  if (!this._invHeld) return;
  const held = this._invHeld;
  // 优先放回原位（若空）
  if (this._dragIndex != null && !Player.invSlots[this._dragIndex]) {
    Player.invSlots[this._dragIndex] = held; this._invHeld = null; this._afterInvChange(this._dragIndex); this._invRenderAndGhost(); return;
  }
  // 首个空格
  for (let i = 0; i < 36; i++) {
    if (!Player.invSlots[i]) { Player.invSlots[i] = held; this._invHeld = null; this._afterInvChange(i); this._invRenderAndGhost(); return; }
  }
  // 合并进同类
  for (let i = 0; i < 36; i++) {
    const o = Player.invSlots[i];
    if (o && this._sameIdentity(o, held) && o.kind === 'stack' && o.count < 64) {
      const mv = Math.min(64 - o.count, held.count);
      o.count += mv; held.count -= mv; this._afterInvChange(i);
      if (held.count <= 0) { this._invHeld = null; this._invRenderAndGhost(); return; }
    }
  }
};

/** 关背包/点背景：把光标物退回背包（不丢） */
UI._invReturnHeld = function() {
  if (!this._invHeld) return;
  const held = this._invHeld;
  this._invHeld = null;
  if (this._dragIndex != null && !Player.invSlots[this._dragIndex]) {
    Player.invSlots[this._dragIndex] = held; this._afterInvChange(this._dragIndex); return;
  }
  for (let i = 0; i < 36; i++) {
    if (!Player.invSlots[i]) { Player.invSlots[i] = held; this._afterInvChange(i); return; }
  }
  for (let i = 0; i < 36; i++) {
    const o = Player.invSlots[i];
    if (o && this._sameIdentity(o, held) && o.kind === 'stack' && o.count < 64) {
      const mv = Math.min(64 - o.count, held.count);
      o.count += mv; this._afterInvChange(i);
      if (held.count <= 0) return;
    }
  }
};

/** 应用当前快捷栏选中格：装备其工具/种子 + 重绘高亮 + 提示 */
UI._invApplyHotbarSel = function() {
  const slot = Player.invSlots[27 + Player._hotbarSel];
  if (slot && slot.kind === 'tool') Player.selectTool(slot.toolId);
  else if (slot && slot.kind === 'seed') Player.selectTool('seed-' + slot.seedId);
  this._updateHeldSlot();
  this.renderInventory();               // 重绘以更新快捷栏选中背景贴图
  const names = { hoe: '锄头', water: '水桶', axe: '斧头', acorn: '橡果' };
  const msg = slot
    ? (slot.kind === 'seed' ? '选择种子：' + slot.label : '选择工具：' + (names[slot.toolId] || slot.label))
    : '空手';
  this.showStatus(msg, 700);
};

/** 由当前 selectedTool 反推快捷栏选中格（工具栏按钮装备时同步高亮） */
UI._invSyncSelToTool = function() {
  const t = Player.selectedTool;
  for (let i = 0; i < 9; i++) {
    const s = Player.invSlots && Player.invSlots[27 + i];
    if (!s) continue;
    if (s.kind === 'tool' && s.toolId === t) { Player._hotbarSel = i; return; }
    if (s.kind === 'seed' && ('seed-' + s.seedId) === t) { Player._hotbarSel = i; return; }
  }
};

/** 渲染 + 刷新光标 ghost */
UI._invRenderAndGhost = function() {
  this.renderInventory();
  this._updateGhost();
};

/** 光标 ghost：持物时显示并跟随鼠标 */
UI._updateGhost = function() {
  let g = document.getElementById('inv-held');
  if (!this._invHeld) { if (g) g.style.display = 'none'; return; }
  if (!g) {
    g = document.createElement('div');
    g.id = 'inv-held';
    g.style.pointerEvents = 'none';   // 不挡鼠标事件，使下方格子能收到 mouseover / elementFromPoint
    const ov = document.getElementById('inventory-overlay');
    if (ov) ov.appendChild(g);
  }
  g.style.display = 'flex';
  const slot = this._invHeld;
  const src = this._assetURL(slot.key) || '';
  let showCount = '';
  if (slot.kind === 'stack') showCount = slot.count > 1 ? slot.count : '';
  else if (slot.kind === 'tool') showCount = (slot.toolId === 'acorn' && slot.count > 0) ? slot.count : '';
  else if (slot.kind === 'seed') showCount = slot.count > 1 ? slot.count : '';
  g.innerHTML = (src ? `<img src="${src}" alt="${slot.label}">` : '') +
                (showCount !== '' ? `<span class="inv-count">${showCount}</span>` : '');
};

/** 一次性绑定背包网格交互（事件委托，重渲染不丢监听） */
UI._invBindOnce = function() {
  if (this._invBound) return;
  this._invBound = true;
  const bind = (gridId) => {
    const g = document.getElementById(gridId);
    if (!g) return;
    g.addEventListener('mousedown', (e) => {
      const idx = this._slotIndexFromEvent(e);
      if (idx == null) return;
      e.preventDefault();
      // Shift+左键 快速转移（光标空且本格有物时）
      if (e.shiftKey && !this._invHeld && Player.invSlots[idx]) {
        this._invShiftTransfer(idx); this._invRenderAndGhost(); return;
      }
      this._invMouseDown(idx, e.button);
    });
    g.addEventListener('contextmenu', (e) => {
      e.preventDefault();   // 只阻止浏览器右键菜单；右键交互统一由 mousedown(button=2) 处理，避免与 contextmenu 双触发
    });
    g.addEventListener('mouseover', (e) => {
      const idx = this._slotIndexFromEvent(e);
      if (idx == null) return;
      this._invMouseOver(idx);
    });
    g.addEventListener('dblclick', (e) => {
      const idx = this._slotIndexFromEvent(e);
      if (idx == null) return;
      this._invDblClick(idx);
    });
  };
  bind('inv-grid-main');
  bind('inv-grid-hotbar');
  // ghost 跟随鼠标
  const ov = document.getElementById('inventory-overlay');
  if (ov) {
    ov.addEventListener('mousemove', (e) => {
      const gg = document.getElementById('inv-held');
      if (gg && gg.style.display !== 'none') {
        gg.style.left = e.clientX + 'px';
        gg.style.top = e.clientY + 'px';
      }
      this._invDragHover(e.clientX, e.clientY);   // 拖动中按坐标记录经过的格子
    });
  }
  // 全局松开：结束拖拽
  window.addEventListener('mouseup', () => this._invMouseUp());
  // 键盘：数字 1-9 移物到快捷栏、Q 丢弃光标物
  window.addEventListener('keydown', (e) => {
    if (!this._inventoryOpen) return;
    if (e.key >= '1' && e.key <= '9') { this._invNumberKey(parseInt(e.key, 10)); }
    else if (e.key === 'q' || e.key === 'Q') { this._invDropHeld(); }
  });
};


// ─────────────────────────────────────────────
// ④ MC 2×2 合成格（数据驱动；shapeless：只看格内物品数量）
// ─────────────────────────────────────────────
// 合成格状态：4 格，每格 { item, count } 或 null。放入即从 Player 扣除，取出即归还。
UI._craftGrid = null;
// 物品 id → Player 字段（后续 MC 配方加物品时在此扩映射）
UI._craftResField = { oak_log: 'wood', oak_planks: 'planks' };
// 物品 id → 贴图 key
UI._craftIconKey  = { oak_log: 'oak_log_3d', oak_planks: 'oak_planks_3d' };
UI._craftName     = { oak_log: '橡木原木', oak_planks: '橡木木板' };

UI._craftCount = function(item) {
  const f = this._craftResField[item];
  return f ? (Player[f] || 0) : 0;
};
UI._craftTake = function(item, n) {
  const f = this._craftResField[item]; if (!f) return 0;
  const take = Math.min(Player[f] || 0, n); Player[f] -= take; return take;
};
UI._craftGive = function(item, n) {
  const f = this._craftResField[item]; if (!f) return;
  Player[f] = (Player[f] || 0) + n;
};

/** 按 DATA.CRAFT_2X2 解算当前格内产出（shapeless：匹配物品数量即可） */
UI._resolveCraft = function() {
  const grid = this._craftGrid || [null, null, null, null];
  const tally = {};
  grid.forEach(c => { if (c) tally[c.item] = (tally[c.item] || 0) + c.count; });
  const recipes = (typeof DATA !== 'undefined' && DATA.CRAFT_2X2) ? DATA.CRAFT_2X2 : [];
  for (const r of recipes) {
    const keys = Object.keys(r.in);
    if (keys.length !== 1) continue;
    const key = keys[0], have = tally[key] || 0;
    if (have >= r.in[key]) {
      const n = Math.floor(have / r.in[key]);
      return { item: r.out.item, count: r.out.count * n };
    }
  }
  return null;
};

UI._craftCellHTML = function(item, count) {
  const src = (this._craftIconKey[item] && ASSETS.registry[this._craftIconKey[item]]) || '';
  return (src ? `<img src="${src}" alt="${item}">` : '') + (count > 1 ? `<span class="inv-count">${count}</span>` : '');
};

/** 点击合成格：空格→从背包取 1 个可合成材料放入；有物→取出归还背包 */
UI._craftCellClick = function(i) {
  if (!this._craftGrid) this._craftGrid = [null, null, null, null];
  const c = this._craftGrid[i];
  if (c) {
    this._craftGive(c.item, c.count);
    this._craftGrid[i] = null;
    Player._rebuildInvSlots();          // 合成改动资源 → 重建布局以同步数量
    this.renderInventory();
    return;
  }
  for (const item of ['oak_log', 'oak_planks']) {
    if (this._craftCount(item) > 0) {
      const took = this._craftTake(item, 1);
      if (took > 0) {
        this._craftGrid[i] = { item, count: took };
        Player._rebuildInvSlots();
        this.renderInventory();
        return;
      }
    }
  }
  this.showStatus('没有可放入合成格的材料', 1000);
};

/** 点击产出格：领取合成结果，清空合成格（材料已在放入时扣除） */
UI._craftCollect = function(res) {
  this._craftGrid = [null, null, null, null];
  this._craftGive(res.item, res.count);
  Player._rebuildInvSlots();            // 合成产出资源 → 重建布局以同步数量
  this.renderInventory();
  this.showStatus('合成 → ' + (this._craftName[res.item] || res.item) + '×' + res.count, 1400);
};

/** 渲染合成格 + 产出格（每次 renderInventory 调用） */
UI._renderCraft = function() {
  if (!this._craftGrid) this._craftGrid = [null, null, null, null];
  const grid = document.getElementById('inv-craft-grid');
  if (grid) {
    grid.querySelectorAll('.craft-cell').forEach((el, i) => {
      const c = this._craftGrid[i];
      el.innerHTML = c ? this._craftCellHTML(c.item, c.count) : '';
      el.onclick = () => this._craftCellClick(i);
    });
  }
  const out = document.getElementById('inv-craft-out');
  if (out) {
    const res = this._resolveCraft();
    out.innerHTML = res ? this._craftCellHTML(res.item, res.count) : '';
    out.onclick = res ? () => this._craftCollect(res) : null;
    out.style.cursor = res ? 'pointer' : 'default';
  }
};


/** 种子贴图 key 映射（统一用 MC 贴图，不再混用小图） */
UI._seedIconKey = function(cropId) {
  return ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries', acorn: 'acorn' })[cropId] || 'wheat_seeds';
};

/** 渲染底部始终可见的 MC 风格快捷栏（9 格） */
UI._renderBottomHotbar = function() {
  const grid = document.getElementById('bottom-hotbar');
  if (!grid) return;
  if (!Player.invSlots) Player._rebuildInvSlots();
  UI._bindBottomHotbar();
  grid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const idx = 27 + i;
    const slot = Player.invSlots[idx];
    const cell = document.createElement('div');
    cell.className = 'hotbar-cell';
    if (i === Player._hotbarSel) cell.classList.add('selected');
    cell.dataset.index = i;
    const bgKey = (i === Player._hotbarSel) ? 'gamemode_switcher_selection' : 'gamemode_switcher_slot';
    const bgSrc = this._assetURL(bgKey);
    if (bgSrc) cell.style.backgroundImage = 'url("' + bgSrc + '")';
    if (slot) {
      const icon = document.createElement('img');
      icon.className = 'item-icon';
      const toolKeyMap = { hoe: 'wooden_hoe', water: 'water_bucket', axe: 'wooden_axe', acorn: 'acorn' };
      const iconSrc = slot.kind === 'tool'
        ? this._assetURL(toolKeyMap[slot.toolId] || slot.toolId)
        : slot.kind === 'seed'
          ? this._assetURL(this._seedIconKey(slot.seedId))
          : this._assetURL(slot.key || slot.kind);
      if (iconSrc) icon.src = iconSrc;
      else if (slot.kind === 'seed') icon.src = this._assetURL('wheat_seeds');
      cell.appendChild(icon);
      if (slot.count > 1) {
        const cnt = document.createElement('span');
        cnt.className = 'item-count';
        cnt.textContent = slot.count;
        cell.appendChild(cnt);
      }
    }
    grid.appendChild(cell);
  }
};

/** 一次性绑定底部快捷栏滚轮、点击和触摸滑动事件 */
UI._bindBottomHotbar = function() {
  if (this._bottomHotbarBound) return;
  this._bottomHotbarBound = true;
  const grid = document.getElementById('bottom-hotbar');
  if (!grid) return;
  // 鼠标滚轮（桌面）
  document.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY || e.deltaX);
    Player._hotbarSel = (Player._hotbarSel + delta + 9) % 9;
    UI._invApplyHotbarSel();
    UI._renderBottomHotbar();
  }, { passive: false });
  // 点击选中
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.hotbar-cell');
    if (!cell) return;
    const i = parseInt(cell.dataset.index, 10);
    if (isNaN(i)) return;
    Player._hotbarSel = i;
    UI._invApplyHotbarSel();
    UI._renderBottomHotbar();
  });
  // 触摸滑动（手机）：左滑→下一个，右滑→上一个
  let _touchStartX = null;
  const SWIPE_THRESHOLD = 30;
  grid.addEventListener('touchstart', (e) => {
    _touchStartX = e.touches[0].clientX;
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (_touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - _touchStartX;
    _touchStartX = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    const delta = Math.sign(-dx);
    Player._hotbarSel = (Player._hotbarSel + delta + 9) % 9;
    UI._invApplyHotbarSel();
    UI._renderBottomHotbar();
  }, { passive: true });
};

