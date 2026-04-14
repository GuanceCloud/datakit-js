# Session Replay Canvas 设计文档

## 结论摘要

canvas replay 的协议方向不变：

- 继续优先兼容 `rrweb` 的 `CanvasMutation`
- 播放端继续使用现有 `rrweb replayer`
- 不引入独立的 `frameId -> 拉图 -> drawImage` 旁路协议

但产品目标已经进一步收敛成 rrweb / Sentry 同类的两条正式语义：

- `replayCanvasSampling: number`
- `replayCanvasSampling: 'all'`

对应 runtime：

- `number -> snapshot`
- `'all' -> command capture`

## 强制规则

下面这些仍然是硬约束，不因目标变化而放松：

- 绝对不能因为引入或增强 canvas replay 而破坏当前已有的 replay 录制、segment、压缩、上传、回放逻辑
- `replayCanvasEnabled` 默认必须为 `false`
- 未开启 canvas replay 时，现有 replay 行为必须与改动前保持一致
- 任何 canvas 相关异常都不能影响普通 replay event 的录制和发送
- 任何 canvas 编码失败、调度失败、超限丢弃，都只能影响当前 canvas capture，不能扩散到 recorder 主链
- 不能修改现有普通 replay event 的语义、结构和 flush 行为，除非事件本身就是 `CanvasMutation`
- 不能让未使用 canvas replay 的用户承担额外明显的主线程、内存或网络开销

## 当前实现状态

当前仓库里的 canvas replay 主链已经存在，主要代码位于：

- [packages/rum/src/domain/replay/record/canvasObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasObserver.js)
- [packages/rum/src/domain/replay/record/canvasAutoSnapshot.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasAutoSnapshot.js)
- [packages/rum/src/domain/replay/record/canvasContinuousScheduler.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasContinuousScheduler.js)
- [packages/rum/src/domain/replay/record/canvasCommandSerializeArgs.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandSerializeArgs.js)
- [packages/rum/src/domain/replay/record/canvasCommandCapture.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandCapture.js)
- [packages/rum/src/domain/replay/record/canvasCommandObserver.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasCommandObserver.js)
- [packages/rum/src/domain/replay/record/canvasEncodeBridge.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasEncodeBridge.js)
- [packages/rum/src/domain/replay/record/record.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/record.js)
- [packages/rum/src/domain/configuration.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/configuration.js)

当前已经实现：

- `manual` 模式
- `auto` 模式
- `replayCanvasSampling: number | 'all'`
- `number -> continuous snapshot`
- `'all' -> 2D command capture`
- rrweb-compatible `CanvasMutation`
- 失败隔离
- 体积限制
- full snapshot reset
- keepalive
- debug API

当前需要分成两条路径看：

- `replayCanvasSampling: number`
  - snapshot-based
  - 是默认采样档位
- `replayCanvasSampling: 'all'`
  - command capture
  - 是高保真档位

所以仓库当前已经不是“只有 auto snapshot 一条主链”，而是默认 snapshot + 高保真 command 的双路径模型。

### Canvas Worker 现状

当前 canvas 编码 worker 在：

- [packages/rum/src/domain/replay/record/canvasEncodeBridge.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/replay/record/canvasEncodeBridge.js)

它目前仍然是 bridge 内嵌的轻量 worker：

- worker source 通过字符串拼接
- 直接 `Blob + URL.createObjectURL(...)`
- 没有独立 bundle
- 没有初始化握手
- 没有显式状态机
- 不在 `packages/worker` 目录下统一管理

这和现有 session replay / deflate worker 的工程标准并不一致。

现有 deflate worker 的参考实现是：

- [packages/rum/src/domain/deflate/deflateWorker.js](/Users/dengchangliang/www/rum/browser-sdk/packages/rum/src/domain/deflate/deflateWorker.js)
- [packages/worker/src/boot/startWorker.js](/Users/dengchangliang/www/rum/browser-sdk/packages/worker/src/boot/startWorker.js)

这条老链路已经具备：

- 独立 worker bundle
- `workerUrl` 外部托管能力
- `init -> initialized` 往返握手
- 初始化超时
- 启动错误与运行期错误分离

canvas worker 现在已经按这条标准落成第一版基础设施，不再停留在 bridge 内嵌 worker 形态。

这里再明确一条实现要求：

- canvas encode worker 必须迁移到 `packages/worker`
- 由 worker package 统一管理入口、boot、消息协议和 bundle 产物
- 已移除把正式 worker 逻辑长期保留在 `canvasEncodeBridge` 字符串模板里的方案
- 必须独立打包成 `canvas-worker`
- 不能影响现有 deflate worker 的入口、协议、bundle 和 `workerUrl` 语义

## 对 Sentry 实现的调查结论

本次直接阅读的 Sentry 官方源码包括：

- `/tmp/sentry-javascript-codex/packages/replay-canvas/src/canvas.ts`
- `/tmp/sentry-javascript-codex/packages/replay-canvas/test/canvas.test.ts`
- `/tmp/sentry-javascript-codex/packages/replay-canvas/README.md`

可以确认：

### 1. Sentry 对外是 integration，而不是额外上传协议

Sentry 暴露：

```js
Sentry.replayCanvasIntegration()
```

它本质上做的是：

- `recordCanvas: true`
- 注入 `getCanvasManager`
- 配置 `sampling.canvas`
- 配置 `dataURLOptions`
- 对外暴露 `snapshot(canvasElement?, options?)`

### 2. Sentry 默认也是 snapshot-based，不是 command capture

其质量档位对应的是采样强度：

- `low -> sampling.canvas = 1`
- `medium -> sampling.canvas = 2`
- `high -> sampling.canvas = 4`

对应图像质量：

- `0.25`
- `0.4`
- `0.5`

所以 Sentry 当前的 integration 默认并不是“完整记录所有 canvas API 调用”，而是 snapshot-based 录制。

### 3. Sentry 已经把连续性问题收敛到 manager / scheduler 层

Sentry integration 本身没有暴露我们现在这种大量 recorder 级 auto 策略，例如：

- cooldown
- unchanged backoff
- failure backoff
- maxPerRun fairness

也就是说：

- 它的公开语义更接近“开启 canvas replay + 手动 snapshot 能力 + 采样强度”
- 不像我们当前这样，在 SDK 外层叠出一整套 timer sampler 语义

### 4. Sentry 已经考虑 requestAnimationFrame 相关语义

源码中已有：

- `snapshot(..., { skipRequestAnimationFrame })`

以及 release note 里有：

- “Add option to skip requestAnimationFrame for canvas snapshots”

这说明它们在 canvas capture 时，已经把渲染节拍问题当成第一类设计问题，而不只是简单 timer polling。

## 当前实现与 Sentry 的关系

### 已对齐的部分

- 都走 rrweb-compatible canvas replay 路线
- 都以 snapshot-based 为默认实现
- 都有 manual snapshot 入口
- 都有 quality / size 控制概念
- 都不要求播放器走独立 canvas 协议

### 尚未对齐的部分

- `sampling:'all'` 下复杂对象的 replay fidelity 还没完全收口
- visibility / benchmark gate 还没有全部验收完成
- 与 Sentry 的真实性能对照还缺最终闭环

## 为什么不能继续把“调 auto 参数”当主方案

如果目标已经明确是“更连续录制”，那么继续做下面这些都不该被视为正式路线：

- 调小 `replayCanvasAutoInterval`
- 调小 `replayCanvasAutoCooldown`
- 调小 `replayCanvasAutoUnchangedBackoff`
- 调整 `threshold` 跳过逻辑

原因很直接：

- 这些动作仍然是在修补 timer-based sampler
- 它们不能从根本上解决连续性问题
- 最多只是在旧架构上换不同 tradeoff

所以后续设计必须从“参数优化”切到“capture model 升级”。

## 新设计目标

后续 canvas replay 的正式目标定义为：

### 1. 协议继续保持 rrweb-compatible

继续输出：

```js
{
  type: RecordType.IncrementalSnapshot,
  data: {
    source: IncrementalSource.CanvasMutation,
    ...
  }
}
```

这点不变。

### 2. `number` 和 `'all'` 都是正式支持目标

现在的设计目标不是再发明第三条模式，而是把这两条路径都收齐：

- `number`
- `'all'`

### 3. 当前后续重点是把 `'all'` 收到可默认化

后续重点已经从“继续设计新 mode”变成：

- replay fidelity
- visibility correctness
- benchmark gate
- canvas worker 的交付与生命周期标准化

### 4. canvas worker 要对齐现有 session replay worker 标准

canvas worker 的这轮落地结果是：

- [x] 支持独立 bundle
- [x] 支持 self-hosted URL
- [x] 支持 `replayCanvasWorkerUrl`
- [x] 支持初始化握手和状态机
- [x] bridge 只负责调用和降级，不再负责完整 worker 管理
- [x] worker 代码位于 `packages/worker`
- [x] worker bundle 由 worker package 独立产出
- [x] 现有 deflate worker 保持完全不变

## 推荐演进路线

## Phase 1: Continuous-Capture RFC

先写 RFC，明确回答：

- 我们要的是“视觉连续性”还是“API 调用级精确回放”
- 2D canvas 和 WebGL 是否同阶段处理
- `continuous_snapshot` 是否作为下一阶段主方案
- `command_capture` 是否作为长期候选

在没有这份 RFC 之前，不再继续把当前 auto sampler 迭代成更复杂的参数系统。

## Phase 2: 从 Timer-Driven 转向 Render-Driven

下一阶段的 scheduler 目标：

- 不再以固定 timer 作为主要驱动
- 重点研究：
  - `requestAnimationFrame`-driven
  - change-driven capture

设计要求：

- 连续变化时更高频捕获
- 静止时自然降频
- 保持 rrweb `CanvasMutation` 输出兼容

## Phase 3: 引入新的 Capture Model

建议在实现层把 capture model 明确分成三类：

- `manual`
- `continuous_snapshot`
- `command_capture`（先占位，不要求立即实现）

当前旧的 `auto` 保留为 legacy path，不再继续扩展为正式主语义。

## Phase 4: 决策 Continuous Snapshot 还是 Command Capture

### Option A: Continuous Snapshot

特征：

- 仍然产出位图型 `CanvasMutation`
- 但 capture 调度更连续
- 与当前协议和实现最兼容

优点：

- 复用当前编码链
- 改动更可控
- 风险更低

问题：

- 高频场景下数据量仍然可能很大

### Option B: Command Capture

特征：

- 更接近 rrweb 底层的 full canvas observer 路线
- 记录命令，而不是频繁位图快照

优点：

- 理论上连续性更强
- 某些场景下比频繁位图快照更优

问题：

- 复杂度显著更高
- 2D / WebGL / typed arrays / replay correctness 风险都更高

### 当前推荐

短中期建议：

- 优先做 `continuous_snapshot` 原型
- 不在下一轮直接跳到 full command capture
- 但 RFC 里必须把 command capture 作为明确候选，不再回避

## Segment 与 Transport 设计要求

一旦进入更连续 capture，segment 策略必须一起升级。

后续必须重点评估：

- canvas event 的 burst 行为
- `segment_bytes_limit` 命中频率
- replay 请求数
- 单秒 canvas payload 密度

当前仍然不默认引入独立上传协议，但以下问题要重新纳入设计：

- canvas-heavy segment policy 是否需要单独策略
- canvas event coalescing 是否要引入
- 是否需要 canvas-specific compression or transport

## Demo And Benchmark Requirements

未来 benchmark 不再只看“sampling path 是否更省”，而要开始测连续性。

需要新增：

- 持续刷新折线图
- 持续刷新柱状图
- 多-canvas dashboard wallboard
- 高频变化场景下的帧间隔统计

建议新增指标：

- average frame interval
- max frame gap
- emitted canvas mutation count
- dropped frame density
- segment bytes per second

## 配置策略

当前配置继续保留兼容：

- `replayCanvasEnabled`
- `replayCanvasMode`
- `replayCanvasQuality`
- `replayCanvasMaxCanvasSize`
- `replayCanvasMaxEncodedBytes`

但下一阶段不再鼓励把：

- `autoInterval`
- `cooldown`
- `backoff`

当成主要产品调优入口。

新的配置设计目标应该是：

- 对外更接近 capture model
- 对内才保留保护参数

## 明确废弃的旧思路

下面这些不再作为下一阶段正式路线：

- 继续围绕 timer-based auto sampler 调参数
- 把当前 auto sampler 当终态
- 继续把代表帧采样包装成“自动录制增强版”

## 下一步

### 必做

- [ ] 重写 [session_replay_todolist.md](/Users/dengchangliang/www/rum/browser-sdk/session_replay_todolist.md) 使其与本文档一致
- [ ] 新增一份连续录制 RFC 草稿
- [ ] 明确 `continuous_snapshot` 原型的范围和验收指标

### 推荐优先级

1. 设计 RFC
2. 最小原型
3. 连续性 benchmark
4. 再决定是否进入 command capture
