/**
 * ui-autumn.js — 从 ui.js 拆分
 */

const _autumnMethods = {
  _isAutumn() { return (typeof Engine !== 'undefined') && (Engine.season === 2 || this._forceAutumnLeaves); },



  /** 当前是否冬季：冬季「下雨」时渲染为飘雪（season 0春/1夏/2秋/3冬）。 */


  _isWinter() { return (typeof Engine !== 'undefined') && Engine.season === 3; },



  /** 秋叶色板（橙/金黄/红褐/枯黄褐），灰度原图用 source-atop 染成纯秋色并保留叶形 alpha。 */


  _autumnLeafColors() { return ['#d2772a', '#e0a82e', '#b8442a', '#c89a3c', '#9c6f2e']; },



  /** 取一帧染色落叶（缓存 key|color，避免每帧重绘离屏 canvas）。用 getTinted 正片叠底染色，保留叶形纹理（更自然）。 */


  _leafTinted(frame, color) {

    const ck = frame + '|' + color;

    if (this._leafTint[ck]) return this._leafTint[ck];

    const img = ASSETS.getTinted('leaf_' + frame, color);   // 正片叠底染色，保留叶脉明暗

    if (!img) return null;

    this._leafTint[ck] = img;

    return img;

  },



  /** 生成一片落叶：仅树场（有树处）从随机一棵树的树冠下出生，落叶集中在树底；主农场不放落叶。 */


  _spawnLeaf(W, H) {

    if (this.scene !== 'treeFarm') return;   // 落叶只在树场出现，主农场不放（用户：农场不要有落叶）

    if (this._fallingLeaves.length >= 16) return;   // 上限：少量，不满屏

    const colors = this._autumnLeafColors();

    const cs = W / DATA.FARM.COLS;

    const trees = (TreeFarm.trees) ? TreeFarm.trees : null;

    let x, y;

    if (trees) {

      // 树场：从随机一棵树的树冠下飘落（落叶集中在树底，而非满屏）

      const cells = [];

      for (let r = 0; r < DATA.FARM.ROWS; r++)

        for (let c = 0; c < DATA.FARM.COLS; c++)

          if (trees[r] && trees[r][c]) cells.push([r, c]);

      if (cells.length) {

        const [tr, tc] = cells[(Math.random() * cells.length) | 0];

        x = tc * cs + cs * (0.2 + Math.random() * 0.6);

        y = tr * cs + cs * (0.1 + Math.random() * 0.5);   // 树冠底附近出生

      } else { return; }   // 树场无树则不落叶（用户：树没了就不落叶）

    } else { return; }     // 无 trees 也不落叶

    this._fallingLeaves.push({

      x, y,

      vx: (Math.random() - 0.5) * 14,               // 轻微水平漂移

      vy: 24 + Math.random() * 26,                   // 缓慢下落

      sway: Math.random() * Math.PI * 2,            // 摇摆相位

      swayAmp: 12 + Math.random() * 20,

      rot: Math.random() * Math.PI * 2,

      vr: (Math.random() - 0.5) * 0.45,             // 自转放慢（原 ±1.6 太快）

      age: 0,

      life: 7 + Math.random() * 5,                   // 7~12 秒飘落全程

      frame: (Math.random() * 12) | 0,

      color: colors[(Math.random() * colors.length) | 0],

      size: 14 + Math.random() * 8,                 // 飘落叶子小一点（原 28~44 太大）

      scene: this.scene,                             // 记录出生场景，避免切场残留

    });

  },



  /** 推进落叶：仅秋季更新；非秋季让已有叶片自然落完（不突兀清空）。 */


  _updateLeaves(dt, W, H) {

    if (this._isAutumn()) {

      this._leafTick += dt;

      // 补充节奏放慢：约每 0.5s 一片，且概率 0.7（少量飘落，不满屏）

      if (this._leafTick > 0.5) {

        this._leafTick = 0;

        if (Math.random() < 0.7) this._spawnLeaf(W, H);

      }

    }

    const keep = [];

    for (const lf of this._fallingLeaves) {

      lf.age += dt;

      if (lf.age >= lf.life) continue;               // 落出寿命移除（底部淡出，见 draw）

      lf.x += (lf.vx + Math.sin(lf.age * 1.4 + lf.sway) * lf.swayAmp) * dt;

      lf.y += lf.vy * dt;

      lf.rot += lf.vr * dt;

      if (lf.x < -30) lf.x = W + 20; else if (lf.x > W + 30) lf.x = -20;

      keep.push(lf);

    }

    this._fallingLeaves = keep;

  },



  /** 绘制落叶：飘落动画帧 + 自转 + 落地前淡出；仅在秋季或尚有余叶时绘制。 */


  _drawLeaves(ctx, dt) {

    if (!this._fallingLeaves || !this._fallingLeaves.length) return;

    for (const lf of this._fallingLeaves) {

      if (lf.scene !== this.scene) continue;         // 切场后不再画旧场叶子

      const k = lf.age / lf.life;

      const alpha = k < 0.85 ? 1 : Math.max(0, 1 - (k - 0.85) / 0.15);  // 末段淡出，落地不突兀

      const f = lf.frame;   // 出生随机选定一种形态，飘落中保持不变（不在空中切换形态）

      const img = this._leafTinted(f, lf.color);

      if (!img) continue;

      const s = lf.size * (0.85 + 0.15 * k);

      ctx.save();

      ctx.globalAlpha = alpha;

      ctx.translate(lf.x, lf.y);

      ctx.rotate(lf.rot);

      ctx.imageSmoothingEnabled = false;

      ctx.drawImage(img, -s / 2, -s / 2, s, s);

      ctx.restore();

    }

    ctx.globalAlpha = 1;

  },



  /** 地面落叶堆：每格确定性散布几片棕色落叶（棕色染色 leaf_litter，保留叶形明暗纹理）。静态层每格绘制一次，等同「每格一张贴图」。 */


  _litterTinted() {

    if (this._litterTintCache) return this._litterTintCache;

    // 用 getTinted 正片叠底染色：保留 leaf_litter 内部明暗层次（不像 source-atop 纯色平涂那样糊成一块），自然像落叶堆

    const img = ASSETS.getTinted('leaf_litter', '#9c6b3c');   // 棕色落叶堆

    if (!img) return null;

    this._litterTintCache = img;

    return img;

  },



  /** 确保落叶计数 grid 存在（每格 0~4 份，每份 1/4 格）。null 时按全农场尺寸建全 0 数组。 */


  _ensureLitterGrid() {

    if (!this._litterGrid) {

      this._litterGrid = Array.from({ length: DATA.FARM.ROWS }, () => Array(DATA.FARM.COLS).fill(0));

    }

    return this._litterGrid;

  },

  /** 在单格 (x,y,cs) 按 count(0~4) 份绘制落叶：每份取「贴图的 1/4（一个象限）」绘入对应格象限（左上→右上→左下→右下）。 */


  _drawLitterCell(ctx, x, y, cs, count) {

    const img = this._litterTinted();

    if (!img) return;

    ctx.imageSmoothingEnabled = true;

    const h = cs / 2;

    const qx = [x, x + h, x, x + h];

    const qy = [y, y, y + h, y + h];

    // 把一个 leaf_litter 贴图**裁成 4 个象限**，每份取其中一块（1/4 贴图）绘入对应格象限，

    // 而非把整张缩成 1/4 格。source 取自然尺寸的一半（左右×上下各半）。

    const sw = (img.naturalWidth || img.width) / 2;

    const sh = (img.naturalHeight || img.height) / 2;

    const sx = [0, sw, 0, sw];

    const sy = [0, 0, sh, sh];

    for (let k = 0; k < count && k < 4; k++) {

      ctx.drawImage(img, sx[k], sy[k], sw, sh, qx[k], qy[k], h, h);

    }

  },



  /** 秋日落叶每日生成 / 冬季消失（用户规则，单位=1份=1/4格）：

   *  秋季（R78 按用户「秋天地上落叶提升四倍」整体 ×4）：每树 12% 概率（原 3%）→ 相邻非树非草格 +1 份

   *  （该格满 4 份则不计）；每天至多 16 份（原 4）、全图至多 40 个格有落叶（原 10；每格 0~4 份上限不变）。

   *  冬季：地上枯叶随机消失，每天至多 2 份（随机抽有落叶的格 -1）。春/夏：清空。 */


  _spawnDailyLitter() {

    const season = Engine.season;

    const ROWS = DATA.FARM.ROWS, COLS = DATA.FARM.COLS;

    // 冬季：枯叶随机消失，每天至多 2 份

    if (season === 3) {

      if (!this._litterGrid) return;

      for (let i = 0; i < 2; i++) {

        const cells = [];

        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this._litterGrid[r][c] > 0) cells.push([r, c]);

        if (!cells.length) break;

        if (Math.random() < 0.5) {

          const [r, c] = cells[(Math.random() * cells.length) | 0];

          this._litterGrid[r][c]--;

        }

      }

      return;

    }

    if (!this._isAutumn()) { this._litterGrid = null; return; }   // 春/夏：清空

    const grid = this._ensureLitterGrid();

    // 统计已占用格数（>0 的格）

    let occupied = 0;

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] > 0) occupied++;

    let dayParts = 0;                                            // 当天已落份数（上限 16，R78 ×4）

    // 收集所有树格

    const trees = [];

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (TreeFarm.trees[r] && TreeFarm.trees[r][c]) trees.push([r, c]);

    for (let i = 0; i < trees.length; i++) {

      if (dayParts >= 16) break;                                 // 每天至多 16 份（R78 ×4，可分散任意格）

      const [r, c] = trees[i];

      if (Math.random() >= 0.12) continue;                       // 每棵树 12% 命中（R78 ×4）

      // 收集「相邻非树、非绿黄草、未满 4 份」的格

      const neigh = [];

      for (let dr = -1; dr <= 1; dr++) {

        for (let dc = -1; dc <= 1; dc++) {

          if (dr === 0 && dc === 0) continue;

          const nr = r + dr, nc = c + dc;

          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;

          if (TreeFarm.trees[nr] && TreeFarm.trees[nr][nc]) continue;                       // 相邻是树则跳过

          const gr = (TreeFarm.grass && TreeFarm.grass[nr] && TreeFarm.grass[nr][nc]) || 0;

          if (gr >= 1) continue;                                 // 绿(1)/黄(2)草格跳过

          if (grid[nr][nc] >= 4) continue;                       // 该格已满 4 份

          neigh.push([nr, nc]);

        }

      }

      if (!neigh.length) continue;

      const [nr, nc] = neigh[(Math.random() * neigh.length) | 0];

      if (TreeFarm.trees[nr] && TreeFarm.trees[nr][nc]) continue;   // 生成在树格上 → 无效

      const gr2 = (TreeFarm.grass && TreeFarm.grass[nr] && TreeFarm.grass[nr][nc]) || 0;

      if (gr2 >= 1) continue;                                    // 绿/黄草上 → 无效

      if (grid[nr][nc] >= 4) continue;                           // 满 4 份 → 无效

      const wasEmpty = grid[nr][nc] === 0;

      if (wasEmpty && occupied >= 40) continue;                  // 总共至多 40 个格有落叶（R78 ×4，新格受限）

          grid[nr][nc]++;

      if (wasEmpty) occupied++;

      dayParts++;

    }

    // 落叶变化后标记农场缓存脏，触发重绘
    this.markFarmDirty();
  },



  /** 生成一颗雨滴：anywhere=true 时整屏随机（初始化）；否则从顶部落下。

   *  每滴的长度/速度/粗细/透明度都随机 → 破除「太整齐」的帘幕感 */


  _newDrop(W, H, anywhere) {

    const len = 8 + Math.random() * 20;               // 雨丝长度 8~28px（差异更大）

    return {

      x: Math.random() * (W + 40) - 20,

      y: anywhere ? (Math.random() * H) : -len,

      vy: 420 + Math.random() * 420,                 // 下落速度 420~840 px/s（速度差更大）

      vx: -40 - Math.random() * 90,                  // 风向：左飘 -40~-130 px/s

      len,

      wF: 0.7 + Math.random() * 0.7,                 // 单滴粗细系数 0.7~1.4

      alpha: 0.35 + Math.random() * 0.5,             // 单滴透明度 0.35~0.85（更淡、不显眼）

      landY: (0.18 + Math.random() * 0.78) * H       // 落地「地面深度」：顶视下雨落满整片田，落点散布画面各处

    };

  },



  /** 从「水」贴图截取一段，预渲染成雨滴精灵（只做一次；精灵本身保持竖直，斜度由各雨滴运动方向在 _drawRain 里决定） */


};

Object.assign(UI, _autumnMethods);
