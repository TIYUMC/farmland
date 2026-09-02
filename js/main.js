/**
 * main.js — 主入口
 * 初始化、启动循环、模块连接
 */
(function () {
  'use strict';

  /** 初始化游戏 */
  async function init() {
    // 先加载像素贴图
    await ASSETS.preload();

    Farm.init();
    TreeFarm.init(); // 树场（独立子场景）初始化：随机预置树
    Player.init();
    UI.init();

    // 用真实贴图替换工具栏 emoji 图标
    console.log('[init] 开始设置工具栏图标...');
    console.log('[init] ASSETS.registry 大小:', Object.keys(ASSETS.registry).length);
    console.log('[init] chest 在 registry 中:', 'chest' in ASSETS.registry);
    _setToolbarIcons();
    console.log('[init] 工具栏图标设置完成');
    UI._renderBottomHotbar();


    // 连接引擎回调
    Engine.onHourChange = (hour, minute) => {
      UI.render();
    };

    // 积雪等按「游戏刻」推进（与渲染帧率无关）：每游戏分钟 1 刻
    Engine.onTick = () => {
      if (typeof UI !== 'undefined' && UI._tickSnow) UI._tickSnow();
    };

    // 每分钟刷新 HUD 时钟，并缓慢恢复体力
    Engine.onMinuteChange = (hour, minute) => {
      Player.regenStamina(DATA.STAMINA_REGEN_PER_MIN);
      UI._updateHUD();
    };

    Engine.onNewDay = (day, season, year) => {
      // 先标记脏格，确保下一帧渲染时重建缓存（季节变化、落叶堆更新都需要）
      UI.markFarmDirty();
      // 结算（继续按钮）已处理了农活更新，这里只需渲染
      UI.render();
      // 跨天若仍下雨，重新浇灌（Farm.resetWater 已清空当日 watered），让作物次日继续靠雨水生长；冬天是雪不浇
      if (typeof UI !== 'undefined' && UI.isRaining && UI._rainWaterFields && typeof UI._isWinter === 'function' && !UI._isWinter()) UI._rainWaterFields();
      // 跨天推进秋日落叶：每树3%概率、每天≤2格、总计≤10格（非秋季自动清空）
      if (typeof UI !== 'undefined' && UI._spawnDailyLitter) UI._spawnDailyLitter();
    };

    // 一天结束（午夜24:00）：自动存档
    Engine.onDayEnd = () => {
      SaveGame.save();
      UI.showFullSummary();
    };

    // 开始首日
    Engine.start();
    UI.render();
    _showTitle();

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      // 商店打开时：方向键选交易、S/Esc 关闭，屏蔽其它游戏快捷键
      if (UI._shopOpen) {
        if (e.key === 'ArrowDown') { UI._changeShopSel(1); e.preventDefault(); return; }
        if (e.key === 'ArrowUp')   { UI._changeShopSel(-1); e.preventDefault(); return; }
        if (e.key === 's' || e.key === 'S') { UI.closeShop(); return; }
        if (e.key === 'Escape') return; // 由 UI 的 keydown 监听统一处理
        return;
      }
      switch (e.key) {
        case '1': _selectTool('hoe'); break;
        case '2': _selectTool('water'); break;
        case '3': _selectTool('axe'); break;
        case 'b':
        case 'B':
          if (UI._shopOpen) UI.closeShop();
          else if (UI._inventoryOpen) UI.closeInventory();
          else UI.openInventory();
          break;
        case 's':
        case 'S': UI.openShop(); break;
        case 'z':
        case 'Z': Engine.sleep(); break; // B4 修复：z 键主动睡觉（立即结算并进入第二天）
        case 't':
        case 'T': _toggleTreeFarm(); break; // 主农场 ↔ 树场 切换
      }
    });

    // 背包按钮快捷
    _addInventoryButton();
    // 商店按钮：开关村民商店（S 键开；商店开着时 B 键关；点面板外或 Esc 亦可关）
    document.getElementById('btn-shop').addEventListener('click', () => {
      if (UI._shopOpen) UI.closeShop(); else UI.openShop();
    });

    // 存档按钮：立即保存（带闪光效果）
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.addEventListener('click', () => { SaveGame.save(); _flashSave(); });

    // 调试快进按钮（HUD 顶栏）：开启后 0.5 秒 = 1 天，方便快速测试作物生长/时间流逝
    const invDebug = document.getElementById('btn-inv-debug');
    if (invDebug) invDebug.addEventListener('click', () => {
      const on = !Engine.debugFast;
      Engine.setDebugFast(on);
      invDebug.classList.toggle('debug-on', on);
      if (on && typeof UI.closeSummary === 'function') UI.closeSummary();
      UI.showStatus(on ? '⚡ 调试快进：0.5 秒 = 1 天' : '调试快进已关闭', 1200);
    });
    // 调试·跳季下拉（底部）：直接跳到指定季节的第 1 天
    const seasonJump = document.getElementById('season-jump');
    if (seasonJump) {
      seasonJump.addEventListener('change', () => {
        const v = parseInt(seasonJump.value, 10);
        if (isNaN(v) || v < 0 || v > 3) return;
        _jumpToSeason(v);
      });
    }
    // 任务书入口：底部工具栏紫色书按钮（商店右边），点开/关任务书
    const questBtn = document.getElementById('btn-quest');
    if (questBtn) questBtn.addEventListener('click', () => UI.openQuest());

    // 标题界面按钮绑定
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) btnNewGame.addEventListener('click', _startNewGame);
    const btnContinue = document.getElementById('btn-continue');
    if (btnContinue) btnContinue.addEventListener('click', _continueGame);
    // 添加切换动画
    _addTitleTransition();
  }

  // ===== 标题界面控制 =====
  var _titleParticleRAF = null;
  var _titleParticleSystem = null;
  var _titleCanvas = null;
  var _titleCtx = null;

  function _startTitleParticles() {
    console.log('[title] start particles check: UI=', typeof UI, 'Juice=', typeof Juice);
    if (!UI || !UI.init || typeof Juice === 'undefined') {
      console.warn('[title] missing dependencies');
      return;
    }
    var el = document.getElementById('title-particles');
    console.log('[title] canvas element:', el);
    if (!el) return;
    if (_titleParticleRAF) { cancelAnimationFrame(_titleParticleRAF); _titleParticleRAF = null; }
    _titleCanvas = el;
    _titleCanvas.width = window.innerWidth;
    _titleCanvas.height = window.innerHeight;
    _titleCtx = _titleCanvas.getContext('2d');
    console.log('[title] canvas size:', _titleCanvas.width, 'x', _titleCanvas.height);
    _titleParticleSystem = new Juice.ParticleSystem();
    console.log('[title] particle system created');
    var lastSpawnTime = 0;
    var isHidden = false;
    // 页面不可见时暂停动画
    document.addEventListener('visibilitychange', function() {
      isHidden = document.hidden;
      if (isHidden && _titleParticleRAF) {
        cancelAnimationFrame(_titleParticleRAF);
        _titleParticleRAF = null;
      }
    });
    function spawnLoop(ts) {
      if (!_titleParticleSystem || isHidden) return;
      if (ts - lastSpawnTime < 400) return; // 每400ms生成一次
      lastSpawnTime = ts;
      // 在整个canvas宽度范围内随机分布，高度在标题内容区域
      var cx = Math.random() * _titleCanvas.width;
      var cy = _titleCanvas.height * 0.5 + Math.random() * _titleCanvas.height * 0.3;
      _titleParticleSystem.spawn(cx, cy, {
        imgKeys: ['generic_0','generic_1','generic_2','generic_3','generic_4','generic_5','generic_6','generic_7'],
        imgSize: 12,
        count: 2, speed: 50, gravity: -25, spread: Math.PI * 1.8, spawnRadius: 15,
      });
    }
    var lastTime = performance.now();
    function loop(ts) {
      var dt = Math.min((ts - lastTime) / 1000, 0.05);
      lastTime = ts;
      _titleCtx.clearRect(0, 0, _titleCanvas.width, _titleCanvas.height);
      if (_titleParticleSystem) {
        spawnLoop(ts);
        _titleParticleSystem.update(dt);
        _titleParticleSystem.draw(_titleCtx);
      }
      // 调试：显示canvas尺寸
      // console.log('[title] canvas size:', _titleCanvas.width, 'x', _titleCanvas.height, 'particles:', _titleParticleSystem.list.length);
      _titleParticleRAF = requestAnimationFrame(loop);
    }
    _titleParticleRAF = requestAnimationFrame(loop);
  }

  function _stopTitleParticles() {
    if (_titleParticleRAF) { cancelAnimationFrame(_titleParticleRAF); _titleParticleRAF = null; }
    _titleParticleSystem = null;
    _titleCanvas = null;
    _titleCtx = null;
  }

  function _showTitle() {
    var ts = document.getElementById('title-screen');
    if (!ts) return;
    var has = typeof SaveGame !== 'undefined' && SaveGame.hasSave();
    var contBtn = document.getElementById('btn-continue');
    if (contBtn) contBtn.style.display = has ? '' : 'none';
    ts.className = 'overlay-visible';
    _animateTitleLetters();
    _animateButtonsIn();
    _startTitleParticles();
  }

  /** 标题字母逐个弹出（MC 风格） */
  function _animateTitleLetters() {
    var logo = document.getElementById('title-logo');
    if (!logo) return;
    var text = logo.textContent;
    logo.innerHTML = '';
    for (var i = 0; i < text.length; i++) {
      var span = document.createElement('span');
      span.className = 'title-letter' + (text[i] === ' ' ? ' space' : '');
      span.textContent = text[i] === ' ' ? '\u00A0' : text[i];
      span.style.animationDelay = (i * 0.07) + 's';
      logo.appendChild(span);
    }
  }

  /** 按钮弹性入场（错开延迟） */
  function _animateButtonsIn() {
    var btns = document.querySelectorAll('.mc-btn');
    btns.forEach(function(btn, i) {
      btn.classList.remove('btn-in');
      void btn.offsetWidth; // 触发重排
      btn.style.animationDelay = (0.6 + i * 0.12) + 's';
      btn.classList.add('btn-in');
    });
  }

  /** 浮尘粒子效果 */
  function _spawnParticles(count) {
    var container = document.getElementById('title-content');
    if (!container) return;
    // 清除旧粒子
    var old = container.querySelectorAll('.particle');
    old.forEach(function(p) { p.remove(); });
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'particle';
      p.style.left = (15 + Math.random() * 70) + '%';
      p.style.top = (40 + Math.random() * 40) + '%';
      p.style.animationDelay = (Math.random() * 3) + 's';
      p.style.animationDuration = (3 + Math.random() * 2) + 's';
      p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
      container.appendChild(p);
    }
    // 定时清理
    setTimeout(function() {
      var ps = container.querySelectorAll('.particle');
      ps.forEach(function(p) { p.remove(); });
    }, 6000);
  }

  /** 存档/读档闪光效果 */
  function _flashSave() {
    var el = document.createElement('div');
    el.className = 'save-flash';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 700);
  }

  var _titleTransitionOut = null;

  function _addTitleTransition() {
    var ts = document.getElementById('title-screen');
    if (!ts) return;
    ts.style.transition = 'opacity 0.5s ease-in';
    _titleTransitionOut = function(cb) {
      ts.style.opacity = '0';
      setTimeout(function() {
        ts.style.opacity = '';
        ts.style.transition = '';
        if (cb) cb();
      }, 500);
    };
  }

  function _hideTitle() {
    var ts = document.getElementById('title-screen');
    if (ts) ts.className = 'overlay-hidden';
    _stopTitleParticles();
  }
  function _startNewGame() {
    _titleTransitionOut(function() {
      _hideTitle();
      Farm.init();
      TreeFarm.init();
      Player.init();
      Engine.start();
      UI.render();
      UI._renderBottomHotbar();
    });
  }
  function _continueGame() {
    if (!SaveGame.hasSave()) return;
    _titleTransitionOut(function() {
      _hideTitle();
      SaveGame.load();
      UI._renderBottomHotbar();
    });
  }

  /**
   * 用 ASSETS.registry 中的真实 base64 贴图替换工具栏里的 emoji 图标。
   */
  function _setToolbarIcons() {
    _setBtnIcon('btn-shop',     'shop');
    _setBtnIcon('btn-inv-debug','command_block');
    _setBtnIcon('btn-quest',    'book_purple');
    _setBtnIcon('btn-save',     'chest');
    _setHudIcon('hud-ico-stamina', 'food_full');
    _setHudIcon('hud-ico-time',    'time');
  }

  function _setIconInner(el, assetKey, alt, cls) {
    if (!el) { console.warn('_setIconInner: el is null'); return false; }
    if (!ASSETS.registry[assetKey]) { console.warn(`_setIconInner: ${assetKey} not in registry`); return false; }
    const clsAttr = cls ? ` class="${cls}"` : '';
    el.innerHTML = `<img src="${ASSETS.registry[assetKey]}" alt="${alt}"${clsAttr}>`;
    console.log(`_setIconInner: ${assetKey} → ${el.tagName}.${el.className}`);
    return true;
  }

  function _setBtnIcon(btnId, assetKey) {
    const btn = document.getElementById(btnId);
    if (!btn) { console.warn(`_setBtnIcon: btn ${btnId} not found`); return; }
    const iconEl = btn.querySelector('.tool-icon');
    if (!iconEl) { console.warn(`_setBtnIcon: iconEl not found in ${btnId}`); return; }
    console.log(`_setBtnIcon: ${btnId} → ${assetKey}`, ASSETS.registry[assetKey] ? 'OK' : 'MISSING');
    _swapIcon(iconEl, assetKey, btnId);
  }

  /** 把指定 id 的 hud-label span 内部内容替换成贴图（无 class） */
  function _setHudIcon(hudId, assetKey) {
    const el = document.getElementById(hudId);
    _setIconInner(el, assetKey, hudId, '');
  }

  function _selectTool(toolId) {
    const btn = document.querySelector(`.tool-btn[data-tool="${toolId}"]`);
    if (btn) { btn.click(); return; }
    if (toolId === 'hoe' || toolId === 'water' || toolId === 'axe') {
      if (toolId === 'axe' && (!Player.ownedTools || !Player.ownedTools.axe)) {
        UI.showStatus('先去商店 (B) 买把木斧头再砍树', 1500);
        return;
      }
      Player.selectTool(toolId);
      if (typeof UI !== 'undefined' && UI._updateHeldSlot) UI._updateHeldSlot();
      const names = { hoe: '锄头', water: '水桶', axe: '斧头' };
      UI.showStatus(`选择工具：${names[toolId]}`, 800);
    }
  }

  /** 调试：直接跳到指定季节的第 1 天（不模拟逐日流逝，仅重置季节/日期并刷新画面与积雪状态）。 */
  function _jumpToSeason(season) {
    Engine.season = season;
    Engine.day = 1;
    Engine._resetClock();
    if (typeof UI !== 'undefined') {
      UI.markFarmDirty();
      if (typeof UI._tickSnow === 'function') UI._tickSnow();
      if (typeof UI._updateHUD === 'function') UI._updateHUD();
    }
    const names = ['春', '夏', '秋', '冬'];
    if (typeof UI !== 'undefined' && UI.showStatus) UI.showStatus(`⚡ 跳到 ${names[season]}季 · 第1天`, 1200);
  }

  function _addInventoryButton() {
    const toolbar = document.getElementById('toolbar');
    const anchor = document.getElementById('btn-shop');
    const invBtn = document.createElement('div');
    invBtn.className = 'tool-btn';
    invBtn.id = 'btn-inventory';
    invBtn.innerHTML = '<div class="tool-icon">🎒</div><div class="tool-name">背包</div>';
    invBtn.addEventListener('click', () => UI.openInventory());
    anchor.parentNode.insertBefore(invBtn, anchor);
    const iconEl = invBtn.querySelector('.tool-icon');
    if (iconEl) _setIconInner(iconEl, 'bundle_filled', '背包', 'tool-icon-img');
  }

  /** 主农场 ↔ 树场 切换（快捷键 T 共用；工具栏的树场按钮已移除，导航改由画布左上角箭头承担）。 */
  function _toggleTreeFarm() {
    if (typeof UI === 'undefined' || !UI.toggleScene) return;
    UI.toggleScene();
  }

  /** 把图标换成贴图，同时保留原本在 .tool-icon 内的 .tool-badge（如种子价格标签） */
  function _swapIcon(iconEl, assetKey, alt) {
    const badge = iconEl.querySelector('.tool-badge');
    if (!_setIconInner(iconEl, assetKey, alt, 'tool-icon-img')) return;
    if (badge) iconEl.appendChild(badge);
  }

  // 暴露到全局，供 HTML onclick 使用
  window._startNewGame = _startNewGame;
  window._continueGame = _continueGame;

  // 启动
  window.addEventListener('DOMContentLoaded', init);
})();
