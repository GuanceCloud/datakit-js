# Replay Canvas Command Capture RFC

## Goal

这份 RFC 回答的是：

**如何把当前 canvas replay 主路线，正式推进到 rrweb-compatible 的 2D command capture。**

前提已经确定：

- 目标对齐 rrweb / Sentry 的 canvas sampling 语义
- 默认模式是 `sampling: number`
- `sampling: number` 走 snapshot
- `sampling: 'all'` 走 command capture
- 目标是效果不弱于 Sentry
- 同时 bytes / flush /主线程成本要优于 Sentry

## Reference Baseline

实现判断以这几处源码为基准：

- [rrweb canvas-manager.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/canvas-manager.ts)
- [rrweb 2d.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/2d.ts)
- [rrweb serialize-args.ts](/tmp/rrweb/packages/rrweb/src/record/observers/canvas/serialize-args.ts)
- [Sentry replay-canvas canvas.ts](/tmp/sentry-javascript-codex/packages/replay-canvas/src/canvas.ts)

## What rrweb Actually Does

### Mode Split

rrweb 的 canvas 有两条路线：

- `sampling: 'all'`
  - command capture
- `sampling: number`
  - snapshot sampling

Sentry 外层 integration 当前默认更像第二条。

### Command Capture Model

rrweb command capture 的关键点：

- patch `CanvasRenderingContext2D.prototype`
- 调用不立即发包
- 先异步收集
- 再按 rAF flush 成 `CanvasMutation.commands`

所以最终对齐目标不是“更高频 snapshot”，而是：

- **记录命令**
- **按帧批量提交**

## Final Product Model

### Mode Mapping

- `sampling: number`
  - 默认模式
  - 走 snapshot sampling
- `sampling: 'all'`
  - 高保真模式
  - 走 2D command capture

### Product Rule

- number 和 all 都必须支持
- 默认必须是 number
- number 不是过渡方案，而是正式支持的默认档位
- all 不是 debug-only，而是正式支持的高保真档位

### Snapshot Fallback

snapshot 仍然存在，但语义是：

- `sampling:number` 的主路径
- `sampling:'all'` 下少量难还原场景的兜底

兜底只用于：

- 初始校准
- command drift 修正
- rrweb 2D replay 目前无法可靠还原的复杂 canvas 对象
- `drawImage(video/cross-origin)` 等难还原场景
- recorder 明确失败

### Out Of Scope For Phase 1

- WebGL 主路线
- 独立 canvas 上传协议
- 完整视频语义

## Current Implementation Snapshot

当前代码已经不是纯设计稿，而是有一条可运行的 command 路径：

- [canvasCommandSerializeArgs.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandSerializeArgs.js)
- [canvasCommandCapture.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandCapture.js)
- [canvasCommandObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandObserver.js)
- [record.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/record.js)

### Landed

- 2D method capture
- property setter capture
- per-context pending queue
- rAF flush
- rrweb-compatible `CanvasMutation` record shape
- behind-flag 接入 `record()`
- demo command mode
- debug / benchmark 接线

### Important Update

当前 recorder 模型已经从早期的 instance-only patch，演进成：

- **shared prototype patch**
- **tracked context filtering**
- fake context / 单测 fallback 才走 instance patch

这一步是为了向 rrweb 靠拢，同时保留我们自己的过滤边界。

### Canvas Worker Status

当前 canvas encode worker 已经升级成独立基础设施，不再是 `canvasEncodeBridge` 里的内嵌字符串 worker。

和现有 [deflateWorker.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/deflate/deflateWorker.js) 对比，当前 canvas worker 已落地：

- 独立 worker 生命周期管理
- `init -> initialized` 往返握手
- 初始化超时
- 启动失败与运行期失败的区分
- 外部 self-hosted worker URL
- 独立 bundle 交付能力
- 位于 `packages/worker` 下的正式 worker 入口

这不是次要差异。对于部分站点的 CSP、浏览器扩展、企业安全产品、ISP/网关环境，外部 worker URL 是正式部署能力，不是可选优化。

同时有一条实现硬约束：

- canvas worker 必须独立打包成单独的 `canvas-worker`
- 不能复用、覆盖或污染现有 deflate worker 的入口、协议和 bundle
- 现有 `workerUrl` 继续只服务 deflate worker
- canvas worker 走独立的 `replayCanvasWorkerUrl`

## Hard Constraints

### 1. Never Break Live Rendering

这是硬约束：

- command capture 绝不能破坏 live canvas 绘制

所以 setter capture 必须遵守：

- 记录 property set
- 同时透传原生 descriptor
- 不允许只更新本地缓存而影响真实绘制

### 2. No Blind Prototype Patch Rollout

虽然当前 recorder 已经切到 shared prototype patch 模型，但 rollout 仍然必须受控：

- 只对 tracked contexts 生效
- 不能把全页面所有 2D canvas 无差别录进去

## Command Surface

### Already Covered

方法：

- `save`
- `restore`
- `translate`
- `scale`
- `rotate`
- `transform`
- `setTransform`
- `clearRect`
- `fillRect`
- `strokeRect`
- `rect`
- `beginPath`
- `moveTo`
- `lineTo`
- `bezierCurveTo`
- `quadraticCurveTo`
- `closePath`
- `arc`
- `ellipse`
- `roundRect`
- `clip`
- `fill`
- `stroke`
- `fillText`
- `strokeText`
- `setLineDash`
- `drawImage`
- `createLinearGradient`
- `createRadialGradient`
- `createPattern`
- `createConicGradient`

属性：

- `fillStyle`
- `strokeStyle`
- `lineWidth`
- `lineCap`
- `lineJoin`
- `miterLimit`
- `font`
- `globalAlpha`
- `shadowColor`
- `shadowBlur`
- `shadowOffsetX`
- `shadowOffsetY`
- `textAlign`
- `textBaseline`
- `filter`

### Still Open

- gradient color stop 还原
- pattern source/repeat 语义
- 更复杂 `drawImage` fidelity 边界

## Serialization Strategy

### Already Landed

- primitives
- arrays
- typed arrays
- `ArrayBuffer`
- `DataView`
- `ImageData`
- `HTMLImageElement`

### Opaque Object Strategy

当前已经不是“直接丢弃复杂对象”，但也不再把这些对象默认当成可稳定 command replay。

现在对 opaque canvas object 采用：

- **stable ref by context**
- 输出 `{ rr_type, index }`

这和 rrweb 的变量引用方向一致。

当前已覆盖：

- `CanvasGradient`
- `CanvasPattern`
- `Path2D` 类对象
- 其他无法直接展开的 object

当前 runtime 规则已经收紧成：

- `CanvasGradient`
- `CanvasPattern`
- `Path2D`
- `CanvasGradient.addColorStop`
- `drawImage(HTMLVideoElement, ...)`
- `drawImage(cross-origin HTMLImageElement, ...)`
- `drawImage(HTMLCanvasElement, ...)`

命中这些对象时，优先切 snapshot fallback，而不是继续发送可能无法被 rrweb 2D replay 正确复原的 command batch。

当前 fallback reason 已细分为：

- `gradient_style_assignment`
- `gradient_color_stop`
- `canvas_pattern`
- `path2d_argument`
- `draw_image_video`
- `draw_image_cross_origin`
- `draw_image_canvas`

### Stable Fallback Boundary

`Path2D` 当前明确作为稳定 fallback 边界处理，不进入近期 command fidelity 范围。

当前判断依据是：

- rrweb 官方 2D replay 对 `Path2D` 这类 opaque object 不是开箱即用
- 现有 `path2d_argument -> snapshot fallback` 语义已经具备稳定的 runtime/debug/test 保证
- 继续推进 `Path2D` command 化，成本和风险都高于当前收益

所以当前正式产品边界是：

- `Path2D` 命中 command path 时，继续走 `path2d_argument -> snapshot fallback`
- 这不是临时缺陷，而是当前明确接受的 fidelity 边界
- 只有在真实业务占比和回放体感证明它已经成为主要问题时，才单独开项推进 `Path2D` command replay

### What Is Still Missing

当前还只是“引用稳定”，还不是“完整可回放”：

- gradient 的 color stop 还原
- pattern 的内容语义

## Integration Model

### Current

当前 runtime 已经收成正式配置模型：

- `replayCanvasSampling: number | 'all'`
- `number -> continuous snapshot`
- `'all' -> command capture`

旧的 experimental canvas 配置字段已经从 runtime 主链移除，不再作为正式入口。

### Target Configuration Model

- `sampling.canvas = number | 'all'`
- 默认：
  - `sampling.canvas = number`
- 行为：
  - `number -> snapshot`
  - `'all' -> command capture`

### Worker Delivery Model

canvas worker 的目标交付模型应直接对齐当前 deflate worker：

- 默认：
  - 内联 worker bundle
  - 通过 `Blob + URL.createObjectURL(...)` 创建
- 可选：
  - 外部 self-hosted worker URL
  - 用于 CSP、安全产品、ISP/网关等无法稳定使用 blob worker 的环境

并且实现位置已经对齐：

- canvas worker 必须放到 `packages/worker` 目录下
- 作为 worker package 的正式一部分独立打包
- 不再继续保留在 `canvasEncodeBridge` 里的内嵌字符串实现

目标配置形态：

- `workerUrl`
  - 继续服务于现有 deflate worker
- `replayCanvasWorkerUrl`
  - 仅服务于 canvas encode worker

目标 bundle 形态：

- 现有 worker bundle 保持不变
- 新增独立 `canvas-worker` bundle
- 两者独立发布、独立加载、独立演进

这意味着 canvas worker 不应长期停留在 `canvasEncodeBridge` 内嵌字符串的形态，而应升级成：

- `packages/worker` 下的独立入口文件
- 独立 worker 入口
- 独立 `canvas-worker` bundle
- 独立 runtime 管理层

### Worker Lifecycle Model

canvas worker 目标生命周期也应对齐 deflate worker：

- `Nil`
- `Loading`
- `Error`
- `Initialized`

并且至少支持：

- `init`
- `initialized`
- `encode`
- `encoded`
- `errored`

必要时再补：

- `reset`
- `stop`

这样 `canvasEncodeBridge` 才能退回为纯调用层，而不是同时承担：

- worker 创建
- worker source 管理
- worker 生命周期
- 错误降级

### Migration Requirement

- runtime 已完成从 experimental flags 到 `replayCanvasSampling` 的收敛
- 后续不再引入新的并列 canvas mode 配置

### Still Open

- 是否补 `freeze/lock/reset` 到 rrweb `CanvasManager` 粒度
- command path 下 hidden/visible 的最终 benchmark 结论
- full snapshot / reset 的更细 generation 语义

## Benchmark Gates

在 command 路径默认化前，必须跑通：

- main canvas `auto command`
- main canvas `visibility command`
- dashboard `auto command`
- dashboard `visibility command`

每组都要给出：

- `completedSnapshots`
- `avg/max gap`
- `avgCanvasMutationBytes`
- `bytesLimitFlushCount`
- `replaySegmentFlushCount`
- main-thread cost

## Current Blocker

当前最大的 blocker 已经不是“command 模式有没有产生命令”。

现在更准确的 blocker 是：

- 复杂对象仍以 snapshot fallback 为主，还没有完整 command replay fidelity
- `Path2D` 当前按长期 fallback 边界处理，不作为近期 command fidelity blocker 单独推进
- command path 的 hidden / visible 浏览器级表现还需要最终验收
- command 与 snapshot / Sentry 的真实性能对照还没有收口成最终结论
- canvas encode worker 还没有补齐与 deflate worker 同等级的交付/部署能力

这条主链已经跑通，demo benchmark 也已经拿到非零结果。现在真正剩下的是：

- visibility gate 的最终验收
- 复杂对象 replay fidelity
- command 与 snapshot / Sentry 的真实浏览器性能对照

所以当前状态应该定义为：

- runtime landed
- benchmark / replay fidelity gates still open

## Acceptance

只有下面这些同时满足，才允许 command capture 升成默认路径：

- command benchmark 全绿
- live rendering 零破坏
- correctness spec 全绿
- fallback 语义清晰
- 文档和 debug 能力收口完成

## Immediate Next Step

当前最该做的不是再扩文档，而是：

- 重新跑 command 模式 demo benchmark
- 看 recorder 是否已经开始稳定产生命令和 bytes
- 如果还是 0，再继续收 observer / tracked context 接入细节
