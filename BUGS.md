# 游戏Bug清单

## 已修复 (R129)

### farm.js:485 裸土→草方块逻辑笔误
- **问题**: 三元运算符分支写反，有草邻居时取了 `grassGrowAloneMult`(1.5) 而非 `grassGrowNeighborMult`(0.5)
- **影响**: 有草邻居的裸土生长过快，孤立裸土反而过慢
- **修复**: 已更正为 `hasNeighborGrassOrBlock ? grassGrowNeighborMult : grassGrowAloneMult`

### farm.js:491 草方块→土逻辑笔误
- **问题**: 三元运算符分支写反，有草邻居时取了 `decayAlone`(0.30) 而非 `decayNear`(0.10)
- **影响**: 有草邻居的草方块更易枯，孤立草方块反而耐用
- **修复**: 已更正为 `hasNeighborGrassOrBlock ? decayNear : decayAlone`

## 历史遗留 (非本轮引入)

### DOM ID 残留 (5个)
以下 id 在 HTML 中已移除，但 JS 中仍有备用绑定：
- `btn-inv-sleep` - 背包内睡觉按钮（已移除）
- `btn-sleep` - 主页面睡觉按钮（已移除，改Z键）
- `inv-held` - 手中物品框（已移除）
- `quest-tab-tip` - 任务标签提示（运行时动态创建）
- `quest-tree-clip` - 任务树裁剪区（运行时动态创建）

**状态**: 无害，保留以防旧绑定失效

### Asset Registry Key
以下 key 在代码中引用但通过 blob_ref 方式存储（不在 base64 registry 中）：
- `blank_row_frame`
- `gamemode_switcher_selection`
- `inventory`
- `short_dry_grass`
- `short_grass`
- `wheat_seeds`

**状态**: 通过 `assets.js` blob 机制正确加载

## 未发现问题

- 除零风险: 无
- 重复事件绑定: 无
- this 上下文丢失: 无
- 数组越界: 无
- null/undefined 解引用: 无（均有守卫）
- RAF 泄漏: 无（有防重复启动检查）
