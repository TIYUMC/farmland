/**
 * quest.js — 任务书（Advancement）进度系统
 * 职责：累计玩家行为事件、按 track 自动点亮任务、供 UI 渲染读取完成态。
 * 数据驱动：任务树定义见 data.js 的 DATA.QUESTS。
 *
 * 埋点约定（各模块成功动作后调用，全部用 typeof Quest 守卫，零回归风险）：
 *   Farm.till/plant/harvest  → Quest.trigger('till'|'plant'|'harvest', count)
 *   TreeFarm.chop/plantSapling → Quest.trigger('chop'|'plantSapling')
 *   Player.addWood           → Quest.trigger('wood', amount)
 *   Player.addMoney          → Quest.trigger('earn', amount)
 *   Economy.buyTool         → Quest.trigger('ownTool', toolId)
 */
const Quest = {
  // 各事件累计次数 / 总量
  stats: {},

  /** 玩家已完成任务集合（挂在 Player.questsDone，刷新即重置，与游戏整体无存档一致） */
  _done() {
    return (typeof Player !== 'undefined' && Player.questsDone) || {};
  },

  /** 重置进度（Player.init 时调用） */
  reset() {
    this.stats = {};
    if (typeof Player !== 'undefined') Player.questsDone = {};
  },

  /**
   * 触发一个行为事件：累加 stats[type]，并立即评估所有任务是否达成。
   * n = 本次增量（默认 1），收获/卖钱/木头传实际数量。
   */
  trigger(type, n) {
    const inc = (typeof n === 'number') ? n : 1;
    this.stats[type] = (this.stats[type] || 0) + inc;
    this._evaluate();
  },

  /** 遍历任务树，满足 track 的标记为完成 */
  _evaluate() {
    const quests = (typeof DATA !== 'undefined' && DATA.QUESTS) || [];
    const done = this._done();
    let changed = false;
    for (const q of quests) {
      if (done[q.id]) continue;
      if (this._meets(q.track)) {
        done[q.id] = true;
        changed = true;
        this._announce(q);
      }
    }
    if (changed) {
      if (typeof Player !== 'undefined') Player.questsDone = done;
      // 任务书开着则实时刷新
      if (typeof UI !== 'undefined' && UI._questOpen && UI._renderQuest) UI._renderQuest();
    }
  },

  /** 判定单个 track 是否满足 */
  _meets(track) {
    if (!track) return false;
    if (track.k === 'always') return true;
    if (track.k === 'ownTool') {
      return !!(typeof Player !== 'undefined' && Player.ownedTools && Player.ownedTools[track.tool]);
    }
    // 累计型：stats[track.k] >= track.n
    const v = this.stats[track.k] || 0;
    return v >= (track.n || 1);
  },

  /** 是否已完成（always 型即便未标记也视为完成，开局即亮） */
  isDone(id) {
    const done = this._done();
    if (done[id]) return true;
    const quests = (typeof DATA !== 'undefined' && DATA.QUESTS) || [];
    const q = quests.find(x => x.id === id);
    return !!(q && q.track && q.track.k === 'always');
  },

  /** 达成提示 */
  _announce(q) {
    if (typeof UI !== 'undefined' && UI.showStatus) {
      UI.showStatus('🌟 任务达成：' + q.title, 1600);
    }
  },
};
