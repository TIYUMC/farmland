/**
 * ui-effects.js — 从 ui.js 拆分
 */

const _effectsMethods = {
  _drawEffects(ctx, dt) {

    if (this._particles) { this._particles.update(dt); this._particles.draw(ctx); }

    if (this._floaters)  { this._floaters.update(dt);  this._floaters.draw(ctx); }

    if (this._shake) this._shake.update(dt);

  },



  /** 视觉下雨：纯画面效果，不影响玩法。雨滴用「水」贴图截取的一段绘制，按天气系统随机下雨。 */


  _spawnRipple(x, y) {

    if (!this._ripples) this._ripples = [];

    if (this._ripples.length >= 60) return;            // 上限，避免同屏过多

    if (Math.random() > 0.6) return;                  // 约 60% 落地才生成涟漪，错落不密集

    // ── 地表判定：草丛/树 上不出涟漪 ──

    const cs = this.cellSize;

    const r = Math.floor(y / cs), c = Math.floor(x / cs);

    if (this.scene === 'treeFarm') {

      if (r >= 0 && r < TreeFarm.ROWS && c >= 0 && c < TreeFarm.COLS) {

        if (TreeFarm.getTreeAt(r, c)) return;         // 树（树干/树冠所在格）接住雨水，无涟漪

        const g = (TreeFarm.grass && TreeFarm.grass[r]) ? (TreeFarm.grass[r][c] || 0) : 0;

        if (g === 1 || g === 2) { if (Math.random() < 0.35) this._shakeGrass(r, c); return; }  // 草丛：被雨打颤，不出涟漪（稀疏触发）

      }

    } else {

      if (r >= 0 && r < Farm.ROWS && c >= 0 && c < Farm.COLS) {

        const g = (Farm.grass && Farm.grass[r]) ? (Farm.grass[r][c] || 0) : 0;

        if (g === 1 || g === 2) { if (Math.random() < 0.35) this._shakeGrass(r, c); return; }  // 草丛：被雨打颤，不出涟漪（主农场已无树，稀疏触发）

      }

    }

    this._ripples.push({ x, y, age: 0, maxAge: 0.5 + Math.random() * 0.25, maxR: 13 + Math.random() * 13 });

  },



  /** 给 (r,c) 草格注册一次「被雨打颤」：叠加一次快速摆动（约 0.5s 淡出）。

   *  雨中草会被持续戳得发颤；无雨时静止。同格已存在则刷新（避免无限叠加）。 */


  _shakeGrass(r, c) {

    if (!this._grassShakes) this._grassShakes = [];

    const maxAmp = 0.035 + Math.random() * 0.025;     // 最大摆角 0.035~0.06 rad（约 2°~3.5°，轻轻一弯）

    const existing = this._grassShakes.find(s => s.r === r && s.c === c);

    if (existing) { existing.age = 0; existing.maxAge = 0.3 + Math.random() * 0.15; existing.amp = maxAmp; return; }

    this._grassShakes.push({ r, c, age: 0, maxAge: 0.3 + Math.random() * 0.15, amp: maxAmp });

  },



  /** 绘制并推进草丛颤动：当前在颤的草格，草层绕格底中心左右摆动（顶部摆、根部不动），随时间淡出。

   *  与 _drawRain 解耦——即使雨停，残留颤动仍会继续淡出（render 每帧调用、不限 isRaining）。 */


  _drawGrassShakes(ctx, dt) {

    if (!this._grassShakes || !this._grassShakes.length) return;

    // 有积雪时懒构建含雪底缓存（雪变则失效，此处重建一次）

    if (this._snowTotal > 0 && !this._shakeSnowBaseCache) this._buildShakeSnowBaseCache();

    const cs = this.cellSize;

    const keep = [];

    const grassSrc = (this.scene === 'treeFarm') ? TreeFarm : Farm;

    const colors = this._seasonColorAt();

    for (const s of this._grassShakes) {

      s.age += dt;

      if (s.age >= s.maxAge) continue;                // 过期移除

      const k = s.age / s.maxAge;                    // 0→1

      const decay = 1 - k;                           // 摆动幅度随寿命衰减

      // 阻尼摆动：小幅左右摆，根部不动、顶部摆（绕格底中心旋转）——作用于「原草层」

      const angle = Math.sin(s.age * 18) * s.amp * decay;

      const x = s.c * cs, y = s.r * cs;

      const gstate = (grassSrc.grass && grassSrc.grass[s.r]) ? (grassSrc.grass[s.r][s.c] || 0) : 0;

      const isBare = !!(grassSrc.bare && grassSrc.bare[s.r] && grassSrc.bare[s.r][s.c]);

      // 贴回预渲染草格底（像素级等价，省去 gblock + 灰度 overlay 两次 drawImage 与一次 composite 切换），

      // 再实时画会摆动的草顶层；草颤结束 age 过期即不再重画，缓存静态草原样复原。

      // 有积雪时改用含雪底缓存（shakeSnowBaseCache），避免无雪底覆盖积雪层。

      const baseCache = (this._snowTotal > 0 && this._shakeSnowBaseCache) ? this._shakeSnowBaseCache : this._grassBaseCache;

      const entry = baseCache && baseCache[s.r + ',' + s.c];

      if (entry) {

        ctx.imageSmoothingEnabled = true;

        ctx.drawImage(entry.cv, x, y);            // 离屏底 = 实时同像素合成结果，1 次 drawImage 替代底土重画

        if (entry.top) this._drawGrassTopLayer(ctx, s.r, s.c, x, y, cs, gstate, colors, angle);

      } else {

        this._drawGrassGroundCell(ctx, s.r, s.c, x, y, cs, gstate, isBare, colors, angle);  // 缓存缺失兜底

      }

      keep.push(s);

    }

    this._grassShakes = keep;

    // 草在静态层本就在「树冠之下」（树冠第二遍覆盖在草上）。实时重画草会盖住相邻格溢出过来的树冠

    // （树冠向左右各溢出约 0.25cs、向上溢出约 0.82 格），导致「草颤时跑到树叶层上面」。

    // 故草颤全部重画后，把每个抖动格的 3×3 邻域内所有树冠再盖回草之上，消除穿帮。

    if (this.scene === 'treeFarm' && TreeFarm.trees && keep.length) {

      const seen = new Set();

      const order = [];

      for (const s of keep) {

        for (let dr = -1; dr <= 1; dr++) {

          for (let dc = -1; dc <= 1; dc++) {

            const rr = s.r + dr, cc = s.c + dc;

            if (rr < 0 || cc < 0 || rr >= DATA.FARM.ROWS || cc >= DATA.FARM.COLS) continue;

            const t = (TreeFarm.trees[rr] && TreeFarm.trees[rr][cc]) || null;

            if (t && !seen.has(rr * 1000 + cc)) { seen.add(rr * 1000 + cc); order.push([rr, cc, t]); }

          }

        }

      }

      order.sort((a, b) => a[0] - b[0]);  // 由下而上重画，保持树冠叠放顺序与缓存一致

      for (const [rr, cc, t] of order) this._drawTreeEntity(ctx, cc * cs, rr * cs, cs, t);

    }

  },



  /** 绘制并推进雨滴落地涟漪：扩散的椭圆环（顶视压扁）+ 水贴图淡填充，随时间淡出。

   *  与 _drawRain 解耦——即使雨停，残留涟漪仍会继续淡出（render 每帧调用、不限 isRaining）。 */


  _drawRipples(ctx, dt) {

    if (!this._ripples || !this._ripples.length) return;

    const spr = this._rainSprite;

    const keep = [];

    for (const r of this._ripples) {

      r.age += dt;

      if (r.age >= r.maxAge) continue;                // 过期移除

      const k = r.age / r.maxAge;                     // 0→1

      const rad = r.maxR * k;

      const ry = rad * 0.42;                          // 顶视：纵向压扁

      const alpha = (1 - k) * 0.55;

      if (spr) {                                       // 水贴图淡填充：用 setTransform 直接拼「平移+缩放」绝对矩阵，省去 save/translate/scale/restore 四次状态栈操作（视觉一致）；叠加震动偏移

        ctx.globalAlpha = alpha * 0.5;

        ctx.setTransform(rad / (spr.width / 2), 0, 0, ry / (spr.height / 2), r.x + this._shakeX, r.y + this._shakeY);

        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);

      }

      ctx.save();                                      // 扩散水蓝环（仅隔离 state，留 1 次 save/restore）

      ctx.globalAlpha = alpha;

      ctx.strokeStyle = 'rgba(150,170,205,1)';

      ctx.lineWidth = Math.max(1, 2.2 * (1 - k));

      ctx.setTransform(1, 0, 0, 1, this._shakeX, this._shakeY);  // 抵消上方绝对矩阵，叠加震动偏移

      ctx.beginPath();

      ctx.ellipse(r.x, r.y, rad, ry, 0, 0, Math.PI * 2);

      ctx.stroke();

      ctx.restore();

      keep.push(r);

    }

    this._ripples = keep;

    // 复位变换/透明度到外层 render 的「震动平移 + globalAlpha=1」基线（原 save/restore 平衡态），供后续 HUD 沿用

    ctx.setTransform(1, 0, 0, 1, this._shakeX, this._shakeY);

    ctx.globalAlpha = 1;

  },



  // ───────────────────────── 秋日落叶系统 ─────────────────────────

  /** 当前是否秋季：落叶只在秋季出现（season 0春/1夏/2秋/3冬）。 */


  _spawnBurst(row, col, opts) {

    if (!this._particles) return;

    const cs = this.cellSize;

    this._particles.spawn(col * cs + cs / 2, row * cs + cs / 2, opts);

  },



  /** 在指定格子上方漂浮一行文字（如 +3 小麦 / 木头×4） */


  _floatText(row, col, text, opts) {

    if (!this._floaters) return;

    const cs = this.cellSize;

    this._floaters.spawn(col * cs + cs / 2, row * cs + cs * 0.32, text, opts);

  },



  /** 触发一次轻微屏幕震动（mag 像素 / dur 毫秒） */


  _shakeIt(mag, dur) { if (this._shake) this._shake.add(mag, dur); },



  /** 标记农场静态层已过期，下次 render 时重建缓存 */


};

Object.assign(UI, _effectsMethods);
