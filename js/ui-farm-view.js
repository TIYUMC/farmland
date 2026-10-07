/**
* ui-farm-view.js — 农场视图：作物/草/树/阴影/格子/树场/静态缓存 绘制
* 职责：农场与树场的静态场景与逐格绘制、草与树实体、阴影、树霜四件套、农场缓存重建与脏格重绘。
* 生效/影子：本文件 10 项为白名单影子（真身在 ui-cache.js / ui-scene.js，后加载覆盖生效），本件仅作字面量来源、勿改逻辑；其余为农场视图独占。
* 方法清单：
*   - _seasonGrass
*   - _bareSoilKey
*   - _drawGrassTopLayer  ← 影子，真身在 ui-scene.js（勿改）
*   - _drawGrassBaseLayer  ← 影子，真身在 ui-scene.js（勿改）
*   - _drawGrassGroundCell
*   - _drawBareSoil
*   - _drawCropCell
*   - _forEachFarmCell
*   - _renderTreeFarmScene
*   - _winterFrosted
*   - _updateTreeFrost
*   - _treeFrostAt
*   - _canopySprite
*   - _drawTreeEntity  ← 影子，真身在 ui-scene.js（勿改）
*   - _drawShadowEllipse  ← 影子，真身在 ui-scene.js（勿改）
*   - _drawWoodOrFill  ← 影子，真身在 ui-scene.js（勿改）
*   - _renderCell  ← 影子，真身在 ui-cache.js（勿改）
*   - _renderVegCell  ← 影子，真身在 ui-cache.js（勿改）
*   - _rebuildFarmCache  ← 影子，真身在 ui-cache.js（勿改）
*   - _buildVegCache  ← 影子，真身在 ui-cache.js（勿改）
*   - _ensureFarmCache  ← 影子，真身在 ui-cache.js（勿改）
*   - _rebuildGrassBase
*   - _renderSceneToCanvas
*   - _renderTransition
*   - _setTextCenter
*   - _drawCornerBadge
*   - _drawBreathingBorder
*   - _drawWaterOverlay
*   - _drawFarmlandOverlay
*   - _renderStaticScene
*   - _drawImageCell
*   - _fillCell
*   - _drawPaddedAsset
*   - markFarmDirty
*   - _invalidateCell
*/

Object.assign(UI, {
  _seasonGrass(delta) {

    return this._shade(this._seasonColorAt().grass, delta);

  },



  // 每格稳定随机种子 0..1：同一格每次计算都一样（不闪烁），不同格不同（斑驳自然）

  _bareSoilKey(r, c) {

    // 树场裸土只用「普通土」(coarse_dirt / dirt)，**不再**随机成 rooted_dirt。

    // 原因：树格与退化裸土都走裸土画法，若裸土也是缠根泥土，则每棵树脚下、每块退化地都是缠根泥土，

    // 满屏都像被锄过，玩家分不清哪些格是自己真锄出来的（用户「贴图怎么全是缠根泥土？」）。

    // 现在「缠根泥土」是锄头翻出来(rooted)的专属地表，唯一出处，一眼可辨。

    if (this.scene === 'treeFarm') {

      return this._cellSeed(r + 909, c + 131) < 0.6 ? 'coarse_dirt' : 'dirt';

    }

    const arr = this._bareSoilKeys;

    const i = Math.floor(this._cellSeed(r + 101, c + 257) * arr.length) % arr.length;

      return arr[i];

  },



  // 堆叠拆分：把总数按每格 STACK 个拆成数组（背包/商店共用的堆叠规则，MC 标准 64 一组）

  markFarmDirty() { this._farmDirty = true; this._needsRender = true; this._grassDataRev = (this._grassDataRev || 0) + 1; },

  /** 标记单个格子需要重绘（增量更新）。
   *  用于点击操作后只更新变化的格子，避免重建全部120格。 */
  _invalidateCell(row, col) {
    const key = row + "," + col;

    this._farmCacheDirty.add(key);
    // 树场：树冠高 cs*1.5，向上溢出约 1.5 格到上两行，需同步失效以上两行，
    // 否则旧草色/树会从树冠上方残留形成绿方块闪屏。
    if (this.scene === "treeFarm") {
      if (row > 0) {
        this._farmCacheDirty.add((row - 1) + "," + col);
      }
      if (row > 1) {
        this._farmCacheDirty.add((row - 2) + "," + col);
      }
    }
    // 任何格子操作都可能改变植被状态，无条件失效 vegCache
    this._vegCacheDirty.add(key);
    // 格子植被可能变化（除草/耕地/种树…）→ 合并草轮廓缓存失效，下帧重建
    this._grassDataRev = (this._grassDataRev || 0) + 1;
    // 同时失效 grassBaseCache：除草/种树等操作改变了地面状态，旧的草底缓存已过期
    this._grassBaseCache = null;
    // 注意：不设置 _farmDirty=true，避免每次点击都触发全量重建（导致闪烁）
    // _grassBaseCache 将在 _refreshDirtyCells 中增量更新
  },



  /** 主农场 ↔ 树场 场景切换：用滑场过渡（横向平移两屏），避免瞬切 */

  _ensureFarmCache() {
    const sig = `${this.scene}-${Engine.year}-${Engine.season}-${Engine.day}@${this.canvas.width}x${this.canvas.height}`;
    const hasFarmDirty = this._farmCacheDirty.size > 0;
    const hasVegDirty = this._vegCacheDirty.size > 0;

    // 全量重建条件：缓存不存在 / 季节日变化 / 全量标记 / 格数变化
    const needFullRebuild = !this._farmCache || this._farmCacheKey !== sig || this._farmDirty;

    if (needFullRebuild) {
      this._rebuildFarmCache();
      this._farmCacheDirty.clear();
      this._vegCacheDirty.clear();
    } else if (hasFarmDirty || hasVegDirty) {
      this._refreshDirtyCells();
    }

    this._farmCacheKey = sig;
    this._farmDirty = false;
  },

  /** 增量重绘被标记为脏的格子 */
  _renderCell(ctx, r, c, x, y, cs, colors) {
    const cell = (this.scene === 'treeFarm' && TreeFarm.grid[r] && TreeFarm.grid[r][c]) 
      || (Farm.grid[r] && Farm.grid[r][c]);
    const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
    const isDirt = !!(Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]);
    const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

    if (this.scene === 'treeFarm') {
      // 树场：只画草、缠根泥土，不画树（树由 _renderTreeFarmScene 最后统一画）
      const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);
      if (!hasTree) {
        if (TreeFarm.getRootedAt(r, c)) {
          // 锄头翻出的缠根泥土：先铺土色底 + 贴 rooted_dirt
          this._fillCell(ctx, x, y, cs, colors.soil);
          this._drawPaddedAsset(ctx, 'rooted_dirt', x, y, cs, 1, true)
            || this._fillCell(ctx, x, y, cs, colors.soil);
        } else {
          const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
          const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);
          // 无论裸土还是草都画（isBare=true 时会调用 _drawBareSoil）
          this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);
        }
        // 网格线
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cs, cs);
      }
      return;
    }
    
    // 主农场
    if (!cell) {
      if (Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]) {
        this._drawBareSoil(ctx, r, c, x, y, cs, colors);
      } else {
        const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
        const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);
        this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);
      }
    } else {
      const tex = cell.watered ? 'farmland_moist' : 'farmland_dry';
      this._drawPaddedAsset(ctx, tex, x, y, cs, 1)
        || this._fillCell(ctx, x, y, cs, cell.watered ? colors.water : colors.soil);
    }
    
    // 花朵（花格绘制统一走 _drawFlowerCell，含 flip，与静态/植被/描边三路径同朝向）
    const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
    if (flower > 0) this._drawFlowerCell(ctx, r, c, x, y, cs, flower);
    
    // 作物
    if (cell && cell.crop) {
      this._drawCropCell(ctx, x, y, cs, cell);
    }
    
    // 网格线
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cs, cs);
  },

  /** 渲染单个植被格到 vegCache */
  _renderVegCell(ctx, r, c, x, y, cs, colors) {
    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;
    
    if (this.scene === 'treeFarm') {
      const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);
      if (!hasTree) {
        const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
        const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);
        if (!isBare && (gstate === 1 || gstate === 2)) {
          this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);
        }
      }
      return;
    }
    
    const cell = Farm.grid[r] && Farm.grid[r][c];
    if (!cell) {
      const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
      const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);
      if (!isBare && (gstate === 1 || gstate === 2)) {
        this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);
      }
    } else if (cell.crop) {
      this._drawCropCell(ctx, x, y, cs, cell);
    }
    
    const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
    if (flower > 0) this._drawFlowerCell(ctx, r, c, x, y, cs, flower);
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

    this._rebuildGrassBase();   // 草格底随静态层一起重建（同失效触发：跨天换季/尺寸/农场变化），保证缓存与静态层像素一致

    this._buildVegCache();      // 草+花离屏缓存：与 _farmCache 同失效触发，render() 中于积雪层之后贴回（草花在雪之上）

    this._shakeSnowBaseCache = null;  // 地面状态变化→含雪底缓存失效，下次草颤懒重建时用新底

  },



  /** 预渲染草格「底」到离屏画布（dirt + grass_block + 灰度 overlay；裸土用 bareSoil），

   *  每抖动格每帧只 drawImage 贴回 + 实时画摆动草顶层，省去底土重画与 composite 切换。缓存与 _renderStaticScene 同步重建。 */

  _rebuildGrassBase() {

    const cs = this.cellSize;

    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;

    const colors = this._seasonColorAt();

    const cache = {};

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const gstate = (grassSrc.grass && grassSrc.grass[r]) ? (grassSrc.grass[r][c] || 0) : 0;

        const isBare = !!(grassSrc.bare && grassSrc.bare[r] && grassSrc.bare[r][c]);

        if (gstate === 0 && !isBare) { cache[r + ',' + c] = null; continue; }  // 非草非裸：不会草颤，无需缓存底

        const cv = document.createElement('canvas');

        cv.width = cs; cv.height = cs;

        const bctx = cv.getContext('2d');

        let top = false;

        if (isBare) {

          this._drawBareSoil(bctx, r, c, 0, 0, cs, colors);

        } else {

          const hasBlock = this._drawGrassBaseLayer(bctx, r, c, 0, 0, cs, colors);

          top = hasBlock && (gstate === 1 || gstate === 2);

        }

        cache[r + ',' + c] = { cv, top };

      }

    }

    this._grassBaseCache = cache;

  },



  /** 植被离屏缓存：仅画「草(底+静态顶层) + 花朵」，不画地面/作物/树。

   *  与 _farmCache 同失效触发重建；render() 中在积雪层之后贴回 → 草花显示在雪之上（雪只盖地面/作物/树，草花从雪里探出）。

   *  画法对齐 _renderStaticScene / _renderTreeFarmScene：草仅画在地面格(!cell)与树场非树格；花画在 flowers>0 的格。 */

  _buildVegCache() {

    if (!this._vegCache) this._vegCache = document.createElement('canvas');

    const cv = this._vegCache;

    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {

      cv.width = this.canvas.width; cv.height = this.canvas.height;

    }

    const ctx = cv.getContext('2d');

    ctx.clearRect(0, 0, cv.width, cv.height);

    const cs = this.cellSize;

    const colors = this._seasonColorAt();

    if (this.scene === 'treeFarm') {

      // 第一遍：非树格只画草叶（透明底，雪从草叶间露出；裸土/无草不画→雪正常盖住）；树格留空，由第二遍画树

      this._forEachFarmCell(cs, (r, c, x, y) => {

        const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);

        if (!hasTree) {

          const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

          const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);

          if (!isBare && (gstate === 1 || gstate === 2)) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);

        }

      });

      // 第二遍：树（从上往下画 r=0→ROWS-1）→ 树在雪之上，不被雪盖住

      // 关键：树冠向上溢出约 1.5 格。上下相邻时，下面树(r+1)的树冠会溢入上面树(r)的格内，

      // 盖住上面树的树干底部。先画上面树、后画下面树，让下面树溢出的树冠自然叠在上方树干之上，

      // 解决「上面的树干叠到下面的树叶上」。

      for (let r = 0; r < DATA.FARM.ROWS; r++) {

        for (let c = 0; c < DATA.FARM.COLS; c++) {

          const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

          if (t) this._drawTreeEntity(ctx, c * cs, r * cs, cs, t);

        }

      }

    } else {

      this._forEachFarmCell(cs, (r, c, x, y) => {

        const cell = Farm.grid[r][c];

        if (!cell) {                                                // 地面格：只画草叶（透明底），让雪从草叶间露出；裸土/无草格不画→雪正常盖住

          const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

          const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

          if (!isBare && (gstate === 1 || gstate === 2)) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, 0);

        } else if (cell.crop) {                                     // 作物格：作物画在雪之上（作物从雪里探出，不被雪盖住）

          this._drawCropCell(ctx, x, y, cs, cell);

        }

        const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;

        if (flower > 0) this._drawFlowerCell(ctx, r, c, x, y, cs, flower);

      });

    }

  },





  /** 把指定场景的静态层渲染到一张离屏画布（用于滑场过渡的目标屏） */

  _renderSceneToCanvas(scene) {

    const cv = document.createElement('canvas');

    cv.width = this.canvas.width; cv.height = this.canvas.height;

    const c = cv.getContext('2d');

    const prev = this.scene;

    this.scene = scene;

    this._renderStaticScene(c);

    this.scene = prev;

    return cv;

  },



  /** 滑场过渡：把源屏与目标屏横向拼接平移，像摄像机「平移过去」；结束落定后在目标箭头处迸发粒子 */

  _renderTransition(dt) {

    const tr = this._transition;

    tr.t += dt;

    const k = Math.min(1, tr.t / tr.dur);

    const e = Juice.ease.inOutCubic(k);                     // 平滑加减速，避免突兀

    const W = this.canvas.width, H = this.canvas.height;

    const off = e * W;

    const ctx = this.ctx;

    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#1d2a1d';

    ctx.fillRect(0, 0, W, H);

    if (tr.dir > 0) {                                       // 去树场（右侧）：源屏左滑、目标屏从右进

      ctx.drawImage(tr.src, -off, 0);

      ctx.drawImage(tr.dst, W - off, 0);

    } else {                                                // 回农场（左侧）：源屏右滑、目标屏从左进

      ctx.drawImage(tr.src, off, 0);

      ctx.drawImage(tr.dst, off - W, 0);

    }

    if (k >= 1) {                                           // 落定：切到目标场景，重建缓存，目标箭头处迸发粒子

      this.scene = tr.toScene;

      this._transition = null;

      this._grassShakes = [];                                // 切场时清空旧场草颤，避免残留到新场（坐标被套用到新场草地）

      this._fallingLeaves = [];                              // 切场时清空落叶，避免跨场景残留

      this.markFarmDirty();

      this._vegCache = null;                              // 切场：失效旧 vegCache，防止跨场景残留

      const cs = this.cellSize;
      const cx = this.scene === 'farm' ? cs : this.canvas.width - cs;   // 尘爆在新场景按钮那一侧的画布边缘（farm=左缘、treeFarm=右缘）一格内
      const cy = this.canvas.height / 2;

      this._updateNavBtn();

      if (this._particles) {

        // 用刚注册的粒子贴图（generic_0~7），不含 nether_star

        this._particles.spawn(cx, cy, {

          imgKeys: ['generic_0', 'generic_1', 'generic_2', 'generic_3', 'generic_4', 'generic_5', 'generic_6', 'generic_7'],

          imgSize: this.scene === 'treeFarm' ? 18 : 16,

          count: 24, speed: 130, gravity: 210, spread: Math.PI * 2, spawnRadius: 14,

        });

      }

    }

  },



  /** 动态层：未浇水作物的呼吸高亮（逐帧动画，开销极低——仅遍历有作物的格子） */

  // ─────────────────────────────────────────────

  // ③ 动态呼吸高亮层（逐帧动画）

  // ─────────────────────────────────────────────



  /** 右上角「贴图 + emoji 兜底」呼吸角标：需浇水 / 需播种提示共用，消除两处重复绘制 */

  /** 文字居中对齐设置（textAlign/textBaseline → center/middle），消除 _drawCornerBadge / 作物图标 / 导航箭头 三处重复 */

  _setTextCenter(ctx) {

    ctx.textAlign = 'center';

    ctx.textBaseline = 'middle';

  },



  _drawCornerBadge(ctx, key, emoji, ix, iy, iw, pulse) {

    ctx.globalAlpha = 0.75 + 0.25 * pulse;

    const drawn = ASSETS.draw(ctx, key, ix, iy, iw, iw);

    if (!drawn) {

      ctx.font = `${iw * 0.8}px "VT323", monospace`;

      this._setTextCenter(ctx);

      ctx.fillText(emoji, ix + iw / 2, iy + iw / 2);

    }

    ctx.globalAlpha = 1;

  },



  /** 呼吸描边 + 右上角角标：需浇水蓝边与空耕地绿边共用同一套几何（inset 描边 lw3 + 右上角呼吸角标）。

   *  strokeRGB 为描边 rgba 字符串（调用方按状态/季节算好）；iw 角标边长；badgeKey/emoji 为右上角角标。 */

  _drawBreathingBorder(ctx, x, y, cs, strokeRGB, iw, pulse, badgeKey, badgeEmoji) {

    ctx.save();

    ctx.strokeStyle = strokeRGB;

    ctx.lineWidth = 3;

    ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4); // inset 对齐，几何上完全同粗同位

    const ix = x + cs - iw - 2, iy = y + 2;

    this._drawCornerBadge(ctx, badgeKey, badgeEmoji, ix, iy, iw, pulse);

    ctx.restore();

  },



  _drawWaterOverlay(ctx, cs) {

    this._forEachFarmCell(cs, (r, c, x, y) => {

      const cell = Farm.grid[r][c];

      if (!cell || !cell.crop) return;

      const isGrown = Farm._isGrown(cell);

      if (cell.watered || isGrown) return; // 已浇水或成熟则无需提示

      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 800);

      // 整格淡蓝呼吸高亮
      this._fillCell(ctx, x, y, cs, `rgba(90,180,250,${0.06 + 0.06 * pulse})`);

      // 呼吸边框 + 右上角水桶角标
      this._drawBreathingBorder(ctx, x, y, cs, `rgba(95,195,255,${0.25 + 0.15 * pulse})`, cs * 0.36, pulse, 'water_bucket', '💧');

    });

  },



  _drawFarmlandOverlay(ctx, cs) {

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 800);

    this._forEachFarmCell(cs, (r, c, x, y) => {

      const cell = Farm.grid[r][c];

      // 仅空耕地(无作物)才呼吸描边；已播种格交给"需浇水"蓝边提示，避免双重描边

      if (!cell || !cell.tilled || cell.crop) return;

      // 空耕地描边改用绿色，随脉冲呼吸（降低变化幅度，避免闪烁）

      const strokeRGB = cell.watered
        ? `rgba(70,150,95,${0.15 + 0.15 * pulse})`    // 湿土：柔深绿
        : `rgba(125,190,135,${0.15 + 0.15 * pulse})`; // 干土：柔草绿

      this._drawBreathingBorder(ctx, x, y, cs, strokeRGB, cs * 0.34, pulse, 'wheat_seeds', '🌾');

    });

  },



  /** 把静态农场层（背景 + 草地/耕地/作物 + 进度条 + 网格线，不含未浇水呼吸高亮）画到给定 ctx */

  // ─────────────────────────────────────────────

  // ④ 静态农场层绘制（背景/草/耕地/作物/网格）

  // ─────────────────────────────────────────────

  _renderStaticScene(ctx) {

    const cs = this.cellSize;

    const colors = this._seasonColorAt();



    // 背景

    ctx.fillStyle = colors.bg;

    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);



    // 网格线颜色

    ctx.strokeStyle = 'rgba(0,0,0,0.1)';

    ctx.lineWidth = 1;



    // 树场场景：整张静态层交给树场渲染（森林地表 + 大树），不再画主农场的草/耕地/作物。

    if (this.scene === 'treeFarm') { this._renderTreeFarmScene(ctx, cs); return; }



    this._forEachFarmCell(cs, (r, c, x, y) => {

        const cell = Farm.grid[r][c];



        // 地板贴图

        const pad = 1;

        if (!cell) {

          // 泥土：把【普通草方块】锄过一次后的中间态(dirt=true)，再锄一次才成耕地。画成土色（土图）表示「已松动待耕」。

          // （自然退化的裸土 bare=true 已改为锄一次直接成耕地，不再经过本中间态。）

          if (Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]) {

            this._drawBareSoil(ctx, r, c, x, y, cs, colors);

          }

        // 草方块地面：裸土(土色)只来自草方块上的草退化成无草——Farm.bare[r][c]===true（草1/2退化成0）才画裸土；

        // 其余草方块保持草方块底纹（含 short_grass 绿草 / short_dry_grass 黄草顶层）。从未长草的普通

        // 地面即使在秋冬也不随机变裸土，只有真正退化过的草方块才会转土色。

        else {

          // 草地（含裸土）统一走共享画法，与树场完全一致

          const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

          const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

          this._drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors);

        }

      } else {

        const tex = cell.watered ? 'farmland_moist' : 'farmland_dry';

        this._drawPaddedAsset(ctx, tex, x, y, cs, pad)

          || this._fillCell(ctx, x, y, cs, cell.watered ? colors.water : colors.soil);

        // 耕地描边已移至动态层 _drawFarmlandOverlay（呼吸闪烁，与未浇水高亮同款），此处只画底纹。

      }



      // 画花朵：flowers 数组与 dirt/grass 同维；花朵格 = flowers[r][c] > 0（草=0，视觉替换草方块）

      // 数据驱动：flowers[r][c] 的值即花种编号(1..N)，贴图键查 DATA.FLOWERS（加花种不用改本处）
      // 花格绘制统一走 _drawFlowerCell（含 flip，与静态/植被/描边三路径同朝向）

      const flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;

      if (flower > 0) this._drawFlowerCell(ctx, r, c, x, y, cs, flower);



      // 画作物（抽到 _drawCropCell，与 _drawGrassGroundCell 同款「一格一画法」）

      if (cell && cell.crop) {

        this._drawCropCell(ctx, x, y, cs, cell);

      }



        // 网格线

        ctx.strokeRect(x, y, cs, cs);

    });

  },



  /** 共享：画一格「草地地面」——草方块底 + 绿草/枯草丛，或退化裸土。农场与树场共用此画法，视觉完全一致。

   *  gstate: 0 无草 / 1 绿草 / 2 黄草；isBare=true 表示退化成裸土。 */

  /** 草格「底」：土色 + 草方块染色 + 灰度 overlay（overlay 混合）。不含会逐帧摆动的草顶层。

   *  预渲染进离屏画布后每帧只贴回（_drawGrassShakes），与实时重画像素级等价——离屏内合成结果 == 实时同像素合成。

   *  返回 gblock 是否存在（决定草顶层是否绘制，复刻原 _drawGrassGroundCell 仅在 gblock 存在时才画顶层）。 */

  _drawGrassBaseLayer(ctx, r, c, x, y, cs, colors) {

    colors = colors || this._seasonColorAt();

    const gblockGray = ASSETS.get('grass_block');

    const gblock = ASSETS.getTinted('grass_block', this._shade(colors.grass, -18));

    if (gblock) {

      ctx.imageSmoothingEnabled = true;

      this._drawImageCell(ctx, gblock, x, y, cs);

      if (gblockGray) {

        ctx.globalCompositeOperation = 'overlay';

        ctx.globalAlpha = 0.85;

        this._drawImageCell(ctx, gblockGray, x, y, cs);

        ctx.globalCompositeOperation = 'source-over';

        ctx.globalAlpha = 1;

      }

    } else {

      this._fillCell(ctx, x, y, cs, this._shade(colors.grass, -18));

    }

    return !!gblock;

  },



  /** 草格「顶层」：会逐帧绕格底中心摆动的 short_grass / short_dry_grass（仅 gstate 1/2 有）。逐帧实时画，不可缓存。 */

  _drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, sway, snowTruncate = true) {

    if (gstate !== 1 && gstate !== 2) return;

    const C = DATA.FARM.COLS, i = r * C + c;

    // 雪埋草：草基部截断面积 = 雪占格面积 × 50%（连续公式，替代旧二值 0.25）；满格雪=截半格。截断的是草叶基部（被雪盖住那段）。

    // 仅「雪上植被层(_vegCache) / 草颤层」需要此截断（让雪埋住草基）；静态层(_farmCache)是雪融化后露出的底，

    // 绝不截断，否则雪化后草永久短一截（静态层只在换季/农场变化/尺寸时重建，不在雪融化时重建）。

    const cellLeft = c * cs, cellTop = r * cs;

    // 取该格雪片像素尺寸 ps（无雪=0）；量化面积比替代旧「有无雪二值」。
    let ps = 0;

    if (snowTruncate && this._snowGround) {
      const sf = this._snowGround.find(f => f.c === c && f.r === r);
      if (sf) ps = sf.pixelStep != null ? sf.pixelStep : 1;
    }

    // 量化：缓存 key 专用、公式取整同用（防 veg/描边两层不一致）；48px→8px 一档（0~6 桶），
    // 雪长大期间每格最多 6 次重烘（veg 层 + 描边 A），不是每 tick 一次。
    const qstep = Math.max(1, cs / 6);
    const szQ = Math.min(ps, cs) > 0 ? Math.ceil(Math.min(ps, cs) / qstep) * qstep : 0;
    const trunc = 0.5 * (szQ / cs) * (szQ / cs);   // 满格雪(48)→0.5；ps=24→0.125；ps=1→≈0.0278

    const s = sway || 0;

    ctx.save();

    if (trunc > 0) {                                              // 只画草叶顶部 (1-trunc)，基部被雪埋住

      ctx.beginPath();

      ctx.rect(x, y, cs, cs * (1 - trunc));

      ctx.clip();

    }

    if (s) {

      const cx = x + cs / 2, cyBottom = y + cs;

      ctx.translate(cx, cyBottom);

      ctx.rotate(s);

      ctx.translate(-cx, -cyBottom);

    }

    if (gstate === 1) {

      const sg = ASSETS.getTinted('short_grass', this._shade(colors.grass, 30));

      if (sg) { ctx.globalAlpha = 1; this._drawImageCell(ctx, sg, x, y, cs); ctx.globalAlpha = 1; }

    } else {

      const dg = ASSETS.get('short_dry_grass');

      if (dg) {

        ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;

        this._drawImageCell(ctx, dg, x, y, cs); ctx.globalAlpha = 1;

      } else { this._fillCell(ctx, x, y, cs, this._dryGrassColor); }

    }

    ctx.restore();

  },



  _drawGrassGroundCell(ctx, r, c, x, y, cs, gstate, isBare, colors, swayAngle) {

    colors = colors || this._seasonColorAt();

    const sway = swayAngle || 0;

    if (isBare) { this._drawBareSoil(ctx, r, c, x, y, cs, colors); return; }

    const hasBlock = this._drawGrassBaseLayer(ctx, r, c, x, y, cs, colors);

    if (hasBlock) this._drawGrassTopLayer(ctx, r, c, x, y, cs, gstate, colors, sway, false);  // 静态层：雪化后露出的底，不截断

  },



  /** 画一格「裸土/松动土」：先铺土色底，再叠随格随机的裸土贴图（dirt/coarse_dirt/rooted_dirt），

   *  贴图缺失回退土色。农场泥土中间态(dirt)与退化裸土(bare)共用此画法，逻辑完全一致。 */

  _drawBareSoil(ctx, r, c, x, y, cs, colors) {

    const pad = 1;

    this._fillCell(ctx, x, y, cs, colors.soil);

    const key = this._bareSoilKey(r, c);

    this._drawPaddedAsset(ctx, key, x, y, cs, pad, true)

      || this._fillCell(ctx, x, y, cs, colors.soil);

  },



  /** 共享：把一张图整幅铺满一个 cs×cs 的格子（源取全图，目标为整格）。草方块染色底 / 灰度 overlay /

   *  绿草顶层 / 枯草顶层共 4 处收口。只封装 drawImage 本身，各调用点的 smoothing / alpha /

   *  compositeOperation 等状态设置仍保留在原处（各处差异很大，刻意不并入）。 */

  _drawImageCell(ctx, img, x, y, cs) {

    ctx.drawImage(img, 0, 0, img.width, img.height, x, y, cs, cs);

  },



  /** 共享：用纯色铺满一个 cs×cs 的格子（设 fillStyle + fillRect 整格）。呼吸高亮 / 耕地底纹兜底 /

   *  枯草兜底 / 草方块暗底 / 裸土土色底与兜底共 6 处收口。与原内联一致，调用后 ctx.fillStyle 保留为 color。 */

  _fillCell(ctx, x, y, cs, color) {

    ctx.fillStyle = color;

    ctx.fillRect(x, y, cs, cs);

  },



  /** 共享：把贴图按统一内边距 pad 画进一个 cs×cs 的格子（四边各留 pad），返回 ASSETS.draw 的成功布尔，

   *  调用点用 `|| fallback` 接各自兜底画法。耕地底纹 / 裸土 / 成熟作物三处画法在此统一收口。 */

  _drawPaddedAsset(ctx, key, x, y, cs, pad, smooth) {

    return ASSETS.draw(ctx, key, x + pad, y + pad, cs - pad * 2, cs - pad * 2, smooth);

  },



  /** 画木质贴图(树干/缠根泥土)：成功则贴图，失败用棕色(#6b4a2b)填充同一矩形——木元素兜底画法统一收口。 */

  _drawWoodOrFill(ctx, key, x, y, w, h, smooth) {

    if (ASSETS.draw(ctx, key, x, y, w, h, smooth)) return true;

    ctx.fillStyle = '#6b4a2b';

    ctx.fillRect(x, y, w, h);

    return false;

  },



  /** 画半透明黑色阴影椭圆（树荫/树冠体积暗部共用），alpha 控制深浅。 */

  _drawShadowEllipse(ctx, cx, cy, rx, ry, alpha) {

    ctx.save();

    ctx.fillStyle = `rgba(0,0,0,${alpha})`;

    ctx.beginPath();

    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

    ctx.fill();

    ctx.restore();

  },



  /** 画一格已耕地里长着的作物：成熟用最后一帧生长贴图，生长中按进度选 assetStages 帧并缩放；

   *  贴图缺失回退 emoji。附带生长进度条（未成熟）与成熟金色底线标记。由 _renderStaticScene 调用。 */

  _drawCropCell(ctx, x, y, cs, cell) {

    const def = DATA.CROPS[cell.crop];

    const isGrown = Farm._isGrown(cell);

    const totalDays = (cell.regrowCount > 0 && def.regrow) ? def.regrowDays : def.growDays;

    const progress = Math.min(cell.grownDays / totalDays, 1);

    if (isGrown) {

      // 成熟：用作物自身最后一帧生长贴图（地里长出来的样子），不读 assetHarvest（只管背包/商店图标）

      const assetKey = (def.assetStages && def.assetStages.length)

        ? def.assetStages[def.assetStages.length - 1]

        : def.assetHarvest;

      const padC = 4;

      this._drawPaddedAsset(ctx, assetKey, x, y, cs, padC)

        || this._drawEmojiCrop(ctx, x, y, cs, def, true);

    } else if (def.assetStages && def.assetStages.length) {

      // 生长中：按 progress 选 assetStages 中的一张，随进度由小变大（0.35→0.85）

      const stages = def.assetStages;

      const idx = Math.min(stages.length - 1, Math.floor(progress * stages.length));

      const assetKey = stages[idx];

      const sizeFrac = 0.35 + 0.5 * progress;

      const dw = cs * sizeFrac, dh = cs * sizeFrac;

      const dx = x + (cs - dw) / 2, dy = y + (cs - dh) / 2;

      ASSETS.draw(ctx, assetKey, dx, dy, dw, dh)

        || this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);

    } else {

      this._drawEmojiCrop(ctx, x, y, cs, def, false, progress);

    }

    // 生长进度条（未成熟才画）

    if (!isGrown) {

      const barW = cs * 0.7, barH = 4;

      const barX = x + (cs - barW) / 2, barY = y + cs - barH - 4;

      ctx.fillStyle = 'rgba(0,0,0,0.3)';

      ctx.fillRect(barX, barY, barW, barH);

      ctx.fillStyle = '#4ade80';

      ctx.fillRect(barX, barY, barW * progress, barH);

    }

    // 成熟标记：底部一根金色细线，不画头顶小金币，保持画面干净

    if (isGrown) {

      ctx.fillStyle = 'rgba(255,215,0,0.55)';

      ctx.fillRect(x + 2, y + cs - 3, cs - 4, 2);

    }

  },



  /** 遍历农场网格：对每格回调 (r, c, x, y)，x/y 为该格左上角像素坐标（农场主场景与树场静态层共用同一双重 for + 坐标计算骨架，消除重复） */

  _forEachFarmCell(cs, cb) {

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const x = c * cs, y = r * cs;

        cb(r, c, x, y);

      }

    }

  },



  /** 树场场景的静态层：草地地面（复用农场 _drawGrassGroundCell，草态由 TreeFarm.grass/bare 驱动，草量减半）+ 资源树。 */



  _renderTreeFarmScene(ctx, cs) {

    // 树场地面复用农场同一套草地画法；草态由 TreeFarm.grass/bare 驱动（与农场同逻辑、草量减半）。

    const colors = this._seasonColorAt();

    this._forEachFarmCell(cs, (r, c, x, y) => {

        const gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

        const isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);

        const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);  // 有树/树苗的格不画草，露出裸土

        this._drawGrassGroundCell(ctx, r, c, x, y, cs, hasTree ? 0 : gstate, isBare || hasTree, colors);

        ctx.strokeStyle = 'rgba(0,0,0,0.10)';

        ctx.lineWidth = 1;

        ctx.strokeRect(x, y, cs, cs);

        // 被锄头翻过的格：地表明为「缠根泥土」(rooted_dirt)（树场根系太密，耕不成耕地），盖在草地之上。

        // 必须与裸土同款画法（先铺土色底 + pad=1 内边距），否则锄完贴图会从 cs-2 突然涨到 cs，

        // 看着像「泥土被锄了之后贴图变大了」（用户反馈）。

        if (TreeFarm.getRootedAt(r, c)) {

          this._fillCell(ctx, x, y, cs, colors.soil);

          this._drawPaddedAsset(ctx, 'rooted_dirt', x, y, cs, 1, true)

            || this._fillCell(ctx, x, y, cs, colors.soil);

        }

    });

    // 第二遍：地面落叶堆按「每格0~4份」grid 绘制；秋季生成、冬季逐日消失（故两季都渲染）

    if (this._isAutumn() || Engine.season === 3) {

      const grid = this._litterGrid;

      if (grid) {

        for (let r = 0; r < DATA.FARM.ROWS; r++) {

          for (let c = 0; c < DATA.FARM.COLS; c++) {

            const n = grid[r][c];

            if (n > 0) this._drawLitterCell(ctx, c * cs, r * cs, cs, n);

          }

        }

      }

    }

    // 第三遍：所有树的「地面树荫椭圆」单独一遍、统一先画在地面层。

    // 必须先于任何树冠：树冠向上溢出约 0.82 格，会盖进上一行的格子；若树荫仍留在 _drawTreeEntity 里，

    // 上一行的树（后画）就会把自己的地荫糊到下一行树的树冠上——就是用户看到的「阴影透到叶子上面」。

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

        if (t && t.stage === 'grown') {

          this._drawShadowEllipse(ctx, c * cs + cs / 2, r * cs + cs * 0.72, cs * 0.52, cs * 0.26, 0.16);

        }

      }

    }

    // 第四遍画树：从上往下画（r=0→ROWS-1）。树冠向上溢出约 1.5 格，下面树的树冠会溢入上面树格内，

    // 先画上面树、后画下面树，使下面溢出的树冠正确盖住上面树的树干（避免「上树树干叠下树树叶」）。

    for (let r = 0; r < DATA.FARM.ROWS; r++) {

      for (let c = 0; c < DATA.FARM.COLS; c++) {

        const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;

        if (t) this._drawTreeEntity(ctx, c * cs, r * cs, cs, t);

      }

    }

  },



  /** 冬季树叶偏白：把指定贴图（叶子/树苗）复制进离屏画布，用 source-atop 叠一层半透明霜白，

   *  使非透明像素（叶/苗）染白、透明空隙保持透明——得到「偏白霜叶」。按资源 key 缓存复用。 */

  _winterFrosted(key) {

    if (!this._winterFrost) this._winterFrost = {};

    if (key in this._winterFrost) return this._winterFrost[key];

    const img = ASSETS.get(key);

    if (!img || !img.width) return null;            // 尚未加载：不缓存，下一帧重试

    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;

    const cv = document.createElement('canvas');

    cv.width = w; cv.height = h;

    const cx = cv.getContext('2d');

    cx.imageSmoothingEnabled = false;

    cx.drawImage(img, 0, 0);

    cx.globalCompositeOperation = 'source-atop';

    cx.fillStyle = 'rgba(233,240,248,0.40)';        // 霜白：40% 不透明冷白叠底（淡霜感，太白则下调）

    cx.fillRect(0, 0, w, h);

    cx.globalCompositeOperation = 'source-over';

    this._winterFrost[key] = cv;

    return cv;

  },



  /** 冬季「下雪过程中」推进树叶白化：一场雪只有「FROST_BUDGET_PER_SNOW 个 1/8 档」的共享额度，

   *  随机分配给树场里还没满的树 —— 是零和的：一棵树多吃，别的树就少吃；若某棵树吃满 8 档，

   *  本场雪额度耗尽，其余树这场合就没机会了（用户原话：「如果一棵树生满，那其他树的机会就没了」）。

   *   - 只「树场 + 冬季 + 正在下雪(isRaining，冬天的雨即雪)」时发放；雪停则冻结（已白的保留）。

   *   - 每场雪开始重置额度（已白的树保留，新额度重新随机发）；离开冬季 → 整片清空（融雪回正常叶色）。

   *   - 不是「每棵树各自独立 0→8」，而是全场共享 N 档、随机撒到随机的树上。

   *  性能：树冠在静态缓存层，只在白化跨过 1/8 档位时才 markFarmDirty 重绘。 */

  _updateTreeFrost(dt) {

    if (!this._isWinter()) {                                   // 非冬季：融雪清空

      if (this._treeFrost) { this._treeFrost = null; this.markFarmDirty(); }

      this._frostBudget = 0; this._frostAccum = 0; this._frostSnowingPrev = false;

      return;

    }

    if (this.scene !== 'treeFarm' || !TreeFarm.trees) return;



    const snowing = !!this.isRaining;                          // 冬天的「雨」就是雪

    if (snowing && !this._frostSnowingPrev) {                  // 新的一场雪：重置本场共享额度

      this._frostBudget = (DATA.TREEFARM && DATA.TREEFARM.FROST_BUDGET_PER_SNOW) || 8;

      this._frostAccum = 0;

    }

    this._frostSnowingPrev = snowing;

    if (!snowing) return;                                      // 没下雪不白；已白的冻结保留

    if (this._frostBudget <= 0) return;                       // 本场雪额度发完，其余树没机会了



    const SPEND_RATE = 0.6;                                    // 发放速度：单位/秒（8 档约 13 秒发完，可调）

    this._frostAccum = (this._frostAccum || 0) + dt * SPEND_RATE;

    let stepped = false;

    while (this._frostAccum >= 1 && this._frostBudget > 0) {

      this._frostAccum -= 1;

      this._frostBudget -= 1;

      // 在还没满（<8 档）的树里随机选一棵，把这一档发给它（零和：吃满的树退出候选池）

      const grid = this._treeFrost;

      const cand = [];

      for (let r = 0; r < DATA.FARM.ROWS; r++) {

        for (let c = 0; c < DATA.FARM.COLS; c++) {

          const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);

          const key = r * 1000 + c;

          if (!hasTree) {                                      // 树被砍了：清零，别让新树继承旧白度

            if (grid && grid[key]) { grid[key] = 0; stepped = true; }

            continue;

          }

          const cur = (grid && grid[key]) || 0;

          if (Math.floor(cur * 8) < 8) cand.push(key);

        }

      }

      if (cand.length === 0) { this._frostBudget = 0; break; } // 全满了，剩余额度作废

      const pick = cand[Math.floor(Math.random() * cand.length)];

      const cur = (grid && grid[pick]) || 0;

      const next = Math.min(1, cur + 1 / 8);

      if (Math.floor(next * 8) !== Math.floor(cur * 8)) stepped = true;

      (this._treeFrost || (this._treeFrost = {}))[pick] = next;

    }

    if (stepped) this.markFarmDirty();

  },



  /** 取某格树当前白化程度（量化到 1/8 档，与上面的缓存失效节奏对齐，避免画出未失效的中间档） */

  _treeFrostAt(r, c) {

    const v = (this._treeFrost && this._treeFrost[r * 1000 + c]) || 0;

    return Math.floor(v * 8) / 8;

  },



  /** 预合成「树冠精灵」= 季节染色树冠 + 体积暗部(约束②b)，暗部用 source-atop 只落在树冠自身的

   *  非透明像素上，绝不溢出到格子空白处。

   *  为什么要预合成：以前 ②b 是直接在主画布上画椭圆，而树冠向上溢出约 0.82 格、树又是由下而上画的，

   *  于是「后画的上排树」会把自己的体积暗部糊到「前排树的叶子」上——这也是用户说的「阴影透到叶子上面」。

   *  所有树的树冠尺寸/暗部位置都一样，故按 (leafColor,size) 缓存一次，全场复用，反而更快。 */

  _canopySprite(leafColor, size) {

    const tinted = ASSETS.getTinted('oak_leaves', leafColor);

    if (!tinted || !size) return null;

    if (!this._canopyCache) this._canopyCache = {};

    const k = leafColor + '|' + size;

    if (this._canopyCache[k]) return this._canopyCache[k];

    if (Object.keys(this._canopyCache).length > 24) this._canopyCache = {};  // 季节色每天渐变，防缓存无限膨胀

    const cv = document.createElement('canvas');

    cv.width = size; cv.height = size;

    const cx = cv.getContext('2d');

    cx.imageSmoothingEnabled = false;

    cx.drawImage(tinted, 0, 0, size, size);

    cx.globalCompositeOperation = 'source-atop';          // 只染树冠自己的像素，空隙保持透明

    cx.fillStyle = 'rgba(0,0,0,0.18)';

    cx.beginPath();

    cx.ellipse(size * 0.64, size * 0.60, size * 0.34, size * 0.30, 0, 0, Math.PI * 2);

    cx.fill();

    cx.globalCompositeOperation = 'source-over';

    this._canopyCache[k] = cv;

    return cv;

  },



  /** 画一棵资源树（树场专用：grown=大树，sapling=树苗）。

   *  树干 oak_log、树冠 oak_leaves 染季节色并向上溢出（视觉大树，逻辑仍只占 1 格）。 */

  _drawTreeEntity(ctx, x, y, cs, t) {

    if (!t) return;

    const fr = Math.round(y / cs), fc = Math.round(x / cs);       // 反推格坐标，用于取该树的白化进度

    const frostAmt = this._isWinter() ? this._treeFrostAt(fr, fc) : 0;

    if (t.stage === 'sapling') {

      // 树苗（种下去的橡果）：用 16×16 grow 贴图 acorn_grow；素材缺失时回退简单像素方块，不出 emoji
      // 尺寸按格确定性随机（_treeSaplingSize），最高档 = 现状 cs-8；pad 自算，只可能更小或持平

      const size = this._treeSaplingSize(fr, fc, cs);          // 影子副本同步（运行时被 ui-scene.js 覆盖）
      const pad = Math.round((cs - size) / 2);

      const winter = this._isWinter();
      const flip = this._treeSaplingFlip(fr, fc);              // 与 ui-scene.js 同一 helper，防双写漂移

      if (flip) {
        ctx.save();
        const fx = x + cs / 2;
        ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0);   // 绕格垂直中线水平镜像
      }

      if (!ASSETS.draw(ctx, 'acorn_grow', x + pad, y + pad, size, size)) {

        const cx = x + cs / 2;

        const trunkW = Math.max(2, cs * 0.14), trunkH = cs * 0.34;

        ctx.fillStyle = '#6b4a2b';

        ctx.fillRect(cx - trunkW / 2, y + cs - trunkH - 1, trunkW, trunkH);

        const leaf = (winter && frostAmt > 0.5) ? '#e3ecf5' : this._seasonGrass(-22);

        ctx.fillStyle = leaf;

        const ly = y + cs * 0.16, lh = cs * 0.26;

        ctx.fillRect(cx - cs * 0.22, ly + lh,       cs * 0.44, lh);

        ctx.fillRect(cx - cs * 0.16, ly + lh * 0.5, cs * 0.32, lh);

        ctx.fillRect(cx - cs * 0.10, ly,            cs * 0.20, lh);

      } else if (frostAmt > 0) {

        // 按该树自己的白化进度叠霜白（0=没白，1=全白）——下雪过程中逐渐盖白，不是一进冬天就白

        const frost = this._winterFrosted('acorn_grow');

        if (frost && frost.width) {

          ctx.save();

          ctx.globalAlpha = Math.min(1, frostAmt);

          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(frost, x + pad, y + pad, size, size);

          ctx.restore();

        }

      }

      if (flip) ctx.restore();                      // 翻转坐标系收尾：必须在 frost 块之后、return 之前

      return;

    }

    if (t.stage === 'grown') {

      // === A4 树叶与草地区分：4 条硬约束 ===

      const baseGrass = this._seasonColorAt().grass;

      // 约束①：树冠比草地更深/更饱和（偏离由 -14 加深到 -30）

      const leafColor = this._shade(baseGrass, -30);

      // 树冠底色一律按季节草色染深；冬季的「霜白」改为下面按该树 frostAmt 叠加，

      // 这样一进冬天不会整片林子瞬间全白，而是下雪过程中一棵棵慢慢泛白（用户要求）。

      const tinted = ASSETS.getTinted('oak_leaves', leafColor);

      const trunkW = cs * 0.52, trunkH = cs * 0.72;

      const tx = x + (cs - trunkW) / 2, ty = y + cs - trunkH - 2;

      // 约束④：树干 oak_log 占下半部，树冠长在树干上（连通，不悬空）

      this._drawWoodOrFill(ctx, 'oak_log', tx, ty, trunkW, trunkH);

      // 树冠：oak_leaves（1024 方图，保持 1:1 不变形），底部接树干顶端向上长，

      // 不再用「整体上移 overflow」——那会让叶子内容在边缘格被推到格子下方显得「往下挤」。

      // 大小按格确定性随机 5 档（_treeCrownSize 内部已 Math.round 成整数像素，与描边 A 烘焙同源）
      const crownSize = this._treeCrownSize(fr, fc, cs);

      const crownW = crownSize, crownH = crownSize;

      const crownX = x + (cs - crownW) / 2;

      const crownBottom = y + cs - trunkH * 0.45;   // 树冠底落在树干上半部，连通不悬空

      const crownY = crownBottom - crownH;          // 向上生长；超界部分由画布自然裁切

      // 树冠 + 体积暗部(②b) 已预合成到一张精灵里（暗部 source-atop 只落在叶子像素上，不会溢出去盖到别的树）

      const canopy = this._canopySprite(leafColor, Math.max(1, Math.round(crownSize)));

      if (canopy) {

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(canopy, crownX, crownY, crownW, crownH);

      } else if (tinted) {                                   // 兜底：贴图还没染好时先画原色树冠

        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(tinted, crownX, crownY, crownW, crownH);

      }

      // 冬季按该树的白化进度 frostAmt 叠一层霜白（下雪过程中逐渐盖白；只染非透明的叶像素，用离屏 source-atop 版）

      if (frostAmt > 0) {

        const frostImg = this._winterFrosted('oak_leaves');

        if (frostImg) {

          ctx.save();

          ctx.globalAlpha = Math.min(1, frostAmt);

          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(frostImg, crownX, crownY, crownW, crownH);

          ctx.restore();

        }

      }

    }

  },



  /** 持续重绘循环：驱动未浇水作物的闪烁动画（标签页隐藏时浏览器自动暂停） */

  // ─────────────────────────────────────────────

  // ⑤ 动画循环 / HUD

  // ─────────────────────────────────────────────

});
