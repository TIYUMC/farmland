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

    // 连接引擎回调
    Engine.onHourChange = (hour, minute) => {
      UI.render();
    };

    // 每分钟刷新 HUD 时钟，并缓慢恢复体力
    Engine.onMinuteChange = (hour, minute) => {
      Player.regenStamina(DATA.STAMINA_REGEN_PER_MIN);
      UI._updateHUD();
    };

    Engine.onNewDay = (day, season, year) => {
      // 结算（继续按钮）已处理了农活更新，这里只需渲染
      UI.render();
      UI.markFarmDirty(); // 跨天后季节可能变化，重建静态层以更新秋日落叶堆
      // 跨天若仍下雨，重新浇灌（Farm.resetWater 已清空当日 watered），让作物次日继续靠雨水生长
      if (typeof UI !== 'undefined' && UI.isRaining && UI._rainWaterFields) UI._rainWaterFields();
      // 跨天推进秋日落叶：每树3%概率、每天≤2格、总计≤10格（非秋季自动清空）
      if (typeof UI !== 'undefined' && UI._spawnDailyLitter) UI._spawnDailyLitter();
    };

    // 一天结束（午夜24:00）
    Engine.onDayEnd = () => {
      UI.showFullSummary();
    };

    // 开始首日
    Engine.start();
    UI.render();

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
        case 'l':
        case 'L': // 调试：强制开启/关闭落叶（无视季节，便于查看粒子效果）
          UI._forceAutumnLeaves = !UI._forceAutumnLeaves;
          UI.markFarmDirty(); // 强制落叶开关变化需重建静态层（地面落叶堆）
          UI.showStatus(UI._forceAutumnLeaves ? '🍂 落叶调试：强制开启' : '🍂 落叶调试：关闭', 1000);
          break;
      }
    });

    // 背包按钮快捷
    _addInventoryButton();
    // 商店按钮：开关村民商店（B/S 亦可开关，点面板外或 Esc 关闭）
    document.getElementById('btn-shop').addEventListener('click', () => {
      if (UI._shopOpen) UI.closeShop(); else UI.openShop();
    });

    // 睡觉按钮：主动睡觉（晚上 6 点之后，由 Engine.sleep 内部校验）
    const sleepBtn = document.getElementById('btn-sleep');
    if (sleepBtn) sleepBtn.addEventListener('click', () => Engine.sleep());

    // 调试快进按钮（临时功能）：开启后 1 秒 = 1 天，方便快速测试作物生长/时间流逝
    const debugBtn = document.getElementById('btn-debug');
    if (debugBtn) {
      debugBtn.addEventListener('click', () => {
        const on = !Engine.debugFast;
        Engine.setDebugFast(on);
        debugBtn.classList.toggle('debug-on', on);
        if (on && typeof UI.closeSummary === 'function') UI.closeSummary();
        UI.showStatus(on ? '⚡ 调试快进：1 秒 = 1 天' : '调试快进已关闭', 1200);
      });
    }
  }

  function _selectTool(toolId) {
    const btn = document.querySelector(`.tool-btn[data-tool="${toolId}"]`);
    if (btn) { btn.click(); return; }
    // 工具栏已不显示锄头/水桶/斧头：快捷键 1/2/3 直接装备（保持可玩）
    if (toolId === 'hoe' || toolId === 'water' || toolId === 'axe') {
      // 木斧头需先购买（30 金锭 + 5 小麦），未拥有则拦截提示
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

  function _addInventoryButton() {
    const toolbar = document.getElementById('toolbar');
    const anchor = document.getElementById('btn-shop');
    const invBtn = document.createElement('div');
    invBtn.className = 'tool-btn';
    invBtn.id = 'btn-inventory';
    invBtn.innerHTML = '<div class="tool-icon">🎒</div><div class="tool-name">背包</div>';
    invBtn.addEventListener('click', () => UI.openInventory());
    anchor.parentNode.insertBefore(invBtn, anchor);
    // 背包按钮生成后才换贴图（JS 动态插的，_setToolbarIcons 来不及）
    const iconEl = invBtn.querySelector('.tool-icon');
    if (iconEl) _setIconInner(iconEl, 'bundle_filled', '背包', 'tool-icon-img');
  }

  /** 主农场 ↔ 树场 切换（快捷键 T 共用；工具栏的树场按钮已移除，导航改由画布左上角箭头承担）。 */
  function _toggleTreeFarm() {
    if (typeof UI === 'undefined' || !UI.toggleScene) return;
    UI.toggleScene();
  }

  /**
   * 用 ASSETS.registry 中的真实 base64 贴图替换工具栏里的 emoji 图标。
   * 仅替换部分匹配上的；不匹配则保留原 emoji（兜底）。
   */
  function _setToolbarIcons() {
    // 商店按钮 → shop 纹理
    _setBtnIcon('btn-shop', 'shop');
    // 睡觉按钮 → 红床贴图（Red_Bed，来自桌面星露谷素材）
    _setBtnIcon('btn-sleep', 'red_bed');
    // 调试按钮 → Command_Block 贴图（用户桌面素材，已登记进 registry）
    _setBtnIcon('btn-debug', 'command_block');

    // HUD 图标换贴图
    _setHudIcon('hud-ico-stamina',  'food_full');
    _setHudIcon('hud-ico-time',  'time');
    _setHudIcon('hud-ico-money', 'money');
  }

  /** 把图标换成贴图：注册表里没有该贴图就不动（保留原 emoji 兜底），成功返回 true。
   *  cls 留空则不写 class 属性（HUD 图标用），否则写 class="cls"。 */
  function _setIconInner(el, assetKey, alt, cls) {
    if (!el || !ASSETS.registry[assetKey]) return false;
    const clsAttr = cls ? ` class="${cls}"` : '';
    el.innerHTML = `<img src="${ASSETS.registry[assetKey]}" alt="${alt}"${clsAttr}>`;
    return true;
  }

  /** 把图标换成贴图，同时保留原本在 .tool-icon 内的 .tool-badge（如种子价格标签） */
  function _swapIcon(iconEl, assetKey, alt) {
    const badge = iconEl.querySelector('.tool-badge');
    if (!_setIconInner(iconEl, assetKey, alt, 'tool-icon-img')) return;
    if (badge) iconEl.appendChild(badge);
  }

  /** 把指定 id 的按钮的 .tool-icon 替换成贴图 */
  function _setBtnIcon(btnId, assetKey) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const iconEl = btn.querySelector('.tool-icon');
    _swapIcon(iconEl, assetKey, btnId);
  }

  /** 把指定 id 的 hud-label span 内部内容替换成贴图（无 class） */
  function _setHudIcon(hudId, assetKey) {
    const el = document.getElementById(hudId);
    _setIconInner(el, assetKey, hudId, '');
  }

  // 启动
  window.addEventListener('DOMContentLoaded', init);
})();
