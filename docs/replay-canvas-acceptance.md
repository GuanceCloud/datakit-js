# Canvas 录制验收清单

这份文档用于当前阶段的 canvas 录制验收，不是设计文档。

目标只有一个：

- 明确当前版本能否作为可交付能力进入验证或发布流程

## 适用范围

当前验收范围覆盖：

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`
- `manual` 模式
- `auto` 模式
- canvas snapshot worker
  - inline blob worker
  - external `replayCanvasWorkerUrl`

当前不在本轮验收主目标中的能力：

- `webgl` / `webgl2`
- 对所有复杂 2D 场景的完全一致重放

## 验收前提

验收前必须确认：

- Session Replay 已被采样到
- 已调用 `startSessionReplayRecording()`
- `replayCanvasEnabled: true`
- 目标元素是 `2d canvas`
- demo 或业务页面已切到待验收模式

## 核心验收项

### 1. 首帧采集

必须确认：

- 页面首次进入后，初始 canvas 能被录到
- dashboard 初始面板也能被录到
- 不需要手动二次操作才能看到第一帧

失败表现通常是：

- 页面刚进入时 canvas 有内容
- replay 或 debug 中第一帧缺失

### 2. `manual` 模式

必须确认：

- 调用 `snapshotCanvas(canvas)` 后能生成录制结果
- 连续调用不会破坏 live canvas 绘制
- 不调用 `snapshotCanvas(canvas)` 时不会自动补帧

### 3. `auto + replayCanvasSampling: number`

必须确认：

- 自动 snapshot 能稳定触发
- 不再出现损坏的 encoded payload
- 不再出现 `createImageBitmap` decode error
- 页面隐藏后暂停，恢复后继续

### 4. `auto + replayCanvasSampling: 'all'`

必须确认：

- 普通 2D 绘制会走 command capture
- 不会破坏 live canvas 绘制
- fallback 时行为稳定、可解释
- `Path2D`、`CanvasGradient`、`CanvasPattern` 等复杂对象命中 fallback 时，不会污染其他 canvas

### 5. Fallback 行为

必须确认：

- fallback 后仍能看到可接受的回放结果
- debug 中能看到明确 `reason`
- fallback 不会把旧 command 队列带到下一轮
- `takeSubsequentFullSnapshot()`、`pause()/resume()` 后状态能恢复干净

### 6. Worker 行为

必须确认：

- inline worker 可工作
- external `replayCanvasWorkerUrl` 可工作
- external canvas worker 不影响原有 `workerUrl`
- 单次 worker 运行期错误不会永久关闭整页 canvas worker 路径

## 当前正式边界

以下场景当前应视为正式 fallback 边界，而不是待修复缺陷：

- `Path2D`
- `CanvasGradient`
- `CanvasPattern`
- 部分 `drawImage(...)` source
- `drawImage(canvas, ...)`

这些场景下，如果看到：

- `scheduler: 'command_capture'`
- `status: 'fallback'`

并不表示系统异常，而是当前产品边界命中。

## 必须没有的问题

在本轮验收中，以下问题必须视为阻塞：

- 首帧漏录
- live canvas 被录制逻辑破坏
- 继续出现坏的 encoded payload
- 继续出现 `createImageBitmap` decode error
- external `canvas-worker.js` 不生效
- fallback reason 丢失或退化成无法定位的问题值
- `takeSubsequentFullSnapshot()` 后旧 fallback 状态污染下一轮

## 建议记录的验收结果

每次验收建议至少记录：

- 页面或 demo 场景名
- 配置
  - `replayCanvasMode`
  - `replayCanvasSampling`
  - worker 模式
- 首帧是否成功
- 是否命中 fallback
- fallback reason
- 是否有控制台错误
- 是否有明显回放异常

## 当前验收记录

### Demo workbench (`http://127.0.0.1:8082/`)

已确认通过：

- 首帧采集
  - 主 canvas：通过
  - dashboard 10 canvas：通过
- `manual`
  - 主 canvas 手动 snapshot：通过
  - dashboard 手动 snapshot：通过
- `manual` 并发 snapshot
  - 主 canvas `3/3` 成功
  - dashboard `10/10` 成功
- `auto + replayCanvasSampling: number`
  - `continuous_snapshot:completed`
  - `eligibleCanvasCount=11`
  - `selectedCanvasCount=11`
  - dashboard `auto continuous`
    - `drawCount=37`
    - `completedSnapshots=200`
    - `avgSelectedCanvasCount=11`
- `auto + replayCanvasSampling: 'all'`
  - 普通场景：`command_capture:completed`
  - 复杂场景：稳定 fallback，当前已确认 reason 包括 `draw_image_canvas`
- `visibility command`
  - `hiddenSnapshotCount=0`
  - `fallbackCount=0`
  - `resumeFirstGapMs=15`
- dashboard `auto command` benchmark
  - `drawCount=39`
  - `completedSnapshots=41`
  - `avgSelectedCanvasCount=4.9`
  - `fallbackCount=0`
- dashboard `visibility command`
  - `drawCount=42`
  - `completedSnapshots=36`
  - `hiddenSnapshotCount=0`
  - `fallbackCount=0`
  - `resumeFirstGapMs=71`
- canvas worker
  - inline：通过
  - external：通过
  - 已确认 `GET /canvas-worker.js [200]`

本轮未再复现的问题：

- 损坏的 encoded payload
- `createImageBitmap` decode error
- external canvas worker 不生效

### 已知事项

- dashboard `auto command` benchmark 现在已经按批次聚合，不再出现早前 `completedSnapshots=200`、`avgSelectedCanvasCount=1` 的旧口径。
- 当前结果更接近真实 draw 批次：
  - `drawCount=39`
  - `completedSnapshots=41`
  - `avgSelectedCanvasCount=4.9`
- 这仍然是 demo benchmark 的统计结果，不等同于“每一轮 dashboard render 必然对应 1 条自动录制结果”。
- dashboard `auto continuous` 仍然按被选中的 canvas snapshot 计数，因此会看到：
  - `drawCount=37`
  - `completedSnapshots=200`
  - `avgSelectedCanvasCount=11`
- 这符合 continuous snapshot 当前的统计口径，不归类为录制失败。

## 当前阶段结论标准

可以认为当前版本“通过阶段验收”的最低标准是：

- 首帧采集稳定
- snapshot / command / fallback 三条路径都可运行
- worker inline / external 都能工作
- 不存在坏 payload 和 decode error
- 当前正式 fallback 边界行为稳定且可解释
