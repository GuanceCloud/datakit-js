# Session Replay Canvas Todo List

## Final Goal

canvas replay 的最终目标保持不变：

- **效果不能比 Sentry 差**
- **性能要优于 Sentry**
- **必须同时支持 `sampling.canvas = number | 'all'`**
- **默认是 `sampling.canvas = number`**
- **`number -> snapshot`**
- **`'all' -> command capture`**

## Source Baseline

这份 todo 基于已阅读源码：

- [rrweb canvas-manager.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/canvas-manager.ts)
- [rrweb 2d.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/2d.ts)
- [rrweb serialize-args.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/serialize-args.ts)
- [Sentry replay-canvas canvas.ts](/tmp/sentry-javascript-codex/packages/replay-canvas/src/canvas.ts)

## What We Confirmed

1. rrweb 有两条 canvas 路线
   - `sampling: 'all'` -> command capture
   - `sampling: number` -> snapshot sampling

2. Sentry 外层 integration 当前默认更像 rrweb 的 `sampling:number`
   - `low -> 1`
   - `medium -> 2`
   - `high -> 4`

3. rrweb command capture 的关键不是“每次调用立即发”
   - `CanvasRenderingContext2D.prototype` patch
   - 异步收集
   - rAF flush

4. 我们如果只继续修 snapshot continuous，最多只能逼近 Sentry 当前外层 integration
   - 做不到超越 rrweb command capture 这条上限

## Strategic Decision

后续主路线是明确的 rrweb mode split：

- **`sampling.canvas = number` 走 snapshot**
- **`sampling.canvas = 'all'` 走 rrweb-compatible 2D command capture**

这些都不再作为产品终态：

- 继续调 `continuous_snapshot`
- 把 `continuous_snapshot` 当正式对外模式
- 继续把 scheduler 调优当最终方案

## Product Positioning

### Product Model

- 默认档位：
  - `sampling.canvas = number`
  - 走 snapshot sampling
- 高保真档位：
  - `sampling.canvas = 'all'`
  - 走 command capture

### Snapshot Role

- 在 `sampling:number` 下，snapshot 是主路径
- 在 `sampling:'all'` 下，snapshot 是局部 fallback

fallback 只用于：

- 初始校准
- command drift 修正
- rrweb 2D replay 当前无法可靠还原的复杂 canvas 对象
- recorder 明确失败
- 复杂 `drawImage` / cross-origin / video / WebGL 场景

## Current Implementation Status

### Already Landed

- [x] `replayCanvasSampling: number | 'all'` 正式配置入口
- [x] 删除 legacy timer runtime path
- [x] runtime 主链只保留 continuous / command 两条
- [x] demo 删除 legacy mode / benchmark 按钮
- [x] 独立的 command arg serializer
- [x] 独立的 2D command recorder
- [x] per-context pending queue
- [x] rAF flush
- [x] rrweb-compatible `CanvasMutation` record builder
- [x] command observer 接入 `record()`
- [x] behind flag 接入 demo
- [x] command path 的 debug / benchmark 接线
- [x] command path benchmark 已拿到非零结果
- [x] rrweb-compatible setter command (`setter: true`)
- [x] 去掉非 rrweb 的 command `kind` 字段

### Canvas Worker Status

当前 canvas encode worker 已经从 `canvasEncodeBridge` 内的轻量实现升级为独立 worker 基础设施。

和现有 deflate worker 对比，当前 canvas worker 还没补齐：

- [x] 独立 worker 生命周期状态机
- [x] `init -> initialized` 往返握手
- [x] 初始化超时
- [x] 启动失败与运行期失败分离
- [x] 独立 self-hosted worker URL
- [x] 独立 bundle 交付
- [x] 放到 `packages/worker` 下统一管理和构建
- [x] 独立 `canvas-worker` bundle，且不影响现有 deflate worker bundle

这里要明确：

- 这不是“优化项”
- 而是 canvas worker 达到现有 session replay worker 工程标准的必要条件
- 现有 `workerUrl` 和 deflate worker 行为不能被 canvas worker 改坏

### Patch Model

当前 recorder 不再只靠 instance patch。

现在的实际模型是：

- **优先共享 prototype patch**
- **tracked context 过滤**
- fake context / 单元测试 fallback 时才走 instance patch

这比之前的 instance-only patch 更接近 rrweb 的方向。

### Hard Safety Constraint

这是硬约束，不允许退：

- **command capture 绝不能破坏 live canvas 绘制**

当前已经为此修过一轮：

- property setter 记录时必须透传原生 descriptor
- 不能为了录制改变真实绘制结果

## Current 2D Coverage

### Methods Landed

- [x] `save`
- [x] `restore`
- [x] `translate`
- [x] `scale`
- [x] `rotate`
- [x] `transform`
- [x] `setTransform`
- [x] `clearRect`
- [x] `fillRect`
- [x] `strokeRect`
- [x] `rect`
- [x] `beginPath`
- [x] `moveTo`
- [x] `lineTo`
- [x] `bezierCurveTo`
- [x] `quadraticCurveTo`
- [x] `closePath`
- [x] `arc`
- [x] `ellipse`
- [x] `roundRect`
- [x] `clip`
- [x] `fill`
- [x] `stroke`
- [x] `fillText`
- [x] `strokeText`
- [x] `setLineDash`
- [x] `drawImage`
- [x] `createLinearGradient`
- [x] `createRadialGradient`
- [x] `createPattern`
- [x] `createConicGradient`

### Properties Landed

- [x] `fillStyle`
- [x] `strokeStyle`
- [x] `lineWidth`
- [x] `lineCap`
- [x] `lineJoin`
- [x] `miterLimit`
- [x] `font`
- [x] `globalAlpha`
- [x] `shadowColor`
- [x] `shadowBlur`
- [x] `shadowOffsetX`
- [x] `shadowOffsetY`
- [x] `textAlign`
- [x] `textBaseline`
- [x] `filter`

## Serialization Status

### Already Covered

- [x] primitives
- [x] arrays
- [x] typed arrays
- [x] `ArrayBuffer`
- [x] `DataView`
- [x] `ImageData`
- [x] `HTMLImageElement`
- [x] `HTMLCanvasElement`
- [x] mixed `drawImage(...)` args

### Opaque Object Strategy

当前已经不是“直接漏掉复杂对象”，而是：

- [x] 对 opaque canvas object 使用稳定引用语义
- [x] 引用按 **context 维度** 分配
- [x] 输出 `{ rr_type, index }`

目前这条策略已经覆盖到：

- [x] `CanvasGradient`
- [x] `CanvasPattern`
- [x] `Path2D` 类对象
- [x] 其他无法直接展开的 object

但 runtime 当前策略已经收紧成：

- [x] `CanvasGradient` 命中 style/fidelity 风险时切 snapshot fallback
- [x] `CanvasPattern` 命中 style/fidelity 风险时切 snapshot fallback
- [x] `Path2D` 作为命令参数时切 snapshot fallback
- [x] `CanvasGradient.addColorStop` 触发 snapshot fallback
- [x] `drawImage(HTMLVideoElement, ...)` 触发 snapshot fallback
- [x] `drawImage(cross-origin HTMLImageElement, ...)` 触发 snapshot fallback
- [x] `drawImage(tainted HTMLCanvasElement, ...)` 触发 snapshot fallback

### Still Open

- [ ] `CanvasGradient` 的 color stop 还原策略
- [ ] `CanvasPattern` 的 image source 和 repeat 语义验证
- [ ] 更复杂 `drawImage` fidelity 边界

### Stable Fallback Boundary

- [x] `Path2D` 当前明确作为稳定 snapshot fallback 边界
- [x] `Path2D` 不进入近期 command fidelity 计划
- [x] `Path2D` 只有在真实业务占比和回放体感证明收益足够时再单独立项

## Observer / Integration Status

### Already Landed

- [x] patch 未来的 `getContext('2d')`
- [x] observer 启动时补挂当前已存在的 canvas
- [x] `record()` 会把当前 serialized canvas 列表传给 observer
- [x] command path 会绕开 auto snapshot loop
- [x] `stop()` / `takeSubsequentFullSnapshot()` 已接线

### Still Open

- [ ] `reset()` 语义是否需要进一步 generation 隔离
- [ ] freeze / lock 能力是否也要像 rrweb `CanvasManager` 那样补齐
- [ ] visibility gate 最终验收
- [x] canvas worker 生命周期对齐现有 deflate worker
- [x] canvas worker 从 `canvasEncodeBridge` 内嵌字符串迁移到 `packages/worker`
- [x] canvas worker 进入 worker package 独立 bundle 产物
- [x] `replayCanvasWorkerUrl` 指向独立 canvas worker bundle
- [x] `replayCanvasWorkerUrl` 正式配置
- [x] canvas worker 独立 bundle
- [x] 保持现有 deflate worker 入口、协议、bundle 和 `workerUrl` 完全不变

## Test Gates

### Correctness

- [x] method capture 顺序
- [x] property setter capture
- [x] live canvas rendering 不被破坏
- [x] drawImage(image)
- [x] drawImage(canvas)
- [x] typed array / buffer / DataView
- [x] per-context batch flush
- [x] manual `flush()`
- [x] `stop()`
- [x] double patch guard
- [x] existing canvas startup patch

### Still Missing

- [x] `Path2D` 行为级测试
- [x] `CanvasGradient` / `addColorStop` fallback 规则
- [x] `CanvasPattern` fallback 规则
- [x] 多 canvas dashboard 下复杂对象不串
- [x] `takeSubsequentFullSnapshot()` 后命令边界
- [ ] hidden / visible 下 command path 行为

## Benchmark Gates

command capture 默认化前必须对齐这几组：

- [ ] main canvas `auto command`
- [ ] main canvas `visibility command`
- [ ] dashboard `auto command`
- [ ] dashboard `visibility command`

每组都必须看：

- [ ] completed update count
- [ ] avg/max update gap
- [ ] `avgCanvasMutationBytes`
- [ ] `bytesLimitFlushCount`
- [ ] `replaySegmentFlushCount`
- [ ] main-thread cost

## Current Call

当前不要再把 command capture 写成“未跑通原型”。

更准确的判断是：

- `sampling:number -> continuous snapshot` 已稳定
- `sampling:'all' -> command capture` 已走通主链
- command 现在的主要工作不再是“能不能录到”
- 而是：
  - replay fidelity
  - visibility gate
  - 与 snapshot / Sentry 的浏览器性能对照

### Configuration Convergence

- [x] runtime 已收敛到最终 `replayCanvasSampling = number | 'all'`
- [x] 默认配置已切到 numeric sampling
- [x] `'all'` 已映射到 command capture

### Current Blocking Issue

- [x] command capture 已经开始产生命令
- [x] runtime / docs 已收敛到最终 `replayCanvasSampling` 配置语义
- [ ] 复杂对象的 rrweb replay fidelity 仍依赖 snapshot fallback
- [ ] hidden / visible 浏览器级行为仍需最终验收
- [x] canvas worker 外部 URL / 独立 bundle / init lifecycle 已完成
- [x] canvas worker 已进入 `packages/worker` 统一交付模型
- [x] canvas worker 已和 deflate worker 做到交付层解耦

虽然 command 主链已经走通，但 **复杂对象 fidelity 和最终浏览器级 gate 还没有完全收口**。

这里再明确一层：

- `Path2D` 当前不再作为“待补完整 fidelity”的近期 blocker
- 当前复杂对象 blocker 主要收敛为：
  - `CanvasGradient`
  - `CanvasPattern`
  - 更复杂 `drawImage`
  - visibility gate
  - canvas worker delivery / lifecycle

这件事在复杂对象和 visibility gate 收完前，仍然是当前主 blocker。

## Rollout Criteria

只有下面这些同时满足，才允许把 command capture 升成默认路径：

- [ ] correctness gate 全绿
- [ ] benchmark gate 全绿
- [ ] live rendering 零破坏
- [ ] fallback 语义清晰
- [ ] 文档和 debug 能力收口完成

## Immediate Next Steps

- [x] 用 rrweb `CanvasManager` 真实实现重写路线判断
- [x] 把主路线正式改成 command capture
- [x] 起 command recorder 骨架
- [x] 接入 per-canvas pending queue + rAF flush
- [x] 接入 rrweb-compatible canvas mutation record 结构
- [x] 接入 demo behind flag
- [x] 扩第一批高频 2D API
- [x] 加入 opaque object stable ref 策略
- [x] 跑通 command path 的有效 benchmark
- [x] 对齐 rrweb setter command 格式
- [x] 结构化 fallback reason
- [ ] 补 `CanvasGradient / CanvasPattern` 的完整语义策略
- [x] 把 canvas encode worker 提升到和 deflate worker 同等级的 worker 基础设施
- [x] `replayCanvasWorkerUrl` 与独立 bundle 交付
- [x] `packages/worker` 下的 canvas worker 入口与构建产物
- [x] `canvas-worker` 独立 bundle，确保不影响现有 worker bundle
- [ ] 再决定是否继续向 rrweb 式 full manager（freeze/lock/reset）收拢
