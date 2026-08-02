/**
 * ui.js — UI 系统
 * 渲染、工具栏、弹窗、消息提示、每日结算
 */
const UI = {
  // refs
  canvas: null,
  ctx: null,
  cellSize: DATA.FARM.CELL_SIZE,
  offsetX: 0, offsetY: 0,

  statusTimeout: null,
  summaryCallback: null,

  _busy: false,        // 正在执行动作中（期间锁输入，不能干别的事）
  _busyTimer: null,
  BUSY_BASE_MS: 600,   // 满体力时单次动作耗时（毫秒）
  BUSY_SLOW_K: 2.5,    // 体力越低、耗时放大系数：0 体力时耗时 = 满体的 (1+K) = 3.5 倍

  _hoverCell: null, // { row, col } | null

  // 绘制缓存
  _seasonColors: {
    0: { soil: '#7a5c3a', grass: '#6b7f4f', bg: '#74925f', water: '#4a8adf' }, // 春（降绿、偏柔和黄绿，避免过绿）
    1: { soil: '#8a6c3a', grass: '#6a9a4a', bg: '#7aaa5a', water: '#3a7adf' }, // 夏
    2: { soil: '#7a5c3a', grass: '#7a8a3a', bg: '#8a9a4a', water: '#4a7acf' }, // 秋
    3: { soil: '#5a4c3a', grass: '#9e8a40', bg: '#7a7350', water: '#5a8abf' }, // 冬（草改枯黄、比秋更黄；背景转灰黄，告别过绿）
  },

  // 裸土时随机选用的土图（用户新增的 3 种土，已注册进 assets.js registry）
  // 裸土渲染候选土图：随格随机选一种（dirt / coarse_dirt / rooted_dirt 均为桌面源素材，非坏图）
  _bareSoilKeys: ['coarse_dirt', 'dirt', 'rooted_dirt'],

  // 枯黄草(退化态2)的固定染色：比草方块(暗草色)明显更亮更黄，与绿草/草方块都拉开色差
  _dryGrassColor: '#c2a24c',

  // 把 #rrggbb 转成 {r,g,b}
  _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  },

  // 把 'rgb(r,g,b)' 调亮/调暗 amt（正=亮，负=暗）。用于让草丛与底色拉开对比，草才显得出。
  _shade(rgb, amt) {
    const m = String(rgb).match(/\d+/g);
    if (!m || m.length < 3) return rgb;
    const c = (i) => Math.max(0, Math.min(255, (+m[i]) + amt));
    return `rgb(${c(0)},${c(1)},${c(2)})`;
  },

  // 按「季节 + 当天进度」连续插值出当天颜色：每天挪一点点，渐变而非换季硬切。
  // 返回 {soil, grass, bg, water}，格式为 'rgb(r,g,b)'，喂给 ASSETS.getTinted 当缓存键也安全。
  _seasonColorAt() {
    const palette = this._seasonColors;
    const daysPer = DATA.DAYS_PER_SEASON;
    const t = Engine.season + (Engine.day - 1) / daysPer; // 连续季节位置 0..4
    const i0 = Math.floor(t) % 4;
    const i1 = (i0 + 1) % 4;
    const f = t - Math.floor(t); // 本季内进度 0..1
    const lerp = (a, b) => {
      const ca = this._hexToRgb(a), cb = this._hexToRgb(b);
      const r = Math.round(ca.r + (cb.r - ca.r) * f);
      const g = Math.round(ca.g + (cb.g - ca.g) * f);
      const bl = Math.round(ca.b + (cb.b - ca.b) * f);
      return `rgb(${r},${g},${bl})`;
    };
    return {
      soil: lerp(palette[i0].soil, palette[i1].soil),
      grass: lerp(palette[i0].grass, palette[i1].grass),
      bg: lerp(palette[i0].bg, palette[i1].bg),
      water: lerp(palette[i0].water, palette[i1].water),
    };
  },

  // 每格稳定随机种子 0..1：同一格每次计算都一样（不闪烁），不同格不同（斑驳自然）
  _cellSeed(r, c) {
    let h = (r * 374761393 + c * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  },

  // 裸土格按 cell 稳定随机选一种土图（与裸土判定用不同 seed 偏移，互不相关）
  _bareSoilKey(r, c) {
    const arr = this._bareSoilKeys;
    const i = Math.floor(this._cellSeed(r + 101, c + 257) * arr.length) % arr.length;
    return arr[i];
  },

  init() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // 事件绑定
    this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      if (this._hoverRaf) { cancelAnimationFrame(this._hoverRaf); this._hoverRaf = null; }
      this._hoverCell = null;
      this.render();
    });
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

    // 工具栏按钮只绑定点击；选中态由右侧「手中物品」框统一高亮显示，
    // 这里不再给任何工具按钮加 .active，避免与手持框形成第二个高亮框。
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => this._onToolClick(btn));
    });

    // 背包关闭：点击面板外区域 or 按 B / Esc
    document.getElementById('inventory-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeInventory();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.closeInventory(); this.closeShop(); this.closeSummary(); }
    });

    // 持续重绘循环：驱动未浇水作物的闪烁动画
    this._startAnimLoop();

    // 初始「手中物品」显示
    this._updateHeldSlot();

    // 商店（直接画在游戏画布上）状态初始化
    this._shopOpen = false;
    this._shopSel = null;
    this._shopLayout = null;
    this._shopHover = null;
    this._trades = [];
    this._dragKey = null;          // 当前从背包拖出（dragstart）的物品 key
    this._dragCount = 1;          // 当前拖出物品的堆叠数量（拖入输入框后输入栏按此显示）
    this._shopDroppedId = null;   // 已拖入输入框且匹配的交易 id（输出框显示产物的前提）
    this._shopDroppedCount = null;// 已放入输入框的物品数量（每次成交后递减，实时显示剩余）
    this._shopReservedKey = null; // 已被拖入输入框、需从背包扣除的物品 key（money / 作物 assetHarvest）
    this._shopDirty = false;   // 仅当交易状态变化时重建 DOM 图标，避免每帧抖动
  },

  _resize() {
    const container = document.getElementById('game-container');
    const hud = document.getElementById('hud-bar');
    const toolbar = document.getElementById('toolbar');
    const availH = window.innerHeight - hud.offsetHeight - toolbar.offsetHeight - 4;
    const availW = window.innerWidth;

    // 计算格子大小：让农场尽量填满
    const idealSizeByH = Math.floor(availH / DATA.FARM.ROWS);
    const idealSizeByW = Math.floor(availW / DATA.FARM.COLS);
    this.cellSize = Math.min(idealSizeByH, idealSizeByW, 64);
    this.cellSize = Math.max(this.cellSize, 32);

    this.canvas.width = DATA.FARM.COLS * this.cellSize;
    this.canvas.height = DATA.FARM.ROWS * this.cellSize;

    // ★ 强制 CSS 尺寸与 buffer 尺寸一致 — 准星不准的核心修复
    this.canvas.style.width = `${this.canvas.width}px`;
    this.canvas.style.height = `${this.canvas.height}px`;

    this.offsetX = Math.max(0, (availW - this.canvas.width) / 2);
    this.offsetY = Math.max(0, (availH - this.canvas.height) / 2);

    this.canvas.style.marginLeft = `${this.offsetX}px`;
    this.canvas.style.marginTop = `${this.offsetY}px`;

    // 画布位置变了，商店 DOM 叠层需重新对齐
    if (this._shopOpen) this._shopDirty = true;
  },

  /** 主渲染（B6 优化：静态农场层缓存到离屏画布，每帧只 blit + 重绘动态未浇水高亮） */
  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;

    // 确保静态层（背景 + 草地/耕地/作物 + 进度条 + 网格线）为最新；
    // 仅在「农场状态变化 / 跨天换季 / 画布尺寸变化」时重绘整张网格到离屏画布。
    this._ensureFarmCache();

    // 每帧只需将静态层一次性贴回主画布（开销极低）
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._farmCache, 0, 0);

    // 动态层：未浇水作物的呼吸高亮（逐帧动画，必须每帧重画）
    this._drawWaterOverlay(ctx, cs);

    // 动态层：耕地的呼吸描边——"玩家翻过的田"边界签名，与未浇水高亮同款呼吸节奏（方案：A3 + 同款闪烁）
    this._drawFarmlandOverlay(ctx, cs);

    // 商店：直接画在画布上，覆盖在农场之上（放大、物品贴图直接合成进 GUI）
    if (this._shopOpen) {
      this._drawShopOverlay();
      this._updateHUD();
      return;
    }

    // 鼠标悬停高亮
    if (this._hoverCell) {
      const { row: hr, col: hc } = this._hoverCell;
      if (hr >= 0 && hr < DATA.FARM.ROWS && hc >= 0 && hc < DATA.FARM.COLS) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(hc * cs, hr * cs, cs, cs);
        ctx.strokeStyle = 'rgba(255,255,100,0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(hc * cs + 1, hr * cs + 1, cs - 2, cs - 2);
      }
    }

    // HUD 更新
    this._updateHUD();
  },

  /** 标记农场静态层已过期，下次 render 时重建缓存 */
  markFarmDirty() { this._farmDirty = true; },

  /** 保证静态农场层离屏画布为最新；过期则重建 */
  _ensureFarmCache() {
    const sig = `${Engine.year}-${Engine.season}-${Engine.day}@${this.canvas.width}x${this.canvas.height}`;
    if (!this._farmCache || this._farmCacheKey !== sig || this._farmDirty) {
      this._rebuildFarmCache();
      this._farmCacheKey = sig;
      this._farmDirty = false;
    }
  },

  /** 重建静态农场层到离屏画布 */
  _rebuildFarmCache() {
    if (!this._farmCache) this._farmCache = document.createElement('canvas');
    const cv = this._farmCache;
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {
      cv.width = this.canvas.width;
      cv.height = this.canvas.height;
    }
    const sctx = cv.getContext('2d');
    sctx.clearRect(0, 0, cv.width, cv.height);
    this._renderStaticScene(sctx);
  },

  /** 动态层：未浇水作物的呼吸高亮（逐帧动画，开销极低——仅遍历有作物的格子） */
  _drawWaterOverlay(ctx, cs) {
    for (let r = 0; r < DATA.FARM.ROWS; r++) {
      for (let c = 0; c < DATA.FARM.COLS; c++) {
        const cell = Farm.grid[r][c];
        if (!cell || !cell.crop) continue;
        const isGrown = Farm._isGrown(cell);
        if (cell.watered || isGrown) continue; // 已浇水或成熟则无需提示
        const x = c * cs, y = r * cs;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);
        // 整格淡蓝呼吸高亮
        ctx.fillStyle = `rgba(90,180,250,${0.10 + 0.14 * pulse})`;
        ctx.fillRect(x, y, cs, cs);
        // 闪烁边框 + 右上角水桶角标
        ctx.save();
        ctx.strokeStyle = `rgba(95,195,255,${0.45 + 0.45 * pulse})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
        const iw = cs * 0.36;
        const ix = x + cs - iw - 2, iy = y + 2;
        ctx.globalAlpha = 0.75 + 0.25 * pulse;
        const drawn = ASSETS.draw(ctx, 'water_bucket', ix, iy, iw, iw);
        if (!drawn) {
          ctx.font = `${iw * 0.8}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('💧', ix + iw / 2, iy + iw / 2);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  },

  /** 动态层：耕地的呼吸描边——"玩家翻过的田"边界签名，每帧呼吸闪烁（方案：A3 + 跟需浇水同款呼吸动画） */
  _drawFarmlandOverlay(ctx, cs) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);
    for (let r = 0; r < DATA.FARM.ROWS; r++) {
      for (let c = 0; c < DATA.FARM.COLS; c++) {
        const cell = Farm.grid[r][c];
        // 仅空耕地(无作物)才呼吸描边；已播种格交给"需浇水"蓝边提示，避免双重描边
        if (!cell || !cell.tilled || cell.crop) continue;
        const x = c * cs, y = r * cs;
        ctx.save();
        // 空耕地描边改用绿色，随脉冲呼吸；线宽与基线对齐"需浇水"蓝边(lw3, 0.45+0.45*pulse)，仅色相区分
        ctx.strokeStyle = cell.watered
          ? `rgba(70,150,95,${0.30 + 0.35 * pulse})`    // 湿土：柔深绿（半透明质感）
          : `rgba(125,190,135,${0.30 + 0.35 * pulse})`; // 干土：柔草绿（半透明质感，降饱和不刺眼）
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);  // inset 对齐蓝边，几何上完全同粗同位
        // 右上角小麦种子角标（与需浇水的水桶角标同款：呼吸透明度）
        const iw = cs * 0.34;
        const ix = x + cs - iw - 2, iy = y + 2;
        ctx.globalAlpha = 0.75 + 0.25 * pulse;
        const drawn = ASSETS.draw(ctx, 'wheat_seeds', ix, iy, iw, iw);
        if (!drawn) {
          ctx.font = `${iw * 0.8}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🌾', ix + iw / 2, iy + iw / 2);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  },

  /** 把静态农场层（背景 + 草地/耕地/作物 + 进度条 + 网格线，不含未浇水呼吸高亮）画到给定 ctx */
  _renderStaticScene(ctx) {
    const cs = this.cellSize;
    const colors = this._seasonColorAt();

    // 背景
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 网格线颜色
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;

    for (let r = 0; r < DATA.FARM.ROWS; r++) {
      for (let c = 0; c < DATA.FARM.COLS; c++) {
        const x = c * cs, y = r * cs;
        const cell = Farm.grid[r][c];

        // 地板贴图
        const pad = 1;
        if (!cell) {
          // 泥土：玩家把草方块/裸土锄过一次后的中间态(dirt=true)，二次锄地才成耕地。画成裸土色（土图）以示「已松动待耕」。
          if (Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]) {
            ctx.fillStyle = colors.soil;
            ctx.fillRect(x, y, cs, cs);
            const soilKey = this._bareSoilKey(r, c);
            // 泥土/裸土是大尺寸写实贴图，开启平滑缩放避免最近邻下采样的像素变形（与草地一致）
            ASSETS.draw(ctx, soilKey, x + pad, y + pad, cs - pad * 2, cs - pad * 2, true)
              || (ctx.fillStyle = colors.soil, ctx.fillRect(x, y, cs, cs));
          }
          // 草方块地面：裸土(土色)只来自草方块上的草退化成无草——Farm.bare[r][c]===true（草1/2退化成0）才画裸土；
          // 其余草方块保持草方块底纹（含 short_grass 绿草 / short_dry_grass 黄草顶层）。从未长草的普通
          // 地面即使在秋冬也不随机变裸土，只有真正退化过的草方块才会转土色。
          else if (Farm.bare && Farm.bare[r] && Farm.bare[r][c]) {
            // 裸土：铺季节土色底 + 随格随机一种土图（占位用 farmland，待换 3 种新土）
            ctx.fillStyle = colors.soil;
            ctx.fillRect(x, y, cs, cs);
            const soilKey = this._bareSoilKey(r, c);
            // 泥土/裸土是大尺寸写实贴图，开启平滑缩放避免最近邻下采样的像素变形（与草地一致）
            ASSETS.draw(ctx, soilKey, x + pad, y + pad, cs - pad * 2, cs - pad * 2, true)
              || (ctx.fillStyle = colors.soil, ctx.fillRect(x, y, cs, cs));
          } else {
            // 草：草方块(grass_block)当连续暗色地基——整张缩放铺满格子、平滑，保留原有草纹（不切块）。
            // 全季节只保留此草方块底纹（绿草层、枯草层均已按用户要求移除）；同一纹理靠 season 色变绿→枯黄。
            // 草方块本低对比灰度图：先染暗草色作底，再用 overlay 把原灰度图叠回、拉开明暗对比，让方块纹路显出。
            // 草方块(grass_block)本是低对比灰度纹理图：先染成暗草色作底，再用 overlay 把原灰度图叠回去、
            // 拉开明暗对比，让方块纹路显出来（之前被整格薄涂冲平了）。
            const gblockGray = ASSETS.get('grass_block');
            const gblock = ASSETS.getTinted('grass_block', this._shade(colors.grass, -18));
            if (gblock) {
              ctx.imageSmoothingEnabled = true;
              ctx.drawImage(gblock, 0, 0, gblock.width, gblock.height, x, y, cs, cs);
              if (gblockGray) {
                ctx.globalCompositeOperation = 'overlay';
                ctx.globalAlpha = 0.85;
                ctx.drawImage(gblockGray, 0, 0, gblockGray.width, gblockGray.height, x, y, cs, cs);
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = 1;
              }
              // 草状态：Farm.grass[r][c] = 0 无草 / 1 绿草 / 2 黄草(枯死退化态)；仅本 else 分支(非裸土)绘制。
              const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
              if (gstate === 1 || gstate === 2) {
                // 草（短草）画在最上层：先画颜色的草方块 + 原图，再铺草丛。
                if (gstate === 1) {
                  // 绿草(1)：短白草 short_grass 用季节色淡亮染(偏离30，>草方块18)；getTinted 已用 destination-in 保透明。
                  const sg = ASSETS.getTinted('short_grass', this._shade(colors.grass, 30));
                  if (sg) {
                    ctx.globalAlpha = 1;
                    ctx.drawImage(sg, 0, 0, sg.width, sg.height, x, y, cs, cs);
                    ctx.globalAlpha = 1;
                  }
                } else {
                  // 黄草(2)：直接用桌面源素材 short_dry_grass（已上色棕黄、带透明背景），不另染色；平滑缩放与绿草一致。
                  // 素材缺失时兜底填枯黄(_dryGrassColor)，正常不会走到。
                  const dg = ASSETS.get('short_dry_grass');
                  if (dg) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.globalAlpha = 1;
                    ctx.drawImage(dg, 0, 0, dg.width, dg.height, x, y, cs, cs);
                    ctx.globalAlpha = 1;
                  } else {
                    ctx.fillStyle = this._dryGrassColor;
                    ctx.fillRect(x, y, cs, cs);
                  }
                }
              }
            } else {
              ctx.fillStyle = this._shade(colors.grass, -18);
              ctx.fillRect(x, y, cs, cs);
            }
            // 短绿草(short_grass)现作为薄层叠在草方块上：仅在草方块(非裸土)生长、用季节色染、半透明露底纹。
            // 黄草=草方块自身染枯黄，短绿草同套"绿变黄"规则，秋冬一起转黄。无独立枯草层。
            // （已移除春夏整格薄涂：那层 0.18 纯色填充会把草叶缝隙填成一片绿、显不出纹理）
          }
        } else {
          const tex = cell.watered ? 'farmland_moist' : 'farmland_dry';
          ASSETS.draw(ctx, tex, x + pad, y + pad, cs - pad*2, cs - pad*2)
            || (ctx.fillStyle = cell.watered ? colors.water : colors.soil, ctx.fillRect(x, y, cs, cs));
          // 耕地描边已移至动态层 _drawFarmlandOverlay（呼吸闪烁，与未浇水高亮同款），此处只画底纹。
        }

        // 画作物
        if (cell && cell.crop) {
          const def = DATA.CROPS[cell.crop];
          const isGrown = Farm._isGrown(cell);
          const totalDays = (cell.regrowCount > 0 && def.regrow) ? def.regrowDays : def.growDays;
          const progress = Math.min(cell.grownDays / totalDays, 1);
          const needsWater = !cell.watered && !isGrown;

          if (isGrown) {
            // 成熟：使用作物自身的最后一帧生长贴图（地里长出来的样子），
            // 不再读 assetHarvest —— assetHarvest 现在只管背包/商店图标。
            // 这样改背包图标就不会再误伤地里作物的外观（之前"地里也变成篮子"bug 的根因）。
            const assetKey = (def.assetStages && def.assetStages.length)
              ? def.assetStages[def.assetStages.length - 1]
              : def.assetHarvest;
            const padC = 4;
            ASSETS.draw(ctx, assetKey, x + padC, y + padC, cs - padC*2, cs - padC*2)
              || this._drawEmojiCrop(ctx, x, y, cs, def, true);
          } else if (def.assetStages && def.assetStages.length) {
            // 生长中：按 progress 选 assetStages 中的一张，随进度由小变大
            const stages = def.assetStages;
            const idx = Math.min(stages.length - 1, Math.floor(progress * stages.length));
            const assetKey = stages[idx];
            // 大小随 progress 从 0.35 涨到 0.85
            const sizeFrac = 0.35 + 0.5 * progress;
            const dw = cs * sizeFrac;
            const dh = cs * sizeFrac;
            const dx = x + (cs - dw) / 2;
            const dy = y + (cs - dh) / 2;
            ASSETS.draw(ctx, assetKey, dx, dy, dw, dh)
              || this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);
          } else {
            // 生长中 fallback：emoji 作物大小随进度从 0.25 涨到 0.75
            this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);
          }

          // 生长进度条
          if (!isGrown) {
            const barW = cs * 0.7;
            const barH = 4;
            const barX = x + (cs - barW) / 2;
            const barY = y + cs - barH - 4;
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillStyle = '#4ade80';
            ctx.fillRect(barX, barY, barW * progress, barH);
          }

          // 成熟标记：底部一根金色细线（不再画头顶小金币，保持画面干净）
          // （细线而不是整边框，避免整片农场看起来太刺眼）
          if (isGrown) {
            ctx.fillStyle = 'rgba(255,215,0,0.55)';
            ctx.fillRect(x + 2, y + cs - 3, cs - 4, 2);
          }

        }

        // 网格线
        ctx.strokeRect(x, y, cs, cs);
      }
    }
  },

  /** 持续重绘循环：驱动未浇水作物的闪烁动画（标签页隐藏时浏览器自动暂停） */
  _startAnimLoop() {
    if (this._animRaf) return; // 防止重复启动
    const loop = () => {
      this.render();
      this._animRaf = requestAnimationFrame(loop);
    };
    this._animRaf = requestAnimationFrame(loop);
  },

  /** 更新 HUD */
  _updateHUD() {
    document.getElementById('hud-datetime').textContent = Engine.getDateString() + ' ' + Engine.getTimeString();

    const shownStamina = Math.round(Player.stamina);
    const pct = (shownStamina / Player.maxStamina) * 100;
    document.getElementById('stamina-bar-fill').style.width = `${pct}%`;
    document.getElementById('stamina-bar-fill').style.background = pct < 30 ? '#e0524f' : ''; // B5：体力 <30% 变红
    document.getElementById('hud-stamina').textContent = `${shownStamina}/${Player.maxStamina}`;
    document.getElementById('hud-money').textContent = Player.money;
    document.getElementById('hud-inventory').textContent = Player.getInventoryCount();
    document.getElementById('hud-seeds').textContent = Player.getSeedCount();
  },

  /** 工具栏点击 */
  _onToolClick(btn) {
    const tool = btn.dataset.tool;
    if (!tool) return;
    if (this._busy) return; // 正在干活中，期间不能切换工具

    // 当前选中的工具由右侧「手中物品」框统一高亮显示，工具栏按钮本身不再加选中边框，
    // 避免同时出现两个高亮框（手持框 + 工具按钮框）。

    // 处理种子选择
    if (tool.startsWith('seed-')) {
      const seedId = tool.replace('seed-', '');
      Player.selectTool(`seed-${seedId}`);
      this.showStatus(`选择种子：${DATA.CROPS[seedId].name}`, 1000);
    } else {
      Player.selectTool(tool);
      const names = { hoe: '锄头 🔨', water: '水桶' };
      this.showStatus(`选择工具：${names[tool] || tool}`, 800);
    }
    this._updateHeldSlot();
  },

  /** 刷新底部「手中物品」显示（MC 风：显示当前选中的工具/种子） */
  _updateHeldSlot() {
    const iconEl = document.getElementById('held-icon');
    const nameEl = document.getElementById('held-name');
    if (!iconEl || !nameEl) return;
    const map = {
      hoe:         { key: 'wooden_hoe',     name: '锄头' },
      water:       { key: 'water_bucket',   name: '水桶' },
      'seed-wheat':{ key: 'wheat_seeds',    name: '小麦种子' },
    };
    let info = { key: '', name: '' };
    if (Player.selectedTool.startsWith('seed-')) {
      // 选中的是种子：有库存才显示种子名/贴图；种子种完了就留空（不显示任何文字）。
      // 注意：seed-wheat 虽在 map 里，也必须先走库存判断，否则耗尽后仍显示种子名。
      const sid = Player.selectedTool.slice(5);
      if (Player.hasSeed(sid)) {
        const def = DATA.CROPS[sid];
        if (def) info = { key: this._seedIconKey(sid), name: def.name };
      }
    } else if (map[Player.selectedTool]) {
      info = map[Player.selectedTool];
    }
    const src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[info.key]) || '';
    iconEl.innerHTML = src ? `<img class="tool-icon-img" src="${src}" alt="${info.name}">` : '';
    nameEl.textContent = info.name;
    // 仅在有装备时给格子加高亮（has-item）；空手时去掉高亮，留一个普通空格子
    const slotEl = document.getElementById('held-slot');
    if (slotEl) slotEl.classList.toggle('has-item', !!info.key);
  },

  /** 降级回退：用 emoji 渲染作物（贴图加载失败时用） */
  _drawEmojiCrop(ctx, x, y, cs, def, isGrown, progress = 1) {
    let icon;
    if (isGrown) {
      icon = def.harvestSprite;
    } else {
      // 三个生长阶段轮换：苗 → 叶 → 芽
      const stages = ['🌱', '🌿', '🌳'];
      const stageIdx = Math.min(2, Math.floor(progress * 3));
      icon = stages[stageIdx];
    }
    const scale = isGrown ? 0.6 : (0.25 + progress * 0.45); // 25% → 70%
    const size = cs * scale;
    ctx.font = `${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x + cs / 2, y + cs / 2);
  },

  _onMouseMove(e) {
    if (this._shopOpen) { this._onShopMove(e); return; }
    if (this._busy) return; // 正在干活中，悬停高亮冻结在当前地块，不跟随鼠标
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    let next;
    if (row >= 0 && row < DATA.FARM.ROWS && col >= 0 && col < DATA.FARM.COLS) {
      next = { row, col };
    } else {
      next = null;
    }
    // 只在悬停格子变化时重绘，避免乱晃/卡顿
    const cur = this._hoverCell;
    if ((cur === null) !== (next === null)
        || (cur && next && (cur.row !== next.row || cur.col !== next.col))) {
      this._hoverCell = next;
      if (!this._hoverRaf) {
        this._hoverRaf = requestAnimationFrame(() => {
          this._hoverRaf = null;
          this.render();
        });
      }
    }
  },

  /** 点击地图 */
  _onCanvasClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 商店打开时点击交给商店逻辑（含「点面板外关闭」）
    if (this._shopOpen) { this._onShopClick(x, y); return; }
    if (Engine.paused) return;
    if (this._busy) return; // 正在干活中，期间不能点地图

    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    if (!Farm._inBounds(row, col)) return;

    // 锁定悬停高亮到当前正在操作的格子（忙时高亮冻结在此处）
    this._hoverCell = { row, col };

    const tool = Player.selectedTool;

    // 根据工具类型处理，每类自己做体力检查 + 事务（成功才扣）
    switch (tool) {
      case 'hoe': {
        const cell = (Farm.grid[row] && Farm.grid[row][col]) || null;
        // 成熟的作物：锄头点击即可收割（无需单独的「收获」工具）
        if (cell && cell.crop && Farm._isGrown(cell)) {
          const cost = DATA.TOOL_COST.harvest;
          Player.spendStamina(cost); // B1：先扣后做（spendStamina 不拦截，体力耗尽仍能干）
          const res = Farm.harvest(row, col);
          if (res.ok) {
            Player.addToInventory(res.cropId, res.count);
            this.markFarmDirty();
            const def = DATA.CROPS[res.cropId];
            const extra = res.count > 1 ? ' (+额外掉落!)' : '';
            this._startBusy('收割', null, () => this.showStatus(`🔨 收获 ${def.name}×${res.count}${extra}`, 1500));
          } else {
            Player.refundStamina(cost); // B1：动作失败回滚，避免白扣体力
            this.showStatus(`❌ ${res.reason}`, 800);
          }
          break;
        }
        // 有草(绿/黄)的地面：必须先除掉草 → 变回普通草方块，之后才能锄地
        const gstate = (Farm.grass && Farm.grass[row]) ? (Farm.grass[row][col] || 0) : 0;
        if (gstate === 1 || gstate === 2) {
          const cost = DATA.TOOL_COST.hoe;
          Player.spendStamina(cost); // B1：先扣后做
          const res = Farm.clearGrass(row, col);
          if (res === 'ok') {
            this.markFarmDirty();
            const grassIcon = this._grassIconHTML(gstate);
            this._startBusy('除草', null, () => this.showStatus(grassIcon + ' 除掉了草，可以耕地了', 800));
          } else {
            Player.refundStamina(cost);
          }
          break;
        }
        // 已是泥土(dirt)的地面：再锄一次 → 耕地
        if (Farm.dirt && Farm.dirt[row] && Farm.dirt[row][col]) {
          const cost = DATA.TOOL_COST.hoe;
          Player.spendStamina(cost);
          const res = Farm.till(row, col);
          if (res === 'ok') {
            this.markFarmDirty();
            this._startBusy('耕地', null, () => this.showStatus('🔨 耕地完成', 600));
          } else {
            Player.refundStamina(cost);
            if (res === 'already_tilled') {
              if (cell && cell.crop) this.showStatus('🌱 作物还没成熟，再等等', 600);
              else this.showStatus('这块地已经耕过了', 500);
            }
          }
          break;
        }
        // 否则：普通草方块/裸土 → 先锄成泥土（不直接耕地）
        const cost = DATA.TOOL_COST.hoe;
        Player.spendStamina(cost);
        const res = Farm.toDirt(row, col);
        if (res === 'ok') {
          this.markFarmDirty();
          const dirtIcon = this._iconHTML('coarse_dirt', 'status-hoe', '泥土');
          this._startBusy('锄地', null, () => this.showStatus(dirtIcon + ' 锄成了泥土，再锄一次就能耕地', 800));
        } else {
          Player.refundStamina(cost);
          if (res === 'already_tilled') {
            if (cell && cell.crop) this.showStatus('🌱 作物还没成熟，再等等', 600);
            else this.showStatus('这块地已经耕过了', 500);
          }
        }
        break;
      }

      case 'water': {
        const cost = DATA.TOOL_COST.water;
        Player.spendStamina(cost); // B1：先扣后做
        const res = Farm.water(row, col);
        if (res === 'ok') {
          this.markFarmDirty();
          this._startBusy('浇水', null, () => this.showStatus('💧 浇水完成', 500));
        } else {
          Player.refundStamina(cost); // B1：失败回滚
          if (res === 'already_watered') {
            this.showStatus('已经浇过水了', 400);
          } else if (res === 'no_tilled') { // B3：空耕地也能浇，失败提示改口
            this.showStatus('这里还没有耕地', 500);
          }
        }
        break;
      }

      default: {
        // 种子播种：先检查种子，再「先扣后做 + 失败回滚」（B1）
        if (tool.startsWith('seed-')) {
          const seedId = tool.replace('seed-', '');
          const plantCost = DATA.TOOL_COST.plant || 3;

          if (!Player.hasSeed(seedId)) {
            this.showStatus(`❌ 种子包里没有 ${DATA.CROPS[seedId].name} 种子, 去商店买吧 (B)`, 1500);
            return;
          }
          Player.spendStamina(plantCost); // B1：先扣
          const res = Farm.plant(row, col, seedId);
          if (res === 'ok') {
            this.markFarmDirty();
            Player.useSeed(seedId); // 仅成功才消耗种子
            this._updateHeldSlot(); // 种子种完则手持框自动留空（不显示文字）
            const def = DATA.CROPS[seedId];
            // 按作物选对应种子贴图（不再统一用小麦种子）
            const seedIconKey = ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries' })[seedId] || 'wheat_seeds';
            const seedSrc = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[seedIconKey]) || '';
            const seedIcon = seedSrc ? `<img class="status-hoe" src="${seedSrc}" alt="种子">` : '🌱';
            this._startBusy('种植', seedIconKey, () => this.showStatus(`${seedIcon} 种下 ${def.name}`, 600));
          } else {
            Player.refundStamina(plantCost); // B1：失败回滚
            if (res === 'not_tilled') this.showStatus('需要先耕地！', 600);
            else if (res === 'already_planted') this.showStatus('已经种了东西了', 600);
            else this.showStatus('无法种植', 600);
          }
        }
        break;
      }
    }

    this.render();
  },

  /** 进入“正在 X 中”状态：体力越低耗时越长（效率越低），期间锁输入 */
  _startBusy(label, iconKey, onDone) {
    const BUSY_ICONS = {
      '耕地': 'wooden_hoe',
      '浇水': 'water_bucket',
      '收割': 'wooden_hoe',
      '种植': 'wheat_seeds',
    };
    const key = iconKey || BUSY_ICONS[label] || '';
    const iconSrc = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';
    document.getElementById('busy-icon').src = iconSrc;

    const r = Math.max(0, Math.min(1, Player.stamina / Player.maxStamina));
    const dur = Math.round(this.BUSY_BASE_MS * (1 + (1 - r) * this.BUSY_SLOW_K));
    this._busy = true;
    const ind = document.getElementById('busy-indicator');
    document.getElementById('busy-text').textContent = `正在${label}中…`;
    // 先显示指示器（元素可见时 reflow 才能捕获 0% 起始态，否则 transition 不触发、进度条不动）
    ind.classList.remove('busy-hidden');
    ind.classList.add('busy-visible');
    const fill = document.getElementById('busy-fill');
    // 重启进度条动画
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth; // 强制 reflow，让下次 width 变化重新触发 transition
    fill.style.transition = `width ${dur}ms linear`;
    fill.style.width = '100%';
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => {
      this._busy = false;
      ind.classList.remove('busy-visible');
      ind.classList.add('busy-hidden');
      if (onDone) onDone(); // 动作真正完成后才弹完成提示
    }, dur);
  },

  /** 显示状态消息 */
  showStatus(msg, duration = 1500) {
    // 把提示框里的 emoji 替换为真实贴图
    const iconMap = {
      '🔨': 'wooden_hoe',    // 锄头
      '⚡': 'command_block',  // 调试快进（Command_Block 贴图）
      '💧': 'water_bucket',   // 浇水
      '💰': 'money',          // 金币/出售
      '📦': 'bundle_filled',  // 背包
      '❌': 'cancel',             // 交易失败 / 错误：纯红叉（不用 crafting_arrow_error 的箭头+叉叉组合）
      '✅': 'confirm',             // 成功 / 确认
      '🌙': 'moon',           // 夜晚 / 睡觉
      '🌱': 'wheat_seeds',    // 幼苗（复用小麦种子贴图，无需新素材）
    };
    for (const [emoji, key] of Object.entries(iconMap)) {
      let src = '';
      if (emoji === '🌿' && typeof ASSETS !== 'undefined' && ASSETS.getTinted) {
        // 草图标按季节染色：与地图上绿草(short_grass 季节草色 +30 明度)保持一致
        const tinted = ASSETS.getTinted('short_grass', this._shade(this._seasonColorAt().grass, 30));
        if (tinted) {
          try { src = tinted.toDataURL(); } catch (e) { src = ''; }
        }
        if (!src) src = (ASSETS.registry && ASSETS.registry.short_grass) || '';
      } else {
        src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';
      }
      if (src) msg = msg.replaceAll(emoji, `<img class="status-hoe" src="${src}" alt="${key}">`);
    }
    const el = document.getElementById('status-message');
    el.innerHTML = msg;
    el.className = 'status-visible';
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      el.className = 'status-hidden';
    }, duration);
  },

  /**
   * 生成贴图 <img> 片段，供结算面板等非 showStatus 场景使用。
   * key 未注册（或不是可用贴图）时返回空串——调用方用 `|| '🌱'` 之类的 emoji 兜底即可。
   */
  _iconHTML(key, cls, alt) {
    const src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';
    return src ? `<img class="${cls}" src="${src}" alt="${alt}">` : '';
  },

  /**
   * 状态提示用的「草」图标：与被清除的草类型一致。
   * - 绿草(gstate===1)：季节草色 +30 明度染 short_grass（与地图绿草一致）
   * - 枯草(gstate===2)：直接用已上色 short_dry_grass（与地图黄草一致）
   * 返回可直接塞进 showStatus(msg) 的 <img> 片段；拿不到贴图时返回空串。
   */
  _grassIconHTML(gstate) {
    let src = '';
    if (gstate === 2) {
      src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.short_dry_grass) || '';
    } else {
      if (typeof ASSETS !== 'undefined' && ASSETS.getTinted) {
        const tinted = ASSETS.getTinted('short_grass', this._shade(this._seasonColorAt().grass, 30));
        if (tinted) { try { src = tinted.toDataURL(); } catch (e) { src = ''; } }
      }
      if (!src) src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.short_grass) || '';
    }
    return src ? `<img class="status-hoe" src="${src}" alt="草">` : '';
  },

  /** 打开背包（MC 物品栏 GUI：inventory.png 纹理背景） */
  openInventory() {
    if (this._inventoryOpen) return;
    this._inventoryOpen = true;
    Engine.pause();
    const panel = document.getElementById('inventory-panel');
    if (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.inventory) {
      panel.style.backgroundImage = `url(${ASSETS.registry.inventory})`;
    }
    this.renderInventory();
    document.getElementById('inventory-overlay').className = 'overlay-visible';
  },

  /** 关闭背包 */
  closeInventory() {
    if (!this._inventoryOpen) return;
    document.getElementById('inventory-overlay').className = 'overlay-hidden';
    this._inventoryOpen = false;
    Engine.resume();
    this.render();
  },

  /** 渲染背包（纯展示：金币 + 种子 + 收获物；交易统一在商店进行） */
  renderInventory() {
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

    // 堆叠辅助：每种物品每格最多 64 个（MC 标准堆叠），超出拆成多个格。
    const STACK = 64;
    const pushStacks = (iconKey, total, label, kind, seedId) => {
      let rem = total || 0;
      while (rem > 0) {
        const inSlot = Math.min(STACK, rem);
        slots.push(this._makeSlot({ iconKey, count: inSlot, label, kind, seedId }));
        rem -= inSlot;
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

    slots.slice(0, 27).forEach(s => main.appendChild(s));
    // 补齐空槽，保持 9×3 网格视觉完整
    for (let i = main.children.length; i < 27; i++) {
      main.appendChild(document.createElement('div'));
    }

    // 快捷栏：9 个空槽（仅装饰，保持纹理完整；不再含“全部出售”）
    const hotbar = document.getElementById('inv-grid-hotbar');
    hotbar.innerHTML = '';
    for (let i = 0; i < 9; i++) hotbar.appendChild(document.createElement('div'));
  },

  /** 构造一个物品格子（种子/工具可点击选择并装备；作物仅展示） */
  _makeSlot({ iconKey, count, label, kind, seedId, toolId }) {
    const slot = document.createElement('div');
    const slotCls = kind === 'seed' ? 'seed' : (kind === 'tool' ? 'tool' : 'crop');
    slot.className = 'inv-slot ' + slotCls;
    const src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[iconKey]) || '';
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
      ${src ? `<img src="${src}" alt="${label}">` : ''}
      ${showCount !== '' ? `<span class="inv-count">${showCount}</span>` : ''}
    `;
    // 点击种子/工具 → 装备（关闭背包、刷新手持槽、提示），随后即可去地里使用
    if (selectable) {
      slot.style.cursor = 'pointer';
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (kind === 'tool') {
          Player.selectTool(toolId);
          this._updateHeldSlot();
          this.closeInventory();
          this.showStatus(`选择工具：${label}`, 800);
        } else {
          Player.selectTool('seed-' + seedId);
          this._updateHeldSlot();
          this.closeInventory();
          this.showStatus(`选择种子：${label}`, 1000);
        }
      });
    }
    return slot;
  },

  /** 种子贴图 key 映射（统一用 MC 贴图，不再混用小图） */
  _seedIconKey(cropId) {
    return ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries' })[cropId] || 'wheat_seeds';
  },

  /** 打开商店（村民交易 GUI，直接画在游戏画布上，不用 DOM 弹窗） */
  openShop() {
    if (this._shopOpen) return;
    this._shopOpen = true;
    Engine.pause();
    if (this._inventoryOpen) this.closeInventory(); // 打开商店时收起背包
    this._trades = this._buildTrades();
    this._shopSel = this._trades.length ? this._trades[0].id : null;
    this._shopHover = null;
    this._shopDirty = true;
    this.render();
  },

  /** 关闭商店 */
  closeShop() {
    if (!this._shopOpen) return;
    this._shopOpen = false;
    this._shopLayout = null;
    this._shopDroppedId = null;
    this._shopReservedKey = null;
    this._shopDroppedCount = null;
    this._shopDirty = false;
    const si = document.getElementById('shop-icons');
    if (si) si.innerHTML = '';
    Engine.resume();
    this.render();
  },

  /** 构建交易选项（基于 DATA.SHOP_ITEMS：每种作物生成「买种子」+「卖作物」两项） */
  _buildTrades() {
    const trades = [];
    for (const item of DATA.SHOP_ITEMS) {
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
  },

  /** 执行选中交易（成交后从输入栏数量中扣除，实时显示剩余） */
  _executeTrade(t) {
    // 必须先已把正确原材料拖入输入框
    if (this._shopDroppedId !== t.id) { this.showStatus('请先把原材料拖入输入框', 1200); return; }
    const def = DATA.CROPS[t.cropId];
    // 买入按种子花费扣除，卖出按 1 个扣除（输入栏显示的就是可投入量）
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
        this._shopDroppedId = null;
        this._shopDroppedCount = null;
        this._shopReservedKey = null;
      }
    } else {
      this.showStatus(`❌ ${res ? res.reason : '交易失败'}`, 1200);
    }
    this._trades = this._buildTrades();
    if (!this._trades.find(x => x.id === this._shopSel)) this._shopSel = this._trades[0] && this._trades[0].id;
    this._updateHUD();
    this._shopDirty = true;
    this.render();
  },

  /** 画布渲染：村民交易 GUI —— 直接放大绘制 villager_gui 纹理，物品贴图合成进其真实槽位 */
  _drawShopOverlay() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

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

    // 坐标转换：纹理内容坐标 → 画布坐标
    const toC = (tx, ty) => ({ x: shopX + tx * S, y: shopY + ty * S });

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
      if (pre && pre.naturalWidth && pre.naturalHeight && Math.abs(pre.naturalWidth - pre.naturalHeight) > 1) {
        w = size * (pre.naturalWidth / pre.naturalHeight);
        h = size;
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
      wrap.style.left = Math.round(c.x - w / 2) + 'px';
      // top 下移 2px：避免 Math.round 向下取整时图标顶部被容器裁掉（尤其 小麦 等大图缩小时）
      wrap.style.top = (Math.round(c.y - h / 2) - 2) + 'px';
      wrap.style.width = Math.round(w) + 'px';
      wrap.style.height = Math.round(h) + 'px';
      const img = document.createElement('img');
      img.src = ASSETS.registry[key];
      img.alt = key;
      // 兜底：极端情况下（预加载尚未完成 / 该 key 未预加载）仍做一次校正。
      // 正常开店路径下 pre 已就绪，onload 算出的尺寸与上面一致，不会触发改写，无抖动。
      img.onload = () => {
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (nw && nh && Math.abs(nw - nh) > 1) {
          const w2 = size * (nw / nh);
          if (Math.abs(w2 - w) > 0.5) {
            wrap.style.width = Math.round(w2) + 'px';
            wrap.style.left = Math.round(c.x - w2 / 2) + 'px';
          }
        }
      };
      wrap.appendChild(img);
      // 数量角标：买→花费；卖→拥有数量 / 总价（无单位）
      if (count != null && count !== '') {
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

    // ===== 左：交易选项列表（纹理左框 x6-96 y34-156）=====
    const listX0 = 6, listY0 = 34, listX1 = 96, listY1 = 156;
    const n = Math.max(list.length, 1);
    const rowH = (listY1 - listY0) / n;
    list.forEach((t, i) => {
      const up = 9;                       // 整行（框+图标+命中区）整体向上移的纹理px（相对上一版下移5px）
      const ry = listY0 + rowH * i;
      const cyc = ry + rowH / 2 - up;     // 图标中心同上移，保持与框居中
      const selected = t.id === this._shopSel;
      const hover = this._shopHover === t.id;
      const def = DATA.CROPS[t.cropId];
      const have = Player.inventory[t.cropId] || 0;
      // 不可交易：卖行无库存，或买行金币不足 —— 用 Cancel 图标明确标识
      const disabled = t.kind === 'sell' ? have === 0 : Player.money < def.seedCost;
      const rx = shopX + listX0 * S, ryc = shopY + ry * S;
      const rw = (listX1 - listX0) * S, rh = rowH * S - 2 * S;
      const rowPixH = rowH * S;
      // 每行都用模板框填满整行，兼作行底与选择框：
      //   普通行 -> blank_row_frame（浅灰星露谷框）
      //   选中行 -> row_frame_sel（用户新增的深色高亮框），突出当前项
      // 整体微调：左移 1 / 上移 4，使边框与行对齐；宽度填满整行、右缩避开 x93 分隔线。
      const frameKey = selected ? 'row_frame_sel' : 'blank_row_frame';
      const frame = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get(frameKey) : null;
      if (frame) {
        ctx.imageSmoothingEnabled = false;
        const fx = rx + 1 * S;            // 左移 1 纹理px
        const fy = ryc - (4 + up) * S;    // 上移：原 4 + 整行再上移 up，框与图标居中对齐
        const fw = rw - 6 * S;            // 宽度填满整行，右缩避开 x93 分隔线
        const fh = rowPixH + (4 + up) * S;// 高度填满整行（补偿上移，底部贴合行底）
        ctx.drawImage(frame, 0, 0, frame.naturalWidth, frame.naturalHeight, fx, fy, fw, fh);
      }
      // 输入/输出槽保持原物品图标（输入槽不替换成叉叉）
      if (t.kind === 'buy') {
        createItem(t.input.key, 24, cyc, 14, def.seedCost);
        createItem(t.output.key, 54, cyc, 14, 1);         // 种子固定 1
      } else {
        // 卖行右侧输出槽始终显示「单价」（单颗作物的售价），不再随持有数量放大成总价。
        // 输入槽仍显示当前拥有数量，与买行（输入=花费、输出=1 颗种子）保持「左数量右单价」的对称布局。
        createItem(t.input.key, 24, cyc, 14, have > 0 ? have : 1);
        createItem(t.output.key, 54, cyc, 14, def.sellPrice);
      }
      // 左侧列表行不再叠加红叉（按用户要求移除选择框中间的叉叉）
      this._shopLayout.rows.push({ id: t.id, x: shopX + listX0 * S, y: shopY + ry * S - up * S, w: (listX1 - listX0) * S, h: rowH * S });
    });

    // ===== 中：正在交易（输入槽143,44 / 结果槽227,44，点击种子即交易，无按钮）=====
    const t = list.find(x => x.id === this._shopSel) || list[0];
    if (t) {
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
        const dz = document.createElement('div');
        dz.className = 'shop-dropzone';
        const dc = toC(144, 45);
        const ds = 26 * S;
        dz.style.left = Math.round(dc.x - ds / 2) + 'px';
        dz.style.top = Math.round(dc.y - ds / 2 - 2) + 'px';
        dz.style.width = ds + 'px';
        dz.style.height = ds + 'px';
        dz.addEventListener('dragover', (e) => e.preventDefault());
        dz.addEventListener('drop', (e) => {
          e.preventDefault();
          const key = this._dragKey;
          if (!key) return;
          const cur = this._trades.find(z => z.id === this._shopSel);
          if (!cur) return;
          // 匹配当前选中行的输入物品才生效（用户选择：匹配当前选中行）。
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
            this._shopReservedKey = cur.kind === 'buy'
              ? 'money'
              : DATA.CROPS[cur.cropId].assetHarvest;
            this._shopDirty = true;
            this.render();
          } else {
            // 拖入物品与当前选中行不匹配：清空已放入状态，输出框不再显示
            this._shopDroppedId = null;
            this._shopDroppedCount = null;
            this._shopReservedKey = null;
            this._shopDirty = true;
            this.render();
            this.showStatus('❌ 物品不匹配，请拖入正确原材料', 1200);
          }
        });
        shopIcons.appendChild(dz);
      }
      // 中间预览：只要尚未拖入对应物品（输入框为空）或不可交易，就覆盖红色的「叉叉+箭头」，
      // 提示此处需要放入原材料。拖入匹配物品后才显示输入/输出图标。
      {
        const mdef = DATA.CROPS[t.cropId];
        const mhave = Player.inventory[t.cropId] || 0;
        const mdisabled = t.kind === 'sell' ? mhave === 0 : Player.money < mdef.seedCost;
        if (!dropped || mdisabled) createItem('crafting_arrow_error', 198, 46, 14);
      }
      // 结果槽（小麦种子）可点击区域：纹理真实范围 x[200-240] y[32-58]
      this._shopLayout.resultSlot = { x: shopX + 200 * S, y: shopY + 32 * S, w: 40 * S, h: 26 * S };
    }

    // ===== 下：背包（9x4 网格，槽中心 115+18c, 91+18r）=====
    // 堆叠规则：每种物品每格最多 64 个（MC 标准堆叠），数量超过则拆成多个格子。
    // 例：金币 500 → 8 格（7×64 + 52）。金币此前只放图标无数量，现按余额堆叠并带数量角标。
    const STACK = 64;
    // 已被拖入输入框、需从背包「扣除」的物品（拖拽=移动而非复制）：
    // 背包按真实总数渲染时减去这份，使其从背包消失、只显示在输入框里。
    const reservedKey = this._shopReservedKey;
    const reserved = (reservedKey && this._shopDroppedId && this._shopDroppedCount > 0)
      ? this._shopDroppedCount : 0;
    const items = [];
    const pushStacks = (key, total) => {
      total = total || 0;
      if (key === reservedKey) total -= reserved; // 扣掉已拖入输入框的那一份
      total = Math.max(0, total);
      let rem = total;
      while (rem > 0) {
        const inSlot = Math.min(STACK, rem);
        items.push({ key, count: inSlot });
        rem -= inSlot;
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
  },

  /** 画布点击：商店交互 */
  _onShopClick(x, y) {
    const L = this._shopLayout;
    if (!L) { this.closeShop(); return; }
    // 点面板外 → 关闭
    if (x < L.outer.x || x > L.outer.x + L.outer.w || y < L.outer.y || y > L.outer.y + L.outer.h) {
      this.closeShop(); return;
    }
    // 点击结果槽（输出框）成交：必须先已把正确原材料拖入输入框
    if (L.resultSlot &&
        x >= L.resultSlot.x && x <= L.resultSlot.x + L.resultSlot.w &&
        y >= L.resultSlot.y && y <= L.resultSlot.y + L.resultSlot.h) {
      const t = this._trades.find(z => z.id === this._shopSel);
      if (t) {
        if (this._shopDroppedId !== t.id) {
          // B7 修复：手机端无拖拽 → 点结果槽时自动「放入」对应材料再成交，绕过拖拽
          const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
          if (isTouch) {
            const def = DATA.CROPS[t.cropId];
            if (t.kind === 'buy') {
              if (Player.money < def.seedCost) { this.showStatus('❌ 金锭不足', 1200); return; }
              this._shopDroppedId = t.id;
              this._shopDroppedCount = def.seedCost;   // 放入正好够买的金锭
              this._shopReservedKey = 'money';
            } else {
              const have = Player.inventory[t.cropId] || 0;
              if (have <= 0) { this.showStatus('❌ 背包里没有可卖的作物', 1200); return; }
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
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this._shopSel = r.id; this._shopDroppedId = null; this._shopDroppedCount = null; this._shopReservedKey = null; this._shopDirty = true; this.render(); return;
      }
    }
  },

  /** 键盘上下切换选中交易 */
  _changeShopSel(dir) {
    const list = this._trades;
    if (!list || !list.length) return;
    let idx = list.findIndex(t => t.id === this._shopSel);
    if (idx < 0) idx = 0;
    idx = (idx + dir + list.length) % list.length;
    this._shopSel = list[idx].id;
    this._shopDroppedId = null;
    this._shopDroppedCount = null;
    this._shopReservedKey = null;
    this._shopDirty = true;
    this.render();
  },

  /** 画布悬停：商店交易行高亮 */
  _onShopMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const L = this._shopLayout;
    let hover = null;
    if (L) {
      for (const r of L.rows) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { hover = r.id; break; }
      }
    }
    if (hover !== this._shopHover) { this._shopHover = hover; this.render(); }
  },

  /** 画一个 MC 风面板（深棕底 + 双层描边） */
  _panel(ctx, x, y, w, h) {
    ctx.fillStyle = '#3a2d1e';
    this._roundRect(ctx, x, y, w, h, 8); ctx.fill();
    ctx.lineWidth = Math.max(2, w * 0.004);
    ctx.strokeStyle = '#1c140d'; this._roundRect(ctx, x, y, w, h, 8); ctx.stroke();
    ctx.lineWidth = Math.max(1, w * 0.002);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 6); ctx.stroke();
  },

  /** 面板标题 */
  _shopTitle(ctx, text, x, y, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(h * 0.55)}px "Courier New", monospace`;
    ctx.fillText(text, x + w / 2, y + h / 2);
  },

  /** 画一个物品槽（深色槽底 + 贴图 + 右下角标签） */
  _drawSlot(ctx, x, y, s, key, label, ok) {
    ctx.fillStyle = ok ? '#1c140d' : '#241a10';
    this._roundRect(ctx, x, y, s, s, 5); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    this._roundRect(ctx, x, y, s, s, 5); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    this._roundRect(ctx, x + 2, y + 2, s - 4, s - 4, 4); ctx.stroke();
    if (key) this._drawSprite(ctx, key, x + s / 2, y + s / 2, s * 0.74);
    if (label) {
      ctx.fillStyle = '#e8dcc0';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.font = `${Math.round(s * 0.2)}px "Courier New", monospace`;
      ctx.fillText(label, x + s / 2, y + s - 2);
    }
  },

  /** 居中画一张 ASSETS 贴图 */
  _drawSprite(ctx, key, cx, cy, size) {
    if (!key) return;
    const src = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';
    if (!src) return;
    ASSETS.draw(ctx, key, cx - size / 2, cy - size / 2, size, size);
  },

  /** 圆角矩形 path */
  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /** 显示每日结算 — 纯展示浮层，不阻塞操作、时间继续走 */
  showFullSummary() {
    const overlay = document.getElementById('day-summary');
    const content = document.getElementById('summary-content');
    content.innerHTML = '';

    const dayStr = Engine.getDateString();

    let html = `<div class="summary-row" style="color:var(--accent);font-weight:bold;">${dayStr} · 结束</div>`;

    html += `<div class="summary-row"><span>体力</span><span>${Math.round(Player.stamina)} / ${Player.maxStamina}</span></div>`;

    const invCount = Player.getInventoryCount();
    const sellValue = Player.getInventorySellValue();
    if (invCount > 0) {
      html += `<div class="summary-row"><span>📦 待售</span><span>${invCount}件 (${sellValue})</span></div>`;
    }

    const tillCount = Farm.getTilledEmptyCount();
    const plantCount = Farm.grid.flat().filter(c => c && c.crop).length;
    html += `<div class="summary-row"><span>${this._iconHTML('wheat_seeds', 'icon-sm', '种子') || '🌱'} 已种</span><span>${plantCount}</span></div>`;
    html += `<div class="summary-row"><span>${this._iconHTML('farmland_dry', 'icon-sm', '空耕地') || '🟫'} 空耕地</span><span>${tillCount}</span></div>`;

    const harvestReady = Farm.getHarvestableCount();
    if (harvestReady > 0) {
      html += `<div class="summary-row" style="color:var(--accent);"><span>${this._iconHTML('star', 'icon-sm', '可收') || '✨'} 可收</span><span>${harvestReady}</span></div>`;
    }

    const moneySrc = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.money) || '';
    const moneyIcon = moneySrc ? `<img class="icon-sm" src="${moneySrc}" alt="金币">` : '💰';
    html += `<div class="summary-total"><span>${moneyIcon}</span><span>${Player.money}</span></div>`;

    content.innerHTML = html;

    // 标题用月亮贴图（🌙 → moon），关闭按钮仍用 Confirm 图标
    const confirmSrc = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.confirm) || '';
    const moonSrc = (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry.moon) || '';
    const header = document.getElementById('summary-header');
    if (header) header.innerHTML = moonSrc
      ? '<img class="icon-title" src="' + moonSrc + '" alt="月亮"> 一天结束'
      : '🌙 一天结束';

    // 日结推进（作物生长 / 重置浇水 / 恢复体力 / 进入下一天）已由引擎在
    // _endDay → nextDay 中自动完成，且时间已在新的一天继续流逝。
    // 此处结算面板仅为“纯展示浮层”：几秒后自动淡出，“继续/跳过”按钮仅用于提前收起。
    const nextBtn = document.getElementById('summary-next');
    nextBtn.innerHTML = confirmSrc ? `<img class="icon-sm" src="${confirmSrc}" alt="确认"> 关闭` : '关闭';
    nextBtn.onclick = () => this.closeSummary();

    if (this._summaryTimer) clearTimeout(this._summaryTimer);
    this._summaryTimer = setTimeout(() => this.closeSummary(), 4000);

    overlay.className = 'panel-visible';
  },

  closeSummary() {
    const overlay = document.getElementById('day-summary');
    if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }
    overlay.className = 'panel-hidden';
  },


};
