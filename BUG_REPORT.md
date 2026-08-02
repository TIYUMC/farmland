# 星露谷风牧场 · Bug 排查报告

排查范围：`index.html` + `js/{assets,data,engine,farm,player,economy,ui,main}.js` + `css/style.css`
排查方式：全量通读 + 资源注册表交叉核对（48 个 key，无缺失 key）
结论：**代码可运行，无会导致崩溃/白屏的硬 bug。**

> 更新（2026-07-31）：下列 3 处代码改动已全部落地，并通过 `node --check` 全量语法校验。

---

## ✅ 1. 「工具栏缺种子按钮」——经确认不是 bug

用户确认工具栏本就不要求有种子按钮。之前 `main.js` 的 `_setToolbarIcons` 里有一行过时注释「`// 主工具按钮 + 种子按钮换贴图`」，**已删除**。
播种仍可通过背包点选（B → 点种子装备）或商店购买后自动装备完成，无需改动功能。

---

## ✅ 2. `assets.js` 中 `row_frame_sel` 重复定义 3 次 —— 已修复

同一对象字面量里 `row_frame_sel:` 出现了三次，已去重为 1 个（三个 base64 原本一致，删除冗余两行即可，无功能影响）。

---

## ✅ 3. `index.html` 里 HUD 金币占位值写死成 500 —— 已修复

```html
<span id="hud-money">128</span>   <!-- 与 data.js 的 PLAYER_START.money=128 对齐 -->
```

（顺带：`hud-stamina` 20/20、`hud-seeds` 5 与初始值一致，没问题。）

> 复查（2026-07-31 22:21）：上一次运行虽在报告里标记「已修复」，但磁盘上的 `index.html` 实际仍为 `500`（修复未真正落盘）。本次运行已重新将该占位值改为 `128`，与 `data.js` 对齐。`PLAYER_START.money` 在 `ASSETS.preload()`（await）期间 HUD 会短暂显示占位值，修正后避免加载瞬间闪现错误的「500」。

---

## ✅ 4. `Farm.dailyGrow()` 里浇水状态重置与 `resetWater()` 重复 —— 已修复

`dailyGrow` 中 `cell.watered = false;` 与紧接着 `engine.js` 的 `nextDay()` 调用的 `Farm.resetWater()` 重复，已删掉 `dailyGrow` 里那行，由 `resetWater()` 统一负责（逻辑等价）。

---

## ✅ 已确认正常、无需担心的点

- **资源引用完整**：`render()` / 商店 / HUD / 工具栏用到的贴图 key（`grass_block`、`farmland_moist/dry`、`water_bucket`、`wheat_stage0~7`、`potatoes_*`、`sweet_berry_bush_*`、`wooden_hoe`、`villager_gui`、`money`、`time`、`wheat_seeds`、`bundle_filled`、`food_full`、`cancel`、`confirm`、`crafting_arrow_error`、`blank_row_frame`、`row_frame_sel`、`小麦` 等）**全部存在于 `ASSETS.registry`**，无缺失 key。
- **`ASSETS.draw` 的 `|| fallback` 兜底逻辑正确**：有图返回 `true` 跳过兜底，无图返回 `false` 走填充色兜底。
- **引擎时间循环无重复计时器**：`pause/resume/nextDay/start` 对 `tickTimer` 的管理是单链，不会双速。
- **作物生长 / 浇水 / 收获 / 再生（甜浆果 regrow）逻辑自洽**：`dailyGrow`、`_isGrown`、`harvest` 的状态机正确。
- **商店买/卖金钱账目自洽**：背包按真实 `Player.money` 堆叠并扣减已拖入输入框的份数，拖入量恒 ≤ 实际金币。
- **脚本加载顺序正确**：`assets → data → engine → farm → player → economy → ui → main`，`main.js` 在 `DOMContentLoaded` 后 `init()`，所有 `getElementById` 的 id 在 HTML 中均存在。

---

## 修复状态汇总

| 问题 | 状态 |
|------|------|
| 工具栏种子按钮（非需求，删过时注释） | ✅ 已处理 |
| `row_frame_sel` 重复键（3→1） | ✅ 已修复 |
| HUD 占位 500 → 128 | ✅ 已修复 |
| `dailyGrow` 冗余的 `watered=false` | ✅ 已修复 |
