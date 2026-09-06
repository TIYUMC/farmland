/**
 * ui-cache.js — 缓存系统
 * 从 ui.js 拆分出的模块
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

  /** 增量重绘被标记为脏的格子 */

  _refreshDirtyCells() {
    if (!this._farmCache) return;
    const sctx = this._farmCache.getContext('2d');
    const cs = this.cellSize;
    const colors = this._seasonColorAt();

    // 重绘 farmCache 中的脏格
    const dirtyCells = [];
    for (const key of this._farmCacheDirty) {
      const [r, c] = key.split(',').map(Number);
      dirtyCells.push({ r, c });
    }
    if (dirtyCells.length > 0) {
      // 第一遍：重绘地面（草/泥土/缠根泥土）
      for (const { r, c } of dirtyCells) {
        const x = c * cs, y = r * cs;
        sctx.clearRect(x, y, cs, cs);
        this._renderCell(sctx, r, c, x, y, cs, colors);
      }
      // 第二遍：重绘树（确保树在地面之上）——仅在树场场景
      if (this.scene === 'treeFarm') {
        for (const { r, c } of dirtyCells) {
          const t = (TreeFarm.trees[r] && TreeFarm.trees[r][c]) || null;
          if (t) {
            const x = c * cs, y = r * cs;
            this._drawTreeEntity(sctx, x, y, cs, t);
          }
        }
      }
    }
    this._farmCacheDirty.clear();

    // 重绘 vegCache 中的脏格（无论有无积雪都刷新，因为花朵/草叶都在这里）
    if (this._vegCacheDirty.size > 0) {
      // 确保 vegCache 尺寸正确（与 _buildVegCache 保持一致）
      if (!this._vegCache) this._vegCache = document.createElement('canvas');
      const cv = this._vegCache;
      if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {
        cv.width = this.canvas.width;
        cv.height = this.canvas.height;
      }
      const vctx = cv.getContext('2d');
      const cs = this.cellSize;
      const colors = this._seasonColorAt();

      // 只需要重绘脏格区域（不清空整个画布，只clear脏格）
      for (const key of this._vegCacheDirty) {
        const [r, c] = key.split(',').map(Number);
        const x = c * cs, y = r * cs;
        vctx.clearRect(x, y, cs, cs);  // 只clear当前脏格
        this._renderVegCell(vctx, r, c, x, y, cs, colors);
        this._vegCacheDirty.delete(key);
      }
    }

    // _grassBaseCache 失效（在 _invalidateCell 里被置 null）时必须**完整**重建，不能只重建脏格。
    // 只建脏格会让缓存变成稀疏对象：脏格走「预渲染底 + 摆动顶层」，其余草格走「实时兜底」，
    // 两条路径画法不同 → 被点击的那一格视觉与周围不一致，且不会自动恢复（单格异常色）。
    // _rebuildGrassBase() 只重画草颤底缓存，不触碰 farmCache / vegCache，
    // 因此不会像 _rebuildFarmCache() 那样引起整屏闪烁。
    if (this._grassBaseCache === null) {
      this._rebuildGrassBase();
    }
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
    if (flower > 0) {
      const fkey = this._flowerDef(flower).key;
      this._drawPaddedAsset(ctx, fkey, x, y, cs, 0)
        || this._fillCell(ctx, x, y, cs, '#a9b765');
    }
    
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
    if (flower > 0) {
      const fkey = this._flowerDef(flower).key;
      this._drawPaddedAsset(ctx, fkey, x, y, cs, 0) || this._fillCell(ctx, x, y, cs, '#a9b765');
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

        if (flower > 0) {

          const fkey = this._flowerDef(flower).key;

          this._drawPaddedAsset(ctx, fkey, x, y, cs, 0) || this._fillCell(ctx, x, y, cs, '#a9b765');

        }

      });

    }

  },





  /** 把指定场景的静态层渲染到一张离屏画布（用于滑场过渡的目标屏） */


};

Object.assign(UI, _cacheMethods);
