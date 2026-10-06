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
    _setToolbarIcons();
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

    // 关页面前静默自动存盘（第三条存档路，与午夜结算/手动存档并存）：
    // 只挂一次，开局与继续共用——_startNewGame/_continueGame 会重建游戏状态，
    // 在两段按钮绑定前注册可保证 handler 读到的始终是最新状态。
    // iOS Safari 关页走 pagehide 不走 beforeunload，两个事件挂同一 handler。
    // 防覆写闸：标题界面（未进游戏）关页不存盘，避免用当天初始态覆写已有存档。
    // 判据说明：全仓无 Engine.stop() 调用点（引擎从顶层 init 起恒 running），
    // 故不用 Engine.running，改用标题 DOM 的 overlay-visible 类（_showTitle 置、_hideTitle 撤）。
    // 刻意不 preventDefault/returnValue：静默存完即走，不弹浏览器原生「离开站点？」框。
    const _saveOnHide = function () {
      if (typeof SaveGame === 'undefined' || !SaveGame.save) return;
      var ts = document.getElementById('title-screen');
      var onTitle = !!ts && ts.classList && ts.classList.contains('overlay-visible');
      if (onTitle) return;   // 标题界面：未进游戏，不覆写存档
      SaveGame.save();
    };
    window.addEventListener('pagehide', _saveOnHide);
    window.addEventListener('beforeunload', _saveOnHide);

    // 开始首日
    Engine.start();
    UI.render();
    _showTitle();

    // 背包按钮快捷
    _addInventoryButton();
    // 商店按钮：开关村民商店；点面板外或点击其他区域亦可关闭
    const btnShop = document.getElementById('btn-shop');
    if (btnShop) btnShop.addEventListener('click', () => {
      if (UI._shopOpen) UI.closeShop(); else UI.openShop();
    });

    // 存档按钮：立即保存（带闪光效果）
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.addEventListener('click', () => { SaveGame.save(); _flashSave(); });

    // 调试模式按钮（HUD 顶栏）：开调试模式 = 商店全开锁 + 作物无视浇水快生；时间节奏不在此决定，统一用倍速下拉
    const invDebug = document.getElementById('btn-inv-debug');
    if (invDebug) invDebug.addEventListener('click', () => {
      const on = !Engine.debugFast;
      Engine.setDebugFast(on);
      invDebug.classList.toggle('debug-on', on);
      if (on && typeof UI.closeSummary === 'function') UI.closeSummary();
      // 关闭调试时若在树场，强制返回农场
      if (!on && typeof UI !== 'undefined' && UI.scene === 'treeFarm') UI.toggleScene();
      // 调试开关切换：shop 开着时立即重建交易列表（全开锁/恢复锁，遮罩秒消/秒现，无需关店重开）
      if (typeof UI !== 'undefined' && UI._shopOpen && UI._buildTrades) {
        UI._trades = UI._buildTrades();
        UI._shopDirty = true;
      }
      UI.showStatus(on ? '⚡ 调试模式：商店全开锁·作物快生（时间速度用倍速下拉）'
                       : '调试模式已关闭', 1600);
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
    // 时间倍速下拉（0.5x / 1.0x / 3x）：只缩放 tick 间隔，与调试模式互斥（选倍速自动关调试模式）
    const timeScaleSel = document.getElementById('time-scale');
    if (timeScaleSel) timeScaleSel.addEventListener('change', () => {
      const s = parseFloat(timeScaleSel.value);
      if (isNaN(s)) return;
      Engine.setTimeScale(s);
      // debugFast 被互斥关掉 → 同步按钮视觉态
      const dbgBtn = document.getElementById('btn-inv-debug');
      if (dbgBtn) dbgBtn.classList.remove('debug-on');
      UI.showStatus('时间倍速 ' + s + 'x', 1000);
    });
    // 调试：改天气下拉（晴 / 雨 / 大风，冬季雨显示为雪）。占位项「天气…」无效值忽略；同状态不重置倒计时。
    const weatherJump = document.getElementById('weather-jump');
    if (weatherJump) weatherJump.addEventListener('change', () => {
      const v = weatherJump.value;
      if (v !== 'clear' && v !== 'rain' && v !== 'wind') return;   // 占位项「天气…」无效值，忽略
      if (UI._weatherPhase === v) return;           // 同状态：不重置倒计时、不重复浇灌
      UI._setWeatherPhase(v);
      UI.showStatus(v === 'rain' ? '天气：雨（冬季显示为雪）' : v === 'wind' ? '天气：大风' : '天气：晴', 1000);
    });
    // 调试：跳时间下拉（早上 6:00 / 中午 12:00 / 傍晚 18:00 / 晚上 21:00）。
    // 占位项「时间…」无效值忽略；已停在目标整点则早退不闪提示；直接改 hour/minute 真值即时生效
    // （tick 是 setTimeout 链、每步读当前值继续走，无需重启；与 timeScale 完全正交，互不干扰）。
    const timeJump = document.getElementById('time-jump');
    if (timeJump) timeJump.addEventListener('change', () => {
      const v = parseInt(timeJump.value, 10);
      if (v !== 6 && v !== 12 && v !== 18 && v !== 21) return;   // 占位/非法值，忽略
      if (Engine.hour === v && Engine.minute === 0) return;      // 同状态早退，不重复跳
      Engine.hour = v;
      Engine.minute = 0;
      if (typeof UI !== 'undefined') {
        UI.markFarmDirty();
        if (typeof UI._tickSnow === 'function') UI._tickSnow();
        if (typeof UI._updateHUD === 'function') UI._updateHUD();
      }
      const names = { 6: '早上（6:00）', 12: '中午（12:00）', 18: '傍晚（18:00）', 21: '晚上（21:00）' };
      if (typeof UI !== 'undefined' && UI.showStatus) UI.showStatus('时间：' + names[v], 1000);
    });
    // 任务书入口：底部工具栏紫色书按钮（商店右边），点开/关任务书
    const questBtn = document.getElementById('btn-quest');
    if (questBtn) questBtn.addEventListener('click', () => UI.openQuest());

    // 标题界面按钮绑定（0.5.9：「继续游戏」按钮已改为「存档选择下拉 + 进入游戏」）
    const btnNewGame = document.getElementById('btn-new-game');
    // 0.5.52：裸绑定 `_startNewGame` 会被 addEventListener 把 MouseEvent 当第 1 参传入，
    // requestedSlot=事件对象（truthy）→ target=事件 → 落槽「空槽优先/三槽满 confirm」整段被跳过、
    // SaveGame.currentSlot 被置成事件对象（脏值）→ 后续所有无参 save() 走 SLOT_KEYS[事件]=undefined 静默失败。
    // 改箭头闭包不传参：requestedSlot=undefined → target=null → 空槽优先逻辑正常跑。
    if (btnNewGame) btnNewGame.addEventListener('click', function () { _startNewGame(); });
    // 存档选择：0.5.24 自定义下拉（原生 <option> 弹层由浏览器自绘、无法设背景，改「按钮 + 浮层列表」）。
    // 选中即进——有档槽 _continueGame(N)，空槽 confirm 后 _startNewGame(N)（0.5.22 口径，逻辑从原 change 监听体搬进面板项 click）。
    // #save-slot 原生 select 隐藏保留（作 value 兜底链路：面板项点选后写回 value，不删）。
    const selSaveSlot = document.getElementById('save-slot');
    const slotBtn = document.getElementById('save-slot-btn');
    const slotPanel = document.getElementById('save-slot-panel');
    const slotWrap = document.getElementById('save-slot-wrap');
    // 0.5.24：浮层背景用素材库 enchantment 深蓝横幅（base64 运行时才有，跟 ui-quest.js R['enchantment'] 同款手法）。
    // 0.5.23 曾给隐藏 select 装背景，现随 select 隐藏一并撤掉。
    if (selSaveSlot) selSaveSlot.style.backgroundImage = '';
    if (slotPanel && typeof ASSETS !== 'undefined' && ASSETS.registry['enchantment'])
      slotPanel.style.backgroundImage = `url(${ASSETS.registry['enchantment']})`;
    if (slotBtn && slotPanel && selSaveSlot) {
      // 按钮 click → toggle 浮层（none/block）
      slotBtn.addEventListener('click', function () {
        slotPanel.style.display = slotPanel.style.display === 'none' ? 'block' : 'none';
      });
      // 面板项 click（事件委托，只监听 panel 一次）→ 写回隐藏 select value + 选中高亮 + 按钮文案同步 + 关浮层 + 选中即进
      slotPanel.addEventListener('click', function (e) {
        const opt = e.target.closest ? e.target.closest('.save-slot-opt') : null;
        if (!opt || opt.parentElement !== slotPanel) return;
        selSaveSlot.value = opt.dataset.value;   // 写回隐藏 select：兜底链路
        const items = slotPanel.querySelectorAll('.save-slot-opt');
        for (let i = 0; i < items.length; i++) items[i].classList.toggle('selected', items[i] === opt);
        slotBtn.textContent = opt.textContent;
        slotPanel.style.display = 'none';
        if (opt.dataset.value === '') return;   // 占位项「选择存档…」不进游戏（与原生默认项一致）
        const N = parseInt(opt.dataset.value, 10);
        if (isNaN(N) || !SaveGame.hasSave(N)) {
          if (confirm('存档 ' + N + ' 是空的，将以此槽开新游戏，继续？')) _startNewGame(N);
        } else {
          _continueGame(N);
        }
      });
      // 点浮层外部 → 关浮层（document 委托；绑定段在 init() 只跑一次、标题页组件不随重进重挂，挂一次无累积泄漏）
      document.addEventListener('click', function (e) {
        if (slotWrap && slotWrap.contains(e.target)) return;   // 内部点击（按钮/面板项）由各自监听处理
        slotPanel.style.display = 'none';
      });
    }
    // 添加切换动画
    _addTitleTransition();
  }

  // ===== 标题界面控制 =====
  var _titleParticleRAF = null;
  var _titleParticleSystem = null;
  var _titleCanvas = null;
  var _titleCtx = null;
  // 0.5.20：visibilitychange 监听器泄漏修复。
  // 句柄提升到模块级：_startTitleParticles 只注册一次（_titleVisHandler 非空则跳过），
  // _stopTitleParticles 时 removeEventListener，杜绝「每次开店/切标题页都 addEventListener、永不 remove」的累积泄漏。
  var _titleVisHandler = null;
  var isHidden = false;   // 标题页不可见标志（模块级；_onTitleVisibility 维护、spawnLoop 读）
  function _onTitleVisibility() {
    isHidden = document.hidden;
    if (isHidden && _titleParticleRAF) {
      cancelAnimationFrame(_titleParticleRAF);
      _titleParticleRAF = null;
    }
  }

  function _startTitleParticles() {
    if (!UI || !UI.init || typeof Juice === 'undefined') {
      return;
    }
    var el = document.getElementById('title-particles');
    if (!el) return;
    if (_titleParticleRAF) { cancelAnimationFrame(_titleParticleRAF); _titleParticleRAF = null; }
    _titleCanvas = el;
    _titleCanvas.width = window.innerWidth;
    _titleCanvas.height = window.innerHeight;
    _titleCtx = _titleCanvas.getContext('2d');
    _titleParticleSystem = new Juice.ParticleSystem();
    var lastSpawnTime = 0;
    // 页面不可见时暂停动画（0.5.20：只注册一次，句柄由模块级 _titleVisHandler 持有，
    // _stopTitleParticles 时统一 removeEventListener，不再每次进标题页累积匿名监听）
    if (!_titleVisHandler) {
      _titleVisHandler = _onTitleVisibility;
      document.addEventListener('visibilitychange', _titleVisHandler);
    }
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
    if (_titleVisHandler) { document.removeEventListener('visibilitychange', _titleVisHandler); _titleVisHandler = null; }
  }

  function _showTitle() {
    var ts = document.getElementById('title-screen');
    if (!ts) return;
    _renderTitleSlots();
    ts.className = 'overlay-visible';
    _animateTitleLetters();
    _animateButtonsIn();
    _startTitleParticles();
  }

  /**
   * 标题页存档槽位下拉（0.5.9）：
   * #save-slot 生成 3 个 option——有档槽文案「存档 N · 秋3日 第1年 · 10/3」（listSlots 摘要），
   * 空槽文案「存档 N · 空」，value = 槽号。选中槽即进：有档槽 _continueGame(N)，空槽 confirm 后 _startNewGame(N)（0.5.22 已移除「进入游戏」按钮）。
   * 每次进标题页重建 option（摘要随最新存档刷新）。select 不做入场动画（原生下拉加动画易穿帮）。
   * 0.5.24：#save-slot 原生 select 已隐藏（option 弹层浏览器自绘无法设背景），option 生成循环原样搬到填充自定义浮层
   * #save-slot-panel——每项一个 <div class="save-slot-opt" data-value="N">，文案公式一字不动；sel 不再写入。
   */
  function _renderTitleSlots() {
    var panel = document.getElementById('save-slot-panel');
    if (!panel) return;
    panel.innerHTML = '';
    var placeholder = document.createElement('div');
    placeholder.className = 'save-slot-opt';
    placeholder.dataset.value = '';
    placeholder.textContent = '选择存档…';
    panel.appendChild(placeholder);
    if (typeof SaveGame === 'undefined' || !SaveGame.listSlots) return;
    SaveGame.listSlots().forEach(function (r) {
      var o = document.createElement('div');
      o.className = 'save-slot-opt';
      o.dataset.value = String(r.slot);
      o.textContent = r.has
        ? ('存档 ' + r.slot + ' · ' + (r.summary || '未知'))
        : ('存档 ' + r.slot + ' · 空');
      panel.appendChild(o);
    });
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
    ts.style.transition = 'opacity 1.2s ease-in';
    _titleTransitionOut = function(cb) {
      ts.style.opacity = '0';
      setTimeout(function() {
        ts.style.opacity = '';
        ts.style.transition = '';
        if (cb) cb();
      }, 1200);
    };
  }

  function _hideTitle() {
    var ts = document.getElementById('title-screen');
    if (ts) ts.className = 'overlay-hidden';
    _stopTitleParticles();
  }
  function _startNewGame(requestedSlot) {
    // 落槽规则（0.5.8）：从标题页点槽位列表进来的带 requestedSlot（该槽为空、confirm 过才进来，直接落）；
    // 点「单人游戏」进来的不传 → 空槽优先：从槽 1 往后找第一个空槽；
    // 三槽全满 → 依次 confirm 槽1/槽2/槽3 让玩家选覆盖哪个，全取消则不开局。
    var target = requestedSlot || null;
    if (!target) {
      for (var n = 1; n <= 3; n++) {
        if (!SaveGame.hasSave(n)) { target = n; break; }
      }
      if (!target) {
        // 三槽全满：依次确认覆盖
        var full = [1, 2, 3];
        for (var k = 0; k < full.length; k++) {
          if (confirm('三个存档槽已满，要覆盖槽 ' + full[k] + ' 吗？')) { target = full[k]; break; }
        }
        if (!target) return;   // 全取消：不开局，留在标题页
      }
    }
    SaveGame.currentSlot = target;   // 新游戏落该槽（后续无参自动存/手动存/关页静默存都落它）
    // 立即开始渲染（并行于标题淡出），避免黑屏等待
    UI._stopAnimLoop();
    Farm.init();
    TreeFarm.init();
    Player.init();
    // 初来乍到：开局 0.5s 后自动完成，获得锄头+水桶+5金
    if (typeof Quest !== 'undefined') {
      setTimeout(function() {
        Quest.claim('root');
      }, 500);
    }
    Engine.start();
    UI._farmCache = null;
    UI._vegCache = null;
    UI._grassBaseCache = null;
    UI._farmCacheKey = '';
    UI._farmDirty = true;
    UI._grassOutline = null;
    UI._grassBodyCanvas = null;
    UI._grassOutlineCanvas = null;
    UI._grassDataRev = 0;
    UI._grassRingCropCache = null;
    UI._shopGShownRes = null;   // 0.5.38：进游戏（新游戏/读档）清 G 块「显示过的资源」记忆（上一局空格不泄漏到本局；关店不清、会话内常驻）
    Player._mainShownRes = null;   // 0.5.39：新游戏清主背包「显示过的资源」记忆（上一局空格不泄漏到本局）
    UI.render();
    UI._renderBottomHotbar();
    UI._startAnimLoop();
    // 标题淡出
    _titleTransitionOut(function() {
      _hideTitle();
    });
  }
  function _continueGame(slot) {
    // 0.5.8：多传 slot（标题页槽位列表点有档槽进；缺省仍走 currentSlot）
    if (!SaveGame.hasSave(slot)) return;
    // 立即开始加载和渲染（并行于标题淡出）
    UI._stopAnimLoop();
    if (!SaveGame.load(slot)) return;  // 存档损坏或丢失：中断，不覆盖存档
    UI._farmCache = null;
    UI._vegCache = null;
    UI._grassBaseCache = null;
    UI._farmCacheKey = '';
    UI._farmDirty = true;
    UI._grassOutline = null;
    UI._grassBodyCanvas = null;
    UI._grassOutlineCanvas = null;
    UI._grassDataRev = 0;
    UI._grassRingCropCache = null;
    UI._shopGShownRes = null;   // 0.5.38：进游戏（新游戏/读档）清 G 块「显示过的资源」记忆（上一局空格不泄漏到本局；关店不清、会话内常驻）
    Player._mainShownRes = null;   // 0.5.39：读档进游戏清主背包记忆（不同档的背包布局互不污染）
    UI.render();
    UI._renderBottomHotbar();
    UI._startAnimLoop();
    // 标题淡出
    _titleTransitionOut(function() {
      _hideTitle();
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
    if (!el) { return false; }
    if (!ASSETS.registry[assetKey]) { return false; }
    const clsAttr = cls ? ` class="${cls}"` : '';
    el.innerHTML = `<img src="${ASSETS.registry[assetKey]}" alt="${alt}"${clsAttr}>`;
    return true;
  }

  function _setBtnIcon(btnId, assetKey) {
    const btn = document.getElementById(btnId);
    if (!btn) { return; }
    const iconEl = btn.querySelector('.tool-icon');
    if (!iconEl) { return; }
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
    const anchor = document.getElementById('btn-shop');
    const invBtn = document.createElement('div');
    invBtn.className = 'tool-btn';
    invBtn.id = 'btn-inventory';
    invBtn.innerHTML = '<div class="tool-icon"></div><div class="tool-name">背包</div>';
    invBtn.addEventListener('click', () => UI.openInventory());
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(invBtn, anchor);
    } else {
      const toolbar = document.getElementById('toolbar-buttons');
      if (toolbar) toolbar.appendChild(invBtn);
    }
    const iconEl = invBtn.querySelector('.tool-icon');
    if (iconEl) _setIconInner(iconEl, 'bundle_filled', '背包', 'tool-icon-img');
  }

  /** 主农场 ↔ 树场 切换（工具栏的树场按钮已移除，导航改由画布左上角箭头承担）。 */
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
