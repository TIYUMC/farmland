/**
 * shop.js — 商店子系统（村民交易 GUI）
 *
 * 从 ui.js 拆出，方法仍挂在全局 UI 对象上（`UI.x = function(){…}`），
 * 所有 this.* 跨方法调用与原实现完全一致，仅文件位置变化。
 *
 * ── 结构导航 ──
 *  ① 开关：openShop · closeShop
 *  ② 交易构建与成交：_buildTrades · _toolReady · _executeTrade
 *  ③ 画布渲染：_drawShopOverlay（整个交易面板的唯一绘制入口）
 *  ④ 交互输入：_onShopClick · _changeShopSel · _onShopWheel
 *            · _onShopBarDown · _onShopBarMove · _onShopMove
 */

// ─────────────────────────────────────────────
// ① 开关
// ─────────────────────────────────────────────

/** 打开商店（村民交易 GUI，直接画在游戏画布上，不用 DOM 弹窗） */
UI.openShop = function() {
  if (this._shopOpen) return;
  this._shopOpen = true;
  if (this._inventoryOpen) this.closeInventory(); // 打开商店时收起背包
  this._trades = this._buildTrades();
  this._shopSel = this._trades.length ? this._trades[0].id : null;
  this._shopHover = null;
  this._shopScroll = 0;       // 每次开店都从第一行看起
  this._shopBarDrag = false;
  this._resetToolParts();
  this._markShopDirty();
};


/** 关闭商店 */
UI.closeShop = function() {
  if (!this._shopOpen) return;
  this._shopOpen = false;
  this._shopLayout = null;
  this._shopDroppedId = null;
  this._shopReservedKey = null;
  this._shopDroppedCount = null;
  this._resetToolParts();
  this._shopDirty = false;
  const si = document.getElementById('shop-icons');
  if (si) si.innerHTML = '';
  Engine.resume();
  this.render();
};

/** 成交后重建交易列表并刷新 UI（_executeTrade 三分支末尾共用，逐字同形）。 */
UI._refreshTradesAfterDeal = function() {
  this._trades = this._buildTrades();
  if (!this._trades.find(x => x.id === this._shopSel)) this._shopSel = this._trades[0] && this._trades[0].id;
  this._updateHUD();
  this._markShopDirty();
};

/** 把元素居中定位到画布坐标（top 下移 2px 避免 Math.round 向下取整裁顶，见 _makeSlot）。 */
UI._centerEl = function(el, x, y, w, h) {
  el.style.left = Math.round(x - w / 2) + 'px';
  el.style.top = (Math.round(y - h / 2) - 2) + 'px';
};

/** 标记商店 UI 需重绘并立即重绘（_shopDirty + render 在多处重复，含两行与单行逗号链两种形态，统一收口）。 */
UI._markShopDirty = function() {
  this._shopDirty = true;
  this.render();
};


// ─────────────────────────────────────────────
// ② 交易构建与成交
// ─────────────────────────────────────────────

/** 按 id 查商店条目（本文件内 _toolReady / _executeTrade / _renderShopList / _renderShopActive / 触控自动填 共 5 处复用）；找不到返回 undefined，与 economy.js `_findShopItem` 同语义 */
UI._findShopItem = function(id) {
  return DATA.SHOP_ITEMS.find(s => s.id === id);
};

/** 构建交易选项（基于 DATA.SHOP_ITEMS：作物生成「买种子」+「卖作物」两项；工具生成「买工具」一项） */
UI._buildTrades = function() {
  const trades = [];
  for (const item of DATA.SHOP_ITEMS) {
    // 工具类（如木斧头）：单独一种交易类型 kind:'tool'，输入=金锭，输出=工具贴图
    if (item.type === 'tool') {
      // 附加材料（如木斧头 = 20 金锭 + 5 小麦）放进村民 GUI 的第二个输入槽
      const extra = (item.costItems && item.costItems[0]) || null;
      const exDef = extra ? DATA.CROPS[extra.id] : null;
      trades.push({
        id: 'buy_' + item.id, kind: 'tool', cropId: item.id,
        label: '买' + item.name,
        input:  { key: 'money', label: String(item.cost) },
        input2: extra
          ? { key: (exDef && (exDef.shopSellIcon || exDef.assetHarvest)) || extra.id,
              count: extra.count,
              label: ((exDef && exDef.name) || extra.id) + '×' + extra.count }
          : null,
        output: { key: 'wooden_axe', label: item.name },
        canDo: Economy.canBuyTool(item.id).ok,
      });
      continue;
    }
    const cropId = item.id;
    const def = DATA.CROPS[cropId];
    if (!def) continue;
    trades.push({
      id: 'buy_' + cropId, kind: 'buy', cropId,
      label: '买' + item.name,
      input:  { key: 'money', label: String(def.seedCost) },
      output: { key: this._seedIconKey(cropId), label: item.name },
      canDo: Player.money >= def.seedCost,
    });
    const have = Player.inventory[cropId] || 0;
    trades.push({
      id: 'sell_' + cropId, kind: 'sell', cropId,
      label: '卖' + def.name,
      input:  { key: def.shopSellIcon || def.assetHarvest, label: def.name + '×' + have },
      output: { key: 'money', label: String(have * def.sellPrice) },
      canDo: have > 0,
    });
  }
  return trades;
};


/** 工具交易：所需材料是否都已拖入输入框（金锭 + 各附加材料数量达标） */
UI._toolReady = function(t) {
  const item = UI._findShopItem(t.cropId);
  if (!item) return false;
  const m = this._toolParts || {};
  if ((m['money'] || 0) < item.cost) return false;
  // 附加材料：拖入时按「拖拽 key」(t.input2.key，如『小麦』) 存入 _toolParts，
  // 而成本表用 costItems[].id(如『wheat』)，二者命名可能不一致，故两边都计入再比对，
  // 否则会出现「明明拖够了却永远判定材料不足、买不了」的 bug。
  for (const need of (item.costItems || [])) {
    const dragKey = (t.input2 && t.input2.key) || need.id;
    const have = (m[need.id] || 0) + (m[dragKey] || 0);
    if (have < need.count) return false;
  }
  return true;
};


/** 执行选中交易（成交后从输入栏数量中扣除，实时显示剩余） */
UI._executeTrade = function(t) {
  const isTool = t.kind === 'tool';
  const tItem = isTool ? UI._findShopItem(t.cropId) : null;
  // 调试模式（Engine.debugFast）：商店无视一切限制直接成交，方便快速拿资源/工具测试
  // （调试成交静默执行，不弹调试提示，避免干扰正常游玩）
  if (typeof Engine !== 'undefined' && Engine.debugFast) {
    if (isTool) {
      Player.ownedTools[t.cropId] = true;
      Player.selectTool(t.cropId);
      Player._rebuildInvSlots();   // 工具加入背包，重建缓存使快捷栏可见
      UI._renderBottomHotbar();    // 刷新底部 MC 快捷栏 DOM
      this._updateHeldSlot();
    } else if (t.kind === 'buy') {
      Player.addSeeds(t.cropId, 1);
      Player._rebuildInvSlots();   // 种子加入背包，同步缓存
      UI._renderBottomHotbar();    // 刷新底部 MC 快捷栏 DOM
    } else {
      const cnt = Player.inventory[t.cropId] || 0;
      const def = DATA.CROPS[t.cropId];
      if (cnt > 0) { Player.addMoney(def.sellPrice * cnt); delete Player.inventory[t.cropId]; }
    }
    this._refreshTradesAfterDeal();
    return;
  }
  // 工具（如木斧头 = 20 金锭 + 5 小麦）：必须先把金锭 + 小麦拖入输入框（_toolReady 齐全）才能点结果槽成交
  if (isTool) {
    if (this._guard(!this._toolReady(t), '请先把材料拖入输入框')) return;
    const chk = Economy.canBuyTool(t.cropId);
    if (!chk.ok) { this.showStatus(`❌ ${chk.reason}`, 1400); return; }
    const res = Economy.buyTool(t.cropId);
    if (res && res.ok) {
      this.showStatus(`✅ 购买了 ${res.name}`, 1000);
      Player.selectTool(t.cropId);   // 买完直接装备，方便马上去砍树
      this._updateHeldSlot();
      this._resetToolParts();  // 清空已拖入的材料
    } else {
      this.showStatus(`❌ ${res ? res.reason : '交易失败'}`, 1200);
    }
    this._refreshTradesAfterDeal();
    return;
  }
  // 以下为作物「买种子 / 卖作物」：必须先已把正确原材料拖入输入框
  if (this._guard(this._shopDroppedId !== t.id, '请先把原材料拖入输入框')) return;
  const def = DATA.CROPS[t.cropId];
  const cost = t.kind === 'buy' ? def.seedCost : 1;
  if (this._shopDroppedCount < cost) {
    this.showStatus(t.kind === 'buy' ? '❌ 金锭不足，无法继续购买' : '❌ 作物不足', 1200);
    return;
  }
  const res = t.kind === 'buy'
    ? Economy.buySeed(t.cropId)
    : Economy.sellCropUnits(t.cropId, 1);
  if (res && res.ok) {
    this._shopDroppedCount -= cost;
    if (t.kind === 'buy') {
      this.showStatus(`✅ 购买了 ${res.name}`, 1000);
      Player.selectTool(`seed-${t.cropId}`);
      this._updateHeldSlot();
    } else {
      this.showStatus(`💰 售出 ${res.name}×${res.count}，+${res.total}`, 1800);
    }
    // 输入栏扣到 0（如作物全部卖光）则清空，需重新拖入
    if (this._shopDroppedCount <= 0) {
      this._resetShopDropped();
    }
  } else {
    this.showStatus(`❌ ${res ? res.reason : '交易失败'}`, 1200);
  }
  this._refreshTradesAfterDeal();
};


// ─────────────────────────────────────────────
// ③ 画布渲染
// ─────────────────────────────────────────────

/**
 * 画布渲染：村民交易 GUI —— 直接放大绘制 villager_gui 纹理，物品贴图合成进其真实槽位。
 *
 * 本函数约 360 行，是商店的唯一绘制入口。内部按「绘制顺序」分为 7 段，
 * 每段以 `// ===== X … =====` 标注，检索时可直接跳到对应字母：
 *   A 遮罩与纹理底 —— 半透明黑幕 + villager_gui 内容区(276×166)等比放大
 *   B 坐标系      —— toC() 把纹理坐标映射为画布坐标；以下全部用纹理坐标书写
 *   C DOM 图标层  —— 仅在 _shopDirty 时重建，避免 60fps 重建导致抖动
 *   D 左：交易选项列表 —— 固定行高 20px，超出 7 行走滚动条
 *   E 列表滚动条  —— slider 素材当把手，坐进纹理自带的 6px 滚动槽
 *   F 中：正在交易 —— 输入槽 / 第二材料槽 / 结果槽 + 成交箭头
 *   G 下：背包 9×4 —— 按 64 堆叠，并扣除已拖入输入框的份额
 */
UI._drawShopOverlay = function() {
  const ctx = this.ctx;
  const W = this.canvas.width, H = this.canvas.height;

  // ===== A 遮罩与纹理底 =====
  // 半透明遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  // 纹理内容区 276x166，整体放大到占画面约 94%
  const CW = 276, CH = 166;
  const S = Math.min(W * 0.94 / CW, H * 0.94 / CH);
  const dw = CW * S, dh = CH * S;
  const shopX = (W - dw) / 2, shopY = (H - dh) / 2;

  // 绘制 villager_gui 纹理（裁切到内容区 276x166，放大）
  const img = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get('villager_gui') : null;
  ctx.imageSmoothingEnabled = false;
  if (img) ctx.drawImage(img, 0, 0, CW, CH, shopX, shopY, dw, dh);
  else { ctx.fillStyle = '#3a2d1e'; ctx.fillRect(shopX, shopY, dw, dh); }

  // ===== B 坐标系 =====
  // 坐标转换：纹理内容坐标 → 画布坐标
  const toC = (tx, ty) => ({ x: shopX + tx * S, y: shopY + ty * S });

  // ===== C DOM 图标层（脏标记重建） =====
  // 仅在交易状态变化（开关店/切换选中/成交/窗口缩放）时重建 DOM 图标，
  // 避免每帧（动画循环 ~60fps）清空+重建导致 DOM 抖动与性能浪费
  const shopIcons = document.getElementById('shop-icons');
  const rebuild = !!shopIcons && this._shopDirty;
  if (rebuild) {
    shopIcons.innerHTML = '';
    // 对齐 canvas：叠层原点 = canvas 左上角（canvas 前面有 HUD bar，不能从容器原点算）
    const rect = this.canvas.getBoundingClientRect();
    const containerRect = this.canvas.parentElement.getBoundingClientRect();
    shopIcons.style.top = (rect.top - containerRect.top) + 'px';
    shopIcons.style.left = (rect.left - containerRect.left) + 'px';
  }

  // 用 DOM 渲染物品图标 + 数量角标——跟工具栏同一套浏览器原生缩放管线，清晰度一致
  const createItem = (key, tx, ty, ts, count, suffix) => {
    if (!rebuild) return; // 非重建帧：保留已有 DOM 图标，不重绘
    if (!key || !ASSETS.registry || !ASSETS.registry[key]) return;
    const c = toC(tx, ty);
    const size = ts * S;
    // 关键：用启动时已预加载完成的 Image（ASSETS.get 返回已解码对象）同步读取原始
    // 宽高比，一开始就按正确尺寸摆放 wrap，消除“先画正方形→onload 后再拉宽”的抖动。
    const pre = (typeof ASSETS.get === 'function') ? ASSETS.get(key) : null;
    let w = size, h = size;
    // 按素材真实宽高比绘制，不再钳制（crafting_arrow 等横向素材恢复原本扁横向）
    if (pre && pre.naturalWidth && pre.naturalHeight) {
      const ar = pre.naturalWidth / pre.naturalHeight;
      if (Math.abs(ar - 1) > 0.06) { w = size * ar; h = size; }
    }
    const wrap = document.createElement('div');
    wrap.className = 'shop-item';
    // 列表行图标（tx<=100：输入24/红叉39/输出54）统一加面板色底，使透明留白区
    // 显示面板背景色，避免小麦等顶部透明图看起来像被切掉。中间预览/背包不在此范围。
    if (tx <= 100) wrap.classList.add('shop-item--slot');
    // 背包网格物品（tx>=115 && ty>=91）可拖拽：作为拖入输入框的原材料来源。
    // 仅在重建帧绑定（innerHTML 已清空重建），this 继承 render 的 UI 实例。
    if (tx >= 115 && ty >= 91) {
      wrap.classList.add('is-draggable');
      wrap.setAttribute('draggable', 'true');
      wrap.addEventListener('dragstart', (e) => {
        this._dragKey = key;
        // 记录被拖出的堆叠数量（背包按 64 一组，拖哪一格就取那一格的 count）
        this._dragCount = (typeof count === 'number' && count > 0) ? count : 1;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', key);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
      wrap.addEventListener('dragend', () => { this._dragKey = null; });
    }
    this._centerEl(wrap, c.x, c.y, w, h);
    wrap.style.width = Math.round(w) + 'px';
    wrap.style.height = Math.round(h) + 'px';
    const img = document.createElement('img');
    img.src = ASSETS.registry[key];
    img.alt = key;
    // 兜底：极端情况下（预加载尚未完成 / 该 key 未预加载）仍做一次校正。
    // 正常开店路径下 pre 已就绪，onload 算出的尺寸与上面一致，不会触发改写，无抖动。
    img.onload = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (nw && nh) {
        const ar = nw / nh;
        let w2 = size;
        if (Math.abs(ar - 1) > 0.06) { w2 = size * ar; }
        if (Math.abs(w2 - w) > 0.5) {
          wrap.style.width = Math.round(w2) + 'px';
          this._centerEl(wrap, c.x, c.y, w2, h);
        }
      }
    };
    wrap.appendChild(img);
    // 数量角标：买→花费；卖→拥有数量 / 总价（无单位）
    if (count != null && count !== '' && count !== 1) {
      const badge = document.createElement('span');
      badge.className = 'shop-count';
      const num = (typeof count === 'number' && count > 9999) ? Math.round(count / 1000) + 'k' : count;
      badge.textContent = num + (suffix || '');
      wrap.appendChild(badge);
    }
    if (shopIcons) shopIcons.appendChild(wrap);
  };
  const txt = (str, tx, ty, size, color, align) => {
    const c = toC(tx, ty);
    ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${size * S}px "Microsoft YaHei", "Courier New", sans-serif`;
    ctx.fillText(str, c.x, c.y);
  };

  this._shopLayout = { outer: { x: shopX, y: shopY, w: dw, h: dh }, rows: [], resultSlot: null };
  const list = this._trades;

  // ===== D 左：交易选项列表 =====
  // 纹理实测（villager_gui 内容区 276x166）：列表凹槽 x5-92，x93 是分隔竖线，
  // x94-99 是原版 MC 自带的 6px 滚动条槽；竖直方向凹槽 y18-157，共 140px = 7 行 × 20px。
  // 旧版把行高按「条数平分」((156-34)/n)，商品一多每行就被压扁；而且行框高度比行高多出
  // 13 纹理px、与相邻行互相压盖 —— 这两点合起来就是「商店太挤」的根因。
  // 现改为：固定行高 20px（对齐纹理凹槽）+ 超出 7 行的部分靠右侧滚动条滚动。
  const listX0 = 5, listX1 = 93;
  const listY0 = 18, listY1 = 158;
  const barX0 = 94, barW = 6;           // 滚动条槽：纹理里本来就留好了
  const ROW_H = 20;                     // 固定行高，不再随交易条数变化
  const VIS = Math.max(1, Math.floor((listY1 - listY0) / ROW_H));
  const maxScroll = Math.max(0, list.length - VIS);
  this._shopScroll = Math.min(Math.max(0, this._shopScroll || 0), maxScroll);
  this._shopVis = VIS;                  // 键盘上下切换时用来保证选中行滚进可视区
  const firstRow = this._shopScroll;

  list.slice(firstRow, firstRow + VIS).forEach((t, vi) => {
    const ry = listY0 + ROW_H * vi;     // 行顶（纹理px）
    const cyc = ry + ROW_H / 2;         // 行中心：图标与行框共用，天然居中，不再需要手动上移
    const selected = t.id === this._shopSel;
    const def = DATA.CROPS[t.cropId];           // 作物类才有；工具类为 undefined
    const tItem = UI._findShopItem(t.cropId);
    const have = Player.inventory[t.cropId] || 0;
    const rx = shopX + listX0 * S, ryc = shopY + ry * S;
    const rw = (listX1 - listX0) * S, rh = ROW_H * S;
    // 每行都用模板框填满整行，兼作行底与选择框：
    //   普通行 -> blank_row_frame（浅灰星露谷框）
    //   选中行 -> row_frame_sel（用户新增的深色高亮框），突出当前项
    // 尺寸严格等于「行矩形内缩 1 纹理px」，不再超出行高，行与行之间互不压盖。
    const frameKey = selected ? 'row_frame_sel' : 'blank_row_frame';
    const frame = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get(frameKey) : null;
    if (frame) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, 0, 0, frame.naturalWidth, frame.naturalHeight,
                    rx + 1 * S, ryc + 1 * S, rw - 2 * S, rh - 2 * S);
    }
    // 输入/输出槽保持原物品图标（输入槽不替换成叉叉）
    // 左侧列表行统一用「输入 → (附加材料) → 输出」配方排版，并对齐到固定栅格：
    //   x=18 输入 / x=42 附加材料 / x=66 输出（买/卖行只有输入+输出，中间无附加材料）
    //   两图标之间用 crafting_arrow 小箭头连接，与星露谷合成界面同款，整列左右对齐。
    const ARROW_TS = 9;
    if (t.kind === 'buy') {
      createItem(t.input.key, 18, cyc, 13, def.seedCost);
      createItem('crafting_arrow', 42, cyc, ARROW_TS);
      createItem(t.output.key, 66, cyc, 13, 1);         // 种子固定 1
    } else if (t.kind === 'tool') {
      // 左侧列表行也展示完整配方：金锭+附加材料「并排=配方成本」→ 工具，让「30金+5小麦」一眼可见。
      // 成本两项之间不加箭头（金锭与小麦是一家），只在成本→工具之间留箭头。
      createItem(t.input.key, 18, cyc, 13, tItem.cost);
      if (t.input2) createItem(t.input2.key, 32, cyc, 13, t.input2.count);
      createItem('crafting_arrow', 49, cyc, ARROW_TS);
      createItem(t.output.key, 66, cyc, 13, 1);         // 工具固定 1
    } else {
      // 卖行右侧输出槽始终显示「单价」（单颗作物的售价），不再随持有数量放大成总价。
      // 输入槽仍显示当前拥有数量，与买行（输入=花费、输出=1 颗种子）保持「左数量右单价」的对称布局。
      createItem(t.input.key, 18, cyc, 13, have > 0 ? have : 1);
      createItem('crafting_arrow', 42, cyc, ARROW_TS);
      createItem(t.output.key, 66, cyc, 13, def.sellPrice);
    }
    // 左侧列表行不再叠加红叉（按用户要求移除选择框中间的叉叉）
    // 命中区只登记「当前可见的行」，滚动后自动跟着换，点击/悬停不会错位
    this._shopLayout.rows.push({ id: t.id, x: rx, y: ryc, w: rw, h: rh });
  });

  // ===== E 列表滚动条：用户的 slider 素材当把手，坐进纹理自带的 6px 滚动槽 =====
  {
    const trackX = shopX + barX0 * S, trackY = shopY + listY0 * S;
    const trackW = barW * S, trackH = (listY1 - listY0) * S;
    const simg = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get('slider') : null;
    // 把手宽度铺满 6px 槽，高度按素材原始宽高比推出来 —— 只等比缩放，不拉伸变形
    const ratio = (simg && simg.naturalWidth) ? (simg.naturalHeight / simg.naturalWidth) : 1.25;
    const thumbH = trackW * ratio;
    const prog = maxScroll > 0 ? (this._shopScroll / maxScroll) : 0;
    const thumbY = trackY + (trackH - thumbH) * prog;
    if (simg) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = maxScroll > 0 ? 1 : 0.4;   // 条数没超出一屏时置灰，表示不可滚（同原版）
      ctx.drawImage(simg, trackX, thumbY, trackW, thumbH);
      ctx.globalAlpha = 1;
    }
    this._shopLayout.scrollBar = { x: trackX, y: trackY, w: trackW, h: trackH, thumbH, maxScroll };
  }

  // ===== F 中：正在交易（输入槽143,44 / 结果槽227,44，点击种子即交易，无按钮）=====
  const t = list.find(x => x.id === this._shopSel) || list[0];
  if (t) {
    const isTool = t.kind === 'tool';
    const tItem = isTool ? UI._findShopItem(t.cropId) : null;
    // 拖入对应原材料前：输入槽与输出框都为空（只有透明投放区虚线框提示此处可放置），
    // 避免「还没拖拽就显示着东西」的错觉；拖入匹配后两者才一起出现。
    const dropped = this._shopDroppedId === t.id;
    if (t.kind === 'buy') {
      const def = DATA.CROPS[t.cropId];
      if (dropped) {
        // 输入栏显示实际拖入的金锭数量（如 64），而非固定花费 20
        createItem(t.input.key, 144, 45, 14, this._shopDroppedCount);
        createItem(t.output.key, 227, 45, 16, 1); // 每次成交得 1 颗种子
      }
    } else if (isTool) {
      // 工具：拖入材料前输入槽为空（透明投放区提示可放置）；拖入后显示实际数量
      const m = this._toolParts || {};
      if (m['money']) createItem(t.input.key, 144, 45, 14, m['money']);
      if (t.input2 && m[t.input2.key]) createItem(t.input2.key, 170, 45, 14, m[t.input2.key]);
      // 斧头等成品仅在材料(金锭+小麦)齐全(_toolReady)时才显示，避免「没放原材料就显示成品」的错觉
      if (this._toolReady(t)) createItem(t.output.key, 227, 45, 16, 1);
    } else {
      const def = DATA.CROPS[t.cropId];
      if (dropped) {
        // 输入栏显示实际拖入的作物数量；输出显示「几个换几个」——拖入 N 个作物可换得的总金币
        createItem(t.input.key, 144, 45, 14, this._shopDroppedCount);
        createItem(t.output.key, 227, 45, 16, this._shopDroppedCount * def.sellPrice);
      }
    }
    // 重建帧：在输入槽上方覆盖透明投放区，接收从背包拖入的原材料
    if (rebuild && shopIcons) {
      if (isTool) {
        // 工具：每个所需材料一个投放区（金锭@144 + 附加材料@170），拖入后才算「已放入」
        const tSlots = [{ key: 'money', cx: 144, cy: 45, label: '金锭' }];
        if (t.input2) tSlots.push({ key: t.input2.key, cx: 170, cy: 45, label: t.input2.name || '材料' });
        for (const sl of tSlots) {
          this._makeShopDropzone(shopIcons, toC(sl.cx, sl.cy), S, (e) => {
            e.preventDefault();
            const key = this._dragKey;
            if (!key) return;
            if (this._guard(key !== sl.key, `❌ 这个槽只能放${sl.label}`)) return;
            const cnt = this._dragCount || 0;
            this._toolParts[sl.key] = (this._toolParts[sl.key] || 0) + cnt;
            if (!this._toolReserved.includes(sl.key)) this._toolReserved.push(sl.key);
            this._markShopDirty();
          });
        }
      } else {
        // 作物：单投放区（买=金锭 / 卖=作物），保持原逻辑
        this._makeShopDropzone(shopIcons, toC(144, 45), S, (e) => {
          e.preventDefault();
          const key = this._dragKey;
          if (!key) return;
          const cur = this._trades.find(z => z.id === this._shopSel);
          if (!cur) return;
          // 卖出行的背包作物图标(key=assetHarvest)常与行内显示图标(key=shopSellIcon)不同，
          // 因此按 cropId 解析可接受的拖入 key，避免「物品不匹配」误判。
          const curDef = DATA.CROPS[cur.cropId];
          const acceptKeys = cur.kind === 'sell'
            ? [curDef.assetHarvest, curDef.shopSellIcon].filter(Boolean)
            : [cur.input.key];
          if (acceptKeys.includes(key)) {
            this._shopDroppedId = cur.id;
            // 输入栏显示你实际拖进来的堆叠数量（如 64 个金锭），而非固定花费
            this._shopDroppedCount = this._dragCount || 0;
            // 记录被「移动」走的物品 key：背包渲染时据此扣减，使其从背包消失
            this._shopReservedKey = (cur.kind === 'buy')
              ? 'money'
              : DATA.CROPS[cur.cropId].assetHarvest;
            this._markShopDirty();
          } else {
            // 拖入物品与当前选中行不匹配：清空已放入状态，输出框不再显示
            this._resetShopDropped();
            this._markShopDirty();
            this.showStatus('❌ 物品不匹配，请拖入正确原材料', 1200);
          }
        });
      }
    }
    // 中间预览：只要尚未拖入对应物品（输入框为空）或不可交易，就覆盖红色的「叉叉+箭头」，
    // 提示此处需要放入原材料。拖入匹配物品后才显示输入/输出图标。
    {
      let mdisabled;
      if (t.kind === 'sell') {
        const mhave = Player.inventory[t.cropId] || 0;
        mdisabled = mhave === 0;
      } else if (isTool) {
        mdisabled = !Economy.canBuyTool(t.cropId).ok;   // 已拥有 / 金锭不足 / 材料不足
      } else {
        const mdef = DATA.CROPS[t.cropId];
        mdisabled = Player.money < mdef.seedCost;
      }
      if (isTool) {
        // 工具行：材料齐全且可买=普通箭头；缺材料/不可买=红叉。叉叉 (197,46)，普通 (198,45)
        const ready = this._toolReady(t);
        if (!ready || mdisabled) createItem('crafting_arrow_error', 197, 46, 14);
        else createItem('crafting_arrow', 198, 45, 14);
      } else {
        const showError = !dropped || mdisabled;
        if (showError) createItem('crafting_arrow_error', 197, 46, 14);
      }
    }
    // 结果槽（小麦种子）可点击区域：纹理真实范围 x[200-240] y[32-58]
    this._shopLayout.resultSlot = { x: shopX + 200 * S, y: shopY + 32 * S, w: 40 * S, h: 26 * S };
  }

  // ===== G 下：背包（9x4 网格，槽中心 115+18c, 91+18r）=====
  // 堆叠规则：每种物品每格最多 64 个（MC 标准堆叠），数量超过则拆成多个格子。
  // 例：金币 500 → 8 格（7×64 + 52）。金币此前只放图标无数量，现按余额堆叠并带数量角标。
  // 已被拖入输入框、需从背包「扣除」的物品（拖拽=移动而非复制）：
  // 背包按真实总数渲染时减去这份，使其从背包消失、只显示在输入框里。
  const reservedKey = this._shopReservedKey;
  const reserved = (reservedKey && this._shopDroppedId && this._shopDroppedCount > 0)
    ? this._shopDroppedCount : 0;
  const toolParts = this._toolParts || {};
  const toolReserved = this._toolReserved || [];
  const items = [];
  const pushStacks = (key, total) => {
    total = total || 0;
    if (key === reservedKey) total -= reserved; // 扣掉已拖入输入框的那一份（作物单材料）
    if (toolReserved.includes(key) && toolParts[key]) total -= toolParts[key]; // 工具多材料预留
    total = Math.max(0, total);
    for (const inSlot of this._stackChunks(total)) {
      items.push({ key, count: inSlot });
    }
  };
  pushStacks('money', Player.money); // 金币余额按 64 一组堆叠，带数量角标
  DATA.SHOP_ITEMS.forEach(item => {
    const c = Player.seeds[item.id] || 0;
    if (c > 0) pushStacks(this._seedIconKey(item.id), c);
  });
  for (const [cropId, count] of Object.entries(Player.inventory)) {
    if (count > 0) {
      const def = DATA.CROPS[cropId];
      if (def) pushStacks(def.assetHarvest, count);
    }
  }
  for (let i = 0; i < 36 && i < items.length; i++) {
    const c = i % 9, r = Math.floor(i / 9);
    createItem(items[i].key, 115 + 18 * c, 91 + 18 * r, 13, items[i].count);
  }
  // 重建完成，复位脏标记
  if (rebuild) this._shopDirty = false;
};


// ─────────────────────────────────────────────
// ④ 交互输入（点击 / 键盘 / 滚轮 / 滚动条拖拽 / 悬停）
// ─────────────────────────────────────────────

/** 画布点击：商店交互 */
/** 共享：在商店 GUI 上创建一个透明拖放区（26×26 逻辑像素，按缩放 S 换算，居中于 dc）。
 *  工具行的多材料投放区与作物行的单投放区共用此骨架，差异只在 drop 回调。
 *  dc 由调用点用 toC(tx,ty) 换算好后传入（toC 为纯算术，无副作用）。返回创建的元素。 */
  /** 清空已拖入状态：重置拖入的作物/数量/预留 key（3 处重复的三连 null 赋值收口） */
  UI._resetShopDropped = function() {
    this._shopDroppedId = null;
    this._shopDroppedCount = null;
    this._shopReservedKey = null;
  };
  /** 清空已放入工具的材料：重置材料字典与预留列表（5 处重复的双赋值收口） */
  UI._resetToolParts = function() {
    this._toolParts = {};
    this._toolReserved = [];
  };
  /** 按鼠标 y 设商店列表滚动位置（滚动条拖拽与点击槽共用，消除重复的 t 计算 + clamp + 重绘） */
  UI._setShopScrollFromY = function(y) {
    const b = this._shopLayout.scrollBar;
    const t = (y - b.y) / b.h;
    this._shopScroll = Math.min(Math.max(0, Math.round(t * b.maxScroll)), b.maxScroll);
    this._markShopDirty();
  };
UI._guard = function(cond, msg) {
  if (cond) { this.showStatus(msg, 1200); return true; }
  return false;
};
UI._isTouch = function() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
};
UI._makeShopDropzone = function(parent, dc, S, onDrop) {
  const dz = document.createElement('div');
  dz.className = 'shop-dropzone';
  const ds = 26 * S;
  this._centerEl(dz, dc.x, dc.y, ds, ds);
  dz.style.width = ds + 'px';
  dz.style.height = ds + 'px';
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('drop', onDrop);
  parent.appendChild(dz);
  return dz;
};

UI._onShopClick = function(x, y) {
  const L = this._shopLayout;
  if (!L) { this.closeShop(); return; }
  // 点击滚动条区域 → 不触发关店/选行（交给 mousedown 拖拽处理）
  if (L.scrollBar) {
    const b = L.scrollBar;
    if (this._hitRect(x, y, b)) return;
  }
  // 点面板外 → 关闭
  if (x < L.outer.x || x > L.outer.x + L.outer.w || y < L.outer.y || y > L.outer.y + L.outer.h) {
    this.closeShop(); return;
  }
  // 点击结果槽（输出框）成交：必须先已把正确原材料拖入输入框
  if (L.resultSlot && this._hitRect(x, y, L.resultSlot)) {
    const t = this._trades.find(z => z.id === this._shopSel);
    if (t) {
      // 调试模式（Engine.debugFast）：直接成交，无视「先拖材料」限制 —— 工具与商品通用。
      // 必须提在最前面：否则非工具商品会卡在下面「请先把原材料拖入输入框」提前 return，
      // 根本走不到 _executeTrade 里的 debugFast 快捷分支。
      if (typeof Engine !== 'undefined' && Engine.debugFast) {
        this._executeTrade(t);
        return;
      }
      // 工具（如木斧头）：须先把金锭+材料拖入输入框（_toolParts 齐全）才能点结果槽成交
      if (t.kind === 'tool') {
        if (this._toolReady(t)) {
          this._executeTrade(t);   // 统一成交：校验+扣减金锭/材料+清空输入框
        } else {
          if (this._isTouch()) {
            // 触控设备无拖拽：点结果槽时自动「填入」所需金锭+材料再成交
            const item = UI._findShopItem(t.cropId);
            if (this._guard(Player.money < item.cost, `❌ 金锭不足（需要 ${item.cost}）`)) return;
            for (const need of (item.costItems || [])) {
              if ((Player.inventory[need.id] || 0) < need.count) {
                this.showStatus(`❌ ${(DATA.CROPS[need.id] && DATA.CROPS[need.id].name) || need.id}不足（需要 ${need.count}）`, 1300); return;
              }
            }
            this._toolParts = { money: item.cost };
            this._toolReserved = ['money'];
            for (const need of (item.costItems || [])) { this._toolParts[need.id] = need.count; this._toolReserved.push(need.id); }
            this._shopDirty = true;
            this._executeTrade(t);
          } else {
            this.showStatus('请先把金锭和材料拖入输入框', 1200);
          }
        }
        return;
      }
      if (this._shopDroppedId !== t.id) {
        // B7 修复：手机端无拖拽 → 点结果槽时自动「放入」对应材料再成交，绕过拖拽
        if (this._isTouch()) {
          const def = DATA.CROPS[t.cropId];
          if (t.kind === 'buy') {
            if (this._guard(Player.money < def.seedCost, '❌ 金锭不足')) return;
            this._shopDroppedId = t.id;
            this._shopDroppedCount = def.seedCost;   // 放入正好够买的金锭
            this._shopReservedKey = 'money';
          } else {
            const have = Player.inventory[t.cropId] || 0;
            if (this._guard(have <= 0, '❌ 背包里没有可卖的作物')) return;
            this._shopDroppedId = t.id;
            this._shopDroppedCount = 1;              // 每次卖 1 个，避免背包先全消失再回弹
            this._shopReservedKey = def.assetHarvest;
          }
          this._shopDirty = true;
          this._executeTrade(t);                     // 自动成交
        } else {
          this.showStatus('请先把原材料拖入输入框', 1200);
        }
      } else {
        this._executeTrade(t);
      }
    }
    return;
  }
  // 交易选项行
  for (const r of L.rows) {
    if (this._hitRect(x, y, r)) {
      this._shopSel = r.id; this._shopDroppedId = null; this._shopDroppedCount = null; this._shopReservedKey = null; this._resetToolParts(); this._markShopDirty(); return;
    }
  }
};


/** 键盘上下切换选中交易 */
UI._changeShopSel = function(dir) {
  const list = this._trades;
  if (!list || !list.length) return;
  let idx = list.findIndex(t => t.id === this._shopSel);
  if (idx < 0) idx = 0;
  idx = (idx + dir + list.length) % list.length;
  this._shopSel = list[idx].id;
  // 选中行滚出可视区时自动跟随滚动（含首尾循环那一跳）
  const vis = this._shopVis || 7;
  const maxScroll = Math.max(0, list.length - vis);
  let sc = this._shopScroll || 0;
  if (idx < sc) sc = idx;
  else if (idx >= sc + vis) sc = idx - vis + 1;
  this._shopScroll = Math.min(Math.max(0, sc), maxScroll);
  this._resetShopDropped();
  this._resetToolParts();
  this._markShopDirty();
};


/** 滚轮：列表上下滚动（仅在交易数超出可视区时生效） */
UI._onShopWheel = function(e) {
  if (!this._shopOpen) return;
  e.preventDefault();
  const L = this._shopLayout;
  if (!L || !L.scrollBar || L.scrollBar.maxScroll <= 0) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const ms = L.scrollBar.maxScroll;
  this._shopScroll = Math.min(Math.max(0, (this._shopScroll || 0) + dir), ms);
  this._markShopDirty();
};


/** 鼠标按下：点中滚动条则进入拖拽 */
UI._onShopBarDown = function(e) {
  if (!this._shopOpen) return;
  const { x, y } = this._eventToCanvas(e);
  const L = this._shopLayout; if (!L || !L.scrollBar) return;
  const b = L.scrollBar;
  if (this._hitRect(x, y, b)) {
    this._shopBarDrag = true;
    this._setShopScrollFromY(y);
  }
};


/** 鼠标移动：拖拽滚动条把手 */
UI._onShopBarMove = function(e) {
  if (!this._shopBarDrag) return;
  const { y } = this._eventToCanvas(e);
  const L = this._shopLayout; if (!L || !L.scrollBar) return;
  const b = L.scrollBar;
  this._setShopScrollFromY(y);
};


/** 画布悬停：商店交易行高亮 */
UI._onShopMove = function(e) {
  const { x, y } = this._eventToCanvas(e);
  const L = this._shopLayout;
  let hover = null;
  if (L) {
    for (const r of L.rows) {
      if (this._hitRect(x, y, r)) { hover = r.id; break; }
    }
  }
  if (hover !== this._shopHover) { this._shopHover = hover; this.render(); }
};

