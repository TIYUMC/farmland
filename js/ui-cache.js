/**
 * ui-cache.js — 从 ui.js 拆分
 */

const _cacheMethods = {
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

  /** 渲染单个格子到给定的 ctx */

  _renderCell(ctx, r, c, x, y, cs, colors) {
    const cell = (this.scene === 'treeFarm' && TreeFarm.grid[r] && TreeFarm.grid[r][c]) 
      || (Farm.grid[r] && Farm.grid[r][c]);
    const gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
    const isDirt = !!(Farm.dirt && Farm.dirt[r] && Farm.dirt[r][c]);
    const isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);

    if (this.scene === 'treeFarm') {
      // 树场：只画草、缠根泥土，不画树（树由 _renderTreeFarmScene 最后统一画）
      const hasTree = !!(TreeFarm.trees[r] && TreeFarm.trees[r][c]);
      if (hasTree) {
        // 树格也必须画地面：增量刷新会先 clearRect 本格再调本方法，
        // 有树时不画会在 _farmCache 上留透明洞，合成时露出绿色底（整格纯绿）。
        // 参数与全量 _renderTreeFarmScene(ui-scene.js:1121) 逐字一致：
        // 有树按裸土画（gstate 传 0、isBare 强制 true）。
        this._drawGrassGroundCell(ctx, r, c, x, y, cs, 0, true, colors);
      }
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
    
    // 花朵
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


};

Object.assign(UI, _cacheMethods);
