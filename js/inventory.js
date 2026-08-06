/**
 * inventory.js — 背包子系统（MC 物品栏风格 DOM 弹窗）
 *
 * 从 ui.js 拆出，方法仍挂在全局 UI 对象上（`UI.x = function(){…}`），
 * 所有 this.* 跨方法调用与原实现完全一致，仅文件位置变化。
 *
 * ── 结构导航 ──
 *  ① 开关：openInventory · closeInventory
 *  ② 渲染：renderInventory（按 64 一格堆叠，复用 UI._stackChunks）
 *  ③ 槽位构建：_makeSlot（单个物品格 DOM + 点击装备逻辑）· _seedIconKey
 */

// ─────────────────────────────────────────────
// ① 开关
// ─────────────────────────────────────────────

/** 打开背包（MC 物品栏 GUI：inventory.png 纹理背景） */
UI.openInventory = function() {
  if (this._inventoryOpen) return;
  if (this._shopOpen) this.closeShop();   // 互斥：打开背包时先收起商店，避免两者叠在一起
  this._inventoryOpen = true;
  Engine.pause();
  const panel = document.getElementById('inventory-panel');
  const invImg = this._assetURL('inventory');
  if (invImg) panel.style.backgroundImage = `url(${invImg})`;
  this.renderInventory();
  document.getElementById('inventory-overlay').className = 'overlay-visible';
};


/** 关闭背包 */
UI.closeInventory = function() {
  if (!this._inventoryOpen) return;
  document.getElementById('inventory-overlay').className = 'overlay-hidden';
  this._inventoryOpen = false;
  Engine.resume();
  this.render();
};


// ─────────────────────────────────────────────
// ② 渲染
// ─────────────────────────────────────────────

/** 渲染背包（纯展示：金币 + 种子 + 收获物；交易统一在商店进行） */
UI.renderInventory = function() {
  // 金币（钱进背包：顶部金币栏显示当前余额）
  document.getElementById('inv-money-val').textContent = Player.money;
  const moneyIcon = document.getElementById('inv-money-icon');
  moneyIcon.src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.money) || '';

  // 主物品栏：种子 + 收获物（仅展示，不可在背包内交易）
  const main = document.getElementById('inv-grid-main');
  main.innerHTML = '';
  const slots = [];

  // 工具（锄头 / 水桶）：开局即拥有，作为固定物品显示在背包里；点一下即装备（见 _makeSlot）
  if (ASSETS.registry.wooden_hoe) {
    slots.push(this._makeSlot({ iconKey: 'wooden_hoe', count: 1, label: '锄头', kind: 'tool', toolId: 'hoe' }));
  }
  if (ASSETS.registry.water_bucket) {
    slots.push(this._makeSlot({ iconKey: 'water_bucket', count: 1, label: '水桶', kind: 'tool', toolId: 'water' }));
  }
  // 斧头：需先在商店购买（30 金锭 + 5 小麦），拥有后才显示在背包里，点击即装备
  if (ASSETS.registry.wooden_axe && Player.ownedTools && Player.ownedTools.axe) {
    slots.push(this._makeSlot({ iconKey: 'wooden_axe', count: 1, label: '木斧头', kind: 'tool', toolId: 'axe' }));
  }

  // 堆叠辅助：每种物品每格最多 64 个（MC 标准堆叠），超出拆成多个格。
  const pushStacks = (iconKey, total, label, kind, seedId) => {
    for (const inSlot of this._stackChunks(total)) {
      slots.push(this._makeSlot({ iconKey, count: inSlot, label, kind, seedId }));
    }
  };

  // 金锭（金币余额）：按 64 一组堆叠进背包网格，使背包内有可见的金锭物品
  pushStacks('money', Player.money, '金锭', 'crop');

  // 拥有的种子：仅显示已购买/拥有的，未购买的不再占位
  DATA.SHOP_ITEMS.forEach(item => {
    const def = DATA.CROPS[item.id];
    if (!def) return;
    const have = Player.seeds[item.id] || 0;
    if (have <= 0) return;
    slots.push(this._makeSlot({
      iconKey: this._seedIconKey(item.id),
      count: have,
      label: def.name,
      kind: 'seed',
      seedId: item.id,
    }));
  });

  // 已收获的作物
  for (const [cropId, count] of Object.entries(Player.inventory)) {
    const def = DATA.CROPS[cropId];
    if (!def || !count || count <= 0) continue;
    slots.push(this._makeSlot({
      iconKey: def.assetHarvest,
      count,
      label: def.name,
      kind: 'crop',
    }));
  }

  // 木头（资源）：砍树获得，暂只产不出（为后续建造/经济闭环铺路）
  if (Player.wood > 0) pushStacks('oak_log_3d', Player.wood, '木头', 'crop');

  // 树苗（资源/可种植物）：砍树掉落 1~3 个；有才显示，点击选中「树苗」工具去树场空格种植
  if (Player.saplings > 0) {
    slots.push(this._makeSlot({
      iconKey: 'oak_sapling',
      count: Player.saplings,
      label: '树苗',
      kind: 'tool',
      toolId: 'sapling',
    }));
  }

  slots.slice(0, 27).forEach(s => main.appendChild(s));
  // 补齐空槽，保持 9×3 网格视觉完整
  for (let i = main.children.length; i < 27; i++) {
    main.appendChild(document.createElement('div'));
  }

  // 快捷栏：9 个空槽（仅装饰，保持纹理完整；不再含“全部出售”）
  const hotbar = document.getElementById('inv-grid-hotbar');
  hotbar.innerHTML = '';
  for (let i = 0; i < 9; i++) hotbar.appendChild(document.createElement('div'));
};


// ─────────────────────────────────────────────
// ③ 槽位构建
// ─────────────────────────────────────────────

/** 构造一个物品格子（种子/工具可点击选择并装备；作物仅展示） */
UI._makeSlot = function({ iconKey, count, label, kind, seedId, toolId, emoji }) {
    const slot = document.createElement('div');
    const slotCls = kind === 'seed' ? 'seed' : (kind === 'tool' ? 'tool' : 'crop');
    slot.className = 'inv-slot ' + slotCls;
    const src = (!emoji && this._assetURL(iconKey)) || '';
    const selectable = (kind === 'seed' && seedId && count > 0) || (kind === 'tool' && toolId);
    if (kind === 'seed') {
      slot.title = selectable ? `${label} · 拥有${count}（点击选择）` : `${label} · 拥有${count}`;
    } else if (kind === 'tool') {
      slot.title = selectable ? `${label}（点击装备）` : label;
    } else {
      slot.title = `${label} ×${count}`;
    }
    const showCount = count > 0 ? count : '';
    slot.innerHTML = `
      ${emoji ? `<span class="inv-emoji">${emoji}</span>` : (src ? `<img src="${src}" alt="${label}">` : '')}
      ${showCount !== '' ? `<span class="inv-count">${showCount}</span>` : ''}
    `;
    // 点击种子/工具 → 装备（关闭背包、刷新手持槽、提示），随后即可去地里使用
    if (selectable) {
      slot.style.cursor = 'pointer';
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kind === 'tool') {
          this._equipAndClose(toolId, `选择工具：${label}`, 800);
        } else {
          this._equipAndClose('seed-' + seedId, `选择种子：${label}`, 1000);
        }
      });
    }
    return slot;
  };


/** 装备选中工具/种子并关闭背包、刷新手持槽与状态提示（_makeSlot 内 tool/seed 两分支共用，消除重复的 4 行装备逻辑） */
UI._equipAndClose = function(toolSel, msg, dur) {
  Player.selectTool(toolSel);
  this._updateHeldSlot();
  this.closeInventory();
  this.showStatus(msg, dur);
};


/** 种子贴图 key 映射（统一用 MC 贴图，不再混用小图） */
UI._seedIconKey = function(cropId) {
  return ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries' })[cropId] || 'wheat_seeds';
};
