# Canvas 录制使用手册

## 概述

Guance Browser RUM 现在支持在 Session Replay 中录制 `canvas` 画面。

先说明最重要的一点：

**只配置 `replayCanvasEnabled` 还不够。**

canvas 录制要真正生效，至少还需要同时满足下面这些前置条件：

- 已开启 Session Replay 采样
  - 也就是 `sessionReplaySampleRate > 0`，或命中 `sessionReplayOnErrorSampleRate`
- 已启动 Session Replay 录制
  - 也就是调用 `startSessionReplayRecording()`
- 已开启 canvas 录制
  - 也就是 `replayCanvasEnabled: true`
- 页面里的目标元素确实是 `2d canvas`
- 如果是 `manual` 模式，业务代码还必须主动调用 `snapshotCanvas(canvas)`

当前版本的能力边界是：

- 支持手动触发录制
- 支持自动录制
- 自动录制支持两条正式路径：
  - snapshot sampling
  - higher-fidelity auto recording
- 仅支持 `2d canvas`
- 录制结果会进入 Session Replay 事件流

当前版本暂不覆盖的范围：

- `webgl` / `webgl2`
- 对所有复杂 2D 场景都做完全一致的还原

## 快速选择

## 最小可用配置

下面三套是当前最小可用配置。实际接入时，建议直接从这里复制，再按场景往上加。

### 1. 手动录制：最稳、最推荐

这套配置适合：

- 你知道什么时候画面已经稳定
- 你只需要关键节点补一帧
- 你希望成本尽量可控

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'manual',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

然后在业务代码里主动补帧：

```js
await datafluxRum.snapshotCanvas(canvasElement)
```

这套里真正必须显式配置的是：

- `sessionReplaySampleRate`
- `replayCanvasEnabled`

推荐同时显式配置的是：

- `replayCanvasMode: 'manual'`
- `replayCanvasQuality: 'medium'`

### 2. 自动 snapshot：更保守的自动录制

这套配置适合：

- 业务不方便手动卡补帧时机
- 你更关心稳定和成本
- 可以接受自动补帧不是逐帧录制

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

这套里建议显式配置的是：

- `replayCanvasEnabled: true`
- `replayCanvasMode: 'auto'`
- `replayCanvasSampling: 2`
- `replayCanvasQuality: 'medium'`

如果你不显式传 `replayCanvasSampling`，SDK 也会用数值模式，但**不建议依赖默认值做接入说明**，最好写清楚。

### 3. 自动高还原度录制

这套配置适合：

- 你希望自动模式更接近真实绘制过程
- 页面主要是 2D canvas
- 你可以接受复杂场景下自动回退为 snapshot

```js
datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  sessionReplaySampleRate: 100,

  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 'all',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

这套里必须显式配置的是：

- `replayCanvasEnabled: true`
- `replayCanvasMode: 'auto'`
- `replayCanvasSampling: 'all'`

## 必须配置什么

如果你的目标只是“让 canvas 录制先跑起来”，最少要关心下面这些参数：

### 必须满足的前置条件

- `sessionReplaySampleRate`
  - 必须保证 replay 会被采样到，否则 canvas 录制不会生效
- `startSessionReplayRecording()`
  - 只 `init()` 不够，必须真正启动 replay 录制
- `replayCanvasEnabled: true`
  - 不开这个，canvas 录制完全关闭

### 手动模式必须配置

- `replayCanvasEnabled: true`
- 建议显式写 `replayCanvasMode: 'manual'`
- 业务代码必须调用 `snapshotCanvas(canvas)`

### 自动模式必须配置

- `replayCanvasEnabled: true`
- `replayCanvasMode: 'auto'`
- 建议显式写 `replayCanvasSampling`
  - 数值：自动 snapshot
  - `'all'`：更高还原度的自动录制

### 什么时候要配 `replayCanvasWorkerUrl`

这个参数不是“功能开关”，而是部署参数。

只有在这些场景才需要配：

- 站点 CSP 不允许 `worker-src blob:`
- 你要把 canvas snapshot 编码 worker 单独托管
- 你明确希望 canvas 编码不走 inline blob worker

典型写法：

```js
datafluxRum.init({
  // ...
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasWorkerUrl: '/canvas-worker.js'
})
```

注意：

- `replayCanvasWorkerUrl` 只影响 canvas snapshot 编码
- 它不替代原来的 `workerUrl`
- 如果当前这一帧没有走 snapshot 编码，就不会用到 canvas worker

## 模式差异

### `manual`

特点：

- 由业务主动决定补帧时机
- 不做重复帧去重
- 最适合“关键节点补一帧”

适合：

- 图表渲染完成
- 游戏结算页
- 白板保存
- 动画结束后取最终画面

### `auto`

特点：

- SDK 自动补帧
- 具体补帧方式由 `replayCanvasSampling` 决定
- 页面进入后台时会暂停录制，回到前台后恢复
- 可通过 `shouldRecordCanvas()` 返回数字优先级，让关键 canvas 先录

`replayCanvasSampling` 的正式语义：

- `2`：推荐默认值。自动 snapshot，稳定性和成本更平衡，建议从这里开始。
- `1`：更频繁的自动 snapshot，适合画面变化更密集的 2D canvas，但编码和上报成本更高。
- 更大的数字：自动 snapshot 更稀疏，成本更低，但更容易丢掉中间变化。
- `'all'`：更高还原度的自动录制，尽量保留绘制过程；复杂场景下仍可能自动回退为 snapshot。

简单选择建议：

- 不确定怎么配：先用 `replayCanvasSampling: 2`
- 更看重成本：把数值调大
- 更看重还原度：先尝试 `1`，再评估是否真的需要 `'all'`
- 只有在你明确接受更高复杂度和更高数据成本时，才使用 `'all'`

适合：

- 业务不方便手工卡补帧时机
- 页面里有少量到中等规模的 2D canvas
- 希望在成本和还原度之间做平衡
- 多图表页面里只需要优先录关键主图

## 适用场景

适合这些场景：

- 业务自己知道什么时候画面稳定
- 需要在关键操作后手动截取一次 canvas 画面
- 需要让 Session Replay 能还原一部分 2D canvas 视觉结果

不适合这些场景：

- 高频动画逐帧录制
- 复杂 WebGL 场景
- 对每一帧都要求严格还原的视频式回放

## 开启方式

### NPM

```js
import { datafluxRum } from '@cloudcare/browser-rum'

datafluxRum.init({
  applicationId: '<YOUR_APPLICATION_ID>',
  datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
  service: 'browser',
  env: 'production',
  version: '1.0.0',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackUserInteractions: true,

  replayCanvasEnabled: true,
  replayCanvasMode: 'manual',
  replayCanvasQuality: 'medium'
})

datafluxRum.startSessionReplayRecording()
```

### CDN

```html
<script
  src="https://static.guance.com/browser-sdk/v3/dataflux-rum.js"
  type="text/javascript"
></script>
<script>
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.init({
      applicationId: '<YOUR_APPLICATION_ID>',
      datakitOrigin: '<YOUR_DATAKIT_ORIGIN>',
      service: 'browser',
      env: 'production',
      version: '1.0.0',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      trackUserInteractions: true,

      replayCanvasEnabled: true,
      replayCanvasMode: 'manual',
      replayCanvasQuality: 'medium'
    })

  window.DATAFLUX_RUM && window.DATAFLUX_RUM.startSessionReplayRecording()
</script>
```

## 配置项说明

日常接入时，优先只关心下面 5 个配置：

- `replayCanvasEnabled`
- `replayCanvasMode`
- `replayCanvasSampling`
- `replayCanvasQuality`
- `shouldRecordCanvas`

其余参数都属于高级覆盖项。只有在你已经确认默认策略不适合当前页面时，再继续往下调。

### `replayCanvasEnabled`

- 类型：`boolean`
- 默认值：`false`

是否开启 canvas 录制能力。

建议始终显式配置。默认关闭时，不会影响现有普通 Session Replay 逻辑。

### `replayCanvasMode`

- 类型：`string`
- 当前支持：`'manual' | 'auto'`
- 默认值：`'auto'`

指定 canvas 录制模式。

- `manual`: 由业务代码在合适时机主动调用 `snapshotCanvas()`
- `auto`: SDK 自动补帧，具体策略由 `replayCanvasSampling` 决定

### `replayCanvasSampling`

- 类型：`number | 'all'`
- 默认值：数值模式

指定 `auto` 模式下的 canvas 录制策略。

- 数值：走 snapshot sampling
- `'all'`：走更高还原度的自动录制

建议：

- 如果目标是更稳、更保守：优先用数值模式
- 如果目标是更接近真实绘制过程：用 `'all'`

注意：

- `'all'` 并不意味着所有场景都会完全按高还原度路径录制
- 对某些复杂场景，SDK 会自动回退到 snapshot

### `replayCanvasQuality`

- 类型：`'low' | 'medium' | 'high' | number`
- 默认值：`0.4`

canvas 快照编码质量。

推荐优先使用预设值：

- `low`: 编码质量 `0.25`
- `medium`: 编码质量 `0.4`
- `high`: 编码质量 `0.5`

这些预设主要影响 snapshot 编码质量。在 `replayCanvasSampling: 'all'` 下，command 帧本身不会走图片编码，但 fallback snapshot 仍会用到这里的质量配置。

如果传数字，仍然按高级覆盖项处理。

数值或预设越高：

- 图像质量越高
- 体积通常越大
- 对 replay segment 的压力也越大

建议先从 `medium` 开始。

## 如何录制

### API

当前对外 API：

```js
DATAFLUX_RUM.snapshotCanvas(canvasElement)
```

或 NPM：

```js
datafluxRum.snapshotCanvas(canvasElement)
```

返回值是一个 `Promise`，resolve 后得到：

```js
{ ok: true }
```

或：

```js
{ ok: false, reason: '...' }
```

当前可能出现的 `reason` 包括：

- `not_recording`
- `replay_disabled`
- `invalid_mode`
- `not_canvas`
- `not_serialized`
- `detached`
- `rejected_by_should_record_canvas`
- `encode_too_large`
- `unchanged`
- `encode_failed`
- `observer_stopped`

### 最小示例

```js
const canvas = document.getElementById('my-canvas')
const ctx = canvas.getContext('2d')

ctx.fillStyle = '#2563eb'
ctx.fillRect(20, 20, 160, 80)
ctx.fillStyle = '#0f172a'
ctx.font = '20px sans-serif'
ctx.fillText('Canvas Replay', 210, 70)

window.DATAFLUX_RUM &&
  window.DATAFLUX_RUM.snapshotCanvas(canvas).then((result) => {
    if (!result.ok) {
      console.warn('snapshotCanvas failed:', result.reason)
    }
  })
```

### 推荐调用时机

建议在以下时机调用：

- 一次绘制完成之后
- 一组动画结束之后
- 用户完成关键交互后

不建议：

- 每一帧都调用
- 高频定时器中调用
- 页面空闲之外的大量批量调用

## 录制生效条件

要让 canvas snapshot 真正进入 replay，必须同时满足：

- 已调用 `init()`
- 已调用 `startSessionReplayRecording()`
- `replayCanvasEnabled = true`
- `replayCanvasMode = 'manual'` 或 `'auto'`
- 传入的是 `HTMLCanvasElement`
- 节点已经进入当前 DOM snapshot
- 节点仍然在文档中
- 编码结果未超出大小限制

如果其中任意条件不满足，本次 snapshot 会失败或被跳过。

## `shouldRecordCanvas` 用法

`shouldRecordCanvas(canvas)` 现在既可以控制“录不录”，也可以控制 auto 模式里的优先级。

返回值规则：

- 返回 `false`：不录制这个 canvas
- 返回数字：作为 auto 模式优先级，数字越大越优先
- 返回 `true`、`undefined` 或其他非数字真值：按默认优先级 `0`

示例：

```js
datafluxRum.init({
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasQuality: 'medium',
  shouldRecordCanvas(canvas) {
    if (canvas.dataset.replay === 'off') {
      return false
    }

    if (canvas.dataset.chartRole === 'primary') {
      return 10
    }

    if (canvas.dataset.chartRole === 'secondary') {
      return 5
    }

    return 0
  }
})
```

这对 dashboard 很有用：

- 主图先录
- 次级图在有预算时继续录
- 无关小图或缩略图可以直接排除

## 高级覆盖项

如果默认策略不够用，再考虑这些底层参数：

- `replayCanvasMimeType`
  编码格式，默认 `image/webp`
- `replayCanvasMaxCanvasSize`
  编码前允许的最大边长，默认 `1280`
- `replayCanvasMaxEncodedBytes`
  单帧允许进入 replay 的最大字节数，默认 `40000`
- `replayCanvasMaxConcurrentEncodes`
  并发编码上限，默认 `1`
- `replayCanvasFlushImmediately`
  成功进入 replay 后是否优先 flush，默认 `true`

只有在以下场景才建议继续调这些项：

- 页面里 canvas 数量明显多于默认预算
- 单帧体积过大，必须压缩尺寸或字节数
- 你已经通过 debug 结果确认当前节奏过慢或过快

## Demo 调试面板

本仓库的本地 demo 已带一个 canvas 调试面板，便于观察当前录制链路：

- `mode`: 当前 demo 使用的 canvas 录制模式
- `auto policy`: 当前 demo 初始化时传入的 `interval / cooldown / unchanged backoff / failure backoff / max per run`
- `auto draw`: demo 自己的持续重绘开关，只用于制造画面变化
- `last trigger`: 最近一次手动 `snapshotCanvas()` 的触发来源
- `last snapshot`: 最近一次手动 `snapshotCanvas()` 的结果
- `last reason`: 最近一次失败原因
- `auto result`: 按当前配置推导出的策略结果展示
- `last event`: 最近一次 demo 侧记录的事件状态

当前 demo 还提供两个辅助能力：

- `toggle auto draw`: 周期性重绘 canvas，方便观察 auto 模式下是否持续产生变化
- `export last canvas event`: 导出最近一次成功手动 snapshot 对应的调试事件

需要注意：

- `auto draw` 是 demo 行为，不是 SDK 内部自动采样器
- `auto result` 目前是基于手动 `snapshotCanvas()` 结果做的策略映射，主要用于调试说明
- 它还没有直接接入 SDK 内部 auto 定时采样结果
- 导出的 event 也是 demo 侧按当前 canvas 内容重建的调试样例，不是从 intake payload 直接回读

## 性能建议

canvas 录制是高成本能力，建议保守使用。

推荐做法：

- 只在关键时刻调用 `snapshotCanvas()`
- 控制 canvas 尺寸
- 优先使用 `replayCanvasQuality: 'low' | 'medium' | 'high'`
- 保持 `replayCanvasMaxConcurrentEncodes = 1`
- auto 模式下优先让 quality 预设决定默认预算
- dashboard 页面优先用 `shouldRecordCanvas()` 做关键图筛选和优先级排序

不推荐：

- 对高频动画逐帧截图
- 对超大画布频繁调用
- 将 canvas 录制当作默认路径

## 隐私说明

必须注意：

- canvas 像素内容不受普通 DOM masking 自动保护

也就是说：

- 文本节点、表单节点、属性脱敏规则，不会自动作用于 canvas 像素
- 如果 canvas 中绘制了敏感信息，录制后可能会在 replay 中还原出来

因此建议：

- 仅对可公开回放的 canvas 开启录制
- 不要对包含账号、手机号、支付信息等敏感内容的 canvas 调用 `snapshotCanvas()`

## 常见问题

### 1. 为什么调用了 `snapshotCanvas()` 但 replay 里没看到画面？

优先检查：

- 是否已开启 `replayCanvasEnabled`
- 是否已启动 session replay recording
- 是否传入的是 `canvas` 元素
- 是否在 canvas 绘制完成后再调用
- 是否因为体积过大被丢弃

### 2. 为什么自动模式不是逐帧录制？

当前版本已经支持自动录制，但它不是“逐帧视频”。

原因是：

- snapshot sampling 本质上仍然是采样
- 更高还原度的自动录制虽然更接近真实绘制，但仍然会受到复杂场景边界和自动回退约束
- canvas 编码和上传成本仍然明显高于普通 DOM replay
- WebGL 和高频动画场景仍然不适合走这条路径

所以当前自动模式的设计目标是：

- 用较低成本补关键视觉状态
- 在还原度和成本之间做平衡
- 不把 Session Replay 变成视频录制

### 3. 为什么不支持 WebGL？

当前版本只支持 2D canvas。

WebGL / WebGL2 的上下文状态更复杂，自动录制和回放都需要额外处理，后续版本再考虑。

### 4. canvas 录制是单独上传的吗？

不是。

当前版本中，canvas 快照会被编码为 replay 事件的一部分，并与普通 replay 共用同一个上传链路。

### 5. 为什么仪表板页面里有些图表录到了，有些没有录到？

这类页面通常会同时存在很多个 `canvas` 图表。出现“部分图表没有录到”时，最常见的原因不是单个图表报错，而是：

- 自动模式每一轮不一定会录所有图表
- 同屏图表太多，自动录制预算不够
- 某些图表初始绘制太早，后面又没有重绘
- 某些复杂图表在自动高还原度模式下会回退到 snapshot，成本更高

优先建议这样处理：

1. 如果页面核心诉求是“图表尽量别漏”，优先使用：

```js
replayCanvasEnabled: true,
replayCanvasMode: 'auto',
replayCanvasSampling: 'all'
```

2. 对首屏关键图表，在图表渲染完成后主动补一帧：

```js
await datafluxRum.snapshotCanvas(canvas)
```

3. 对非关键图表继续交给自动模式处理

4. 使用 `shouldRecordCanvas()` 提高关键图表优先级，或跳过不重要的小图：

```js
shouldRecordCanvas(canvas) {
  if (canvas.dataset.miniChart === 'true') {
    return false
  }

  if (canvas.id === 'main-trend' || canvas.id === 'conversion-funnel') {
    return 10
  }

  return 1
}
```

如果你更看重稳定和成本，而不是覆盖所有图表：

- 保持 `replayCanvasSampling: 2`
- 只对关键图表手动 `snapshotCanvas(canvas)`

如果你更看重覆盖率：

- 尝试 `replayCanvasSampling: 'all'`
- 再配合关键图表手动补帧

简单理解就是：

- 自动模式负责“尽量录”
- 手动 `snapshotCanvas(canvas)` 负责“保证关键图一定录到”

## 示例场景

适合直接接入的业务场景：

- 图表绘制完成后录一次
- 关卡结束时录一次
- 白板保存前录一次
- 签字确认后录一次

一个更完整的示例：

```js
function drawInvoicePreview(canvas, data) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111827'
  ctx.font = '18px sans-serif'
  ctx.fillText('Invoice Preview', 24, 36)
  ctx.fillText('Order: ' + data.orderNo, 24, 72)
  ctx.fillText('Amount: ' + data.amount, 24, 108)
}

function refreshPreview(canvas, data) {
  drawInvoicePreview(canvas, data)
  window.DATAFLUX_RUM &&
    window.DATAFLUX_RUM.snapshotCanvas(canvas)
}
```

dashboard 场景示例：

```js
datafluxRum.init({
  replayCanvasEnabled: true,
  replayCanvasMode: 'auto',
  replayCanvasSampling: 2,
  replayCanvasQuality: 'medium',
  shouldRecordCanvas(canvas) {
    if (canvas.dataset.miniChart === 'true') {
      return false
    }

    if (canvas.id === 'main-trend' || canvas.id === 'conversion-funnel') {
      return 10
    }

    return 1
  }
})
```

这个配置的语义是：

- 跳过小型辅助图
- 优先录主趋势图和核心漏斗图
- 其他普通图在同优先级下轮转取样

## 建议

当前版本推荐的使用方式只有一句话：

- 把 canvas 录制当成“关键视觉状态补帧”，不要当成“持续视频录制”

如果业务时机明确，优先 `manual`；如果是 dashboard 一类多图场景，再谨慎开启 `auto`，并明确选择数值 sampling 或 `'all'`。 
