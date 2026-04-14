# Session Replay Canvas Continuous Snapshot Prototype

## Purpose

这份文档只回答一个问题：

- **如果我们要在当前代码基线之上做第一版 `continuous_snapshot` 原型，最小可行实现应该长什么样**

它不是最终设计文档，也不是 RFC 的替代品。  
它只服务于第一版原型落地。

## Prototype Goal

第一版原型目标非常明确：

- 在不改 rrweb-compatible `CanvasMutation` 协议的前提下
- 让连续变化中的 canvas 捕获明显比当前 legacy auto 更连续
- 同时不直接进入 full command capture

换句话说，目标是：

- **continuous snapshot**

不是：

- command capture
- WebGL continuous recording
- 完整视频录制

## Baseline To Keep

以下现有实现继续保留，不在原型阶段推翻：

- [packages/rum/src/domain/replay/record/canvasObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasObserver.js)
  - 编码、校验、体积限制、emit `CanvasMutation`
- [packages/rum/src/domain/replay/record/canvasEncodeBridge.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasEncodeBridge.js)
  - 编码桥
- [packages/rum/src/domain/replay/record/record.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/record.js)
  - recorder 主链接线

这几层视为：

- stable encoding path
- stable event path

第一版原型主要替换的不是编码器，而是调度器。

## Prototype Shape

## 1. New Internal Scheduler

建议新增文件：

- [packages/rum/src/domain/replay/record/canvasContinuousScheduler.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasContinuousScheduler.js)

职责：

- 管理连续录制候选 canvas
- 维护活跃状态
- 在连续变化时更高频触发 snapshot
- 静止时自动降频

### Why A Separate File

原因是当前：

- `canvasAutoSnapshot.js` 已经是 legacy auto sampler

如果继续在它上面改，会把：

- legacy auto
- continuous snapshot

两套语义继续搅在一起。

所以第一版原型应当直接新建独立模块，不在旧模块里硬扩。

## 2. New Internal Mode

第一版原型不直接改 public API 语义。

建议内部先引入实验配置：

```js
replayCanvasExperimentalContinuousSnapshot: true
```

或者内部 mode：

```js
replayCanvasModeInternal = 'legacy_auto' | 'continuous_snapshot'
```

要求：

- 对外 `replayCanvasMode` 暂时不变
- 原型阶段只在实验分支、demo 或内部开关下启用

## 3. Scheduling Model

### Phase 1 Choice

第一版原型建议走：

- `requestAnimationFrame`-driven main loop

而不是：

- canvas draw API patch
- command capture

原因：

- 改动最小
- 更容易落地
- 能先验证“连续性提升”是不是值得继续投

### Loop Model

调度器维护两类状态：

```js
{
  activeCanvases,
  dirtyCanvases,
  lastCapturedAtByCanvas,
  lastSeenSignatureByCanvas,
  lastSuccessfulCaptureAtByCanvas,
  rafId,
  stopped
}
```

每轮 rAF：

1. 找出处于 active 状态的 canvas
2. 对候选 canvas 做 cheap change check
3. 仅对需要 capture 的 canvas 调 `canvasObserver.snapshot(canvas, { trigger: 'continuous' })`
4. 更新状态
5. 下一轮继续

## 4. Change Detection Strategy

第一版原型不做完整 command capture，所以必须有 cheap change check。

建议：

- 继续复用已有 frame signature 思路
- 但把它从“低频跳过逻辑”改成“高频 capture 前的 cheap gate”

关键差异：

- 在 legacy auto 里，threshold 是用来大幅降频的
- 在 continuous snapshot 里，threshold 只是避免连续空录

也就是说：

- 它是保护机制
- 不是主节奏控制器

## 5. Active/Idle Transition

第一版原型必须明确：

- 连续录制不等于永远高频录制

建议：

### Active State

条件：

- 最近几轮发生明显变化

行为：

- 按 rAF 节拍持续尝试 capture
- 但仍然允许 cheap gate 阻止完全重复帧

### Idle State

条件：

- 连续若干轮没有明显变化

行为：

- 停止高频 capture
- 进入等待下一次激活

### Reactivation

第一版原型建议由两类信号触发：

- 手动 snapshot
- 下一轮 change check 检测到画面明显变化

## Proposed File Changes

## Files To Add

- [packages/rum/src/domain/replay/record/canvasContinuousScheduler.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasContinuousScheduler.js)
- [packages/rum/src/domain/replay/record/canvasContinuousScheduler.spec.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasContinuousScheduler.spec.js)

## Files To Modify

- [packages/rum/src/domain/replay/record/record.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/record.js)
  - 在 start 时按实验开关接 legacy auto 或 continuous scheduler
  - 在 stop/reset/full snapshot 时一并清理 continuous scheduler

- [packages/rum/src/domain/configuration.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/configuration.js)
  - 增加实验开关校验和组装

- [packages/rum/types/index.d.ts](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/types/index.d.ts)
  - 如果实验开关进入对外配置，就同步补类型

- [demo/index.html](/Users/dengchangliang/www/rum/browser-sdk/demo/index.html)
  - 增加 continuous prototype demo path

## Prototype Non-Goals

第一版原型明确不做：

- command capture
- 2D API patch
- WebGL 自动连续录制
- 新的上传协议
- public mode 正式变更

## Success Criteria

原型成功的标志不是“看起来还行”，而是下面这些：

### Continuity

- 连续变化 demo 上，平均帧间隔明显小于 legacy auto
- 最大帧间隔明显下降

### Safety

- manual snapshot 语义不变
- stop/reset/full snapshot 不污染状态
- recorder 主链不被破坏

### Cost

- CPU 增量可接受
- `segment_bytes_limit` 虽然可能增加，但不出现失控爆发
- demo 页面仍可交互

## Required Tests

### Scheduler Tests

- active -> idle 状态切换
- reset 后旧 rAF 不回写
- stop 后不再继续 capture

### Integration Tests

- continuous scheduler 与 `canvasObserver.snapshot()` 接线正确
- full snapshot 后能恢复 capture
- manual snapshot 与 continuous scheduler 不打架

### Demo Verification

- 单折线持续刷新
- 单柱图持续刷新
- 10-canvas dashboard wallboard

## Benchmark Plan

原型阶段至少要比这两条：

- legacy auto
- continuous snapshot

指标至少包括：

- average frame interval
- max frame gap
- emitted `CanvasMutation` count
- replay request count
- `segment_bytes_limit` hit count

## Rollback Strategy

回退必须简单：

- continuous scheduler 只挂在实验开关下
- 关闭开关就完全回到当前 legacy auto

也就是说，这一版原型不允许把现有稳定路径和新路径耦得太深。

## Immediate Next Step

如果继续落代码，建议顺序是：

1. 新增 `canvasContinuousScheduler.js`
2. 先做纯 scheduler 单测
3. 再接 `record.js`
4. 最后接 demo 原型按钮和 benchmark
