/**
* ui-inventory-view.js — 背包视图：工具栏 HUD / 导航按钮 / 图标 URL / 结算弹窗
* 职责：HUD 与工具栏刷新、切场导航 DOM 按钮、作物图标/贴图 URL、每日结算弹窗显隐。
* 生效/影子：无白名单影子；renderInventory / _renderBottomHotbar / _seedIconKey / _updateGhost 不在本件、在 inventory.js。
* 方法清单：
*   - _updateHUD
*   - _onToolClick
*   - _updateHeldSlot
*   - _drawEmojiCrop
*   - _seedIdFromTool
*   - _cropDefExtra
*   - _assetURL
*   - _iconHTML
*   - _rewardText
*   - _tintedGrassURL
*   - _grassIconHTML
*   - showFullSummary
*   - closeSummary
*   - _hitRect
*   - _updateNavBtn
*   - _navBtnClick
*   - _navLockedNudge
*/

Object.assign(UI, {
  _hitRect(px, py, rect) {

    return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;

  },






 /** 切场导航按钮 DOM 刷新：位置/贴图/锁定态全由 JS 管，一个元素走天下。
   *  农场→按钮在 canvas 左缘外（arrow_right，去树场）；树场→右缘外（arrow_left，回农场）。
   *  宽屏留白足时贴 canvas 外侧 6px；窄屏留白不足回退 4px 压边兜底。幂等：状态不变 return，render 每帧调也不抖 DOM。 */

  _updateNavBtn() {

    const btn = document.getElementById('nav-scene-btn');

    if (!btn) return;

    const treeFarmUnlock = (typeof DATA !== 'undefined' && DATA.TREEFARM && DATA.TREEFARM.unlockOn);
    const isDebug = typeof Engine !== 'undefined' && Engine.debugFast;
    const questNotDone = treeFarmUnlock && typeof Quest !== 'undefined' && !Quest.isDone(treeFarmUnlock);
    const locked = this.scene === 'farm' && questNotDone && !isDebug;

    const ga = btn.parentElement;
    const cl = this.canvas.offsetLeft;
    const cr = cl + this.canvas.offsetWidth;
    // 按钮宽度按真实 DOM 读（CSS 按贴图宽高比变窄后不再是固定 56），先解 display 再读 offsetWidth
    btn.style.display = '';
    const bw = btn.offsetWidth || 56;
    let left;
    if (this.scene === 'farm') left = Math.max(4, cl - bw - 6);
    else left = Math.min(ga.clientWidth - (bw + 4), cr + 6);

    const key = this.scene + '|' + locked + '|' + Math.round(left);
    if (this._navBtnLast === key) return;
    this._navBtnLast = key;

    btn.style.left = left + 'px';

    // 方向映射回旧版语义（git 1b126f2 _drawNavArrow 2878 行）——farm 场景按钮在左、显示 ←（arrow_left）；
    // treeFarm 场景按钮在右、显示 →（arrow_right）。 误写成 farm→arrow_right，本条改回。
    const mainImg = btn.querySelector('img');
    if (mainImg && (typeof ASSETS !== 'undefined') && ASSETS.get) {
      const img = ASSETS.get(this.scene === 'farm' ? 'arrow_left' : 'arrow_right');
      if (img && mainImg.src !== img.src) mainImg.src = img.src;
    }

    let lockEl = btn.querySelector('.nav-lock');
    if (locked) {
      if (!lockEl) {
        lockEl = document.createElement('img');
        lockEl.className = 'nav-lock';
        lockEl.alt = '';
        btn.appendChild(lockEl);
      }
      const lockImg = (typeof ASSETS !== 'undefined' && ASSETS.get) ? ASSETS.get('Icon_Locked') : null;
      if (lockImg) lockEl.src = lockImg.src;
    } else if (lockEl) {
      lockEl.remove();
    }

  },


 /** DOM 导航按钮点击：锁定 → nudge；未锁定 → 切场景 */

  _navBtnClick() {

    const treeFarmUnlock = (typeof DATA !== 'undefined' && DATA.TREEFARM && DATA.TREEFARM.unlockOn);
    const isDebug = typeof Engine !== 'undefined' && Engine.debugFast;

    if (this.scene === 'farm' && treeFarmUnlock && typeof Quest !== 'undefined' && !Quest.isDone(treeFarmUnlock) && !isDebug) {

      this._navLockedNudge();

      return;

    }

    this.toggleScene();

  },


  /** 锁定提示：抖动画布 + 提示应完成任务（文案公式照抄旧 canvas 箭头点击） */

  _navLockedNudge() {

    const unlockQuest = DATA.TREEFARM && DATA.TREEFARM.unlockOn;

    if (unlockQuest && typeof Quest !== 'undefined' && !Quest.isDone(unlockQuest)) {

      const quests = (typeof DATA !== 'undefined' && DATA.QUESTS) || [];

      const q = quests.find(x => x.id === unlockQuest);

      const questTitle = q?.title || '林间初探';

      this._shakeCanvas(`树场还未解锁，请完成任务「${questTitle}」`, 3000);

    }

  },



  /** 保证静态农场层离屏画布为最新；过期则重建 */

  _updateHUD() {

    if (!this._hudCache) this._hudCache = { dt: null, sta: null, money: null, pct: null, bg: null };

    const c = this._hudCache;

    const dt = Engine.getDateString() + ' ' + Engine.getTimeString();

    if (dt !== c.dt) { const el = document.getElementById('hud-datetime'); if (el) { el.textContent = dt; c.dt = dt; } }



    const shownStamina = Math.round(Player.stamina);

    const pct = (shownStamina / Player.maxStamina) * 100;

    const sta = `${shownStamina}/${Player.maxStamina}`;

    const money = Player.money;

    const bg = pct < 30 ? '#e0524f' : '';   // B5：体力 <30% 变红

    if (sta !== c.sta) { const el = document.getElementById('hud-stamina'); if (el) { el.textContent = sta; c.sta = sta; } }

    if (pct !== c.pct || bg !== c.bg) {

      const fill = document.getElementById('stamina-bar-fill');

      if (fill) {

        fill.style.width = `${pct}%`;

        fill.style.background = bg;

        c.pct = pct; c.bg = bg;

      }

    }

  },



  /** 工具栏点击 */

  // ─────────────────────────────────────────────

  // ⑥ 工具栏（原「手持槽」区块已移除，见 _updateHeldSlot）

  // ─────────────────────────────────────────────

  _onToolClick(btn) {

    const tool = btn.dataset.tool;

    if (!tool) return;

    if (this._busy) return; // 正在干活中，期间不能切换工具



    // 当前选中的工具由「底部快捷栏」高亮体现，工具栏按钮本身不再加选中边框，

    // 避免同时出现两个高亮框（快捷栏 + 工具按钮）。



    // 处理种子选择

    const seedId = this._seedIdFromTool(tool);

    if (seedId) {

      Player.selectTool(`seed-${seedId}`);

      this.showStatus(`选择种子：${DATA.CROPS[seedId].name}`, 1000);

    } else {

      Player.selectTool(tool);

      const names = { hoe: '锄头', water: '水桶', axe: '斧头', acorn: '橡果' };

      this.showStatus(`选择工具：${names[tool] || tool}`, 800);

    }

    this._updateHeldSlot();

    // 背包开着时同步快捷栏选中高亮（工具栏按钮直接装备也联动高亮）

    if (this._invSyncSelToTool) this._invSyncSelToTool();

    if (this._inventoryOpen) this.renderInventory();

  },



  /** 原「刷新底部『手中物品』显示」——手持槽已移除，选中态改由底部快捷栏高亮表达。
      本方法为空实现，但仍被 9 处调用（inventory.js / shop.js / ui.js / main.js），
      保留空壳以免每处调用点都要判空。 */

  _updateHeldSlot() {},



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

    ctx.font = `${size}px "VT323", monospace`;

    this._setTextCenter(ctx);

    ctx.fillText(icon, x + cs / 2, y + cs / 2);

  },



  // ─────────────────────────────────────────────

  // ⑦ 画布输入（鼠标悬停）

  // ─────────────────────────────────────────────

  _seedIdFromTool(tool) {

    return tool.startsWith('seed-') ? tool.replace('seed-', '') : null;

  },



  /** 收获/收割时取作物定义 + 额外掉落后缀（收割成功分支与收获回调两处共用，消除重复的 CROPS 查表 + extra 拼接） */

  _cropDefExtra(res) {

    return {

      def: DATA.CROPS[res.cropId],

      extra: res.count > 1 ? ' (+额外掉落!)' : ''

    };

  },



  _assetURL(key) {

    return (typeof ASSETS !== 'undefined' && ASSETS.registry && ASSETS.registry[key]) || '';

  },



  _iconHTML(key, cls, alt) {

    const src = this._assetURL(key);

    return src ? `<img class="${cls}" src="${src}" alt="${alt}">` : '';

  },



  /** 把奖励结构渲染成中文摘要（无 emoji；money/物品均用文字） */

  _rewardText(reward) {

    if (!reward) return '';

    const parts = [];

    if (reward.money) parts.push(`金锭 ×${reward.money}`);

    if (reward.items) {

      const LABEL = {

        'money': '金锭', 'wood': '木头', 'planks': '木板', 'acorns': '橡果',

        'axe': '木斧头', 'hoe': '锄头', 'water': '水桶',
        'seed:wheat': '小麦种子', 'seed:potato': '土豆种子', 'seed:strawberry': '甜浆果种子',

        'crop:wheat': '小麦', 'crop:potato': '土豆', 'crop:strawberry': '甜浆果',

      };

      for (const it of reward.items) {

        const lbl = LABEL[it.id] || it.id;

        parts.push(`${lbl} ×${it.count}`);

      }

    }

    return parts.join('，');

  },



  /**

   * 绿草(short_grass)按「季节草色 +30 明度」染色的 dataURL；拿不到染色就回退 short_grass 原图。

   * showStatus 的 🌿 角标与地里被清除的绿草图标都走这一处，保证视觉一致、逻辑唯一。

   */

  _tintedGrassURL() {

    if (typeof ASSETS !== 'undefined' && ASSETS.getTinted) {

      const tinted = ASSETS.getTinted('short_grass', this._seasonGrass(30));

      if (tinted) { try { return tinted.toDataURL(); } catch (e) { /* 染色失败 → 回退原图 */ } }

    }

    return this._assetURL('short_grass');

  },



  /**

   * 状态提示用的「草」图标：与被清除的草类型一致。

   * - 绿草(gstate===1)：季节草色 +30 明度染 short_grass（与地图绿草一致）

   * - 枯草(gstate===2)：直接用已上色 short_dry_grass（与地图黄草一致）

   * 返回可直接塞进 showStatus(msg) 的 <img> 片段；拿不到贴图时返回空串。

   */

  _grassIconHTML(gstate) {

    const src = (gstate === 2)

      ? this._assetURL('short_dry_grass')

      : this._tintedGrassURL();

    return src ? `<img class="status-hoe" src="${src}" alt="草">` : '';

  },



  /** 显示每日结算 — 纯展示浮层，不阻塞操作、时间继续走 */

  // ─────────────────────────────────────────────

  // ⑫ 每日结算

  // ─────────────────────────────────────────────

  showFullSummary() {

    const overlay = document.getElementById('day-summary');
    if (!overlay) return;

    const content = document.getElementById('summary-content');
    if (!content) return;

    content.innerHTML = '';



    const dayStr = Engine.getDateString();



    let html = `<div class="summary-row" style="color:var(--accent);font-weight:bold;">${dayStr} · 结束</div>`;



    html += `<div class="summary-row"><span>体力</span><span>${Math.round(Player.stamina)} / ${Player.maxStamina}</span></div>`;



    const invCount = Player.getInventoryCount();

    const sellValue = Player.getInventorySellValue();

    html += `<div class="summary-row"><span>${this._iconHTML('小麦', 'icon-sm', '待售') || '🌾'} 待售</span><span>${invCount}件 (${sellValue})</span></div>`;



    const tillCount = Farm.getTilledEmptyCount();

    const plantCount = Farm.grid.flat().filter(c => c && c.crop).length;

    html += `<div class="summary-row"><span>${this._iconHTML('wheat_seeds', 'icon-sm', '种子') || '🌱'} 已种</span><span>${plantCount}</span></div>`;

    html += `<div class="summary-row"><span>${this._iconHTML('farmland_dry', 'icon-sm', '空耕地') || '🟫'} 空耕地</span><span>${tillCount}</span></div>`;



    const harvestReady = Farm.getHarvestableCount();

    html += `<div class="summary-row" style="color:var(--accent);"><span>${this._iconHTML('nether_star', 'icon-sm', '可收') || '✨'} 可收</span><span>${harvestReady}</span></div>`;



    const moneyIcon = this._iconHTML('money', 'icon-sm', '金币') || '💰';

    html += `<div class="summary-total"><span>${moneyIcon}</span><span>${Player.money}</span></div>`;



    content.innerHTML = html;



    // 标题用月亮贴图（🌙 → moon），关闭按钮仍用 Confirm 图标

    const confirmHtml = this._iconHTML('confirm', 'icon-sm', '确认');

    const moonHtml = this._iconHTML('moon', 'icon-title', '月亮');

    const header = document.getElementById('summary-header');

    if (header) header.innerHTML = moonHtml ? moonHtml + ' 一天结束' : '🌙 一天结束';



    // 日结推进（作物生长 / 重置浇水 / 恢复体力 / 进入下一天）已由引擎在

    // _endDay → nextDay 中自动完成，且时间已在新的一天继续流逝。

    // 此处结算面板仅为“纯展示浮层”：几秒后自动淡出，“继续/跳过”按钮仅用于提前收起。

    const nextBtn = document.getElementById('summary-next');
    if (nextBtn) {
      nextBtn.innerHTML = confirmHtml ? confirmHtml + ' 关闭' : '关闭';
      nextBtn.onclick = () => this.closeSummary();
    }



    if (this._summaryTimer) clearTimeout(this._summaryTimer);

    this._summaryTimer = setTimeout(() => this.closeSummary(), 4000);



    overlay.className = 'panel-visible';

  },



  closeSummary() {

    const overlay = document.getElementById('day-summary');

    if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }

    overlay.className = 'panel-hidden';

  },





  // ===== 任务书（Advancement / 进度树）=====
  // 任务书逻辑已从 ui.js 拆分到 ui-quest.js，此处不再重复定义。
  // 如需查看，请查阅 js/ui-quest.js。



});
