# Session Replay Canvas Continuous Capture RFC

## Status

Implemented as the default experimental path

## Summary

当前仓库里的 canvas replay 已经具备 snapshot-based 能力，但现有自动模式本质上仍然是：

- timer-based
- representative-frame oriented
- low-frequency sampling

它可以覆盖：

- dashboard
- BI 图表
- 低频变化 canvas

但不能满足新的明确目标：

- **让 canvas replay 更接近连续录制**

本 RFC 提议引入一条新的 capture path：

- `continuous_snapshot`

它仍然输出 rrweb-compatible `CanvasMutation`，但 capture 调度不再以固定 timer 为主，而是转向：

- render-driven
- change-driven

## Non-Goals

本 RFC 明确不做这些事：

- 不在第一版里直接切到 full command capture
- 不在第一版里直接做 WebGL 自动连续录制
- 不改现有 rrweb-compatible event protocol
- 不引入独立 canvas 上传协议
- 不删除当前 legacy `auto` fallback

## Why Now

最近已经确认：

1. 当前 auto 断断续续不是偶发 bug，而是 timer-based sampling 的自然结果。
2. 如果目标已经明确是“更连续录制”，继续调 `interval/cooldown/backoff` 已经没有路线价值。
3. 当前 snapshot-based 协议和播放端模型仍然是对的，真正需要升级的是 capture scheduler。

## Current Baseline

当前主链：

- [packages/rum/src/domain/replay/record/canvasObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasObserver.js)
- [packages/rum/src/domain/replay/record/canvasAutoSnapshot.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasAutoSnapshot.js)
- [packages/rum/src/domain/replay/record/record.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/record.js)

当前基线特征：

- `manual` + `auto`
- `CanvasMutation`
- snapshot-based
- cooldown / backoff / threshold skip

这条基线保留，作为：

- compatibility baseline
- rollback path
- benchmark control group

## Legacy Timer Path Retention

当前保留 legacy timer auto path，是明确的阶段性决策，不是遗留未清理。

保留原因：

- `continuous_snapshot` 已经是默认实验路径，但还不是最终唯一实现
- 仍然需要保留 `legacy_auto` 作为同一套 demo / benchmark 的直接对照组
- 一旦 continuous path 出现：
  - CPU 回归
  - 请求数失控
  - full snapshot / reset / stop 边界问题
  仍然需要一个低风险 rollback path

因此，legacy timer path 当前承担三种角色：

- correctness baseline
- performance control group
- rollback fallback

它不是长期目标，但在 fallback 阶段必须保留。

## External Reference: Sentry

本 RFC 参考了 Sentry 的这些源码：

- `/tmp/sentry-javascript-codex/packages/replay-canvas/src/canvas.ts`
- `/tmp/sentry-javascript-codex/packages/replay-canvas/test/canvas.test.ts`
- `/tmp/sentry-javascript-codex/packages/replay-canvas/README.md`

从这些文件可以确认：

- Sentry 默认也是 snapshot-based
- 它通过 integration + canvas manager 接入
- 它已经显式考虑 `requestAnimationFrame` 相关语义
- 它暴露的是简洁的 public capability，而不是 recorder 外层复杂的 timer sampler 语义

本 RFC 不打算“照抄 Sentry”，但会吸收它的关键思路：

- 把连续性问题放到 capture manager / scheduler 层解决
- 不继续把 auto 设计成一组复杂 recorder 参数

## Proposal

### New Capture Model

在实现层引入新的 capture model：

- `manual`
- `legacy_auto`
- `continuous_snapshot`

当前实现：

- public `auto` 默认走 `continuous_snapshot`
- `legacy_auto` 保留为显式 fallback
- 继续通过 debug / demo / benchmark 做对照验证

### Continuous Snapshot Scheduling

`continuous_snapshot` 的核心是：

- 不再依赖固定低频 timer 轮询
- 使用渲染节拍或变化事件决定是否取帧

第一阶段优先研究两类触发：

1. `requestAnimationFrame`-driven
2. canvas dirty/change-driven

目标不是“每帧必录”，而是：

- 在连续变化时显著缩短实际帧间隔
- 在静止时自动降频
- 让视觉结果明显比当前 timer sampler 更连续

## Proposed Internal Architecture

### 1. Continuous Canvas Scheduler

新增一个调度层，建议文件：

- `packages/rum/src/domain/replay/record/canvasContinuousScheduler.js`

职责：

- 维护候选 canvas 集合
- 追踪 canvas 是否处于活跃变化中
- 在活跃期按更高频率触发 capture
- 在静止期进入降频或休眠

### 2. Separation Between Scheduling And Encoding

调度器只负责决定：

- 何时尝试 capture
- 哪些 canvas 优先 capture

它不负责：

- 编码细节
- `CanvasMutation` 组装
- transport / segment

这些继续由现有：

- `canvasObserver`
- `canvasEncodeBridge`
- `record`

承担。

### 3. Keep CanvasObserver As The Encoding Boundary

当前 [canvasObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasObserver.js) 已经承担：

- 节点校验
- 编码
- 体积限制
- `CanvasMutation` emit

这层继续保留，不在本 RFC 第一阶段重写。

也就是说，第一阶段重点改：

- scheduler

而不是：

- encoder
- protocol
- replay event structure

## Open Design Choice: How To Detect Change

### Option A: rAF-Driven Heuristic

做法：

- 活跃 canvas 在 `requestAnimationFrame` 周期上被调度
- capture 前再做 cheap change check

优点：

- 对连续动画最友好
- 概念清晰

问题：

- 如果变化检测本身不够便宜，可能继续带来 CPU 压力

### Option B: Mutation/Method-Driven Dirty Marking

做法：

- 在 canvas draw 入口处打 dirty 标记
- scheduler 只对 dirty canvas 做 capture

优点：

- 更精准
- 不用盲扫所有 canvas

问题：

- 侵入性更高
- 更接近 command capture 路线

### Current Recommendation

第一阶段建议：

- 先做 `rAF + dirty-ish heuristic`
- 不在第一阶段直接 hook 全部 canvas draw API

原因：

- 改动面更可控
- 更容易和当前 snapshot-based path 兼容

## Success Metrics

这条 RFC 不接受“感觉更顺”这种主观验收。

第一阶段必须定义硬指标：

### Continuity

- 连续变化场景下，平均帧间隔显著小于当前 legacy auto
- 最大帧间隔在 dashboard 场景下受控

### Cost

- 编码 CPU 不超过明确上限
- `segment_bytes_limit` 命中频率可控
- replay 请求数没有失控增长

### Safety

- 不破坏普通 replay 主链
- 不破坏现有 manual snapshot
- 关闭该能力时完全回到旧路径

## Experiment Scope

第一阶段实验只覆盖：

- 2D canvas
- dashboard-style chart canvas
- 多 canvas wallboard

不覆盖：

- WebGL 自动连续录制
- full command capture
- 视频或游戏场景的“高保真逐帧录制”

## API Strategy

当前 API 策略已经落到代码里：

- 保持现有 public API 不变：
  - `snapshotCanvas()`
  - `replayCanvasMode`
- 新增内部实验开关：
  - `replayCanvasExperimentalContinuousSnapshot`
- 当前当 `replayCanvasMode === 'auto'` 且未显式关闭该开关时：
  - 默认走 `continuous_snapshot`
- 如果显式传 `replayCanvasExperimentalContinuousSnapshot: false`：
  - 回退到 `legacy_auto`

因此，这一阶段没有引入新的 public mode 名，也没有改 `CanvasMutation` 协议。

## Risks

### 1. CPU Regression

更连续的 capture 很容易把编码成本抬高。

### 2. Segment/Request Explosion

更连续的 `CanvasMutation` 会更频繁命中：

- `segment_bytes_limit`
- flush
- replay upload

### 3. Scheduler Complexity

从 timer-based 切到 render/change-driven 后：

- reset
- full snapshot
- stop/start
- session renew

这些边界都要重新验证。

## Required Tests

### Correctness

- 连续 capture 不破坏 manual snapshot
- reset 后旧任务不回写
- full snapshot 后连续 capture 能恢复
- stop/start 后不会残留旧 scheduler

### Performance

- 单图折线连续刷新
- 单图柱状图连续刷新
- 10-canvas dashboard wallboard 连续刷新
- replay on/off 对照

### Segment Behavior

- flush history
- bytes limit hit density
- request count

## Rollout Plan

### Current State

当前已经完成：

- prototype scheduler 已落地
- demo 已支持 `legacy_auto` / `continuous_snapshot` 切换
- 已有两组对照 benchmark：
  - single-canvas auto continuity
  - 10-canvas dashboard auto continuity
- debug / flush history / replay performance counters 已接入

### Current Experimental Default

当前状态不是“计划切换”，而是：

- `continuous_snapshot` 已经是默认实验路径
- `legacy_auto` 仅保留为显式 fallback

### Next Decision Point

下一步不再是“是否要做 prototype”，而是：

- 是否继续补剩余 gate（hidden/visible 等）
- 以及何时把 `legacy_auto` 从 fallback 进一步降到待删除状态

## Legacy Removal Gate

只有下面这些条件同时满足，才允许删除 legacy timer auto path：

### Correctness Gate

- `continuous_snapshot` 在这些场景下都稳定通过：
  - 单 canvas
  - 多 canvas
  - hidden / visible 切换
  - stop
  - takeSubsequentFullSnapshot
  - reset / generation 隔离
  - manual snapshot 与 continuous 并存

### Performance Gate

- 与 legacy auto 对照时，continuous path 不出现明显更差的：
  - 主线程卡顿
  - 编码 CPU
  - segment bytes 命中密度
  - replay 请求数
- 当前 single-canvas 和 dashboard benchmark 已经初步满足这条门槛

### Continuity Gate

- 连续变化场景下，continuous path 必须能证明：
  - 平均帧间隔更短
  - 最大帧间隔更可控
  - dashboard / 多图表场景下主观连续性明显优于 legacy auto
- 当前 single-canvas 和 dashboard benchmark 已经明确满足这条门槛

### Observability Gate

- 必须已经具备稳定可用的：
  - scheduler debug 标识
  - demo 切换入口
  - 对照 benchmark
  - flush/request 观察能力

在这些门槛满足之前：

- legacy timer path 只能降级为 fallback
- 不能直接删除
- 更不能静默把旧 `auto` 全量迁移到新的 continuous 行为

## Explicitly Deferred

- WebGL continuous capture
- command capture 默认化
- 独立 canvas transport
- public API 语义变更
