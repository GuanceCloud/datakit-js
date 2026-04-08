# Canvas 录制使用手册

## 概述

Guance Browser RUM 现在支持在 Session Replay 中录制 `canvas` 画面。

当前版本的能力边界是：

- 支持手动触发录制
- 支持低频自动采样录制
- 仅支持 `2d canvas`
- 录制结果会进入 Session Replay 事件流
- 播放侧依赖现有 `rrweb replayer`

当前版本不支持：

- `webgl` / `webgl2`
- 命令级 canvas 录制

## 快速选择

优先按下面的规则选模式：

- 你知道什么时候画面稳定：用 `manual`
- 你希望 SDK 自己低频补帧：用 `auto`
- 你只关心最终状态：优先 `manual`
- 你的 canvas 会长时间静止：`auto` 也可以，当前已带重复帧去重和退避

推荐配置：

```js
replayCanvasEnabled: true,
replayCanvasMode: 'manual',
replayCanvasQuality: 'medium'
```

如果要开自动模式，建议从这组起步：

```js
replayCanvasEnabled: true,
replayCanvasMode: 'auto',
replayCanvasQuality: 'medium'
```

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

- SDK 按固定间隔低频扫描已序列化 canvas
- 连续重复帧会返回 `unchanged`
- 单个 canvas 带成功冷却、重复帧退避、失败退避
- 页面进入后台时会暂停采样，回到前台后立即补一次
- 单轮只处理有限个 canvas，同优先级内部按轮转方式公平取样
- 可通过 `shouldRecordCanvas()` 返回数字优先级，让关键 canvas 先录

适合：

- 业务不方便手工卡补帧时机
- 页面里只有少量 2D canvas
- 可以接受“低频补帧”而不是“逐帧视频”
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

日常接入时，优先只关心下面 4 个配置：

- `replayCanvasEnabled`
- `replayCanvasMode`
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
- 默认值：`'manual'`

指定 canvas 录制模式。

- `manual`: 由业务代码在合适时机主动调用 `snapshotCanvas()`
- `auto`: SDK 按固定间隔低频扫描已进入序列化树的 `canvas` 并自动补帧

### `replayCanvasQuality`

- 类型：`'low' | 'medium' | 'high' | number`
- 默认值：`0.4`

canvas 快照编码质量。

推荐优先使用预设值：

- `low`: 编码质量 `0.25`，更保守的 auto 节奏，默认 `maxPerRun = 1`
- `medium`: 编码质量 `0.4`，默认 auto 策略，默认 `maxPerRun = 2`
- `high`: 编码质量 `0.5`，更积极的 auto 节奏，默认 `maxPerRun = 4`

这些预设不仅决定编码质量，也会一起决定 auto 模式下的默认预算和节奏。

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

- `replayCanvasAutoInterval`
  控制 auto 采样频率，默认 `1000ms`
- `replayCanvasAutoCooldown`
  单个 canvas 成功补帧后的最小冷却时间，默认 `1000ms`
- `replayCanvasAutoUnchangedBackoff`
  命中重复帧去重后的退避时间，默认 `3000ms`
- `replayCanvasAutoFailureBackoff`
  编码失败后的退避时间，默认 `5000ms`
- `replayCanvasAutoMaxPerRun`
  单轮最多处理多少个 canvas
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
- `export last canvas event`: 导出最近一次成功手动 snapshot 对应的 rrweb-compatible `CanvasMutation`

需要注意：

- `auto draw` 是 demo 行为，不是 SDK 内部自动采样器
- `auto result` 目前是基于手动 `snapshotCanvas()` 结果做的策略映射，主要用于调试说明
- 它还没有直接接入 SDK 内部 auto 定时采样结果
- 导出的 event 也是 demo 侧按当前 canvas 内容重建的调试样例，不是从 intake payload 直接回读

## 播放兼容性

当前方案会把 canvas 录制结果编码为 rrweb-compatible `CanvasMutation`，并与普通 DOM replay 共用同一条时间轴。

这意味着：

- 普通 DOM snapshot 先恢复页面结构
- 随后的 `CanvasMutation` 再把 canvas 画面应用回对应节点

你不需要为播放器单独接一套“canvas 图片资源 API”。

播放器要正确回放 canvas，至少需要满足：

- 打开 rrweb replayer 的 `UNSAFE_replayCanvas`
- 正常消费 `IncrementalSource.CanvasMutation`
- `pause` 时保留当前 canvas 画面，不要额外清空
- `seek` 时按目标时间点之前最近一条 canvas frame 重建状态
- 不要因为中间夹杂 `scroll`、`mouse interaction` 等普通 replay event 而打断 canvas 状态恢复

当前仓库已经提供了可直接复用的 fixture 基线，后续播放器项目可以直接拿这组事件流做验收：

- `packages/rum/src/domain/replay/record/canvasReplayFixtures.js`
- 兼容测试示例：`packages/rum/src/domain/replay/record/canvasReplayCompatibility.spec.js`

如果播放器项目希望直接拿一个接近真实 intake 结构的样例，可以使用：

- `createCanvasReplayFixturePayload()`

示例：

```js
import {
  createCanvasReplayFixturePayload
} from '../packages/rum/src/domain/replay/record/canvasReplayFixtures'

const payload = createCanvasReplayFixturePayload()
const replayer = new rrweb.Replayer(payload.records, {
  UNSAFE_replayCanvas: true
})

replayer.play()
```

这组 payload 的语义是：

- 第 1 帧：手动 snapshot 后的 canvas 画面
- 中间夹杂普通 scroll / click 类 replay event
- 第 2 帧：后续 frame 更新
- 第 3 帧：clear 后的空白画面

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

当前版本已经支持自动录制，但它是“低频采样”，不是“逐帧视频”。

原因是：

- canvas 编码本身成本较高
- 高频抓帧会明显放大 replay 体积
- 多个 canvas 同时存在时，必须做冷却、退避和预算控制
- WebGL 和高频动画场景仍然不适合走这条路径

所以当前自动模式的设计目标是：

- 用较低成本补关键视觉状态
- 尽量避免静止画面反复上传
- 不把 Session Replay 变成视频录制

### 3. 为什么不支持 WebGL？

当前版本只支持 2D canvas。

WebGL / WebGL2 的上下文状态更复杂，自动录制和回放都需要额外处理，后续版本再考虑。

### 4. canvas 录制是单独上传的吗？

不是。

当前版本中，canvas 快照会被编码为 replay 事件的一部分，并与普通 replay 共用同一个上传链路。

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
  replayCanvasQuality: 'medium',
  replayCanvasAutoInterval: 1000,
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

如果业务时机明确，优先 `manual`；如果是 dashboard 一类多图场景，再谨慎开启低频 `auto`。
