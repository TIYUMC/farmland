# BUGS.md — 星露谷网页版 缺陷记录

> 纪律：bug 只记此文件；非 bug 的维护性改动记 MEMORY.md + 当日日志。
> 状态前缀：[崩溃] 运行时报错 / [逻辑] 行为错误 / [待完成] 功能半接未完 / [安全] 风险。

---

## B1 [已修复] 任务书面板（advancement）已接入游戏内（2026-08-07）
- **原现象**：`book_purple`、`advancement_tab_*`、`advancement_task_frame_obtained/unobtained`、`background` 等素材已在 `js/assets.js` 注册，但游戏里完全看不到任务书。
- **原根因**：`btn-inv-book` 死引用、无 click 处理器、无面板 DOM；`advancement_sample.html` 仅独立原型。
- **修复（2026-08-07）**：
  - `index.html` 背包顶栏 `#inv-topbar` 新增 `<div id="btn-inv-book">`（调试按钮右侧），`#inventory-overlay` 后新增 `#quest-overlay > #quest-panel > #quest-tree` 面板 DOM。
  - `main.js` 绑定 `btn-inv-book` click → `UI.openQuest()`，并在 `_setToolbarIcons` 用 `book_purple` 设图标。
  - `ui.js` 新增 `openQuest / closeQuest / _renderQuest`：`background` 作底、`advancement_task_frame_obtained/unobtained` 作节点卡、`advancement_tab_*` 作连接分支；`closeQuest` 刻意**不关背包**（退出任务书回到背包）。
  - `style.css`：`#inv-topbar` 移到背包贴图最顶 `top:5px`，新增 `#quest-overlay`（z-index 110，高于背包 100）等样式。
  - 数据骨架沿用 `advancement_sample.html` 的 DAG（`root→a1/a2→a1a/a2a`），待用户拍板后落到 `data.js`。
- **验证**：`node --check` 全过；`:3000` served 文件均含 `btn-inv-book / openQuest / quest-overlay / inv-topbar`，零行为风险（纯 UI 入口 + 面板）。

## B2 [已处置] `upload_missing.js` 含 GitHub PAT（2026-08-07 文件已删除）
- **原位置**：`upload_missing.js:4`，常量 `TOKEN = "ghp_..."`（`ghp_` 前缀即 GitHub PAT）。
- **原风险**：PAT 明文落在工作区文件里，一旦分享/上传即泄露。
- **处置（2026-08-07）**：该文件为 `git status` 中的未跟踪项（`??`），**从未提交到仓库**；已于本次清理时从工作区删除（`rm -f`），PAT 不再存于磁盘。同批清理的临时脚手架还有 `_insert_quest.py`、`_shop.png`、`_v_debug.png`（均未被游戏引用，游戏素材为 base64 内联）。
- **仍建议（预防性）**：尽管文件已删且未入库，GitHub PAT 一旦曾明文落盘即建议到 GitHub → Settings → Developer settings → Personal access tokens **撤销/轮换**该 token，以绝后患。
