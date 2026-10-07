/**
* ui-events.js — 键盘 / 鼠标 / 触控 / resize 事件绑定 + 田间动作 effect/done + busy/抖屏
* 职责：画布事件入口（鼠标/触摸/resize）、田间 20 个 effect/done 动作、树场点击处理、busy 锁与抖屏。
* 生效/影子：无白名单影子；事件绑定动作仍留在 init() 入口内（main.js 调用），本件只定义方法体、文件内不绑定事件。
* 方法清单：
*   - _resize
*   - _onMouseMove
*   - _eventToCanvas
*   - _cellAt
*   - _actionEffect
*   - _waterEffect
*   - _waterDone
*   - _plantEffect
*   - _plantDone
*   - _harvestEffect
*   - _harvestDone
*   - _clearGrassEffect
*   - _clearGrassDone
*   - _flowerDef
*   - _clearFlowerEffect
*   - _clearFlowerDone
*   - _tillEffect
*   - _tillDone
*   - _toDirtEffect
*   - _toDirtDone
*   - _chopEffect
*   - _chopDone
*   - _plantSaplingEffect
*   - _plantSaplingDone
*   - _onCanvasClick
*   - _handleHoeClick
*   - _chopTree
*   - _handleTreeFarmClick
*   - _handleTreeFarmHoeClick
*   - _tfClearGrassEffect
*   - _tfTillEffect
*   - _tfTillDone
*   - _startBusy
*   - _finishBusy
*   - _shakeCanvas
*/

Object.assign(UI, {
  _resize() {

    // #game-area 是 flex 居中容器，canvas 尺寸由 JS 设置
    // 用 clientHeight 量实际可用空间（而非 window.innerHeight，后者在页面初始化时可能不准）
    const gameArea = document.getElementById('game-area');
    const hud = document.getElementById('hud-bar');
    const toolbar = document.getElementById('toolbar');

    // 直接量 game-area 的实际可用空间，而不是拿 innerWidth/innerHeight 自己去减：
    //   桌面 / 竖屏：HUD 与工具栏上下堆叠，game-area 的高度已是扣除后的剩余；
    //   手机横屏：两者移到左右侧栏，此时该扣的是「宽度」而非高度。
    // 若沿用旧的减法，侧栏布局下 availW 会错算成整个屏幕宽，画布将溢出 game-area。
    // 注意：game-area 有 padding: 16px，需要扣除两侧 padding
    const GAP = 32; // padding 总宽度 (16px * 2)
    const availW = (gameArea.clientWidth || window.innerWidth) - GAP;
    // 切场箭头 DOM 按钮占画布一侧，availW 里直接扣掉按钮位，画布算小一点、两侧永远放得下
    // （50=44px 按钮+6px 间隙 / 62=56px+6px；按钮同一时刻只占一侧，扣一次就够。窄屏 cellSize 自动变小，4px 兜底变纯防御）
    const navReserve = Math.min(window.innerWidth, window.innerHeight) <= 560 ? 50 : 62;
    const availW2 = availW - navReserve;
    let availH = gameArea.clientHeight - GAP;
    if (!availH || availH < 50) {
      // 布局尚未稳定时的兜底（toolbar 和 hotbar 分开，各减一次）
      const hotbar = document.getElementById('bottom-hotbar');
      availH = window.innerHeight - hud.offsetHeight - toolbar.offsetHeight - (hotbar ? hotbar.offsetHeight : 0) - 8 - GAP;
    }



    // 计算格子大小：让农场尽量填满

    const idealSizeByH = Math.floor(availH / DATA.FARM.ROWS);

    const idealSizeByW = Math.floor(availW2 / DATA.FARM.COLS);   // 用扣掉按钮位的 availW2（原 availW）

    // 小屏(手机)放宽下限：桌面 32 的保底会在手机上反向把画布撑出容器 —— 这正是「显示不全」的根因。
    // 例：手机横屏 availH≈250 → ideal=25，若被 max(...,32) 抬成 32，画布高 320 > 250 直接溢出。

    const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) <= 560;
    const MIN_CELL = isSmallScreen ? 14 : 32;

    let size = Math.min(idealSizeByH, idealSizeByW, 85);

    size = Math.max(size, MIN_CELL);

    // ★ 兜底之后必须再用可用空间夹一次，否则保底值会把画布顶出容器
    size = Math.min(size, idealSizeByH, idealSizeByW);

    this.cellSize = Math.max(size, 1);   // 极端窄窗保底 1px，杜绝 0 / 负值



    this.canvas.width = DATA.FARM.COLS * this.cellSize;

    this.canvas.height = DATA.FARM.ROWS * this.cellSize;



    // ★ 强制 CSS 尺寸与 buffer 尺寸一致 — 准星不准的核心修复

    this.canvas.style.width = `${this.canvas.width}px`;

    this.canvas.style.height = `${this.canvas.height}px`;



    // game-area 是 flex 居中容器，CSS 已处理水平和垂直居中
    // JS 不再设置 margin，避免与 flex 居中冲突
    this.offsetX = 0;
    this.offsetY = 0;
    this.canvas.style.marginLeft = '';
    this.canvas.style.marginTop = '';

    // 尺寸变化→静态层失效，需重建
    this._farmCache = null;
    this._vegCache = null;
    this._grassBaseCache = null;
    this._farmCacheKey = '';
    this._farmDirty = true;
    this._grassDataRev = (this._grassDataRev || 0) + 1;   // 尺寸变化→合并草轮廓缓存失效（key 含画布尺寸，下一帧自然重建）

    // 画布位置变了，商店 DOM 叠层需重新对齐

    if (this._shopOpen) this._shopDirty = true;

  },



  /** 主渲染（B6 优化：静态农场层缓存到离屏画布，每帧只 blit + 重绘动态未浇水高亮） */

  // ─────────────────────────────────────────────

  // ② 主渲染 / 静态层缓存

  // ─────────────────────────────────────────────

  _eventToCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    return { x: clientX - rect.left, y: clientY - rect.top };
  },



  /** 画布像素坐标 → 网格行列（输入热路径共用，消除 _onMouseMove/_onCanvasClick 两处重复） */

  _cellAt(x, y) {

    return { row: Math.floor(y / this.cellSize), col: Math.floor(x / this.cellSize) };

  },



  /** 从工具 id 解析种子作物 id；非种子工具返回 null（种子播种两处共用，消除重复的 startsWith+replace） */

  _onMouseMove(e) {

    if (this._shopOpen) { if (this._onShopMove) this._onShopMove(e); return; }

    if (this._busy) return; // 正在干活中，悬停高亮冻结在当前地块，不跟随鼠标

    const { x, y } = this._eventToCanvas(e);

    this._mouseX = x; this._mouseY = y; // 供导航箭头等画布 UI 的悬停高亮

    const { row, col } = this._cellAt(x, y);

    let next;

    if (row >= 0 && row < DATA.FARM.ROWS && col >= 0 && col < DATA.FARM.COLS) {

      next = { row, col };

    } else {

      next = null;

    }

    // 每次mousemove都更新鼠标坐标，确保高亮跟随鼠标位置
    this._hoverCell = next;
    this._mouseX = x; this._mouseY = y;

    // 草描边实时层随鼠标距离渐变(10%→100%)：每次移动都补一次 rAF render，
    // 让透明度连续跟随鼠标（主循环有帧率节流，多余 rAF 会自动合并）
    if (!this._hoverRaf) {
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = null;
        this.render();
      });
    }
  },



  /** 点击地图 */

  // ─────────────────────────────────────────────

  // ⑧ 田间动作（锄 / 浇 / 种 / 收 / 砍树）

  // ─────────────────────────────────────────────

  // ── 农场/树场动作：_startBusy 的 onEffect / onDone 具名化（原内联箭头整体搬出，行为不变）──

  // 通用动作骨架：扣体力(cost) 或 cost=null 直接执行 → 世界操作 → 成功(res 满足 isOk)时调用 onOk(res)。

  // 各 *_Effect 把「成功分支」原样搬进 onOk，worldFn 用闭包固化 row/col，行为逐字等价。

  _actionEffect(row, col, cost, worldFn, onOk, opts) {

    const res = (cost == null) ? worldFn(row, col) : this._tryAction(cost, () => worldFn(row, col));

    const isOk = (opts && opts.isOk) || ((r) => r === 'ok');

    if (isOk(res) && onOk) {
      onOk(res);
    }

    return res;

  },

  _waterEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.water, (r, c) => Farm.water(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6bb6ff', '#9fd4ff', '#bfe8ff'], shape: 'rect', count: 10, speed: 70, gravity: 320, dir: -Math.PI / 2, spread: Math.PI * 1.3 });

    });

  },

  _waterDone(res) {

    if (res !== 'ok') {

      if (res === 'already_watered') this.showStatus('已经浇过水了', 400);

      else if (res === 'no_tilled') this.showStatus('这里还没有耕地', 500);

      return;

    }

    this.showStatus('浇水完成', 500);

  },

  _plantEffect(row, col, seedId, seedName, plantCost) {

    const def = DATA.CROPS[seedId];

    const hc = (def && def.color) || '#FFD86B';

    const _rgb = this._hexToRgb(hc);

    const base = `rgb(${_rgb.r},${_rgb.g},${_rgb.b})`;

    return this._actionEffect(row, col, plantCost, (r, c) => Farm.plant(r, c, seedId), (res) => {

      this._invalidateCell(row, col);

      Player.useSeed(seedId);

      this._updateHeldSlot();

      this._spawnBurst(row, col, { colors: [base, this._shade(base, 30), this._shade(base, -30)], count: 12, speed: 75, gravity: 280 });

    });

  },

  _plantDone(res, seedName) {

    if (res === 'no_seed') { this.showStatus(`❌ 种子包里没有 ${seedName} 种子, 去商店买吧 (B)`, 1500); return; }

    if (res !== 'ok') {

      if (res === 'not_tilled') this.showStatus('需要先耕地！', 600);

      else if (res === 'already_planted') this.showStatus('已经种了东西了', 600);

      else this.showStatus('无法种植', 600);

      return;

    }

  },

  _harvestEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.harvest, (r, c) => Farm.harvest(r, c), (res) => {

      Player.addToInventory(res.cropId, res.count);

      this._invalidateCell(row, col);

      const { def, extra } = this._cropDefExtra(res);

      this._spawnBurst(row, col, { colors: ['#9bd45a', '#c6e87a', '#e8f0a0', (def && def.color) || '#FFD86B'], count: 16, speed: 95, gravity: 260 });

      this._shakeIt(2, 220);

    }, { isOk: (r) => r.ok });

  },

  _harvestDone(res) {

    if (this._fail(res, '❌ 无法收割')) return;

    const { def, extra } = this._cropDefExtra(res);

    this.showStatus(`收获 ${def.name}×${res.count}${extra}`, 1500);

  },

  _clearGrassEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.clearGrass(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#7bbf4a', '#9bd45a', '#cfe89a'], count: 10, speed: 60, gravity: 200, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },

  _clearGrassDone(res, gstate) {

    if (res !== 'ok') { this.showStatus('❌ 无法除草', 800); return; }

    const grassIcon = this._grassIconHTML(gstate);

    this.showStatus(grassIcon + ' 除掉了草，可以耕地了', 800);

  },

  /** 按花种编号(1..N)取 DATA.FLOWERS 定义（贴图键/中文名/粒子色）。越界或 DATA 缺失时兜底第一种。

   *  渲染、锄花粒子、锄花提示三处共用，避免各写一份查表逻辑。 */

  _flowerDef(species) {

    const list = (typeof DATA !== 'undefined' && DATA.FLOWERS) ? DATA.FLOWERS : null;

    if (!list || !list.length) return { key: 'Allium', name: '花', colors: ['#c77dff', '#e0aaff', '#d8b4f0', '#ffffff'] };

    return list[(species | 0) - 1] || list[0];

  },

  /** 锄花 effect：与 _clearGrassEffect 同构（扣体力 → 调 Farm.clearFlower → 粒屑）。

   *  花瓣粒屑取该花自己的配色（DATA.FLOWERS[].colors），区别于草屑的纯绿。

   *  ⚠ 必须在 Farm.clearFlower 之前读花种——清除后格子已归 0，回调里就查不到品种了。 */

  _clearFlowerEffect(row, col) {

    const def = this._flowerDef(Farm._flowerState(row, col));

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.clearFlower(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: def.colors, count: 12, speed: 70, gravity: 220, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },

  /** species 由 _handleHoeClick 在清除前捕获后传入（清除后 Farm 里已查不到）。 */

  _clearFlowerDone(res, species) {

    if (res !== 'ok') { this.showStatus('❌ 这里没有花', 800); return; }

    const def = this._flowerDef(species);

    const flowerIcon = this._iconHTML(def.key, 'status-hoe', def.name) || '🌸';

    this.showStatus(flowerIcon + ' 锄掉了' + def.name + '，可以耕地了', 800);

  },

  _tillEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.till(r, c), (res) => {

      if (this.isRaining) { const cl = (Farm.grid[row] && Farm.grid[row][col]); if (cl) cl.watered = true; }

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#8a5a2b', '#a9763c', '#6b4423'], count: 14, speed: 80, gravity: 320 });

    });

  },

  _tillDone(res, cell) {

    if (this._warnIfNotOk(res, cell)) return;

    this.showStatus('耕地完成', 600);

  },

  _toDirtEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => Farm.toDirt(r, c), (res) => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#8a5a2b', '#a9763c', '#6b4423'], count: 12, speed: 75, gravity: 300 });

    });

  },

  _toDirtDone(res, cell) {

    if (this._warnIfNotOk(res, cell)) return;

    const dirtIcon = this._iconHTML('coarse_dirt', 'status-hoe', '泥土');

    this.showStatus(dirtIcon + ' 锄成了泥土，再锄一次就能耕地', 800);

  },

  _chopEffect(row, col, tree, src) {

    return this._actionEffect(row, col, DATA.TOOL_COST.axe, (r, c) => src.chop(r, c), (res) => {

      Player.addWood(res.wood);

      if (res.acorns) Player.addAcorns(res.acorns);

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6b4a2b', '#8a5a2b', '#3d6b2a', '#5a8a3a'], count: 22, speed: 130, gravity: 340, spread: Math.PI * 2 });

      this._shakeIt(4, 300);

    }, { isOk: (r) => r.ok });

  },

  _chopDone(res) {

    if (this._fail(res, '❌ 无法砍树')) return;

    const logIcon = this._iconHTML('oak_log', 'status-hoe', '木头') || '🪵';

    let extra = '';

    if (res.acorns) {

      const acornIcon = this._iconHTML('acorn', 'status-hoe', '橡果') || '';

      extra = ` 橡果×${res.acorns} ${acornIcon}`;

    }

    this.showStatus(`砍倒树，获得木头×${res.wood} ${logIcon}${extra}`, 1500);

  },

  _plantSaplingEffect(row, col) {

    return this._actionEffect(row, col, null, (r, c) => TreeFarm.plantAcorn(r, c), (res) => {

      Player.useAcorn();

      this._updateHeldSlot();

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#3d6b2a', '#5a8a3a', '#8a5a2b'], count: 10, speed: 55, gravity: 240 });

    }, { isOk: (r) => r.ok });

  },

  _plantSaplingDone(res) {

    if (this._fail(res, `❌ ${res ? res.reason : '失败'}`)) return;

  },



  _onCanvasClick(e) {

    const { x, y } = this._eventToCanvas(e);

    this._mouseX = x; this._mouseY = y;

    // 商店打开时点击交给商店逻辑（含「点面板外关闭」）

    if (this._shopOpen) { if (this._onShopClick) this._onShopClick(x, y); return; }

    if (Engine.paused) return;

    if (this._busy) return; // 正在干活中，期间不能点地图

    if (this._transition) return; // 切换滑场动画进行中，屏蔽点击


    const { row, col } = this._cellAt(x, y);



    if (!Farm._inBounds(row, col)) return;



    // 锁定悬停高亮到当前正在操作的格子（忙时高亮冻结在此处）

    this._hoverCell = { row, col };



    const tool = Player.selectedTool;



    // ── 树场场景：只处理砍树（斧头），其余工具无意义，统一拦截 ──

    if (this.scene === 'treeFarm') { this._handleTreeFarmClick(row, col, tool); this._needsRender = true; this.render(); return; }



    // 主农场已不再有树（树移到独立树场 TreeFarm 场景）；斧头等工具在农场上无树可交互，

    // 直接走下方的耕地/浇水/播种逻辑。砍树请按 T 进入树场。



    // 根据工具类型处理，每类自己做体力检查 + 事务（成功才扣）

    switch (tool) {

      case 'hoe':

        this._handleHoeClick(row, col);

        this._needsRender = true;

        this.render();

        return;



      case 'water': {

        // 点击即判定：干不了直接提示、不进进度条

        const wcell = (Farm.grid[row] && Farm.grid[row][col]) || null;

        if (!wcell || !wcell.tilled) { this.showStatus('这里还没有耕地', 500); return; }

        if (wcell.watered) { this.showStatus('已经浇过水了', 400); return; }

        this._startBusy('浇水', null,

          () => this._waterEffect(row, col),

          (res) => this._waterDone(res));

        return;

      }



      default: {

        // 种子播种：先检查种子，再「先扣后做 + 失败回滚」（B1）

        const seedId = this._seedIdFromTool(tool);

        if (seedId) {

          const plantCost = DATA.TOOL_COST.plant || 3;

          const seedName = (DATA.CROPS[seedId] && DATA.CROPS[seedId].name) || seedId;

          // 按作物选对应种子贴图（不再统一用小麦种子）

          const seedIconKey = ({ wheat: 'wheat_seeds', potato: 'potato', strawberry: 'mc_sweet_berries' })[seedId] || 'wheat_seeds';

          // 点击即判定：干不了直接提示、不进进度条

          if (!Player.hasSeed(seedId)) { this.showStatus(`❌ 种子包里没有 ${seedName} 种子, 去商店买吧 (B)`, 1500); return; }

          const cell0 = (Farm.grid[row] && Farm.grid[row][col]) || null;

          if (!cell0) { this.showStatus('需要先耕地！', 600); return; }

          if (cell0.crop) { this.showStatus('已经种了东西了', 600); return; }

          this._startBusy('种植', seedIconKey,

            () => this._plantEffect(row, col, seedId, seedName, plantCost),

            (res) => this._plantDone(res, seedName));

        } else if (tool === 'axe') {
          // B5：主农场没有树，斧头点地不再静默——提示去树场
          this.showStatus('主农场没有树，按 T 键去树场砍树', 1500);
        } else if (tool === 'acorn') {
          // B5：橡果要去树场种植
          this.showStatus('橡果要去树场种植，按 T 键去树场', 1500);
        }

        return;

      }

    }

  },



  /** 锄头在主农场的点击逻辑：按当前格子状态分 4 种情况处理（收割/除草/耕地/锄成泥土）。

   *  全程走 _tryAction 体力事务；每种失败分支各回各的提示，互不影响。 */

  _handleHoeClick(row, col) {
    const cell = (Farm.grid[row] && Farm.grid[row][col]) || null;
    const fstate = (Farm.flowers && Farm.flowers[row]) ? (Farm.flowers[row][col] || 0) : 0;
    const gstate = (Farm.grass && Farm.grass[row]) ? (Farm.grass[row][col] || 0) : 0;

    // 成熟的作物：锄头点击即可收割（无需单独的「收获」工具）

    if (cell && cell.crop && Farm._isGrown(cell)) {

      this._startBusy('收割', null,

        () => this._harvestEffect(row, col),

        (res) => this._harvestDone(res));

      return;

    }

    // 点击即判定：作物未成熟不能收/锄，立刻提示、不进进度条（避免落到耕地分支拖到 80% 才报）

    if (cell && cell.crop) { this.showStatus('作物还没成熟，再等等', 600); return; }

    // 点击即判定：已耕地（非成熟作物）不能再锄，立刻提示、不进进度条

    if (cell && cell.tilled) { this.showStatus('这块地已经耕过了', 500); return; }

    // 花朵格子：先锄花（视觉上花朵替换草方块，grass=0/flowers>0；详见 Farm.clearFlower）

    if (fstate > 0) {

      this._startBusy('锄花', null,

        () => this._clearFlowerEffect(row, col),

        (res) => this._clearFlowerDone(res, fstate)); // fstate=清除前捕获的花种，用于提示图标/名字

      return;

    }

    // 有草(绿/黄)的地面：必须先除掉草 → 变回普通草方块，之后才能锄地

    if (gstate === 1 || gstate === 2) {

      this._startBusy('除草', null,

        () => this._clearGrassEffect(row, col),

        (res) => this._clearGrassDone(res, gstate));

      return;

    }

    // 已是泥土(dirt) 或 自然退化的裸土(bare) → 锄一次直接成耕地

    // （裸土本来就是裸露的土，不需要再「锄成泥土」，一锄到位）

    const isBareSoil = !!(Farm.bare && Farm.bare[row] && Farm.bare[row][col]);

    if ((Farm.dirt && Farm.dirt[row] && Farm.dirt[row][col]) || isBareSoil) {

      this._startBusy('耕地', null,

        () => this._tillEffect(row, col),

        (res) => this._tillDone(res, cell));

      return;

    }

    // 否则：普通草方块（从未退化过的地面）→ 先锄成泥土，再锄一次才成耕地

      this._startBusy('锄地', null,

        () => this._toDirtEffect(row, col),

        (res) => this._toDirtDone(res, cell));

  },



  /** 用斧头砍树：stamina 先扣后做 + 失败回滚（与锄地/浇水同款事务逻辑）。

   *  src 默认 Farm（主农场上的树）；树场场景传 TreeFarm。 */

  _chopTree(row, col, tree, src) {

    src = src || TreeFarm;

    if (tree.stage !== 'grown') {

      this.showStatus('树还没长好，等它重新长大', 1000);

      return;

    }

    this._startBusy('砍树', null,

      () => this._chopEffect(row, col, tree, src),

      (res) => this._chopDone(res));

  },



  /** 树场场景的点击处理：① 有树→斧头砍；② 空格→选了「橡果」则种下，否则提示。 */

  _handleTreeFarmClick(row, col, tool) {

    const tree = TreeFarm.getTreeAt(row, col);

    if (tree) {

      if (tool === 'axe') {

        if (!Player.ownedTools || !Player.ownedTools.axe) {

          this.showStatus('先去商店 (B) 买把木斧头再砍', 1500);

        } else {

          this._chopTree(row, col, tree, TreeFarm);

        }

      } else {

        this.showStatus('这里有棵树，按 3 切斧头再砍', 1200);

      }

      return;

    }

    // 锄头：与主农场同步的分支逻辑（先除草、再尝试翻出缠根泥土带概率）；不产生耕地、不弹窗

    if (tool === 'hoe') {

      this._handleTreeFarmHoeClick(row, col);

      this._needsRender = true;

      this.render();

      return;

    }

    // 橡果：选中药桶后点击下方快捷栏橡果格，再点击空地种植

    if (tool === 'acorn') {

      // 点击即判定：干不了直接提示、不进进度条（有树的情况已被上方 if(tree) 拦截）

      if (!Player.hasAcorn()) {

        this.showStatus('没有橡果，去砍树掉落 1~3 个再来种', 1200);

      } else {

        // 前置判定：这格长着草(绿/黄)先不种，提示用锄头先除草。
        // 必须放在 _startBusy 之前，才能「点了立刻提示」，而不是进度条闪一下才失败。
        const g0 = (TreeFarm.grass && TreeFarm.grass[row]) ? (TreeFarm.grass[row][col] || 0) : 0;
        if (g0 === 1 || g0 === 2) {
          const hoeIcon = this._iconHTML('wooden_hoe', 'status-hoe', '锄头') || '';
          this.showStatus('这格长着草，先用' + hoeIcon + '锄头把它锄掉再种橡果', 1400);
          this._needsRender = true;
          this.render();
          return;
        }

        this._startBusy('种植', null,

          () => this._plantSaplingEffect(row, col),

          (res) => this._plantSaplingDone(res));

      }

      this._needsRender = true;

      this.render();

      return;

    }

    if (tool === 'axe') this.showStatus('这里没有树可砍', 800);

    else this.showStatus('树场里：按 3 切斧头砍树，或选「橡果」点击空格种植', 1000);

    this._needsRender = true;

    this.render();

  },



  /** 树场锄头点击：与主农场 _handleHoeClick 同步的分支逻辑，但不产生耕地（树场根系太密，只翻出缠根泥土，且带概率）。

   *  - 有草(绿/黄) → 除草（与主农场一致，走「正在除草中」进度条）

   *  - 已翻出缠根泥土 → 点击即拦截，提示一句，不再重复锄（用户「这个泥土怎么还可以再被锄一次，不合理」）

   *  - 其余地面（草方块/裸土）→「正在锄地中」进度条 → ROOT_CHANCE 概率翻出缠根泥土，失败可重试

   *  R78：恢复 _startBusy 的「正在 X 中…」指示器（用户要求把这个弹窗展示出来），

   *  这样锄头那点耗时是有进度条可见的，不再「感觉有延迟」；R77 去掉的是**成功结果那条 toast**，仍然不加回来。 */

  _handleTreeFarmHoeClick(row, col) {

    const gstate = (TreeFarm.grass && TreeFarm.grass[row]) ? (TreeFarm.grass[row][col] || 0) : 0;

    if (gstate === 1 || gstate === 2) {                       // 有草 → 先除草

      this._startBusy('除草', 'wooden_hoe',

        () => this._tfClearGrassEffect(row, col),

        (res) => { if (res !== 'ok') this.showStatus('❌ 无法除草', 600); });

      return;

    }

    if (TreeFarm.getRootedAt(row, col)) {                     // 已翻出缠根泥土：不能再锄

      this.showStatus('这块地已经翻过了', 500);

      return;

    }

    this._startBusy('锄地', 'wooden_hoe',

      () => this._tfTillEffect(row, col),

      (res) => this._tfTillDone(res));

  },



  /** 树场除草：与主农场 _clearGrassEffect 同构（同样走 _tryAction 扣体力），只是作用于 TreeFarm。 */

  _tfClearGrassEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => TreeFarm.clearGrass(r, c), () => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#7bbf4a', '#9bd45a', '#cfe89a'], count: 10, speed: 60, gravity: 200, dir: -Math.PI / 2, spread: Math.PI * 1.4 });

    });

  },



  /** 树场锄地：TreeFarm.till 返回 {ok} / {ok:false,reason}，故用 isOk 取 r.ok（不是主农场那套 'ok' 字符串）。 */

  _tfTillEffect(row, col) {

    return this._actionEffect(row, col, DATA.TOOL_COST.hoe, (r, c) => TreeFarm.till(r, c), () => {

      this._invalidateCell(row, col);

      this._spawnBurst(row, col, { colors: ['#6b4a2b', '#8a5a2b', '#3d6b2a'], count: 12, speed: 75, gravity: 300 });

    }, { isOk: (r) => !!(r && r.ok) });

  },



  _tfTillDone(res) {

    if (res && res.ok) return;                                // 成功：不弹结果 toast（R77 要求），靠贴图 + 粒子表现

    // 失败只在「根系太密」这种可重试的情况提示一句，否则玩家不知道为什么点了没反应

    if (res && res.reason === 'root_too_dense') this.showStatus('根系太密，没锄动，再试一次', 700);

  },



  /** 进入“正在 X 中”状态：体力越低耗时越长（效率越低），期间锁输入。

   *  - onEffect()：进度条到 80% 时才触发，执行真正的世界改动（含 _tryAction 体力事务），须返回 res。

   *  - onDone(res)：进度条满 100%（成功）或 80%（失败）时触发，负责状态提示/粒子等表现。

   *  设计点：被操作的对象（作物/树/地块）在进度条 80% 时才真正变化，而非点击瞬间。 */

  _startBusy(label, iconKey, onEffect, onDone) {

    const BUSY_ICONS = {

      '耕地': 'wooden_hoe', '浇水': 'water_bucket', '收割': 'wooden_hoe',

      '种植': 'wheat_seeds', '砍树': 'oak_log', '除草': 'wooden_hoe', '锄地': 'wooden_hoe',

    };

    const key = iconKey || BUSY_ICONS[label] || '';

    const iconSrc = this._assetURL(key);

    const iconEl = document.getElementById('busy-icon'); if (iconEl) iconEl.src = iconSrc;



    const r = Math.max(0, Math.min(1, Player.stamina / Player.maxStamina));

    const dur = Math.round(this.BUSY_BASE_MS * (1 + (1 - r) * this.BUSY_SLOW_K));

    const EFFECT_AT = 0.8; // 进度条到 80% 才真正改变被操作的对象

    this._busy = true;

    this._busyEffectResult = null;

    const ind = document.getElementById('busy-indicator');

    const el = document.getElementById('busy-text'); if (el) el.textContent = `正在${label}中…`;

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

    clearTimeout(this._busyEffectTimer);

    // 80%：触发真正的世界改动
    this._busyEffectTimer = setTimeout(() => {
      const res = onEffect ? onEffect() : 'ok';
      this._busyEffectResult = res;
      const ok = res === 'ok' || !!(res && res.ok);

      if (!ok) { // 失败：立刻结束并显示失败提示（不撑满整条）

        clearTimeout(this._busyTimer);

        this._finishBusy();

        if (onDone) onDone(res);

      }

    }, dur * EFFECT_AT);

    // 100%：成功才走到这里，弹完成表现

    this._busyTimer = setTimeout(() => {

      this._finishBusy();

      if (onDone) onDone(this._busyEffectResult);

    }, dur);

  },



  /** 收尾“正在 X 中”状态：解锁输入 + 隐藏指示器 */

  _finishBusy() {

    this._busy = false;

    const ind = document.getElementById('busy-indicator');

    ind.classList.remove('busy-visible');

    ind.classList.add('busy-hidden');

    // 动作完成后触发重绘，确保脏格被刷新到画布
    this._needsRender = true;
    this.render();

  },



  /** 显示状态消息 */

  // ─────────────────────────────────────────────

  // ⑨ 状态提示 / 图标

  // ─────────────────────────────────────────────

  /** 画布抖动 + 红色边框闪烁（用于拒绝/锁定提示） */
  _shakeCanvas(msg, duration = 2000) {
    this.showStatus(msg, duration);
    // Canvas 抖动
    this.canvas.style.transform = 'translateX(5px)';
    setTimeout(() => { this.canvas.style.transform = 'translateX(-5px)'; }, 50);
    setTimeout(() => { this.canvas.style.transform = 'translateX(3px)'; }, 100);
    setTimeout(() => { this.canvas.style.transform = 'translateX(-3px)'; }, 150);
    setTimeout(() => { this.canvas.style.transform = 'translateX(2px)'; }, 200);
    setTimeout(() => { this.canvas.style.transform = 'translateX(0)'; }, 250);
    this.canvas.style.boxShadow = 'inset 0 0 0 4px rgba(255, 0, 0, 0.6)';
    setTimeout(() => { this.canvas.style.boxShadow = 'none'; }, 300);
    // 同时抖动商店图标层（如果有）
    const shopIcons = document.getElementById('shop-icons');
    if (shopIcons) {
      shopIcons.style.transform = 'translateX(5px)';
      setTimeout(() => { shopIcons.style.transform = 'translateX(-5px)'; }, 50);
      setTimeout(() => { shopIcons.style.transform = 'translateX(3px)'; }, 100);
      setTimeout(() => { shopIcons.style.transform = 'translateX(-3px)'; }, 150);
      setTimeout(() => { shopIcons.style.transform = 'translateX(2px)'; }, 200);
      setTimeout(() => { shopIcons.style.transform = 'translateX(0)'; }, 250);
    }
  },

});
