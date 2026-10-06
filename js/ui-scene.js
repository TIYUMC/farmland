/**
 * ui-scene.js — 从 ui.js 拆分
 */

const _sceneMethods = {
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
      const cx = this.scene === 'farm' ? cs : this.canvas.width - cs;   // 0.5.13：尘爆在新场景按钮那一侧的画布边缘（farm=左缘、treeFarm=右缘）一格内
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

      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);

      // 整格淡蓝呼吸高亮

      this._fillCell(ctx, x, y, cs, `rgba(90,180,250,${0.10 + 0.14 * pulse})`);

      // 闪烁边框 + 右上角水桶角标

      this._drawBreathingBorder(ctx, x, y, cs, `rgba(95,195,255,${0.45 + 0.45 * pulse})`, cs * 0.36, pulse, 'water_bucket', '💧');

    });

  },



  /** 动态层：耕地的呼吸描边——"玩家翻过的田"边界签名，每帧呼吸闪烁（方案：A3 + 跟需浇水同款呼吸动画） */


  _drawFarmlandOverlay(ctx, cs) {

    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);

    this._forEachFarmCell(cs, (r, c, x, y) => {

      const cell = Farm.grid[r][c];

      // 仅空耕地(无作物)才呼吸描边；已播种格交给"需浇水"蓝边提示，避免双重描边

      if (!cell || !cell.tilled || cell.crop) return;

      // 空耕地描边改用绿色，随脉冲呼吸；线宽与基线对齐"需浇水"蓝边(lw3, 0.45+0.45*pulse)，仅色相区分

      const strokeRGB = cell.watered

        ? `rgba(70,150,95,${0.30 + 0.35 * pulse})`    // 湿土：柔深绿（半透明质感）

        : `rgba(125,190,135,${0.30 + 0.35 * pulse})`; // 干土：柔草绿（半透明质感，降饱和不刺眼）

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

          // 注：不能画成 farmland_dry，否则和真耕地长得一模一样；而草方块→泥土 本身就是「绿草纹→土色」的明显变化。

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
      // 花格绘制统一走 _drawFlowerCell（含 flip 水平镜像，与静态/植被/描边三路径同朝向）
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

    const C = DATA.FARM.COLS;

    // 雪埋草：草基部截断面积 = 雪占格面积 × 30%（0.5.50 连续公式，替代旧二值 0.25）；满格雪=截 30% 格。截断的是草叶基部（被雪盖住那段）。

    // 仅「雪上植被层(_vegCache) / 草颤层」需要此截断（让雪埋住草基）；静态层(_farmCache)是雪融化后露出的底，

    // 绝不截断，否则雪化后草永久短一截（静态层只在换季/农场变化/尺寸时重建，不在雪融化时重建）。

    const cellLeft = c * cs, cellTop = r * cs;

    // 0.5.50：取该格雪片像素尺寸 ps（无雪=0）；量化面积比替代旧「有无雪二值」。
    let ps = 0;

    if (snowTruncate && this._snowGround) {
      const sf = this._snowGround.find(f => f.c === c && f.r === r);
      if (sf) ps = sf.pixelStep != null ? sf.pixelStep : 1;
    }

    // 量化：缓存 key 专用、公式取整同用（防 veg/描边两层不一致）；48px→8px 一档（0~6 桶），
    // 雪长大期间每格最多 6 次重烘（veg 层 + 描边 A），不是每 tick 一次。
    const qstep = Math.max(1, cs / 6);
    const szQ = Math.min(ps, cs) > 0 ? Math.ceil(Math.min(ps, cs) / qstep) * qstep : 0;
    const trunc = 0.3 * (szQ / cs) * (szQ / cs);   // 满格雪(48)→0.3；ps=24→0.075；ps=1/8→≈0.0083

    const s = sway || 0;

    const v = this._grassVariation(r, c);   // 每丛草固定大小/位置随机（自然感）

    ctx.save();

    if (trunc > 0) {                                              // 只画草叶顶部 (1-trunc)，基部被雪埋住

      ctx.beginPath();

      ctx.rect(x, y, cs, cs * (1 - trunc));

      ctx.clip();

    }

    // 耕地格方向全裁：朝 4 邻耕地方向的溢出整条裁在本格边线（耕地格内草身 0 像素），
    // 非耕地侧不裁（保留朝邻居草格的自然溢出）。必须与 _ensureGrassOutline 的 A 烘焙 clip 完全同步（双写，改一处必改另一处）。
    const F2 = (this.scene === 'treeFarm') ? null : Farm;
    if (F2 && F2.grid) {
      const tR = !!(F2.grid[r] && F2.grid[r][c+1]);       // 右邻耕地
      const tL = !!(F2.grid[r] && F2.grid[r][c-1]);       // 左邻耕地
      const tB = !!(F2.grid[r+1] && F2.grid[r+1][c]);     // 下邻耕地
      const tT = !!(F2.grid[r-1] && F2.grid[r-1][c]);     // 上邻耕地
      if (tR || tL || tB || tT) {
        ctx.beginPath();
        const L = tL ? x : x - cs;          // 左邻耕地 → 像素不得越 x
        const R = tR ? x + cs : x + cs * 2; // 右邻耕地 → 像素不得越 x+cs
        const T = tT ? y : y - cs;
        const Bm = tB ? y + cs : y + cs * 2;
        ctx.rect(L, T, R - L, Bm - T);
        ctx.clip();
      }
    }

    if (s || v.scale !== 1 || v.ox || v.oy || v.flip) {

      const cx = x + cs / 2, cyBottom = y + cs;

      ctx.translate(cx + v.ox, cyBottom + v.oy);   // 位置偏移：不严格居中

      ctx.rotate(s);                                // 晃动（被踩/雨打时）

      if (v.flip) ctx.scale(-1, 1);                 // 水平镜像：绕格垂直中线翻（草丛左右镜像；flip 与 scale/ox/oy 必须两路径逐字一致，改一处必改另一处）

      ctx.scale(v.scale, v.scale);                  // 大小不一

      ctx.translate(-cx, -cyBottom);

    }

    if (gstate === 1) {

      const tint = this._shade(colors.grass, 30);
      const layer = this._getGrassLayer(ASSETS.getTinted('short_grass', tint), 'grass|' + tint, cs);

      if (layer) {
        ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1;
        // 草身与白环同规格（cs×cs，草形在 (1,1)）→ scale≠1 时缩放锚点逐像素一致，根治「有的贴合有的不贴合」
        ctx.drawImage(layer, x, y);
      }

    } else {

      const layer = this._getGrassLayer(ASSETS.get('short_dry_grass'), 'dry', cs);

      if (layer) {
        ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1;
        ctx.drawImage(layer, x, y);
      } else { this._fillCell(ctx, x, y, cs, this._dryGrassColor); }

    }

    ctx.restore();

  },




  /** 每丛草的确定性随机外观：大小 + 位置偏移（同一格跨帧/跨缓存稳定，不跳变）。仅作用于草顶绘制机制，不改草贴图内容。
   *  scale 量化到 {1, 1.25}：1px 白环在 nearest 采样下「缩小(<1)会丢点→没画完」，「放大(≥1)逐点保留」。
   *  整数化缩放（不缩小）根治描边断点；0.78~1.0 的刻意缩小去掉，只保留 1.0/1.25 两档大小变化。 */
  /** 每丛草的确定性随机外观：大小 + 位置偏移 + 水平翻转（同一格跨帧/跨缓存/全量vs增量稳定，不跳变）。仅作用于草顶绘制机制，不改草贴图内容。
   *  scale 量化到 {1, 1.25}：1px 白环在 nearest 采样下「缩小(<1)会丢点→没画完」，「放大(≥1)逐点保留」。
   *  整数化缩放（不缩小）根治描边断点；0.78~1.0 的刻意缩小去掉，只保留 1.0/1.25 两档大小变化。
   *  flip 判据 = fa（与 scale 同源）：fa<=0.5 不翻、fa>0.5 翻（与大小同位），同格跨路径永远同朝向，
   *  杜绝「静态/植被/描边三处漂移」与描边错位。锁定与 scale 同源（如需与大小解耦改用第三路种子 c=Math.sin(r*311.7+c*127.1) 取 fc）。 */
  _grassVariation(r, c) {
    const a = Math.sin(r * 127.1 + c * 311.7) * 43758.5453;
    const fa = a - Math.floor(a);                 // 0..1
    const b = Math.sin(r * 269.5 + c * 183.3) * 24634.633;
    const fb = b - Math.floor(b);                 // 0..1
    const scale = (fa > 0.5) ? 1.25 : 1.0;        // 量化：不缩小，1px 线不丢点
    const flip = fa > 0.5;                        // 与 scale 同源：大丛(1.25)镜像，同格三路径稳定
    return {
      scale,
      ox: (fb - 0.5) * 0.34 * this.cellSize,      // ±17% 格宽，位置不居中
      oy: (fa - 0.5) * 0.10 * this.cellSize,      // ±5% 轻微上下
      flip
    };
  },

  /** 树冠（树叶）大小：按格确定性随机 5 档（1.35/1.425/1.5/1.575/1.65 倍格宽），中间档 1.5 = 现状。

   *  内部直接 Math.round 返回整数像素——精灵 size 与 drawImage 尺寸同源，杜绝 1px 错位。
   *  种子用现成的按格确定性写法（与 _grassVariation 不同路，避免和草身大小/翻转耦合）。
   *  严禁 Math.random()：增量重绘与全量重建对同一棵树必须算出同一尺寸，否则描边错位（同类坑）。 */
  _treeCrownSize(r, c, cs) {
    const t = Math.sin(r * 311.7 + c * 127.1);
    const f = t - Math.floor(t);                  // 0..1
    const k = Math.floor(f * 5);                  // 0..4
    return Math.max(1, Math.round(cs * (1.35 + k * 0.075)));
  },

  /** 树苗（种下的橡果）大小：按格确定性随机 5 档，最高档 = 现状 cs-8（cs=48 → 40）。
   *  cs=48 实测五档 = 32/34/36/38/40，全整数；只会出现更小或持平的橡果。
   *  调用点自算 pad = Math.round((cs - size) / 2)（→ 8/7/6/5/4，最高档 pad=4 = 现状）。
   *  第三路种子（401.3/211.9），与草(127.1/311.7)、树冠(311.7/127.1)都不同路。
   *  严禁 Math.random()：增量重绘与全量重建对同一格必须同值，否则描边错位（同类坑）。 */
  _treeSaplingSize(r, c, cs) {
    const t = Math.sin(r * 401.3 + c * 211.9);
    const f = t - Math.floor(t);                  // 0..1
    const k = Math.floor(f * 5);                  // 0..4
    return Math.max(1, Math.round(cs * (0.667 + (k / 4) * 0.1667)));
  },

  /** 树苗（种下的橡果）水平翻转：按格确定性随机，约 50% 格镜像。
   *  第四路种子（379.7/523.1），与草(127.1/311.7)、位置fb(269.5/183.3)、
   *  树冠(311.7/127.1)、树苗尺寸(401.3/211.9) 全部不同路 → 「某格橡果朝哪边」
   *  与「某格橡果多大」不相关。
   *  只在这定义一次：显示层 / 描边 A / 影子副本全用 this._treeSaplingFlip(...) 调
   *  （运行时 ui-scene.js 后加载生效）。翻转是 canvas transform（绕格垂直中线水平镜像，
   *  与花 _drawFlowerCell 同款），不是另存镜像图，_winterFrosted 两个朝向共用同一张 frost。
   *  严禁 Math.random()：增量 vs 全量必须同值，否则描边错位（同类坑）。 */
  _treeSaplingFlip(r, c) {
    const t = Math.sin(r * 379.7 + c * 523.1);
    const f = t - Math.floor(t);                  // 0..1
    return f > 0.5;                               // 约 50% 格翻转
  },

  /** 花格绘制（v0.4.41）：复用 _grassVariation 逐格种子（含 flip），flip 格绕格垂直中线水平镜像。
   *  8 处内联花段统一收口到本方法（ui-scene _renderStaticScene / ui-cache _renderCell·_renderVegCell·_buildVegCache
   *  / ui.js 同名双写），保证静态/植被/描边三路径花身同朝向、不漂移。花 pad=0 占满整格；
   *  花身缺失兜底 #a9b765（与静态层同色）；兜底色块翻转不可见，放翻转分支内/外等价，故逐字保留。 */
  _drawFlowerCell(ctx, r, c, x, y, cs, flower) {
    const fkey = this._flowerDef(flower).key;
    const v = this._grassVariation(r, c);   // 花复用同一套逐格种子（含 flip）
    if (v.flip) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      const fx = x + cs / 2;
      ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0);   // 绕格垂直中线水平镜像
      ASSETS.draw(ctx, fkey, x, y, cs, cs, false)
        || (ctx.fillStyle = '#a9b765', ctx.fillRect(x, y, cs, cs));
      ctx.restore();
    } else {
      ASSETS.draw(ctx, fkey, x, y, cs, cs, false)
        || (ctx.fillStyle = '#a9b765', ctx.fillRect(x, y, cs, cs));
    }
  },

  /** 预烘焙草身小图（(cs-2)×(cs-2)，最近邻，内缩 1px 与白环同网格）。
   *  草身(_drawGrassTopLayer/_ensureGrassOutline) 共用同一张烘焙小图 → 采样网格逐像素一致，
   *  根治「白环顶部对不齐」（原草身直接从 1024 源缩放、白环先烘焙再缩放，两条曲线错位）。
   *  以 kind+'|'+cs 缓存。仅机制性增强，不改草贴图内容。 */
  _getGrassBaked(src, kind, cs) {
    if (!src) return null;
    if (!this._grassBakedCache) this._grassBakedCache = {};
    const key = kind + '|' + cs;
    if (this._grassBakedCache[key]) return this._grassBakedCache[key];
    const inset = 1;
    const bw = cs - inset * 2;
    const base = document.createElement('canvas');
    base.width = bw; base.height = bw;
    const b = base.getContext('2d');
    b.imageSmoothingEnabled = false;
    b.drawImage(src, 0, 0, src.width, src.height, 0, 0, bw, bw);
    this._grassBakedCache[key] = base;
    return base;
  },

  /** 草身显示层（cs×cs，草形定位在 (1,1)）。与白环 ring 同尺寸、同草形位置 →
   *  缩放(scale≠1)时两图采样网格逐像素一致，根治「有的贴合有的不贴合」（原草身画 bw 小图、
   *  白环画 cs 图，缩放采样错位 1px）。草身(_drawGrassTopLayer) 直接画本层到 (x,y)。 */
  _getGrassLayer(src, kind, cs) {
    if (!src) return null;
    if (!this._grassLayerCache) this._grassLayerCache = {};
    const key = kind + '|' + cs;
    if (this._grassLayerCache[key]) return this._grassLayerCache[key];
    const baked = this._getGrassBaked(src, kind, cs);   // bw×bw 草形
    if (!baked) return null;
    const layer = document.createElement('canvas');
    layer.width = cs; layer.height = cs;
    const lc = layer.getContext('2d');
    lc.imageSmoothingEnabled = false;
    lc.drawImage(baked, 1, 1);   // 草形在 (1,1)，与白环 ring 草形位置完全一致
    this._grassLayerCache[key] = layer;
    return layer;
  },

  /** 草白描边实时层（v0.4.28 机制改造）：由「逐格独立白环」改为「整片草合并外轮廓」。
   *  旧版逐格独立描边在相邻草重叠处出现双白线交叉；现把全部草烘焙进离屏A，整幅 8 向 1px
   *  外扩并集 + 擦中心 → 并集外白轮廓（离屏B），重叠区只剩外缘一圈，无内部交叉线。
   *  两层渲染：
   *  1) floor 层——合并外轮廓 B 整幅 20% 淡白（任何时刻都有淡边，远处不消失）；
   *  2) 追光层——逐格从 B 裁 3cs×3cs 白环子图，按该格质心到鼠标（低通虚拟点）距离
   *     独立 alpha 0.20→1.00（RADIUS=4×格宽，≈旧 240 值），近格亮远格淡，重叠区无双线交叉
   *     （floor 层已画并集外缘，追光只在该格白环子图上加亮）。
   *  A/B 按 key（场景+tint+cs+雪签名+农场数据标记+画布尺寸+年季日）缓存，key 不变零烘焙；
   *  追光只画 alpha>0.205 的格（floor 之外的浪费直接跳过）；草颤期间轮廓不重建（短暂 1~2 帧错位）。
   *  1px 硬边像素风，全最近邻。 */
  _drawGrassOutline(ctx) {
    if (this._transition) return;   // 滑场过渡不画（坐标错乱）；_busy 不挡：草身照常显示，白边不能跟着闪没
    const out = this._ensureGrassOutline();
    if (!out || !out.centroids.length) return;   // 无草 → 无描边
    const cs = this.cellSize;
    const RADIUS = cs * 4;   // ≈4 格宽（cs=62 时 248px，≈旧 240 值）：亮度按「各格质心到鼠标」逐格独立渐变
    // 鼠标位置低通（根治快动闪烁）：alpha 跟随"缓慢逼近真实鼠标的虚拟点"，
    // 快速掠过时追光渐变而非跳变；_mouseX=-1e4（mouseleave）时虚拟点滑向远处 → 回落 floor
    if (this._olMouseX === undefined) { this._olMouseX = -1e4; this._olMouseY = -1e4; }
    this._olMouseX += (this._mouseX - this._olMouseX) * 0.35;   // 系数 0.35 ≈ 5~6 帧收敛
    this._olMouseY += (this._mouseY - this._olMouseY) * 0.35;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // 第1层：合并外轮廓 floor（全图 20% 淡白）
    ctx.globalAlpha = 0.20;
    ctx.drawImage(out.canvas, 0, 0);
    // 0.5.19 草颤旋转跟随：预建「正在颤的格 → r,c」映射，追光层对颤格与草身同枢轴（格底中心+v.ox/oy）
    // 同角度（sin(age*18)*amp*decay，ui-effects.js:119 同式）旋转裁片。映射只在有草颤时建（无颤零开销）。
    let shakeMap = null;
    if (this._grassShakes && this._grassShakes.length) {
      shakeMap = new Map();
      for (const s of this._grassShakes) shakeMap.set(s.r + ',' + s.c, s);
    }
    // 第2层：逐格追光（每丛草按各自质心到鼠标距离独立 alpha，近亮远淡）
    for (let i = 0; i < out.centroids.length; i++) {
      const p = out.centroids[i];
      const dx = this._olMouseX - p.x, dy = this._olMouseY - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = 0.20 + 0.80 * Math.max(0, Math.min(1, 1 - d / RADIUS));
      if (a <= 0.205) continue;   // alpha≈floor 的格跳过（避免逐格 drawImage 浪费）
      const ring = this._getGrassRingCrop(p, cs, out);
      if (!ring) continue;
      const c = Math.floor(p.x / cs), r = Math.floor(p.y / cs);
      ctx.globalAlpha = a;
      const s = shakeMap ? shakeMap.get(r + ',' + c) : null;
      if (s) {
        // 颤格：与草身同枢轴（格底中心+v.ox/oy）同角度旋转裁片（T(pivot)·R(θ)·T(-pivot)），
        // ring 裁片由 A 段烘焙而来（已烘 variation、颤角=0），草身实时变换=同枢轴多一个 rotate(θ)，逐像素对齐。
        const v = this._grassVariation(r, c);
        const px = c * cs + cs / 2 + v.ox;
        const py = r * cs + cs + v.oy;
        const ang = Math.sin(s.age * 18) * s.amp * (1 - s.age / s.maxAge);   // ui-effects.js:113-119 同公式
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.drawImage(ring, (c - 1) * cs - px, (r - 1) * cs - py);
        ctx.restore();
      } else {
        // 非颤格：画回裁剪原点，与 B 逐像素对齐（零漂移）
        ctx.drawImage(ring, (c - 1) * cs, (r - 1) * cs);
      }
    }
    ctx.restore();
  },

  /** 逐格追光用：从合并外轮廓 B 裁出该格 ±1 格范围的 3cs×3cs 白环子图（透明底，含 1px 外扩余量），
   *  按 格坐标+cs+outlineKey 缓存。越界格（c=0/r=0）裁剪区含负坐标源，drawImage 越界源按规范视为透明，安全。 */
  _getGrassRingCrop(p, cs, out) {
    if (!this._grassRingCropCache) this._grassRingCropCache = {};
    const c = Math.floor(p.x / cs), r = Math.floor(p.y / cs);
    const key = r + ',' + c + '|' + cs + '|' + (this._grassOutlineKey || '');
    if (this._grassRingCropCache[key]) return this._grassRingCropCache[key];
    const S = cs * 3;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const o = cv.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(out.canvas, (c - 1) * cs, (r - 1) * cs, S, S, 0, 0, S, S);
    this._grassRingCropCache[key] = cv;
    return cv;
  },

  /** 缓存 key 变化时重建「整片草合并外轮廓」（离屏A/B + 质心表），key 不变零开销。
   *  A：全画布画草身（筛选与 vegCache 完全一致：树格/非地面格跳过、裸土与 gstate∉{1,2} 跳过；
   *  变换逐字复用 _drawGrassTopLayer：每丛 variation + 雪截断 clip 0.75cs + 草颤角度；r 升序保 z 序）；
   *  B：A 整幅 8 向 1px 外扩并集 → destination-out 擦中心 → source-in 染白 → 并集外白轮廓
   *  （重叠区不再有内部交叉线，只剩外缘一圈 1px 硬边）。 */
  _ensureGrassOutline() {
    const cs = this.cellSize;
    const tint = this._shade(this._seasonColorAt().grass, 30);
    // 0.5.50：雪签名扩量化桶（"r,c,bucket"）——同公式量化防 veg 层/描边两层不一致；
    // 雪长大期间每格最多 6 次重烘（0~6 桶），key 含桶号。qstep 提到方法级，供下方 A 烘焙截断段复用。
    const qstep = Math.max(1, cs / 6);
    const snowSig = this._snowSig();   // 单一权威源 UI._snowSig()：与 veg 层 _syncSnowCanvas 失效同口径，防三处漂移
    // 0.5.19：key 只保留 7 个元素（scene / tint / cs / snowSig / _grassDataRev / 画布宽高 / 年-季-日）。
    // 描边永远中性烘焙（A 段 shakeAngle 恒空、a.rotate 恒 0），颤中 key 完全稳定零重建；
    // 草颤跟随由 _drawGrassOutline 追光层对颤格与草身同枢轴（格底中心）同角度旋转裁片实时完成。
    const key = [this.scene, tint, cs, snowSig, this._grassDataRev || 0,
      this.canvas.width + 'x' + this.canvas.height,
      Engine.year + '-' + Engine.season + '-' + Engine.day].join('#');
    if (this._grassOutline && this._grassOutlineKey === key) return this._grassOutline;

    // ---- 离屏A：烘焙全部草身 ----
    const A = this._grassBodyCanvas || (this._grassBodyCanvas = document.createElement('canvas'));
    if (A.width !== this.canvas.width || A.height !== this.canvas.height) {
      A.width = this.canvas.width; A.height = this.canvas.height;
    }
    const a = A.getContext('2d');
    a.clearRect(0, 0, A.width, A.height);
    const layerG = ASSETS.getTinted('short_grass', tint) ? this._getGrassLayer(ASSETS.getTinted('short_grass', tint), 'grass|' + tint, cs) : null;
    const layerD = this._getGrassLayer(ASSETS.get('short_dry_grass'), 'dry', cs);
    if (!layerG && !layerD) {
      // 草贴图未加载：花/树冠兜底用贴图/纯色，不依赖草层；
      // 只有「既无草层、又无花、又无 grown 树冠、又无树苗」才早退空轮廓。
      // 场景判断用 this.scene（const treeFarm 在下方 726 行才声明，块内直接引用会 TDZ）。
      let anyFlower = false;
      if (this.scene !== 'treeFarm' && Farm.flowers) {
        for (let fr = 0; fr < DATA.FARM.ROWS && !anyFlower; fr++)
          for (let fc = 0; fc < DATA.FARM.COLS; fc++)
            if ((Farm.flowers[fr] || [])[fc]) { anyFlower = true; break; }
      }
      let anyCanopy = false;
      if (this.scene === 'treeFarm' && TreeFarm.trees) {
        for (let tr = 0; tr < DATA.FARM.ROWS && !anyCanopy; tr++)
          for (let tc = 0; tc < DATA.FARM.COLS; tc++)
            if (TreeFarm.trees[tr] && TreeFarm.trees[tr][tc] && TreeFarm.trees[tr][tc].stage === 'grown') { anyCanopy = true; break; }
      }
      // 树苗也算子「有轮廓源」：否则场上只有树苗（且无草、无 grown）会早退成空轮廓 → 树苗没边
      let anySapling = false;
      if (this.scene === 'treeFarm' && TreeFarm.trees) {
        for (let tr = 0; tr < DATA.FARM.ROWS && !anySapling; tr++)
          for (let tc = 0; tc < DATA.FARM.COLS; tc++)
            if (TreeFarm.trees[tr] && TreeFarm.trees[tr][tc] && TreeFarm.trees[tr][tc].stage === 'sapling') { anySapling = true; break; }
      }
      // 作物也算子「有轮廓源」：否则场上只有作物（且无草/花/树）会早退成空轮廓 → 作物没边（§1.4）
      let anyCrop = false;
      if (this.scene !== 'treeFarm' && Farm.grid) {
        for (let cr = 0; cr < DATA.FARM.ROWS && !anyCrop; cr++)
          for (let cc2 = 0; cc2 < DATA.FARM.COLS; cc2++)
            if (Farm.grid[cr] && Farm.grid[cr][cc2] && Farm.grid[cr][cc2].crop) { anyCrop = true; break; }
      }
      if (!anyFlower && !anyCanopy && !anySapling && !anyCrop) {
        this._grassOutlineKey = key;
        this._grassRingCropCache = {};
        this._grassOutline = { canvas: A, centroids: [] };   // 贴图未加载 → 空轮廓
        return this._grassOutline;
      }
      // 有花或树冠无草：草层为 null，下面 A 烘焙循环里草格因 layer null 跳过，花/树冠正常烘焙
    }
    const treeFarm = this.scene === 'treeFarm';
    const centroids = [];
    // 0.5.50：snowSet 改 snowMap（"r,c,bucket" → snowMap[r+','+c]=bucket），供截断段查桶算同公式
    const snowMap = snowSig ? (() => {
      const m = {};
      for (const e of snowSig.split(':').pop().split('|').filter(Boolean)) {
        const p = e.split(',');
        if (p.length === 3) m[p[0] + ',' + p[1]] = +p[2];
      }
      return m;
    })() : null;
    // 0.5.18：永远中性烘焙（不烘入草颤角度）——颤动改由 _drawGrassOutline 追光层 ±2px dx 实时跟随。
    // 烘角进 A 的问题：#sh key 只在沿上重烘，颤中冻住；且烘入半透明角度像素会被 B 擦不净 → 内部发虚。
    const shakeAngle = {};
    for (let r = 0; r < DATA.FARM.ROWS; r++) {
      for (let c = 0; c < DATA.FARM.COLS; c++) {
        let gstate, isBare, flower = 0;
        if (treeFarm) {
          const t = TreeFarm.trees[r] && TreeFarm.trees[r][c];
          if (t) {
            if (t.stage === 'sapling') {
              // 树苗（种下的橡果）：只烘 alpha=1 的橡果本体，纳入草合并外描边。
              // 参数逐字抄显示层 sapling 主画分支（_drawTreeEntity 1469-1498，pad/size 同式）。
              // 不整调 _drawTreeEntity —— 它含 frost 段 globalAlpha<1 的半透明白；A 是轮廓源，
              // B 用 destination-out 按 alpha 擦中心，半透明像素擦不干净 → 白边内部发虚/出双层
              // （0.4.50 手抄树干参数是同个原因）。frost 一律不烘 → 冬天霜白后白边位置不跑。
              const size = this._treeSaplingSize(r, c, cs);   // 与显示层同一口径（A 循环里 r/c 就是循环变量）
              const pad = Math.round((cs - size) / 2);
              const flip = this._treeSaplingFlip(r, c);      // 与显示层同一口径（A 循环里 r/c 就是循环变量）
              a.save();
              a.imageSmoothingEnabled = false;
              a.globalAlpha = 1;
              if (flip) {
                const fx = c * cs + cs / 2;
                a.translate(fx, 0); a.scale(-1, 1); a.translate(-fx, 0);   // 绕格垂直中线水平镜像
              }
              const ok = ASSETS.draw(a, 'acorn_grow', c * cs + pad, r * cs + pad, size, size);
              if (!ok) {
                // 贴图缺失兜底：位置与显示层 1479-1497 逐字一致（cx 处 x+cs/2 ≡ c*cs+cs/2）
                const cx = c * cs + cs / 2;
                const trunkW = Math.max(2, cs * 0.14), trunkH = cs * 0.34;
                a.fillStyle = '#6b4a2b';
                a.fillRect(cx - trunkW / 2, r * cs + cs - trunkH - 1, trunkW, trunkH);
                a.fillStyle = this._seasonGrass(-22);
                const ly = r * cs + cs * 0.16, lh = cs * 0.26;
                a.fillRect(cx - cs * 0.22, ly + lh,       cs * 0.44, lh);
                a.fillRect(cx - cs * 0.16, ly + lh * 0.5, cs * 0.32, lh);
                a.fillRect(cx - cs * 0.10, ly,            cs * 0.20, lh);
              }
              a.restore();
              centroids.push({ x: c * cs + cs / 2, y: r * cs + cs / 2 });   // 树苗纳入逐格追光，只 push 一次
              continue;
            }
            if (t.stage !== 'grown') continue;      // 未知 stage 仍保持原兜底
            // grown 树 → 烘树冠（与 _drawTreeEntity grown 段 1475+ 位置/尺寸逐字一致，防错位）；
            // 树冠无 _grassVariation、天然不翻转，不加 flip/雪截断/耕地全裁。
            const baseGrass = this._seasonColorAt().grass;
            const leafColor = this._shade(baseGrass, -30);
            const crownSize = this._treeCrownSize(r, c, cs);   // 与 _drawTreeEntity 同一口径（fr/fc 反推等价于 r/c）
            const canopy = this._canopySprite(leafColor, Math.max(1, Math.round(crownSize)));
            if (canopy) {
              const crownX = c * cs + (cs - crownSize) / 2;
              const trunkH = cs * 0.72;
              // 先烘树干（与 _drawTreeEntity grown 段 1520-1530 逐字一致：trunkW/tx/ty 同式，trunkH 复用本块已声明）；
              // 顺序先树干后树冠，与显示层 1530→1554 同序，并集形状与顺序无关，仅为对照不漂。
              // 包 save/restore：_drawWoodOrFill 贴图缺失时写 a.fillStyle='#6b4a2b'，避免污染后续 drawImage。
              const trunkW = cs * 0.52;
              const tx = c * cs + (cs - trunkW) / 2;
              const ty = r * cs + cs - trunkH - 2;
              a.save();
              this._drawWoodOrFill(a, 'oak_log', tx, ty, trunkW, trunkH);
              a.restore();
              const crownBottom = r * cs + cs - trunkH * 0.45;
              const crownY = crownBottom - crownSize;
              a.save();
              a.imageSmoothingEnabled = false;
              a.globalAlpha = 1;
              a.drawImage(canopy, crownX, crownY, crownSize, crownSize);
              a.restore();
              centroids.push({ x: crownX + crownSize / 2, y: crownY + crownSize / 2 });   // 树冠纳入逐格追光
            }
            continue;   // 树格烘完树冠即走，不画草/花
          }
          gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
          isBare = !!(TreeFarm.bare && TreeFarm.bare[r] && TreeFarm.bare[r][c]);
        } else {
          const cell = Farm.grid[r] && Farm.grid[r][c];
          if (cell && cell.crop) {
            // §1.4 作物描边：植株本体烘进 A（剔除进度条/成熟金线），只描植株避免耕地白框；
            // 与树苗/树冠同口径——中性烘焙（globalAlpha=1、imageSmoothing=false），B 段 destination-out 才擦得净。
            const x = c * cs, y = r * cs;
            a.save();
            a.imageSmoothingEnabled = false;
            a.globalAlpha = 1;
            this._bakeCropBody(a, x, y, cs, cell);
            a.restore();
            centroids.push({ x: x + cs / 2, y: y + cs / 2 });   // 作物格纳入逐格追光，只 push 一次
            continue;
          }
          if (cell) continue;   // 耕地（无作物）→ 不描边
          gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
          isBare = !!(Farm.bare && Farm.bare[r] && Farm.bare[r][c]);
          flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
        }
        if (isBare || ((gstate !== 1 && gstate !== 2) && flower === 0)) continue;
        const x = c * cs, y = r * cs;
        const layer = (gstate === 1) ? layerG : layerD;
        if (flower === 0 && !layer) continue;   // 草格需草层；花格不依赖草层（贴图/纯色兜底）
        a.save();
        // 0.5.50：雪截断 clip：草/花共用，截断面积 = 雪占格面积 × 30%（量化桶，与 veg 层 _drawGrassTopLayer 同公式）
        const b = snowMap ? (snowMap[r + ',' + c] || 0) : 0;
        const szQ = b ? b * qstep : 0;
        const trunc = szQ ? 0.3 * (szQ / cs) * (szQ / cs) : 0;
        if (trunc > 0) { a.beginPath(); a.rect(x, y, cs, cs * (1 - trunc)); a.clip(); }
        if (flower > 0) {
          // 花格：pad=0 占满整格、无随机偏移（ox/oy/scale 不用，仅 flip 与 _drawFlowerCell 同源）；
          // 花不溢出格边，草身「耕地方向全裁」clip 对花无意义，故花分支不加（已 continue 走不到草分支）。
          const fv = this._grassVariation(r, c);   // 取 flip（与 _drawFlowerCell 同一套种子，逐字一致）
          a.imageSmoothingEnabled = false;
          a.globalAlpha = 1;
          if (fv.flip) {
            const fx = x + cs / 2;
            a.translate(fx, 0); a.scale(-1, 1); a.translate(-fx, 0);   // 水平镜像：绕格垂直中线（与 _drawFlowerCell 翻转逐字一致）
          }
          const fkey = this._flowerDef(flower).key;
          if (!ASSETS.draw(a, fkey, x, y, cs, cs, false)) {
            a.fillStyle = '#a9b765';   // 与静态层花兜底同色
            a.fillRect(x, y, cs, cs);
          }
          a.restore();
          centroids.push({ x: x + cs / 2, y: y + cs / 2 });   // 花纳入逐格追光
          continue;
        }
        // 草身「耕地方向全裁」clip：与 _drawGrassTopLayer 草身 clip 完全同步（双写，改一处必改另一处）。只对草有意义。
        if (!treeFarm && Farm.grid) {
          const tR = !!(Farm.grid[r] && Farm.grid[r][c+1]);
          const tL = !!(Farm.grid[r] && Farm.grid[r][c-1]);
          const tB = !!(Farm.grid[r+1] && Farm.grid[r+1][c]);
          const tT = !!(Farm.grid[r-1] && Farm.grid[r-1][c]);
          if (tR || tL || tB || tT) {
            a.beginPath();
            const L = tL ? x : x - cs;
            const R = tR ? x + cs : x + cs * 2;
            const T = tT ? y : y - cs;
            const Bm = tB ? y + cs : y + cs * 2;
            a.rect(L, T, R - L, Bm - T);
            a.clip();
          }
        }
        // 与草身完全同参数变换（_drawGrassTopLayer 逐字复用）：绕格底中心 偏移→旋转→翻转→缩放。
        // flip 与 scale/ox/oy 必须两路径逐字一致，改一处必改另一处（显示层 ui-scene _drawGrassTopLayer 与本源）。
        const v = this._grassVariation(r, c);
        const s = shakeAngle[r + ',' + c] || 0;
        if (s || v.scale !== 1 || v.ox || v.oy || v.flip) {
          const cx = x + cs / 2, cyBottom = y + cs;
          a.translate(cx + v.ox, cyBottom + v.oy);
          a.rotate(s);
          if (v.flip) a.scale(-1, 1);
          a.scale(v.scale, v.scale);
          a.translate(-cx, -cyBottom);
        }
        a.imageSmoothingEnabled = false;
        a.globalAlpha = 1;
        a.drawImage(layer, x, y);
        a.restore();
        centroids.push({ x: x + cs / 2, y: y + cs / 2 });
      }
    }

    // ---- 离屏B：整幅 8 向 1px 外扩并集 → 擦中心 → 染白 → 合并外白轮廓（重叠区只剩外缘一圈） ----
    const B = this._grassOutlineCanvas || (this._grassOutlineCanvas = document.createElement('canvas'));
    if (B.width !== this.canvas.width || B.height !== this.canvas.height) {
      B.width = this.canvas.width; B.height = this.canvas.height;
    }
    const o = B.getContext('2d');
    o.clearRect(0, 0, B.width, B.height);
    o.imageSmoothingEnabled = false;
    const O = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < 8; i++) o.drawImage(A, O[i][0], O[i][1]);
    // B 段擦中心：destination-out 直接叠 A 按比例擦（out = B×(1-A/255)）。
    // 0.4.54 曾在此插入「A 二值化到 A2 再擦」修旧贴图的亮核 halo 白环；0.4.55 换新 acorn_grow
    // （halo 已去除）后二值化收益归零、且把草淡边缘当非实心砍掉（整屏草白 −8.5%、连通块 +159），
    // 净负向 → 0.4.60 摘除，回到直接擦 A。
    o.globalCompositeOperation = 'destination-out';
    o.drawImage(A, 0, 0);
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = '#ffffff';
    o.fillRect(0, 0, B.width, B.height);
    // 耕地格方向全裁：B 生成后擦除每个耕地格整格白像素（8 向外扩的 1px 环会伸进耕地格 1px，
    // 必须全擦不留边线）→ 耕地格内部 + 1px 边线全 0 白像素。
    o.globalCompositeOperation = 'destination-out';
    if (!treeFarm && Farm.grid) {
      for (let r = 0; r < DATA.FARM.ROWS; r++) {
        for (let c = 0; c < DATA.FARM.COLS; c++) {
          const fc = Farm.grid[r] && Farm.grid[r][c];
          if (fc && !fc.crop) o.fillRect(c * cs, r * cs, cs, cs);   // §1.4：作物格保留植株白边，不擦；只擦空耕地
        }
      }
    }
    // 0.5.51：擦掉「有雪草/花格」截断面（草身被雪截掉根部的水平缝）被 B 段 8 向外扩描出的 1px 白带。
    // 保留草尖上/左/右外侧白环，只去横向接缝白线，让雪面那端成干净截断（与 veg 层一致、无双线脱节）。
    // 逐格截断值与 A 段（_drawGrassTopLayer / 描边 A 烘焙）完全同式；只对「草/花且有雪」格擦——
    // 作物/耕地/树冠不截草身，擦了会误伤作物植株白边（§1.4 作物格 L995 守卫不动）。
    if (snowMap) {
      o.globalCompositeOperation = 'destination-out';
      for (let r = 0; r < DATA.FARM.ROWS; r++) {
        for (let c = 0; c < DATA.FARM.COLS; c++) {
          const b = snowMap[r + ',' + c] || 0;
          if (!b) continue;   // 该格无雪 → 无截断白带，跳过
          let gstate, flower = 0;
          if (treeFarm) {
            gstate = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;
          } else {
            gstate = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;
            flower = (Farm.flowers && Farm.flowers[r]) ? (Farm.flowers[r][c] || 0) : 0;
          }
          if ((gstate !== 1 && gstate !== 2) && flower === 0) continue;   // 非草/花格不擦
          const szQ = b * qstep;
          const trunc = 0.3 * (szQ / cs) * (szQ / cs);   // 与 A 段同式（0.5.50 的 30% 规则）
          if (!(trunc > 0)) continue;
          const seamY = r * cs + Math.round(cs * (1 - trunc));
          o.fillRect(c * cs, seamY, cs, 2);   // 擦接缝白带 [seamY, seamY+1] 共 2px（含 1px 抗扩余量）
        }
      }
    }
    o.globalCompositeOperation = 'source-over';

    this._grassOutlineKey = key;
    this._grassRingCropCache = {};   // B 已重建：逐格裁剪子图全部失效
    this._grassOutline = { canvas: B, centroids };
    return this._grassOutline;
  },

  /** 作物描边（§1.4）：把作物「植株本体」烘进离屏 A，复用 _drawCropCell 的 plant 绘制参数（逐字抄），
   *  但剔除进度条/成熟金线 —— 只描植株，避免把耕地描成白框。A 是合并外轮廓源，B 段 destination-out
   *  按 alpha 擦中心，故与树苗同口径：只烘 alpha=1 的植株本体、不烘任何半透明叠加。
   *  绘制参数逐字抄 ui.js _drawCropCell 的 plant 部分（生长中 assetStages 随 progress 由小变大 + 成熟取末帧），
   *  调用方负责 a.save/restore 与 globalAlpha=1 / imageSmoothing=false（与本文件树冠/草身烘焙同一口径）。 */
  _bakeCropBody(a, x, y, cs, cell) {
    const def = DATA.CROPS[cell.crop];
    if (!def) return;
    const isGrown = Farm._isGrown(cell);
    const totalDays = (cell.regrowCount > 0 && def.regrow) ? def.regrowDays : def.growDays;
    const progress = Math.min(cell.grownDays / totalDays, 1);
    if (isGrown) {
      const assetKey = (def.assetStages && def.assetStages.length)
        ? def.assetStages[def.assetStages.length - 1]
        : def.assetHarvest;
      const padC = 4;
      this._drawPaddedAsset(a, assetKey, x, y, cs, padC)
        || this._drawEmojiCrop(a, x, y, cs, def, true);
    } else if (def.assetStages && def.assetStages.length) {
      const stages = def.assetStages;
      const idx = Math.min(stages.length - 1, Math.floor(progress * stages.length));
      const assetKey = stages[idx];
      const sizeFrac = 0.35 + 0.5 * progress;
      const dw = cs * sizeFrac, dh = cs * sizeFrac;
      const dx = x + (cs - dw) / 2, dy = y + (cs - dh) / 2;
      ASSETS.draw(a, assetKey, dx, dy, dw, dh)
        || this._drawEmojiCrop(a, x, y, cs, def, false, progress);
    } else {
      this._drawEmojiCrop(a, x, y, cs, def, false, progress);
    }
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

      const size = this._treeSaplingSize(fr, fc, cs);          // _drawTreeEntity 无 r/c 形参，用已有 fr/fc 反推
      const pad = Math.round((cs - size) / 2);

      const winter = this._isWinter();
      const flip = this._treeSaplingFlip(fr, fc);              // 第四路种子，约 50% 格水平镜像

      // 翻转坐标系：绕格垂直中线水平镜像（与花 _drawFlowerCell:595 同款）。
      // 包住 ASSETS.draw + 兜底 fillRect + frost 段，frost 也在翻转坐标系内（漏了会导致
      // 冬天橡果本体镜像、霜白却正着 → 错位的白边）。frost 自带 save/restore 嵌套在内没问题。
      if (flip) {
        ctx.save();
        const fx = x + cs / 2;
        ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0);
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

      // 注：约束②a 的地面树荫椭圆已上移到 _renderTreeFarmScene 的独立一遍（先于所有树冠画），

      // 否则后画的树会把地荫盖到前排树冠上（用户「阴影透到叶子上面」）。

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

      // 注：A4 约束③（外缘亮边/描边）按用户反馈「太丑了」已移除；靠约束①②④（更深+树荫椭圆+体积暗部+树干连通）做树叶/草地分层

    }

    // 注：树桩(stump)阶段已移除——砍树后 trees[r][c]=null 直接消失，不再渲染桩（用户「树桩去掉」）。

  },



  /** 持续重绘循环：驱动未浇水作物的闪烁动画（标签页隐藏时浏览器自动暂停） */

  // ─────────────────────────────────────────────

  // ⑤ 动画循环 / HUD

  // ─────────────────────────────────────────────


};

Object.assign(UI, _sceneMethods);
