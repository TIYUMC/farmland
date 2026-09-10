/**
 * ui-quest.js — 从 ui.js 拆分
 */

const _questMethods = {
  openQuest() {

    if (this._questOpen) { this.closeQuest(); return; }

    this._questOpen = true;

    const ov = document.getElementById('quest-overlay');

    if (ov) {

      ov.className = 'overlay-visible';

      ov.onclick = (e) => { if (e.target === ov) this.closeQuest(); };

    }

    // 打开时强制重置：回到默认分类、丢弃上次平移/缩放，视图对准根节点。

    // 不保留上次浏览位置，也不保留上次选中的分类页签（进入界面即「归位到根节点」）。

    this._questTab = null;            // 回到默认分类（_renderQuest 按 tabs[0] 取）

    this._questPan = null;            // 丢弃上次平移与缩放，重新初始化

    this._questCenterOnRoot = true; // 视图强制对准根节点

    this._questTipNode = null;    // 关闭上次的提示节点状态

    this._renderQuest();

  },




  closeQuest() {

    if (!this._questOpen) return;

    const ov = document.getElementById('quest-overlay');

    if (ov) ov.className = 'overlay-hidden';

    const t = document.querySelector('#quest-overlay .quest-tip');

    if (t) t.classList.remove('show');

    const tt = document.getElementById('quest-tab-tip');

    if (tt) tt.classList.remove('show');

    this._questOpen = false;

    this._questTipNode = null;    // 关闭提示节点状态

    // 背包仍开着，不关（关闭任务书即回到背包）

  },



  // 领取弹窗已移除：点击节点即领取（FTB 原生交互），弹窗只显示任务/奖励信息，无领取按钮。




  _renderQuest() {

    const tree = document.getElementById('quest-tree');

    if (!tree) return;

    const panel = document.getElementById('quest-panel');

    const R = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

    tree.innerHTML = '';

    // 背景：固定贴在面板上（contain 居中），不参与拖动；

    // 拖动只移动进度节点/连线所在的 #quest-tree，背景始终不动。

    if (R['demo_background'] && panel) {

      panel.style.backgroundImage = `url(${R['demo_background']})`;

      panel.style.backgroundSize = 'contain';

      panel.style.backgroundPosition = 'center';

      panel.style.backgroundRepeat = 'no-repeat';

    }



    const SRC = (typeof DATA !== 'undefined' && DATA.QUESTS) ? DATA.QUESTS : [];

    // 完成态由 Quest 模块按真实进度判定（root 现为 manual，需点击才完成）；用副本避免污染 DATA

    const ADV = SRC.map(n => ({

      ...n,

      done: (typeof Quest !== 'undefined') ? Quest.isDone(n.id) : (n.done || false),

    }));

    // 选项卡（分类页签）：每个 tab 只显示该分类的节点（无总览页）

    const tabs = (typeof DATA !== 'undefined' && DATA.QUEST_TABS) ? DATA.QUEST_TABS : [];

    if (!this._questTab || this._questTab === 'overview') this._questTab = (tabs[0] && tabs[0].id) || 'core';

    const activeTab = this._questTab;

    const vis = ADV.filter(n => n.cat === activeTab);

    // 可见节点包围盒 + 质心：用于把当前页节点居中到面板视口（避免散在四角「一左一右一上一下」）

    if (vis.length) {

      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;

      vis.forEach(n => { mnx = Math.min(mnx, n.x); mxx = Math.max(mxx, n.x); mny = Math.min(mny, n.y); mxy = Math.max(mxy, n.y); });

      // cx/cy 用包围盒中心（不是节点坐标均值）：分布偏斜时（如 root 在最左），

      // 居中后整块节点才能落在背景框内；用均值会把左边缘节点推出框外被裁切。

      this._questBBox = { minX: mnx, maxX: mxx, minY: mny, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };

    } else {

      this._questBBox = null;

    }

    this._renderQuestTabs(tabs, activeTab);

    const byId = {};

    vis.forEach(a => { byId[a.id] = a; });

    // 教程步骤编号：按tutorial节点在列表中的顺序分配（第1步、第2步...）
    const tutorialStepMap = {};
    let stepCounter = 1;
    vis.filter(n => n.tutorial).forEach(n => { tutorialStepMap[n.id] = stepCounter++; });


    // 坐标空间固定为 760×717（与面板 176:166 一致）；框为正方形，图标居中，文字在框右侧（放不下则翻左）

    const PW = 760, PH = 717, FS = 52, ICON = 34, GAP = 8, TXT_W = 80;



    // 1) 连线层：纯代码绘制的 SVG 折线（不再用 tab 贴图），完成路径染绿

    const NS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(NS, 'svg');

    svg.setAttribute('class', 'quest-links');

    // viewBox 用 #quest-tree 的真实像素尺寸（而非固定 760×717）：节点方框按树像素定位，

    // 只有 viewBox 与树像素 1:1，直线端点才会精确落在节点中心（窗口非 760 宽时也不错位）。

    const tw = tree.clientWidth || PW, th = tree.clientHeight || PH;

    svg.setAttribute('viewBox', `0 0 ${tw} ${th}`);

    svg.setAttribute('preserveAspectRatio', 'none');

    let li = 0;

    vis.forEach(n => {

      if (!n.parent || !byId[n.parent] || n.tutorial) return;

      const p = byId[n.parent];

      if (p.cat !== n.cat) return;   // 跨分类父节点（如教程挂到核心页根「初来乍到」）不画连线，避免孤儿线

      const path = document.createElementNS(NS, 'path');

      // 直连线：父节点中心 → 子节点中心，一条斜直线（用户要求「直直的，不要弯」）

      path.setAttribute('d', `M ${p.x} ${p.y} L ${n.x} ${n.y}`);

      path.setAttribute('vector-effect', 'non-scaling-stroke');

      path.setAttribute('pathLength', '100');   // 统一虚拟长度，配合 CSS stroke-dashoffset 实现「自己画出来」动画

      path.setAttribute('class', 'q-link' + ((p.done && n.done) ? ' done' : ''));

      path.style.setProperty('--i', li++);

      svg.appendChild(path);

    });

    tree.appendChild(svg);



    // 悬停提示：默认只显示节点名，悬停节点弹出「标题 + 详细描述」（避免永久文字重叠）

    // 挂在 overlay 上，用视口坐标定位，不受 tree 缩放/面板 overflow 裁切影响

    let tip = document.querySelector('#quest-overlay .quest-tip');

    if (tip) tip.remove();

    tip = document.createElement('div');

    tip.className = 'quest-tip';

    if (R['enchantment']) tip.style.backgroundImage = `url(${R['enchantment']})`;

    const _ov = document.getElementById('quest-overlay');

    if (_ov) _ov.appendChild(tip);



    // ===== 进度树 = 有向图：入度(前置) / 出度(可解锁) =====

    // 图的边有两类：

    //   1) 树边：child.parent → child（同分类内的推进）

    //   2) 网关边：tab.prereq → 该支线的入口节点（主线网关节点解锁整条支线）

    // 支线入口节点（父节点不在本分类内）的前置一律改判为网关节点，

    // 否则悬停会显示 root 这种「看不见也点不到」的跨页父节点，反而误导。

    const allById = {};

    ADV.forEach(a => { allById[a.id] = a; });

    const tabLabel = {};

    tabs.forEach(t => { tabLabel[t.id] = t.label; });

    const gatewayOf = {};   // 支线入口节点 id → 解锁它的主线网关节点 id

    tabs.forEach(t => {

      if (!t.prereq || !allById[t.prereq]) return;

      ADV.forEach(n => {

        if (n.cat !== t.id) return;

        const p = n.parent ? allById[n.parent] : null;

        if (!p || p.cat !== n.cat) gatewayOf[n.id] = t.prereq;

      });

    });

    // 入度：直接前驱（网关边优先于树边）

    const preOf = (n) => {

      const g = gatewayOf[n.id];

      if (g) return [allById[g]];

      const p = n.parent ? allById[n.parent] : null;

      return p ? [p] : [];

    };

    // 出度：树边后继 + 由本节点作为网关解锁的支线入口

    const nextOf = (n) => ADV.filter(c => (gatewayOf[c.id] ? gatewayOf[c.id] === n.id : c.parent === n.id));

    // 完成/未完成状态图标一律用素材库贴图（confirm 绿勾 / Icon_Locked 锁），不用 emoji

    const ICO_OK = this._iconHTML('confirm', 'q-st', '已完成');

    const ICO_LOCK = this._iconHTML('Icon_Locked', 'q-st', '未完成');

    // 关联节点小标签：完成态用色区分；跨分类的额外标注所属支线名

    const chip = (m) => `<span class="q-node${m.done ? ' ok' : ''}">${m.done ? ICO_OK : ICO_LOCK}${m.title}`

      + (m.cat !== activeTab ? `<i>·${tabLabel[m.cat] || m.cat}</i>` : '') + '</span>';



    const showTip = (node) => {

      const tip = document.querySelector('#quest-overlay .quest-tip');

      if (!tip) return;

      const el = document.querySelector('#quest-tree .quest-frame[data-qid="' + node.id + '"]');

      if (!el) return;

      const r = el.getBoundingClientRect();

      const tr = node.track || {};

      // —— 目标（按完成类型组织文案；进度/成就自动完成，教程手动）——

      let goal;

      if (node.manual) {

        if (node.track && node.track.k === 'submit') {

          // 提交型：需持有并交出物品，点击节点领取（消耗物品）

          const tn = node.track.n || 1;

          const have = (typeof Quest !== 'undefined') ? Quest._itemCount(node.track.item) : 0;

          const iname = (typeof Quest !== 'undefined') ? Quest._itemName(node.track.item) : (node.track.item || '');

          if ((typeof Quest !== 'undefined') && Quest.isDone(node.id)) goal = ICO_OK + ' 已完成 · 奖励已领取';

          else {

            const pend = preOf(node).filter(p => !p.done);

            const lock = pend.length ? ICO_LOCK + ' ' : '';

            goal = lock + `提交要求：交 ${tn}×${iname}<br>已持有：<b>${have} / ${tn}</b>`;

          }

        } else {

          // 普通手动解锁成就（教程）：点击节点领取，不自动完成

          if ((typeof Quest !== 'undefined') && Quest.isDone(node.id)) goal = ICO_OK + ' 已完成 · 奖励已领取';

          else {

            const pend = preOf(node).filter(p => !p.done);

            const lock = pend.length ? ICO_LOCK + ' ' : '';

            goal = lock + (node.desc ? node.desc : '点击节点领取奖励');

          }

        }

      } else if (tr.k === 'always') {

        goal = node.done ? (ICO_OK + ' 起始任务（已完成）') : '起始任务';

      } else if (tr.k === 'ownTool') {

        const has = !!(typeof Player !== 'undefined' && Player.ownedTools && Player.ownedTools[tr.tool]);

        goal = (has ? ICO_OK + ' 已拥有 — ' : ICO_LOCK + ' 需先拥有 — ') + (node.desc || ('工具：' + tr.tool));

      } else {

        // 累计型（进度/成就）：实时进度 = min(已累计, 目标)

        const cur = (typeof Quest !== 'undefined') ? Math.min(Quest.stats[tr.k] || 0, tr.n) : 0;

        goal = `完成要求：${node.desc || ''}<br>进度：<b>${cur} / ${tr.n}</b>${node.done ? ' ' + ICO_OK + ' 已完成' : ''}`;

      }

      // —— 奖励（无则显示「无」）——

      const rewardText = this._rewardText(node.reward);

      const rewardSec = rewardText ? rewardText : '无';

      // —— 前置 / 后置（无则显示「无」）——

      const pre = preOf(node), nxt = nextOf(node);

      const preSec = pre.length ? pre.map(chip).join('') : '无';

      const nextSec = nxt.length ? nxt.map(chip).join('') : '无';

      // 教程节点：显示步骤编号 + 操作目标，目标栏改为清晰的交互提示
      let tipHtml = '';
      if (node.tutorial) {
        const stepNum = tutorialStepMap[node.id] || node.id.replace('tut', '');
        tipHtml += `<div class="quest-ttl">${node.title}</div>`;
        tipHtml += `<div class="quest-ds">${node.desc || '点击节点学习'}</div>`;
        // 教程目标栏只显示当前操作步骤，不重复 desc
        if (node.track && node.track.k === 'submit') {
          const tn = node.track.n || 1;
          const have = (typeof Quest !== 'undefined') ? Quest._itemCount(node.track.item) : 0;
          const iname = (typeof Quest !== 'undefined') ? Quest._itemName(node.track.item) : (node.track.item || '');
          goal = `提交：${tn} × ${iname}<br>已持有：<b>${have} / ${tn}</b>`;
        } else {
          goal = '点击节点领取奖励';
        }
        tipHtml += `<div class="quest-gr"><b>目标</b>${goal}</div>`;
      } else {
        tipHtml = `<div class="quest-gr"><b>目标</b>${goal}</div>`;
      }

      tip.innerHTML = tipHtml
        + `<div class="quest-gr"><b>奖励</b>${rewardSec}</div>`
        + `<div class="quest-gr"><b>前置</b>${preSec}</div>`
        + `<div class="quest-gr"><b>后置</b>${nextSec}</div>`;

      tip.classList.add('show');

      const tw = tip.offsetWidth, th = tip.offsetHeight;

      let left = r.right + 10, top = r.top + r.height / 2 - th / 2;

      if (left + tw > window.innerWidth - 8) left = r.left - 10 - tw;

      if (left < 8) left = 8;

      if (top < 8) top = 8;

      if (top + th > window.innerHeight - 8) top = window.innerHeight - 8 - th;

      tip.style.left = left + 'px'; tip.style.top = top + 'px';

    };

    // 提示由悬停节点展开（mouseenter → showTip）；移开节点收起（mouseleave → hideTip）；点击节点额外触发领取奖励

    const hideTip = () => { tip.classList.remove('show'); this._questTipNode = null; };



    // 2) 任务节点：正方形框(obtained/unobtained 区分完成) + 居中图标 + 文字

    vis.forEach((n, i) => {

      const frame = document.createElement('div');

      frame.className = 'quest-frame';

      frame.style.left = (n.x - FS / 2) + 'px';

      frame.style.top = (n.y - FS / 2) + 'px';

      frame.style.width = FS + 'px';

      frame.style.height = FS + 'px';

      const frameKey = n.challenge

        ? 'Advancement_Challenge_Frame_' + (n.done ? 'Obtained' : 'Unobtained')

        : (n.done ? 'advancement_task_frame_obtained' : 'advancement_task_frame_unobtained');

      frame.style.backgroundImage = `url(${R[frameKey]})`;

      tree.appendChild(frame);



      const icSize = (n.id === 'root') ? 44 : ICON;

      const ic = document.createElement('img');

      ic.className = 'quest-ic';

      ic.style.width = icSize + 'px';

      ic.style.height = icSize + 'px';

      ic.style.left = (n.x - icSize / 2) + 'px';

      ic.style.top = (n.y - icSize / 2) + 'px';

      // 完成态显示 confirm（绿色对勾），未完成显示原图标

      ic.src = R[n.done ? 'confirm' : n.icon] || R[n.icon] || '';

      tree.appendChild(ic);



      const txt = document.createElement('div');

      txt.className = 'quest-txt';

      // 文字放在框正下方居中：避免同排节点左右标签互相重叠（side 布局在 160px 间距下必重叠）

      txt.style.width = TXT_W + 'px';

      txt.style.left = (n.x - TXT_W / 2) + 'px';

      txt.style.top = (n.y + FS / 2 + 6) + 'px';

      txt.style.textAlign = 'center';

      txt.innerHTML = `<div class="quest-ttl">${n.title}</div>`;

      tree.appendChild(txt);



      frame.dataset.qid = n.id;

      frame.style.cursor = 'pointer';

      // 悬停节点 = 弹窗出现（任务/前置/奖励预览）；点击节点 = 领取奖励（FTB 原生：悬停看、点击领，无领取按钮）

      frame.addEventListener('mouseenter', () => showTip(n));   // 悬停即弹

      frame.addEventListener('mouseleave', () => hideTip());     // 移开即收

      frame.addEventListener('pointerdown', (e) => e.stopPropagation()); // 防止面板拖拽 setPointerCapture 吞掉 click

      frame.addEventListener('click', (e) => {

        e.stopPropagation();

        if ((typeof Quest !== 'undefined') && n.manual && !Quest.isDone(n.id) && Quest._manualClaimable(n)) {

          const result = Quest.claim(n.id);

          if (result) {

            this._updateHUD(); // 刷新 HUD（时间/体力）；金币奖励由下面的 openInventory 重渲染背包展示

            // 无条件打开背包，确保用户看到奖励

            if (typeof UI !== 'undefined' && UI.openInventory) {

              UI.openInventory();

              // 强制刷新背包 DOM

              if (UI.renderInventory) UI.renderInventory();

            }

          }

        }

        showTip(n);            // 刷新弹窗（已领则显示「已完成 · 奖励已领取」）

        this._renderQuest();  // 完整重绘节点：边框+图标同步更新为 done 态

      });

      // 进场 stagger：节点三件套(框/图标/文字)一起按序号 --i 错峰入场；动画结束移除 .qenter，交还 hover transform 控制

      [frame, ic, txt].forEach(el => {

        el.classList.add('qenter');

        el.style.setProperty('--i', i);

        el.addEventListener('animationend', () => el.classList.remove('qenter'), { once: true });

      });

    });



    // 可见内容「真实包围盒」：含 方框(frame) + 图标(ic) + 文字标签(txt) 的全部渲染范围，

    // 不止节点圆心。文字标签在框正下方(n.y+FS/2+6)，方框比圆心大 FS/2；只按圆心夹取会让

    // 标签/边框在拖到极值时漏进上下暗边带（即「超出背景」）。用真实包围盒居中+夹取，杜绝漏出。

    {

      const els = tree.querySelectorAll('.quest-frame, .quest-ic, .quest-txt');

      if (els.length) {

        let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;

        els.forEach(el => {

          const l = el.offsetLeft, t = el.offsetTop, r = l + el.offsetWidth, b = t + el.offsetHeight;

          if (l < mnx) mnx = l; if (r > mxx) mxx = r;

          if (t < mny) mny = t; if (b > mxy) mxy = b;

        });

        this._questBBox = { minX: mnx, maxX: mxx, minY: mny, maxY: mxy, cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 };

      } else {

        this._questBBox = null;

      }

    }



    // 拖拽平移：面板为视口，内部树放大(scale)后超出窗口，按住拖动浏览（仿 Minecraft 进度树）

    if (!this._questPan) this._questPan = { tx: 0, ty: 0, scale: 1.2 };

    const P = this._questPan;

    if (panel) {

      // 背景可视区：demo_background 以 contain 贴在面板上（宽图按宽适配、居中），

      // 面板上下会留出暗边带。节点/连线须留在「背景可视区」内，不能拖进上下暗边带（否则显得「超出背景」）。

      const bgRect = () => {

        const vw = panel.clientWidth, vh = panel.clientHeight;

        const Rr = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

        const url = Rr['demo_background'];

        if (!url) return { x: 0, y: 0, w: vw, h: vh };

        if (!this._questBgImg) {

          const im = new Image();

          im.onload = () => { this._questBgRatio = im.naturalHeight / im.naturalWidth; };

          im.src = url; this._questBgImg = im;

        }

        const ratio = this._questBgRatio || (1024 / 1528); // 兜底：固定素材 1528×1024

        const PAD = 8; // 留出安全边距：内容夹取到「比背景再内缩 8px」的带内，吸收亚像素取整，确保绝不漏进暗边带

        let w, h;

        if (ratio <= vh / vw) { w = vw; h = vw * ratio; } // 宽图：按宽适配

        else { h = vh; w = vh / ratio; }                  // 高图：按高适配

        const bx = (vw - w) / 2, by = (vh - h) / 2;

        return { x: bx + PAD, y: by + PAD, w: w - 2 * PAD, h: h - 2 * PAD };

      };

      // 裁切容器：把进度树限制在「背景可视区」矩形（与 demo_background 的 contain 区域一致）内。

      // 目的：让树可以比视口更大、用拖拽平移浏览（参考我的世界进度树——树大于屏幕、拖拽漫游），

      // 同时绝不拖进上下/左右暗边带（被这里的 overflow:hidden 挡在背景图范围内，不会溢出到暗边）。

      // 背景图本身仍是 contain（未改用户要求的显示方式），只是给树加了一层「按背景区域裁切」的窗口。

      let clip = document.getElementById('quest-tree-clip');

      if (!clip) {

        clip = document.createElement('div');

        clip.id = 'quest-tree-clip';

        panel.insertBefore(clip, tree);

        clip.appendChild(tree); // tree 移入裁切容器（之后仍按 id 取到，不必重建）

      }

      const _band = bgRect();

      clip.style.position = 'absolute';

      clip.style.left = _band.x + 'px';

      clip.style.top = _band.y + 'px';

      clip.style.width = _band.w + 'px';

      clip.style.height = _band.h + 'px';

      clip.style.overflow = 'hidden';

      clip.style.pointerEvents = 'none'; // 拖拽事件照常冒泡给 panel 处理

      // tree 原点对齐面板(0,0)：左/上偏移 -_band，使节点坐标(n.x,n.y)仍对应面板像素（平移/夹取数学不变）

      tree.style.position = 'absolute';

      tree.style.left = (-_band.x) + 'px';

      tree.style.top = (-_band.y) + 'px';

      tree.style.right = 'auto';

      tree.style.bottom = 'auto';

      tree.style.width = panel.clientWidth + 'px';

      tree.style.height = panel.clientHeight + 'px';

      // 自适应缩放：用户要求「缩小到约一半节点可见、其余拖拽浏览」（参考我的世界进度树）。

      // 节点间距已减半(DX 150→75)，cw 同步减半；此处再乘 0.5 并下调上限到 1.25，

      // 使整棵进度树缩到约可见一半、节点仍清晰，剩余靠拖拽漫游。下限 0.5 防缩成小点。

      if (this._questBBox) {

        const cw = (this._questBBox.maxX - this._questBBox.minX) || 1;

        const ch = (this._questBBox.maxY - this._questBBox.minY) || 1;

        P.scale = Math.min(1.25, Math.max(0.5, _band.w / cw * 0.5, _band.h / ch * 0.5));

      }

      const clampPan = () => {

        const vw = panel.clientWidth, vh = panel.clientHeight;

        const bb = this._questBBox;

        if (bb) {

          // 夹取但不强制居中：让节点整体留在「背景可视区」内即可（暗边带不参与夹取）。

          // 这样拖拽平移不会被「居中」瞬间复位，又不会把节点拖进上下的暗边带（超出背景）。

          const band = bgRect();

          const txMin = band.x - bb.minX * P.scale, txMax = band.x + band.w - bb.maxX * P.scale;

          const tyMin = band.y - bb.minY * P.scale, tyMax = band.y + band.h - bb.maxY * P.scale;

          // 内容 ≤ 背景：txMin<txMax，夹在 [txMin,txMax]（不越出背景可视区）；

          // 内容 > 背景（我的世界风格：树比视口大）：txMin>txMax，取 [txMax,txMin] 让树始终覆盖背景、可拖拽平移。

          // 两情况统一用 min/max 夹取，拖拽位移绝不会被「居中」复位（修复内容>背景时拖拽失效）。

          const txLo = Math.min(txMin, txMax), txHi = Math.max(txMin, txMax);

          const tyLo = Math.min(tyMin, tyMax), tyHi = Math.max(tyMin, tyMax);

          P.tx = Math.min(txHi, Math.max(txLo, P.tx));

          P.ty = Math.min(tyHi, Math.max(tyLo, P.ty));

        } else {

          const minX = vw - PW * P.scale, minY = vh - PH * P.scale;

          P.tx = Math.min(0, Math.max(minX, P.tx));

          P.ty = Math.min(0, Math.max(minY, P.ty));

        }

      };

      const apply = () => { tree.style.transform = `translate(${P.tx}px,${P.ty}px) scale(${P.scale})`; };

      // 打开时（或切换分类时）把视图对准**根节点**——强制重置到任务树起点；

      // 若当前分类页不含根节点（根只在 core 页），退回对准「包围盒中心」。

      // 对准「背景可视区」中心（不是面板中心）：节点不偏到上下暗边带。

      if ((this._questCenterOnRoot || !P.centered) && this._questBBox) {

        const band = bgRect();

        const root = vis.find(n => n.id === 'root');

        const fx = root ? root.x : this._questBBox.cx;

        const fy = root ? root.y : this._questBBox.cy;

        P.tx = (band.x + band.w / 2) - fx * P.scale;

        P.ty = (band.y + band.h / 2) - fy * P.scale;

        P.centered = true;

        this._questCenterOnRoot = false;

      }

      if (!panel.dataset.panBound) {

        panel.dataset.panBound = '1';

        let sx = 0, sy = 0, stx = 0, sty = 0, dragging = false;

        panel.addEventListener('pointerdown', (e) => {

          if (e.button !== 0) return;

          dragging = true; sx = e.clientX; sy = e.clientY; stx = P.tx; sty = P.ty;

          panel.classList.add('grabbing');

          try { panel.setPointerCapture(e.pointerId); } catch (_) {}

          e.preventDefault();

        });

        panel.addEventListener('pointermove', (e) => {

          if (!dragging) return;

          P.tx = stx + (e.clientX - sx);

          P.ty = sty + (e.clientY - sy);

          clampPan(); apply();

        });

        const end = (e) => {

          if (!dragging) return;

          dragging = false; panel.classList.remove('grabbing');

          try { panel.releasePointerCapture(e.pointerId); } catch (_) {}

        };

        panel.addEventListener('pointerup', end);

        panel.addEventListener('pointercancel', end);

      }

      clampPan(); apply();

    }

  },



  // 渲染顶部选项卡条：用 advancement_tab_* 小方格贴图作底图，选中态用 *_Selected；

  // 依在数组中的次序拼成 Above_Left / Above_Middle×(N-2) / Above_Right 的小方格条。


  _renderQuestTabs(tabs, activeTab) {

    if (!tabs || !tabs.length) return;

    const R = (typeof ASSETS !== 'undefined' && ASSETS.registry) || {};

    let bar = document.getElementById('quest-tabs');

    if (!bar) {

      bar = document.createElement('div');

      bar.id = 'quest-tabs';

      const wrap = document.getElementById('quest-frame-wrap');

      if (wrap) wrap.appendChild(bar);

    }

    bar.innerHTML = '';

    // 页签悬停弹窗：复用 Enchantment 弹窗样式，仅悬停时显示该支线的「前置/解锁条件」这类详情。

    // 短名仍常驻在页签上；弹窗只补"玩家该完成什么才能解锁"这种信息（不重复短名）。

    let tabTip = document.getElementById('quest-tab-tip');

    if (!tabTip) {

      tabTip = document.createElement('div');

      tabTip.id = 'quest-tab-tip';

      tabTip.className = 'quest-tab-tip';

      if (R['enchantment']) tabTip.style.backgroundImage = `url(${R['enchantment']})`;

      const _ov = document.getElementById('quest-overlay');

      if (_ov) _ov.appendChild(tabTip);

    }

    const tabTipHTML = (t) => {

      if (t.prereq && typeof Quest !== 'undefined' && !Quest.isDone(t.prereq)) {

        const pn = (typeof DATA !== 'undefined') ? DATA.QUESTS.find(q => q.id === t.prereq) : null;

        const pt = pn ? pn.title : t.prereq;

        return `<div class="quest-ttl">${t.label}</div><div class="quest-ds">需完成【${pt}】解锁</div>`;

      }

      const nodes = (typeof DATA !== 'undefined') ? DATA.QUESTS.filter(n => n.cat === t.id) : [];

      const done = nodes.filter(n => typeof Quest !== 'undefined' && Quest.isDone(n.id)).length;

      return `<div class="quest-ttl">${t.label}</div><div class="quest-ds">完成进度 ${done} / ${nodes.length}</div>`;

    };

    const showTabTip = (t, el) => {

      const r = el.getBoundingClientRect();

      tabTip.innerHTML = tabTipHTML(t);

      tabTip.classList.add('show');

      const tw = tabTip.offsetWidth, th = tabTip.offsetHeight;

      let left = r.left + r.width / 2 - tw / 2;

      let top = r.bottom + 8;

      if (left < 8) left = 8;

      if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw;

      if (top + th > window.innerHeight - 8) top = r.top - 8 - th; // 下方放不下则翻到上方

      if (top < 8) top = 8;

      tabTip.style.left = left + 'px';

      tabTip.style.top = top + 'px';

    };

    const hideTabTip = () => tabTip.classList.remove('show');

    tabs.forEach(t => {

      const locked = !!(t.prereq && typeof Quest !== 'undefined' && !Quest.isDone(t.prereq));

      const btn = document.createElement('div');

      btn.className = 'quest-tab' + (t.id === activeTab ? ' active' : '') + (locked ? ' locked' : '');

      const spr = R[t.id === activeTab ? t.selected : t.tab];

      if (spr) btn.style.backgroundImage = `url(${spr})`;

      // 选项卡上的代表物图标（如 种植=小麦种子、采集=原木、工具=木斧头）

      // 仅核心玩法（新换的耕地+锄头图）放大显示，其余保持原尺寸

      const icCls = (t.icon && R[t.icon]) ? (t.id === 'core' ? 'quest-tab-ic quest-tab-ic--core' : 'quest-tab-ic') : '';

      const ic = icCls ? `<img class="${icCls}" src="${R[t.icon]}">` : '';

      // 未解锁的支线选项卡：叠加锁图标（Icon_Locked），明确"锁住、暂不可进"。

      // 详情（解锁条件/进度）放进悬停弹窗，不常驻显示；页签本身只放图标/锁/短名。

      const lock = (locked && R['Icon_Locked']) ? `<img class="quest-tab-lock" src="${R['Icon_Locked']}">` : '';

      // 分类标签文字常驻显示（名字短，直接显示即可）；解锁条件等详情只在悬停弹窗里

      btn.innerHTML = `${ic}${lock}<span class="quest-tab-lbl">${t.label}</span>`;

      // 阻止 tab 上的指针事件冒泡到 panel，避免触发平移拖拽

      btn.addEventListener('pointerdown', e => e.stopPropagation());

      btn.addEventListener('mouseenter', () => showTabTip(t, btn));

      btn.addEventListener('mouseleave', hideTabTip);

      btn.addEventListener('click', () => {

        if (locked) {

          // 未解锁：抖动即可（解锁条件在悬停弹窗里告知玩家，不常驻显示）

          btn.classList.remove('shake');

          void btn.offsetWidth;

          btn.classList.add('shake');

          return;

        }

        if (this._questTab === t.id) return;

        this._questTab = t.id;

        this._questCenterOnRoot = true; // 切换分类后把视图对准该组节点（根不在该页则退回包围盒中心）

        this._renderQuest();

      });

      bar.appendChild(btn);

    });

  },



  /**

   * MC 风格成就弹窗：右上角滑入，3.5 秒后自动收回。

   * @param {string} title  成就标题

   * @param {string} [iconKey]  ASSETS.registry 中的贴图键（默认 'nether_star'）

   * @param {number} [duration] 显示时长（ms），默认 3500

   */


  showAchievement(title, iconKey = 'nether_star', duration = 3500) {

    const el = document.getElementById('achievement-toast');

    if (!el) return;

    const iconSrc = this._assetURL(iconKey);

    const frameSrc = this._assetURL('blank_row_frame');

    el.innerHTML = `<div class="achievement-frame">` +

      (frameSrc ? `<img class="achievement-bg" src="${frameSrc}" alt="">` : '') +

      (iconSrc ? `<img class="achievement-icon" src="${iconSrc}" alt="${title}">` : '') +

      `<div class="achievement-text">` +

      `<span class="achievement-label">成就达成</span>` +

      `<span class="achievement-title">${title}</span>` +

      `</div></div>`;

    el.className = 'toast-visible';

    if (this._achievementTimeout) clearTimeout(this._achievementTimeout);

    this._achievementTimeout = setTimeout(() => {

      el.className = 'toast-hidden';

    }, duration);

  },




};

Object.assign(UI, _questMethods);
